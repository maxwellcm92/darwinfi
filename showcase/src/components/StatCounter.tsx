"use client";

import { useEffect, useState, useRef } from "react";

interface StatCounterProps {
  label: string;
  value: number | null;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  loading?: boolean;
}

export function StatCounter({
  label,
  value,
  prefix = "",
  suffix = "",
  decimals = 0,
  loading = false,
}: StatCounterProps) {
  const [display, setDisplay] = useState(0);
  const animRef = useRef<number>(0);

  useEffect(() => {
    if (value === null) return;
    const start = display;
    const diff = value - start;
    const duration = 1200;
    const startTime = performance.now();

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + diff * eased);
      if (progress < 1) {
        animRef.current = requestAnimationFrame(tick);
      }
    }

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [value]);

  return (
    <div className="text-center">
      <div className="font-mono text-2xl md:text-3xl font-bold text-darwin-text-bright mb-1">
        {loading ? (
          <div className="h-9 w-24 mx-auto skeleton" />
        ) : (
          <span className="count-fade-in">
            {prefix}
            {display.toFixed(decimals)}
            {suffix}
          </span>
        )}
      </div>
      <div className="section-header text-darwin-text-dim">{label}</div>
    </div>
  );
}
