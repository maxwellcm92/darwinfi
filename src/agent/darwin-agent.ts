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
import { ClaudeCliEngine } from './claude-cli-engine';
import { MarketSnapshot, EntrySignal } from './venice-engine';
import { PriceFeed, TOKEN_UNIVERSE } from '../trading/price-feed';
import { UniswapClient } from '../trading/uniswap-client';
import { LiveEngine } from '../trading/live-engine';
import { computeAllIndicators, PricePoint } from '../trading/indicators';
import { StatePersistence, PersistedState } from './state-persistence';
import { ConversationLog } from './conversation-log';
import { startDashboard, updateDashboardState, updateConversationLog, DashboardState } from '../dashboard/server';
import { ContractClient } from '../chain/contract-client';
import { FilecoinStore } from '../integrations/filecoin';

// ---------------------------------------------------------------------------
// Strategy ID -> uint256 mapping for on-chain logging
// ---------------------------------------------------------------------------

const STRATEGY_ID_MAP: Record<string, bigint> = {
  'main-alpha': 0n,
  'main-alpha-exp': 1n,
  'main-alpha-opt': 2n,
  'main-alpha-syn': 3n,
  'main-beta': 4n,
  'main-beta-exp': 5n,
  'main-beta-opt': 6n,
  'main-beta-syn': 7n,
  'main-gamma': 8n,
  'main-gamma-exp': 9n,
  'main-gamma-opt': 10n,
  'main-gamma-syn': 11n,
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface AgentConfig {
  veniceApiKey: string;
  evolutionIntervalMs: number;
  minTradesForEvolution: number;
  pollIntervalMs: number;
  signalIntervalMs: number;
  dryRun: boolean;
  dashboardPort: number;
}

function loadConfig(): AgentConfig {
  const veniceApiKey = process.env.VENICE_API_KEY;
  if (!veniceApiKey) {
    throw new Error('VENICE_API_KEY is required in .env');
  }

  const evolutionHours = parseInt(process.env.EVOLUTION_INTERVAL_HOURS || '4', 10);
  const minTrades = parseInt(process.env.MIN_TRADES_FOR_PROMOTION || '5', 10);
  const signalIntervalSec = parseInt(process.env.SIGNAL_INTERVAL_SEC || '120', 10);

  return {
    veniceApiKey,
    evolutionIntervalMs: evolutionHours * 60 * 60 * 1000,
    minTradesForEvolution: minTrades * 2, // 10 trades = 2x the promotion minimum
    pollIntervalMs: 30_000, // 30 seconds between fast ticks (price fetch + rule-based checks)
    signalIntervalMs: signalIntervalSec * 1000, // Claude CLI signal evaluation interval
    dryRun: process.env.DRY_RUN === 'true',
    dashboardPort: parseInt(process.env.DASHBOARD_PORT || '3502', 10),
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
  private signalEngine: ClaudeCliEngine;
  private priceFeed: PriceFeed;
  private liveEngine: LiveEngine;
  private statePersistence: StatePersistence;
  private conversationLog: ConversationLog;
  private contractClient: ContractClient | null = null;
  private filecoinStore: FilecoinStore | null = null;

  private priceHistory: Map<string, Array<{price: number, timestamp: number}>> = new Map();
  private running: boolean = false;
  private lastEvolutionTime: Date = new Date();
  private lastSignalTime: Date = new Date(0); // Force signal eval on first eligible tick
  private tradesAtLastEvolution: number = 0;
  private tradeIdCounter: number = 0;
  private loopCount: number = 0;
  private startTime: Date = new Date();
  private latestSnapshots: MarketSnapshot[] = [];
  private dexScreenerCache: Map<string, { volume24h: number; priceChange24h: number; timestamp: number }> = new Map();
  private readonly DEXSCREENER_CACHE_TTL = 60_000; // 60s cache

  constructor(config: AgentConfig) {
    this.config = config;
    this.performanceTracker = new PerformanceTracker();
    this.strategyManager = new StrategyManager(this.performanceTracker);
    this.evolutionEngine = new EvolutionEngine(config.veniceApiKey);
    this.signalEngine = new ClaudeCliEngine();

    // Trading infrastructure (RPC health check happens at start())
    const uniswap = new UniswapClient();
    this.priceFeed = new PriceFeed(uniswap);
    const useVaultV2 = !!process.env.DARWIN_VAULT_V2_ADDRESS;
    this.liveEngine = new LiveEngine(
      { useVaultV2 },
      { uniswap, priceFeed: this.priceFeed }
    );

    // Persistence
    this.statePersistence = new StatePersistence();
    this.conversationLog = new ConversationLog();

    // On-chain logging (optional -- only if contract deployed)
    if (process.env.PERFORMANCE_LOG_ADDRESS) {
      try {
        this.contractClient = new ContractClient();
        console.log('[DarwinFi] ContractClient initialized for on-chain logging');
      } catch (err) {
        console.warn('[DarwinFi] ContractClient init failed, on-chain logging disabled:', err);
      }
    }

    // IPFS genome pinning (optional -- only if Storacha proof configured)
    if (process.env.STORACHA_PROOF) {
      this.filecoinStore = new FilecoinStore(process.env.STORACHA_PROOF);
      console.log('[DarwinFi] FilecoinStore initialized for IPFS genome pinning');
    }
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
    console.log(`[DarwinFi] Fast tick (prices + rule-based): ${this.config.pollIntervalMs / 1000}s`);
    console.log(`[DarwinFi] Signal tick (Claude CLI batch): ${this.config.signalIntervalMs / 1000}s`);
    console.log(`[DarwinFi] Evolution tick (Venice API): ${this.config.evolutionIntervalMs / 3600000}h`);
    console.log(`[DarwinFi] Evolution trade trigger: ${this.config.minTradesForEvolution} trades`);

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

    // RPC health check with fallback rotation
    const { getBaseClient } = await import('../chain/base-client');
    const baseClient = getBaseClient();
    const rpcOk = await baseClient.healthCheck();
    if (rpcOk) {
      console.log('[DarwinFi] RPC health check passed');
    } else {
      console.error('[DarwinFi] WARNING: All RPC endpoints failed health check. Will retry on first price fetch.');
    }

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

    // === FAST TICK (every 30s): Fetch prices, rule-based stops/profits, update dashboard ===

    // Step 1: Fetch market data for the token universe
    const snapshots = await this.fetchMarketSnapshots();
    if (snapshots.length === 0) {
      console.warn('[DarwinFi] No market data available, skipping iteration');
      return;
    }
    this.latestSnapshots = snapshots;

    // Step 2: Get the live strategy (may be undefined during qualification phase)
    const liveStrategy = this.strategyManager.getLiveStrategy();

    // Step 3: Rule-based exits (hard stops, take profits) -- no AI needed
    if (liveStrategy) {
      await this.evaluateRuleBasedExits(liveStrategy, snapshots);
    }

    // === SIGNAL TICK (every ~2min): Claude CLI batch evaluation for entries/exits ===
    const now = new Date();
    const msSinceLastSignal = now.getTime() - this.lastSignalTime.getTime();

    if (msSinceLastSignal >= this.config.signalIntervalMs) {
      this.lastSignalTime = now;

      try {
        if (liveStrategy) {
          // AI-powered exit evaluation (batch)
          await this.evaluateAiExits(liveStrategy, snapshots);

          // AI-powered entry evaluation (batch)
          await this.evaluateEntries(liveStrategy, snapshots);
        }

        // Paper trading for non-live strategies (always runs, crucial during qualification)
        await this.runPaperTradingCycle(snapshots);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[DarwinFi] Signal tick error: ${msg}`);
        this.conversationLog.error('agent', `Signal tick error: ${msg}`);
      }
    }

    // === EVOLUTION TICK (every ~4h): Venice API evolution cycle ===
    await this.checkEvolutionTrigger();

    // Periodic status log (every 10 iterations)
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

    // Fetch all prices in parallel
    const results = await Promise.allSettled(
      symbols.map(symbol => this.priceFeed.getPrice(symbol).then(data => ({ symbol, data })))
    );

    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;
    const TWENTY_FOUR_HOURS = 24 * ONE_HOUR;
    const MAX_HISTORY = 100;

    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn(`[DarwinFi] Failed to fetch price:`, result.reason);
        continue;
      }
      const { symbol, data: priceData } = result.value;
      if (!priceData || priceData.priceUsd <= 0) continue;

      // Update price history buffer
      const history = this.priceHistory.get(symbol) || [];
      history.push({ price: priceData.priceUsd, timestamp: now });
      // Keep last MAX_HISTORY entries
      if (history.length > MAX_HISTORY) {
        history.splice(0, history.length - MAX_HISTORY);
      }
      this.priceHistory.set(symbol, history);

      // Compute price changes from history buffer
      let priceChange1h = 0;
      let priceChange24h = 0;

      // Find the closest entry to 1h ago
      const target1h = now - ONE_HOUR;
      const entry1h = history.find(h => h.timestamp <= target1h);
      if (entry1h) {
        priceChange1h = ((priceData.priceUsd - entry1h.price) / entry1h.price) * 100;
      }

      // Find the closest entry to 24h ago
      const target24h = now - TWENTY_FOUR_HOURS;
      const entry24h = history.find(h => h.timestamp <= target24h);
      if (entry24h) {
        priceChange24h = ((priceData.priceUsd - entry24h.price) / entry24h.price) * 100;
      }

      // Compute technical indicators from price history buffer
      const indicators = computeAllIndicators(history as PricePoint[]);

      // Fetch DexScreener volume data
      const tokenDef = TOKEN_UNIVERSE[symbol];
      const dexData = await this.fetchDexScreenerData(tokenDef?.address || '');

      snapshots.push({
        token: symbol,
        price: priceData.priceUsd,
        priceChange1h,
        priceChange24h,
        volume24h: dexData?.volume24h || 0,
        volumeChange: 0,
        high24h: 0,
        low24h: 0,
        rsi: indicators.rsi,
        ema9: indicators.ema9,
        ema21: indicators.ema21,
        macd: indicators.macd,
        macdSignal: indicators.macdSignal,
        bollingerUpper: indicators.bollingerUpper,
        bollingerLower: indicators.bollingerLower,
      });
    }

    if (snapshots.length > 0 && this.loopCount % 10 === 1) {
      console.log(
        `[DarwinFi] Prices: ${snapshots.map(s => {
          let line = `${s.token}=$${s.price.toFixed(4)}`;
          if (s.rsi !== undefined) line += ` RSI:${s.rsi.toFixed(0)}`;
          if (s.macd !== undefined) line += ` MACD:${s.macd.toFixed(4)}`;
          return line;
        }).join(' | ')}`
      );
    }

    return snapshots;
  }

  /**
   * Fetch volume and price change from DexScreener API (free, no key).
   * Cached for 60s to avoid rate limiting.
   */
  private async fetchDexScreenerData(tokenAddress: string): Promise<{ volume24h: number; priceChange24h: number } | null> {
    if (!tokenAddress) return null;

    const cached = this.dexScreenerCache.get(tokenAddress);
    if (cached && Date.now() - cached.timestamp < this.DEXSCREENER_CACHE_TTL) {
      return { volume24h: cached.volume24h, priceChange24h: cached.priceChange24h };
    }

    try {
      const resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return null;

      const data = await resp.json() as any;
      const pairs = data?.pairs;
      if (!pairs || pairs.length === 0) return null;

      // Use the highest-liquidity pair
      const best = pairs.sort((a: any, b: any) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))[0];
      const result = {
        volume24h: best.volume?.h24 || 0,
        priceChange24h: best.priceChange?.h24 || 0,
        timestamp: Date.now(),
      };

      this.dexScreenerCache.set(tokenAddress, result);
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Rule-based entry bypass: fire paper trades when mathematical conditions
   * are met without waiting for AI. Breaks the bootstrap deadlock.
   */
  private evaluateRuleBasedEntries(
    strategy: StrategyGenome,
    snapshots: MarketSnapshot[],
  ): EntrySignal[] {
    const signals: EntrySignal[] = [];
    const relevantSnapshots = snapshots.filter(
      s => strategy.parameters.tokenPreferences.includes(s.token) && s.price > 0
    );

    for (const snapshot of relevantSnapshots) {
      let triggered = false;
      let reasoning = '';

      switch (strategy.parameters.entryMethod) {
        case 'rsi_oversold':
          if (snapshot.rsi !== undefined && snapshot.rsi < strategy.parameters.entryThreshold) {
            triggered = true;
            reasoning = `RSI ${snapshot.rsi.toFixed(1)} < threshold ${strategy.parameters.entryThreshold}`;
          }
          break;

        case 'ema_crossover':
          if (snapshot.ema9 !== undefined && snapshot.ema21 !== undefined) {
            const crossoverPct = ((snapshot.ema9 - snapshot.ema21) / snapshot.ema21) * 100;
            if (crossoverPct > strategy.parameters.entryThreshold) {
              triggered = true;
              reasoning = `EMA9/21 crossover ${crossoverPct.toFixed(2)}% > threshold ${strategy.parameters.entryThreshold}%`;
            }
          }
          break;

        case 'bollinger_bounce':
          if (snapshot.bollingerLower !== undefined && snapshot.price > 0) {
            const distanceBelowBand = (snapshot.bollingerLower - snapshot.price) / snapshot.price;
            if (snapshot.price < snapshot.bollingerLower) {
              triggered = true;
              reasoning = `Price $${snapshot.price.toFixed(4)} below Bollinger lower $${snapshot.bollingerLower.toFixed(4)}`;
            }
          }
          break;

        case 'macd_signal':
          if (snapshot.macd !== undefined && snapshot.macdSignal !== undefined) {
            if (snapshot.macd > snapshot.macdSignal && snapshot.macd < 0) {
              triggered = true;
              reasoning = `MACD ${snapshot.macd.toFixed(4)} crossed above signal ${snapshot.macdSignal.toFixed(4)} from negative`;
            }
          }
          break;
      }

      if (triggered) {
        signals.push({
          token: snapshot.token,
          action: 'buy',
          confidence: 70, // Rule-based = mathematically met
          reasoning: `[RULE-BASED] ${reasoning}`,
          suggestedSize: strategy.parameters.riskPerTradePct * 10,
          suggestedEntry: snapshot.price,
          suggestedStop: snapshot.price * (1 - strategy.parameters.trailingStopPct / 100),
          suggestedTarget: snapshot.price * (1 + strategy.parameters.takeProfitPct / 100),
        });
      }
    }

    return signals;
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

    // Get token recommendations via Claude CLI (batch)
    let recommendations;
    try {
      recommendations = await this.signalEngine.recommendTokens(liveStrategy, relevantSnapshots);
      this.conversationLog.aiCall(
        'claude-cli',
        `Token recommendations for ${liveStrategy.id}`,
        'claude-haiku-4-5',
        `Recommend tokens for ${liveStrategy.name}`,
        `${recommendations.length} recommendations returned`,
        { recommendations: recommendations.map(r => ({ token: r.token, score: r.score })) },
      );
    } catch (err) {
      console.warn(
        '[DarwinFi] Claude CLI token recommendation failed:',
        err instanceof Error ? err.message : err,
      );
      return;
    }

    // Filter to actionable recommendations
    const actionableRecs = recommendations.filter(r => r.score >= 8);
    const recsToEvaluate = actionableRecs.filter(rec => {
      const snapshot = snapshots.find(s => s.token === rec.token);
      return snapshot && snapshot.price > 0 && !openPositions.some(p => p.token === rec.token);
    });

    if (recsToEvaluate.length === 0) return;

    // Batch evaluate entries via Claude CLI (one call for all candidates)
    const evalSnapshots = recsToEvaluate
      .map(rec => snapshots.find(s => s.token === rec.token)!)
      .filter(Boolean);

    try {
      const signals = await this.signalEngine.evaluateEntry(liveStrategy, evalSnapshots);

      this.conversationLog.aiCall(
        'claude-cli',
        `Batch entry evaluation for ${liveStrategy.id}`,
        'claude-haiku-4-5',
        `Evaluate ${evalSnapshots.length} tokens for entry`,
        `${signals.filter(s => s.action === 'buy').length} buy signals`,
        {},
      );

      for (const signal of signals) {
        if (signal.action === 'buy' && signal.confidence >= 60) {
          if (openPositions.length >= liveStrategy.parameters.maxPositions) break;

          const snapshot = snapshots.find(s => s.token === signal.token);
          if (!snapshot) continue;

          this.conversationLog.decision(
            'agent',
            `BUY signal: ${snapshot.token} @ $${snapshot.price.toFixed(2)} (confidence: ${signal.confidence})`,
            { strategy: liveStrategy.id, signal },
          );
          await this.executeBuy(liveStrategy, signal, snapshot);
        }
      }
    } catch (err) {
      console.error(
        '[DarwinFi] Batch entry evaluation failed:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Exit Evaluation
  // -------------------------------------------------------------------------

  /**
   * Rule-based exits only: hard stops and take profits.
   * Runs every fast tick (30s) -- no AI calls, completely free.
   */
  private async evaluateRuleBasedExits(
    strategy: StrategyGenome,
    snapshots: MarketSnapshot[],
  ): Promise<void> {
    const openPositions = this.performanceTracker.getOpenPositions(strategy.id);
    if (openPositions.length === 0) return;

    for (const position of openPositions) {
      const snapshot = snapshots.find(s => s.token === position.token);
      if (!snapshot || snapshot.price <= 0) continue;

      const currentPnlPct = ((snapshot.price - position.entryPrice) / position.entryPrice) * 100;

      // Hard stop-loss check
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
    }

    // Also handle sell-only strategies (rule-based)
    const sellOnlyStrategies = this.strategyManager.getSellOnlyStrategies();
    for (const sellOnly of sellOnlyStrategies) {
      const positions = this.performanceTracker.getOpenPositions(sellOnly.id);
      for (const position of positions) {
        const snapshot = snapshots.find(s => s.token === position.token);
        if (!snapshot || snapshot.price <= 0) continue;

        const currentPnlPct = ((snapshot.price - position.entryPrice) / position.entryPrice) * 100;
        if (currentPnlPct > 0 || currentPnlPct <= -3) {
          await this.executeSell(sellOnly, position, snapshot.price, 'sell_only_exit');
        }
      }
    }
  }

  /**
   * AI-powered exit evaluation via Claude CLI (batch).
   * Runs every signal tick (~2min).
   */
  private async evaluateAiExits(
    strategy: StrategyGenome,
    snapshots: MarketSnapshot[],
  ): Promise<void> {
    const openPositions = this.performanceTracker.getOpenPositions(strategy.id);
    if (openPositions.length === 0) return;

    // Build batch payload for all open positions
    const positionData = openPositions
      .map(position => {
        const snapshot = snapshots.find(s => s.token === position.token);
        if (!snapshot || snapshot.price <= 0) return null;
        const currentPnlPct = ((snapshot.price - position.entryPrice) / position.entryPrice) * 100;
        const holdTimeMinutes = (Date.now() - position.entryTime.getTime()) / 60000;
        return { token: position.token, snapshot, entryPrice: position.entryPrice, currentPnlPct, holdTimeMinutes };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    if (positionData.length === 0) return;

    try {
      const exitSignals = await this.signalEngine.evaluateExit(strategy, positionData);

      this.conversationLog.aiCall(
        'claude-cli',
        `Batch exit evaluation for ${strategy.id}`,
        'claude-haiku-4-5',
        `Evaluate ${positionData.length} positions for exit`,
        `${exitSignals.filter(s => s.action === 'sell').length} sell signals`,
        {},
      );

      for (const exitSignal of exitSignals) {
        if (exitSignal.action === 'sell' && exitSignal.confidence >= 70) {
          const position = openPositions.find(p => p.token === exitSignal.token);
          const snapshot = snapshots.find(s => s.token === exitSignal.token);
          if (!position || !snapshot) continue;

          console.log(
            `[DarwinFi] Claude CLI EXIT signal for ${position.token}: ` +
            `confidence=${exitSignal.confidence} reason="${exitSignal.reasoning}"`
          );
          this.conversationLog.decision(
            'agent',
            `SELL signal (Claude CLI): ${position.token} (confidence: ${exitSignal.confidence})`,
            { strategy: strategy.id, exitSignal },
          );
          await this.executeSell(strategy, position, snapshot.price, 'cli_signal');
        } else if (exitSignal.action === 'tighten_stop' && exitSignal.newStopPrice) {
          console.log(
            `[DarwinFi] Claude CLI TIGHTEN STOP for ${exitSignal.token}: ` +
            `new stop=$${exitSignal.newStopPrice}`
          );
        }
      }
    } catch (err) {
      console.warn(
        '[DarwinFi] Claude CLI batch exit evaluation failed:',
        err instanceof Error ? err.message : err,
      );
      // Rule-based stops still protect us from the fast tick
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
        // Scale trade size: use vault TVL (5% per trade) if VaultV2 active, else fixed $25 budget
        const maxTradeSize = await this.liveEngine.getVaultScaledMaxTradeSize();
        const tradeAmount = this.liveEngine.isVaultV2Active()
          ? Math.min(signal.suggestedSize * 0.25, maxTradeSize)
          : signal.suggestedSize * 0.25;

        const result = await this.liveEngine.executeLiveTrade({
          strategyId: strategy.id,
          action: 'buy',
          tokenSymbol: signal.token,
          amount: tradeAmount,
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

    // Estimate Uniswap V3 fees (0.3% fee tier on both entry and exit)
    const estimatedFees = position.entryPrice * position.quantity * 0.003;

    // Close the trade in the tracker
    const closedTrade = this.performanceTracker.closeTrade(
      strategy.id,
      position.id,
      currentPrice,
      new Date(),
      estimatedFees,
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

      // On-chain trade logging (non-fatal)
      if (this.contractClient) {
        const stratId = STRATEGY_ID_MAP[strategy.id];
        if (stratId !== undefined) {
          const pnlBigInt = BigInt(Math.round((closedTrade.pnl ?? 0) * 1e6)); // 6 decimal places
          const win = (closedTrade.pnl ?? 0) > 0;
          this.contractClient.logTradeResult(stratId, pnlBigInt, win)
            .then(hash => console.log(`[DarwinFi] On-chain trade log: ${hash}`))
            .catch(err => console.error(`[DarwinFi] On-chain trade log failed: ${err.message}`));
        }
      }

      // During qualification mode, promote the first strategy with a profitable trade
      if (!this.strategyManager.getLiveStrategy()) {
        const promoted = this.strategyManager.promoteFirstQualified(closedTrade);
        if (promoted) {
          this.conversationLog.promotion('strategy-manager',
            `Qualification: ${promoted} promoted to live after first profitable trade`
          );
        }
      }
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
      s => s.status === 'paper' && s.type !== 'variation'
    );

    for (const strategy of paperStrategies) {
      try {
        // Rule-based exits for paper strategies
        await this.evaluateRuleBasedExits(strategy, snapshots);

        // AI exits for paper strategies
        await this.evaluateAiExits(strategy, snapshots);

        // Then entries
        const openPositions = this.performanceTracker.getOpenPositions(strategy.id);
        if (openPositions.length >= strategy.parameters.maxPositions) continue;

        // === RULE-BASED ENTRY BYPASS (fast path, no AI needed) ===
        const ruleSignals = this.evaluateRuleBasedEntries(strategy, snapshots);
        for (const signal of ruleSignals) {
          if (openPositions.length >= strategy.parameters.maxPositions) break;
          if (openPositions.some(p => p.token === signal.token)) continue;
          const snapshot = snapshots.find(s => s.token === signal.token);
          if (snapshot) {
            console.log(`[DarwinFi] RULE-BASED paper entry: ${signal.token} (${signal.reasoning})`);
            await this.executeBuy(strategy, signal, snapshot);
          }
        }

        // === AI-BASED ENTRIES (lower threshold for paper: 45 vs 60 for live) ===
        const relevantSnapshots = snapshots.filter(
          s => strategy.parameters.tokenPreferences.includes(s.token)
        );
        if (relevantSnapshots.length === 0) continue;

        // Filter to tokens we don't already hold (including any just opened by rule-based)
        const currentPositions = this.performanceTracker.getOpenPositions(strategy.id);
        const candidates = relevantSnapshots.filter(
          s => s.price > 0 && !currentPositions.some(p => p.token === s.token)
        );
        if (candidates.length === 0) continue;
        if (currentPositions.length >= strategy.parameters.maxPositions) continue;

        // Batch evaluate entries via Claude CLI
        const signals = await this.signalEngine.evaluateEntry(strategy, candidates);
        for (const signal of signals) {
          // Paper mode uses confidence >= 45 (vs 60 for live)
          if (signal.action === 'buy' && signal.confidence >= 45) {
            if (currentPositions.length >= strategy.parameters.maxPositions) break;
            const snapshot = snapshots.find(s => s.token === signal.token);
            if (snapshot) {
              await this.executeBuy(strategy, signal, snapshot);
            }
          }
        }
      } catch (err) {
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

    // Accelerate evolution to 1h during qualification mode (no live strategy yet)
    const evolutionInterval = this.strategyManager.qualificationMode
      ? Math.min(this.config.evolutionIntervalMs, 60 * 60 * 1000) // 1h max during qualification
      : this.config.evolutionIntervalMs;
    const timeTriggered = msSinceLastEvolution >= evolutionInterval;
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

        // On-chain evolution logging (non-fatal)
        if (this.contractClient) {
          this.contractClient.advanceGeneration()
            .then(hash => console.log(`[DarwinFi] On-chain generation advanced: ${hash}`))
            .catch(err => console.error(`[DarwinFi] On-chain advanceGeneration failed: ${err.message}`));

          // Log the live strategy's genome hash (with IPFS pinning if configured)
          const liveStrategy = this.strategyManager.getLiveStrategy();
          if (liveStrategy) {
            const stratId = STRATEGY_ID_MAP[liveStrategy.id];
            if (stratId !== undefined) {
              const genomeJson = JSON.stringify(liveStrategy.parameters);
              const { keccak256, toUtf8Bytes } = require('ethers');
              const genomeHash = keccak256(toUtf8Bytes(genomeJson));

              // Pin genome to IPFS first, then record hash + CID on-chain
              const pinAndRecord = async () => {
                let cid = '';
                if (this.filecoinStore) {
                  try {
                    cid = await this.filecoinStore.pinGenome(
                      liveStrategy.parameters,
                      liveStrategy.id,
                      liveStrategy.generation,
                    );
                    console.log(`[DarwinFi] Genome pinned to IPFS: ${cid}`);
                  } catch (err) {
                    console.error(`[DarwinFi] IPFS pin failed, recording hash without CID:`, err instanceof Error ? err.message : err);
                  }
                }
                const hash = await this.contractClient!.recordGenomeHash(stratId, genomeHash, cid);
                console.log(`[DarwinFi] On-chain genome hash recorded: ${hash}${cid ? ` (IPFS: ${cid})` : ''}`);
              };
              pinAndRecord().catch(err =>
                console.error(`[DarwinFi] Genome recording failed: ${err.message}`)
              );
            }
          }

          // Log promotions/demotions on-chain
          for (const promo of report.promotionEvents) {
            // Parse promotion event string for strategy info
            const promoMatch = promo.match(/(\S+)\s+promoted/i);
            const demoMatch = promo.match(/(\S+)\s+demoted/i);
            if (promoMatch) {
              const sid = STRATEGY_ID_MAP[promoMatch[1]];
              if (sid !== undefined) {
                this.contractClient.logPromotion(sid, promo)
                  .catch(err => console.error(`[DarwinFi] On-chain promotion log failed: ${err.message}`));
              }
            }
            if (demoMatch) {
              const sid = STRATEGY_ID_MAP[demoMatch[1]];
              if (sid !== undefined) {
                this.contractClient.logDemotion(sid, promo)
                  .catch(err => console.error(`[DarwinFi] On-chain demotion log failed: ${err.message}`));
              }
            }
          }
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
        // Restore status (updateGenome only restores parameters)
        if (genome.status && genome.status !== 'paper') {
          this.strategyManager.setStrategyStatus(genome.id, genome.status);
        }
      }
      console.log(`[DarwinFi] Restored ${state.strategies.length} strategy genomes`);
      const restoredLive = this.strategyManager.getLiveStrategy();
      if (restoredLive) {
        console.log(`[DarwinFi] Live strategy after restore: ${restoredLive.id} [${restoredLive.status}]`);
      } else {
        console.log(`[DarwinFi] No live strategy after restore -- statuses: ${state.strategies.map(s => s.id + '=' + s.status).join(', ')}`);
      }
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
