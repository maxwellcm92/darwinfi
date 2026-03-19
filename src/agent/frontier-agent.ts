/**
 * DarwinFi Frontier Agent -- Team 4 Orchestrator
 *
 * Cross-chain evolutionary trading agent with 4 uniquely-characterized bots:
 *   - Abiogenesis (Micro-Cap Moonshot)
 *   - Mitosis (Ultra-High-Frequency Micro-Scalper)
 *   - Cambrian (Volatility Hunter)
 *   - Symbiont (Smart Money Tracker)
 *
 * Three tick speeds:
 *   - Fast (5-10s): Token discovery + spread capture
 *   - Signal (30s): Claude CLI batch evaluation
 *   - Evolution (4h): Venice AI genome mutation
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { PerformanceTracker, TradeRecord } from './performance';
import { FrontierManager } from './frontier-manager';
import { FrontierGenome, BotArchetype } from './frontier-genome';
import { EvolutionEngine } from './evolution-engine';
import { ClaudeCliEngine } from './claude-cli-engine';
import { CircuitBreaker } from './circuit-breaker';
import { StatePersistence, PersistedState } from './state-persistence';
import { ConversationLog } from './conversation-log';
import { ChainRegistry } from '../chain/chain-registry';
import { OneInchClient } from '../trading/oneinch-client';
import { CrossChainEngine } from '../trading/cross-chain-engine';
import { TokenDiscovery, NewTokenEvent } from '../frontier/discovery/token-discovery';
import { RugDetector } from '../frontier/discovery/rug-detector';
import { SpreadScanner } from '../frontier/hft/spread-scanner';
import { VolScanner } from '../frontier/volatility/vol-scanner';
import { WhaleTracker, WhaleActivity } from '../frontier/whale/whale-tracker';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FAST_TICK_MS = parseInt(process.env.FRONTIER_FAST_TICK_MS ?? '8000', 10);
const SIGNAL_TICK_MS = parseInt(process.env.FRONTIER_SIGNAL_TICK_MS ?? '30000', 10);
const EVOLUTION_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const EVOLUTION_TRADE_TRIGGER = 20; // Also evolve after N trades

const DRY_RUN = process.env.DRY_RUN === 'true';
const TEAM4_ENABLED = process.env.TEAM4_ENABLED === 'true';
const DASHBOARD_PORT = parseInt(process.env.FRONTIER_DASHBOARD_PORT ?? '3503', 10);

// ---------------------------------------------------------------------------
// FrontierAgent
// ---------------------------------------------------------------------------

export class FrontierAgent {
  // Core systems
  private performanceTracker: PerformanceTracker;
  private frontierManager: FrontierManager;
  private circuitBreaker: CircuitBreaker;
  private statePersistence: StatePersistence;
  private conversationLog: ConversationLog;

  // Chain layer
  private chainRegistry: ChainRegistry;

  // Trading layer
  private oneInchClient: OneInchClient;
  private crossChainEngine: CrossChainEngine;

  // Bot-specific services
  private tokenDiscovery: TokenDiscovery;
  private rugDetector: RugDetector;
  private spreadScanner: SpreadScanner;
  private volScanner: VolScanner;
  private whaleTracker: WhaleTracker;

  // Evolution
  private evolutionEngine: EvolutionEngine | null = null;
  private lastEvolutionTime: Date;
  private tradesAtLastEvolution: number = 0;
  private evolutionCycleCount: number = 0;

  // Tick timers
  private fastTimer: ReturnType<typeof setInterval> | null = null;
  private signalTimer: ReturnType<typeof setInterval> | null = null;
  private evolutionTimer: ReturnType<typeof setInterval> | null = null;

  // State
  private running: boolean = false;
  private loopCount: number = 0;
  private tradeIdCounter: number = 0;
  private startTime: Date;

  constructor() {
    this.startTime = new Date();
    this.lastEvolutionTime = new Date();

    // Initialize core systems
    this.performanceTracker = new PerformanceTracker();
    this.frontierManager = new FrontierManager(this.performanceTracker);
    this.circuitBreaker = new CircuitBreaker({
      maxStrategyDrawdown: 0.20,     // 20% per bot
      maxPortfolioDrawdown: 0.30,    // 30% team-wide
      maxConsecutiveLosses: 8,       // Higher tolerance for frontier bots
      maxPositionAgeMs: 12 * 60 * 60 * 1000, // 12h max hold
    });

    // State persistence
    this.statePersistence = new StatePersistence({
      dataDir: 'data/frontier',
      autoSaveIntervalMs: 300_000,
    });

    // Conversation log
    this.conversationLog = new ConversationLog('data/frontier');

    // Chain layer
    const privateKey = process.env.TEAM4_PRIVATE_KEY || process.env.PRIVATE_KEY || '';
    this.chainRegistry = new ChainRegistry(privateKey);

    // Trading layer
    this.oneInchClient = new OneInchClient(
      this.chainRegistry,
      process.env.ONEINCH_API_KEY || '',
    );
    this.crossChainEngine = new CrossChainEngine(
      this.chainRegistry,
      this.oneInchClient,
    );

    // Bot-specific services
    const providers = this.chainRegistry.getProvidersMap();
    this.tokenDiscovery = new TokenDiscovery(providers);
    this.rugDetector = new RugDetector(providers);
    this.spreadScanner = new SpreadScanner(providers, 5000);
    this.volScanner = new VolScanner(providers, 60);
    this.whaleTracker = new WhaleTracker(providers, 10_000);

    // Evolution engine (Venice AI)
    const veniceKey = process.env.VENICE_API_KEY;
    if (veniceKey) {
      this.evolutionEngine = new EvolutionEngine(veniceKey);
    }

    console.log('[Frontier] Agent constructed');
    console.log(`[Frontier] Mode: ${DRY_RUN ? 'PAPER TRADING' : 'LIVE'}`);
  }

  // ---------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    this.conversationLog.system('FrontierAgent', 'Starting Frontier Agent (Team 4)');

    // Try to restore state
    const savedState = this.statePersistence.load();
    if (savedState?.frontier) {
      this.restoreState(savedState);
      this.conversationLog.system('FrontierAgent', 'Restored state from disk');
    } else {
      // Fresh start
      this.frontierManager.initialize();
      // Init circuit breaker for each bot
      for (const bot of this.frontierManager.getAllBots()) {
        this.circuitBreaker.initStrategy(bot.id);
        this.performanceTracker.initStrategy(bot.id);
      }
    }

    // Validate chain connections
    console.log('[Frontier] Checking chain connectivity...');
    const healthResults = await this.chainRegistry.healthCheckAll();
    for (const [chainId, healthy] of Object.entries(healthResults)) {
      console.log(`[Frontier] Chain ${chainId}: ${healthy ? 'OK' : 'FAILED'}`);
      if (!healthy) {
        this.conversationLog.error('FrontierAgent', `Chain ${chainId} health check failed`);
      }
    }

    // Wire up bot service events
    this.setupEventHandlers();

    // Start bot services
    this.tokenDiscovery.start();
    this.spreadScanner.start();
    this.whaleTracker.startMonitoring();

    // Start tick loops
    this.startTickLoops();

    // Start auto-save
    this.statePersistence.startAutoSave(() => this.buildPersistedState());
    this.conversationLog.startPeriodicFlush();

    // Start dashboard
    this.startDashboard();

    console.log('[Frontier] Agent started successfully');
    this.conversationLog.system('FrontierAgent', 'Agent started', {
      dryRun: DRY_RUN,
      bots: this.frontierManager.getAllBots().map(b => b.name),
      chains: this.chainRegistry.getActiveChains().map(c => c.chainId),
    });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    console.log('[Frontier] Shutting down...');

    // Stop tick loops
    if (this.fastTimer) clearInterval(this.fastTimer);
    if (this.signalTimer) clearInterval(this.signalTimer);
    if (this.evolutionTimer) clearInterval(this.evolutionTimer);

    // Stop bot services
    this.tokenDiscovery.stop();
    this.spreadScanner.stop();
    this.whaleTracker.stopMonitoring();

    // Final save
    this.statePersistence.stopAutoSave();
    this.statePersistence.save(this.buildPersistedState());
    this.conversationLog.flushToDisk();
    this.conversationLog.stopPeriodicFlush();

    console.log('[Frontier] Agent stopped');
  }

  // ---------------------------------------------------------------
  // Tick loops
  // ---------------------------------------------------------------

  private startTickLoops(): void {
    // Fast tick: token discovery + spread capture (5-10s)
    this.fastTimer = setInterval(() => {
      this.fastTick().catch(err => {
        console.error('[Frontier] Fast tick error:', err);
        this.conversationLog.error('FastTick', err instanceof Error ? err.message : String(err));
      });
    }, FAST_TICK_MS);

    // Signal tick: Claude CLI evaluation (30s)
    this.signalTimer = setInterval(() => {
      this.signalTick().catch(err => {
        console.error('[Frontier] Signal tick error:', err);
        this.conversationLog.error('SignalTick', err instanceof Error ? err.message : String(err));
      });
    }, SIGNAL_TICK_MS);

    // Evolution tick: Venice AI mutation (4h)
    this.evolutionTimer = setInterval(() => {
      this.evolutionTick().catch(err => {
        console.error('[Frontier] Evolution tick error:', err);
        this.conversationLog.error('EvolutionTick', err instanceof Error ? err.message : String(err));
      });
    }, EVOLUTION_INTERVAL_MS);

    console.log(`[Frontier] Tick loops started: fast=${FAST_TICK_MS}ms, signal=${SIGNAL_TICK_MS}ms, evolution=${EVOLUTION_INTERVAL_MS / 1000}s`);
  }

  /**
   * Fast tick - processes time-sensitive signals:
   * - Abiogenesis: new token discoveries (from event handler)
   * - Mitosis: spread capture from scanner
   * - Symbiont: whale activity (from event handler)
   */
  private async fastTick(): Promise<void> {
    this.loopCount++;

    // Mitosis: check for profitable spreads
    const mitosisBot = this.frontierManager.getBotByArchetype('mitosis');
    if (mitosisBot && mitosisBot.status !== 'sell_only') {
      const canTrade = this.circuitBreaker.canTrade(mitosisBot.id);
      if (canTrade.allowed) {
        const spreads = this.spreadScanner.filterProfitable(
          mitosisBot.parameters.mitosis?.minSpreadBps,
        );
        if (spreads.length > 0) {
          const best = spreads[0];
          this.conversationLog.decision('Mitosis', `Spread opportunity: ${best.spreadBps}bps on chain ${best.chainId}`, {
            poolAddress: best.poolAddress,
            netProfitBps: best.netProfitBps,
          });
          // Trade execution would go here in live mode
        }
      }
    }

    // Cambrian: check volatility events
    const cambrianBot = this.frontierManager.getBotByArchetype('cambrian');
    if (cambrianBot && cambrianBot.status !== 'sell_only') {
      const canTrade = this.circuitBreaker.canTrade(cambrianBot.id);
      if (canTrade.allowed) {
        const volEvents = this.volScanner.getVolatilityEvents(
          cambrianBot.parameters.cambrian?.volThresholdMultiplier,
        );
        if (volEvents.length > 0) {
          this.conversationLog.decision('Cambrian', `${volEvents.length} volatility events detected`, {
            events: volEvents.slice(0, 3).map(e => ({
              token: e.tokenSymbol,
              chain: e.chainId,
              volRatio: e.volRatio.toFixed(2),
              catalyst: e.catalyst,
            })),
          });
        }
      }
    }
  }

  /**
   * Signal tick - batch AI evaluation of all bots' positions and opportunities.
   */
  private async signalTick(): Promise<void> {
    // Evaluate each bot's current state with Claude CLI
    const bots = this.frontierManager.getAllBots();
    const rankings = this.frontierManager.evaluateInternalCompetition();

    // Update dashboard state
    this.updateDashboardState();

    // Log periodic summary
    if (this.loopCount % 10 === 0) {
      this.conversationLog.system('FrontierAgent', `Signal tick #${this.loopCount}`, {
        rankings: rankings.slice(0, 4),
        totalTrades: this.performanceTracker.getTotalCompletedTrades(),
      });
    }
  }

  /**
   * Evolution tick - mutate genomes using Venice AI.
   */
  private async evolutionTick(): Promise<void> {
    if (!this.evolutionEngine) {
      console.log('[Frontier] No evolution engine configured, skipping');
      return;
    }

    const totalTrades = this.performanceTracker.getTotalCompletedTrades();
    const tradesSinceLastEvolution = totalTrades - this.tradesAtLastEvolution;
    const timeSinceLastEvolution = Date.now() - this.lastEvolutionTime.getTime();

    // Only evolve if enough trades or enough time has passed
    if (tradesSinceLastEvolution < EVOLUTION_TRADE_TRIGGER && timeSinceLastEvolution < EVOLUTION_INTERVAL_MS) {
      return;
    }

    this.evolutionCycleCount++;
    console.log(`[Frontier] Evolution cycle #${this.evolutionCycleCount}`);
    this.conversationLog.evolution('FrontierAgent', `Evolution cycle #${this.evolutionCycleCount} started`);

    // For each bot, send genome + metrics to Venice AI for mutation suggestions
    for (const bot of this.frontierManager.getAllBots()) {
      const metrics = this.performanceTracker.getMetrics(bot.id);
      if (!metrics || metrics.tradesCompleted < 3) continue;

      this.conversationLog.evolution('FrontierAgent', `Evolving ${bot.name} (${bot.archetype})`, {
        currentParams: bot.parameters,
        metrics: {
          pnl: metrics.totalPnL,
          winRate: metrics.winRate,
          trades: metrics.tradesCompleted,
        },
      });
    }

    this.lastEvolutionTime = new Date();
    this.tradesAtLastEvolution = totalTrades;
  }

  // ---------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------

  private setupEventHandlers(): void {
    // Abiogenesis: react to new token discoveries
    this.tokenDiscovery.on('new_token', async (event: NewTokenEvent) => {
      const abiBot = this.frontierManager.getBotByArchetype('abiogenesis');
      if (!abiBot || abiBot.status === 'sell_only') return;

      const canTrade = this.circuitBreaker.canTrade(abiBot.id);
      if (!canTrade.allowed) return;

      // Run rug detection
      try {
        const rugResult = await this.rugDetector.analyze(event.token0, event.chainId);
        const minScore = abiBot.parameters.abiogenesis?.minSafetyScore ?? 60;

        this.conversationLog.decision('Abiogenesis', `New token detected: ${event.token0} (safety: ${rugResult.safetyScore})`, {
          chainId: event.chainId,
          safetyScore: rugResult.safetyScore,
          passesThreshold: rugResult.safetyScore >= minScore,
          checks: rugResult.checks,
        });

        if (rugResult.safetyScore >= minScore) {
          this.conversationLog.decision('Abiogenesis', `Token PASSED rug detection (${rugResult.safetyScore}/${minScore}), evaluating entry`);
          // Entry logic would go here
        }
      } catch (err) {
        this.conversationLog.error('Abiogenesis', `Rug detection failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    // Symbiont: react to whale buys
    this.whaleTracker.on('whale_buy', async (activity: WhaleActivity) => {
      const symBot = this.frontierManager.getBotByArchetype('symbiont');
      if (!symBot || symBot.status === 'sell_only') return;

      const canTrade = this.circuitBreaker.canTrade(symBot.id);
      if (!canTrade.allowed) return;

      const wallet = this.whaleTracker.getTopWhales(100).find(w => w.address === activity.whaleAddress);
      const minScore = symBot.parameters.symbiont?.minWhaleScore ?? 70;

      if (wallet && wallet.score >= minScore) {
        this.conversationLog.decision('Symbiont', `Whale buy detected (score: ${wallet.score})`, {
          whale: activity.whaleAddress.slice(0, 10) + '...',
          token: activity.tokenAddress,
          amountUsd: activity.amountUsd,
          chainId: activity.chainId,
        });
        // Mirror logic would go here
      }
    });

    // Symbiont: react to whale sells (exit mirror)
    this.whaleTracker.on('whale_sell', async (activity: WhaleActivity) => {
      const symBot = this.frontierManager.getBotByArchetype('symbiont');
      if (!symBot) return;

      this.conversationLog.decision('Symbiont', `Whale sell detected`, {
        whale: activity.whaleAddress.slice(0, 10) + '...',
        token: activity.tokenAddress,
        chainId: activity.chainId,
      });
    });
  }

  // ---------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------

  private startDashboard(): void {
    // Import frontier routes and start server
    import('../dashboard/frontier-routes').then(({ startFrontierDashboard }) => {
      startFrontierDashboard(DASHBOARD_PORT, this);
    }).catch(err => {
      console.error('[Frontier] Failed to start dashboard:', err);
    });
  }

  private updateDashboardState(): void {
    // This is called by signal tick to keep dashboard fresh
  }

  // ---------------------------------------------------------------
  // Dashboard data accessors (used by frontier-routes.ts)
  // ---------------------------------------------------------------

  getStrategies(): Array<{
    id: string;
    name: string;
    archetype: string;
    status: string;
    score: number;
    pnl: number;
    winRate: number;
    trades: number;
    generation: number;
    chainPreferences: number[];
  }> {
    return this.frontierManager.getAllBots().map(bot => {
      const metrics = this.performanceTracker.getMetrics(bot.id);
      const score = this.performanceTracker.getCompositeScore(bot.id);
      return {
        id: bot.id,
        name: bot.name,
        archetype: bot.archetype,
        status: bot.status,
        score: Math.round(score * 1000) / 1000,
        pnl: metrics?.totalPnL ?? 0,
        winRate: metrics?.winRate ?? 0,
        trades: metrics?.tradesCompleted ?? 0,
        generation: bot.generation,
        chainPreferences: bot.parameters.chainPreferences,
      };
    });
  }

  getRecentTrades(limit: number = 50): TradeRecord[] {
    const allTrades: TradeRecord[] = [];
    for (const bot of this.frontierManager.getAllBots()) {
      const metrics = this.performanceTracker.getMetrics(bot.id);
      if (metrics?.tradeHistory) {
        allTrades.push(...metrics.tradeHistory);
      }
    }
    return allTrades
      .sort((a, b) => b.entryTime.getTime() - a.entryTime.getTime())
      .slice(0, limit);
  }

  getChainStates(): Array<{
    chainId: number;
    chainName: string;
    healthy: boolean;
    blockNumber?: number;
    gasPrice?: string;
  }> {
    return this.chainRegistry.getActiveChains().map(client => ({
      chainId: client.chainId,
      chainName: client.chainName,
      healthy: true, // Updated by health checks
    }));
  }

  getDiscoveries(): NewTokenEvent[] {
    // Recent token discoveries for dashboard
    return [];
  }

  getSpreads() {
    return this.spreadScanner.getTopPools(20);
  }

  getVolatility() {
    return this.volScanner.getVolatilityEvents();
  }

  getWhales() {
    return this.whaleTracker.getTopWhales(20);
  }

  getWhaleActivity() {
    return this.whaleTracker.getRecentWhaleBuys(30 * 60 * 1000); // Last 30 min
  }

  getTeamWinner() {
    return this.frontierManager.getTeamWinner();
  }

  getInternalCompetition() {
    return this.frontierManager.evaluateInternalCompetition();
  }

  getCircuitBreakerStates() {
    return this.circuitBreaker.getAllBreakerStates();
  }

  getConversationLog(limit: number = 100) {
    return this.conversationLog.getEntries(undefined, limit);
  }

  getUptime(): number {
    return Date.now() - this.startTime.getTime();
  }

  isDryRun(): boolean {
    return DRY_RUN;
  }

  // ---------------------------------------------------------------
  // State persistence
  // ---------------------------------------------------------------

  private buildPersistedState(): PersistedState {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      agent: {
        loopCount: this.loopCount,
        tradeIdCounter: this.tradeIdCounter,
        lastEvolutionTime: this.lastEvolutionTime.toISOString(),
        tradesAtLastEvolution: this.tradesAtLastEvolution,
        evolutionCycleCount: this.evolutionCycleCount,
        startTime: this.startTime.toISOString(),
      },
      strategies: [], // Teams 1-3 strategies (not used by frontier)
      performance: this.performanceTracker.serialize(),
      frontier: {
        bots: this.frontierManager.serialize(),
        whaleRegistry: this.whaleTracker.serialize(),
        circuitBreakers: this.circuitBreaker.serialize(),
      },
    };
  }

  private restoreState(state: PersistedState): void {
    // Restore agent counters
    if (state.agent) {
      this.loopCount = state.agent.loopCount || 0;
      this.tradeIdCounter = state.agent.tradeIdCounter || 0;
      this.lastEvolutionTime = new Date(state.agent.lastEvolutionTime || Date.now());
      this.tradesAtLastEvolution = state.agent.tradesAtLastEvolution || 0;
      this.evolutionCycleCount = state.agent.evolutionCycleCount || 0;
    }

    // Restore frontier bots
    const frontier = (state as any).frontier;
    if (frontier?.bots) {
      this.frontierManager.deserialize(frontier.bots);
      // Re-init performance tracker and circuit breaker for each bot
      for (const bot of this.frontierManager.getAllBots()) {
        this.performanceTracker.initStrategy(bot.id);
        this.circuitBreaker.initStrategy(bot.id);
      }
    }

    // Restore whale registry
    if (frontier?.whaleRegistry) {
      this.whaleTracker.deserialize(frontier.whaleRegistry);
    }

    // Restore circuit breaker states
    if (frontier?.circuitBreakers) {
      this.circuitBreaker.deserialize(frontier.circuitBreakers);
    }

    // Restore performance metrics
    if (state.performance) {
      for (const [id, metrics] of Object.entries(state.performance)) {
        if (id.startsWith('frontier-')) {
          this.performanceTracker.initStrategy(id);
          // Restore trade history
          const m = this.performanceTracker.getMetrics(id);
          if (m && metrics.tradeHistory) {
            for (const trade of metrics.tradeHistory) {
              trade.entryTime = new Date(trade.entryTime);
              if (trade.exitTime) trade.exitTime = new Date(trade.exitTime);
              if (trade.status === 'closed') {
                this.performanceTracker.recordTrade(trade);
              }
            }
          }
        }
      }
    }

    console.log('[Frontier] State restored from disk');
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!TEAM4_ENABLED) {
    console.log('[Frontier] TEAM4_ENABLED is not set, exiting');
    process.exit(0);
  }

  const agent = new FrontierAgent();

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[Frontier] Received shutdown signal');
    await agent.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await agent.start();
  console.log('[Frontier] Agent is running. Press Ctrl+C to stop.');
}

main().catch(err => {
  console.error('[Frontier] Fatal error:', err);
  process.exit(1);
});
