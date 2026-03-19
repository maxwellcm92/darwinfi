import type { VolatilityEvent } from "../hooks/useFrontierAPI";

const CHAIN_LABELS: Record<number, string> = {
  8453: "Base",
  42161: "Arbitrum",
  1: "Ethereum",
};

function getHeatColor(volRatio: number): string {
  if (volRatio >= 4.0) return "bg-red-500/40 border-red-500/60";
  if (volRatio >= 3.0) return "bg-orange-500/30 border-orange-500/50";
  if (volRatio >= 2.0) return "bg-yellow-500/20 border-yellow-500/40";
  if (volRatio >= 1.5) return "bg-green-500/15 border-green-500/30";
  return "bg-darwin-card-hover border-darwin-border/30";
}

function getHeatLabel(volRatio: number): string {
  if (volRatio >= 4.0) return "EXTREME";
  if (volRatio >= 3.0) return "HIGH";
  if (volRatio >= 2.0) return "ELEVATED";
  if (volRatio >= 1.5) return "MODERATE";
  return "LOW";
}

export function VolatilityHeatmap({
  events,
  loading,
}: {
  events: VolatilityEvent[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-6">
        <div className="section-header text-darwin-text-bright mb-4">
          VOLATILITY HEATMAP
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="skeleton w-full h-16 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  // Group events by chain
  const byChain: Record<number, VolatilityEvent[]> = {};
  for (const event of events) {
    if (!byChain[event.chainId]) byChain[event.chainId] = [];
    byChain[event.chainId].push(event);
  }

  // Sort events within each chain by volRatio descending
  for (const chainId of Object.keys(byChain)) {
    byChain[Number(chainId)].sort((a, b) => b.volRatio - a.volRatio);
  }

  return (
    <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl overflow-hidden transition-all duration-300 hover:border-darwin-border/80">
      <div className="p-5 border-b border-darwin-border/50 flex items-center justify-between">
        <h3 className="section-header text-darwin-text-bright">
          VOLATILITY HEATMAP
        </h3>
        <span className="text-[10px] font-mono text-darwin-text-dim">
          {events.length} events
        </span>
      </div>

      {events.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm font-mono text-darwin-text-dim">
            No volatility events detected
          </p>
        </div>
      ) : (
        <div className="p-5 space-y-4">
          {Object.entries(byChain).map(([chainIdStr, chainEvents]) => {
            const chainId = Number(chainIdStr);
            const chainName =
              chainEvents[0]?.chainName ||
              CHAIN_LABELS[chainId] ||
              `Chain ${chainId}`;

            return (
              <div key={chainId}>
                <p className="text-[10px] font-mono text-darwin-text-dim mb-2 uppercase">
                  {chainName}
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {chainEvents.slice(0, 8).map((event) => {
                    const heatColor = getHeatColor(event.volRatio);
                    const heatLabel = getHeatLabel(event.volRatio);

                    return (
                      <div
                        key={`${event.tokenAddress}-${event.chainId}`}
                        className={`rounded-lg border p-3 ${heatColor} transition-all duration-200 hover:scale-105`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-mono font-bold text-darwin-text-bright">
                            {event.tokenSymbol || "???"}
                          </span>
                          <span className="text-[8px] font-mono text-darwin-text-dim">
                            {heatLabel}
                          </span>
                        </div>
                        <p className="text-sm font-mono text-darwin-text-bright">
                          {event.volRatio.toFixed(1)}x
                        </p>
                        {event.catalyst && (
                          <p className="text-[8px] font-mono text-darwin-accent mt-1 truncate">
                            {event.catalyst}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
