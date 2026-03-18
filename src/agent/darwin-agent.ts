/**
 * DarwinFi Agent Core -- Main Orchestrator
 *
 * Entry point for the autonomous trading agent. Ties together:
 *   - Strategy Manager (12 strategies: 3 mains x 4)
 *   - Evolution Engine (Claude API for strategy mutation)
 *   - Venice Engine (real-time market analysis)
 *   - Performance Tracker (composite fitness scoring)
 *   - Price Feed (Uniswap V3 on-chain quotes)
 *   - Live Engine (on-chain trade execution)
 *   - Dashboard (Express web UI)
 *   - State Persistence (JSON file-based)
 *   - Conversation Log (agent decision audit trail)
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
import { PriceFeed, TOKEN_UNIVERSE } from '../trading/price-feed';
import { UniswapClient } from '../trading/uniswap-client';
import { LiveEngine } from '../trading/live-engine';
import { StatePersistence, PersistedState } from './state-persistence';
import { ConversationLog } from './conversation-log';
import { startDashboard, updateDashboardState, updateConversationLog, DashboardState } from '../dashboard/server';

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
  dashboardPort: number;
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
    dashboardPort: parseInt(process.env.DASHBOARD_PORT || '3500', 10),
  };
}

// ---------------------------------------------------------------------------
// DarwinAgent
// ---------------------------------------------------------------------------

class DarwinAgent {
  private config: AgentConfig;
  private performanceTracker: PerformanceTracker;
  private strategyManager: StrategyManager;
  private evolutionEngine: EvolutionEngine;
  private veniceEngine: VeniceEngine;
  private priceFeed: PriceFeed;
  private liveEngine: LiveEngine;
  private statePersistence: StatePersistence;
  private conversationLog: ConversationLog;

  private running: boolean = false;
  private lastEvolutionTime: Date = new Date();
  private tradesAtLastEvolution: number = 0;
  private tradeIdCounter: number = 0;
  private loopCount: number = 0;
  private startTime: Date = new Date();

  constructor(config: AgentConfig) {
    this.config = config;
    this.performanceTracker = new PerformanceTracker();
    this.strategyManager = new StrategyManager(this.performanceTracker);
    this.evolutionEngine = new EvolutionEngine(config.anthropicApiKey);
    this.veniceEngine = new VeniceEngine(config.veniceApiKey);

    // Trading infrastructure
    const uniswap = new UniswapClient();
    this.priceFeed = new PriceFeed(uniswap);
    this.liveEngine = new LiveEngine(undefined, { uniswap, priceFeed: this.priceFeed });

    // Persistence
    this.statePersistence = new StatePersistence();
    this.conversationLog = new ConversationLog();
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

    this.conversationLog.system('agent', 'DarwinFi agent starting', {
      mode: this.config.dryRun ? 'dry_run' : 'live',
      evolutionInterval: this.config.evolutionIntervalMs,
      pollInterval: this.config.pollIntervalMs,
    });

    // Try to load saved state
    const savedState = this.statePersistence.load();
    if (savedState) {
      this.loadState(savedState);
      this.conversationLog.system('agent', 'Resumed from saved state', {
        savedAt: savedState.savedAt,
        strategies: savedState.strategies?.length || 0,
      });
    } else {
      // Initialize fresh strategy population
      this.strategyManager.initialize();
      this.conversationLog.system('agent', 'Initialized fresh strategy population (12 strategies)');
    }

    this.running = true;
    this.startTime = new Date();
    this.lastEvolutionTime = new Date();
    this.tradesAtLastEvolution = 0;

    // Start dashboard
    startDashboard(this.config.dashboardPort);
    this.conversationLog.system('dashboard', `Dashboard started on port ${this.config.dashboardPort}`);

    // Start conversation log periodic flush
    this.conversationLog.startPeriodicFlush(30_000);

    // Start auto-save
    this.statePersistence.startAutoSave(() => this.buildPersistedState());

    // Register shutdown handlers
    this.registerShutdownHandlers();

    // Main loop
    console.log('[DarwinFi] Entering main loop...');
    this.conversationLog.system('agent', 'Entering main trading loop');
    while (this.running) {
      try {
        await this.mainLoopIteration();
        this.updateDashboard();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[DarwinFi] Error in main loop iteration:', msg);
        this.conversationLog.error('agent', `Main loop error: ${msg}`);
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

    // Save state
    this.statePersistence.stopAutoSave();
    this.statePersistence.save(this.buildPersistedState());

    // Flush conversation log
    this.conversationLog.stopPeriodicFlush();
    this.conversationLog.system('agent', 'Agent shutting down');
    this.conversationLog.flushToDisk();

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
   * Fetch market snapshots for all tokens in the universe using real price feeds.
   */
  private async fetchMarketSnapshots(): Promise<MarketSnapshot[]> {
    const snapshots: MarketSnapshot[] = [];
    const symbols = Object.keys(TOKEN_UNIVERSE).filter(s => s !== 'USDC'); // Skip USDC as a trading target

    for (const symbol of symbols) {
      try {
        const priceData = await this.priceFeed.getPrice(symbol);
        if (priceData && priceData.priceUsd > 0) {
          snapshots.push({
            token: symbol,
            price: priceData.priceUsd,
            priceChange1h: 0,
            priceChange24h: 0,
            volume24h: 0,
            volumeChange: 0,
            high24h: 0,
            low24h: 0,
          });
        }
      } catch (err) {
        console.warn(
          `[DarwinFi] Failed to fetch price for ${symbol}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (snapshots.length > 0 && this.loopCount % 10 === 1) {
      console.log(
        `[DarwinFi] Prices: ${snapshots.map(s => `${s.token}=$${s.price.toFixed(2)}`).join(' | ')}`
      );
    }

    return snapshots;
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
      this.conversationLog.aiCall(
        'venice',
        `Token recommendations for ${liveStrategy.id}`,
        'llama-3.3-70b',
        `Recommend tokens for ${liveStrategy.name}`,
        `${recommendations.length} recommendations returned`,
        { recommendations: recommendations.map(r => ({ token: r.token, score: r.score })) },
      );
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
          this.conversationLog.decision(
            'agent',
            `BUY signal: ${snapshot.token} @ $${snapshot.price.toFixed(2)} (confidence: ${signal.confidence})`,
            { strategy: liveStrategy.id, signal },
          );
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
          this.conversationLog.decision(
            'agent',
            `SELL signal (Venice): ${position.token} (confidence: ${exitSignal.confidence})`,
            { strategy: strategy.id, exitSignal },
          );
          await this.executeSell(strategy, position, snapshot.price, 'venice_signal');
        } else if (exitSignal.action === 'tighten_stop' && exitSignal.newStopPrice) {
          console.log(
            `[DarwinFi] Venice TIGHTEN STOP for ${position.token}: ` +
            `new stop=$${exitSignal.newStopPrice}`
          );
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

    // Execute live trade if not dry run and strategy is live
    if (!this.config.dryRun && strategy.status === 'live') {
      try {
        const result = await this.liveEngine.executeLiveTrade({
          strategyId: strategy.id,
          action: 'buy',
          tokenSymbol: signal.token,
          amount: signal.suggestedSize * 0.25, // Scale by $25 budget per strategy
          slippageTolerance: 0.01,
        });
        if (result.success) {
          this.conversationLog.trade('live-engine', `Live BUY executed: ${signal.token}`, {
            txHash: result.txHash,
            amountIn: result.amountIn,
            amountOut: result.amountOut,
            gasUsed: result.gasUsed,
          });
        } else {
          this.conversationLog.error('live-engine', `Live BUY failed: ${result.error}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[DarwinFi] Live trade execution failed: ${msg}`);
        this.conversationLog.error('live-engine', `Live trade failed: ${msg}`);
      }
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

    this.conversationLog.trade(
      'agent',
      `${this.config.dryRun ? '[DRY RUN] ' : ''}BUY ${signal.token} @ $${snapshot.price.toFixed(2)}`,
      {
        tradeId,
        strategy: strategy.id,
        token: signal.token,
        price: snapshot.price,
        confidence: signal.confidence,
        mode: this.config.dryRun ? 'paper' : 'live',
      },
    );
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

    // Execute live sell if not dry run and strategy is live
    if (!this.config.dryRun && strategy.status === 'live') {
      try {
        const result = await this.liveEngine.executeLiveTrade({
          strategyId: strategy.id,
          action: 'sell',
          tokenSymbol: position.token,
          amount: 'max',
          slippageTolerance: 0.01,
        });
        if (result.success) {
          this.conversationLog.trade('live-engine', `Live SELL executed: ${position.token}`, {
            txHash: result.txHash,
            amountIn: result.amountIn,
            amountOut: result.amountOut,
            reason,
          });
        } else {
          this.conversationLog.error('live-engine', `Live SELL failed: ${result.error}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[DarwinFi] Live sell execution failed: ${msg}`);
        this.conversationLog.error('live-engine', `Live sell failed: ${msg}`);
      }
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
      this.conversationLog.trade(
        'agent',
        `${this.config.dryRun ? '[DRY RUN] ' : ''}SELL ${position.token} @ $${currentPrice.toFixed(2)} (PnL: ${closedTrade.pnlPct?.toFixed(2)}%)`,
        {
          tradeId: position.id,
          strategy: strategy.id,
          token: position.token,
          entryPrice: position.entryPrice,
          exitPrice: currentPrice,
          pnl: closedTrade.pnl,
          pnlPct: closedTrade.pnlPct,
          reason,
        },
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

      this.conversationLog.evolution(
        'agent',
        `Evolution cycle triggered by ${trigger}`,
        { elapsed: msSinceLastEvolution, tradesSince: tradessinceLastEvolution },
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

        this.conversationLog.evolution(
          'evolution-engine',
          `Cycle #${report.cycleNumber}: ${report.results.length} mutations, ${report.promotionEvents.length} promotions`,
          {
            cycleNumber: report.cycleNumber,
            mutations: report.results.map(r => ({ id: r.strategyId, role: r.role, reasoning: r.reasoning })),
            promotions: report.promotionEvents,
            durationMs: report.durationMs,
          },
        );

        // Log promotions individually
        for (const promo of report.promotionEvents) {
          this.conversationLog.promotion('strategy-manager', promo);
        }
      } catch (err) {
        console.error(
          '[DarwinFi] Evolution cycle failed:',
          err instanceof Error ? err.message : err,
        );
        this.conversationLog.error('evolution-engine', `Evolution cycle failed: ${err instanceof Error ? err.message : err}`);
        // Don't update lastEvolutionTime -- retry next check
      }
    }
  }

  // -------------------------------------------------------------------------
  // Dashboard Update
  // -------------------------------------------------------------------------

  private updateDashboard(): void {
    const allStrategies = this.strategyManager.getAllStrategies();
    const report = this.strategyManager.getStatusReport();
    const uptimeSeconds = (Date.now() - this.startTime.getTime()) / 1000;

    const strategies: DashboardState['strategies'] = allStrategies.map(s => {
      const metrics = this.performanceTracker.getMetrics(s.id);
      const score = this.performanceTracker.getCompositeScore(s.id);
      return {
        id: s.id,
        name: s.name,
        type: s.type,
        role: s.role,
        status: s.status,
        score: Math.round(score * 1000) / 1000,
        pnl: metrics?.totalPnL ?? 0,
        winRate: metrics?.winRate ?? 0,
        trades: metrics?.tradesCompleted ?? 0,
        generation: s.generation,
      };
    });

    // Collect recent trades from all strategies
    const recentTrades: DashboardState['recentTrades'] = [];
    for (const s of allStrategies) {
      const metrics = this.performanceTracker.getMetrics(s.id);
      if (!metrics) continue;
      const recent = metrics.tradeHistory
        .filter(t => t.status === 'closed')
        .slice(-5);
      for (const t of recent) {
        recentTrades.push({
          timestamp: (t.exitTime || t.entryTime).toISOString(),
          strategyId: t.strategyId,
          action: t.side,
          token: t.token,
          amount: t.quantity,
          price: t.exitPrice || t.entryPrice,
          pnl: t.pnl,
        });
      }
    }
    recentTrades.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Collect evolution history from conversation log
    const evolutionEntries = this.conversationLog.getEntries('evolution', 20)
      .concat(this.conversationLog.getEntries('promotion', 20));
    const evolutionHistory: DashboardState['evolutionHistory'] = evolutionEntries
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 20)
      .map(e => ({
        timestamp: e.timestamp,
        event: e.type,
        details: e.summary,
      }));

    // Total PnL from live strategy
    const liveId = report.live;
    const liveMetrics = liveId ? this.performanceTracker.getMetrics(liveId) : null;

    updateDashboardState({
      strategies,
      liveStrategy: report.live,
      lastEvolution: this.lastEvolutionTime.toISOString(),
      totalPnL: liveMetrics?.totalPnL ?? 0,
      uptime: uptimeSeconds,
      recentTrades: recentTrades.slice(0, 20),
      evolutionHistory,
    });

    // Push conversation log entries to the dashboard server
    updateConversationLog(this.conversationLog.serialize());
  }

  // -------------------------------------------------------------------------
  // State Persistence
  // -------------------------------------------------------------------------

  private buildPersistedState(): PersistedState {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      agent: {
        loopCount: this.loopCount,
        tradeIdCounter: this.tradeIdCounter,
        lastEvolutionTime: this.lastEvolutionTime.toISOString(),
        tradesAtLastEvolution: this.tradesAtLastEvolution,
        evolutionCycleCount: this.evolutionEngine.getCycleCount(),
        startTime: this.startTime.toISOString(),
      },
      strategies: this.strategyManager.serialize(),
      performance: this.performanceTracker.serialize(),
      conversationLog: this.conversationLog.serialize(),
    };
  }

  private loadState(state: PersistedState): void {
    console.log('[DarwinFi] Loading saved state...');

    // Restore agent counters
    if (state.agent) {
      this.loopCount = state.agent.loopCount || 0;
      this.tradeIdCounter = state.agent.tradeIdCounter || 0;
      this.lastEvolutionTime = new Date(state.agent.lastEvolutionTime || Date.now());
      this.tradesAtLastEvolution = state.agent.tradesAtLastEvolution || 0;
    }

    // Restore strategies
    if (state.strategies && state.strategies.length > 0) {
      // Re-initialize with saved genomes
      this.strategyManager.initialize(); // Sets up defaults first
      for (const genome of state.strategies) {
        this.strategyManager.updateGenome(genome.id, genome.parameters);
      }
      console.log(`[DarwinFi] Restored ${state.strategies.length} strategy genomes`);
    } else {
      this.strategyManager.initialize();
    }

    // Restore performance metrics
    if (state.performance) {
      for (const [id, metrics] of Object.entries(state.performance)) {
        this.performanceTracker.initStrategy(id, true);
        // Replay trade history to rebuild metrics
        if (metrics.tradeHistory) {
          for (const trade of metrics.tradeHistory) {
            if (trade.status === 'closed') {
              this.performanceTracker.recordTrade(trade);
            }
          }
        }
      }
      console.log(`[DarwinFi] Restored performance metrics for ${Object.keys(state.performance).length} strategies`);
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
      this.conversationLog.error('agent', `Uncaught exception: ${err.message}`);
      this.conversationLog.flushToDisk();
      this.statePersistence.save(this.buildPersistedState());
      this.printStatusReport();
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      console.error('[DarwinFi] Unhandled rejection:', reason);
      this.conversationLog.error('agent', `Unhandled rejection: ${reason}`);
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
