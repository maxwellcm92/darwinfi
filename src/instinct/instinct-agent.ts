/**
 * instinct-agent.ts - Main Instinct Orchestrator
 *
 * PM2 entry point for `darwinfi-instinct` process.
 * Ties together all 5 departments with internal timers:
 *
 *   SENSES:   Collect events on source-specific intervals (5-15 min)
 *   REFLEXES:  Generate predictions on resolution intervals (1m/5m/15m/1h)
 *   CORTEX:   Optimize scoring weights every 24h
 *   NERVES:   Write predictions-live.json every 30s
 *   MARROW:   Detect patterns every 4h (during evolution tick)
 *
 * Adaptive evolution: 3 independent triggers
 *   1. Adaptive timer (base 4h, adjusted by accuracy)
 *   2. Accuracy emergency (rolling 1h < 30%)
 *   3. Weight shift > 20% (market character change)
 *
 * Usage:
 *   ts-node src/instinct/instinct-agent.ts
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { CandleStore } from './data/candle-store';
import { EventStore } from './data/event-store';
import { SourceManager } from './senses/source-manager';
import { GrokSource } from './senses/grok-source';
import { RssSource } from './senses/rss-source';
import { OnChainSource } from './senses/onchain-source';
import { PredictionEngine } from './reflexes/prediction-engine';
import { Scorer } from './cortex/scorer';
import { WeightOptimizer } from './cortex/weight-optimizer';
import { StateWriter } from './nerves/state-writer';
import { PatternDetector } from './marrow/pattern-detector';
import { WorkflowGenerator } from './marrow/workflow-generator';
import { BacktestRunner } from './backtest/backtest-runner';
import { AdaptiveConfig, DEFAULT_ADAPTIVE_CONFIG, InstinctGradingReport } from './types';
import { ALL_TOKENS } from './data/pool-registry';

// -------------------------------------------------------------------
// Configuration
// -------------------------------------------------------------------

interface InstinctAgentConfig {
  veniceApiKey: string;
  tokens: string[];
  evolution: AdaptiveConfig;
  cortexIntervalMs: number;      // 24h
}

function loadConfig(): InstinctAgentConfig {
  const veniceApiKey = process.env.VENICE_API_KEY;
  if (!veniceApiKey) {
    throw new Error('VENICE_API_KEY is required in .env');
  }

  return {
    veniceApiKey,
    tokens: ALL_TOKENS,
    evolution: { ...DEFAULT_ADAPTIVE_CONFIG },
    cortexIntervalMs: 24 * 60 * 60 * 1000, // 24h
  };
}

// -------------------------------------------------------------------
// Instinct Agent
// -------------------------------------------------------------------

class InstinctAgent {
  private config: InstinctAgentConfig;

  // Data layer
  private candleStore: CandleStore;
  private eventStore: EventStore;

  // Departments
  private sourceManager: SourceManager;
  private predictionEngine: PredictionEngine;
  private scorer: Scorer;
  private weightOptimizer: WeightOptimizer;
  private stateWriter: StateWriter;
  private patternDetector: PatternDetector;
  private workflowGenerator: WorkflowGenerator;
  private backtestRunner: BacktestRunner;

  // Source agents
  private grokSource: GrokSource;
  private rssSource: RssSource;
  private onChainSource: OnChainSource;

  // Timers
  private senseTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private evolutionTimer: ReturnType<typeof setInterval> | null = null;
  private cortexTimer: ReturnType<typeof setInterval> | null = null;
  private emergencyCheckTimer: ReturnType<typeof setInterval> | null = null;

  // State
  private running = false;
  private startTime = Date.now();
  private evolutionCount = 0;
  private lastAccuracyCheck: { timestamp: number; accuracy: number } = { timestamp: 0, accuracy: 0.5 };

  constructor(config: InstinctAgentConfig) {
    this.config = config;

    // Initialize data stores
    this.candleStore = new CandleStore();
    this.eventStore = new EventStore();

    // Initialize Senses
    this.sourceManager = new SourceManager(this.candleStore, this.eventStore);
    this.grokSource = new GrokSource({ veniceApiKey: config.veniceApiKey });
    this.rssSource = new RssSource(60); // 60min max article age
    this.onChainSource = new OnChainSource(this.candleStore);

    // Register source agents
    this.sourceManager.addSource(GrokSource.defaultConfig());
    this.sourceManager.addSource(RssSource.defaultConfig());
    this.sourceManager.addSource(OnChainSource.defaultConfig());
    this.sourceManager.registerAgent('grok_x', this.grokSource);
    this.sourceManager.registerAgent('rss_news', this.rssSource);
    this.sourceManager.registerAgent('onchain', this.onChainSource);

    // Initialize Reflexes
    this.predictionEngine = new PredictionEngine(
      this.candleStore, this.eventStore, config.veniceApiKey, config.tokens,
    );

    // Initialize Cortex
    this.scorer = new Scorer();
    this.weightOptimizer = new WeightOptimizer(this.scorer);

    // Initialize Nerves
    this.stateWriter = new StateWriter(
      this.predictionEngine, this.sourceManager, this.eventStore, this.candleStore,
    );

    // Initialize Marrow
    this.patternDetector = new PatternDetector();
    this.workflowGenerator = new WorkflowGenerator();

    // Initialize Backtest
    this.backtestRunner = new BacktestRunner(this.candleStore);
  }

  /**
   * Start all departments.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log('='.repeat(60));
    console.log('[Instinct] DarwinFi Instinct Agent Starting');
    console.log(`[Instinct] Tokens: ${this.config.tokens.join(', ')}`);
    console.log(`[Instinct] Evolution interval: ${(this.config.evolution.currentIntervalMs / 3_600_000).toFixed(1)}h`);
    console.log('='.repeat(60));

    // Start Nerves first (state writer) so other departments can write predictions
    this.stateWriter.start();

    // Start Senses (event collection)
    this.startSenses();

    // Start Reflexes (prediction loops) -- delayed slightly to let data accumulate
    setTimeout(() => {
      this.predictionEngine.start();
      console.log('[Instinct] Reflexes prediction engine started');
    }, 30_000);

    // Start Cortex evaluation
    this.sourceManager.startEvaluation();

    // Start evolution timer
    this.startEvolutionTimer();

    // Start emergency accuracy checker (every 15 min)
    this.emergencyCheckTimer = setInterval(() => {
      this.checkEmergencyTrigger();
    }, 15 * 60 * 1000);

    // Start Cortex weight optimization timer (24h)
    this.cortexTimer = setInterval(() => {
      this.runCortexOptimization();
    }, this.config.cortexIntervalMs);

    console.log('[Instinct] All departments online');
  }

  /**
   * Stop all departments gracefully.
   */
  stop(): void {
    this.running = false;

    this.stateWriter.stop();
    this.predictionEngine.stop();
    this.sourceManager.stopEvaluation();

    for (const timer of this.senseTimers.values()) clearInterval(timer);
    this.senseTimers.clear();

    if (this.evolutionTimer) clearInterval(this.evolutionTimer);
    if (this.cortexTimer) clearInterval(this.cortexTimer);
    if (this.emergencyCheckTimer) clearInterval(this.emergencyCheckTimer);

    console.log('[Instinct] Agent stopped');
  }

  // -------------------------------------------------------------------
  // Senses: Event Collection
  // -------------------------------------------------------------------

  private startSenses(): void {
    const sources = this.sourceManager.getActiveSources();
    for (const source of sources) {
      this.startSourceTimer(source.id, source.collectionIntervalMs);
    }
    console.log(`[Instinct] Senses started: ${sources.length} active sources`);
  }

  private startSourceTimer(sourceId: string, intervalMs: number): void {
    // Initial collection after short stagger
    setTimeout(() => {
      this.sourceManager.collectFromSource(sourceId).catch(err =>
        console.error(`[Instinct] Source ${sourceId} error:`, (err as Error).message)
      );
    }, Math.random() * 30_000);

    const timer = setInterval(() => {
      this.sourceManager.collectFromSource(sourceId).catch(err =>
        console.error(`[Instinct] Source ${sourceId} error:`, (err as Error).message)
      );

      // Log for Marrow pattern detection
      this.patternDetector.logOperation('event_collection', sourceId, '', 0);
    }, intervalMs);

    this.senseTimers.set(sourceId, timer);
  }

  // -------------------------------------------------------------------
  // Adaptive Evolution
  // -------------------------------------------------------------------

  private startEvolutionTimer(): void {
    this.evolutionTimer = setInterval(() => {
      this.runEvolutionCycle('timer');
    }, this.config.evolution.currentIntervalMs);
  }

  private async runEvolutionCycle(trigger: 'timer' | 'emergency' | 'weight_shift'): Promise<void> {
    this.evolutionCount++;
    console.log(`[Instinct] Evolution cycle #${this.evolutionCount} (trigger: ${trigger})`);

    // 1. Evaluate source fitness
    await this.sourceManager.evaluateSources();

    // 2. Run Marrow pattern detection
    const patterns = this.patternDetector.detectPatterns();
    if (patterns.length > 0) {
      this.workflowGenerator.generateSuggestions(patterns);
    }

    // 3. Compute rolling accuracy
    const accuracy = this.computeRollingAccuracy();
    this.lastAccuracyCheck = { timestamp: Date.now(), accuracy };

    // 4. Adjust evolution interval based on accuracy
    this.adjustEvolutionInterval(accuracy);

    console.log(`[Instinct] Evolution complete. Accuracy: ${(accuracy * 100).toFixed(1)}%, next in ${(this.config.evolution.currentIntervalMs / 3_600_000).toFixed(1)}h`);
  }

  private checkEmergencyTrigger(): void {
    const accuracy = this.computeRollingAccuracy();

    if (accuracy < this.config.evolution.emergencyThreshold) {
      console.log(`[Instinct] EMERGENCY: Rolling accuracy ${(accuracy * 100).toFixed(1)}% < ${this.config.evolution.emergencyThreshold * 100}%`);
      this.runEvolutionCycle('emergency');
    }
  }

  private adjustEvolutionInterval(accuracy: number): void {
    const evo = this.config.evolution;
    let newInterval = evo.baseIntervalMs;

    if (accuracy > evo.accuracyHighThreshold) {
      newInterval = evo.currentIntervalMs * 1.5; // Slow down
    } else if (accuracy < evo.accuracyLowThreshold) {
      newInterval = evo.currentIntervalMs * 0.5; // Speed up
    }

    // Clamp to min/max
    newInterval = Math.max(evo.minIntervalMs, Math.min(evo.maxIntervalMs, newInterval));

    if (newInterval !== evo.currentIntervalMs) {
      evo.currentIntervalMs = newInterval;

      // Restart timer with new interval
      if (this.evolutionTimer) clearInterval(this.evolutionTimer);
      this.startEvolutionTimer();

      console.log(`[Instinct] Evolution interval adjusted to ${(newInterval / 3_600_000).toFixed(1)}h`);
    }
  }

  public computeRollingAccuracy(): number {
    // Check predictions from last hour across all tokens and resolutions
    let correct = 0;
    let total = 0;

    for (const token of this.config.tokens) {
      for (const res of ['5m', '15m'] as const) {
        const predictions = this.predictionEngine.getRecentPredictions(token, res, 20);
        for (const p of predictions) {
          if (p.actual) {
            total++;
            if (p.actual.directionCorrect) correct++;
          }
        }
      }
    }

    return total > 0 ? correct / total : 0.5; // Default to 50% if no data
  }

  // -------------------------------------------------------------------
  // Cortex: Weight Optimization (24h cycle)
  // -------------------------------------------------------------------

  private runCortexOptimization(): void {
    console.log('[Instinct] Cortex: Running 24h weight optimization...');

    // Rank sources by actual predictive value
    const sources = this.sourceManager.getAllSources();
    const sourceRanking = sources
      .sort((a, b) => b.fitness.predictiveScore - a.fitness.predictiveScore)
      .map(s => s.id);

    if (sourceRanking.length >= 2) {
      const oldWeights = this.scorer.getSourceWeights();
      this.weightOptimizer.optimizeSourceWeights(sources, sourceRanking);
      const newWeights = this.scorer.getSourceWeights();
      const shift = this.weightOptimizer.computeWeightShift(
        oldWeights as unknown as Record<string, number>,
        newWeights as unknown as Record<string, number>,
      );

      if (shift > this.config.evolution.weightShiftThreshold) {
        console.log(`[Instinct] Weight shift ${(shift * 100).toFixed(1)}% > threshold, triggering evolution`);
        this.runEvolutionCycle('weight_shift');
      }
    }

    // Rank strategies by actual performance
    const strategies = this.predictionEngine.getAllStrategies();
    const strategyRanking = strategies
      .sort((a, b) => b.fitness.directionAccuracy - a.fitness.directionAccuracy)
      .map(s => s.id);

    if (strategyRanking.length >= 2) {
      this.weightOptimizer.optimizePredictionWeights(strategies, strategyRanking);
    }

    console.log('[Instinct] Cortex optimization complete');
  }

  // -------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------

  printStatus(): void {
    const uptime = ((Date.now() - this.startTime) / 3_600_000).toFixed(1);
    const sources = this.sourceManager.getActiveSources();
    const strategies = this.predictionEngine.getActiveStrategies();
    const accuracy = this.computeRollingAccuracy();

    console.log(`\n${'='.repeat(50)}`);
    console.log(`[Instinct] Status Report`);
    console.log(`  Uptime: ${uptime}h | Evolution cycles: ${this.evolutionCount}`);
    console.log(`  Active sources: ${sources.length} | Active strategies: ${strategies.length}`);
    console.log(`  Rolling accuracy: ${(accuracy * 100).toFixed(1)}%`);
    console.log(`  Next evolution: ${(this.config.evolution.currentIntervalMs / 3_600_000).toFixed(1)}h interval`);
    console.log(`${'='.repeat(50)}\n`);
  }

  /**
   * Generate a grading report for the GradingDepartment.
   * Exposes accuracy metrics, per-token and per-resolution breakdowns.
   */
  getGradingReport(): InstinctGradingReport {
    let totalCorrect = 0;
    let totalGraded = 0;
    const perToken: Record<string, { correct: number; total: number }> = {};
    const perResolution: Record<string, { correct: number; total: number }> = {};

    for (const token of this.config.tokens) {
      if (!perToken[token]) perToken[token] = { correct: 0, total: 0 };

      for (const res of ['5m', '15m', '1h'] as const) {
        if (!perResolution[res]) perResolution[res] = { correct: 0, total: 0 };

        const predictions = this.predictionEngine.getRecentPredictions(token, res, 50);
        for (const p of predictions) {
          if (p.actual) {
            totalGraded++;
            perToken[token].total++;
            perResolution[res].total++;
            if (p.actual.directionCorrect) {
              totalCorrect++;
              perToken[token].correct++;
              perResolution[res].correct++;
            }
          }
        }
      }
    }

    return {
      overallAccuracy: totalGraded > 0 ? totalCorrect / totalGraded : 0.5,
      totalPredictions: totalGraded,
      perToken: Object.fromEntries(
        Object.entries(perToken).map(([token, stats]) => [
          token,
          {
            accuracy: stats.total > 0 ? stats.correct / stats.total : 0.5,
            predictions: stats.total,
          },
        ]),
      ),
      perResolution: Object.fromEntries(
        Object.entries(perResolution).map(([res, stats]) => [
          res,
          {
            accuracy: stats.total > 0 ? stats.correct / stats.total : 0.5,
            predictions: stats.total,
          },
        ]),
      ),
      activeSources: this.sourceManager.getActiveSources().length,
      activeStrategies: this.predictionEngine.getActiveStrategies().length,
      uptimeMs: Date.now() - this.startTime,
      generatedAt: Date.now(),
    };
  }
  /**
   * Get department-level scores for instinct's 5 departments.
   * Used by GradingDepartment for internal competition tracking.
   */
  getDepartmentScores(): Array<{ name: string; score: number; rank: number; metrics: Record<string, number | string> }> {
    const departments: Array<{ name: string; score: number; metrics: Record<string, number | string> }> = [];

    // Senses: score based on active sources and event production
    const sources = this.sourceManager.getAllSources();
    const activeSources = sources.filter(s => s.status === 'active');
    const sensesScore = sources.length > 0
      ? Math.round((activeSources.length / sources.length) * 80 + Math.min(20, activeSources.length * 5))
      : 50;
    departments.push({
      name: 'Senses',
      score: sensesScore,
      metrics: {
        activeSources: activeSources.length,
        totalSources: sources.length,
        avgFitness: sources.length > 0
          ? (sources.reduce((s, src) => s + src.fitness.compositeScore, 0) / sources.length).toFixed(3)
          : '0',
      },
    });

    // Reflexes: score based on prediction accuracy
    const accuracy = this.computeRollingAccuracy();
    const reflexesScore = Math.round(accuracy * 100);
    const strategies = this.predictionEngine.getActiveStrategies();
    departments.push({
      name: 'Reflexes',
      score: reflexesScore,
      metrics: {
        accuracy: `${(accuracy * 100).toFixed(1)}%`,
        activeStrategies: strategies.length,
      },
    });

    // Cortex: score based on weight optimization activity
    // Since cortex runs every 24h, score based on whether it's been active
    const cortexActive = this.cortexTimer !== null;
    const cortexScore = cortexActive ? 75 : 40;
    departments.push({
      name: 'Cortex',
      score: cortexScore,
      metrics: {
        active: cortexActive ? 'yes' : 'no',
        optimizationInterval: `${(this.config.cortexIntervalMs / 3_600_000).toFixed(0)}h`,
      },
    });

    // Nerves: score based on state writer activity
    const nervesActive = this.stateWriter !== null;
    const nervesScore = nervesActive ? 80 : 30;
    departments.push({
      name: 'Nerves',
      score: nervesScore,
      metrics: {
        stateWriterActive: nervesActive ? 'yes' : 'no',
      },
    });

    // Marrow: score based on evolution cycle count and pattern detection
    const marrowScore = Math.min(90, 50 + this.evolutionCount * 5);
    departments.push({
      name: 'Marrow',
      score: marrowScore,
      metrics: {
        evolutionCycles: this.evolutionCount,
        currentInterval: `${(this.config.evolution.currentIntervalMs / 3_600_000).toFixed(1)}h`,
      },
    });

    // Rank by score
    departments.sort((a, b) => b.score - a.score);
    return departments.map((d, i) => ({ ...d, rank: i + 1 }));
  }
}

// -------------------------------------------------------------------
// Entry Point
// -------------------------------------------------------------------

async function main(): Promise<void> {
  const config = loadConfig();
  const agent = new InstinctAgent(config);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[Instinct] Shutting down...');
    agent.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n[Instinct] Shutting down...');
    agent.stop();
    process.exit(0);
  });

  await agent.start();

  // Periodic status report every 30 min
  setInterval(() => agent.printStatus(), 30 * 60 * 1000);
}

main().catch(err => {
  console.error('[Instinct] Fatal error:', err);
  process.exit(1);
});
