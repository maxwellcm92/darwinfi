"use client";

import { useState } from "react";
import Link from "next/link";
import { ShaderHero } from "@/components/ShaderHero";
import { AnimatedSection } from "@/components/AnimatedSection";
import { FeatureCard } from "@/components/FeatureCard";
import { StatCounter } from "@/components/StatCounter";
import { SponsorBar } from "@/components/SponsorBar";
import { OrganismDiagram } from "@/components/OrganismDiagram";
import { usePollAPI } from "@/hooks/usePollAPI";
import { DAPP_URL, VAULT_ADDRESS } from "@/lib/constants";
import type { AgentState } from "@/lib/api";

/* ── Chevron icon for expandable sections ── */
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
    >
      <path
        d="M5 7.5L10 12.5L15 7.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}


export default function HomePage() {
  const { data: state, loading } = usePollAPI<AgentState>("/api/state", 8000);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  const toggle = (key: string) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="relative">
      {/* ── Hero ── */}
      <ShaderHero>
        <div className="text-center px-6 max-w-4xl">
          {/* Logo */}
          <div className="mb-6">
            <img
              src="/darwinfi-logo-bg-hero.webp"
              alt="DarwinFi"
              className="w-auto h-32 mx-auto rounded-2xl opacity-95 shadow-lg shadow-darwin-accent/30"
            />
          </div>

          {/* Hackathon badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-darwin-accent/20 bg-darwin-accent/5 mb-8">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-darwin-accent opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-darwin-accent" />
            </span>
            <span className="text-sm font-mono font-medium text-darwin-accent tracking-wider uppercase">
              Live on Base L2
            </span>
          </div>

          <h1 className="font-serif text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black text-darwin-text-bright mb-6 leading-[1.05] tracking-tight">
            Your Capital.{" "}
            <span className="text-darwin-accent text-glow-accent">
              Evolving.
            </span>
          </h1>
          <p className="font-sans text-lg md:text-xl text-darwin-text max-w-2xl mx-auto mb-4 leading-relaxed">
            AI strategies compete. The engine mutates the winners. Natural selection
            picks your yield.
          </p>
          <p className="font-mono text-sm text-darwin-text-dim max-w-lg mx-auto mb-10 tracking-wide">
            ERC-4626 Vault &middot; Lit Protocol Integration (Chipotle v3 Ready) &middot; Multi-AI
            Consensus &middot; Base Mainnet
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4">
            <a
              href={DAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative px-8 py-3.5 bg-darwin-accent text-darwin-bg font-semibold rounded-lg hover:bg-darwin-accent-dim transition-all glow-accent overflow-hidden"
            >
              <span className="relative z-10">Launch DApp</span>
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
            </a>
            <Link
              href="/story"
              className="px-8 py-3.5 border border-darwin-border text-darwin-text-bright rounded-lg hover:border-darwin-accent/50 hover:text-darwin-accent transition-colors"
            >
              Build Story
            </Link>
          </div>

          {/* Vault address badge */}
          <div className="mt-8 inline-flex items-center gap-2 text-darwin-text-dim">
            <span className="text-xs font-mono opacity-60">Vault:</span>
            <code className="text-xs font-mono opacity-40 hover:opacity-80 transition-opacity">
              {VAULT_ADDRESS}
            </code>
          </div>
        </div>
      </ShaderHero>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
        {/* ── Organism Diagram ── */}
        <AnimatedSection className="py-20 md:py-28">
          <div className="text-center mb-4">
            <span className="section-header text-darwin-accent">
              System Architecture
            </span>
          </div>
          <h2 className="font-serif text-3xl md:text-4xl lg:text-5xl font-bold text-darwin-text-bright text-center mb-4">
            A Living Financial Organism
          </h2>
          <p className="text-darwin-text-dim text-center max-w-xl mx-auto mb-12">
            DarwinFi is not a static vault. It is a living system with organs
            that sense, adapt, defend, and evolve.
          </p>
          <OrganismDiagram />
        </AnimatedSection>

        {/* ── Feature Cards ── */}
        <AnimatedSection className="py-16">
          <div className="text-center mb-12">
            <span className="section-header text-darwin-purple">
              Core Capabilities
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <FeatureCard
              accentColor="accent"
              icon={
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                  <path
                    d="M16 4a12 12 0 100 24 12 12 0 000-24z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M16 10v6l4 4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <path
                    d="M12 2h8M12 30h8"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              }
              title="Self-Evolving"
              description="Every 4 hours, AI evaluates all strategies, mutates parameters, and promotes winners. No manual rebalancing ever."
            />
            <FeatureCard
              accentColor="purple"
              icon={
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                  <rect
                    x="4"
                    y="10"
                    width="24"
                    height="16"
                    rx="2"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M10 10V8a6 6 0 0112 0v2"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <circle cx="16" cy="19" r="2" fill="currentColor" />
                  <path
                    d="M16 21v3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              }
              title="Cryptographically Safe"
              description="Lit Protocol integration built for Chipotle v3 mainnet. PKP key management, spending limits, position sizes, and circuit breakers ready for on-chain enforcement."
            />
            <FeatureCard
              accentColor="warning"
              icon={
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                  <circle
                    cx="10"
                    cy="10"
                    r="4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <circle
                    cx="22"
                    cy="10"
                    r="4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <circle
                    cx="16"
                    cy="24"
                    r="4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M12 13l2 8M20 13l-2 8"
                    stroke="currentColor"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                  />
                </svg>
              }
              title="Multi-AI Architecture"
              description="Three AI models vote on market direction independently. Consensus drives action. No single point of failure."
            />
            <FeatureCard
              accentColor="gold"
              icon={
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                  <rect
                    x="4"
                    y="4"
                    width="24"
                    height="24"
                    rx="4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    d="M10 16h12M16 10v12"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <path
                    d="M4 12h24"
                    stroke="currentColor"
                    strokeWidth="1"
                    strokeDasharray="3 2"
                  />
                </svg>
              }
              title="Standard ERC-4626"
              description="Fully composable tokenized vault. Deposit USDC, receive shares. Withdraw anytime. Integrates with any DeFi protocol."
            />
          </div>
        </AnimatedSection>

        {/* ── Live Stats ── */}
        <AnimatedSection className="py-16">
          <div className="darwin-card glow-accent relative overflow-hidden">
            {/* Decorative corner accent */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-darwin-accent/5 to-transparent pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-32 h-32 bg-gradient-to-tr from-darwin-purple/5 to-transparent pointer-events-none" />

            <p className="section-header text-darwin-accent text-center mb-2">
              Live Vault Telemetry
            </p>
            <p className="text-darwin-text-dim text-center text-sm mb-8">
              Polling every 8 seconds from{" "}
              <span className="font-mono text-darwin-text-dim/80">
                /api/state
              </span>
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              <StatCounter
                label="Total Trades"
                value={state?.totalTrades ?? null}
                loading={loading}
              />
              <StatCounter
                label="Active Strategies"
                value={state?.activeStrategies ?? null}
                loading={loading}
              />
              <StatCounter
                label="Evolution Cycles"
                value={state?.evolutionCycle ?? null}
                loading={loading}
              />
              <StatCounter
                label="Total PnL"
                value={state?.totalPnl ?? null}
                prefix="$"
                decimals={2}
                loading={loading}
              />
            </div>

            {/* Win rate and uptime sub-stats */}
            {state && (
              <div className="mt-8 pt-6 border-t border-darwin-border/20 flex flex-wrap items-center justify-center gap-6 text-sm font-mono text-darwin-text-dim">
                {state.winRate !== undefined && (
                  <span>
                    Win Rate:{" "}
                    <span className="text-darwin-text">
                      {(state.winRate * 100).toFixed(1)}%
                    </span>
                  </span>
                )}
                {state.championStrategy && (
                  <span>
                    Champion:{" "}
                    <span className="text-darwin-accent">
                      {state.championStrategy}
                    </span>
                  </span>
                )}
                {state.uptimeFormatted && (
                  <span>
                    Uptime:{" "}
                    <span className="text-darwin-text">
                      {state.uptimeFormatted}
                    </span>
                  </span>
                )}
                {state.status && (
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        state.status === "RUNNING"
                          ? "bg-darwin-success"
                          : "bg-darwin-warning"
                      }`}
                    />
                    {state.status}
                  </span>
                )}
              </div>
            )}
          </div>
        </AnimatedSection>

        {/* ── How It Works ── */}
        <AnimatedSection className="py-20 md:py-28">
          <div className="text-center mb-4">
            <span className="section-header text-darwin-warning">
              The Process
            </span>
          </div>
          <h2 className="font-serif text-3xl md:text-4xl lg:text-5xl font-bold text-darwin-text-bright text-center mb-4">
            How It Works
          </h2>
          <p className="text-darwin-text-dim text-center max-w-lg mx-auto mb-14">
            Three steps from deposit to evolved returns.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
            {/* Connection arrows between steps (desktop only) */}
            <div className="hidden md:block absolute top-1/2 left-[33%] w-[1%] -translate-y-1/2">
              <svg
                viewBox="0 0 40 20"
                className="w-10 text-darwin-accent/30"
              >
                <path
                  d="M0 10 L30 10 M22 4 L30 10 L22 16"
                  stroke="currentColor"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div className="hidden md:block absolute top-1/2 left-[64%] w-[1%] -translate-y-1/2">
              <svg
                viewBox="0 0 40 20"
                className="w-10 text-darwin-accent/30"
              >
                <path
                  d="M0 10 L30 10 M22 4 L30 10 L22 16"
                  stroke="currentColor"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                />
              </svg>
            </div>

            {[
              {
                step: "01",
                title: "Deposit",
                desc: "Connect your wallet, deposit USDC into the ERC-4626 vault. You receive shares representing your stake in the evolving ecosystem.",
                accentClass: "text-darwin-accent",
                borderClass: "border-darwin-accent/20",
                icon: (
                  <svg
                    width="40"
                    height="40"
                    viewBox="0 0 40 40"
                    fill="none"
                  >
                    <circle
                      cx="20"
                      cy="20"
                      r="16"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                    <path
                      d="M20 12v16M14 22l6 6 6-6"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ),
              },
              {
                step: "02",
                title: "Compete & Evolve",
                desc: "Trading strategies compete simultaneously. Each is scored on PnL, Sharpe ratio, drawdown, and consistency. Every 4 hours, AI mutates winners and eliminates the weak.",
                accentClass: "text-darwin-purple",
                borderClass: "border-darwin-purple/20",
                icon: (
                  <svg
                    width="40"
                    height="40"
                    viewBox="0 0 40 40"
                    fill="none"
                  >
                    <path
                      d="M8 32l8-12 6 6 10-18"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <circle
                      cx="32"
                      cy="8"
                      r="3"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                  </svg>
                ),
              },
              {
                step: "03",
                title: "Champion Trades Live",
                desc: "The fittest strategy earns champion status and executes real trades with vault capital. Your capital adapts to markets autonomously.",
                accentClass: "text-darwin-warning",
                borderClass: "border-darwin-warning/20",
                icon: (
                  <svg
                    width="40"
                    height="40"
                    viewBox="0 0 40 40"
                    fill="none"
                  >
                    <path
                      d="M20 6a14 14 0 0110 24"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M20 34a14 14 0 01-10-24"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                    <path d="M30 30l-2-4h4l-2 4z" fill="currentColor" />
                    <path d="M10 10l2 4H8l2-4z" fill="currentColor" />
                  </svg>
                ),
              },
            ].map((item) => (
              <div
                key={item.step}
                className={`darwin-card text-center border-t-2 ${item.borderClass} hover:border-opacity-60 transition-all duration-300`}
              >
                <div className="text-darwin-text-dim mb-4 flex justify-center">
                  {item.icon}
                </div>
                <p className={`section-header ${item.accentClass} mb-2`}>
                  Step {item.step}
                </p>
                <h3 className="font-semibold text-darwin-text-bright text-xl mb-3">
                  {item.title}
                </h3>
                <p className="text-darwin-text-dim text-base leading-relaxed">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </AnimatedSection>

        {/* ── Sponsors ── */}
        <AnimatedSection className="py-8">
          <SponsorBar />
        </AnimatedSection>

        {/* ── Technical Depth ── */}
        <AnimatedSection className="py-20 md:py-28">
          <div className="text-center mb-4">
            <span className="section-header text-darwin-gold">
              For Builders
            </span>
          </div>
          <h2 className="font-serif text-3xl md:text-4xl lg:text-5xl font-bold text-darwin-text-bright text-center mb-4">
            Under the Hood
          </h2>
          <p className="text-darwin-text-dim text-center max-w-lg mx-auto mb-12">
            For builders and auditors -- the math, the safety, and the proof.
          </p>

          <div className="max-w-5xl mx-auto space-y-4">
            {/* Scoring Formula */}
            <div className="darwin-card">
              <button
                onClick={() => toggle("scoring")}
                className="w-full flex items-center justify-between text-left cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-darwin-accent/10 flex items-center justify-center">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                    >
                      <path
                        d="M2 14l4-6 3 3 5-9"
                        stroke="#00F0C0"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-darwin-text-bright">
                    Fitness Scoring Formula
                  </h3>
                </div>
                <ChevronIcon open={!!openSections["scoring"]} />
              </button>
              {openSections["scoring"] && (
                <div className="mt-4 pt-4 border-t border-darwin-border/30 text-base text-darwin-text leading-relaxed space-y-4">
                  <div className="bg-darwin-bg/50 rounded-lg p-4 border border-darwin-border/20">
                    <p className="font-mono text-darwin-accent text-sm leading-relaxed">
                      fitness = (0.35 * pnlNorm) + (0.25 * sharpeNorm) + (0.20 *
                      consistencyNorm) + (0.15 * winRateNorm) + (0.05 *
                      drawdownPenalty)
                    </p>
                  </div>
                  <p>
                    Each metric is normalized to [0, 1] across the population.
                    PnL and Sharpe ratio carry the most weight because they
                    directly measure return quality. Consistency rewards
                    strategies that perform steadily rather than spiking.
                  </p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-darwin-bg/30 rounded p-3 border border-darwin-border/10">
                      <span className="font-mono text-darwin-accent">35%</span>{" "}
                      <span className="text-darwin-text-dim">PnL weight</span>
                    </div>
                    <div className="bg-darwin-bg/30 rounded p-3 border border-darwin-border/10">
                      <span className="font-mono text-darwin-purple">25%</span>{" "}
                      <span className="text-darwin-text-dim">Sharpe ratio</span>
                    </div>
                    <div className="bg-darwin-bg/30 rounded p-3 border border-darwin-border/10">
                      <span className="font-mono text-darwin-warning">20%</span>{" "}
                      <span className="text-darwin-text-dim">Consistency</span>
                    </div>
                    <div className="bg-darwin-bg/30 rounded p-3 border border-darwin-border/10">
                      <span className="font-mono text-darwin-gold">15%</span>{" "}
                      <span className="text-darwin-text-dim">Win rate</span>
                    </div>
                  </div>
                  <p className="text-darwin-text-dim text-sm">
                    Drawdown is penalized exponentially -- a 20% drawdown costs
                    4x more than a 10%. This prevents strategies from gambling
                    their way to the top.
                  </p>
                </div>
              )}
            </div>

            {/* Circuit Breakers */}
            <div className="darwin-card">
              <button
                onClick={() => toggle("breakers")}
                className="w-full flex items-center justify-between text-left cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-darwin-danger/10 flex items-center justify-center">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                    >
                      <path
                        d="M8 2v8M8 12v2"
                        stroke="#FF3050"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-darwin-text-bright">
                    Circuit Breakers
                  </h3>
                </div>
                <ChevronIcon open={!!openSections["breakers"]} />
              </button>
              {openSections["breakers"] && (
                <div className="mt-4 pt-4 border-t border-darwin-border/30 text-base text-darwin-text leading-relaxed space-y-4">
                  <p>
                    Five independent circuit breakers protect the vault:
                  </p>
                  <div className="space-y-2">
                    {[
                      {
                        name: "Max Drawdown",
                        rule: "Halts all trading if portfolio drops 15% from peak",
                        color: "text-darwin-danger",
                      },
                      {
                        name: "Position Size",
                        rule: "No single trade exceeds 5% of vault TVL",
                        color: "text-darwin-warning",
                      },
                      {
                        name: "Strategy Loss",
                        rule: "Individual strategy suspended after 3% loss in 24h",
                        color: "text-darwin-purple",
                      },
                      {
                        name: "Volatility Throttle",
                        rule: "Reduces position sizes when VIX-equivalent spikes",
                        color: "text-darwin-gold",
                      },
                      {
                        name: "Heartbeat Monitor",
                        rule: "Pauses execution if agent goes silent for >5 minutes",
                        color: "text-darwin-accent",
                      },
                    ].map((breaker) => (
                      <div
                        key={breaker.name}
                        className="flex items-start gap-3 bg-darwin-bg/30 rounded-lg p-3 border border-darwin-border/10"
                      >
                        <span
                          className={`font-mono text-sm font-bold ${breaker.color} shrink-0 mt-0.5`}
                        >
                          {breaker.name}
                        </span>
                        <span className="text-darwin-text-dim text-sm">
                          {breaker.rule}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Lit Protocol Policy */}
            <div className="darwin-card">
              <button
                onClick={() => toggle("lit")}
                className="w-full flex items-center justify-between text-left cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-darwin-purple/10 flex items-center justify-center">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                    >
                      <path
                        d="M8 2l6 4v4l-6 4-6-4V6l6-4z"
                        stroke="#8040DD"
                        strokeWidth="1.5"
                      />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-darwin-text-bright">
                    Lit Protocol Policy
                  </h3>
                </div>
                <ChevronIcon open={!!openSections["lit"]} />
              </button>
              {openSections["lit"] && (
                <div className="mt-4 pt-4 border-t border-darwin-border/30 text-base text-darwin-text leading-relaxed space-y-4">
                  <p>
                    The vault&apos;s private key is held by a Lit Protocol PKP
                    (Programmable Key Pair). Lit Actions enforce conditions
                    before any transaction is signed:
                  </p>
                  <div className="space-y-2">
                    {[
                      {
                        name: "Spending Cap",
                        detail: "Maximum USDC outflow per 24h period",
                      },
                      {
                        name: "Approved Contracts",
                        detail: "Whitelist of DEX routers and vault contract only",
                      },
                      {
                        name: "Signature Quorum",
                        detail: "2-of-3 Lit nodes must agree to sign",
                      },
                    ].map((policy) => (
                      <div
                        key={policy.name}
                        className="flex items-start gap-3 bg-darwin-bg/30 rounded-lg p-3 border border-darwin-border/10"
                      >
                        <span className="font-mono text-sm font-bold text-darwin-purple shrink-0 mt-0.5">
                          {policy.name}
                        </span>
                        <span className="text-darwin-text-dim text-sm">
                          {policy.detail}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-darwin-text-dim text-sm border-l-2 border-darwin-purple/30 pl-3">
                    Lit Protocol integration is built and ready for Chipotle v3 mainnet.
                    PKP key management and IPFS-hosted policy enforcement will ensure
                    the deployer wallet cannot bypass trading constraints.
                  </p>
                </div>
              )}
            </div>

            {/* Test Coverage */}
            <div className="darwin-card">
              <button
                onClick={() => toggle("tests")}
                className="w-full flex items-center justify-between text-left cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-darwin-success/10 flex items-center justify-center">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="none"
                    >
                      <path
                        d="M4 8l3 3 5-6"
                        stroke="#00F0C0"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-darwin-text-bright">
                    Test Coverage
                  </h3>
                </div>
                <ChevronIcon open={!!openSections["tests"]} />
              </button>
              {openSections["tests"] && (
                <div className="mt-4 pt-4 border-t border-darwin-border/30 text-base text-darwin-text leading-relaxed space-y-4">
                  <p>
                    423+ tests across every critical path, end-to-end:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[
                      {
                        layer: "Solidity",
                        detail:
                          "80 Solidity tests (VaultV4): deposit/withdraw, share math, access control, timelock, and emergency flows",
                        color: "text-darwin-accent",
                      },
                      {
                        layer: "Agent Logic",
                        detail:
                          "Integration tests for evolution cycles, scoring, and strategy mutation",
                        color: "text-darwin-purple",
                      },
                      {
                        layer: "Circuit Breakers",
                        detail:
                          "Simulated drawdown and volatility spikes to verify halt conditions",
                        color: "text-darwin-warning",
                      },
                      {
                        layer: "E2E Flow",
                        detail:
                          "Fork-mode tests on Base mainnet fork for full deposit-trade-evolve-withdraw cycles",
                        color: "text-darwin-gold",
                      },
                    ].map((test) => (
                      <div
                        key={test.layer}
                        className="bg-darwin-bg/30 rounded-lg p-3 border border-darwin-border/10"
                      >
                        <span
                          className={`font-mono text-sm font-bold ${test.color} block mb-1`}
                        >
                          {test.layer}
                        </span>
                        <span className="text-darwin-text-dim text-sm leading-relaxed">
                          {test.detail}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </AnimatedSection>

        {/* ── CTA Banner ── */}
        <AnimatedSection className="py-20 md:py-28">
          <div className="darwin-card text-center py-12 md:py-16 glow-accent relative overflow-hidden">
            {/* Decorative background gradient */}
            <div className="absolute inset-0 bg-gradient-to-br from-darwin-accent/5 via-transparent to-darwin-purple/5 pointer-events-none" />

            <div className="relative z-10">
              <div className="inline-flex items-center gap-2 mb-6">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-darwin-accent opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-darwin-accent" />
                </span>
                <span className="section-header text-darwin-accent">
                  Vault Open
                </span>
              </div>
              <h2 className="font-serif text-3xl md:text-4xl lg:text-5xl font-bold text-darwin-text-bright mb-4">
                See it live. The vault is open.
              </h2>
              <p className="text-darwin-text-dim max-w-md mx-auto mb-8">
                Watch real strategies compete in real time. Review the trades,
                the scores, and the evolution log.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-4">
                <a
                  href={DAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative inline-block px-10 py-4 bg-darwin-accent text-darwin-bg font-semibold rounded-lg hover:bg-darwin-accent-dim transition-colors text-lg overflow-hidden"
                >
                  <span className="relative z-10">Launch DApp</span>
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
                </a>
                <Link
                  href="/story"
                  className="px-10 py-4 border border-darwin-border text-darwin-text-bright rounded-lg hover:border-darwin-purple/50 hover:text-darwin-purple transition-colors text-lg"
                >
                  Read the Build Story
                </Link>
              </div>
            </div>
          </div>
        </AnimatedSection>
      </div>
    </div>
  );
}
