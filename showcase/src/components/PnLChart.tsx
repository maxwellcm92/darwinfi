"use client";

import { useEffect, useRef } from "react";
import { usePollAPI } from "@/hooks/usePollAPI";
import type { AgentState } from "@/lib/api";

export function PnLChart() {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRef = useRef<any>(null);
  const resizeHandlerRef = useRef<(() => void) | null>(null);
  const { data, loading } = usePollAPI<AgentState>("/api/state", 10000);

  useEffect(() => {
    if (!containerRef.current) return;

    let mounted = true;

    import("lightweight-charts").then(({ createChart, ColorType, LineStyle }) => {
      if (!mounted || !containerRef.current) return;

      if (chartRef.current) {
        chartRef.current.remove();
      }

      const chart = createChart(containerRef.current, {
        layout: {
          background: { type: ColorType.Solid, color: "transparent" },
          textColor: "#6060A0",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
        },
        grid: {
          vertLines: { color: "#1E1E4A", style: LineStyle.Dotted },
          horzLines: { color: "#1E1E4A", style: LineStyle.Dotted },
        },
        width: containerRef.current.clientWidth,
        height: 280,
        rightPriceScale: {
          borderColor: "#1E1E4A",
        },
        timeScale: {
          borderColor: "#1E1E4A",
          timeVisible: true,
        },
        crosshair: {
          vertLine: { color: "#00F0C040" },
          horzLine: { color: "#00F0C040" },
        },
      });

      const areaSeries = chart.addAreaSeries({
        lineColor: "#00F0C0",
        lineWidth: 2,
        topColor: "rgba(0, 240, 192, 0.2)",
        bottomColor: "rgba(0, 240, 192, 0.02)",
        crosshairMarkerBackgroundColor: "#00F0C0",
      });

      chartRef.current = chart;
      seriesRef.current = areaSeries;

      const handleResize = () => {
        if (containerRef.current && chartRef.current) {
          chartRef.current.applyOptions({
            width: containerRef.current.clientWidth,
          });
        }
      };

      resizeHandlerRef.current = handleResize;
      window.addEventListener("resize", handleResize);
    });

    return () => {
      mounted = false;
      if (resizeHandlerRef.current) {
        window.removeEventListener("resize", resizeHandlerRef.current);
        resizeHandlerRef.current = null;
      }
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
        seriesRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || !data) return;

    const now = Math.floor(Date.now() / 1000);
    const pnl = data.totalPnl ?? 0;

    const points = [
      { time: now - 3600, value: 0 },
      { time: now, value: pnl },
    ];

    seriesRef.current.setData(points);
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  return (
    <div className="darwin-card">
      <h3 className="section-header text-darwin-accent mb-4">
        Portfolio PnL
      </h3>
      {loading && !chartRef.current ? (
        <div className="skeleton h-[280px] w-full" />
      ) : (
        <div ref={containerRef} className="w-full" />
      )}
      {data && (
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-darwin-border/30">
          <span className="text-sm text-darwin-text-dim font-mono">
            Total PnL
          </span>
          <span
            className={`text-base font-mono font-bold ${
              (data.totalPnl ?? 0) >= 0
                ? "text-darwin-success"
                : "text-darwin-danger"
            }`}
          >
            {(data.totalPnl ?? 0) >= 0 ? "+" : ""}
            {(data.totalPnl ?? 0).toFixed(4)} ETH
          </span>
        </div>
      )}
    </div>
  );
}
