import type { WhaleData } from "../hooks/useFrontierAPI";

function shortenAddress(addr: string): string {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3600_000)}h ago`;
}

export function WhaleActivityFeed({
  data,
  loading,
}: {
  data: WhaleData | null;
  loading: boolean;
}) {
  if (loading || !data) {
    return (
      <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-6">
        <div className="section-header text-darwin-text-bright mb-4">
          WHALE ACTIVITY
        </div>
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton w-full h-8 rounded" />
          ))}
        </div>
      </div>
    );
  }

  const activities = data.recentActivity || [];

  return (
    <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl overflow-hidden transition-all duration-300 hover:border-darwin-border/80">
      <div className="p-5 border-b border-darwin-border/50 flex items-center justify-between">
        <h3 className="section-header text-darwin-text-bright">
          WHALE ACTIVITY
        </h3>
        <span className="text-[10px] font-mono text-darwin-text-dim">
          {data.topWhales?.length ?? 0} whales tracked
        </span>
      </div>

      {activities.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm font-mono text-darwin-text-dim">
            No recent whale activity
          </p>
        </div>
      ) : (
        <div className="divide-y divide-darwin-border/30 max-h-80 overflow-y-auto">
          {activities.map((activity, idx) => (
            <div
              key={`${activity.whaleAddress}-${activity.timestamp}-${idx}`}
              className="px-5 py-3 hover:bg-darwin-card-hover transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {/* Action indicator */}
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${
                      activity.action === "buy"
                        ? "bg-darwin-accent/20 text-darwin-accent"
                        : "bg-darwin-danger/20 text-darwin-danger"
                    }`}
                  >
                    {activity.action === "buy" ? "B" : "S"}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-darwin-text-bright">
                        {shortenAddress(activity.whaleAddress)}
                      </span>
                      <span
                        className={`text-[10px] font-mono ${
                          activity.action === "buy"
                            ? "text-darwin-accent"
                            : "text-darwin-danger"
                        }`}
                      >
                        {activity.action.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-mono text-darwin-text-dim">
                        ${activity.amountUsd.toLocaleString()}
                      </span>
                      <span className="text-[10px] font-mono text-darwin-text-dim">
                        {activity.chainName}
                      </span>
                    </div>
                  </div>
                </div>

                <span className="text-[10px] font-mono text-darwin-text-dim">
                  {formatTime(activity.timestamp)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
