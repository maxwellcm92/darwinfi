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
