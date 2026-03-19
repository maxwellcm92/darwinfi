/**
 * statistical-predictor.ts - Pure statistical prediction strategies
 *
 * Strategies:
 *   1. Linear regression (slope projection)
 *   2. Mean reversion (Bollinger snap-back)
 *   3. EMA slope projection
 */

import { randomUUID } from 'crypto';
import { Prediction, Resolution, Candle, PredictionStrategyConfig } from '../types';

export class StatisticalPredictor {
  predict(
    token: string,
    resolution: Resolution,
    candles: Candle[],
    indicators: Record<string, number | undefined>,
  ): Prediction | null {
    if (candles.length < 20) return null;

    const currentPrice = candles[candles.length - 1].close;

    // Run all sub-strategies and pick the one with highest confidence
    const results = [
      this.linearRegression(token, resolution, candles, currentPrice),
      this.meanReversion(token, resolution, candles, currentPrice, indicators),
      this.emaSlope(token, resolution, candles, currentPrice),
    ].filter(Boolean) as Prediction[];

    if (results.length === 0) return null;

    // Return highest confidence
    results.sort((a, b) => b.confidence - a.confidence);
    return results[0];
  }

  /**
   * Linear regression on last N closing prices, project next candle.
   */
  private linearRegression(
    token: string,
    resolution: Resolution,
    candles: Candle[],
    currentPrice: number,
  ): Prediction | null {
    const n = Math.min(20, candles.length);
    const recent = candles.slice(-n);
    const closes = recent.map(c => c.close);

    // Simple OLS: y = a + bx
    const xMean = (n - 1) / 2;
    const yMean = closes.reduce((s, v) => s + v, 0) / n;
    let numerator = 0;
    let denominator = 0;

    for (let i = 0; i < n; i++) {
      numerator += (i - xMean) * (closes[i] - yMean);
      denominator += (i - xMean) ** 2;
    }

    if (denominator === 0) return null;

    const slope = numerator / denominator;
    const intercept = yMean - slope * xMean;
    const predicted = intercept + slope * n; // Next candle

    // R-squared for confidence
    const ssTot = closes.reduce((s, y) => s + (y - yMean) ** 2, 0);
    const ssRes = closes.reduce((s, y, i) => {
      const yHat = intercept + slope * i;
      return s + (y - yHat) ** 2;
    }, 0);
    const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    // Average candle range for high/low estimate
    const avgRange = recent.reduce((s, c) => s + (c.high - c.low), 0) / n;
    const pctChange = (predicted - currentPrice) / currentPrice;

    let direction: 'up' | 'down' | 'flat' = 'flat';
    if (pctChange > 0.001) direction = 'up';
    else if (pctChange < -0.001) direction = 'down';

    return {
      id: randomUUID(),
      strategyId: 'stat_linear',
      timestamp: Date.now(),
      token,
      resolution,
      predictedDirection: direction,
      predictedClose: predicted,
      predictedHigh: predicted + avgRange / 2,
      predictedLow: predicted - avgRange / 2,
      confidence: Math.round(Math.max(20, Math.min(80, rSquared * 100))),
      currentPrice,
      eventIds: [],
    };
  }

  /**
   * Mean reversion: when price is near Bollinger Band extremes,
   * predict snap-back toward the middle band.
   */
  private meanReversion(
    token: string,
    resolution: Resolution,
    candles: Candle[],
    currentPrice: number,
    indicators: Record<string, number | undefined>,
  ): Prediction | null {
    const upper = indicators.bollingerUpper;
    const lower = indicators.bollingerLower;
    const middle = indicators.bollingerMiddle;
    if (upper === undefined || lower === undefined || middle === undefined) return null;

    const bandWidth = upper - lower;
    if (bandWidth === 0) return null;

    // Position within bands: 0 = at lower, 1 = at upper
    const position = (currentPrice - lower) / bandWidth;

    // Only trigger if near extremes
    if (position > 0.15 && position < 0.85) return null;

    const avgRange = candles.slice(-20).reduce((s, c) => s + (c.high - c.low), 0) / 20;
    let predicted: number;
    let direction: 'up' | 'down' | 'flat';
    let confidence: number;

    if (position <= 0.15) {
      // Near lower band -> predict bounce up toward middle
      predicted = currentPrice + (middle - currentPrice) * 0.3;
      direction = 'up';
      confidence = Math.round(50 + (0.15 - position) * 200);
    } else {
      // Near upper band -> predict drop toward middle
      predicted = currentPrice - (currentPrice - middle) * 0.3;
      direction = 'down';
      confidence = Math.round(50 + (position - 0.85) * 200);
    }

    return {
      id: randomUUID(),
      strategyId: 'stat_mean_reversion',
      timestamp: Date.now(),
      token,
      resolution,
      predictedDirection: direction,
      predictedClose: predicted,
      predictedHigh: Math.max(predicted, currentPrice) + avgRange * 0.3,
      predictedLow: Math.min(predicted, currentPrice) - avgRange * 0.3,
      confidence: Math.min(80, confidence),
      currentPrice,
      eventIds: [],
    };
  }

  /**
   * EMA slope projection: use the rate of change of EMA-9 to project next close.
   */
  private emaSlope(
    token: string,
    resolution: Resolution,
    candles: Candle[],
    currentPrice: number,
  ): Prediction | null {
    if (candles.length < 15) return null;

    const closes = candles.map(c => c.close);
    const ema9Series = this.computeEMASeries(closes, 9);
    if (ema9Series.length < 3) return null;

    // Slope of last 3 EMA values
    const n = ema9Series.length;
    const slope1 = ema9Series[n - 1] - ema9Series[n - 2];
    const slope2 = ema9Series[n - 2] - ema9Series[n - 3];
    const avgSlope = (slope1 + slope2) / 2;

    const predicted = ema9Series[n - 1] + avgSlope;
    const avgRange = candles.slice(-10).reduce((s, c) => s + (c.high - c.low), 0) / 10;
    const pctChange = (predicted - currentPrice) / currentPrice;

    let direction: 'up' | 'down' | 'flat' = 'flat';
    if (pctChange > 0.001) direction = 'up';
    else if (pctChange < -0.001) direction = 'down';

    // Confidence based on slope consistency (same direction = higher)
    const slopeConsistent = (slope1 > 0 && slope2 > 0) || (slope1 < 0 && slope2 < 0);
    const confidence = slopeConsistent ? 55 : 35;

    return {
      id: randomUUID(),
      strategyId: 'stat_ema_slope',
      timestamp: Date.now(),
      token,
      resolution,
      predictedDirection: direction,
      predictedClose: predicted,
      predictedHigh: predicted + avgRange / 2,
      predictedLow: predicted - avgRange / 2,
      confidence,
      currentPrice,
      eventIds: [],
    };
  }

  private computeEMASeries(prices: number[], period: number): number[] {
    if (prices.length < period) return [];
    const multiplier = 2 / (period + 1);
    const series: number[] = [];
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    series.push(ema);
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
      series.push(ema);
    }
    return series;
  }

  static defaultConfigs(): PredictionStrategyConfig[] {
    return [
      {
        id: 'stat_linear',
        name: 'Linear Regression',
        type: 'statistical',
        status: 'active',
        resolutions: ['5m', '15m', '1h'],
        tokens: [],
        fitness: {
          directionAccuracy: 0.5, magnitudeMAE: 0.5, confidenceCalibration: 0.5,
          consistency: 0.5, resolutionFit: 0.5, compositeScore: 0.5,
          lastEvaluatedAt: 0, evaluationCount: 0,
        },
        parameters: { lookback: 20 },
        lastPredictionAt: 0,
        totalPredictions: 0,
      },
      {
        id: 'stat_mean_reversion',
        name: 'Bollinger Mean Reversion',
        type: 'statistical',
        status: 'active',
        resolutions: ['5m', '15m', '1h'],
        tokens: [],
        fitness: {
          directionAccuracy: 0.5, magnitudeMAE: 0.5, confidenceCalibration: 0.5,
          consistency: 0.5, resolutionFit: 0.5, compositeScore: 0.5,
          lastEvaluatedAt: 0, evaluationCount: 0,
        },
        parameters: { bollingerPeriod: 20, stdDev: 2 },
        lastPredictionAt: 0,
        totalPredictions: 0,
      },
      {
        id: 'stat_ema_slope',
        name: 'EMA Slope Projection',
        type: 'statistical',
        status: 'active',
        resolutions: ['1m', '5m', '15m'],
        tokens: [],
        fitness: {
          directionAccuracy: 0.5, magnitudeMAE: 0.5, confidenceCalibration: 0.5,
          consistency: 0.5, resolutionFit: 0.5, compositeScore: 0.5,
          lastEvaluatedAt: 0, evaluationCount: 0,
        },
        parameters: { emaPeriod: 9 },
        lastPredictionAt: 0,
        totalPredictions: 0,
      },
    ];
  }
}
