import { Link } from "react-router-dom";
import type { InstinctState } from "../hooks/useInstinctAPI";

interface InstinctSummaryProps {
  instinctState: InstinctState | null;
  loading: boolean;
}

function getSentimentLabel(score: number): { label: string; color: string } {
  if (score > 0.3) return { label: "BULLISH", color: "text-darwin-accent" };
  if (score < -0.3) return { label: "BEARISH", color: "text-darwin-danger" };
  return { label: "NEUTRAL", color: "text-darwin-text-dim" };
}

export function InstinctSummary({ instinctState, loading }: InstinctSummaryProps) {
  if (loading && !instinctState) {
    return (
      <div className="bg-darwin-card border border-darwin-border rounded-lg p-6 text-center">
        <p className="font-mono text-darwin-text-dim animate-pulse-glow">
          Connecting to Instinct...
        </p>
      </div>
    );
  }

  const health = instinctState?.health;
  const tokens = instinctState?.tokens ?? {};
  const tokenNames = Object.keys(tokens);
  const isActive = health && health.overallConfidence > 0;

  // Compute average sentiment across all tokens
  let avgSentiment = 0;
  let sentimentCount = 0;
  for (const t of tokenNames) {
    const s = tokens[t]?.sentiment;
    if (s && s.confidence > 0) {
      avgSentiment += s.score;
      sentimentCount++;
    }
  }
  if (sentimentCount > 0) avgSentiment /= sentimentCount;
  const sentimentInfo = getSentimentLabel(avgSentiment);

  // Find best prediction strategy across tokens
  let bestConfidence = 0;
  let bestToken = "--";
  let bestDirection = "--";
  for (const t of tokenNames) {
    const pred = tokens[t]?.predictions?.["5m"];
    if (pred && pred.confidence > bestConfidence) {
      bestConfidence = pred.confidence;
      bestToken = t;
      bestDirection = pred.direction.toUpperCase();
    }
  }

  return (
    <Link
      to="/instinct"
      className="block bg-darwin-card border border-darwin-border rounded-lg p-5 hover:border-darwin-purple/40 transition-colors group"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-arcade text-xs text-darwin-purple tracking-wider">
          INSTINCT
        </h3>
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${
              isActive ? "bg-darwin-purple animate-pulse-glow" : "bg-darwin-text-dim"
            }`}
          />
          <span
            className={`text-xs font-mono uppercase ${
              isActive ? "text-darwin-purple" : "text-darwin-text-dim"
            }`}
          >
            {isActive ? "ACTIVE" : "WARMING UP"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-darwin-bg rounded p-3">
          <p className="text-xs font-mono text-darwin-text-dim mb-1">Confidence</p>
          <p className="text-sm font-mono text-darwin-purple font-medium text-glow-purple">
            {health ? `${health.overallConfidence}%` : "--"}
          </p>
        </div>

        <div className="bg-darwin-bg rounded p-3">
          <p className="text-xs font-mono text-darwin-text-dim mb-1">Sentiment</p>
          <p className={`text-sm font-mono font-medium ${sentimentInfo.color}`}>
            {sentimentCount > 0 ? sentimentInfo.label : "--"}
          </p>
        </div>

        <div className="bg-darwin-bg rounded p-3">
          <p className="text-xs font-mono text-darwin-text-dim mb-1">Top Signal</p>
          <p className="text-sm font-mono text-darwin-text-bright font-medium truncate">
            {bestConfidence > 0 ? `${bestToken} ${bestDirection}` : "--"}
          </p>
        </div>

        <div className="bg-darwin-bg rounded p-3">
          <p className="text-xs font-mono text-darwin-text-dim mb-1">Sources</p>
          <p className="text-sm font-mono text-darwin-text-bright font-medium">
            {health ? `${health.sensesActive} active` : "--"}
          </p>
        </div>
      </div>

      <p className="mt-3 text-xs font-mono text-darwin-text-dim group-hover:text-darwin-purple transition-colors">
        {tokenNames.length} tokens tracked &rarr; View details
      </p>
    </Link>
  );
}
