/**
 * backtest-runner.ts - Historical validation framework
 *
 * Validates prediction strategies against historical data:
 *   1. Split data: 70% training / 30% test (rolling windows)
 *   2. Strategy finds patterns in training data
 *   3. Validate patterns hold across 3+ separate test windows
 *   4. Check forward accuracy on live data
 *   5. Only patterns surviving all checks become active
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { BacktestRun, Candle, Resolution, Prediction } from '../types';
import { CandleStore } from '../data/candle-store';
import { StatisticalPredictor } from '../reflexes/statistical-predictor';
import { PatternMatcher } from '../reflexes/pattern-matcher';
import { GradingEngine } from '../reflexes/grading-engine';

const BACKTEST_DIR = path.resolve(process.cwd(), 'data/instinct/backtest');
const RUNS_DIR = path.join(BACKTEST_DIR, 'runs');
const SUMMARY_PATH = path.join(BACKTEST_DIR, 'summaries/strategy-backtest-summary.json');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

interface BacktestConfig {
  token: string;
  resolution: Resolution;
  strategyType: 'statistical' | 'pattern_match';
  trainRatio: number;       // 0.7 default
  numTestWindows: number;   // 3 default
  minPredictions: number;   // Minimum predictions per window
}

export class BacktestRunner {
  private candleStore: CandleStore;

  constructor(candleStore: CandleStore) {
    this.candleStore = candleStore;
    ensureDir(RUNS_DIR);
    ensureDir(path.dirname(SUMMARY_PATH));
  }

  /**
   * Run a full backtest for a strategy type on a token/resolution.
   */
  async runBacktest(config: BacktestConfig): Promise<BacktestRun> {
    const {
      token, resolution, strategyType,
      trainRatio = 0.7,
      numTestWindows = 3,
      minPredictions = 20,
    } = config;

    const run: BacktestRun = {
      id: `backtest-${Date.now()}-${strategyType}`,
      strategyId: strategyType,
      startedAt: Date.now(),
      trainPeriod: { from: 0, to: 0 },
      testPeriod: { from: 0, to: 0 },
      results: {
        directionAccuracy: 0,
        magnitudeMAE: 0,
        profitFactor: 0,
        totalPredictions: 0,
        passedValidation: false,
      },
    };

    console.log(`[Backtest] Starting ${strategyType} on ${token}/${resolution}...`);

    const allCandles = this.candleStore.getCandles(token, resolution);
    if (allCandles.length < 100) {
      console.log(`[Backtest] Not enough data for ${token}/${resolution} (${allCandles.length} candles)`);
      run.completedAt = Date.now();
      return run;
    }

    // Split into train/test
    const splitIdx = Math.floor(allCandles.length * trainRatio);
    const trainCandles = allCandles.slice(0, splitIdx);
    const testCandles = allCandles.slice(splitIdx);

    run.trainPeriod = { from: trainCandles[0].timestamp, to: trainCandles[trainCandles.length - 1].timestamp };
    run.testPeriod = { from: testCandles[0].timestamp, to: testCandles[testCandles.length - 1].timestamp };

    // Create rolling test windows
    const windowSize = Math.floor(testCandles.length / numTestWindows);
    let totalCorrect = 0;
    let totalPredictions = 0;
    let totalMAE = 0;
    let windowsPassed = 0;

    for (let w = 0; w < numTestWindows; w++) {
      const windowStart = w * windowSize;
      const windowEnd = Math.min(windowStart + windowSize, testCandles.length);
      const windowCandles = testCandles.slice(windowStart, windowEnd);

      if (windowCandles.length < minPredictions) continue;

      // Run predictions on this window
      const { correct, total, mae } = this.runWindow(
        strategyType, token, resolution, trainCandles, windowCandles,
      );

      if (total >= minPredictions) {
        const windowAccuracy = correct / total;
        totalCorrect += correct;
        totalPredictions += total;
        totalMAE += mae * total;

        // Window passes if accuracy > 0.45 (better than random 0.33)
        if (windowAccuracy > 0.45) windowsPassed++;

        console.log(`[Backtest] Window ${w + 1}/${numTestWindows}: ${(windowAccuracy * 100).toFixed(1)}% accuracy (${total} predictions)`);
      }
    }

    // Compute aggregate results
    const directionAccuracy = totalPredictions > 0 ? totalCorrect / totalPredictions : 0;
    const magnitudeMAE = totalPredictions > 0 ? totalMAE / totalPredictions : 1;

    run.results = {
      directionAccuracy,
      magnitudeMAE,
      profitFactor: directionAccuracy > 0.5 ? directionAccuracy / (1 - directionAccuracy) : 0,
      totalPredictions,
      passedValidation: windowsPassed >= Math.ceil(numTestWindows * 0.6), // 60% of windows must pass
    };

    run.completedAt = Date.now();

    // Save results
    this.saveRun(run);
    this.updateSummary(run);

    const status = run.results.passedValidation ? 'PASSED' : 'FAILED';
    console.log(`[Backtest] ${status}: ${strategyType} on ${token}/${resolution} -- ${(directionAccuracy * 100).toFixed(1)}% accuracy, ${windowsPassed}/${numTestWindows} windows passed`);

    return run;
  }

  /**
   * Run predictions on a test window using training data as context.
   */
  private runWindow(
    strategyType: string,
    token: string,
    resolution: Resolution,
    trainCandles: Candle[],
    testCandles: Candle[],
  ): { correct: number; total: number; mae: number } {
    let correct = 0;
    let total = 0;
    let totalMAE = 0;

    // Use a sliding window: feed last N train + test candles, predict next
    const lookback = 50;

    for (let i = lookback; i < testCandles.length - 1; i++) {
      const contextCandles = [
        ...trainCandles.slice(-lookback),
        ...testCandles.slice(Math.max(0, i - lookback), i),
      ];

      let prediction: Prediction | null = null;

      if (strategyType === 'statistical') {
        const predictor = new StatisticalPredictor();
        const indicators = this.computeBasicIndicators(contextCandles);
        prediction = predictor.predict(token, resolution, contextCandles, indicators);
      } else if (strategyType === 'pattern_match') {
        const matcher = new PatternMatcher();
        prediction = matcher.predict(token, resolution, contextCandles);
      }

      if (!prediction) continue;

      // Grade against actual next candle
      const actual = testCandles[i];
      const pctChange = (actual.close - prediction.currentPrice) / prediction.currentPrice;
      let actualDirection: 'up' | 'down' | 'flat' = 'flat';
      if (pctChange > 0.001) actualDirection = 'up';
      else if (pctChange < -0.001) actualDirection = 'down';

      if (prediction.predictedDirection === actualDirection) correct++;
      total++;

      const mae = Math.abs(prediction.predictedClose - actual.close) / actual.close;
      totalMAE += mae;
    }

    return { correct, total, mae: total > 0 ? totalMAE / total : 1 };
  }

  private computeBasicIndicators(candles: Candle[]): Record<string, number | undefined> {
    if (candles.length < 20) return {};
    const closes = candles.map(c => c.close);

    // Bollinger Bands for mean reversion strategy
    const period = 20;
    const slice = closes.slice(-period);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, p) => sum + (p - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);

    return {
      bollingerUpper: mean + sd * 2,
      bollingerMiddle: mean,
      bollingerLower: mean - sd * 2,
    };
  }

  /**
   * Run backtests for all strategy types across all tokens.
   */
  async runFullBacktest(tokens: string[], resolution: Resolution = '5m'): Promise<BacktestRun[]> {
    const runs: BacktestRun[] = [];

    for (const token of tokens) {
      for (const strategyType of ['statistical', 'pattern_match'] as const) {
        const run = await this.runBacktest({
          token,
          resolution,
          strategyType,
          trainRatio: 0.7,
          numTestWindows: 3,
          minPredictions: 20,
        });
        runs.push(run);
      }
    }

    return runs;
  }

  private saveRun(run: BacktestRun): void {
    const filePath = path.join(RUNS_DIR, `${run.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(run, null, 2), 'utf-8');
  }

  private updateSummary(run: BacktestRun): void {
    let summary: BacktestRun[] = [];
    try {
      if (fs.existsSync(SUMMARY_PATH)) {
        summary = JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf-8'));
      }
    } catch { /* ignore */ }

    summary.push(run);

    // Keep last 100 runs
    if (summary.length > 100) summary = summary.slice(-100);

    const tmpPath = SUMMARY_PATH + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(summary, null, 2), 'utf-8');
    fs.renameSync(tmpPath, SUMMARY_PATH);
  }
}
