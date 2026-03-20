import { useEvolutionAPI, CanaryState, ZoneBackoff } from "../hooks/useEvolutionAPI";

function formatTimestamp(ts: number): string {
  if (!ts) return "Never";
  return new Date(ts).toLocaleString();
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function CanaryCard({ canary }: { canary: CanaryState }) {
  const elapsed = Date.now() - canary.startedAt;
  const metrics = canary.currentMetrics;

  return (
    <div className="bg-darwin-card border border-darwin-accent/30 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-darwin-accent font-mono text-sm font-bold">ACTIVE CANARY</h3>
        <span className="text-xs bg-darwin-accent/20 text-darwin-accent px-2 py-0.5 rounded-full animate-pulse">
          LIVE
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs font-mono">
        <div>
          <span className="text-darwin-text-dim">Proposal</span>
          <p className="text-darwin-text-bright truncate">{canary.proposalId.slice(0, 12)}...</p>
        </div>
        <div>
          <span className="text-darwin-text-dim">Elapsed</span>
          <p className="text-darwin-text-bright">{formatDuration(elapsed)}</p>
        </div>
        <div>
          <span className="text-darwin-text-dim">PnL Delta</span>
          <p className={metrics.pnlDelta >= 0 ? "text-green-400" : "text-red-400"}>
            {(metrics.pnlDelta * 100).toFixed(3)}%
          </p>
        </div>
        <div>
          <span className="text-darwin-text-dim">Error Rate</span>
          <p className="text-darwin-text-bright">{metrics.errorRate.toFixed(2)}/min</p>
        </div>
        <div>
          <span className="text-darwin-text-dim">Crashes</span>
          <p className={metrics.crashCount > 0 ? "text-red-400" : "text-darwin-text-bright"}>
            {metrics.crashCount}
          </p>
        </div>
        <div>
          <span className="text-darwin-text-dim">Checks</span>
          <p className="text-darwin-text-bright">{canary.checkCount}</p>
        </div>
      </div>
    </div>
  );
}

function BackoffTable({ backoff }: { backoff: Record<string, ZoneBackoff> }) {
  const entries = Object.values(backoff).filter(z => z.consecutiveFailures > 0);
  if (entries.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-darwin-text-dim font-mono text-xs uppercase tracking-wider">Zone Backoff</h3>
      <div className="space-y-1">
        {entries.map((z) => (
          <div key={z.zone} className="flex items-center justify-between text-xs font-mono bg-darwin-card rounded px-3 py-1.5">
            <span className="text-darwin-text">{z.zone}</span>
            <span className="text-red-400">{z.consecutiveFailures} failures</span>
            <span className="text-darwin-text-dim">
              {z.backoffUntil > Date.now() ? `until ${formatTimestamp(z.backoffUntil)}` : "cleared"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EvolutionPanel() {
  const {
    status, statusLoading, statusError,
    memory,
    pauseEvolution, resumeEvolution, triggerRollback,
  } = useEvolutionAPI();

  if (statusLoading) {
    return (
      <div className="text-center text-darwin-text-dim font-mono text-sm py-12">
        Loading evolution status...
      </div>
    );
  }

  if (statusError) {
    return (
      <div className="text-center text-red-400 font-mono text-sm py-12">
        Error: {statusError}
      </div>
    );
  }

  if (!status) return null;

  return (
    <div className="space-y-6">
      {/* Header Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Proposals" value={String(status.totalProposals)} />
        <StatCard label="Today" value={`${status.proposalsToday}/4`} />
        <StatCard
          label="Last Proposal"
          value={status.lastProposalTime ? formatTimestamp(status.lastProposalTime) : "Never"}
        />
        <StatCard
          label="Status"
          value={status.canary?.active ? "Canary Active" : "Idle"}
          accent={status.canary?.active}
        />
      </div>

      {/* Active Canary */}
      {status.canary?.active && <CanaryCard canary={status.canary} />}

      {/* Controls */}
      <div className="flex gap-3">
        <button
          onClick={pauseEvolution}
          className="px-4 py-2 text-xs font-mono rounded-lg border border-darwin-border hover:border-yellow-500 hover:text-yellow-400 text-darwin-text transition-colors"
        >
          Pause Evolution
        </button>
        <button
          onClick={resumeEvolution}
          className="px-4 py-2 text-xs font-mono rounded-lg border border-darwin-border hover:border-darwin-accent hover:text-darwin-accent text-darwin-text transition-colors"
        >
          Resume
        </button>
        <button
          onClick={() => {
            if (window.confirm("Rollback to master branch? This reverts the current canary.")) {
              triggerRollback();
            }
          }}
          className="px-4 py-2 text-xs font-mono rounded-lg border border-red-500/30 hover:border-red-500 hover:text-red-400 text-darwin-text transition-colors"
        >
          Manual Rollback
        </button>
      </div>

      {/* Zone Backoff */}
      <BackoffTable backoff={status.zoneBackoff} />

      {/* Recent Memory Entries */}
      {memory && memory.recentEntries.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-darwin-text-dim font-mono text-xs uppercase tracking-wider">
            Recent Proposals ({memory.totalEntries} total)
          </h3>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {memory.recentEntries.slice().reverse().map((entry, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-xs font-mono bg-darwin-card rounded px-3 py-2"
              >
                <span className="text-darwin-text-dim">{formatTimestamp(entry.timestamp)}</span>
                <span className="text-darwin-text">{entry.zone}</span>
                <span
                  className={
                    entry.outcome === "promoted"
                      ? "text-green-400"
                      : entry.outcome === "rolled_back"
                      ? "text-red-400"
                      : "text-yellow-400"
                  }
                >
                  {entry.outcome}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-darwin-card rounded-xl p-4 border border-darwin-border/30">
      <p className="text-darwin-text-dim text-xs font-mono mb-1">{label}</p>
      <p className={`text-lg font-mono font-bold ${accent ? "text-darwin-accent" : "text-darwin-text-bright"}`}>
        {value}
      </p>
    </div>
  );
}
