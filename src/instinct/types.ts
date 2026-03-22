/**
 * types.ts - Shared interfaces for the DarwinFi Instinct prediction layer
 *
 * All departments (Senses, Reflexes, Cortex, Nerves, Marrow) share these types.
 */

// -------------------------------------------------------------------
// Resolution & Direction
// -------------------------------------------------------------------

export type Resolution = '1m' | '5m' | '15m' | '1h';
export type Direction = 'up' | 'down' | 'flat';
export type SourceType = 'grok_x' | 'rss' | 'onchain' | 'formula';
export type SourceStatus = 'active' | 'probation' | 'demoted' | 'retired';
export type StrategyType = 'ai_reasoning' | 'statistical' | 'pattern_match' | 'hybrid';

// -------------------------------------------------------------------
// Candlestick Data
// -------------------------------------------------------------------

export interface Candle {
  timestamp: number;      // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandleStore {
  append(token: string, resolution: Resolution, candles: Candle[]): void;
  getCandles(token: string, resolution: Resolution, fromTs?: number, toTs?: number): Candle[];
  getLatest(token: string, resolution: Resolution, count: number): Candle[];
}

// -------------------------------------------------------------------
// SENSES: World Events
// -------------------------------------------------------------------

export interface WorldEvent {
  id: string;                         // UUID
  sourceId: string;                   // Which source produced this
  timestamp: number;                  // Unix ms
  category: 'sentiment' | 'whale' | 'volume' | 'news' | 'correlation' | 'gas' | 'social';
  tokens: string[];                   // Affected token symbols
  sentiment: number;                  // -1 to +1
  magnitude: number;                  // 0-100 (impact estimate)
  title: string;                      // Short description
  details: string;                    // Full event text
  metadata?: Record<string, unknown>;
}

export interface SourceConfig {
  id: string;
  name: string;
  type: SourceType;
  status: SourceStatus;
  collectionIntervalMs: number;       // How often to poll
  fitness: SourceFitness;
  consecutiveLowScores: number;       // For survival mechanism
  lastCollectionAt: number;
  eventsProduced: number;
  config?: Record<string, unknown>;   // Source-specific config
}

export interface SourceFitness {
  predictiveScore: number;            // 0-1: correct direction events / total
  signalToNoise: number;              // 0-1: impactful events / total
  timeliness: number;                 // 0-1: how early before price move
  uniqueValue: number;                // 0-1: info not in other sources
  costEfficiency: number;             // 0-1: value per dollar
  compositeScore: number;             // Weighted aggregate
  lastEvaluatedAt: number;            // Unix ms
  evaluationCount: number;
}

// -------------------------------------------------------------------
// REFLEXES: Predictions
// -------------------------------------------------------------------

export interface Prediction {
  id: string;                         // UUID
  strategyId: string;
  timestamp: number;                  // When prediction was made (Unix ms)
  token: string;
  resolution: Resolution;
  predictedDirection: Direction;
  predictedClose: number;
  predictedHigh: number;
  predictedLow: number;
  confidence: number;                 // 0-100
  currentPrice: number;
  eventIds: string[];                 // Events that influenced this
  actual?: {
    close: number;
    high: number;
    low: number;
    directionCorrect: boolean;
    closeErrorPct: number;            // |predicted - actual| / actual * 100
  };
  gradedAt?: number;                  // When graded (Unix ms)
}

export interface PredictionStrategyConfig {
  id: string;
  name: string;
  type: StrategyType;
  status: 'active' | 'probation' | 'retired';
  resolutions: Resolution[];          // Which timeframes it runs on
  tokens: string[];                   // Which tokens it predicts
  fitness: StrategyFitness;
  parameters: Record<string, unknown>; // Strategy-specific params
  lastPredictionAt: number;
  totalPredictions: number;
}

export interface StrategyFitness {
  directionAccuracy: number;          // 0-1
  magnitudeMAE: number;               // Mean absolute error as fraction of candle range
  confidenceCalibration: number;      // 0-1: how well confidence correlates with accuracy
  consistency: number;                // Sharpe ratio of accuracy over time
  resolutionFit: number;             // Accuracy at claimed timeframe
  compositeScore: number;
  lastEvaluatedAt: number;
  evaluationCount: number;
}

// -------------------------------------------------------------------
// CORTEX: Scoring Weights
// -------------------------------------------------------------------

export interface ScoringWeights {
  predictiveScore: number;
  signalToNoise: number;
  timeliness: number;
  uniqueValue: number;
  costEfficiency: number;
}

export interface PredictionWeights {
  directionAccuracy: number;
  magnitudeAccuracy: number;
  confidenceCalibration: number;
  consistency: number;
  resolutionFit: number;
}

export interface WeightChange {
  timestamp: number;
  type: 'source' | 'prediction';
  oldWeights: ScoringWeights | PredictionWeights;
  newWeights: ScoringWeights | PredictionWeights;
  optimalWeights: ScoringWeights | PredictionWeights;
  blendFactor: number;               // Always 0.2 (recursion firewall)
  reason: string;
}

// -------------------------------------------------------------------
// NERVES: Bot Integration State
// -------------------------------------------------------------------

export interface PredictionSummary {
  direction: Direction;
  predictedClose: number;
  confidence: number;
  strategyId: string;
  strategyType: StrategyType;
  timestamp: number;
}

export interface TokenInstinct {
  predictions: Partial<Record<Resolution, PredictionSummary>>;
  sentiment: {
    score: number;                    // -1 to +1
    confidence: number;               // 0-100
    topEvents: string[];              // Event titles
  };
  keyLevels: {
    support: number[];
    resistance: number[];
  };
}

export interface InstinctHealth {
  sensesActive: number;
  reflexesActive: number;
  overallConfidence: number;          // 0-100
  lastUpdateAt: number;
  uptimeMs: number;
}

export interface InstinctState {
  generatedAt: number;                // Unix ms
  tokens: Record<string, TokenInstinct>;
  health: InstinctHealth;
  accuracy?: {
    overall: number;                  // 0-1
    totalPredictions: number;
    perResolution: Record<string, { accuracy: number; predictions: number }>;
  };
}

// -------------------------------------------------------------------
// MARROW: Pattern Detection
// -------------------------------------------------------------------

export interface DetectedPattern {
  id: string;
  type: 'repeated_prompt' | 'sequential_steps' | 'batch_opportunity';
  description: string;
  occurrences: number;
  firstSeenAt: number;
  lastSeenAt: number;
  estimatedSavings: string;           // Description of savings
  automated: boolean;                 // Has it been turned into a workflow?
  workflowId?: string;               // n8n workflow ID if automated
}

// -------------------------------------------------------------------
// Adaptive Evolution
// -------------------------------------------------------------------

export interface EvolutionTrigger {
  type: 'timer' | 'accuracy_emergency' | 'weight_shift';
  triggeredAt: number;
  reason: string;
  metrics: Record<string, number>;
}

export interface AdaptiveConfig {
  baseIntervalMs: number;             // 4h default (14_400_000)
  currentIntervalMs: number;          // Adjusted based on accuracy
  minIntervalMs: number;              // Floor: 1h
  maxIntervalMs: number;              // Ceiling: 8h
  accuracyHighThreshold: number;      // 0.70
  accuracyLowThreshold: number;       // 0.40
  emergencyThreshold: number;         // 0.30 (rolling 1h)
  weightShiftThreshold: number;       // 0.20
}

// -------------------------------------------------------------------
// Backtest
// -------------------------------------------------------------------

export interface BacktestRun {
  id: string;
  strategyId: string;
  startedAt: number;
  completedAt?: number;
  trainPeriod: { from: number; to: number };
  testPeriod: { from: number; to: number };
  results: {
    directionAccuracy: number;
    magnitudeMAE: number;
    profitFactor: number;
    totalPredictions: number;
    passedValidation: boolean;
  };
}

// -------------------------------------------------------------------
// Instinct Agent Config
// -------------------------------------------------------------------

export interface InstinctConfig {
  tokens: string[];                   // Token symbols to track
  resolutions: Resolution[];
  senses: {
    evaluationIntervalMs: number;     // 4h
    sources: SourceConfig[];
  };
  reflexes: {
    strategies: PredictionStrategyConfig[];
  };
  cortex: {
    sourceWeights: ScoringWeights;
    predictionWeights: PredictionWeights;
    optimizationIntervalMs: number;   // 24h
  };
  nerves: {
    writeIntervalMs: number;          // 30s
    statePath: string;
  };
  evolution: AdaptiveConfig;
}

// -------------------------------------------------------------------
// Grading Report (for GradingDepartment consumption)
// -------------------------------------------------------------------

export interface InstinctGradingReport {
  overallAccuracy: number;            // 0-1 rolling accuracy
  totalPredictions: number;           // total graded predictions
  perToken: Record<string, {
    accuracy: number;
    predictions: number;
  }>;
  perResolution: Record<string, {
    accuracy: number;
    predictions: number;
  }>;
  activeSources: number;
  activeStrategies: number;
  uptimeMs: number;
  generatedAt: number;                // Unix ms
}

// -------------------------------------------------------------------
// Utility: default configs
// -------------------------------------------------------------------

export const DEFAULT_SOURCE_WEIGHTS: ScoringWeights = {
  predictiveScore: 0.35,
  signalToNoise: 0.25,
  timeliness: 0.15,
  uniqueValue: 0.15,
  costEfficiency: 0.10,
};

export const DEFAULT_PREDICTION_WEIGHTS: PredictionWeights = {
  directionAccuracy: 0.30,
  magnitudeAccuracy: 0.25,
  confidenceCalibration: 0.20,
  consistency: 0.15,
  resolutionFit: 0.10,
};

export const DEFAULT_ADAPTIVE_CONFIG: AdaptiveConfig = {
  baseIntervalMs: 4 * 60 * 60 * 1000,    // 4h
  currentIntervalMs: 4 * 60 * 60 * 1000,
  minIntervalMs: 60 * 60 * 1000,          // 1h
  maxIntervalMs: 8 * 60 * 60 * 1000,      // 8h
  accuracyHighThreshold: 0.70,
  accuracyLowThreshold: 0.40,
  emergencyThreshold: 0.30,
  weightShiftThreshold: 0.20,
};

export const RESOLUTION_MS: Record<Resolution, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
};
