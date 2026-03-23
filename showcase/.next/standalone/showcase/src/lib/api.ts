import { API_BASE_URL } from "./constants";

export interface AgentState {
  uptime?: number;
  uptimeFormatted?: string;
  evolutionCycle?: number;
  championStrategy?: string;
  status?: string;
  lastHeartbeat?: string;
  totalPnl?: number;
  winRate?: number;
  totalTrades?: number;
  activeStrategies?: number;
}

export interface Strategy {
  name: string;
  role: string;
  status: string;
  score: number;
  pnl: number;
  winRate: number;
  trades: number;
  generation?: number;
}

export interface Trade {
  id: string;
  timestamp: string;
  strategy: string;
  action: "BUY" | "SELL";
  token: string;
  price: number;
  amount: number;
  pnl?: number;
}

export interface EvolutionEntry {
  cycle: number;
  timestamp: string;
  champion: string;
  promoted?: string;
  eliminated?: string;
  fitnessScores?: Record<string, number>;
}

export interface VaultStats {
  tvl?: number;
  sharePrice?: number;
  depositors?: number;
  capacity?: number;
  totalShares?: number;
}

export interface ChampionshipEntry {
  strategy: string;
  wins: number;
  totalScore: number;
  rank: number;
}

export interface InstinctState {
  predictions?: Array<{
    department: string;
    signal: string;
    confidence: number;
    timestamp: string;
  }>;
  consensusSignal?: string;
  lastUpdate?: string;
}

export async function fetchAPI<T>(endpoint: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${endpoint}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ── Raw shape returned by the DApp backend /api/state ── */
interface RawDashboardState {
  strategies: Array<{ id: string; trades: number; winRate: number; status: string }>;
  liveStrategy: string | null;
  totalPnL: number;
  uptime: number;
  evolutionHistory: Array<{ cycle: number; timestamp: string }>;
}

/** Fetch /api/state and transform DashboardState -> AgentState */
export async function fetchAgentState(): Promise<AgentState> {
  const raw = await fetchAPI<RawDashboardState>("/api/state");
  const totalTrades = raw.strategies.reduce((sum, s) => sum + (s.trades || 0), 0);
  const activeStrategies = raw.strategies.filter(s => s.status !== "paused").length;
  const evolutionCycle = raw.evolutionHistory?.length ?? 0;
  const liveStrategy = raw.strategies.find(s => s.id === raw.liveStrategy);
  const hours = Math.floor(raw.uptime / 3600);
  const mins = Math.floor((raw.uptime % 3600) / 60);
  return {
    totalTrades,
    activeStrategies,
    evolutionCycle,
    totalPnl: raw.totalPnL,
    winRate: liveStrategy?.winRate,
    championStrategy: raw.liveStrategy ?? undefined,
    uptimeFormatted: `${hours}h ${mins}m`,
    status: "RUNNING",
    uptime: raw.uptime,
  };
}
