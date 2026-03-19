import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE_URL } from "../lib/constants";

// ---- Types ----

export interface FrontierStrategy {
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
}

export interface ChainState {
  chainId: number;
  chainName: string;
  healthy: boolean;
  blockNumber?: number;
  gasPrice?: string;
}

export interface SpreadOpportunity {
  chainId: number;
  chainName: string;
  poolAddress: string;
  spreadBps: number;
  netProfitBps: number;
  timestamp: number;
}

export interface VolatilityEvent {
  chainId: number;
  chainName: string;
  tokenAddress: string;
  tokenSymbol: string;
  currentVol: number;
  averageVol: number;
  volRatio: number;
  catalyst?: string;
  timestamp: number;
}

export interface WhaleData {
  topWhales: Array<{
    address: string;
    chainId: number;
    winRate: number;
    score: number;
    totalTrades: number;
  }>;
  recentActivity: Array<{
    whaleAddress: string;
    chainId: number;
    chainName: string;
    action: "buy" | "sell";
    tokenAddress: string;
    amountUsd: number;
    timestamp: number;
  }>;
}

export interface CompetitionData {
  rankings: Array<{
    id: string;
    name: string;
    score: number;
    trades: number;
  }>;
  teamWinner: { botId: string; score: number } | null;
}

export interface ChampionshipEntry {
  teamId: number;
  teamName: string;
  strategyId: string;
  strategyName: string;
  compositeScore: number;
  trades: number;
  pnl: number;
  winRate: number;
}

export interface ChampionshipData {
  champions: ChampionshipEntry[];
  overallChampion: ChampionshipEntry | null;
}

// ---- Generic polling hook ----

function usePollAPI<T>(
  endpoint: string,
  intervalMs: number = 5000,
  baseUrl: string = API_BASE_URL,
): {
  data: T | null;
  loading: boolean;
  error: string | null;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}${endpoint}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Fetch failed");
    } finally {
      setLoading(false);
    }
  }, [endpoint, baseUrl]);

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, intervalMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData, intervalMs]);

  return { data, loading, error };
}

// ---- Frontier API hook ----

// Frontier dashboard runs on port 3503
const FRONTIER_API_BASE = import.meta.env.VITE_FRONTIER_API_BASE_URL ?? API_BASE_URL;

export function useFrontierAPI() {
  const strategies = usePollAPI<FrontierStrategy[]>(
    "/api/frontier/strategies",
    5000,
    FRONTIER_API_BASE,
  );
  const chains = usePollAPI<ChainState[]>(
    "/api/frontier/chains",
    10000,
    FRONTIER_API_BASE,
  );
  const spreads = usePollAPI<SpreadOpportunity[]>(
    "/api/frontier/mitosis/spreads",
    10000,
    FRONTIER_API_BASE,
  );
  const volatility = usePollAPI<VolatilityEvent[]>(
    "/api/frontier/cambrian/volatility",
    10000,
    FRONTIER_API_BASE,
  );
  const whales = usePollAPI<WhaleData>(
    "/api/frontier/symbiont/whales",
    10000,
    FRONTIER_API_BASE,
  );
  const competition = usePollAPI<CompetitionData>(
    "/api/frontier/competition",
    10000,
    FRONTIER_API_BASE,
  );
  const championship = usePollAPI<ChampionshipData>(
    "/api/championship",
    15000,
  );

  return {
    strategies: strategies.data ?? [],
    strategiesLoading: strategies.loading,

    chains: chains.data ?? [],
    chainsLoading: chains.loading,

    spreads: spreads.data ?? [],
    spreadsLoading: spreads.loading,

    volatility: volatility.data ?? [],
    volatilityLoading: volatility.loading,

    whales: whales.data,
    whalesLoading: whales.loading,

    competition: competition.data,
    competitionLoading: competition.loading,

    championship: championship.data,
    championshipLoading: championship.loading,
  };
}
