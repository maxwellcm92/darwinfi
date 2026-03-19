"use client";

import { useState, useCallback } from "react";

interface Organ {
  id: string;
  label: string;
  role: string;
  description: string;
  cx: number;
  cy: number;
  r: number;
  color: string;
  glowColor: string;
  pulseColor: string;
  icon: string;
}

const ORGANS: Organ[] = [
  {
    id: "vault",
    label: "Vault",
    role: "Heart",
    description:
      "ERC-4626 vault at the center. Pumps capital to strategies, collects returns. Every heartbeat is an on-chain transaction.",
    cx: 300,
    cy: 250,
    r: 52,
    color: "#00F0C0",
    glowColor: "rgba(0,240,192,0.3)",
    pulseColor: "rgba(0,240,192,0.08)",
    icon: "M300 228 l12 18 -24 0z M300 272 l-12 -18 24 0z M278 250 l18 -12 0 24z M322 250 l-18 12 0 -24z",
  },
  {
    id: "strategies",
    label: "Strategies",
    role: "Species",
    description:
      "12 competing trading strategies. Only the fittest survive each evolution cycle. Losers are eliminated, winners reproduce.",
    cx: 120,
    cy: 250,
    r: 42,
    color: "#8040DD",
    glowColor: "rgba(128,64,221,0.3)",
    pulseColor: "rgba(128,64,221,0.08)",
    icon: "M110 240 a10 10 0 1 1 20 0 a10 10 0 1 1 -20 0 M108 260 a6 6 0 1 1 12 0 M122 258 a6 6 0 1 1 12 0",
  },
  {
    id: "evolution",
    label: "Evolution",
    role: "DNA",
    description:
      "AI mutates strategy parameters every 4 hours. Crossover, mutation, and selection -- real genetic algorithms applied to trading.",
    cx: 480,
    cy: 250,
    r: 42,
    color: "#FFB020",
    glowColor: "rgba(255,176,32,0.3)",
    pulseColor: "rgba(255,176,32,0.08)",
    icon: "M470 232 q10 18 0 36 M490 232 q-10 18 0 36 M473 241 l14 0 M477 250 l6 0 M473 259 l14 0",
  },
  {
    id: "instinct",
    label: "Instinct",
    role: "Nervous System",
    description:
      "Multi-model AI consensus reads market signals in real time. Aggregates sentiment, technicals, and on-chain data into a single directional signal.",
    cx: 300,
    cy: 100,
    r: 42,
    color: "#E4C64B",
    glowColor: "rgba(228,198,75,0.3)",
    pulseColor: "rgba(228,198,75,0.08)",
    icon: "M290 90 l10 10 l10 -10 M285 100 l15 15 l15 -15 M290 110 l10 10 l10 -10",
  },
  {
    id: "immune",
    label: "Immune",
    role: "Defense",
    description:
      "Self-healing system that detects anomalies, reverts bad trades, and quarantines malfunctioning strategies before they can cause damage.",
    cx: 160,
    cy: 410,
    r: 38,
    color: "#FF3050",
    glowColor: "rgba(255,48,80,0.3)",
    pulseColor: "rgba(255,48,80,0.08)",
    icon: "M150 410 l10 -12 l10 12 l-10 12z M160 400 l0 20",
  },
  {
    id: "breakers",
    label: "Breakers",
    role: "Pain Receptors",
    description:
      "Circuit breakers halt trading when drawdown or volatility exceed thresholds. Lit Protocol enforces limits on-chain -- no one can override.",
    cx: 440,
    cy: 410,
    r: 38,
    color: "#6030AA",
    glowColor: "rgba(96,48,170,0.3)",
    pulseColor: "rgba(96,48,170,0.08)",
    icon: "M430 400 l20 0 l-10 20z M432 415 l16 0",
  },
];

const CONNECTIONS = [
  { from: "vault", to: "strategies" },
  { from: "vault", to: "evolution" },
  { from: "vault", to: "instinct" },
  { from: "vault", to: "immune" },
  { from: "vault", to: "breakers" },
  { from: "strategies", to: "evolution" },
  { from: "instinct", to: "strategies" },
  { from: "instinct", to: "evolution" },
  { from: "immune", to: "breakers" },
];

function getOrgan(id: string) {
  return ORGANS.find((o) => o.id === id)!;
}

function ConnectionPath({
  from,
  to,
  active,
}: {
  from: Organ;
  to: Organ;
  active: boolean;
}) {
  const midX = (from.cx + to.cx) / 2;
  const midY = (from.cy + to.cy) / 2;
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  const offsetX = -dy * 0.15;
  const offsetY = dx * 0.15;

  const pathD = `M${from.cx},${from.cy} Q${midX + offsetX},${midY + offsetY} ${to.cx},${to.cy}`;

  return (
    <g>
      <path
        d={pathD}
        stroke={active ? "rgba(0,240,192,0.4)" : "rgba(30,30,74,0.5)"}
        strokeWidth={active ? 2 : 1}
        fill="none"
        strokeDasharray={active ? "none" : "6 4"}
        className="transition-all duration-500"
      />
      {active && (
        <circle r="3" fill="#00F0C0" opacity="0.8">
          <animateMotion dur="2s" repeatCount="indefinite" path={pathD} />
        </circle>
      )}
    </g>
  );
}

function OrganNode({
  organ,
  active,
  onHover,
  onLeave,
  onClick,
}: {
  organ: Organ;
  active: boolean;
  onHover: () => void;
  onLeave: () => void;
  onClick: () => void;
}) {
  const scale = active ? 1.12 : 1;

  return (
    <g
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={onClick}
      className="cursor-pointer"
      style={{ transition: "transform 300ms ease" }}
    >
      {/* Pulse rings */}
      {active && (
        <>
          <circle
            cx={organ.cx}
            cy={organ.cy}
            r={organ.r + 15}
            fill="none"
            stroke={organ.color}
            strokeWidth="1"
            opacity="0.15"
          >
            <animate
              attributeName="r"
              from={organ.r + 10}
              to={organ.r + 30}
              dur="2s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              from="0.3"
              to="0"
              dur="2s"
              repeatCount="indefinite"
            />
          </circle>
          <circle
            cx={organ.cx}
            cy={organ.cy}
            r={organ.r + 8}
            fill="none"
            stroke={organ.color}
            strokeWidth="1"
            opacity="0.2"
          >
            <animate
              attributeName="r"
              from={organ.r + 5}
              to={organ.r + 22}
              dur="2s"
              begin="0.5s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              from="0.25"
              to="0"
              dur="2s"
              begin="0.5s"
              repeatCount="indefinite"
            />
          </circle>
        </>
      )}

      {/* Glow filter behind */}
      {active && (
        <circle
          cx={organ.cx}
          cy={organ.cy}
          r={organ.r + 4}
          fill={organ.pulseColor}
          className="transition-all duration-500"
        />
      )}

      {/* Main circle */}
      <circle
        cx={organ.cx}
        cy={organ.cy}
        r={organ.r * scale}
        fill="rgba(16,16,42,0.85)"
        stroke={organ.color}
        strokeWidth={active ? 2.5 : 1.5}
        className="transition-all duration-300"
        style={
          active
            ? {
                filter: `drop-shadow(0 0 12px ${organ.glowColor}) drop-shadow(0 0 24px ${organ.glowColor})`,
              }
            : {}
        }
      />

      {/* Icon path */}
      <path
        d={organ.icon}
        stroke={organ.color}
        strokeWidth="1.5"
        fill="none"
        opacity={active ? 1 : 0.5}
        className="transition-opacity duration-300"
      />

      {/* Label */}
      <text
        x={organ.cx}
        y={organ.cy + organ.r + 18}
        textAnchor="middle"
        fill={active ? "#FFFFFF" : "#C8C8E0"}
        fontSize="13"
        fontWeight="700"
        fontFamily="Inter, sans-serif"
        className="transition-all duration-300"
      >
        {organ.label}
      </text>

      {/* Role subtitle */}
      <text
        x={organ.cx}
        y={organ.cy + organ.r + 33}
        textAnchor="middle"
        fill={active ? organ.color : "#6060A0"}
        fontSize="10"
        fontFamily="JetBrains Mono, monospace"
        fontWeight="500"
        letterSpacing="0.08em"
        className="transition-all duration-300"
        textDecoration="none"
      >
        {organ.role.toUpperCase()}
      </text>
    </g>
  );
}

export function OrganismDiagram() {
  const [active, setActive] = useState<string | null>(null);
  const activeOrgan = ORGANS.find((o) => o.id === active);

  const handleHover = useCallback((id: string) => setActive(id), []);
  const handleLeave = useCallback(() => setActive(null), []);
  const handleClick = useCallback(
    (id: string) => setActive((prev) => (prev === id ? null : id)),
    []
  );

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative w-full max-w-2xl mx-auto">
        <svg
          viewBox="0 0 600 500"
          className="w-full h-auto"
          style={{ maxHeight: "520px" }}
        >
          <defs>
            {/* Ambient glow for the center */}
            <radialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(0,240,192,0.06)" />
              <stop offset="100%" stopColor="rgba(0,240,192,0)" />
            </radialGradient>

            {/* Subtle grid pattern */}
            <pattern
              id="gridPattern"
              width="30"
              height="30"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="15" cy="15" r="0.5" fill="rgba(30,30,74,0.4)" />
            </pattern>
          </defs>

          {/* Background grid */}
          <rect width="600" height="500" fill="url(#gridPattern)" opacity="0.5" />

          {/* Center ambient glow */}
          <circle cx="300" cy="250" r="200" fill="url(#centerGlow)" />

          {/* Vault heartbeat pulse (always animating) */}
          <circle cx="300" cy="250" r="55" fill="none" stroke="rgba(0,240,192,0.08)" strokeWidth="1">
            <animate
              attributeName="r"
              values="55;75;55"
              dur="3s"
              repeatCount="indefinite"
            />
            <animate
              attributeName="opacity"
              values="0.3;0;0.3"
              dur="3s"
              repeatCount="indefinite"
            />
          </circle>

          {/* Connection paths */}
          {CONNECTIONS.map((conn) => {
            const from = getOrgan(conn.from);
            const to = getOrgan(conn.to);
            const isActive =
              active === conn.from || active === conn.to;
            return (
              <ConnectionPath
                key={`${conn.from}-${conn.to}`}
                from={from}
                to={to}
                active={isActive}
              />
            );
          })}

          {/* Organ nodes */}
          {ORGANS.map((organ) => (
            <OrganNode
              key={organ.id}
              organ={organ}
              active={active === organ.id}
              onHover={() => handleHover(organ.id)}
              onLeave={handleLeave}
              onClick={() => handleClick(organ.id)}
            />
          ))}
        </svg>
      </div>

      {/* Description tooltip */}
      <div
        className={`w-full max-w-lg min-h-[4.5rem] darwin-card text-center transition-all duration-300 ${
          activeOrgan ? "opacity-100 translate-y-0" : "opacity-40 translate-y-1"
        }`}
      >
        {activeOrgan ? (
          <>
            <p className="section-header mb-1" style={{ color: activeOrgan.color }}>
              {activeOrgan.role}
            </p>
            <p className="text-sm text-darwin-text leading-relaxed">
              {activeOrgan.description}
            </p>
          </>
        ) : (
          <p className="text-sm text-darwin-text-dim italic">
            Hover or tap an organ to explore the anatomy
          </p>
        )}
      </div>
    </div>
  );
}
