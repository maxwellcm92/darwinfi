/**
 * scorer.ts - Weighted composite scoring for sources and prediction strategies
 *
 * Source metrics (5, default weights):
 *   35% Predictive score, 25% Signal-to-noise, 15% Timeliness,
 *   15% Unique value, 10% Cost efficiency
 *
 * Strategy metrics (5, default weights):
 *   30% Direction accuracy, 25% Magnitude accuracy, 20% Confidence calibration,
 *   15% Consistency, 10% Resolution fit
 */

import {
  SourceConfig, SourceFitness, PredictionStrategyConfig, StrategyFitness,
  ScoringWeights, PredictionWeights,
  DEFAULT_SOURCE_WEIGHTS, DEFAULT_PREDICTION_WEIGHTS,
} from '../types';

export class Scorer {
  private sourceWeights: ScoringWeights;
  private predictionWeights: PredictionWeights;

  constructor(sourceWeights?: ScoringWeights, predictionWeights?: PredictionWeights) {
    this.sourceWeights = sourceWeights ?? { ...DEFAULT_SOURCE_WEIGHTS };
    this.predictionWeights = predictionWeights ?? { ...DEFAULT_PREDICTION_WEIGHTS };
  }

  /**
   * Score a source and rank it against others.
   */
  scoreSource(source: SourceConfig): number {
    const f = source.fitness;
    const w = this.sourceWeights;

    return (
      f.predictiveScore * w.predictiveScore +
      f.signalToNoise * w.signalToNoise +
      f.timeliness * w.timeliness +
      f.uniqueValue * w.uniqueValue +
      f.costEfficiency * w.costEfficiency
    );
  }

  /**
   * Score a prediction strategy.
   */
  scoreStrategy(strategy: PredictionStrategyConfig): number {
    const f = strategy.fitness;
    const w = this.predictionWeights;

    // magnitudeAccuracy = 1 - MAE (lower MAE = higher score)
    const magAccuracy = Math.max(0, 1 - f.magnitudeMAE * 10);

    return (
      f.directionAccuracy * w.directionAccuracy +
      magAccuracy * w.magnitudeAccuracy +
      f.confidenceCalibration * w.confidenceCalibration +
      f.consistency * w.consistency +
      f.resolutionFit * w.resolutionFit
    );
  }

  /**
   * Rank sources by composite score (descending).
   */
  rankSources(sources: SourceConfig[]): Array<{ source: SourceConfig; score: number; rank: number }> {
    const scored = sources.map(s => ({ source: s, score: this.scoreSource(s) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.map((item, i) => ({ ...item, rank: i + 1 }));
  }

  /**
   * Rank prediction strategies by composite score (descending).
   */
  rankStrategies(strategies: PredictionStrategyConfig[]): Array<{ strategy: PredictionStrategyConfig; score: number; rank: number }> {
    const scored = strategies.map(s => ({ strategy: s, score: this.scoreStrategy(s) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.map((item, i) => ({ ...item, rank: i + 1 }));
  }

  // Weight accessors
  getSourceWeights(): ScoringWeights { return { ...this.sourceWeights }; }
  getPredictionWeights(): PredictionWeights { return { ...this.predictionWeights }; }

  setSourceWeights(weights: ScoringWeights): void {
    this.sourceWeights = { ...weights };
  }

  setPredictionWeights(weights: PredictionWeights): void {
    this.predictionWeights = { ...weights };
  }
}
