import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE_URL } from "../lib/constants";

interface ReturnPoint {
  timestamp: number;
  returnPct: number;
  price: number;
}

export function ReturnsChart() {
  const [data, setData] = useState<ReturnPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchReturns = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/vault/returns`);
      if (!res.ok) return;
      const json = await res.json();
      if (Array.isArray(json.returns)) {
        setData(json.returns);
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReturns();
    intervalRef.current = setInterval(fetchReturns, 60_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchReturns]);

  if (loading || data.length < 2) {
    return (
      <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-mono text-darwin-text-dim uppercase tracking-wider">Cumulative Returns</span>
        </div>
        <div className="h-24 flex items-center justify-center">
          <span className="text-sm font-mono text-darwin-text-dim">
            {loading ? "Loading..." : "Collecting data..."}
          </span>
        </div>
      </div>
    );
  }

  const width = 320;
  const height = 80;
  const padding = { top: 8, right: 8, bottom: 8, left: 8 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const returns = data.map((d) => d.returnPct);
  const minReturn = Math.min(...returns, 0);
  const maxReturn = Math.max(...returns, 0);
  const range = maxReturn - minReturn || 0.01;

  const lastReturn = returns[returns.length - 1];
  const isPositive = lastReturn >= 0;

  const points = data.map((d, i) => {
    const x = padding.left + (i / (data.length - 1)) * chartW;
    const y = padding.top + chartH - ((d.returnPct - minReturn) / range) * chartH;
    return { x, y };
  });

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${height} L ${points[0].x.toFixed(1)} ${height} Z`;

  const strokeColor = isPositive ? "#00F0C0" : "#FF3050";
  const fillColor = isPositive ? "url(#returnsGradientUp)" : "url(#returnsGradientDown)";

  return (
    <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-4 transition-all duration-300 hover:border-darwin-border/80">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-mono text-darwin-text-dim uppercase tracking-wider">Cumulative Returns</span>
        <span className={`text-base font-mono font-bold ${isPositive ? "text-darwin-accent" : "text-darwin-danger"}`}>
          {isPositive ? "+" : ""}{lastReturn.toFixed(2)}%
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="returnsGradientUp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00F0C0" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#00F0C0" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="returnsGradientDown" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FF3050" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#FF3050" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaD} fill={fillColor} />
        <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
