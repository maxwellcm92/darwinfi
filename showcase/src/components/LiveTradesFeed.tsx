"use client";

import { useEffect, useRef } from "react";
import { usePollAPI } from "@/hooks/usePollAPI";
import type { Trade } from "@/lib/api";

export function LiveTradesFeed() {
  const { data, loading } = usePollAPI<Trade[]>("/api/trades", 5000);
  const scrollRef = useRef<HTMLDivElement>(null);

  const trades = data ? data.slice(0, 20) : [];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [data]);

  const formatTime = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
    } catch {
      return ts;
    }
  };

  return (
    <div className="darwin-card flex flex-col" style={{ maxHeight: "480px" }}>
      <h3 className="section-header text-darwin-accent mb-4">
        Recent Trades
      </h3>
      <div ref={scrollRef} className="overflow-y-auto flex-1 space-y-2">
        {loading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton h-14 w-full" />
            ))
          : trades.length === 0
          ? (
            <p className="text-center text-darwin-text-dim py-8 font-mono text-base">
              No trades yet
            </p>
          )
          : trades.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 p-2.5 rounded-lg bg-darwin-bg/50 border border-darwin-border/30 hover:border-darwin-border/60 transition-colors"
              >
                <span
                  className={`text-sm font-mono font-bold px-2 py-1 rounded ${
                    t.action === "BUY"
                      ? "bg-darwin-success/15 text-darwin-success"
                      : "bg-darwin-danger/15 text-darwin-danger"
                  }`}
                >
                  {t.action}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-base text-darwin-text-bright truncate">
                    {t.token}
                  </p>
                  <p className="text-sm text-darwin-text-dim font-mono">
                    {t.strategy}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-base font-mono text-darwin-text">
                    ${t.amount.toFixed(2)}
                  </p>
                  {t.pnl != null && (
                    <p
                      className={`text-sm font-mono ${
                        t.pnl >= 0
                          ? "text-darwin-success"
                          : "text-darwin-danger"
                      }`}
                    >
                      {t.pnl >= 0 ? "+" : ""}
                      {t.pnl.toFixed(2)}%
                    </p>
                  )}
                </div>
                <span className="text-sm text-darwin-text-dim font-mono shrink-0">
                  {formatTime(t.timestamp)}
                </span>
              </div>
            ))}
      </div>
    </div>
  );
}
