import type { AgentState } from "../hooks/useDarwinFiAPI";

function formatUptime(seconds?: number): string {
  if (seconds == null) return "--";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

interface AgentStatusProps {
  agentState: AgentState | null;
  loading: boolean;
  computedPnl?: number | null;
  computedChampion?: string | null;
  computedCycle?: number | null;
}

export function AgentStatus({ agentState, loading, computedPnl, computedChampion, computedCycle }: AgentStatusProps) {
  if (loading && !agentState) {
    return (
      <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-6">
        <div className="section-header text-darwin-text-bright mb-4">AGENT STATUS</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-darwin-bg rounded-lg p-4">
              <div className="skeleton-text w-20 mb-2" />
              <div className="skeleton-value w-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const isOnline = agentState?.status === "running" || agentState?.status === "active"
    || (agentState?.uptime != null && agentState.uptime > 0);

  return (
    <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-6 transition-all duration-300 hover:border-darwin-border/80 hover:shadow-lg hover:shadow-black/20">
      <div className="flex items-center justify-between mb-4">
        <h3 className="section-header text-darwin-text-bright">
          AGENT STATUS
        </h3>
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              isOnline ? "bg-darwin-accent animate-pulse-glow" : "bg-darwin-danger"
            }`}
          />
          <span
            className={`text-sm font-mono uppercase ${
              isOnline ? "text-darwin-accent" : "text-darwin-danger"
            }`}
          >
            {isOnline ? "ONLINE" : agentState?.status?.toUpperCase() ?? "OFFLINE"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-darwin-bg rounded-lg p-4">
          <p className="text-sm font-mono text-darwin-text-dim mb-1">Uptime</p>
          <p className="text-base font-mono text-darwin-text-bright font-medium">
            {agentState?.uptimeFormatted ?? formatUptime(agentState?.uptime)}
          </p>
        </div>

        <div className="bg-darwin-bg rounded-lg p-4">
          <p className="text-sm font-mono text-darwin-text-dim mb-1">Champion Strategy</p>
          <p className="text-base font-mono text-darwin-accent font-medium truncate">
            {computedChampion ?? agentState?.championStrategy ?? "--"}
          </p>
        </div>

        <div className="bg-darwin-bg rounded-lg p-4">
          <p className="text-sm font-mono text-darwin-text-dim mb-1">Evolution Cycle</p>
          <p className="text-base font-mono text-darwin-purple font-medium text-glow-purple">
            {computedCycle ?? agentState?.evolutionCycle ?? "--"}
          </p>
        </div>

        <div className="bg-darwin-bg rounded-lg p-4">
          <p className="text-sm font-mono text-darwin-text-dim mb-1">Total PnL</p>
          {(() => {
            const pnl = computedPnl ?? agentState?.totalPnl;
            return (
              <p
                className={`text-base font-mono font-medium ${
                  (pnl ?? 0) >= 0 ? "text-darwin-accent" : "text-darwin-danger"
                }`}
              >
                {pnl != null
                  ? `${pnl >= 0 ? "+" : ""}$${Math.abs(pnl).toFixed(2)}`
                  : "--"}
              </p>
            );
          })()}
        </div>
      </div>

      {/* Win rate + total trades footer */}
      {(agentState?.winRate != null || agentState?.totalTrades != null) && (
        <div className="mt-3 flex items-center gap-4 text-sm font-mono text-darwin-text-dim">
          {agentState?.winRate != null && (
            <span>Win Rate: {(agentState.winRate * 100).toFixed(1)}%</span>
          )}
          {agentState?.totalTrades != null && (
            <span>Total Trades: {agentState.totalTrades}</span>
          )}
        </div>
      )}
    </div>
  );
}
