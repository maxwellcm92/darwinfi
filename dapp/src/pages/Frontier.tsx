import { useFrontierAPI } from "../hooks/useFrontierAPI";
import { ChainStatusBar } from "../components/ChainStatusBar";
import { BotCard } from "../components/BotCard";
import { CrossChainTradeFlow } from "../components/CrossChainTradeFlow";
import { WhaleActivityFeed } from "../components/WhaleActivityFeed";
import { VolatilityHeatmap } from "../components/VolatilityHeatmap";
import { ChampionshipStandings } from "../components/ChampionshipStandings";

export function Frontier() {
  const {
    strategies,
    strategiesLoading,
    chains,
    chainsLoading,
    volatility,
    volatilityLoading,
    whales,
    whalesLoading,
    competition,
    championship,
    championshipLoading,
  } = useFrontierAPI();

  // Sort strategies by score for ranking
  const rankedStrategies = [...strategies].sort((a, b) => b.score - a.score);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="section-header text-darwin-text-bright text-sm">
            FRONTIER
          </h1>
          <p className="text-xs font-mono text-darwin-text-dim mt-1">
            Team 4 -- Cross-Chain Evolutionary Trading
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-darwin-text-dim">
          <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse-glow" />
          {strategies.length} bots active
        </div>
      </div>

      {/* Chain Status Bar */}
      <ChainStatusBar chains={chains} loading={chainsLoading} />

      {/* Bot Cards Grid */}
      <div>
        <h2 className="section-header text-darwin-text-bright text-xs mb-4">
          FRONTIER BOTS
        </h2>
        {strategiesLoading && strategies.length === 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton w-full h-56 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {rankedStrategies.map((strategy, idx) => (
              <BotCard
                key={strategy.id}
                strategy={strategy}
                rank={idx + 1}
              />
            ))}
          </div>
        )}
      </div>

      {/* Cross-Chain Trade Flow */}
      <CrossChainTradeFlow
        strategies={strategies}
        chains={chains}
        loading={strategiesLoading}
      />

      {/* Two-column layout for Volatility + Whales */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <VolatilityHeatmap events={volatility} loading={volatilityLoading} />
        <WhaleActivityFeed data={whales} loading={whalesLoading} />
      </div>

      {/* Championship Standings */}
      <ChampionshipStandings
        data={championship}
        loading={championshipLoading}
      />

      {/* Internal Competition */}
      {competition && (
        <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl overflow-hidden">
          <div className="p-5 border-b border-darwin-border/50 flex items-center justify-between">
            <h3 className="section-header text-darwin-text-bright">
              INTERNAL COMPETITION
            </h3>
            {competition.teamWinner && (
              <span className="text-xs font-mono text-darwin-accent">
                Team Winner: {competition.teamWinner.botId}
              </span>
            )}
          </div>
          <div className="divide-y divide-darwin-border/30">
            {(competition.rankings || []).map((entry, idx) => (
              <div
                key={entry.id}
                className="px-5 py-3 flex items-center justify-between hover:bg-darwin-card-hover transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`text-xs font-mono font-bold ${
                      idx === 0
                        ? "text-darwin-accent"
                        : "text-darwin-text-dim"
                    }`}
                  >
                    #{idx + 1}
                  </span>
                  <span className="text-xs font-mono text-darwin-text-bright">
                    {entry.name}
                  </span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs font-mono text-darwin-text-dim">
                    {entry.trades} trades
                  </span>
                  <span className="text-xs font-mono text-darwin-text-bright font-bold">
                    {entry.score.toFixed(3)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
