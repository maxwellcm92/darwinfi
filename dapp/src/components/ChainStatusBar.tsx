import type { ChainState } from "../hooks/useFrontierAPI";

const CHAIN_NAMES: Record<number, string> = {
  8453: "Base",
  42161: "Arbitrum",
  1: "Ethereum",
};

const CHAIN_COLORS: Record<number, string> = {
  8453: "#0052FF",
  42161: "#28A0F0",
  1: "#627EEA",
};

export function ChainStatusBar({
  chains,
  loading,
}: {
  chains: ChainState[];
  loading: boolean;
}) {
  if (loading && chains.length === 0) {
    return (
      <div className="flex gap-3">
        {[1, 2].map((i) => (
          <div key={i} className="skeleton w-36 h-12 rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      {chains.map((chain) => {
        const name = chain.chainName || CHAIN_NAMES[chain.chainId] || `Chain ${chain.chainId}`;
        const color = CHAIN_COLORS[chain.chainId] || "#8040DD";

        return (
          <div
            key={chain.chainId}
            className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-lg px-4 py-2 flex items-center gap-3 transition-all duration-200 hover:border-darwin-border/80"
          >
            {/* Health indicator */}
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                chain.healthy
                  ? "bg-darwin-accent animate-pulse-glow"
                  : "bg-darwin-danger"
              }`}
            />

            {/* Chain info */}
            <div className="flex flex-col">
              <span
                className="text-sm font-mono font-bold"
                style={{ color }}
              >
                {name}
              </span>
              <div className="flex items-center gap-2 text-xs font-mono text-darwin-text-dim">
                <span>ID: {chain.chainId}</span>
                {chain.gasPrice && <span>Gas: {chain.gasPrice}</span>}
                {chain.blockNumber && <span>#{chain.blockNumber}</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
