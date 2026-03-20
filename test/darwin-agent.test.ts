import { expect } from 'chai';
import { DarwinAgent, AgentConfig, loadConfig } from '../src/agent/darwin-agent';
import { MarketSnapshot, EntrySignal } from '../src/agent/venice-engine';
import { StrategyGenome } from '../src/agent/strategy-manager';
import { TradeRecord } from '../src/agent/performance';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal config that avoids all I/O in the constructor */
function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    veniceApiKey: 'test-key',
    evolutionIntervalMs: 4 * 60 * 60 * 1000,
    minTradesForEvolution: 10,
    pollIntervalMs: 30_000,
    signalIntervalMs: 120_000,
    dryRun: true,
    dashboardPort: 0,
    ...overrides,
  };
}

/** Build a snapshot with sensible defaults */
function makeSnapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    token: 'ETH',
    price: 2000,
    priceChange1h: 0,
    priceChange24h: 0,
    volume24h: 1_000_000,
    volumeChange: 0,
    high24h: 2100,
    low24h: 1900,
    rsi: 50,
    ema9: 2000,
    ema21: 2000,
    macd: 0,
    macdSignal: 0,
    bollingerUpper: 2100,
    bollingerLower: 1900,
    ...overrides,
  };
}

/** Build a minimal strategy genome */
function makeStrategy(overrides: Partial<StrategyGenome> = {}): StrategyGenome {
  return {
    id: 'test-strategy',
    name: 'Test Strategy',
    type: 'main',
    parameters: {
      entryMethod: 'rsi_oversold',
      entryThreshold: 30,
      exitMethod: 'trailing_stop',
      trailingStopPct: 5,
      takeProfitPct: 10,
      timeframe: '5m',
      indicators: ['rsi'],
      riskPerTradePct: 2,
      maxPositions: 3,
      tokenPreferences: ['ETH', 'WBTC'],
    },
    status: 'paper',
    generation: 0,
    ...overrides,
  } as StrategyGenome;
}

// ---------------------------------------------------------------------------
// Stub storage -- saves/restores originals per test
// ---------------------------------------------------------------------------

let originals: Record<string, any> = {};

function stubPrototype(cls: any, method: string, fn: (...args: any[]) => any) {
  originals[`${cls.name}.${method}`] = cls.prototype[method];
  cls.prototype[method] = fn;
}

function restoreAll() {
  for (const [key, fn] of Object.entries(originals)) {
    const [clsName, method] = key.split('.');
    // We rely on the class being in scope; for simplicity we restore via the
    // prototype reference saved in the closure.
  }
  originals = {};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DarwinAgent', () => {
  // Stub out heavy constructor deps that do I/O
  const { PriceFeed } = require('../src/trading/price-feed');
  const { LiveEngine } = require('../src/trading/live-engine');
  const { EvolutionEngine } = require('../src/agent/evolution-engine');
  const { ClaudeCliEngine } = require('../src/agent/claude-cli-engine');
  const { AIRouter } = require('../src/agent/ai-router');
  const { StatePersistence } = require('../src/agent/state-persistence');
  const { startDashboard } = require('../src/dashboard/server');
  const { ContractClient } = require('../src/chain/contract-client');

  // Save originals once
  const saved: Record<string, any> = {};

  before(() => {
    // Save originals we plan to stub
    saved['PriceFeed.getPrice'] = PriceFeed.prototype.getPrice;
    saved['LiveEngine.executeLiveTrade'] = LiveEngine.prototype.executeLiveTrade;
    saved['LiveEngine.getVaultScaledMaxTradeSize'] = LiveEngine.prototype.getVaultScaledMaxTradeSize;
    saved['LiveEngine.isVaultV2Active'] = LiveEngine.prototype.isVaultV2Active;
    saved['EvolutionEngine.runEvolutionCycle'] = EvolutionEngine.prototype.runEvolutionCycle;
    saved['EvolutionEngine.getCycleCount'] = EvolutionEngine.prototype.getCycleCount;
    saved['ClaudeCliEngine.evaluateEntry'] = ClaudeCliEngine.prototype.evaluateEntry;
    saved['ClaudeCliEngine.evaluateExit'] = ClaudeCliEngine.prototype.evaluateExit;
    saved['AIRouter.start'] = AIRouter.prototype.start;
    saved['AIRouter.evaluateEntry'] = AIRouter.prototype.evaluateEntry;
    saved['AIRouter.evaluateExit'] = AIRouter.prototype.evaluateExit;
    saved['StatePersistence.save'] = StatePersistence.prototype.save;
    saved['StatePersistence.load'] = StatePersistence.prototype.load;
    saved['StatePersistence.startAutoSave'] = StatePersistence.prototype.startAutoSave;
    saved['StatePersistence.stopAutoSave'] = StatePersistence.prototype.stopAutoSave;
  });

  beforeEach(() => {
    // Stub external I/O before every test
    PriceFeed.prototype.getPrice = async () => ({ priceUsd: 2000, token: 'ETH' });
    LiveEngine.prototype.executeLiveTrade = async () => ({ success: true, txHash: '0xtest' });
    LiveEngine.prototype.getVaultScaledMaxTradeSize = async () => 100;
    LiveEngine.prototype.isVaultV2Active = () => false;
    EvolutionEngine.prototype.runEvolutionCycle = async () => ({
      cycleNumber: 1,
      results: [],
      promotionEvents: [],
      durationMs: 100,
    });
    EvolutionEngine.prototype.getCycleCount = () => 0;
    ClaudeCliEngine.prototype.evaluateEntry = async () => [];
    ClaudeCliEngine.prototype.evaluateExit = async () => [];
    AIRouter.prototype.start = async () => {};
    AIRouter.prototype.evaluateEntry = async () => ({ signals: [], provider: 'stub' });
    AIRouter.prototype.evaluateExit = async () => ({ signals: [], provider: 'stub' });
    StatePersistence.prototype.save = () => {};
    StatePersistence.prototype.load = () => null;
    StatePersistence.prototype.startAutoSave = () => {};
    StatePersistence.prototype.stopAutoSave = () => {};

    // Clear env vars that might leak between tests
    delete process.env.PERFORMANCE_LOG_ADDRESS;
    delete process.env.STORACHA_PROOF;
  });

  afterEach(() => {
    // Restore all originals
    PriceFeed.prototype.getPrice = saved['PriceFeed.getPrice'];
    LiveEngine.prototype.executeLiveTrade = saved['LiveEngine.executeLiveTrade'];
    LiveEngine.prototype.getVaultScaledMaxTradeSize = saved['LiveEngine.getVaultScaledMaxTradeSize'];
    LiveEngine.prototype.isVaultV2Active = saved['LiveEngine.isVaultV2Active'];
    EvolutionEngine.prototype.runEvolutionCycle = saved['EvolutionEngine.runEvolutionCycle'];
    EvolutionEngine.prototype.getCycleCount = saved['EvolutionEngine.getCycleCount'];
    ClaudeCliEngine.prototype.evaluateEntry = saved['ClaudeCliEngine.evaluateEntry'];
    ClaudeCliEngine.prototype.evaluateExit = saved['ClaudeCliEngine.evaluateExit'];
    AIRouter.prototype.start = saved['AIRouter.start'];
    AIRouter.prototype.evaluateEntry = saved['AIRouter.evaluateEntry'];
    AIRouter.prototype.evaluateExit = saved['AIRouter.evaluateExit'];
    StatePersistence.prototype.save = saved['StatePersistence.save'];
    StatePersistence.prototype.load = saved['StatePersistence.load'];
    StatePersistence.prototype.startAutoSave = saved['StatePersistence.startAutoSave'];
    StatePersistence.prototype.stopAutoSave = saved['StatePersistence.stopAutoSave'];
  });

  // =========================================================================
  // Group 1: Configuration Loading
  // =========================================================================

  describe('Configuration Loading', () => {
    const envBackup: Record<string, string | undefined> = {};

    beforeEach(() => {
      envBackup.VENICE_API_KEY = process.env.VENICE_API_KEY;
      envBackup.EVOLUTION_INTERVAL_HOURS = process.env.EVOLUTION_INTERVAL_HOURS;
      envBackup.MIN_TRADES_FOR_PROMOTION = process.env.MIN_TRADES_FOR_PROMOTION;
      envBackup.SIGNAL_INTERVAL_SEC = process.env.SIGNAL_INTERVAL_SEC;
      envBackup.DRY_RUN = process.env.DRY_RUN;
      envBackup.DASHBOARD_PORT = process.env.DASHBOARD_PORT;
    });

    afterEach(() => {
      for (const [k, v] of Object.entries(envBackup)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });

    it('should parse env vars correctly', () => {
      process.env.VENICE_API_KEY = 'test-venice-key';
      process.env.EVOLUTION_INTERVAL_HOURS = '6';
      process.env.MIN_TRADES_FOR_PROMOTION = '8';
      process.env.SIGNAL_INTERVAL_SEC = '60';
      process.env.DRY_RUN = 'true';
      process.env.DASHBOARD_PORT = '4000';

      const config = loadConfig();

      expect(config.veniceApiKey).to.equal('test-venice-key');
      expect(config.evolutionIntervalMs).to.equal(6 * 60 * 60 * 1000);
      expect(config.minTradesForEvolution).to.equal(16); // 8 * 2
      expect(config.signalIntervalMs).to.equal(60_000);
      expect(config.dryRun).to.be.true;
      expect(config.dashboardPort).to.equal(4000);
    });

    it('should throw when VENICE_API_KEY missing', () => {
      delete process.env.VENICE_API_KEY;
      expect(() => loadConfig()).to.throw('VENICE_API_KEY is required');
    });
  });

  // =========================================================================
  // Group 2: Agent Initialization
  // =========================================================================

  describe('Agent Initialization', () => {
    it('should initialize all subsystems', () => {
      const agent = new DarwinAgent(makeConfig());
      const a = agent as any;

      expect(a.performanceTracker).to.exist;
      expect(a.strategyManager).to.exist;
      expect(a.evolutionEngine).to.exist;
      expect(a.signalEngine).to.exist;
      expect(a.aiRouter).to.exist;
      expect(a.priceFeed).to.exist;
      expect(a.liveEngine).to.exist;
      expect(a.statePersistence).to.exist;
      expect(a.conversationLog).to.exist;
      expect(a.championship).to.exist;
      expect(a.attributionEngine).to.exist;
    });

    it('should set default state values', () => {
      const agent = new DarwinAgent(makeConfig());
      const a = agent as any;

      expect(a.running).to.equal(false);
      expect(a.loopCount).to.equal(0);
      expect(a.tradeIdCounter).to.equal(0);
      expect(a.priceHistory.size).to.equal(0);
    });
  });

  // =========================================================================
  // Group 3: Rule-Based Entry Signals
  // =========================================================================

  describe('Rule-Based Entry Signals', () => {
    let agent: DarwinAgent;

    beforeEach(() => {
      agent = new DarwinAgent(makeConfig());
    });

    it('should trigger buy when RSI oversold', () => {
      const strategy = makeStrategy({
        parameters: {
          entryMethod: 'rsi_oversold',
          entryThreshold: 30,
          exitMethod: 'trailing_stop',
          trailingStopPct: 5,
          takeProfitPct: 10,
          timeframe: '5m',
          indicators: ['rsi'],
          riskPerTradePct: 2,
          maxPositions: 3,
          tokenPreferences: ['ETH'],
        },
      } as any);

      const snapshots = [makeSnapshot({ token: 'ETH', rsi: 25, price: 2000 })];
      const signals = (agent as any).evaluateRuleBasedEntries(strategy, snapshots);

      expect(signals).to.have.length(1);
      expect(signals[0].token).to.equal('ETH');
      expect(signals[0].action).to.equal('buy');
      expect(signals[0].reasoning).to.include('RSI');
    });

    it('should trigger buy on EMA crossover', () => {
      const strategy = makeStrategy({
        parameters: {
          entryMethod: 'ema_crossover',
          entryThreshold: 0.5, // 0.5% crossover required
          exitMethod: 'trailing_stop',
          trailingStopPct: 5,
          takeProfitPct: 10,
          timeframe: '5m',
          indicators: ['ema'],
          riskPerTradePct: 2,
          maxPositions: 3,
          tokenPreferences: ['ETH'],
        },
      } as any);

      const snapshots = [makeSnapshot({
        token: 'ETH',
        ema9: 2050,
        ema21: 2000,
        price: 2000,
      })];
      const signals = (agent as any).evaluateRuleBasedEntries(strategy, snapshots);

      expect(signals).to.have.length(1);
      expect(signals[0].action).to.equal('buy');
      expect(signals[0].reasoning).to.include('EMA');
    });

    it('should trigger buy on Bollinger bounce', () => {
      const strategy = makeStrategy({
        parameters: {
          entryMethod: 'bollinger_bounce',
          entryThreshold: 0,
          exitMethod: 'trailing_stop',
          trailingStopPct: 5,
          takeProfitPct: 10,
          timeframe: '5m',
          indicators: ['bollinger'],
          riskPerTradePct: 2,
          maxPositions: 3,
          tokenPreferences: ['ETH'],
        },
      } as any);

      const snapshots = [makeSnapshot({
        token: 'ETH',
        price: 1850,
        bollingerLower: 1900,
      })];
      const signals = (agent as any).evaluateRuleBasedEntries(strategy, snapshots);

      expect(signals).to.have.length(1);
      expect(signals[0].action).to.equal('buy');
      expect(signals[0].reasoning).to.include('Bollinger');
    });

    it('should return no signal when conditions not met', () => {
      const strategy = makeStrategy({
        parameters: {
          entryMethod: 'rsi_oversold',
          entryThreshold: 30,
          exitMethod: 'trailing_stop',
          trailingStopPct: 5,
          takeProfitPct: 10,
          timeframe: '5m',
          indicators: ['rsi'],
          riskPerTradePct: 2,
          maxPositions: 3,
          tokenPreferences: ['ETH'],
        },
      } as any);

      const snapshots = [makeSnapshot({ token: 'ETH', rsi: 50, price: 2000 })];
      const signals = (agent as any).evaluateRuleBasedEntries(strategy, snapshots);

      expect(signals).to.have.length(0);
    });
  });

  // =========================================================================
  // Group 4: Rule-Based Exit Signals
  // =========================================================================

  describe('Rule-Based Exit Signals', () => {
    let agent: DarwinAgent;

    beforeEach(() => {
      agent = new DarwinAgent(makeConfig());
    });

    it('should trigger sell on hard stop loss', async () => {
      const strategy = makeStrategy({
        id: 'stop-test',
        status: 'live',
        parameters: {
          entryMethod: 'rsi_oversold',
          entryThreshold: 30,
          exitMethod: 'trailing_stop',
          trailingStopPct: 5,
          takeProfitPct: 10,
          timeframe: '5m',
          indicators: ['rsi'],
          riskPerTradePct: 2,
          maxPositions: 3,
          tokenPreferences: ['ETH'],
        },
      } as any);

      // Plant an open position via performanceTracker
      const a = agent as any;
      a.performanceTracker.initStrategy('stop-test', true);
      a.performanceTracker.recordTrade({
        id: 'trade-1',
        strategyId: 'stop-test',
        token: 'ETH',
        side: 'buy',
        entryPrice: 2000,
        quantity: 1,
        entryTime: new Date(),
        status: 'open',
        fees: 0,
      });

      let sellCalled = false;
      const origSell = a.executeSell.bind(agent);
      a.executeSell = async (...args: any[]) => { sellCalled = true; };

      // Price dropped 6% -> below 5% stop
      const snapshots = [makeSnapshot({ token: 'ETH', price: 1880 })];

      // Stub getSellOnlyStrategies to return empty
      a.strategyManager.getSellOnlyStrategies = () => [];

      await a.evaluateRuleBasedExits(strategy, snapshots);

      expect(sellCalled).to.be.true;
    });

    it('should trigger sell on take profit', async () => {
      const strategy = makeStrategy({
        id: 'tp-test',
        status: 'live',
        parameters: {
          entryMethod: 'rsi_oversold',
          entryThreshold: 30,
          exitMethod: 'trailing_stop',
          trailingStopPct: 5,
          takeProfitPct: 10,
          timeframe: '5m',
          indicators: ['rsi'],
          riskPerTradePct: 2,
          maxPositions: 3,
          tokenPreferences: ['ETH'],
        },
      } as any);

      const a = agent as any;
      a.performanceTracker.initStrategy('tp-test', true);
      a.performanceTracker.recordTrade({
        id: 'trade-2',
        strategyId: 'tp-test',
        token: 'ETH',
        side: 'buy',
        entryPrice: 2000,
        quantity: 1,
        entryTime: new Date(),
        status: 'open',
        fees: 0,
      });

      let sellCalled = false;
      a.executeSell = async (...args: any[]) => { sellCalled = true; };
      a.strategyManager.getSellOnlyStrategies = () => [];

      // Price up 11% -> above 10% take profit
      const snapshots = [makeSnapshot({ token: 'ETH', price: 2220 })];
      await a.evaluateRuleBasedExits(strategy, snapshots);

      expect(sellCalled).to.be.true;
    });

    it('should exit sell-only strategy on profit or -3%', async () => {
      const a = agent as any;

      const sellOnlyStrategy = makeStrategy({
        id: 'sell-only-test',
        status: 'sell_only' as any,
        parameters: {
          entryMethod: 'rsi_oversold',
          entryThreshold: 30,
          exitMethod: 'trailing_stop',
          trailingStopPct: 5,
          takeProfitPct: 10,
          timeframe: '5m',
          indicators: ['rsi'],
          riskPerTradePct: 2,
          maxPositions: 3,
          tokenPreferences: ['ETH'],
        },
      } as any);

      // Live strategy needs an open position so the function doesn't early-return
      const liveStrategy = makeStrategy({
        id: 'main-live',
        status: 'live',
        parameters: {
          entryMethod: 'rsi_oversold',
          entryThreshold: 30,
          exitMethod: 'trailing_stop',
          trailingStopPct: 5,
          takeProfitPct: 10,
          timeframe: '5m',
          indicators: ['rsi'],
          riskPerTradePct: 2,
          maxPositions: 3,
          tokenPreferences: ['WBTC'],
        },
      } as any);

      a.performanceTracker.initStrategy('main-live', true);
      a.performanceTracker.recordTrade({
        id: 'trade-live',
        strategyId: 'main-live',
        token: 'WBTC',
        side: 'buy',
        entryPrice: 60000,
        quantity: 0.01,
        entryTime: new Date(),
        status: 'open',
        fees: 0,
      });

      a.performanceTracker.initStrategy('sell-only-test', true);
      a.performanceTracker.recordTrade({
        id: 'trade-3',
        strategyId: 'sell-only-test',
        token: 'ETH',
        side: 'buy',
        entryPrice: 2000,
        quantity: 1,
        entryTime: new Date(),
        status: 'open',
        fees: 0,
      });

      let sellCalledForSellOnly = false;
      a.executeSell = async (strat: any, ..._args: any[]) => {
        if (strat.id === 'sell-only-test') sellCalledForSellOnly = true;
      };
      a.strategyManager.getSellOnlyStrategies = () => [sellOnlyStrategy];

      // ETH price up 1% triggers sell_only exit; WBTC at entry price (no exit)
      const snapshots = [
        makeSnapshot({ token: 'ETH', price: 2020 }),
        makeSnapshot({ token: 'WBTC', price: 60000 }),
      ];
      await a.evaluateRuleBasedExits(liveStrategy, snapshots);

      expect(sellCalledForSellOnly).to.be.true;
    });
  });

  // =========================================================================
  // Group 5: Evolution Trigger Logic
  // =========================================================================

  describe('Evolution Trigger Logic', () => {
    let agent: DarwinAgent;

    beforeEach(() => {
      agent = new DarwinAgent(makeConfig({ evolutionIntervalMs: 4 * 60 * 60 * 1000 }));
    });

    it('should fire evolution when time trigger elapsed', async () => {
      const a = agent as any;

      // Set lastEvolutionTime to 5 hours ago
      a.lastEvolutionTime = new Date(Date.now() - 5 * 60 * 60 * 1000);
      a.tradesAtLastEvolution = 0;

      let evolutionRan = false;
      a.evolutionEngine.runEvolutionCycle = async () => {
        evolutionRan = true;
        return { cycleNumber: 1, results: [], promotionEvents: [], durationMs: 50 };
      };

      await a.checkEvolutionTrigger();

      expect(evolutionRan).to.be.true;
    });

    it('should fire evolution when trade count trigger reached', async () => {
      const a = agent as any;

      // Recent evolution time (not time-triggered)
      a.lastEvolutionTime = new Date();
      a.tradesAtLastEvolution = 0;
      a.config.minTradesForEvolution = 5;

      // Simulate 5 completed trades
      a.performanceTracker.initStrategy('trade-trigger-test', true);
      for (let i = 0; i < 5; i++) {
        a.performanceTracker.recordTrade({
          id: `tt-${i}`,
          strategyId: 'trade-trigger-test',
          token: 'ETH',
          side: 'buy',
          entryPrice: 2000,
          exitPrice: 2100,
          quantity: 1,
          pnl: 100,
          pnlPct: 5,
          entryTime: new Date(),
          exitTime: new Date(),
          status: 'closed',
          fees: 0,
        });
      }

      let evolutionRan = false;
      a.evolutionEngine.runEvolutionCycle = async () => {
        evolutionRan = true;
        return { cycleNumber: 2, results: [], promotionEvents: [], durationMs: 50 };
      };

      await a.checkEvolutionTrigger();

      expect(evolutionRan).to.be.true;
    });

    it('should accelerate evolution to 1h during qualification mode', async () => {
      const a = agent as any;

      // Set config evolution interval to 4h
      a.config.evolutionIntervalMs = 4 * 60 * 60 * 1000;

      // Force qualificationMode = true
      Object.defineProperty(a.strategyManager, 'qualificationMode', {
        get: () => true,
        configurable: true,
      });

      // Set lastEvolution to 1.5 hours ago -- would NOT trigger at 4h, but SHOULD at 1h
      a.lastEvolutionTime = new Date(Date.now() - 1.5 * 60 * 60 * 1000);
      a.tradesAtLastEvolution = 0;

      let evolutionRan = false;
      a.evolutionEngine.runEvolutionCycle = async () => {
        evolutionRan = true;
        return { cycleNumber: 3, results: [], promotionEvents: [], durationMs: 50 };
      };

      await a.checkEvolutionTrigger();

      expect(evolutionRan).to.be.true;
    });
  });

  // =========================================================================
  // Group 6: Paper Trading vs Live Mode
  // =========================================================================

  describe('Paper Trading vs Live Mode', () => {
    it('should not call liveEngine in dry-run mode', async () => {
      const agent = new DarwinAgent(makeConfig({ dryRun: true }));
      const a = agent as any;

      let liveEngineCalled = false;
      a.liveEngine.executeLiveTrade = async () => {
        liveEngineCalled = true;
        return { success: true };
      };

      const strategy = makeStrategy({ id: 'dry-test', status: 'live' });
      const signal: EntrySignal = {
        token: 'ETH',
        action: 'buy',
        confidence: 80,
        reasoning: 'test',
        suggestedSize: 100,
        suggestedEntry: 2000,
        suggestedStop: 1900,
        suggestedTarget: 2200,
      };
      const snapshot = makeSnapshot({ token: 'ETH', price: 2000 });

      a.performanceTracker.initStrategy('dry-test', true);
      await a.executeBuy(strategy, signal, snapshot);

      expect(liveEngineCalled).to.be.false;

      // But the trade should still be recorded
      const openPositions = a.performanceTracker.getOpenPositions('dry-test');
      expect(openPositions).to.have.length(1);
      expect(openPositions[0].token).to.equal('ETH');
    });
  });

  // =========================================================================
  // Group 7: State Persistence
  // =========================================================================

  describe('State Persistence', () => {
    it('should capture agent counters in persisted state', () => {
      const agent = new DarwinAgent(makeConfig());
      const a = agent as any;

      a.loopCount = 42;
      a.tradeIdCounter = 7;
      a.tradesAtLastEvolution = 3;
      a.startTime = new Date('2026-01-01T00:00:00Z');
      a.lastEvolutionTime = new Date('2026-01-01T04:00:00Z');

      const state = a.buildPersistedState();

      expect(state.version).to.equal(1);
      expect(state.agent.loopCount).to.equal(42);
      expect(state.agent.tradeIdCounter).to.equal(7);
      expect(state.agent.tradesAtLastEvolution).to.equal(3);
      expect(state.agent.startTime).to.equal('2026-01-01T00:00:00.000Z');
      expect(state.agent.lastEvolutionTime).to.equal('2026-01-01T04:00:00.000Z');
      expect(state.strategies).to.be.an('array');
      expect(state.savedAt).to.be.a('string');
    });

    it('should restore counters and strategies from persisted state', () => {
      const agent = new DarwinAgent(makeConfig());
      const a = agent as any;

      const fakeState = {
        version: 1,
        savedAt: new Date().toISOString(),
        agent: {
          loopCount: 100,
          tradeIdCounter: 25,
          lastEvolutionTime: '2026-01-01T08:00:00.000Z',
          tradesAtLastEvolution: 15,
          evolutionCycleCount: 5,
          startTime: '2026-01-01T00:00:00.000Z',
        },
        strategies: [],
        performance: {},
      };

      a.loadState(fakeState);

      expect(a.loopCount).to.equal(100);
      expect(a.tradeIdCounter).to.equal(25);
      expect(a.tradesAtLastEvolution).to.equal(15);
      expect(a.lastEvolutionTime.toISOString()).to.equal('2026-01-01T08:00:00.000Z');
    });
  });

  // =========================================================================
  // Group 8: Graceful Shutdown
  // =========================================================================

  describe('Graceful Shutdown', () => {
    it('should save state, flush logs, and set running=false on stop()', async () => {
      const agent = new DarwinAgent(makeConfig());
      const a = agent as any;

      // Initialize strategies so printStatusReport doesn't fail
      a.strategyManager.initialize();
      a.running = true;

      let saveCalled = false;
      let flushCalled = false;
      let autoSaveStopped = false;
      let periodicFlushStopped = false;

      a.statePersistence.save = () => { saveCalled = true; };
      a.statePersistence.stopAutoSave = () => { autoSaveStopped = true; };
      a.conversationLog.flushToDisk = () => { flushCalled = true; };
      a.conversationLog.stopPeriodicFlush = () => { periodicFlushStopped = true; };

      await agent.stop();

      expect(a.running).to.be.false;
      expect(saveCalled).to.be.true;
      expect(flushCalled).to.be.true;
      expect(autoSaveStopped).to.be.true;
      expect(periodicFlushStopped).to.be.true;
    });
  });
});
