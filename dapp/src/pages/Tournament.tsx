import { Leaderboard } from "../components/Leaderboard";
import { useDarwinFiAPI } from "../hooks/useDarwinFiAPI";
import type { EvolutionEntry } from "../hooks/useDarwinFiAPI";

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
      <div className="bg-darwin-card border border-darwin-border rounded-lg p-8 text-center">
        <p className="font-mono text-darwin-text-dim animate-pulse-glow">
          Loading evolution history...
        </p>
      </div>
    );
  }

  // Most recent first
  const sorted = [...entries].sort((a, b) => b.cycle - a.cycle);

  return (
    <div className="bg-darwin-card border border-darwin-border rounded-lg overflow-hidden">
      <div className="p-4 border-b border-darwin-border">
        <h3 className="font-arcade text-xs text-darwin-purple tracking-wider text-glow-purple">
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
        <div className="divide-y divide-darwin-border/50 max-h-96 overflow-y-auto">
          {sorted.map((entry) => (
            <div
              key={entry.cycle}
              className="px-4 py-3 hover:bg-darwin-card-hover transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  {/* Cycle number */}
                  <div className="w-10 h-10 rounded bg-darwin-purple/20 border border-darwin-purple/30 flex items-center justify-center flex-shrink-0">
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-arcade text-sm text-darwin-text-bright tracking-wide">
          TOURNAMENT
        </h1>
        <div className="flex items-center gap-2 text-xs font-mono text-darwin-text-dim">
          <span className="w-2 h-2 rounded-full bg-darwin-accent animate-pulse-glow" />
          {strategies.length} strategies competing
        </div>
      </div>

      {/* Leaderboard */}
      <Leaderboard strategies={strategies} loading={strategiesLoading} />

      {/* Evolution Timeline */}
      <EvolutionTimeline entries={evolution} loading={evolutionLoading} />
    </div>
  );
}
