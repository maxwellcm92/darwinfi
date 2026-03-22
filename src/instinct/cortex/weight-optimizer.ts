/**
 * weight-optimizer.ts - Recursive self-improvement (depth-capped at 1)
 *
 * Every 24h:
 *   1. Measure actual performance of all strategies over last 24h
 *   2. Compute optimal weights via gradient descent on weight vector
 *   3. Conservative blend: W_new = 0.8 * W_old + 0.2 * W_optimal
 *   4. The 0.8/0.2 blend factor is FIXED (recursion firewall)
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  ScoringWeights, PredictionWeights, WeightChange,
  SourceConfig, PredictionStrategyConfig,
  DEFAULT_SOURCE_WEIGHTS, DEFAULT_PREDICTION_WEIGHTS,
} from '../types';
import { Scorer } from './scorer';

const CORTEX_DIR = path.resolve(process.cwd(), 'data/instinct/cortex');
const SOURCE_WEIGHTS_PATH = path.join(CORTEX_DIR, 'source-weights.json');
const PREDICTION_WEIGHTS_PATH = path.join(CORTEX_DIR, 'prediction-weights.json');
const WEIGHT_HISTORY_PATH = path.join(CORTEX_DIR, 'weight-history.jsonl');

const BLEND_FACTOR = 0.2;     // Fixed recursion firewall
const LEARNING_RATE = 0.01;
const GRADIENT_STEPS = 100;

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export class WeightOptimizer {
  private scorer: Scorer;

  constructor(scorer: Scorer) {
    this.scorer = scorer;
    ensureDir(CORTEX_DIR);
    this.loadWeights();
  }

  /**
   * Optimize source weights based on actual prediction performance.
   * The "actual rank" is determined by which sources produced events
   * that preceded correct predictions.
   */
  optimizeSourceWeights(
    sources: SourceConfig[],
    actualPerformanceRanking: string[], // Source IDs in order of actual performance
    rankingMethod: string = 'prediction-accuracy-ranked',
  ): ScoringWeights {
    const currentWeights = this.scorer.getSourceWeights();
    if (sources.length < 2 || actualPerformanceRanking.length < 2) return currentWeights;

    // Gradient descent to find weights that best match the actual ranking
    const optimal = this.gradientDescentSource(sources, actualPerformanceRanking);

    // Conservative blend
    const raw = this.blendWeights(
      currentWeights as unknown as Record<string, number>,
      optimal as unknown as Record<string, number>,
      BLEND_FACTOR,
    );

    // Normalize to sum to 1
    const sum = Object.values(raw).reduce((s, v) => s + v, 0);
    const blended: ScoringWeights = {
      predictiveScore: (raw.predictiveScore ?? currentWeights.predictiveScore) / sum,
      signalToNoise: (raw.signalToNoise ?? currentWeights.signalToNoise) / sum,
      timeliness: (raw.timeliness ?? currentWeights.timeliness) / sum,
      uniqueValue: (raw.uniqueValue ?? currentWeights.uniqueValue) / sum,
      costEfficiency: (raw.costEfficiency ?? currentWeights.costEfficiency) / sum,
    };

    // Log the change
    this.logWeightChange({
      timestamp: Date.now(),
      type: 'source',
      oldWeights: currentWeights,
      newWeights: blended,
      optimalWeights: optimal,
      blendFactor: BLEND_FACTOR,
      reason: `24h optimization: ${actualPerformanceRanking.length} sources ${rankingMethod}`,
    });

    this.scorer.setSourceWeights(blended);
    this.saveWeights();

    return blended;
  }

  /**
   * Optimize prediction strategy weights.
   */
  optimizePredictionWeights(
    strategies: PredictionStrategyConfig[],
    actualPerformanceRanking: string[],
    rankingMethod: string = 'accuracy-ranked',
  ): PredictionWeights {
    const currentWeights = this.scorer.getPredictionWeights();
    if (strategies.length < 2 || actualPerformanceRanking.length < 2) return currentWeights;

    const optimal = this.gradientDescentPrediction(strategies, actualPerformanceRanking);
    const raw = this.blendWeights(
      currentWeights as unknown as Record<string, number>,
      optimal as unknown as Record<string, number>,
      BLEND_FACTOR,
    );

    const sum = Object.values(raw).reduce((s, v) => s + v, 0);
    const blended: PredictionWeights = {
      directionAccuracy: (raw.directionAccuracy ?? currentWeights.directionAccuracy) / sum,
      magnitudeAccuracy: (raw.magnitudeAccuracy ?? currentWeights.magnitudeAccuracy) / sum,
      confidenceCalibration: (raw.confidenceCalibration ?? currentWeights.confidenceCalibration) / sum,
      consistency: (raw.consistency ?? currentWeights.consistency) / sum,
      resolutionFit: (raw.resolutionFit ?? currentWeights.resolutionFit) / sum,
    };

    this.logWeightChange({
      timestamp: Date.now(),
      type: 'prediction',
      oldWeights: currentWeights,
      newWeights: blended,
      optimalWeights: optimal,
      blendFactor: BLEND_FACTOR,
      reason: `24h optimization: ${actualPerformanceRanking.length} strategies ${rankingMethod}`,
    });

    this.scorer.setPredictionWeights(blended);
    this.saveWeights();

    return blended;
  }

  /**
   * Compute the total weight shift between current and new weights.
   * Used to detect if market character has changed (>20% shift).
   */
  computeWeightShift(oldWeights: Record<string, number>, newWeights: Record<string, number>): number {
    let totalShift = 0;
    for (const key of Object.keys(oldWeights)) {
      totalShift += Math.abs((newWeights[key] ?? 0) - (oldWeights[key] ?? 0));
    }
    return totalShift / 2; // Normalize: 0 = identical, 1 = completely different
  }

  // -------------------------------------------------------------------
  // Gradient descent
  // -------------------------------------------------------------------

  private gradientDescentSource(
    sources: SourceConfig[],
    targetRanking: string[],
  ): ScoringWeights {
    // Start from current weights
    const weights = { ...this.scorer.getSourceWeights() };
    const keys = Object.keys(weights) as (keyof ScoringWeights)[];

    for (let step = 0; step < GRADIENT_STEPS; step++) {
      for (const key of keys) {
        // Compute ranking loss with current weights
        const lossBase = this.rankingLossSource(sources, weights, targetRanking);

        // Perturb weight up
        const perturbed = { ...weights };
        perturbed[key] += 0.01;
        const lossUp = this.rankingLossSource(sources, perturbed, targetRanking);

        // Gradient: how much does loss change when we increase this weight?
        const gradient = (lossUp - lossBase) / 0.01;

        // Update weight (descend)
        weights[key] = Math.max(0.01, weights[key] - LEARNING_RATE * gradient);
      }
    }

    return weights;
  }

  private gradientDescentPrediction(
    strategies: PredictionStrategyConfig[],
    targetRanking: string[],
  ): PredictionWeights {
    const weights = { ...this.scorer.getPredictionWeights() };
    const keys = Object.keys(weights) as (keyof PredictionWeights)[];

    for (let step = 0; step < GRADIENT_STEPS; step++) {
      for (const key of keys) {
        const lossBase = this.rankingLossPrediction(strategies, weights, targetRanking);
        const perturbed = { ...weights };
        perturbed[key] += 0.01;
        const lossUp = this.rankingLossPrediction(strategies, perturbed, targetRanking);
        const gradient = (lossUp - lossBase) / 0.01;
        weights[key] = Math.max(0.01, weights[key] - LEARNING_RATE * gradient);
      }
    }

    return weights;
  }

  /**
   * Compute Kendall's tau-like ranking loss.
   * Returns 0 for perfect agreement, 1 for complete disagreement.
   */
  private rankingLossSource(
    sources: SourceConfig[],
    weights: ScoringWeights,
    targetRanking: string[],
  ): number {
    const tempScorer = new Scorer(weights);
    const ranked = tempScorer.rankSources(sources);
    const predictedOrder = ranked.map(r => r.source.id);
    return this.kendallTauDistance(predictedOrder, targetRanking);
  }

  private rankingLossPrediction(
    strategies: PredictionStrategyConfig[],
    weights: PredictionWeights,
    targetRanking: string[],
  ): number {
    const tempScorer = new Scorer(undefined, weights);
    const ranked = tempScorer.rankStrategies(strategies);
    const predictedOrder = ranked.map(r => r.strategy.id);
    return this.kendallTauDistance(predictedOrder, targetRanking);
  }

  private kendallTauDistance(a: string[], b: string[]): number {
    // Count inversions between two rankings
    const bIndex = new Map(b.map((id, i) => [id, i]));
    let inversions = 0;
    let pairs = 0;

    for (let i = 0; i < a.length; i++) {
      for (let j = i + 1; j < a.length; j++) {
        const ai = bIndex.get(a[i]);
        const aj = bIndex.get(a[j]);
        if (ai === undefined || aj === undefined) continue;
        pairs++;
        if (ai > aj) inversions++;
      }
    }

    return pairs > 0 ? inversions / pairs : 0;
  }

  // -------------------------------------------------------------------
  // Weight blending
  // -------------------------------------------------------------------

  private blendWeights(
    current: Record<string, number>,
    optimal: Record<string, number>,
    factor: number,
  ): Record<string, number> {
    const result: Record<string, number> = {};
    for (const key of Object.keys(current)) {
      result[key] = current[key] * (1 - factor) + (optimal[key] ?? current[key]) * factor;
    }
    return result;
  }

  // -------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------

  private loadWeights(): void {
    try {
      if (fs.existsSync(SOURCE_WEIGHTS_PATH)) {
        const data = JSON.parse(fs.readFileSync(SOURCE_WEIGHTS_PATH, 'utf-8'));
        this.scorer.setSourceWeights(data);
      }
      if (fs.existsSync(PREDICTION_WEIGHTS_PATH)) {
        const data = JSON.parse(fs.readFileSync(PREDICTION_WEIGHTS_PATH, 'utf-8'));
        this.scorer.setPredictionWeights(data);
      }
    } catch (err) {
      console.error('[Cortex] Failed to load weights:', (err as Error).message);
    }
  }

  private saveWeights(): void {
    ensureDir(CORTEX_DIR);

    const tmpS = SOURCE_WEIGHTS_PATH + '.tmp';
    fs.writeFileSync(tmpS, JSON.stringify(this.scorer.getSourceWeights(), null, 2), 'utf-8');
    fs.renameSync(tmpS, SOURCE_WEIGHTS_PATH);

    const tmpP = PREDICTION_WEIGHTS_PATH + '.tmp';
    fs.writeFileSync(tmpP, JSON.stringify(this.scorer.getPredictionWeights(), null, 2), 'utf-8');
    fs.renameSync(tmpP, PREDICTION_WEIGHTS_PATH);
  }

  private logWeightChange(change: WeightChange): void {
    ensureDir(CORTEX_DIR);
    fs.appendFileSync(WEIGHT_HISTORY_PATH, JSON.stringify(change) + '\n', 'utf-8');
  }

  /**
   * Get recent weight changes for audit.
   */
  getWeightHistory(limit: number = 20): WeightChange[] {
    if (!fs.existsSync(WEIGHT_HISTORY_PATH)) return [];

    const lines = fs.readFileSync(WEIGHT_HISTORY_PATH, 'utf-8').trim().split('\n');
    const startIdx = Math.max(0, lines.length - limit);
    const history: WeightChange[] = [];

    for (let i = startIdx; i < lines.length; i++) {
      if (!lines[i]) continue;
      try { history.push(JSON.parse(lines[i])); } catch { /* skip */ }
    }

    return history;
  }
}
