/**
 * DarwinFi Strategy Manager
 *
 * Manages a population of 12 strategies: 3 main strategies, each with
 * 3 variations (experimental / optimizer / synthesizer). Handles
 * promotion, demotion, and sell-only transitions.
 */

import { PerformanceTracker } from './performance';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export type EntryMethod = 'rsi_oversold' | 'ema_crossover' | 'bollinger_bounce' | 'macd_signal' | 'volume_spike';
export type ExitMethod = 'trailing_stop' | 'fixed_target' | 'time_based';
export type Timeframe = '1m' | '5m' | '15m' | '1h';
export type StrategyStatus = 'paper' | 'live' | 'sell_only';
export type VariationRole = 'experimental' | 'optimizer' | 'synthesizer';

export interface StrategyGenome {
  id: string;
  name: string;
  type: 'main' | 'variation';
  role?: VariationRole;
  parentId?: string;
  parameters: {
    entryMethod: EntryMethod;
    entryThreshold: number;
    exitMethod: ExitMethod;
    trailingStopPct: number;
    takeProfitPct: number;
    timeframe: Timeframe;
    indicators: string[];
    riskPerTradePct: number;
    maxPositions: number;
    tokenPreferences: string[];
  };
  status: StrategyStatus;
  generation: number;
}

export interface PromotionEvent {
  timestamp: Date;
  type: 'variation_to_main' | 'main_to_live' | 'demotion_to_sell_only' | 'sell_only_retired';
  fromId: string;
  toId?: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Seed Strategies -- three distinct trading philosophies
// ---------------------------------------------------------------------------

function createSeedStrategies(): StrategyGenome[] {
  const mainA: StrategyGenome = {
    id: 'main-alpha',
    name: 'Alpha Momentum',
    type: 'main',
    parameters: {
      entryMethod: 'rsi_oversold',
      entryThreshold: 30,
      exitMethod: 'trailing_stop',
      trailingStopPct: 8,
      takeProfitPct: 25,
      timeframe: '5m',
      indicators: ['rsi_14', 'ema_20', 'volume_sma_20'],
      riskPerTradePct: 2,
      maxPositions: 3,
      tokenPreferences: ['ETH', 'wstETH'],
    },
    status: 'live', // First strategy starts as live
    generation: 0,
  };

  const mainB: StrategyGenome = {
    id: 'main-beta',
    name: 'Beta Mean-Revert',
    type: 'main',
    parameters: {
      entryMethod: 'bollinger_bounce',
      entryThreshold: 2.0,
      exitMethod: 'fixed_target',
      trailingStopPct: 5,
      takeProfitPct: 15,
      timeframe: '15m',
      indicators: ['bollinger_20_2', 'rsi_14', 'atr_14'],
      riskPerTradePct: 1.5,
      maxPositions: 4,
      tokenPreferences: ['ETH', 'UNI', 'ENS'],
    },
    status: 'paper',
    generation: 0,
  };

  const mainC: StrategyGenome = {
    id: 'main-gamma',
    name: 'Gamma Trend',
    type: 'main',
    parameters: {
      entryMethod: 'ema_crossover',
      entryThreshold: 0.5,
      exitMethod: 'trailing_stop',
      trailingStopPct: 12,
      takeProfitPct: 40,
      timeframe: '1h',
      indicators: ['ema_9', 'ema_21', 'macd_12_26_9', 'adx_14'],
      riskPerTradePct: 2.5,
      maxPositions: 2,
      tokenPreferences: ['ETH', 'AERO', 'wstETH'],
    },
    status: 'paper',
    generation: 0,
  };

  return [mainA, mainB, mainC];
}

function createVariations(main: StrategyGenome): StrategyGenome[] {
  const roles: VariationRole[] = ['experimental', 'optimizer', 'synthesizer'];
  const suffixes = ['exp', 'opt', 'syn'];
  const names = ['Mad Scientist', 'Optimizer', 'Synthesizer'];

  return roles.map((role, i) => ({
    id: `${main.id}-${suffixes[i]}`,
    name: `${main.name} ${names[i]}`,
    type: 'variation' as const,
    role,
    parentId: main.id,
    parameters: { ...main.parameters }, // Shallow copy -- will diverge after first evolution
    status: 'paper' as const,
    generation: 0,
  }));
}

// ---------------------------------------------------------------------------
// StrategyManager
// ---------------------------------------------------------------------------

export class StrategyManager {
  private strategies: Map<string, StrategyGenome> = new Map();
  private promotionHistory: PromotionEvent[] = [];
  private performanceTracker: PerformanceTracker;
  private consecutiveOutperformCycles: number;

  constructor(performanceTracker: PerformanceTracker) {
    this.performanceTracker = performanceTracker;
    this.consecutiveOutperformCycles = 2; // Required consecutive cycles to promote
  }

  /**
   * Initialize the full population of 12 strategies (3 mains + 9 variations).
   */
  initialize(): void {
    const mains = createSeedStrategies();

    for (const main of mains) {
      this.strategies.set(main.id, main);
      this.performanceTracker.initStrategy(main.id);

      const variations = createVariations(main);
      for (const v of variations) {
        this.strategies.set(v.id, v);
        this.performanceTracker.initStrategy(v.id);
      }
    }

    console.log(`[DarwinFi] Strategy population initialized: ${this.strategies.size} strategies`);
    this.logPopulationSummary();
  }

  /**
   * Get all strategies.
   */
  getAllStrategies(): StrategyGenome[] {
    return Array.from(this.strategies.values());
  }

  /**
   * Get a single strategy by ID.
   */
  getStrategy(id: string): StrategyGenome | undefined {
    return this.strategies.get(id);
  }

  /**
   * Get the currently live strategy.
   */
  getLiveStrategy(): StrategyGenome | undefined {
    return Array.from(this.strategies.values()).find(s => s.status === 'live');
  }

  /**
   * Get all main strategies.
   */
  getMainStrategies(): StrategyGenome[] {
    return Array.from(this.strategies.values()).filter(s => s.type === 'main');
  }

  /**
   * Get variations for a given main strategy.
   */
  getVariations(mainId: string): StrategyGenome[] {
    return Array.from(this.strategies.values()).filter(
      s => s.type === 'variation' && s.parentId === mainId
    );
  }

  /**
   * Get all strategies in sell-only mode.
   */
  getSellOnlyStrategies(): StrategyGenome[] {
    return Array.from(this.strategies.values()).filter(s => s.status === 'sell_only');
  }

  /**
   * Update a strategy's genome (used by evolution engine).
   * Resets performance metrics when the genome changes.
   */
  updateGenome(strategyId: string, newParams: Partial<StrategyGenome['parameters']>): void {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) {
      console.error(`[DarwinFi] Cannot update genome -- strategy ${strategyId} not found`);
      return;
    }

    const oldParams = JSON.stringify(strategy.parameters);
    strategy.parameters = { ...strategy.parameters, ...newParams };
    const newParamsStr = JSON.stringify(strategy.parameters);

    if (oldParams !== newParamsStr) {
      strategy.generation += 1;
      this.performanceTracker.resetMetrics(strategyId);
      console.log(
        `[DarwinFi] Genome updated for ${strategyId} (gen ${strategy.generation}). Metrics reset.`
      );
    }
  }

  /**
   * Run promotion/demotion evaluation across all strategies.
   * Returns a list of events that occurred.
   */
  evaluatePromotions(): PromotionEvent[] {
    const events: PromotionEvent[] = [];

    // Step 1: Evaluate variation -> main promotions
    const variationPromotions = this.evaluateVariationPromotions();
    events.push(...variationPromotions);

    // Step 2: Evaluate main -> live promotions
    const livePromotions = this.evaluateMainToLivePromotions();
    events.push(...livePromotions);

    // Step 3: Retire fully-exited sell-only strategies
    const retirements = this.evaluateSellOnlyRetirements();
    events.push(...retirements);

    this.promotionHistory.push(...events);

    if (events.length > 0) {
      console.log(`[DarwinFi] Promotion cycle complete: ${events.length} event(s)`);
      this.logPopulationSummary();
    } else {
      console.log(`[DarwinFi] Promotion cycle complete: no changes`);
    }

    return events;
  }

  /**
   * Get promotion history.
   */
  getPromotionHistory(): PromotionEvent[] {
    return [...this.promotionHistory];
  }

  /**
   * Get a full status report for logging/dashboard.
   */
  getStatusReport(): {
    live: string | null;
    mains: string[];
    variations: Record<string, string[]>;
    sellOnly: string[];
    leaderboard: Array<{ id: string; score: number; trades: number }>;
  } {
    const live = this.getLiveStrategy();
    const mains = this.getMainStrategies();
    const leaderboard = this.performanceTracker.getLeaderboard();

    const variationsMap: Record<string, string[]> = {};
    for (const main of mains) {
      variationsMap[main.id] = this.getVariations(main.id).map(v => v.id);
    }

    return {
      live: live?.id || null,
      mains: mains.map(m => m.id),
      variations: variationsMap,
      sellOnly: this.getSellOnlyStrategies().map(s => s.id),
      leaderboard: leaderboard.map(e => ({
        id: e.strategyId,
        score: Math.round(e.score * 1000) / 1000,
        trades: e.metrics.tradesCompleted,
      })),
    };
  }

  /**
   * Serialize all genomes for persistence.
   */
  serialize(): StrategyGenome[] {
    return Array.from(this.strategies.values());
  }

  // -------------------------------------------------------------------------
  // Private promotion logic
  // -------------------------------------------------------------------------

  /**
   * Check if any variation outperforms its parent main and should replace it.
   * Criteria: variation score > parent score for 2 consecutive cycles AND 5+ trades.
   */
  private evaluateVariationPromotions(): PromotionEvent[] {
    const events: PromotionEvent[] = [];
    const mains = this.getMainStrategies();

    for (const main of mains) {
      const parentScore = this.performanceTracker.getCompositeScore(main.id);
      const variations = this.getVariations(main.id);

      for (const variation of variations) {
        if (!this.performanceTracker.isPromotionEligible(variation.id)) {
          continue;
        }

        const varScore = this.performanceTracker.getCompositeScore(variation.id);

        if (varScore > parentScore) {
          this.performanceTracker.incrementOutperformCycle(variation.id);
        } else {
          this.performanceTracker.resetOutperformCycle(variation.id);
        }

        const metrics = this.performanceTracker.getMetrics(variation.id);
        if (metrics && metrics.consecutiveOutperformCycles >= this.consecutiveOutperformCycles) {
          // Promote: variation replaces the parent main
          this.promoteVariationToMain(variation, main);
          events.push({
            timestamp: new Date(),
            type: 'variation_to_main',
            fromId: variation.id,
            toId: main.id,
            reason: `Variation outperformed parent for ${metrics.consecutiveOutperformCycles} consecutive cycles ` +
              `(var score: ${varScore.toFixed(3)} vs parent: ${parentScore.toFixed(3)})`,
          });
          this.performanceTracker.resetOutperformCycle(variation.id);
          break; // Only one promotion per main per cycle
        }
      }
    }

    return events;
  }

  /**
   * Check if any paper main outperforms the live trader.
   * Criteria: main score > live score for 2 consecutive cycles.
   */
  private evaluateMainToLivePromotions(): PromotionEvent[] {
    const events: PromotionEvent[] = [];
    const live = this.getLiveStrategy();
    if (!live) return events;

    const liveScore = this.performanceTracker.getCompositeScore(live.id);
    const mains = this.getMainStrategies().filter(m => m.status === 'paper');

    for (const main of mains) {
      if (!this.performanceTracker.isPromotionEligible(main.id)) {
        continue;
      }

      const mainScore = this.performanceTracker.getCompositeScore(main.id);

      if (mainScore > liveScore) {
        this.performanceTracker.incrementOutperformCycle(main.id);
      } else {
        this.performanceTracker.resetOutperformCycle(main.id);
      }

      const metrics = this.performanceTracker.getMetrics(main.id);
      if (metrics && metrics.consecutiveOutperformCycles >= this.consecutiveOutperformCycles) {
        // Promote: this main becomes live, old live goes to sell_only
        this.promoteMainToLive(main, live);
        events.push({
          timestamp: new Date(),
          type: 'main_to_live',
          fromId: main.id,
          toId: live.id,
          reason: `Main outperformed live for ${metrics.consecutiveOutperformCycles} consecutive cycles ` +
            `(challenger: ${mainScore.toFixed(3)} vs live: ${liveScore.toFixed(3)})`,
        });
        events.push({
          timestamp: new Date(),
          type: 'demotion_to_sell_only',
          fromId: live.id,
          reason: `Dethroned by ${main.id}`,
        });
        this.performanceTracker.resetOutperformCycle(main.id);
        break; // Only one live promotion per cycle
      }
    }

    return events;
  }

  /**
   * Check sell-only strategies -- if they have no open positions, retire them back to paper.
   */
  private evaluateSellOnlyRetirements(): PromotionEvent[] {
    const events: PromotionEvent[] = [];
    const sellOnlys = this.getSellOnlyStrategies();

    for (const strategy of sellOnlys) {
      const openPositions = this.performanceTracker.getOpenPositions(strategy.id);
      if (openPositions.length === 0) {
        strategy.status = 'paper';
        this.performanceTracker.resetMetrics(strategy.id);
        events.push({
          timestamp: new Date(),
          type: 'sell_only_retired',
          fromId: strategy.id,
          reason: 'All positions closed, returned to paper trading',
        });
        console.log(`[DarwinFi] ${strategy.id} retired from sell-only -> paper`);
      }
    }

    return events;
  }

  /**
   * Execute a variation-to-main promotion. The variation's parameters
   * overwrite the parent main. The variation is then re-initialized.
   */
  private promoteVariationToMain(variation: StrategyGenome, parent: StrategyGenome): void {
    console.log(
      `[DarwinFi] PROMOTION: ${variation.id} (${variation.role}) replaces ${parent.id}`
    );

    // Copy variation parameters into the parent main
    parent.parameters = { ...variation.parameters };
    parent.generation = variation.generation + 1;
    parent.name = `${parent.name} (evolved gen ${parent.generation})`;

    // Reset the variation back to a fresh copy of the (now-updated) parent
    variation.parameters = { ...parent.parameters };
    variation.generation = parent.generation;

    // Reset performance for both
    this.performanceTracker.resetMetrics(parent.id);
    this.performanceTracker.resetMetrics(variation.id);
  }

  /**
   * Execute a main-to-live promotion. The challenger becomes live,
   * the old live goes to sell-only.
   */
  private promoteMainToLive(challenger: StrategyGenome, incumbent: StrategyGenome): void {
    console.log(
      `[DarwinFi] LIVE PROMOTION: ${challenger.id} becomes live, ${incumbent.id} -> sell_only`
    );

    incumbent.status = 'sell_only';
    challenger.status = 'live';
  }

  /**
   * Print a summary of the current population to the console.
   */
  private logPopulationSummary(): void {
    const live = this.getLiveStrategy();
    const mains = this.getMainStrategies();

    console.log('[DarwinFi] --- Population Summary ---');
    console.log(`[DarwinFi]   Live: ${live?.id || 'NONE'} (${live?.name || 'N/A'})`);

    for (const main of mains) {
      const score = this.performanceTracker.getCompositeScore(main.id);
      const metrics = this.performanceTracker.getMetrics(main.id);
      console.log(
        `[DarwinFi]   Main: ${main.id} [${main.status}] ` +
        `score=${score.toFixed(3)} trades=${metrics?.tradesCompleted || 0} gen=${main.generation}`
      );

      const vars = this.getVariations(main.id);
      for (const v of vars) {
        const vScore = this.performanceTracker.getCompositeScore(v.id);
        const vMetrics = this.performanceTracker.getMetrics(v.id);
        console.log(
          `[DarwinFi]     Var: ${v.id} [${v.role}] ` +
          `score=${vScore.toFixed(3)} trades=${vMetrics?.tradesCompleted || 0} gen=${v.generation}`
        );
      }
    }
    console.log('[DarwinFi] --- End Summary ---');
  }
}
