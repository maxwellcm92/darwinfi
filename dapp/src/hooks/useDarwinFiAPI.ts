import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE_URL } from "../lib/constants";

// ---- Types ----

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

// ---- Hook ----

function usePollAPI<T>(endpoint: string, intervalMs: number = 5000): {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}${endpoint}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, intervalMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData, intervalMs]);

  return { data, loading, error, refetch: fetchData };
}

export function useDarwinFiAPI() {
  const agentState = usePollAPI<AgentState>("/api/state", 5000);
  const strategies = usePollAPI<Strategy[]>("/api/strategies", 5000);
  const trades = usePollAPI<Trade[]>("/api/trades", 5000);
  const evolution = usePollAPI<EvolutionEntry[]>("/api/evolution", 15000);

  return {
    agentState: agentState.data,
    agentLoading: agentState.loading,
    agentError: agentState.error,

    strategies: strategies.data ?? [],
    strategiesLoading: strategies.loading,
    strategiesError: strategies.error,

    trades: trades.data ?? [],
    tradesLoading: trades.loading,
    tradesError: trades.error,

    evolution: evolution.data ?? [],
    evolutionLoading: evolution.loading,
    evolutionError: evolution.error,

    refetchAll: () => {
      agentState.refetch();
      strategies.refetch();
      trades.refetch();
      evolution.refetch();
    },
  };
}
