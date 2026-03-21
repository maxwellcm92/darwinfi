import { useEffect, useRef } from "react";
import { createChart, ColorType } from "lightweight-charts";
import type { IChartApi, ISeriesApi, CandlestickData, Time } from "lightweight-charts";
import type { Candle, PredictionSummary } from "../hooks/useInstinctAPI";

interface InstinctChartProps {
  candles: Candle[];
  prediction?: PredictionSummary | null;
  token: string;
  resolution: string;
  loading: boolean;
}

export function InstinctChart({
  candles,
  prediction,
  token,
  resolution,
  loading,
}: InstinctChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const predLineRef = useRef<ISeriesApi<"Line"> | null>(null);

  // Initialize chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "#0B0B1A", type: ColorType.Solid },
        textColor: "#6060A0",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#1E1E4A" },
        horzLines: { color: "#1E1E4A" },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "#1E1E4A",
      },
      rightPriceScale: {
        borderColor: "#1E1E4A",
      },
      crosshair: {
        vertLine: { color: "#8040DD", width: 1, style: 3 },
        horzLine: { color: "#8040DD", width: 1, style: 3 },
      },
      width: containerRef.current.clientWidth,
      height: 400,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#00F0C0",
      downColor: "#FF3050",
      borderUpColor: "#00F0C0",
      borderDownColor: "#FF3050",
      wickUpColor: "#00F0C080",
      wickDownColor: "#FF305080",
    });

    const predLine = chart.addLineSeries({
      color: "#8040DD",
      lineWidth: 2,
      lineStyle: 2, // dashed
      crosshairMarkerVisible: false,
      title: "Prediction",
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    predLineRef.current = predLine;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // Update data when candles change
  useEffect(() => {
    if (!candleSeriesRef.current || candles.length === 0) return;

    const candleData: CandlestickData<Time>[] = candles.map((c) => ({
      time: c.timestamp as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    candleSeriesRef.current.setData(candleData);

    // Add prediction overlay if available
    if (predLineRef.current && prediction && candles.length > 0) {
      const lastCandle = candles[candles.length - 1];
      predLineRef.current.setData([
        { time: lastCandle.timestamp as Time, value: lastCandle.close },
        {
          time: (lastCandle.timestamp + getResolutionSec(resolution)) as Time,
          value: prediction.predictedClose,
        },
      ]);
    }

    chartRef.current?.timeScale().fitContent();
  }, [candles, prediction, resolution]);

  if (loading && candles.length === 0) {
    return (
      <div className="bg-darwin-card border border-darwin-border rounded-lg p-8 text-center h-[460px] flex items-center justify-center">
        <p className="font-mono text-darwin-text-dim animate-pulse-glow">
          Loading candles...
        </p>
      </div>
    );
  }

  return (
    <div className="bg-darwin-card border border-darwin-border rounded-lg overflow-hidden">
      <div className="p-4 border-b border-darwin-border flex items-center justify-between">
        <h3 className="font-arcade text-sm text-darwin-accent tracking-wider">
          {token} / USDC &middot; {resolution.toUpperCase()}
        </h3>
        {prediction && (
          <div className="flex items-center gap-3">
            <span
              className={`px-2 py-0.5 text-sm font-mono rounded border ${
                prediction.direction === "up"
                  ? "bg-darwin-accent/20 text-darwin-accent border-darwin-accent/30"
                  : prediction.direction === "down"
                    ? "bg-darwin-danger/20 text-darwin-danger border-darwin-danger/30"
                    : "bg-darwin-text-dim/20 text-darwin-text-dim border-darwin-text-dim/30"
              }`}
            >
              {prediction.direction.toUpperCase()}
            </span>
            <span className="text-sm font-mono text-darwin-text-dim">
              {prediction.confidence}% conf
            </span>
          </div>
        )}
      </div>
      <div ref={containerRef} className="w-full" />
    </div>
  );
}

function getResolutionSec(resolution: string): number {
  switch (resolution) {
    case "1m": return 60;
    case "5m": return 300;
    case "15m": return 900;
    case "1h": return 3600;
    default: return 300;
  }
}
