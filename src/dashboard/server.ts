import express from "express";
import path from "path";
import * as fs from "fs";
import { ContractClient } from "../chain/contract-client";
import { ethers } from "ethers";
import { StateWriter } from "../instinct/nerves/state-writer";
import { registerImmuneRoutes } from "../immune/lymph/dashboard-endpoint";
import { GradingDepartment } from "../agent/grading-department";

export interface DashboardState {
  strategies: Array<{
    id: string;
    name: string;
    type: string;
    role?: string;
    status: string;
    score: number;
    pnl: number;
    winRate: number;
    trades: number;
    generation: number;
  }>;
  liveStrategy: string | null;
  lastEvolution: string | null;
  totalPnL: number;
  uptime: number;
  status?: string;
  recentTrades: Array<{
    timestamp: string;
    strategyId: string;
    action: string;
    token: string;
    amount: number;
    price: number;
    pnl?: number;
  }>;
  evolutionHistory: Array<{
    timestamp: string;
    event: string;
    details: string;
  }>;
  circuitBreakerStates?: Array<{
    strategyId: string;
    isPaused: boolean;
    pauseReason?: string;
    consecutiveLosses: number;
    currentDrawdown: number;
    manualOverride: boolean;
  }>;
  qualificationMode?: boolean;
  /** Team 4 Frontier strategies */
  frontierStrategies?: Array<{
    id: string;
    name: string;
    archetype: string;
    status: string;
    score: number;
    pnl: number;
    winRate: number;
    trades: number;
  }>;
  /** Championship standings across all 4 teams */
  championshipStandings?: {
    champions: Array<{
      teamId: number;
      teamName: string;
      strategyId: string;
      strategyName: string;
      compositeScore: number;
      trades: number;
      pnl: number;
      winRate: number;
    }>;
    overallChampion: {
      teamId: number;
      teamName: string;
      strategyId: string;
      strategyName: string;
      compositeScore: number;
    } | null;
  };
}

let state: DashboardState = {
  strategies: [],
  liveStrategy: null,
  lastEvolution: null,
  totalPnL: 0,
  uptime: 0,
  recentTrades: [],
  evolutionHistory: [],
};

// Share price history for mini-chart (sampled every 15 min, kept for 7 days)
const HISTORY_FILE = path.resolve(__dirname, '../../../data/share-price-history.json');

function loadSharePriceHistory(): Array<{ timestamp: number; price: number }> {
  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch { return []; }
}

function saveSharePriceHistory() {
  try {
    fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(sharePriceHistory));
  } catch { /* ignore */ }
}

let sharePriceHistory = loadSharePriceHistory();
let sharePriceSamplerInterval: ReturnType<typeof setInterval> | null = null;

// Conversation log entries (populated by the agent)
let conversationLogEntries: unknown[] = [];

// Event feed for live dashboard updates
let eventFeed: Array<{
  timestamp: string;
  type: 'trade' | 'evolution' | 'promotion' | 'demotion' | 'circuit_breaker' | 'error' | 'qualification';
  message: string;
  details?: Record<string, unknown>;
}> = [];

export function pushEvent(type: string, message: string, details?: Record<string, unknown>): void {
  eventFeed.push({
    timestamp: new Date().toISOString(),
    type: type as any,
    message,
    details,
  });
  // Keep last 100 events
  if (eventFeed.length > 100) {
    eventFeed = eventFeed.slice(-100);
  }
}

export function updateDashboardState(newState: Partial<DashboardState>): void {
  state = { ...state, ...newState };
}

export function updateConversationLog(entries: unknown[]): void {
  conversationLogEntries = entries;
}

export function startDashboard(port: number = 3500): void {
  const app = express();

  // CORS for DApp requests
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
  });

  app.use(express.json());

  // Serve the React DApp from dapp/dist/ (Caddy strips /darwinfi prefix via handle_path)
  const dappDistPath = path.resolve(__dirname, '../../../dapp/dist');
  app.use(express.static(dappDistPath));

  app.get("/api/state", (_req, res) => {
    res.json(state);
  });

  app.get("/api/strategies", (_req, res) => {
    res.json(state.strategies);
  });

  app.get("/api/trades", (_req, res) => {
    res.json(state.recentTrades);
  });

  app.get("/api/evolution", (_req, res) => {
    res.json(state.evolutionHistory);
  });

  app.get("/api/conversation-log", (req, res) => {
    const type = req.query.type as string | undefined;
    const limit = parseInt(req.query.limit as string || '200', 10);

    let entries = conversationLogEntries as Array<Record<string, unknown>>;
    if (type && type !== 'all') {
      entries = entries.filter(e => e.type === type);
    }
    res.json(entries.slice(-limit));
  });

  app.get("/api/events", (_req, res) => {
    res.json(eventFeed);
  });

  app.get("/api/strategy/:id/genome", (req, res) => {
    const strategy = state.strategies.find(s => s.id === req.params.id);
    if (!strategy) {
      return res.status(404).json({ error: 'Strategy not found' });
    }
    res.json(strategy);
  });

  // Strategy pause/resume
  app.post("/api/strategy/:id/pause", (req, res) => {
    const strategy = state.strategies.find(s => s.id === req.params.id);
    if (!strategy) return res.status(404).json({ error: 'Strategy not found' });
    strategy.status = 'sell_only';
    pushEvent('circuit_breaker', `Strategy ${strategy.name} paused via API`);
    res.json({ paused: true, strategyId: req.params.id });
  });

  app.post("/api/strategy/:id/resume", (req, res) => {
    const strategy = state.strategies.find(s => s.id === req.params.id);
    if (!strategy) return res.status(404).json({ error: 'Strategy not found' });
    strategy.status = 'active';
    pushEvent('circuit_breaker', `Strategy ${strategy.name} resumed via API`);
    res.json({ paused: false, strategyId: req.params.id });
  });

  // Immune system summary
  app.get("/api/immune/summary", (_req, res) => {
    try {
      const immuneStatePath = path.resolve(__dirname, '../../../data/immune/immune-state.json');
      const fixHistoryPath = path.resolve(__dirname, '../../../data/immune/fix-history.json');
      let immuneState = null;
      let fixSummary = { total: 0, succeeded: 0, rate: 0 };

      if (fs.existsSync(immuneStatePath)) {
        immuneState = JSON.parse(fs.readFileSync(immuneStatePath, 'utf-8'));
      }
      if (fs.existsSync(fixHistoryPath)) {
        const fixes = JSON.parse(fs.readFileSync(fixHistoryPath, 'utf-8'));
        const entries = Array.isArray(fixes) ? fixes : fixes.entries || [];
        fixSummary.total = entries.length;
        fixSummary.succeeded = entries.filter((f: any) => f.success).length;
        fixSummary.rate = fixSummary.total > 0 ? fixSummary.succeeded / fixSummary.total : 0;
      }

      res.json({ state: immuneState, fixSummary });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "running",
      uptime: state.uptime,
      liveStrategy: state.liveStrategy,
      totalPnL: state.totalPnL,
      strategiesActive: state.strategies.length,
    });
  });

  // Share price history endpoint (for mini-chart)
  app.get("/api/vault/history", (_req, res) => {
    res.json({ history: sharePriceHistory });
  });

  // VaultV2 stats endpoint
  app.get("/api/vault", async (_req, res) => {
    try {
      const cc = new ContractClient();
      if (!cc.hasVaultV2()) {
        return res.json({ configured: false, message: "VaultV2 not deployed" });
      }
      const [totalAssets, totalSupply, sharePrice, totalBorrowed, maxTotalAssets, availableAssets] = await Promise.all([
        cc.vaultV2TotalAssets(),
        cc.vaultV2TotalSupply(),
        cc.vaultV2SharePrice(),
        cc.vaultV2TotalBorrowed(),
        cc.vaultV2MaxTotalAssets(),
        cc.vaultV2AvailableAssets(),
      ]);
      res.json({
        configured: true,
        address: cc.getVaultV2Address(),
        tvl: ethers.formatUnits(totalAssets, 6),
        totalShares: ethers.formatUnits(totalSupply, 6),
        sharePrice: ethers.formatUnits(sharePrice, 6),
        totalBorrowed: ethers.formatUnits(totalBorrowed, 6),
        maxTotalAssets: ethers.formatUnits(maxTotalAssets, 6),
        availableAssets: ethers.formatUnits(availableAssets, 6),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // Fee transparency endpoint
  app.get("/api/fees", async (_req, res) => {
    try {
      const cc = new ContractClient();
      if (!cc.hasVaultV4()) {
        return res.json({ configured: false, message: "Vault not deployed" });
      }
      let managementFeeBps: number;
      let performanceFeeBps: number;
      let feeRecipient: string;
      let highWaterMark: string;
      let fallback = false;
      try {
        const [mFee, pFee, recipient, hwm] = await Promise.all([
          cc.vaultV4ManagementFeeBps(),
          cc.vaultV4PerformanceFeeBps(),
          cc.vaultV4FeeRecipient(),
          cc.vaultV4HighWaterMark(),
        ]);
        managementFeeBps = Number(mFee);
        performanceFeeBps = Number(pFee);
        feeRecipient = recipient;
        highWaterMark = ethers.formatUnits(hwm, 6);
      } catch (onChainErr) {
        console.warn("[/api/fees] On-chain fee read failed, using fallback values:", onChainErr instanceof Error ? onChainErr.message : String(onChainErr));
        managementFeeBps = 100;
        performanceFeeBps = 500;
        feeRecipient = "0xb2db53Db9a2349186F0214BC3e1bF08a195570e3";
        highWaterMark = "0.0";
        fallback = true;
      }
      res.json({
        managementFeeBps,
        performanceFeeBps,
        feeRecipient,
        highWaterMark,
        ...(fallback ? { fallback: true } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // User portfolio endpoint
  app.get("/api/portfolio/:address", async (req, res) => {
    try {
      const cc = new ContractClient();
      if (!cc.hasVaultV2()) {
        return res.json({ configured: false, message: "VaultV2 not deployed" });
      }
      const userAddress = req.params.address;
      const [shares, sharePrice] = await Promise.all([
        cc.vaultV2BalanceOf(userAddress),
        cc.vaultV2SharePrice(),
      ]);
      const assetsValue = await cc.vaultV2ConvertToAssets(shares);
      res.json({
        configured: true,
        address: userAddress,
        shares: ethers.formatUnits(shares, 6),
        sharePrice: ethers.formatUnits(sharePrice, 6),
        assetsValue: ethers.formatUnits(assetsValue, 6),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // Instinct state endpoint (reads predictions-live.json from disk)
  app.get("/api/instinct/state", (_req, res) => {
    const instinctState = StateWriter.readState();
    if (!instinctState) {
      return res.json({ generatedAt: 0, tokens: {}, health: null, message: "Instinct not yet initialized" });
    }
    res.json(instinctState);
  });

  // Grading department endpoint
  app.get("/api/grades", (_req, res) => {
    try {
      const grader = new GradingDepartment();
      const report = grader.generateReport();
      res.json(report);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // Instinct candles endpoint (reads JSONL candle files)
  app.get("/api/instinct/candles/:token", (req, res) => {
    try {
      const { CandleStore } = require("../instinct/data/candle-store");
      const store = new CandleStore();
      const token = String(req.params.token);
      const resolution = String(req.query.resolution || "5m") as "1m" | "5m" | "15m" | "1h";
      const limit = Math.min(500, parseInt(String(req.query.limit || "200")));
      const candles = store.getLatest(token, resolution, limit);
      res.json({ token, resolution, count: candles.length, candles });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // Historical returns endpoint (cumulative % return from share price)
  app.get("/api/vault/returns", (_req, res) => {
    if (sharePriceHistory.length < 2) {
      return res.json({ returns: [] });
    }
    const basePrice = sharePriceHistory[0].price;
    const returns = sharePriceHistory.map(point => ({
      timestamp: point.timestamp,
      returnPct: ((point.price - basePrice) / basePrice) * 100,
      price: point.price,
    }));
    res.json({ returns });
  });

  // Championship endpoint (cross-team competition)
  app.get("/api/championship", (_req, res) => {
    res.json(state.championshipStandings ?? {
      champions: [],
      overallChampion: null,
    });
  });

  // Frontier strategies endpoint (Team 4)
  app.get("/api/frontier-strategies", (_req, res) => {
    res.json(state.frontierStrategies ?? []);
  });

  // Immune system dashboard routes (must be before SPA catch-all)
  registerImmuneRoutes(app);

  // ---------------------------------------------------------------
  // Evolution engine routes
  // ---------------------------------------------------------------

  app.get("/api/evolution/status", (_req, res) => {
    try {
      const canaryPath = path.resolve(__dirname, '../../../data/evolution/canary-state.json');
      const memoryPath = path.resolve(__dirname, '../../../data/evolution/memory.json');
      let canaryState = null;
      let memory = null;

      if (fs.existsSync(canaryPath)) {
        canaryState = JSON.parse(fs.readFileSync(canaryPath, 'utf-8'));
      }
      if (fs.existsSync(memoryPath)) {
        memory = JSON.parse(fs.readFileSync(memoryPath, 'utf-8'));
      }

      res.json({
        canary: canaryState,
        lastProposalTime: memory?.lastProposalTime ?? 0,
        proposalsToday: memory?.proposalsToday ?? 0,
        totalProposals: memory?.entries?.length ?? 0,
        zoneBackoff: memory?.zoneBackoff ?? {},
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/evolution/audit", (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string || '50', 10);
      const auditPath = path.resolve(__dirname, '../../../data/evolution/audit.jsonl');
      if (!fs.existsSync(auditPath)) {
        return res.json({ entries: [] });
      }
      const lines = fs.readFileSync(auditPath, 'utf-8').trim().split('\n').filter(Boolean);
      const entries = lines.slice(-limit).map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
      res.json({ entries });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get("/api/evolution/memory", (_req, res) => {
    try {
      const memoryPath = path.resolve(__dirname, '../../../data/evolution/memory.json');
      if (!fs.existsSync(memoryPath)) {
        return res.json({ entries: [], zoneBackoff: {} });
      }
      const memory = JSON.parse(fs.readFileSync(memoryPath, 'utf-8'));
      // Return summary (not full entries for performance)
      res.json({
        totalEntries: memory.entries?.length ?? 0,
        recentEntries: (memory.entries ?? []).slice(-20),
        zoneBackoff: memory.zoneBackoff ?? {},
        lastProposalTime: memory.lastProposalTime ?? 0,
        proposalsToday: memory.proposalsToday ?? 0,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/evolution/pause", (_req, res) => {
    try {
      // Write a pause flag that the orchestrator checks
      const flagPath = path.resolve(__dirname, '../../../data/evolution/paused');
      fs.writeFileSync(flagPath, new Date().toISOString(), 'utf-8');
      res.json({ paused: true, timestamp: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/evolution/resume", (_req, res) => {
    try {
      const flagPath = path.resolve(__dirname, '../../../data/evolution/paused');
      if (fs.existsSync(flagPath)) {
        fs.unlinkSync(flagPath);
      }
      res.json({ paused: false, timestamp: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post("/api/evolution/rollback", (_req, res) => {
    try {
      const { execSync } = require('child_process');
      const cwd = path.resolve(__dirname, '../../../');
      execSync('git checkout master', { cwd, encoding: 'utf-8' });
      execSync('npx tsc', { cwd, encoding: 'utf-8', timeout: 120_000 });
      execSync('pm2 reload darwinfi darwinfi-instinct frontier', { cwd, encoding: 'utf-8' });
      // Clear canary state
      const canaryPath = path.resolve(cwd, 'data/evolution/canary-state.json');
      fs.writeFileSync(canaryPath, 'null', 'utf-8');
      res.json({ rolledBack: true, timestamp: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // SPA catch-all: serve index.html for all non-API routes (client-side routing)
  app.get('*', (_req, res) => {
    res.sendFile(path.join(dappDistPath, 'index.html'));
  });

  // Start share price sampler (every 15 minutes)
  async function sampleSharePrice() {
    try {
      const cc = new ContractClient();
      if (!cc.hasVaultV2()) return;
      const price = await cc.vaultV2SharePrice();
      const priceNum = parseFloat(ethers.formatUnits(price, 6));
      sharePriceHistory.push({ timestamp: Date.now(), price: priceNum });
      // Keep last 7 days (672 samples at 15-min intervals)
      if (sharePriceHistory.length > 672) {
        sharePriceHistory = sharePriceHistory.slice(-672);
      }
      saveSharePriceHistory();
    } catch {
      // Silently skip failed samples
    }
  }

  // Initial sample + burst second sample after 1 min + periodic sampling
  sampleSharePrice();
  setTimeout(() => sampleSharePrice(), 60_000);
  sharePriceSamplerInterval = setInterval(sampleSharePrice, 15 * 60 * 1000);

  app.listen(port, () => {
    console.log(`[DarwinFi] Dashboard running at http://localhost:${port}`);
    console.log(`[DarwinFi] Serving React DApp from ${dappDistPath}`);
  });
}
