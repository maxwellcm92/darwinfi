/**
 * DarwinFi Agent Core -- Main Orchestrator
 *
 * Entry point for the autonomous trading agent. Ties together:
 *   - Strategy Manager (12 strategies: 3 mains x 4)
 *   - Evolution Engine (Claude API for strategy mutation)
 *   - Venice Engine (real-time market analysis)
 *   - Performance Tracker (composite fitness scoring)
 *
 * Main loop: check prices -> evaluate signals -> execute trades -> check evolution timer
 * Evolution triggers: every N hours OR after M completed trades (whichever first)
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { PerformanceTracker, TradeRecord } from './performance';
import { StrategyManager, StrategyGenome } from './strategy-manager';
import { EvolutionEngine } from './evolution-engine';
import { VeniceEngine, MarketSnapshot, EntrySignal, ExitSignal } from './venice-engine';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface AgentConfig {
  anthropicApiKey: string;
  veniceApiKey: string;
  evolutionIntervalMs: number;
  minTradesForEvolution: number;
  pollIntervalMs: number;
  dryRun: boolean;
}

function loadConfig(): AgentConfig {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is required in .env');
  }
  const veniceApiKey = process.env.VENICE_API_KEY;
  if (!veniceApiKey) {
    throw new Error('VENICE_API_KEY is required in .env');
  }

  const evolutionHours = parseInt(process.env.EVOLUTION_INTERVAL_HOURS || '4', 10);
  const minTrades = parseInt(process.env.MIN_TRADES_FOR_PROMOTION || '5', 10);

  return {
    anthropicApiKey,
    veniceApiKey,
    evolutionIntervalMs: evolutionHours * 60 * 60 * 1000,
    minTradesForEvolution: minTrades * 2, // 10 trades = 2x the promotion minimum
    pollIntervalMs: 30_000, // 30 seconds between market checks
    dryRun: process.env.DRY_RUN === 'true',
  };
}

// ---------------------------------------------------------------------------
// Token Universe (approved tokens for trading on Base)
// ---------------------------------------------------------------------------

const TOKEN_UNIVERSE: Record<string, { address: string; decimals: number }> = {
  WETH: { address: '0x4200000000000000000000000000000000000006', decimals: 18 },
  cbBTC: { address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', decimals: 8 },
  USDC: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6 },
  DAI: { address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', decimals: 18 },
  AERO: { address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', decimals: 18 },
  DEGEN: { address: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed', decimals: 18 },
  BRETT: { address: '0x532f27101965dd16442E59d40670FaF5eBB142E4', decimals: 18 },
  TOSHI: { address: '0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4', decimals: 18 },
};

// ---------------------------------------------------------------------------
// DarwinAgent
// ---------------------------------------------------------------------------

class DarwinAgent {
  private config: AgentConfig;
  private performanceTracker: PerformanceTracker;
  private strategyManager: StrategyManager;
  private evolutionEngine: EvolutionEngine;
  private veniceEngine: VeniceEngine;

  private running: boolean = false;
  private lastEvolutionTime: Date = new Date();
  private tradesAtLastEvolution: number = 0;
  private tradeIdCounter: number = 0;
  private loopCount: number = 0;

  constructor(config: AgentConfig) {
    this.config = config;
    this.performanceTracker = new PerformanceTracker();
    this.strategyManager = new StrategyManager(this.performanceTracker);
    this.evolutionEngine = new EvolutionEngine(config.anthropicApiKey);
    this.veniceEngine = new VeniceEngine(config.veniceApiKey);
  }

  /**
   * Start the agent. This is the main entry point.
   */
  async start(): Promise<void> {
    console.log('[DarwinFi] ====================================');
    console.log('[DarwinFi]   DarwinFi Agent v0.1.0');
    console.log('[DarwinFi]   Autonomous Darwinian Trading');
    console.log('[DarwinFi] ====================================');
    console.log(`[DarwinFi] Mode: ${this.config.dryRun ? 'DRY RUN (no real trades)' : 'LIVE'}`);
    console.log(`[DarwinFi] Evolution interval: ${this.config.evolutionIntervalMs / 3600000}h`);
    console.log(`[DarwinFi] Evolution trade trigger: ${this.config.minTradesForEvolution} trades`);
    console.log(`[DarwinFi] Poll interval: ${this.config.pollIntervalMs / 1000}s`);

    // Initialize strategy population
    this.strategyManager.initialize();

    this.running = true;
    this.lastEvolutionTime = new Date();
    this.tradesAtLastEvolution = 0;

    // Register shutdown handlers
    this.registerShutdownHandlers();

    // Main loop
    console.log('[DarwinFi] Entering main loop...');
    while (this.running) {
      try {
        await this.mainLoopIteration();
      } catch (err) {
        console.error(
          '[DarwinFi] Error in main loop iteration:',
          err instanceof Error ? err.message : err,
        );
        // Don't crash on single iteration failure -- keep going
      }
      await this.sleep(this.config.pollIntervalMs);
    }

    console.log('[DarwinFi] Agent stopped.');
  }

  /**
   * Stop the agent gracefully.
   */
  async stop(): Promise<void> {
    console.log('[DarwinFi] Shutdown requested...');
    this.running = false;

    // Close any open positions in sell-only mode
    const liveStrategy = this.strategyManager.getLiveStrategy();
    if (liveStrategy) {
      const openPositions = this.performanceTracker.getOpenPositions(liveStrategy.id);
      if (openPositions.length > 0) {
        console.log(
          `[DarwinFi] WARNING: ${openPositions.length} open position(s) on shutdown. ` +
          'Positions will remain open -- manage manually or restart agent.'
        );
      }
    }

    // Print final status
    this.printStatusReport();
  }

  // -------------------------------------------------------------------------
  // Main Loop
  // -------------------------------------------------------------------------

  private async mainLoopIteration(): Promise<void> {
    this.loopCount += 1;

    // Step 1: Fetch market data for the token universe
    const snapshots = await this.fetchMarketSnapshots();
    if (snapshots.length === 0) {
      console.warn('[DarwinFi] No market data available, skipping iteration');
      return;
    }

    // Step 2: Get the live strategy
    const liveStrategy = this.strategyManager.getLiveStrategy();
    if (!liveStrategy) {
      console.error('[DarwinFi] No live strategy found -- this should not happen');
      return;
    }

    // Step 3: Evaluate exit signals for open positions
    await this.evaluateExits(liveStrategy, snapshots);

    // Step 4: Evaluate entry signals (only for live strategy in live mode, all strategies in paper)
    await this.evaluateEntries(liveStrategy, snapshots);

    // Step 5: Run paper trading for non-live strategies
    await this.runPaperTradingCycle(snapshots);

    // Step 6: Check evolution trigger
    await this.checkEvolutionTrigger();

    // Step 7: Periodic status log (every 10 iterations)
    if (this.loopCount % 10 === 0) {
      this.printStatusReport();
    }
  }

  // -------------------------------------------------------------------------
  // Market Data
  // -------------------------------------------------------------------------

  /**
   * Fetch market snapshots for all tokens in the universe.
   * TODO: Replace with real price feed (DEX subgraph, Coingecko, on-chain oracle).
   */
  private async fetchMarketSnapshots(): Promise<MarketSnapshot[]> {
    const snapshots: MarketSnapshot[] = [];

    for (const [symbol, info] of Object.entries(TOKEN_UNIVERSE)) {
      try {
        // Placeholder: in production, this fetches from DEX price feeds or oracles
        const snapshot = await this.fetchTokenSnapshot(symbol, info.address);
        if (snapshot) {
          snapshots.push(snapshot);
        }
      } catch (err) {
        console.warn(
          `[DarwinFi] Failed to fetch snapshot for ${symbol}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    return snapshots;
  }

  /**
   * Fetch a single token's market snapshot.
   * TODO: Implement real price feed integration.
   */
  private async fetchTokenSnapshot(
    symbol: string,
    _address: string,
  ): Promise<MarketSnapshot | null> {
    // PLACEHOLDER: This needs to be replaced with actual market data fetching.
    // For now, return a synthetic snapshot to allow the agent loop to function.
    // Integration points:
    //   - Uniswap V3 Subgraph for pool prices/volume
    //   - On-chain oracle reads via ethers.js
    //   - Technical indicator calculation from OHLCV candles
    console.log(`[DarwinFi] [STUB] Fetching market data for ${symbol}`);

    return {
      token: symbol,
      price: 0,
      priceChange1h: 0,
      priceChange24h: 0,
      volume24h: 0,
      volumeChange: 0,
      high24h: 0,
      low24h: 0,
    };
  }

  // -------------------------------------------------------------------------
  // Entry Evaluation
  // -------------------------------------------------------------------------

  private async evaluateEntries(
    liveStrategy: StrategyGenome,
    snapshots: MarketSnapshot[],
  ): Promise<void> {
    // Filter to tokens the live strategy cares about
    const relevantSnapshots = snapshots.filter(
      s => liveStrategy.parameters.tokenPreferences.includes(s.token)
    );

    if (relevantSnapshots.length === 0) return;

    // Check current open positions against max
    const openPositions = this.performanceTracker.getOpenPositions(liveStrategy.id);
    if (openPositions.length >= liveStrategy.parameters.maxPositions) {
      return; // At max capacity
    }

    // Ask Venice for token recommendations
    let recommendations;
    try {
      recommendations = await this.veniceEngine.recommendTokens(liveStrategy, relevantSnapshots);
    } catch (err) {
      console.warn(
        '[DarwinFi] Venice token recommendation failed:',
        err instanceof Error ? err.message : err,
      );
      return;
    }

    // Evaluate entry for top recommendations
    for (const rec of recommendations) {
      if (rec.score < 50) continue; // Skip low-confidence picks

      const snapshot = snapshots.find(s => s.token === rec.token);
      if (!snapshot || snapshot.price <= 0) continue;

      // Skip if we already hold this token
      if (openPositions.some(p => p.token === rec.token)) continue;

      // Still have room?
      if (openPositions.length >= liveStrategy.parameters.maxPositions) break;

      try {
        const signal = await this.veniceEngine.evaluateEntry(liveStrategy, snapshot);

        if (signal.action === 'buy' && signal.confidence >= 60) {
          await this.executeBuy(liveStrategy, signal, snapshot);
        } else {
          console.log(
            `[DarwinFi] Skip entry: ${snapshot.token} ` +
            `(action=${signal.action}, confidence=${signal.confidence})`
          );
        }
      } catch (err) {
        console.error(
          `[DarwinFi] Entry evaluation failed for ${rec.token}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Exit Evaluation
  // -------------------------------------------------------------------------

  private async evaluateExits(
    strategy: StrategyGenome,
    snapshots: MarketSnapshot[],
  ): Promise<void> {
    const openPositions = this.performanceTracker.getOpenPositions(strategy.id);
    if (openPositions.length === 0) return;

    for (const position of openPositions) {
      const snapshot = snapshots.find(s => s.token === position.token);
      if (!snapshot || snapshot.price <= 0) continue;

      const currentPnlPct = ((snapshot.price - position.entryPrice) / position.entryPrice) * 100;
      const holdTimeMinutes = (Date.now() - position.entryTime.getTime()) / 60000;

      // Hard stop-loss check (no AI needed)
      if (currentPnlPct <= -strategy.parameters.trailingStopPct) {
        console.log(
          `[DarwinFi] HARD STOP triggered for ${position.token}: ` +
          `PnL=${currentPnlPct.toFixed(2)}% <= -${strategy.parameters.trailingStopPct}%`
        );
        await this.executeSell(strategy, position, snapshot.price, 'hard_stop');
        continue;
      }

      // Take-profit check
      if (currentPnlPct >= strategy.parameters.takeProfitPct) {
        console.log(
          `[DarwinFi] TAKE PROFIT triggered for ${position.token}: ` +
          `PnL=${currentPnlPct.toFixed(2)}% >= ${strategy.parameters.takeProfitPct}%`
        );
        await this.executeSell(strategy, position, snapshot.price, 'take_profit');
        continue;
      }

      // Venice AI exit evaluation
      try {
        const exitSignal = await this.veniceEngine.evaluateExit(
          strategy,
          snapshot,
          position.entryPrice,
          currentPnlPct,
          holdTimeMinutes,
        );

        if (exitSignal.action === 'sell' && exitSignal.confidence >= 70) {
          console.log(
            `[DarwinFi] Venice EXIT signal for ${position.token}: ` +
            `confidence=${exitSignal.confidence} reason="${exitSignal.reasoning}"`
          );
          await this.executeSell(strategy, position, snapshot.price, 'venice_signal');
        } else if (exitSignal.action === 'tighten_stop' && exitSignal.newStopPrice) {
          console.log(
            `[DarwinFi] Venice TIGHTEN STOP for ${position.token}: ` +
            `new stop=$${exitSignal.newStopPrice}`
          );
          // In a full implementation, update the trailing stop here
        }
      } catch (err) {
        console.warn(
          `[DarwinFi] Venice exit evaluation failed for ${position.token}:`,
          err instanceof Error ? err.message : err,
        );
        // Don't exit on failure -- hard stops still protect us
      }
    }

    // Also handle sell-only strategies
    const sellOnlyStrategies = this.strategyManager.getSellOnlyStrategies();
    for (const sellOnly of sellOnlyStrategies) {
      const positions = this.performanceTracker.getOpenPositions(sellOnly.id);
      for (const position of positions) {
        const snapshot = snapshots.find(s => s.token === position.token);
        if (!snapshot || snapshot.price <= 0) continue;

        // Sell-only: aggressively exit all positions
        const currentPnlPct = ((snapshot.price - position.entryPrice) / position.entryPrice) * 100;
        if (currentPnlPct > 0 || currentPnlPct <= -3) {
          // Exit if profitable or if loss exceeds 3%
          await this.executeSell(sellOnly, position, snapshot.price, 'sell_only_exit');
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Trade Execution
  // -------------------------------------------------------------------------

  private async executeBuy(
    strategy: StrategyGenome,
    signal: EntrySignal,
    snapshot: MarketSnapshot,
  ): Promise<void> {
    this.tradeIdCounter += 1;
    const tradeId = `trade-${this.tradeIdCounter}-${Date.now()}`;

    console.log(
      `[DarwinFi] ${this.config.dryRun ? '[DRY RUN] ' : ''}BUY ${signal.token} ` +
      `@ $${snapshot.price} | confidence=${signal.confidence} | ` +
      `strategy=${strategy.id} | stop=$${signal.suggestedStop.toFixed(4)} | ` +
      `target=$${signal.suggestedTarget.toFixed(4)}`
    );

    if (!this.config.dryRun && strategy.status === 'live') {
      // TODO: Execute real trade via Uniswap V3 router
      // const tx = await this.executeSwap(TOKEN_UNIVERSE[signal.token].address, ...);
      console.log(`[DarwinFi] [TODO] Real trade execution not yet implemented`);
    }

    // Record the trade (paper or live)
    const trade: TradeRecord = {
      id: tradeId,
      strategyId: strategy.id,
      token: signal.token,
      side: 'buy',
      entryPrice: snapshot.price,
      quantity: signal.suggestedSize / 100, // Normalize to fraction
      entryTime: new Date(),
      status: 'open',
      fees: 0,
    };

    this.performanceTracker.recordTrade(trade);
  }

  private async executeSell(
    strategy: StrategyGenome,
    position: TradeRecord,
    currentPrice: number,
    reason: string,
  ): Promise<void> {
    console.log(
      `[DarwinFi] ${this.config.dryRun ? '[DRY RUN] ' : ''}SELL ${position.token} ` +
      `@ $${currentPrice} (entry: $${position.entryPrice}) | ` +
      `reason=${reason} | strategy=${strategy.id}`
    );

    if (!this.config.dryRun && strategy.status === 'live') {
      // TODO: Execute real sell via Uniswap V3 router
      console.log(`[DarwinFi] [TODO] Real trade execution not yet implemented`);
    }

    // Close the trade in the tracker
    const closedTrade = this.performanceTracker.closeTrade(
      strategy.id,
      position.id,
      currentPrice,
      new Date(),
      0, // fees placeholder
    );

    if (closedTrade) {
      console.log(
        `[DarwinFi] Trade closed: ${closedTrade.token} PnL=$${closedTrade.pnl?.toFixed(4)} ` +
        `(${closedTrade.pnlPct?.toFixed(2)}%)`
      );
    }
  }

  // -------------------------------------------------------------------------
  // Paper Trading
  // -------------------------------------------------------------------------

  /**
   * Run a simplified paper trading cycle for all non-live strategies.
   * This uses the same Venice engine but does not execute real trades.
   */
  private async runPaperTradingCycle(snapshots: MarketSnapshot[]): Promise<void> {
    const allStrategies = this.strategyManager.getAllStrategies();
    const paperStrategies = allStrategies.filter(
      s => s.status === 'paper' && s.type !== 'variation' // Only paper-trade mains, not variations directly
    );

    for (const strategy of paperStrategies) {
      try {
        // Evaluate exits first
        await this.evaluateExits(strategy, snapshots);

        // Then entries
        const relevantSnapshots = snapshots.filter(
          s => strategy.parameters.tokenPreferences.includes(s.token)
        );
        const openPositions = this.performanceTracker.getOpenPositions(strategy.id);

        if (openPositions.length >= strategy.parameters.maxPositions) continue;
        if (relevantSnapshots.length === 0) continue;

        // Use the first preferred token with data for paper entry evaluation
        for (const snapshot of relevantSnapshots) {
          if (snapshot.price <= 0) continue;
          if (openPositions.some(p => p.token === snapshot.token)) continue;
          if (openPositions.length >= strategy.parameters.maxPositions) break;

          const signal = await this.veniceEngine.evaluateEntry(strategy, snapshot);
          if (signal.action === 'buy' && signal.confidence >= 60) {
            await this.executeBuy(strategy, signal, snapshot);
          }
        }
      } catch (err) {
        // Paper trading errors are non-critical
        console.warn(
          `[DarwinFi] Paper trading error for ${strategy.id}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Evolution Trigger
  // -------------------------------------------------------------------------

  private async checkEvolutionTrigger(): Promise<void> {
    const now = new Date();
    const msSinceLastEvolution = now.getTime() - this.lastEvolutionTime.getTime();
    const totalTrades = this.performanceTracker.getTotalCompletedTrades();
    const tradessinceLastEvolution = totalTrades - this.tradesAtLastEvolution;

    const timeTriggered = msSinceLastEvolution >= this.config.evolutionIntervalMs;
    const tradeTriggered = tradessinceLastEvolution >= this.config.minTradesForEvolution;

    if (timeTriggered || tradeTriggered) {
      const trigger = timeTriggered ? 'time' : 'trade_count';
      console.log(
        `[DarwinFi] Evolution triggered by ${trigger} ` +
        `(elapsed=${Math.round(msSinceLastEvolution / 60000)}min, ` +
        `trades_since=${tradessinceLastEvolution})`
      );

      try {
        const report = await this.evolutionEngine.runEvolutionCycle(
          this.strategyManager,
          this.performanceTracker,
        );

        this.lastEvolutionTime = new Date();
        this.tradesAtLastEvolution = totalTrades;

        console.log(
          `[DarwinFi] Evolution cycle #${report.cycleNumber} complete: ` +
          `${report.results.length} mutations, ${report.promotionEvents.length} promotions, ` +
          `${report.durationMs}ms`
        );
      } catch (err) {
        console.error(
          '[DarwinFi] Evolution cycle failed:',
          err instanceof Error ? err.message : err,
        );
        // Don't update lastEvolutionTime -- retry next check
      }
    }
  }

  // -------------------------------------------------------------------------
  // Status Reporting
  // -------------------------------------------------------------------------

  printStatusReport(): void {
    const report = this.strategyManager.getStatusReport();
    const liveMetrics = report.live
      ? this.performanceTracker.getMetrics(report.live)
      : null;

    console.log('[DarwinFi] ========== STATUS REPORT ==========');
    console.log(`[DarwinFi] Loop count: ${this.loopCount}`);
    console.log(`[DarwinFi] Evolution cycles: ${this.evolutionEngine.getCycleCount()}`);
    console.log(`[DarwinFi] Total completed trades: ${this.performanceTracker.getTotalCompletedTrades()}`);
    console.log(`[DarwinFi] Dry run: ${this.config.dryRun}`);
    console.log(`[DarwinFi] Live strategy: ${report.live || 'NONE'}`);

    if (liveMetrics) {
      console.log(
        `[DarwinFi]   PnL: $${liveMetrics.totalPnL.toFixed(2)} | ` +
        `WR: ${(liveMetrics.winRate * 100).toFixed(1)}% | ` +
        `Sharpe: ${liveMetrics.sharpeRatio.toFixed(2)} | ` +
        `MaxDD: ${(liveMetrics.maxDrawdown * 100).toFixed(1)}% | ` +
        `Trades: ${liveMetrics.tradesCompleted}`
      );
      console.log(
        `[DarwinFi]   24h PnL: $${liveMetrics.rolling24hPnL.toFixed(2)} | ` +
        `24h WR: ${(liveMetrics.rolling24hWinRate * 100).toFixed(1)}% | ` +
        `24h Sharpe: ${liveMetrics.rolling24hSharpe.toFixed(2)}`
      );
    }

    console.log('[DarwinFi] Leaderboard:');
    for (const entry of report.leaderboard.slice(0, 6)) {
      console.log(`[DarwinFi]   ${entry.id}: score=${entry.score} trades=${entry.trades}`);
    }

    if (report.sellOnly.length > 0) {
      console.log(`[DarwinFi] Sell-only: ${report.sellOnly.join(', ')}`);
    }

    console.log('[DarwinFi] ======== END STATUS REPORT ========');
  }

  // -------------------------------------------------------------------------
  // Shutdown
  // -------------------------------------------------------------------------

  private registerShutdownHandlers(): void {
    const shutdownHandler = async (signal: string) => {
      console.log(`[DarwinFi] Received ${signal}`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdownHandler('SIGINT'));
    process.on('SIGTERM', () => shutdownHandler('SIGTERM'));

    process.on('uncaughtException', (err) => {
      console.error('[DarwinFi] Uncaught exception:', err);
      this.printStatusReport();
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      console.error('[DarwinFi] Unhandled rejection:', reason);
      // Don't exit -- let the main loop handle it
    });
  }

  // -------------------------------------------------------------------------
  // Utilities
  // -------------------------------------------------------------------------

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ---------------------------------------------------------------------------
// Entry Point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('[DarwinFi] Loading configuration...');

  try {
    const config = loadConfig();
    const agent = new DarwinAgent(config);
    await agent.start();
  } catch (err) {
    console.error('[DarwinFi] Fatal error:', err);
    process.exit(1);
  }
}

main();
