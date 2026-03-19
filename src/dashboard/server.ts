import express from "express";
import path from "path";

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

export function updateDashboardState(newState: Partial<DashboardState>): void {
  state = { ...state, ...newState };
}

export function updateConversationLog(entries: unknown[]): void {
  conversationLogEntries = entries;
}

export function startDashboard(port: number = 3500): void {
  const app = express();

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

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "running",
      uptime: state.uptime,
      liveStrategy: state.liveStrategy,
      totalPnL: state.totalPnL,
      strategiesActive: state.strategies.length,
    });
  });

  app.listen(port, () => {
    console.log(`[DarwinFi] Dashboard running at http://localhost:${port}`);
  });
}
