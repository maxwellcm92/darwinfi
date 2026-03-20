import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE_URL } from "../lib/constants";

interface PricePoint {
  timestamp: number;
  price: number;
}

export function SharePriceChart() {
  const [data, setData] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/vault/history`);
      if (!res.ok) return;
      const json = await res.json();
      if (Array.isArray(json.history)) {
        setData(json.history);
      }
    } catch {
      // Silently fail - chart just won't render
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
    intervalRef.current = setInterval(fetchHistory, 60_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchHistory]);

  if (loading || data.length < 2) {
    return (
      <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-mono text-darwin-text-dim uppercase tracking-wider">Share Price</span>
        </div>
        <div className="h-24 flex items-center justify-center">
          <span className="text-xs font-mono text-darwin-text-dim">
            {loading ? "Loading..." : "Collecting data..."}
          </span>
        </div>
      </div>
    );
  }

  // Chart dimensions
  const width = 320;
  const height = 80;
  const padding = { top: 8, right: 8, bottom: 8, left: 8 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const prices = data.map((d) => d.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const priceRange = maxPrice - minPrice || 0.000001;

  const firstPrice = prices[0];
  const lastPrice = prices[prices.length - 1];
  const pctChange = ((lastPrice - firstPrice) / firstPrice) * 100;
  const isPositive = pctChange >= 0;

  // Build SVG path
  const points = data.map((d, i) => {
    const x = padding.left + (i / (data.length - 1)) * chartW;
    const y = padding.top + chartH - ((d.price - minPrice) / priceRange) * chartH;
    return { x, y };
  });

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  // Gradient fill path (area under curve)
  const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(1)} ${height} L ${points[0].x.toFixed(1)} ${height} Z`;

  const strokeColor = isPositive ? "#00F0C0" : "#FF3050";
  const fillColor = isPositive ? "url(#chartGradientUp)" : "url(#chartGradientDown)";

  return (
    <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-4 transition-all duration-300 hover:border-darwin-border/80">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono text-darwin-text-dim uppercase tracking-wider">Share Price</span>
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono text-darwin-text-bright font-bold">
            ${lastPrice.toFixed(6)}
          </span>
          <span className={`text-xs font-mono ${isPositive ? "text-darwin-accent" : "text-darwin-danger"}`}>
            {isPositive ? "+" : ""}{pctChange.toFixed(2)}%
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="chartGradientUp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00F0C0" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#00F0C0" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="chartGradientDown" x1="0" y1="0" x2="0" y2="1">
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
