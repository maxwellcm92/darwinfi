"use client";

import { LiveVaultStats } from "@/components/LiveVaultStats";
import { LiveLeaderboard } from "@/components/LiveLeaderboard";
import { LiveTradesFeed } from "@/components/LiveTradesFeed";
import { PnLChart } from "@/components/PnLChart";
import { AnimatedSection } from "@/components/AnimatedSection";
import { usePollAPI } from "@/hooks/usePollAPI";
import type { EvolutionEntry, InstinctState, AgentState } from "@/lib/api";

function EvolutionTimeline() {
  const { data, loading } = usePollAPI<EvolutionEntry[]>(
    "/api/evolution",
    15000
  );

  const entries = data ?? [];

  return (
    <div className="darwin-card">
      <h3 className="section-header text-darwin-accent mb-4">
        Evolution Timeline
      </h3>
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton h-16 w-full" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="text-center text-darwin-text-dim py-8 font-mono text-sm">
          No evolution cycles yet
        </p>
      ) : (
        <div className="relative">
          <div className="absolute left-3 top-0 bottom-0 w-px bg-darwin-border/50" />
          <div className="space-y-4">
            {entries.map((e) => (
              <div key={e.cycle} className="relative pl-8">
                <div className="absolute left-1.5 top-2 w-3 h-3 rounded-full bg-darwin-purple border-2 border-darwin-bg" />
                <div className="p-3 rounded-lg bg-darwin-bg/50 border border-darwin-border/30">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-xs font-mono text-darwin-purple font-bold">
                      Cycle {e.cycle}
                    </span>
                    <span className="text-xs font-mono text-darwin-text-dim">
                      {formatTimestamp(e.timestamp)}
                    </span>
                  </div>
                  <p className="text-sm text-darwin-text-bright">
                    Champion:{" "}
                    <span className="text-darwin-gold font-medium">
                      {e.champion}
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    {e.promoted && (
                      <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-darwin-success/10 text-darwin-success">
                        + {e.promoted}
                      </span>
                    )}
                    {e.eliminated && (
                      <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-darwin-danger/10 text-darwin-danger">
                        - {e.eliminated}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function InstinctPredictions({ data }: { data: InstinctState }) {
  return (
    <div className="darwin-card">
      <h3 className="section-header text-darwin-accent mb-4">
        Instinct Predictions
      </h3>
      {data.consensusSignal && (
        <div className="mb-4 p-3 rounded-lg bg-darwin-purple/10 border border-darwin-purple/20">
          <span className="text-xs font-mono text-darwin-purple-dim">
            Consensus
          </span>
          <p className="text-lg font-bold text-darwin-purple mt-1">
            {data.consensusSignal.toUpperCase()}
          </p>
        </div>
      )}
      <div className="space-y-2">
        {data.predictions!.map((p, i) => (
          <div
            key={i}
            className="flex items-center justify-between p-2.5 rounded-lg bg-darwin-bg/50 border border-darwin-border/30"
          >
            <div>
              <p className="text-sm font-medium text-darwin-text-bright">
                {p.department}
              </p>
              <p className="text-xs text-darwin-text-dim font-mono">
                {p.signal}
              </p>
            </div>
            <div className="text-right">
              <div className="w-16 h-1.5 rounded-full bg-darwin-border overflow-hidden">
                <div
                  className="h-full rounded-full bg-darwin-accent"
                  style={{ width: `${(p.confidence * 100).toFixed(0)}%` }}
                />
              </div>
              <span className="text-xs font-mono text-darwin-text-dim mt-0.5">
                {(p.confidence * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LiveIndicator() {
  const { data } = usePollAPI<AgentState>("/api/state", 10000);

  return (
    <div className="flex items-center gap-3">
      <div className="relative flex items-center gap-2">
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-darwin-success opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-darwin-success" />
        </span>
        <span className="text-xs font-mono text-darwin-success uppercase tracking-wider">
          Live
        </span>
      </div>
      {data?.uptimeFormatted && (
        <span className="text-xs font-mono text-darwin-text-dim">
          Uptime: {data.uptimeFormatted}
        </span>
      )}
      {data?.evolutionCycle != null && (
        <span className="text-xs font-mono text-darwin-text-dim">
          Cycle {data.evolutionCycle}
        </span>
      )}
    </div>
  );
}

function formatTimestamp(ts: string) {
  try {
    const d = new Date(ts);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return ts;
  }
}

export default function ResultsPage() {
  const { data: instinctData } = usePollAPI<InstinctState>("/api/instinct", 15000);
  const hasInstinct = !!(instinctData?.predictions && instinctData.predictions.length > 0);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      {/* Page Header */}
      <AnimatedSection>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-10">
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold text-darwin-text-bright font-serif">
              Live Results
            </h1>
            <p className="text-darwin-text-dim mt-2">
              Real-time performance data from the DarwinFi autonomous vault
            </p>
          </div>
          <LiveIndicator />
        </div>
      </AnimatedSection>

      {/* Top Row: Vault Stats */}
      <AnimatedSection delay={100}>
        <div className="mb-8">
          <LiveVaultStats />
        </div>
      </AnimatedSection>

      {/* Second Row: Chart + Trades */}
      <AnimatedSection delay={200}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <PnLChart />
          <LiveTradesFeed />
        </div>
      </AnimatedSection>

      {/* Third Row: Leaderboard */}
      <AnimatedSection delay={300}>
        <div className="mb-8">
          <LiveLeaderboard />
        </div>
      </AnimatedSection>

      {/* Bottom Row: Evolution + Instinct */}
      <AnimatedSection delay={400}>
        <div className={hasInstinct ? "grid grid-cols-1 lg:grid-cols-2 gap-6" : ""}>
          <EvolutionTimeline />
          {hasInstinct && <InstinctPredictions data={instinctData!} />}
        </div>
      </AnimatedSection>
    </div>
  );
}
