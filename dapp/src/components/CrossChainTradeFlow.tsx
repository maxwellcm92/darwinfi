import type { FrontierStrategy, ChainState } from "../hooks/useFrontierAPI";

const CHAIN_LABELS: Record<number, string> = {
  8453: "Base",
  42161: "Arbitrum",
  1: "Ethereum",
};

export function CrossChainTradeFlow({
  strategies,
  chains,
  loading,
}: {
  strategies: FrontierStrategy[];
  chains: ChainState[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-6">
        <div className="section-header text-darwin-text-bright mb-4">
          CROSS-CHAIN TRADE FLOW
        </div>
        <div className="skeleton w-full h-32 rounded-lg" />
      </div>
    );
  }

  // Build chain activity counts
  const chainActivity: Record<number, { bots: string[]; trades: number }> = {};
  for (const chain of chains) {
    chainActivity[chain.chainId] = { bots: [], trades: 0 };
  }

  for (const strategy of strategies) {
    for (const chainId of strategy.chainPreferences) {
      if (!chainActivity[chainId]) {
        chainActivity[chainId] = { bots: [], trades: 0 };
      }
      chainActivity[chainId].bots.push(strategy.name);
      chainActivity[chainId].trades += strategy.trades;
    }
  }

  const activeChainIds = Object.keys(chainActivity)
    .map(Number)
    .filter((id) => chainActivity[id].bots.length > 0);

  return (
    <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl overflow-hidden transition-all duration-300 hover:border-darwin-border/80">
      <div className="p-5 border-b border-darwin-border/50">
        <h3 className="section-header text-darwin-text-bright">
          CROSS-CHAIN TRADE FLOW
        </h3>
      </div>

      <div className="p-5">
        {activeChainIds.length === 0 ? (
          <p className="text-sm font-mono text-darwin-text-dim text-center py-4">
            No cross-chain activity yet
          </p>
        ) : (
          <div className="flex items-stretch gap-3 justify-center">
            {activeChainIds.map((chainId, idx) => {
              const chain = chains.find((c) => c.chainId === chainId);
              const activity = chainActivity[chainId];
              const label = CHAIN_LABELS[chainId] || `Chain ${chainId}`;

              return (
                <div key={chainId} className="flex items-center gap-3">
                  {/* Chain node */}
                  <div className="flex flex-col items-center gap-2 min-w-[120px]">
                    <div
                      className={`w-16 h-16 rounded-xl border-2 flex items-center justify-center ${
                        chain?.healthy
                          ? "border-darwin-accent/50 bg-darwin-accent/5"
                          : "border-darwin-danger/50 bg-darwin-danger/5"
                      }`}
                    >
                      <div className="text-center">
                        <p className="text-xs font-mono font-bold text-darwin-text-bright">
                          {label}
                        </p>
                        <p className="text-[9px] font-mono text-darwin-text-dim">
                          {activity.trades} trades
                        </p>
                      </div>
                    </div>

                    {/* Bots on this chain */}
                    <div className="flex flex-wrap gap-1 justify-center max-w-[120px]">
                      {activity.bots.map((bot) => (
                        <span
                          key={bot}
                          className="px-1.5 py-0.5 rounded text-[8px] font-mono bg-darwin-purple/20 text-darwin-purple"
                        >
                          {bot}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Connector arrow */}
                  {idx < activeChainIds.length - 1 && (
                    <div className="flex items-center text-darwin-text-dim">
                      <div className="w-8 h-px bg-darwin-border/50" />
                      <span className="text-xs mx-1">{"->"}</span>
                      <div className="w-8 h-px bg-darwin-border/50" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
