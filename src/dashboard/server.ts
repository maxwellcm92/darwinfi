import express from "express";
import path from "path";
import { ContractClient } from "../chain/contract-client";
import { ethers } from "ethers";

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

  app.use(express.static(path.join(__dirname)));
  app.use('/assets', express.static(path.join(__dirname, '../../assets')));

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

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "running",
      uptime: state.uptime,
      liveStrategy: state.liveStrategy,
      totalPnL: state.totalPnL,
      strategiesActive: state.strategies.length,
    });
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

  app.listen(port, () => {
    console.log(`[DarwinFi] Dashboard running at http://localhost:${port}`);
  });
}
