/**
 * prediction-engine.ts - Multi-resolution prediction orchestrator
 *
 * Coordinates all prediction strategies across 1m/5m/15m/1h resolutions.
 * Stores predictions in JSONL files and triggers grading after candle close.
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  Prediction, Resolution, PredictionStrategyConfig, Candle,
  WorldEvent, RESOLUTION_MS,
} from '../types';
import { CandleStore } from '../data/candle-store';
import { EventStore } from '../data/event-store';
import { AIPredictor } from './ai-predictor';
import { StatisticalPredictor } from './statistical-predictor';
import { PatternMatcher } from './pattern-matcher';
import { GradingEngine } from './grading-engine';
import { ALL_TOKENS } from '../data/pool-registry';

const PREDICTIONS_DIR = path.resolve(__dirname, '../../../data/instinct/reflexes/predictions');
const STRATEGIES_PATH = path.resolve(__dirname, '../../../data/instinct/reflexes/strategies.json');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function dateKey(timestampMs: number): string {
  return new Date(timestampMs).toISOString().split('T')[0];
}

export class PredictionEngine {
  private strategies: Map<string, PredictionStrategyConfig> = new Map();
  private aiPredictor: AIPredictor;
  private statPredictor: StatisticalPredictor;
  private patternMatcher: PatternMatcher;
  private gradingEngine: GradingEngine;
  private candleStore: CandleStore;
  private eventStore: EventStore;
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private tokens: string[];

  constructor(
    candleStore: CandleStore,
    eventStore: EventStore,
    veniceApiKey: string,
    tokens?: string[],
  ) {
    this.candleStore = candleStore;
    this.eventStore = eventStore;
    this.tokens = tokens ?? ALL_TOKENS;
    this.aiPredictor = new AIPredictor({ veniceApiKey });
    this.statPredictor = new StatisticalPredictor();
    this.patternMatcher = new PatternMatcher();
    this.gradingEngine = new GradingEngine(candleStore);

    this.loadStrategies();
    ensureDir(PREDICTIONS_DIR);
  }

  /**
   * Start prediction loops for all resolutions.
   */
  start(): void {
    console.log('[Reflexes] Starting prediction engine...');

    // 1m predictions every 60s
    this.startLoop('1m', 60_000);
    // 5m predictions every 5 min
    this.startLoop('5m', 300_000);
    // 15m predictions every 15 min
    this.startLoop('15m', 900_000);
    // 1h predictions every 1h
    this.startLoop('1h', 3_600_000);
  }

  stop(): void {
    for (const [key, timer] of this.timers) {
      clearInterval(timer);
    }
    this.timers.clear();
    console.log('[Reflexes] Prediction engine stopped');
  }

  /**
   * Run a single prediction cycle for a resolution.
   */
  async runPredictionCycle(resolution: Resolution): Promise<Prediction[]> {
    const predictions: Prediction[] = [];

    for (const token of this.tokens) {
      const candles = this.candleStore.getLatest(token, resolution, 50);
      if (candles.length < 5) continue;

      const events = this.eventStore.getRecentEvents(60, token);
      const indicators = this.computeBasicIndicators(candles);

      // Run each active strategy
      for (const strategy of this.getActiveStrategies(resolution)) {
        try {
          const prediction = await this.runStrategy(
            strategy, token, resolution, candles, events, indicators,
          );
          if (prediction) {
            this.storePrediction(prediction);
            predictions.push(prediction);
          }
        } catch (err) {
          console.error(`[Reflexes] ${strategy.id} error for ${token}/${resolution}:`, (err as Error).message);
        }
      }
    }

    // Grade expired predictions
    await this.gradeExpiredPredictions(resolution);

    console.log(`[Reflexes] ${resolution} cycle: ${predictions.length} predictions for ${this.tokens.length} tokens`);
    return predictions;
  }

  /**
   * Run a specific strategy to produce a prediction.
   */
  private async runStrategy(
    strategy: PredictionStrategyConfig,
    token: string,
    resolution: Resolution,
    candles: Candle[],
    events: WorldEvent[],
    indicators: Record<string, number | undefined>,
  ): Promise<Prediction | null> {
    switch (strategy.type) {
      case 'ai_reasoning':
        return this.aiPredictor.predict(token, resolution, candles, events, indicators);

      case 'statistical':
        return this.statPredictor.predict(token, resolution, candles, indicators);

      case 'pattern_match':
        return this.patternMatcher.predict(token, resolution, candles);

      case 'hybrid': {
        // Ensemble: run all and take weighted average
        const [ai, stat, pattern] = await Promise.all([
          this.aiPredictor.predict(token, resolution, candles, events, indicators),
          this.statPredictor.predict(token, resolution, candles, indicators),
          this.patternMatcher.predict(token, resolution, candles),
        ]);

        return this.ensemblePredictions(token, resolution, [ai, stat, pattern].filter(Boolean) as Prediction[]);
      }

      default:
        return null;
    }
  }

  /**
   * Combine multiple predictions into an ensemble prediction.
   */
  private ensemblePredictions(token: string, resolution: Resolution, predictions: Prediction[]): Prediction | null {
    if (predictions.length === 0) return null;

    // Weighted average by confidence
    let totalWeight = 0;
    let weightedClose = 0;
    let weightedHigh = 0;
    let weightedLow = 0;
    let directions = { up: 0, down: 0, flat: 0 };

    for (const p of predictions) {
      const w = p.confidence / 100;
      totalWeight += w;
      weightedClose += p.predictedClose * w;
      weightedHigh += p.predictedHigh * w;
      weightedLow += p.predictedLow * w;
      directions[p.predictedDirection] += w;
    }

    if (totalWeight === 0) return null;

    const direction = (Object.entries(directions) as [string, number][])
      .sort((a, b) => b[1] - a[1])[0][0] as 'up' | 'down' | 'flat';

    return {
      id: randomUUID(),
      strategyId: 'hybrid_ensemble',
      timestamp: Date.now(),
      token,
      resolution,
      predictedDirection: direction,
      predictedClose: weightedClose / totalWeight,
      predictedHigh: weightedHigh / totalWeight,
      predictedLow: weightedLow / totalWeight,
      confidence: Math.round(predictions.reduce((s, p) => s + p.confidence, 0) / predictions.length),
      currentPrice: predictions[0].currentPrice,
      eventIds: [...new Set(predictions.flatMap(p => p.eventIds))],
    };
  }

  /**
   * Grade predictions whose candle has now closed.
   */
  private async gradeExpiredPredictions(resolution: Resolution): Promise<void> {
    const now = Date.now();
    const periodMs = RESOLUTION_MS[resolution];

    for (const token of this.tokens) {
      const ungraded = this.getUngradedPredictions(token, resolution, 50);

      for (const prediction of ungraded) {
        // Check if the predicted candle has closed
        const candleCloseTime = prediction.timestamp + periodMs;
        if (now < candleCloseTime + 5000) continue; // Wait 5s buffer

        const graded = this.gradingEngine.grade(prediction, token, resolution);
        if (graded) {
          this.updatePrediction(graded);
          this.updateStrategyFitness(graded);
        }
      }
    }
  }

  /**
   * Get recent ungraded predictions from storage.
   */
  private getUngradedPredictions(token: string, resolution: Resolution, limit: number): Prediction[] {
    const today = dateKey(Date.now());
    const yesterday = dateKey(Date.now() - 86_400_000);
    const predictions: Prediction[] = [];

    for (const date of [yesterday, today]) {
      const filePath = this.getPredictionFilePath(token, resolution, date);
      if (!fs.existsSync(filePath)) continue;

      const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
      for (const line of lines) {
        if (!line) continue;
        try {
          const pred: Prediction = JSON.parse(line);
          if (!pred.actual) predictions.push(pred);
        } catch { /* skip */ }
      }
    }

    return predictions.slice(-limit);
  }

  /**
   * Store a prediction to JSONL.
   */
  private storePrediction(prediction: Prediction): void {
    const date = dateKey(prediction.timestamp);
    const filePath = this.getPredictionFilePath(prediction.token, prediction.resolution, date);
    ensureDir(path.dirname(filePath));
    fs.appendFileSync(filePath, JSON.stringify(prediction) + '\n', 'utf-8');
  }

  /**
   * Update a prediction in storage (for grading).
   */
  private updatePrediction(prediction: Prediction): void {
    const date = dateKey(prediction.timestamp);
    const filePath = this.getPredictionFilePath(prediction.token, prediction.resolution, date);
    if (!fs.existsSync(filePath)) return;

    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    const updated = lines.map(line => {
      if (!line) return line;
      try {
        const p: Prediction = JSON.parse(line);
        if (p.id === prediction.id) return JSON.stringify(prediction);
        return line;
      } catch {
        return line;
      }
    });

    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, updated.join('\n') + '\n', 'utf-8');
    fs.renameSync(tmpPath, filePath);
  }

  /**
   * Update strategy fitness after grading.
   */
  private updateStrategyFitness(prediction: Prediction): void {
    const strategy = this.strategies.get(prediction.strategyId);
    if (!strategy || !prediction.actual) return;

    const fitness = strategy.fitness;
    const n = fitness.evaluationCount + 1;
    const alpha = Math.min(0.1, 1 / n); // Exponential moving average

    // Update direction accuracy
    const correct = prediction.actual.directionCorrect ? 1 : 0;
    fitness.directionAccuracy = fitness.directionAccuracy * (1 - alpha) + correct * alpha;

    // Update magnitude MAE
    const mae = prediction.actual.closeErrorPct / 100;
    fitness.magnitudeMAE = fitness.magnitudeMAE * (1 - alpha) + mae * alpha;

    // Update confidence calibration (how well confidence predicts accuracy)
    const confBucket = Math.round(prediction.confidence / 10);
    const calibration = Math.abs(prediction.confidence / 100 - (correct ? 1 : 0));
    fitness.confidenceCalibration = fitness.confidenceCalibration * (1 - alpha) + (1 - calibration) * alpha;

    // Composite
    fitness.compositeScore =
      fitness.directionAccuracy * 0.30 +
      (1 - Math.min(1, fitness.magnitudeMAE * 10)) * 0.25 +
      fitness.confidenceCalibration * 0.20 +
      fitness.consistency * 0.15 +
      fitness.resolutionFit * 0.10;

    fitness.evaluationCount = n;
    fitness.lastEvaluatedAt = Date.now();
    strategy.totalPredictions++;

    this.saveStrategies();
  }

  private getPredictionFilePath(token: string, resolution: Resolution, date: string): string {
    return path.join(PREDICTIONS_DIR, token, resolution, `${date}.jsonl`);
  }

  getActiveStrategies(resolution?: Resolution): PredictionStrategyConfig[] {
    return Array.from(this.strategies.values()).filter(s => {
      if (s.status !== 'active') return false;
      if (resolution && !s.resolutions.includes(resolution)) return false;
      return true;
    });
  }

  getAllStrategies(): PredictionStrategyConfig[] {
    return Array.from(this.strategies.values());
  }

  /**
   * Get recent predictions for a token/resolution.
   */
  getRecentPredictions(token: string, resolution: Resolution, count: number = 20): Prediction[] {
    const today = dateKey(Date.now());
    const filePath = this.getPredictionFilePath(token, resolution, today);
    if (!fs.existsSync(filePath)) return [];

    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    const predictions: Prediction[] = [];
    const startIdx = Math.max(0, lines.length - count);

    for (let i = startIdx; i < lines.length; i++) {
      if (!lines[i]) continue;
      try { predictions.push(JSON.parse(lines[i])); } catch { /* skip */ }
    }

    return predictions;
  }

  /**
   * Compute basic indicators from candle data (reuses existing pattern).
   */
  private computeBasicIndicators(candles: Candle[]): Record<string, number | undefined> {
    if (candles.length < 20) return {};

    const closes = candles.map(c => c.close);

    // Simple RSI-14
    const rsi = this.computeRSI(closes, 14);

    // EMA-9 and EMA-21
    const ema9 = this.computeEMA(closes, 9);
    const ema21 = this.computeEMA(closes, 21);

    // Bollinger Bands (20,2)
    const bb = this.computeBollingerBands(closes, 20, 2);

    return {
      rsi,
      ema9,
      ema21,
      bollingerUpper: bb?.upper,
      bollingerLower: bb?.lower,
      bollingerMiddle: bb?.middle,
    };
  }

  private computeRSI(prices: number[], period: number): number | undefined {
    if (prices.length < period + 1) return undefined;
    let gainSum = 0, lossSum = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gainSum += change;
      else lossSum -= change;
    }
    const avgGain = gainSum / period;
    const avgLoss = lossSum / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  private computeEMA(prices: number[], period: number): number | undefined {
    if (prices.length < period) return undefined;
    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }
    return ema;
  }

  private computeBollingerBands(prices: number[], period: number, stdDev: number) {
    if (prices.length < period) return undefined;
    const slice = prices.slice(-period);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, p) => sum + (p - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    return { upper: mean + sd * stdDev, middle: mean, lower: mean - sd * stdDev };
  }

  private startLoop(resolution: Resolution, intervalMs: number): void {
    const key = `prediction_${resolution}`;
    if (this.timers.has(key)) return;

    // Initial run after short delay
    setTimeout(() => {
      this.runPredictionCycle(resolution).catch(err =>
        console.error(`[Reflexes] ${resolution} error:`, (err as Error).message)
      );
    }, Math.random() * 10_000); // Stagger starts

    const timer = setInterval(async () => {
      try {
        await this.runPredictionCycle(resolution);
      } catch (err) {
        console.error(`[Reflexes] ${resolution} error:`, (err as Error).message);
      }
    }, intervalMs);

    this.timers.set(key, timer);
  }

  // -------------------------------------------------------------------
  // Strategy persistence
  // -------------------------------------------------------------------

  addStrategy(config: PredictionStrategyConfig): void {
    this.strategies.set(config.id, config);
    this.saveStrategies();
  }

  private loadStrategies(): void {
    try {
      if (fs.existsSync(STRATEGIES_PATH)) {
        const data = JSON.parse(fs.readFileSync(STRATEGIES_PATH, 'utf-8'));
        for (const s of data) this.strategies.set(s.id, s);
        console.log(`[Reflexes] Loaded ${this.strategies.size} strategies`);
        return;
      }
    } catch (err) {
      console.error('[Reflexes] Failed to load strategies:', (err as Error).message);
    }

    // Initialize with default strategies
    for (const s of AIPredictor.defaultConfigs()) {
      this.strategies.set(s.id, s);
    }
    for (const s of StatisticalPredictor.defaultConfigs()) {
      this.strategies.set(s.id, s);
    }
    for (const s of PatternMatcher.defaultConfigs()) {
      this.strategies.set(s.id, s);
    }
    // Hybrid ensemble
    this.strategies.set('hybrid_ensemble', {
      id: 'hybrid_ensemble',
      name: 'Hybrid Ensemble',
      type: 'hybrid',
      status: 'active',
      resolutions: ['5m', '15m', '1h'],
      tokens: [],
      fitness: {
        directionAccuracy: 0.5, magnitudeMAE: 0.5, confidenceCalibration: 0.5,
        consistency: 0.5, resolutionFit: 0.5, compositeScore: 0.5,
        lastEvaluatedAt: 0, evaluationCount: 0,
      },
      parameters: {},
      lastPredictionAt: 0,
      totalPredictions: 0,
    });

    this.saveStrategies();
  }

  private saveStrategies(): void {
    const dir = path.dirname(STRATEGIES_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmpPath = STRATEGIES_PATH + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(Array.from(this.strategies.values()), null, 2), 'utf-8');
    fs.renameSync(tmpPath, STRATEGIES_PATH);
  }
}
