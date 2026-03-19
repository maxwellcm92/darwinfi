"use client";

import { usePollAPI } from "@/hooks/usePollAPI";
import type { Strategy } from "@/lib/api";

export function LiveLeaderboard() {
  const { data, loading } = usePollAPI<Strategy[]>("/api/strategies", 5000);

  const sorted = data
    ? [...data].sort((a, b) => b.score - a.score).slice(0, 12)
    : [];

  const championName = sorted.length > 0 ? sorted[0].name : null;

  return (
    <div className="darwin-card overflow-hidden">
      <h3 className="section-header text-darwin-accent mb-4">
        Strategy Leaderboard
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-darwin-border text-darwin-text-dim text-left">
              <th className="py-2 pr-2 font-medium">#</th>
              <th className="py-2 pr-3 font-medium">Name</th>
              <th className="py-2 pr-3 font-medium hidden sm:table-cell">Role</th>
              <th className="py-2 pr-3 font-medium hidden md:table-cell">Status</th>
              <th className="py-2 pr-3 font-medium text-right">Score</th>
              <th className="py-2 pr-3 font-medium text-right">PnL</th>
              <th className="py-2 pr-3 font-medium text-right hidden sm:table-cell">Win Rate</th>
              <th className="py-2 font-medium text-right hidden md:table-cell">Trades</th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-darwin-border/30">
                    <td colSpan={8} className="py-3">
                      <div className="skeleton h-5 w-full" />
                    </td>
                  </tr>
                ))
              : sorted.map((s, i) => {
                  const isChampion = s.name === championName;
                  return (
                    <tr
                      key={s.name}
                      className={`border-b border-darwin-border/30 transition-colors ${
                        isChampion
                          ? "bg-darwin-gold/10 border-l-2 border-l-darwin-gold"
                          : "hover:bg-darwin-card-hover"
                      }`}
                    >
                      <td className="py-2.5 pr-2 font-mono text-darwin-text-dim">
                        {isChampion ? (
                          <span className="text-darwin-gold font-bold">1</span>
                        ) : (
                          i + 1
                        )}
                      </td>
                      <td className="py-2.5 pr-3 font-medium text-darwin-text-bright">
                        {s.name}
                        {isChampion && (
                          <span className="ml-2 text-xs text-darwin-gold font-mono">
                            CHAMPION
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-darwin-text-dim hidden sm:table-cell">
                        {s.role}
                      </td>
                      <td className="py-2.5 pr-3 hidden md:table-cell">
                        <span
                          className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                            s.status === "active"
                              ? "bg-darwin-success/10 text-darwin-success"
                              : s.status === "eliminated"
                              ? "bg-darwin-danger/10 text-darwin-danger"
                              : "bg-darwin-warning/10 text-darwin-warning"
                          }`}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono text-darwin-text-bright">
                        {s.score.toFixed(1)}
                      </td>
                      <td
                        className={`py-2.5 pr-3 text-right font-mono ${
                          s.pnl >= 0
                            ? "text-darwin-success"
                            : "text-darwin-danger"
                        }`}
                      >
                        {s.pnl >= 0 ? "+" : ""}
                        {s.pnl.toFixed(2)}%
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono text-darwin-text hidden sm:table-cell">
                        {(s.winRate * 100).toFixed(0)}%
                      </td>
                      <td className="py-2.5 text-right font-mono text-darwin-text-dim hidden md:table-cell">
                        {s.trades}
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
      {!loading && sorted.length === 0 && (
        <p className="text-center text-darwin-text-dim py-8 font-mono text-sm">
          No strategy data available
        </p>
      )}
    </div>
  );
}
