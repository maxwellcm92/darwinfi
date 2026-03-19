/**
 * pattern-matcher.ts - Historical candle pattern matching
 *
 * Finds similar N-candle patterns in history and predicts based on
 * what happened after those patterns previously.
 */

import { randomUUID } from 'crypto';
import { Prediction, Resolution, Candle, PredictionStrategyConfig } from '../types';

const PATTERN_LENGTH = 5;  // Compare last 5 candles
const MIN_MATCHES = 3;     // Minimum similar patterns needed
const SIMILARITY_THRESHOLD = 0.85; // 0-1, how similar candle shapes must be

interface CandleShape {
  bodyRatio: number;    // (close - open) / (high - low), signed
  wickRatio: number;    // upper wick / candle range
  tailRatio: number;    // lower wick / candle range
  volumeRatio: number;  // volume relative to average
}

function candleToShape(candle: Candle, avgVolume: number): CandleShape {
  const range = candle.high - candle.low;
  if (range === 0) return { bodyRatio: 0, wickRatio: 0.5, tailRatio: 0.5, volumeRatio: 1 };

  const body = (candle.close - candle.open) / range;
  const upperWick = (candle.high - Math.max(candle.open, candle.close)) / range;
  const lowerWick = (Math.min(candle.open, candle.close) - candle.low) / range;

  return {
    bodyRatio: body,
    wickRatio: upperWick,
    tailRatio: lowerWick,
    volumeRatio: avgVolume > 0 ? candle.volume / avgVolume : 1,
  };
}

function patternSimilarity(a: CandleShape[], b: CandleShape[]): number {
  if (a.length !== b.length) return 0;

  let totalDiff = 0;
  for (let i = 0; i < a.length; i++) {
    const bodyDiff = Math.abs(a[i].bodyRatio - b[i].bodyRatio);
    const wickDiff = Math.abs(a[i].wickRatio - b[i].wickRatio);
    const tailDiff = Math.abs(a[i].tailRatio - b[i].tailRatio);
    // Volume ratio difference (log scale)
    const volDiff = Math.abs(Math.log(Math.max(0.1, a[i].volumeRatio)) - Math.log(Math.max(0.1, b[i].volumeRatio)));

    totalDiff += bodyDiff * 0.4 + wickDiff * 0.2 + tailDiff * 0.2 + Math.min(1, volDiff) * 0.2;
  }

  return Math.max(0, 1 - totalDiff / a.length);
}

export class PatternMatcher {
  predict(
    token: string,
    resolution: Resolution,
    candles: Candle[],
  ): Prediction | null {
    if (candles.length < PATTERN_LENGTH + 50) return null;

    const currentPrice = candles[candles.length - 1].close;
    const avgVolume = candles.slice(-50).reduce((s, c) => s + c.volume, 0) / 50;

    // Build the target pattern (last N candles)
    const targetCandles = candles.slice(-PATTERN_LENGTH);
    const targetPattern = targetCandles.map(c => candleToShape(c, avgVolume));

    // Search historical candles for similar patterns
    interface Match {
      similarity: number;
      nextCandle: Candle;
      pctChange: number;
    }

    const matches: Match[] = [];
    const searchEnd = candles.length - PATTERN_LENGTH - 1; // Need at least 1 candle after pattern

    for (let i = 0; i < searchEnd; i++) {
      const windowCandles = candles.slice(i, i + PATTERN_LENGTH);
      const windowPattern = windowCandles.map(c => candleToShape(c, avgVolume));

      const similarity = patternSimilarity(targetPattern, windowPattern);
      if (similarity >= SIMILARITY_THRESHOLD) {
        const nextCandle = candles[i + PATTERN_LENGTH];
        const lastInPattern = windowCandles[windowCandles.length - 1];
        const pctChange = (nextCandle.close - lastInPattern.close) / lastInPattern.close;

        matches.push({ similarity, nextCandle, pctChange });
      }
    }

    if (matches.length < MIN_MATCHES) return null;

    // Weighted average of outcomes (weight by similarity)
    let weightedPctChange = 0;
    let totalWeight = 0;
    let ups = 0;
    let downs = 0;

    for (const m of matches) {
      weightedPctChange += m.pctChange * m.similarity;
      totalWeight += m.similarity;
      if (m.pctChange > 0.001) ups++;
      else if (m.pctChange < -0.001) downs++;
    }

    const avgPctChange = weightedPctChange / totalWeight;
    const predicted = currentPrice * (1 + avgPctChange);

    // Average range from matched next candles
    const avgRange = matches.reduce((s, m) => s + (m.nextCandle.high - m.nextCandle.low), 0) / matches.length;
    const scaledRange = avgRange * (currentPrice / (matches[0].nextCandle.close || 1));

    let direction: 'up' | 'down' | 'flat' = 'flat';
    if (avgPctChange > 0.001) direction = 'up';
    else if (avgPctChange < -0.001) direction = 'down';

    // Confidence based on match count and consistency
    const consistency = Math.max(ups, downs) / matches.length;
    const confidence = Math.round(
      Math.min(75, 30 + matches.length * 3 + consistency * 30),
    );

    return {
      id: randomUUID(),
      strategyId: 'pattern_match',
      timestamp: Date.now(),
      token,
      resolution,
      predictedDirection: direction,
      predictedClose: predicted,
      predictedHigh: predicted + scaledRange / 2,
      predictedLow: predicted - scaledRange / 2,
      confidence,
      currentPrice,
      eventIds: [],
    };
  }

  static defaultConfigs(): PredictionStrategyConfig[] {
    return [{
      id: 'pattern_match',
      name: 'Historical Pattern Matcher',
      type: 'pattern_match',
      status: 'active',
      resolutions: ['5m', '15m', '1h'],
      tokens: [],
      fitness: {
        directionAccuracy: 0.5, magnitudeMAE: 0.5, confidenceCalibration: 0.5,
        consistency: 0.5, resolutionFit: 0.5, compositeScore: 0.5,
        lastEvaluatedAt: 0, evaluationCount: 0,
      },
      parameters: { patternLength: PATTERN_LENGTH, similarityThreshold: SIMILARITY_THRESHOLD },
      lastPredictionAt: 0,
      totalPredictions: 0,
    }];
  }
}
