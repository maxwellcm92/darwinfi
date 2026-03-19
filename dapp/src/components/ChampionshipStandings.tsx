import type { ChampionshipData } from "../hooks/useFrontierAPI";

const TEAM_COLORS: Record<string, string> = {
  Apex: "text-blue-400",
  Viper: "text-green-400",
  Blitz: "text-yellow-400",
  Frontier: "text-purple-400",
};

const TEAM_BG: Record<string, string> = {
  Apex: "bg-blue-500/10 border-blue-500/30",
  Viper: "bg-green-500/10 border-green-500/30",
  Blitz: "bg-yellow-500/10 border-yellow-500/30",
  Frontier: "bg-purple-500/10 border-purple-500/30",
};

export function ChampionshipStandings({
  data,
  loading,
}: {
  data: ChampionshipData | null;
  loading: boolean;
}) {
  if (loading || !data) {
    return (
      <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-6">
        <div className="section-header text-darwin-text-bright mb-4">
          CHAMPIONSHIP
        </div>
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton w-full h-12 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  const { champions, overallChampion } = data;

  return (
    <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl overflow-hidden transition-all duration-300 hover:border-darwin-border/80 hover:shadow-lg hover:shadow-black/20">
      <div className="p-5 border-b border-darwin-border/50">
        <div className="flex items-center justify-between">
          <h3 className="section-header text-darwin-text-bright">
            CHAMPIONSHIP STANDINGS
          </h3>
          {overallChampion && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-darwin-text-dim">
                Champion:
              </span>
              <span
                className={`text-xs font-mono font-bold ${
                  TEAM_COLORS[overallChampion.teamName] || "text-darwin-accent"
                }`}
              >
                {overallChampion.strategyName}
              </span>
            </div>
          )}
        </div>
      </div>

      {champions.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm font-mono text-darwin-text-dim">
            No championship data yet. Teams are still qualifying.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-darwin-border/30">
          {champions.map((champion, idx) => {
            const teamColor =
              TEAM_COLORS[champion.teamName] || "text-darwin-text-bright";
            const teamBg =
              TEAM_BG[champion.teamName] ||
              "bg-darwin-accent/10 border-darwin-accent/30";
            const isOverall =
              overallChampion?.strategyId === champion.strategyId;

            return (
              <div
                key={champion.strategyId}
                className={`px-5 py-4 hover:bg-darwin-card-hover transition-colors ${
                  isOverall ? "bg-darwin-accent/5" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {/* Rank */}
                    <div
                      className={`w-8 h-8 rounded-lg border flex items-center justify-center ${
                        idx === 0
                          ? "bg-darwin-accent/20 border-darwin-accent/30"
                          : "bg-darwin-card-hover border-darwin-border/30"
                      }`}
                    >
                      <span
                        className={`text-xs font-mono font-bold ${
                          idx === 0
                            ? "text-darwin-accent"
                            : "text-darwin-text-dim"
                        }`}
                      >
                        {idx + 1}
                      </span>
                    </div>

                    {/* Team info */}
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs font-mono font-bold ${teamColor}`}
                        >
                          {champion.teamName}
                        </span>
                        <span className="text-[10px] font-mono text-darwin-text-dim">
                          {champion.strategyName}
                        </span>
                        {isOverall && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-mono bg-darwin-accent/20 text-darwin-accent">
                            CHAMPION
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[10px] font-mono text-darwin-text-dim">
                          {champion.trades} trades
                        </span>
                        <span className="text-[10px] font-mono text-darwin-text-dim">
                          WR: {(champion.winRate * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Score + PnL */}
                  <div className="text-right">
                    <p className="text-sm font-mono text-darwin-text-bright font-bold">
                      {champion.compositeScore.toFixed(3)}
                    </p>
                    <p
                      className={`text-[10px] font-mono ${
                        champion.pnl > 0
                          ? "text-darwin-accent"
                          : champion.pnl < 0
                          ? "text-darwin-danger"
                          : "text-darwin-text-dim"
                      }`}
                    >
                      ${champion.pnl.toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
