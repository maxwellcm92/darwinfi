import { useDarwinFiAPI } from "../hooks/useDarwinFiAPI";
import { useVaultStats } from "../hooks/useVaultStats";
import { useInstinctAPI } from "../hooks/useInstinctAPI";
import { useEvolutionAPI } from "../hooks/useEvolutionAPI";

function LiveIndicator({ agentState }: { agentState: any }) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex items-center gap-2">
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-green-400" />
        </span>
        <span className="text-sm font-mono text-green-400 uppercase tracking-wider">
          Live
        </span>
      </div>
      {agentState?.uptimeFormatted && (
        <span className="text-sm font-mono text-darwin-text-dim">
          Uptime: {agentState.uptimeFormatted}
        </span>
      )}
      {agentState?.evolutionCycle != null && (
        <span className="text-sm font-mono text-darwin-text-dim">
          Cycle {agentState.evolutionCycle}
        </span>
      )}
    </div>
  );
}

function VaultStatsRow() {
  const { tvl, sharePrice, borrowed, available } = useVaultStats();

  // tvl and sharePrice are formatted strings from formatUnits, or null
  const stats = [
    { label: "Total Value Locked", value: tvl != null ? `$${Number(tvl).toFixed(2)}` : "--" },
    { label: "Share Price", value: sharePrice != null ? `$${Number(sharePrice).toFixed(6)}` : "--" },
    { label: "Borrowed", value: borrowed != null ? `$${Number(borrowed).toFixed(2)}` : "--" },
    { label: "Available", value: available != null ? `$${Number(available).toFixed(2)}` : "--" },
  ];

  const isLoading = tvl == null && sharePrice == null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((s) => (
        <div key={s.label} className="darwin-card text-center">
          <p className="text-xs font-bold uppercase tracking-wider text-darwin-text-dim mb-2">{s.label}</p>
          {isLoading ? (
            <div className="h-8 w-24 mx-auto bg-darwin-border/30 rounded animate-pulse" />
          ) : (
            <p className="text-2xl font-bold text-darwin-text-bright">{s.value}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function TradesFeed({ trades, loading }: { trades: any[]; loading: boolean }) {
  const formatTime = (ts: string) => {
    try {
      return new Date(ts).toLocaleTimeString("en-US", {
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      });
    } catch { return ts; }
  };

  return (
    <div className="darwin-card flex flex-col" style={{ maxHeight: "480px" }}>
      <h3 className="text-xs font-bold uppercase tracking-wider text-darwin-accent mb-4">Recent Trades</h3>
      <div className="overflow-y-auto flex-1 space-y-2">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 w-full bg-darwin-border/30 rounded animate-pulse" />
          ))
        ) : trades.length === 0 ? (
          <p className="text-center text-darwin-text-dim py-8 font-mono text-base">No trades yet</p>
        ) : (
          trades.slice(0, 20).map((t) => (
            <div key={t.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-darwin-bg/50 border border-darwin-border/30">
              <span className={`text-sm font-mono font-bold px-2 py-1 rounded ${
                t.action === "BUY" ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"
              }`}>
                {t.action}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-base text-darwin-text-bright truncate">{t.token}</p>
                <p className="text-sm text-darwin-text-dim font-mono">{t.strategy}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-base font-mono text-darwin-text">${t.amount?.toFixed(2)}</p>
                {t.pnl != null && (
                  <p className={`text-sm font-mono ${t.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {t.pnl >= 0 ? "+" : ""}{t.pnl.toFixed(2)}%
                  </p>
                )}
              </div>
              <span className="text-sm text-darwin-text-dim font-mono shrink-0">{formatTime(t.timestamp)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Leaderboard({ strategies, loading }: { strategies: any[]; loading: boolean }) {
  const sorted = strategies ? [...strategies].sort((a, b) => b.score - a.score) : [];
  const champion = sorted.length > 0 ? sorted[0].name : null;

  return (
    <div className="darwin-card overflow-hidden">
      <h3 className="text-xs font-bold uppercase tracking-wider text-darwin-accent mb-4">Strategy Leaderboard</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-base">
          <thead>
            <tr className="border-b border-darwin-border text-darwin-text-dim text-left">
              <th className="py-2 pr-2 font-medium">#</th>
              <th className="py-2 pr-3 font-medium">Name</th>
              <th className="py-2 pr-3 font-medium hidden sm:table-cell">Role</th>
              <th className="py-2 pr-3 font-medium text-right">Score</th>
              <th className="py-2 pr-3 font-medium text-right">PnL</th>
              <th className="py-2 pr-3 font-medium text-right hidden sm:table-cell">Win Rate</th>
              <th className="py-2 font-medium text-right hidden md:table-cell">Trades</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-darwin-border/30">
                  <td colSpan={7} className="py-3"><div className="h-5 w-full bg-darwin-border/30 rounded animate-pulse" /></td>
                </tr>
              ))
            ) : (
              sorted.map((s, i) => {
                const isChamp = s.name === champion;
                return (
                  <tr key={s.name} className={`border-b border-darwin-border/30 transition-colors ${
                    isChamp ? "bg-yellow-500/10 border-l-2 border-l-yellow-500" : "hover:bg-darwin-card-hover"
                  }`}>
                    <td className="py-2.5 pr-2 font-mono text-darwin-text-dim">
                      {isChamp ? <span className="text-yellow-500 font-bold">1</span> : i + 1}
                    </td>
                    <td className="py-2.5 pr-3 font-medium text-darwin-text-bright">
                      {s.name}
                      {isChamp && <span className="ml-2 text-sm text-yellow-500 font-mono">CHAMPION</span>}
                    </td>
                    <td className="py-2.5 pr-3 text-darwin-text-dim hidden sm:table-cell">{s.role}</td>
                    <td className="py-2.5 pr-3 text-right font-mono text-darwin-text-bright">{s.score?.toFixed(1)}</td>
                    <td className={`py-2.5 pr-3 text-right font-mono ${s.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {s.pnl >= 0 ? "+" : ""}{s.pnl?.toFixed(2)}%
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono text-darwin-text hidden sm:table-cell">
                      {((s.winRate || 0) * 100).toFixed(0)}%
                    </td>
                    <td className="py-2.5 text-right font-mono text-darwin-text-dim hidden md:table-cell">{s.trades}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EvolutionTimeline({ entries, loading }: { entries: any[]; loading: boolean }) {
  const formatTimestamp = (ts: string) => {
    try {
      return new Date(ts).toLocaleString("en-US", {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
      });
    } catch { return ts; }
  };

  return (
    <div className="darwin-card">
      <h3 className="text-xs font-bold uppercase tracking-wider text-darwin-accent mb-4">Evolution Timeline</h3>
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 w-full bg-darwin-border/30 rounded animate-pulse" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="text-center text-darwin-text-dim py-8 font-mono text-base">No evolution cycles yet</p>
      ) : (
        <div className="relative">
          <div className="absolute left-3 top-0 bottom-0 w-px bg-darwin-border/50" />
          <div className="space-y-4">
            {entries.map((e) => (
              <div key={e.cycle} className="relative pl-8">
                <div className="absolute left-1.5 top-2 w-3 h-3 rounded-full bg-purple-500 border-2 border-darwin-bg" />
                <div className="p-3 rounded-lg bg-darwin-bg/50 border border-darwin-border/30">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-sm font-mono text-purple-400 font-bold">Cycle {e.cycle}</span>
                    <span className="text-sm font-mono text-darwin-text-dim">{formatTimestamp(e.timestamp)}</span>
                  </div>
                  <p className="text-base text-darwin-text-bright">
                    Champion: <span className="text-yellow-500 font-medium">{e.champion}</span>
                  </p>
                  {e.promoted && (
                    <p className="text-sm text-green-400 font-mono mt-1">Promoted: {e.promoted}</p>
                  )}
                  {e.eliminated && (
                    <p className="text-sm text-red-400 font-mono mt-1">Eliminated: {e.eliminated}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InstinctPredictions() {
  const { instinctState, instinctLoading } = useInstinctAPI();

  if (instinctLoading || !instinctState?.tokens) return null;

  const tokenEntries = Object.entries(instinctState.tokens);
  if (tokenEntries.length === 0) return null;

  return (
    <div className="darwin-card">
      <h3 className="text-xs font-bold uppercase tracking-wider text-darwin-accent mb-4">Instinct Predictions</h3>
      {instinctState.health && (
        <div className="mb-4 p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
          <span className="text-sm font-mono text-purple-400">System Health</span>
          <div className="flex items-center gap-4 mt-1">
            <span className="text-sm font-mono text-darwin-text">
              {instinctState.health.sensesActive} senses / {instinctState.health.reflexesActive} reflexes
            </span>
            <div className="flex items-center gap-2">
              <div className="w-16 h-1.5 rounded-full bg-darwin-border overflow-hidden">
                <div
                  className="h-full rounded-full bg-purple-400"
                  style={{ width: `${(instinctState.health.overallConfidence * 100).toFixed(0)}%` }}
                />
              </div>
              <span className="text-sm font-mono text-darwin-text-dim">
                {(instinctState.health.overallConfidence * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        </div>
      )}
      <div className="space-y-3">
        {tokenEntries.map(([token, data]) => {
          const predictions = data.predictions;
          const timeframes = Object.entries(predictions).filter(([_, p]) => p != null);
          return (
            <div key={token} className="p-3 rounded-lg bg-darwin-bg/50 border border-darwin-border/30">
              <div className="flex items-center justify-between mb-2">
                <p className="text-base font-medium text-darwin-text-bright">{token}</p>
                {data.sentiment && (
                  <span className={`text-sm font-mono ${
                    data.sentiment.score > 0 ? "text-green-400" : data.sentiment.score < 0 ? "text-red-400" : "text-darwin-text-dim"
                  }`}>
                    Sentiment: {data.sentiment.score > 0 ? "+" : ""}{data.sentiment.score.toFixed(2)}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {timeframes.map(([tf, p]) => (
                  <div key={tf} className="flex items-center gap-2 px-2 py-1 rounded bg-darwin-border/20">
                    <span className="text-xs font-mono text-darwin-text-dim">{tf}</span>
                    <span className={`text-xs font-mono font-bold ${
                      p.direction === "up" ? "text-green-400" : p.direction === "down" ? "text-red-400" : "text-darwin-text-dim"
                    }`}>
                      {p.direction.toUpperCase()}
                    </span>
                    <span className="text-xs font-mono text-darwin-text-dim">
                      {(p.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EvolutionStatus() {
  const { status, statusLoading } = useEvolutionAPI();

  if (statusLoading || !status) return null;

  return (
    <div className="darwin-card">
      <h3 className="text-xs font-bold uppercase tracking-wider text-darwin-accent mb-4">Self-Evolution Status</h3>
      <div className="space-y-3">
        <div className="flex items-center justify-between p-2.5 rounded-lg bg-darwin-bg/50 border border-darwin-border/30">
          <span className="text-sm text-darwin-text-dim">Proposals Today</span>
          <span className="text-base font-mono text-darwin-text-bright">{status.proposalsToday}</span>
        </div>
        <div className="flex items-center justify-between p-2.5 rounded-lg bg-darwin-bg/50 border border-darwin-border/30">
          <span className="text-sm text-darwin-text-dim">Total Proposals</span>
          <span className="text-base font-mono text-darwin-text-bright">{status.totalProposals}</span>
        </div>
        {status.canary?.active && (
          <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <div className="flex items-center gap-2 mb-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-400" />
              </span>
              <span className="text-sm font-mono text-yellow-400 font-bold">Canary Active</span>
            </div>
            <p className="text-sm text-darwin-text font-mono">
              Branch: {status.canary.branch}
            </p>
            <div className="flex gap-4 mt-1 text-sm font-mono text-darwin-text-dim">
              <span>PnL: {status.canary.currentMetrics.pnlDelta >= 0 ? "+" : ""}{status.canary.currentMetrics.pnlDelta.toFixed(4)}</span>
              <span>Errors: {status.canary.currentMetrics.errorRate.toFixed(2)}</span>
              <span>Checks: {status.canary.checkCount}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function Results() {
  const { agentState, agentLoading, strategies, strategiesLoading, trades, tradesLoading, evolution, evolutionLoading } = useDarwinFiAPI();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-darwin-text-bright">
            Live Results
          </h1>
          <p className="text-darwin-text-dim mt-2">
            Real-time performance data from the DarwinFi autonomous vault
          </p>
        </div>
        <LiveIndicator agentState={agentState} />
      </div>

      {/* Vault Stats */}
      <VaultStatsRow />

      {/* Trades + Leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <TradesFeed trades={trades} loading={tradesLoading} />
        <Leaderboard strategies={strategies} loading={strategiesLoading} />
      </div>

      {/* Evolution Timeline + Instinct */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <EvolutionTimeline entries={evolution} loading={evolutionLoading} />
        <InstinctPredictions />
      </div>

      {/* Evolution Status */}
      <EvolutionStatus />
    </div>
  );
}
