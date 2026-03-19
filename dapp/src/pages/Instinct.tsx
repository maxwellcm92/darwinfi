import { useState } from "react";
import { useInstinctAPI } from "../hooks/useInstinctAPI";
import { InstinctChart } from "../components/InstinctChart";

const TOKENS = ["ETH", "UNI", "wstETH", "AERO", "DEGEN", "BRETT", "VIRTUAL", "HIGHER"];
const RESOLUTIONS = ["1m", "5m", "15m", "1h"];

function getSentimentBar(score: number): { width: string; color: string; label: string } {
  const pct = Math.abs(score) * 50; // 0-50% from center
  if (score > 0.3) return { width: `${pct}%`, color: "bg-darwin-accent", label: "Bullish" };
  if (score < -0.3) return { width: `${pct}%`, color: "bg-darwin-danger", label: "Bearish" };
  return { width: `${Math.max(pct, 5)}%`, color: "bg-darwin-text-dim", label: "Neutral" };
}

export function Instinct() {
  const [selectedToken, setSelectedToken] = useState("ETH");
  const [selectedResolution, setSelectedResolution] = useState("5m");

  const {
    instinctState,
    instinctLoading,
    candles,
    candlesLoading,
  } = useInstinctAPI(selectedToken, selectedResolution);

  const tokenInstinct = instinctState?.tokens?.[selectedToken];
  const prediction = tokenInstinct?.predictions?.[selectedResolution as keyof typeof tokenInstinct.predictions];
  const health = instinctState?.health;
  const allTokens = instinctState?.tokens ?? {};

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="section-header text-darwin-text-bright text-sm">
          INSTINCT
        </h1>
        {health && (
          <div className="flex items-center gap-4 text-xs font-mono text-darwin-text-dim">
            <span>Sources: {health.sensesActive}</span>
            <span>Strategies: {health.reflexesActive}</span>
            <span className="text-darwin-purple text-glow-purple">
              {health.overallConfidence}% confidence
            </span>
          </div>
        )}
      </div>

      {/* Token Selector */}
      <div className="flex flex-wrap items-center gap-2">
        {TOKENS.map((token) => {
          const ti = allTokens[token];
          const pred = ti?.predictions?.["5m"];
          return (
            <button
              key={token}
              onClick={() => setSelectedToken(token)}
              className={`px-3 py-1.5 rounded-full text-xs font-mono transition-all border active:scale-[0.97] ${
                selectedToken === token
                  ? "bg-darwin-accent/20 text-darwin-accent border-darwin-accent/40 nav-pill-active"
                  : "bg-darwin-card/70 text-darwin-text hover:text-darwin-text-bright border-darwin-border/50 hover:border-darwin-accent/20"
              }`}
            >
              {token}
              {pred && (
                <span
                  className={`ml-1.5 ${
                    pred.direction === "up"
                      ? "text-darwin-accent"
                      : pred.direction === "down"
                        ? "text-darwin-danger"
                        : "text-darwin-text-dim"
                  }`}
                >
                  {pred.direction === "up" ? "^" : pred.direction === "down" ? "v" : "-"}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Resolution Tabs */}
      <div className="flex items-center gap-1">
        {RESOLUTIONS.map((res) => (
          <button
            key={res}
            onClick={() => setSelectedResolution(res)}
            className={`px-4 py-2 rounded-full text-xs font-mono transition-all border active:scale-[0.97] ${
              selectedResolution === res
                ? "bg-darwin-purple/20 text-darwin-purple border-darwin-purple/40 nav-pill-active"
                : "text-darwin-text-dim hover:text-darwin-text border-transparent"
            }`}
          >
            {res.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Chart */}
      <InstinctChart
        candles={candles}
        prediction={prediction}
        token={selectedToken}
        resolution={selectedResolution}
        loading={candlesLoading}
      />

      {/* Token Details Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Predictions Card */}
        <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-6 transition-all duration-300 hover:border-darwin-border/80 hover:shadow-lg hover:shadow-black/20">
          <h3 className="section-header text-darwin-text-bright mb-4">
            PREDICTIONS - {selectedToken}
          </h3>
          <div className="space-y-3">
            {RESOLUTIONS.map((res) => {
              const pred = tokenInstinct?.predictions?.[res as keyof typeof tokenInstinct.predictions];
              if (!pred) return (
                <div key={res} className="flex items-center justify-between text-xs font-mono text-darwin-text-dim">
                  <span>{res.toUpperCase()}</span>
                  <span>No data</span>
                </div>
              );
              return (
                <div key={res} className="flex items-center justify-between">
                  <span className="text-xs font-mono text-darwin-text-dim w-8">{res.toUpperCase()}</span>
                  <span
                    className={`px-2 py-0.5 text-xs font-mono rounded ${
                      pred.direction === "up"
                        ? "bg-darwin-accent/20 text-darwin-accent"
                        : pred.direction === "down"
                          ? "bg-darwin-danger/20 text-darwin-danger"
                          : "bg-darwin-bg text-darwin-text-dim"
                    }`}
                  >
                    {pred.direction.toUpperCase()}
                  </span>
                  <span className="text-xs font-mono text-darwin-text">
                    ${pred.predictedClose.toFixed(pred.predictedClose > 10 ? 2 : 6)}
                  </span>
                  <span className="text-xs font-mono text-darwin-text-dim">
                    {pred.confidence}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sentiment Card */}
        <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-6 transition-all duration-300 hover:border-darwin-border/80 hover:shadow-lg hover:shadow-black/20">
          <h3 className="section-header text-darwin-text-bright mb-4">
            SENTIMENT
          </h3>
          <div className="space-y-3">
            {Object.entries(allTokens).map(([token, ti]) => {
              const s = ti.sentiment;
              if (!s || s.confidence === 0) return null;
              const bar = getSentimentBar(s.score);
              return (
                <div key={token} className="flex items-center gap-3">
                  <span className="text-xs font-mono text-darwin-text-dim w-14">{token}</span>
                  <div className="flex-1 h-2 bg-darwin-bg rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${bar.color} transition-all`}
                      style={{ width: bar.width, marginLeft: s.score < 0 ? "auto" : undefined }}
                    />
                  </div>
                  <span className={`text-xs font-mono w-10 text-right ${
                    s.score > 0.3 ? "text-darwin-accent" :
                    s.score < -0.3 ? "text-darwin-danger" : "text-darwin-text-dim"
                  }`}>
                    {s.score > 0 ? "+" : ""}{s.score.toFixed(2)}
                  </span>
                </div>
              );
            })}
            {Object.keys(allTokens).length === 0 && (
              <p className="text-xs font-mono text-darwin-text-dim">No sentiment data yet</p>
            )}
          </div>

          {/* Top Events */}
          {tokenInstinct?.sentiment?.topEvents && tokenInstinct.sentiment.topEvents.length > 0 && (
            <div className="mt-4 pt-3 border-t border-darwin-border/50">
              <p className="text-xs font-mono text-darwin-text-dim mb-2">Recent Events</p>
              {tokenInstinct.sentiment.topEvents.slice(0, 3).map((event, i) => (
                <p key={i} className="text-xs font-mono text-darwin-text truncate mb-1">
                  {event}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Key Levels */}
      {tokenInstinct?.keyLevels && (
        <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-6 transition-all duration-300 hover:border-darwin-border/80 hover:shadow-lg hover:shadow-black/20">
          <h3 className="section-header text-darwin-text-bright mb-4">
            KEY LEVELS - {selectedToken}
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-mono text-darwin-accent mb-2">Support</p>
              <div className="space-y-1">
                {tokenInstinct.keyLevels.support.length > 0
                  ? tokenInstinct.keyLevels.support.map((level, i) => (
                      <p key={i} className="text-sm font-mono text-darwin-text">
                        ${level.toFixed(level > 10 ? 2 : 6)}
                      </p>
                    ))
                  : <p className="text-xs font-mono text-darwin-text-dim">--</p>}
              </div>
            </div>
            <div>
              <p className="text-xs font-mono text-darwin-danger mb-2">Resistance</p>
              <div className="space-y-1">
                {tokenInstinct.keyLevels.resistance.length > 0
                  ? tokenInstinct.keyLevels.resistance.map((level, i) => (
                      <p key={i} className="text-sm font-mono text-darwin-text">
                        ${level.toFixed(level > 10 ? 2 : 6)}
                      </p>
                    ))
                  : <p className="text-xs font-mono text-darwin-text-dim">--</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
