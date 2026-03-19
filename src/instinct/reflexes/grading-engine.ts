/**
 * grading-engine.ts - Compare predictions to actual candle data
 *
 * After each candle closes, grades ungraded predictions by comparing
 * predicted vs actual direction, close price, and magnitude.
 */

import { Prediction, Resolution, RESOLUTION_MS } from '../types';
import { CandleStore } from '../data/candle-store';

export class GradingEngine {
  private candleStore: CandleStore;

  constructor(candleStore: CandleStore) {
    this.candleStore = candleStore;
  }

  /**
   * Grade a single prediction against actual candle data.
   * Returns the prediction with the `actual` field filled, or null if candle not yet available.
   */
  grade(prediction: Prediction, token: string, resolution: Resolution): Prediction | null {
    if (prediction.actual) return prediction; // Already graded

    const periodSec = RESOLUTION_MS[resolution] / 1000;
    const predictionTimeSec = Math.floor(prediction.timestamp / 1000);

    // Find the candle that corresponds to this prediction's target period
    // The prediction targets the NEXT candle after it was made
    const targetBucketStart = Math.floor(predictionTimeSec / periodSec) * periodSec + periodSec;
    const targetBucketEnd = targetBucketStart + periodSec;

    // Get candles in the target window
    const candles = this.candleStore.getCandles(token, resolution, targetBucketStart, targetBucketEnd);
    if (candles.length === 0) return null; // Candle not yet available

    const actual = candles[0]; // Should be exactly one candle for this bucket

    // Determine actual direction
    const actualPctChange = (actual.close - prediction.currentPrice) / prediction.currentPrice;
    let actualDirection: 'up' | 'down' | 'flat' = 'flat';
    if (actualPctChange > 0.001) actualDirection = 'up';
    else if (actualPctChange < -0.001) actualDirection = 'down';

    // Direction correctness
    const directionCorrect = prediction.predictedDirection === actualDirection;

    // Close price error percentage
    const closeErrorPct = prediction.predictedClose > 0
      ? Math.abs((prediction.predictedClose - actual.close) / actual.close) * 100
      : 100;

    prediction.actual = {
      close: actual.close,
      high: actual.high,
      low: actual.low,
      directionCorrect,
      closeErrorPct,
    };
    prediction.gradedAt = Date.now();

    return prediction;
  }

  /**
   * Compute aggregate accuracy stats for a set of graded predictions.
   */
  static computeStats(predictions: Prediction[]): {
    total: number;
    graded: number;
    directionAccuracy: number;
    avgCloseErrorPct: number;
    avgConfidence: number;
    byDirection: Record<string, { correct: number; total: number }>;
  } {
    const graded = predictions.filter(p => p.actual);
    const total = predictions.length;

    if (graded.length === 0) {
      return {
        total,
        graded: 0,
        directionAccuracy: 0,
        avgCloseErrorPct: 0,
        avgConfidence: 0,
        byDirection: { up: { correct: 0, total: 0 }, down: { correct: 0, total: 0 }, flat: { correct: 0, total: 0 } },
      };
    }

    const correct = graded.filter(p => p.actual!.directionCorrect).length;
    const directionAccuracy = correct / graded.length;
    const avgCloseErrorPct = graded.reduce((s, p) => s + p.actual!.closeErrorPct, 0) / graded.length;
    const avgConfidence = graded.reduce((s, p) => s + p.confidence, 0) / graded.length;

    const byDirection: Record<string, { correct: number; total: number }> = {
      up: { correct: 0, total: 0 },
      down: { correct: 0, total: 0 },
      flat: { correct: 0, total: 0 },
    };

    for (const p of graded) {
      byDirection[p.predictedDirection].total++;
      if (p.actual!.directionCorrect) byDirection[p.predictedDirection].correct++;
    }

    return { total, graded: graded.length, directionAccuracy, avgCloseErrorPct, avgConfidence, byDirection };
  }
}
