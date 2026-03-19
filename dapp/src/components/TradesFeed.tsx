import type { Trade } from "../hooks/useDarwinFiAPI";

function formatTime(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return "--:--:--";
  }
}

function formatDate(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

interface TradesFeedProps {
  trades: Trade[];
  loading: boolean;
  maxItems?: number;
}

export function TradesFeed({ trades, loading, maxItems = 20 }: TradesFeedProps) {
  const displayed = trades.slice(0, maxItems);

  return (
    <div className="bg-darwin-card border border-darwin-border rounded-lg overflow-hidden">
      <div className="p-4 border-b border-darwin-border flex items-center justify-between">
        <h3 className="font-arcade text-xs text-darwin-accent tracking-wider">
          RECENT TRADES
        </h3>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-darwin-accent animate-pulse-glow" />
          <span className="text-xs font-mono text-darwin-text-dim">LIVE</span>
        </div>
      </div>

      {loading && trades.length === 0 ? (
        <div className="p-8 text-center">
          <p className="font-mono text-darwin-text-dim text-sm animate-pulse-glow">
            Loading trades...
          </p>
        </div>
      ) : displayed.length === 0 ? (
        <div className="p-8 text-center">
          <p className="font-mono text-darwin-text-dim text-sm">
            No trades yet. The agent is warming up.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-darwin-border/50">
          {displayed.map((trade) => (
            <div
              key={trade.id}
              className="px-4 py-3 hover:bg-darwin-card-hover transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {/* Action badge */}
                  <span
                    className={`inline-block w-12 text-center px-2 py-0.5 text-xs font-mono font-bold rounded ${
                      trade.action === "BUY"
                        ? "bg-darwin-accent/20 text-darwin-accent border border-darwin-accent/30"
                        : "bg-darwin-danger/20 text-darwin-danger border border-darwin-danger/30"
                    }`}
                  >
                    {trade.action}
                  </span>

                  {/* Token + Strategy */}
                  <div>
                    <p className="text-sm font-mono text-darwin-text-bright font-medium">
                      {trade.token}
                    </p>
                    <p className="text-xs font-mono text-darwin-text-dim">
                      {trade.strategy}
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <p className="text-sm font-mono text-darwin-text-bright">
                    ${trade.price.toFixed(4)}
                  </p>
                  <div className="flex items-center gap-2 justify-end">
                    {trade.pnl != null && (
                      <span
                        className={`text-xs font-mono ${
                          trade.pnl >= 0 ? "text-darwin-accent" : "text-darwin-danger"
                        }`}
                      >
                        {trade.pnl >= 0 ? "+" : ""}${trade.pnl.toFixed(2)}
                      </span>
                    )}
                    <span className="text-xs font-mono text-darwin-text-dim">
                      {formatDate(trade.timestamp)} {formatTime(trade.timestamp)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
