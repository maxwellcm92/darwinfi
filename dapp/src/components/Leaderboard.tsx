import type { Strategy } from "../hooks/useDarwinFiAPI";

function StatusBadge({ status }: { status: string }) {
  const upper = status.toUpperCase();
  let colorClass = "bg-darwin-text-dim/20 text-darwin-text-dim border-darwin-text-dim/30";

  if (upper === "LIVE") {
    colorClass = "bg-darwin-accent/20 text-darwin-accent border-darwin-accent/30";
  } else if (upper === "PAPER") {
    colorClass = "bg-darwin-purple/20 text-darwin-purple border-darwin-purple/30";
  } else if (upper === "SELL_ONLY" || upper === "SELL ONLY") {
    colorClass = "bg-darwin-warning/20 text-darwin-warning border-darwin-warning/30";
  } else if (upper === "ELIMINATED" || upper === "DEAD") {
    colorClass = "bg-darwin-danger/20 text-darwin-danger border-darwin-danger/30";
  }

  return (
    <span
      className={`inline-block px-2 py-0.5 text-sm font-mono rounded border ${colorClass}`}
    >
      {upper}
    </span>
  );
}

function ScoreBar({ score, maxScore }: { score: number; maxScore: number }) {
  const pct = maxScore > 0 ? Math.min((score / maxScore) * 100, 100) : 0;
  return (
    <div className="w-full h-2 bg-darwin-bg rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700 bg-gradient-to-r from-darwin-purple to-darwin-accent"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

interface LeaderboardProps {
  strategies: Strategy[];
  loading: boolean;
}

export function Leaderboard({ strategies, loading }: LeaderboardProps) {
  if (loading && strategies.length === 0) {
    return (
      <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-6">
        <div className="section-header text-darwin-text-bright mb-4">STRATEGY TOURNAMENT</div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="skeleton w-8 h-8 rounded-lg" />
              <div className="flex-1">
                <div className="skeleton-text w-32 mb-2" />
                <div className="skeleton-text w-full h-2" />
              </div>
              <div className="skeleton-text w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Sort by score descending
  const sorted = [...strategies].sort((a, b) => b.score - a.score);
  const maxScore = sorted.length > 0 ? Math.max(...sorted.map((s) => s.score), 1) : 1;

  return (
    <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl overflow-hidden transition-all duration-300 hover:border-darwin-border/80 hover:shadow-lg hover:shadow-black/20">
      <div className="p-5 border-b border-darwin-border/50">
        <h3 className="section-header text-darwin-text-bright">
          STRATEGY TOURNAMENT
        </h3>
      </div>

      {sorted.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-base font-mono text-darwin-text-dim">
            No strategies loaded yet.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-darwin-border/50">
                <th className="px-4 py-3 text-left text-sm font-mono text-darwin-text-dim uppercase">#</th>
                <th className="px-4 py-3 text-left text-sm font-mono text-darwin-text-dim uppercase">Strategy</th>
                <th className="px-4 py-3 text-left text-sm font-mono text-darwin-text-dim uppercase">Role</th>
                <th className="px-4 py-3 text-left text-sm font-mono text-darwin-text-dim uppercase">Status</th>
                <th className="px-4 py-3 text-left text-sm font-mono text-darwin-text-dim uppercase min-w-[120px]">Score</th>
                <th className="px-4 py-3 text-right text-sm font-mono text-darwin-text-dim uppercase">PnL</th>
                <th className="px-4 py-3 text-right text-sm font-mono text-darwin-text-dim uppercase">Win Rate</th>
                <th className="px-4 py-3 text-right text-sm font-mono text-darwin-text-dim uppercase">Trades</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((strategy, index) => (
                <tr
                  key={strategy.name}
                  className={`border-b border-darwin-border/30 hover:bg-darwin-card-hover transition-colors ${
                    index === 0 ? "bg-darwin-accent/5" : ""
                  }`}
                >
                  <td className="px-4 py-3">
                    <span
                      className={`text-base font-mono font-bold ${
                        index === 0
                          ? "text-darwin-accent"
                          : index === 1
                            ? "text-darwin-text-bright"
                            : index === 2
                              ? "text-darwin-purple"
                              : "text-darwin-text-dim"
                      }`}
                    >
                      {index + 1}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-base font-mono text-darwin-text-bright font-medium">
                      {strategy.name}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm font-mono text-darwin-text-dim uppercase">
                      {strategy.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={strategy.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      <ScoreBar score={strategy.score} maxScore={maxScore} />
                      <span className="text-sm font-mono text-darwin-text-dim">
                        {strategy.score.toFixed(1)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`text-base font-mono font-medium ${
                        strategy.pnl >= 0 ? "text-darwin-accent" : "text-darwin-danger"
                      }`}
                    >
                      {strategy.pnl >= 0 ? "+" : ""}
                      ${Math.abs(strategy.pnl).toFixed(2)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-base font-mono text-darwin-text">
                      {(strategy.winRate * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-base font-mono text-darwin-text">
                      {strategy.trades}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
