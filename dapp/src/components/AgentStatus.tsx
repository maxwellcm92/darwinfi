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
}

export function AgentStatus({ agentState, loading }: AgentStatusProps) {
  if (loading && !agentState) {
    return (
      <div className="bg-darwin-card border border-darwin-border rounded-lg p-6 text-center">
        <p className="font-mono text-darwin-text-dim animate-pulse-glow">
          Connecting to agent...
        </p>
      </div>
    );
  }

  const isOnline = agentState?.status === "running" || agentState?.status === "active";

  return (
    <div className="bg-darwin-card border border-darwin-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-arcade text-xs text-darwin-accent tracking-wider">
          AGENT STATUS
        </h3>
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              isOnline ? "bg-darwin-accent animate-pulse-glow" : "bg-darwin-danger"
            }`}
          />
          <span
            className={`text-xs font-mono uppercase ${
              isOnline ? "text-darwin-accent" : "text-darwin-danger"
            }`}
          >
            {isOnline ? "ONLINE" : agentState?.status?.toUpperCase() ?? "OFFLINE"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-darwin-bg rounded p-3">
          <p className="text-xs font-mono text-darwin-text-dim mb-1">Uptime</p>
          <p className="text-sm font-mono text-darwin-text-bright font-medium">
            {agentState?.uptimeFormatted ?? formatUptime(agentState?.uptime)}
          </p>
        </div>

        <div className="bg-darwin-bg rounded p-3">
          <p className="text-xs font-mono text-darwin-text-dim mb-1">Champion Strategy</p>
          <p className="text-sm font-mono text-darwin-accent font-medium truncate">
            {agentState?.championStrategy ?? "--"}
          </p>
        </div>

        <div className="bg-darwin-bg rounded p-3">
          <p className="text-xs font-mono text-darwin-text-dim mb-1">Evolution Cycle</p>
          <p className="text-sm font-mono text-darwin-purple font-medium text-glow-purple">
            {agentState?.evolutionCycle ?? "--"}
          </p>
        </div>

        <div className="bg-darwin-bg rounded p-3">
          <p className="text-xs font-mono text-darwin-text-dim mb-1">Total PnL</p>
          <p
            className={`text-sm font-mono font-medium ${
              (agentState?.totalPnl ?? 0) >= 0 ? "text-darwin-accent" : "text-darwin-danger"
            }`}
          >
            {agentState?.totalPnl != null
              ? `${agentState.totalPnl >= 0 ? "+" : ""}$${Math.abs(agentState.totalPnl).toFixed(2)}`
              : "--"}
          </p>
        </div>
      </div>

      {/* Win rate + total trades footer */}
      {(agentState?.winRate != null || agentState?.totalTrades != null) && (
        <div className="mt-3 flex items-center gap-4 text-xs font-mono text-darwin-text-dim">
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
