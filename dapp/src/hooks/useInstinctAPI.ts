import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE_URL } from "../lib/constants";

// ---- Types ----

export interface PredictionSummary {
  direction: "up" | "down" | "flat";
  predictedClose: number;
  confidence: number;
  strategyId: string;
  timestamp: number;
}

export interface TokenInstinct {
  predictions: {
    "1m"?: PredictionSummary;
    "5m"?: PredictionSummary;
    "15m"?: PredictionSummary;
    "1h"?: PredictionSummary;
  };
  sentiment: {
    score: number;
    confidence: number;
    topEvents: string[];
  };
  keyLevels: {
    support: number[];
    resistance: number[];
  };
}

export interface InstinctHealth {
  sensesActive: number;
  reflexesActive: number;
  overallConfidence: number;
}

export interface InstinctState {
  generatedAt: number;
  tokens: Record<string, TokenInstinct>;
  health: InstinctHealth | null;
  message?: string;
}

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandleResponse {
  token: string;
  resolution: string;
  count: number;
  candles: Candle[];
}

// ---- Polling Hook ----

function usePollAPI<T>(endpoint: string, intervalMs: number = 10000): {
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

// ---- Main Hook ----

export function useInstinctAPI(token?: string, resolution?: string) {
  const state = usePollAPI<InstinctState>("/api/instinct/state", 15000);

  const candleEndpoint = token
    ? `/api/instinct/candles/${token}?resolution=${resolution || "5m"}&limit=200`
    : null;

  const candles = usePollAPI<CandleResponse>(
    candleEndpoint || "/api/instinct/candles/ETH?resolution=5m&limit=200",
    30000,
  );

  return {
    instinctState: state.data,
    instinctLoading: state.loading,
    instinctError: state.error,

    candles: candles.data?.candles ?? [],
    candlesLoading: candles.loading,
    candlesError: candles.error,

    refetchAll: () => {
      state.refetch();
      candles.refetch();
    },
  };
}
