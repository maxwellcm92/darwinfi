import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE_URL } from "../lib/constants";

// ---- Types ----

export interface EvolutionStatus {
  canary: CanaryState | null;
  lastProposalTime: number;
  proposalsToday: number;
  totalProposals: number;
  zoneBackoff: Record<string, ZoneBackoff>;
}

export interface CanaryState {
  active: boolean;
  startedAt: number;
  proposalId: string;
  branch: string;
  baselineMetrics: CanaryMetrics;
  currentMetrics: CanaryMetrics;
  checkCount: number;
  lastCheckAt: number;
}

export interface CanaryMetrics {
  pnlDelta: number;
  errorRate: number;
  crashCount: number;
  processUptime: number;
  sharePriceDelta: number;
}

export interface ZoneBackoff {
  zone: string;
  consecutiveFailures: number;
  backoffUntil: number;
  lastFailure: number;
}

export interface AuditEntry {
  timestamp: number;
  event: string;
  proposalId?: string;
  details: Record<string, unknown>;
}

export interface EvolutionMemory {
  totalEntries: number;
  recentEntries: Array<{
    proposalId: string;
    diffHash: string;
    zone: string;
    targetFiles: string[];
    timestamp: number;
    outcome: string;
    rejectionReason?: string;
  }>;
  zoneBackoff: Record<string, ZoneBackoff>;
  lastProposalTime: number;
  proposalsToday: number;
}

// ---- Generic poll hook ----

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

// ---- Main hook ----

export function useEvolutionAPI() {
  const status = usePollAPI<EvolutionStatus>("/api/evolution/status", 10000);
  const audit = usePollAPI<{ entries: AuditEntry[] }>("/api/evolution/audit?limit=50", 30000);
  const memory = usePollAPI<EvolutionMemory>("/api/evolution/memory", 30000);

  const pauseEvolution = useCallback(async () => {
    const res = await fetch(`${API_BASE_URL}/api/evolution/pause`, { method: "POST" });
    return res.json();
  }, []);

  const resumeEvolution = useCallback(async () => {
    const res = await fetch(`${API_BASE_URL}/api/evolution/resume`, { method: "POST" });
    return res.json();
  }, []);

  const triggerRollback = useCallback(async () => {
    const res = await fetch(`${API_BASE_URL}/api/evolution/rollback`, { method: "POST" });
    return res.json();
  }, []);

  return {
    status: status.data,
    statusLoading: status.loading,
    statusError: status.error,

    audit: audit.data?.entries ?? [],
    auditLoading: audit.loading,

    memory: memory.data,
    memoryLoading: memory.loading,

    pauseEvolution,
    resumeEvolution,
    triggerRollback,

    refetchAll: () => {
      status.refetch();
      audit.refetch();
      memory.refetch();
    },
  };
}
