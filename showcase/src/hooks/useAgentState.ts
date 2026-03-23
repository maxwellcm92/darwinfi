"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchAgentState } from "@/lib/api";
import type { AgentState } from "@/lib/api";

export function useAgentState(intervalMs = 8000) {
  const [data, setData] = useState<AgentState | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      setData(await fetchAgentState());
    } catch {
      /* silently retry on next interval */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, intervalMs);
    return () => clearInterval(id);
  }, [fetchData, intervalMs]);

  return { data, loading };
}
