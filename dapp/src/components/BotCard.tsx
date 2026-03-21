import type { FrontierStrategy } from "../hooks/useFrontierAPI";

const ARCHETYPE_ICONS: Record<string, string> = {
  abiogenesis: "🧬",
  mitosis: "🔬",
  cambrian: "🌋",
  symbiont: "🐙",
};

const ARCHETYPE_COLORS: Record<string, string> = {
  abiogenesis: "text-green-400",
  mitosis: "text-blue-400",
  cambrian: "text-orange-400",
  symbiont: "text-purple-400",
};

const ARCHETYPE_BG: Record<string, string> = {
  abiogenesis: "bg-green-500/10 border-green-500/30",
  mitosis: "bg-blue-500/10 border-blue-500/30",
  cambrian: "bg-orange-500/10 border-orange-500/30",
  symbiont: "bg-purple-500/10 border-purple-500/30",
};

const ARCHETYPE_DESCRIPTIONS: Record<string, string> = {
  abiogenesis: "Micro-Cap Moonshot",
  mitosis: "HFT Micro-Scalper",
  cambrian: "Volatility Hunter",
  symbiont: "Smart Money Tracker",
};

export function BotCard({
  strategy,
  rank,
}: {
  strategy: FrontierStrategy;
  rank: number;
}) {
  const icon = ARCHETYPE_ICONS[strategy.archetype] || "🤖";
  const colorClass = ARCHETYPE_COLORS[strategy.archetype] || "text-darwin-accent";
  const bgClass = ARCHETYPE_BG[strategy.archetype] || "bg-darwin-accent/10 border-darwin-accent/30";
  const description = ARCHETYPE_DESCRIPTIONS[strategy.archetype] || strategy.archetype;

  const pnlColor =
    strategy.pnl > 0
      ? "text-darwin-accent"
      : strategy.pnl < 0
      ? "text-darwin-danger"
      : "text-darwin-text-dim";

  return (
    <div
      className={`bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-5 transition-all duration-300 hover:border-darwin-border/80 hover:shadow-lg hover:shadow-black/20 ${
        strategy.status === "live" ? "ring-1 ring-darwin-accent/30" : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-12 h-12 rounded-lg border flex items-center justify-center text-xl ${bgClass}`}
          >
            {icon}
          </div>
          <div>
            <h3 className={`text-base font-mono font-bold ${colorClass}`}>
              {strategy.name}
            </h3>
            <p className="text-xs font-mono text-darwin-text-dim">
              {description}
            </p>
          </div>
        </div>

        {/* Rank badge */}
        <div
          className={`px-2 py-0.5 rounded-full text-xs font-mono font-bold ${
            rank === 1
              ? "bg-darwin-accent/20 text-darwin-accent"
              : "bg-darwin-card-hover text-darwin-text-dim"
          }`}
        >
          #{rank}
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-mono ${
            strategy.status === "live"
              ? "bg-darwin-accent/20 text-darwin-accent"
              : strategy.status === "sell_only"
              ? "bg-darwin-danger/20 text-darwin-danger"
              : "bg-darwin-purple/20 text-darwin-purple"
          }`}
        >
          {strategy.status.toUpperCase()}
        </span>
        <span className="text-xs font-mono text-darwin-text-dim">
          Gen {strategy.generation}
        </span>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-mono text-darwin-text-dim mb-0.5">
            Score
          </p>
          <p className="text-base font-mono text-darwin-text-bright font-bold">
            {strategy.score.toFixed(3)}
          </p>
        </div>
        <div>
          <p className="text-xs font-mono text-darwin-text-dim mb-0.5">
            PnL
          </p>
          <p className={`text-base font-mono font-bold ${pnlColor}`}>
            ${strategy.pnl.toFixed(2)}
          </p>
        </div>
        <div>
          <p className="text-xs font-mono text-darwin-text-dim mb-0.5">
            Win Rate
          </p>
          <p className="text-base font-mono text-darwin-text-bright">
            {(strategy.winRate * 100).toFixed(1)}%
          </p>
        </div>
        <div>
          <p className="text-xs font-mono text-darwin-text-dim mb-0.5">
            Trades
          </p>
          <p className="text-base font-mono text-darwin-text-bright">
            {strategy.trades}
          </p>
        </div>
      </div>

      {/* Chain preferences */}
      {strategy.chainPreferences && strategy.chainPreferences.length > 0 && (
        <div className="mt-3 pt-3 border-t border-darwin-border/30">
          <p className="text-xs font-mono text-darwin-text-dim mb-1">
            Chains
          </p>
          <div className="flex gap-1">
            {strategy.chainPreferences.map((chainId) => (
              <span
                key={chainId}
                className="px-1.5 py-0.5 rounded text-xs font-mono bg-darwin-card-hover text-darwin-text-dim"
              >
                {chainId === 8453
                  ? "Base"
                  : chainId === 42161
                  ? "Arb"
                  : chainId}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
