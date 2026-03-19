"use client";

import { useState } from "react";

export interface SessionData {
  number: number;
  title: string;
  objective: string;
  highlights: string[];
  details: string;
  type: "architecture" | "deployment" | "audit" | "fix";
  codeImpact?: string;
}

const typeColors: Record<SessionData["type"], { dot: string; border: string; badge: string; label: string }> = {
  architecture: {
    dot: "bg-[#8040DD]",
    border: "border-l-[#8040DD]",
    badge: "bg-[#8040DD]/20 text-[#8040DD]",
    label: "Architecture",
  },
  deployment: {
    dot: "bg-[#00F0C0]",
    border: "border-l-[#00F0C0]",
    badge: "bg-[#00F0C0]/20 text-[#00F0C0]",
    label: "Deployment",
  },
  audit: {
    dot: "bg-[#E4C64B]",
    border: "border-l-[#E4C64B]",
    badge: "bg-[#E4C64B]/20 text-[#E4C64B]",
    label: "Audit",
  },
  fix: {
    dot: "bg-[#FFB020]",
    border: "border-l-[#FFB020]",
    badge: "bg-[#FFB020]/20 text-[#FFB020]",
    label: "Optimization",
  },
};

export function SessionCard({ session, side }: { session: SessionData; side: "left" | "right" }) {
  const [expanded, setExpanded] = useState(false);
  const colors = typeColors[session.type];

  return (
    <div
      className={`darwin-card border-l-4 ${colors.border} cursor-pointer transition-all duration-300 hover:scale-[1.01]`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full ${colors.badge} font-mono text-sm font-bold shrink-0`}>
            {session.number}
          </span>
          <h3 className="font-semibold text-darwin-text-bright text-base md:text-lg leading-tight">
            {session.title}
          </h3>
        </div>
        <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded ${colors.badge} shrink-0`}>
          {colors.label}
        </span>
      </div>

      <ul className="space-y-1.5 mb-3">
        {session.highlights.map((h, i) => (
          <li key={i} className="text-sm text-darwin-text-dim flex items-start gap-2">
            <span className={`mt-1.5 w-1.5 h-1.5 rounded-full ${colors.dot} shrink-0`} />
            {h}
          </li>
        ))}
      </ul>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-darwin-border/30 text-sm text-darwin-text leading-relaxed space-y-2">
          <p>{session.details}</p>
          {session.codeImpact && (
            <p className="font-mono text-xs text-darwin-text-dim">{session.codeImpact}</p>
          )}
        </div>
      )}

      <p className="text-xs text-darwin-text-dim mt-2 font-mono">
        {expanded ? "Click to collapse" : "Click to expand"}
      </p>
    </div>
  );
}
