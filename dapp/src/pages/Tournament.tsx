import { Leaderboard } from "../components/Leaderboard";
import { useDarwinFiAPI } from "../hooks/useDarwinFiAPI";
import type { EvolutionEntry } from "../hooks/useDarwinFiAPI";
import { ChampionshipStandings } from "../components/ChampionshipStandings";
import { useFrontierAPI } from "../hooks/useFrontierAPI";

function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "--";
  }
}

function EvolutionTimeline({ entries, loading }: { entries: EvolutionEntry[]; loading: boolean }) {
  if (loading && entries.length === 0) {
    return (
      <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-6">
        <div className="section-header text-darwin-text-bright mb-4">EVOLUTION TIMELINE</div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="skeleton w-10 h-10 rounded-lg" />
              <div className="flex-1">
                <div className="skeleton-text w-40 mb-2" />
                <div className="skeleton-text w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Most recent first
  const sorted = [...entries].sort((a, b) => b.cycle - a.cycle);

  return (
    <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl overflow-hidden transition-all duration-300 hover:border-darwin-border/80 hover:shadow-lg hover:shadow-black/20">
      <div className="p-5 border-b border-darwin-border/50">
        <h3 className="section-header text-darwin-text-bright">
          EVOLUTION TIMELINE
        </h3>
      </div>

      {sorted.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm font-mono text-darwin-text-dim">
            No evolution cycles recorded yet.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-darwin-border/30 max-h-96 overflow-y-auto">
          {sorted.map((entry) => (
            <div
              key={entry.cycle}
              className="px-5 py-3 hover:bg-darwin-card-hover transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  {/* Cycle number */}
                  <div className="w-10 h-10 rounded-lg bg-darwin-purple/20 border border-darwin-purple/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-mono text-darwin-purple font-bold">
                      {entry.cycle}
                    </span>
                  </div>

                  <div>
                    <p className="text-sm font-mono text-darwin-text-bright">
                      Champion: <span className="text-darwin-accent">{entry.champion}</span>
                    </p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {entry.promoted && (
                        <span className="text-xs font-mono text-darwin-accent bg-darwin-accent/10 px-2 py-0.5 rounded">
                          Promoted: {entry.promoted}
                        </span>
                      )}
                      {entry.eliminated && (
                        <span className="text-xs font-mono text-darwin-danger bg-darwin-danger/10 px-2 py-0.5 rounded">
                          Eliminated: {entry.eliminated}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <span className="text-xs font-mono text-darwin-text-dim flex-shrink-0 ml-2">
                  {formatTimestamp(entry.timestamp)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Tournament() {
  const { strategies, strategiesLoading, evolution, evolutionLoading } =
    useDarwinFiAPI();
  const { championship, championshipLoading } = useFrontierAPI();

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="section-header text-darwin-text-bright text-sm">
          TOURNAMENT
        </h1>
        <div className="flex items-center gap-2 text-xs font-mono text-darwin-text-dim">
          <span className="w-2 h-2 rounded-full bg-darwin-accent animate-pulse-glow" />
          {strategies.length} strategies competing
        </div>
      </div>

      {/* Leaderboard */}
      <Leaderboard strategies={strategies} loading={strategiesLoading} />

      {/* Championship Standings (all 4 teams) */}
      <ChampionshipStandings data={championship} loading={championshipLoading} />

      {/* Evolution Timeline */}
      <EvolutionTimeline entries={evolution} loading={evolutionLoading} />
    </div>
  );
}
