import { useState } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Link } from "react-router-dom";
import { ShaderHero } from "../components/ShaderHero";
import { DepositCard } from "../components/DepositCard";
import { WithdrawCard } from "../components/WithdrawCard";
import { AgentStatus } from "../components/AgentStatus";
import { TradesFeed } from "../components/TradesFeed";
import { TrustModel } from "../components/TrustModel";
import { SharePriceChart } from "../components/SharePriceChart";
import { ReturnsChart } from "../components/ReturnsChart";
import { AnimatedSection } from "../components/AnimatedSection";
import { useVaultStats } from "../hooks/useVaultStats";
import { useDarwinFiAPI } from "../hooks/useDarwinFiAPI";

function PerformanceBar() {
  const { sharePrice } = useVaultStats();
  const { agentState } = useDarwinFiAPI();

  const totalTrades = agentState?.totalTrades ?? null;
  const champion = agentState?.championStrategy ?? null;
  const uptimeSec = agentState?.uptime ?? null;
  const daysSinceLaunch = uptimeSec != null ? Math.floor(uptimeSec / 86400) : null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-5 text-center">
        <p className="text-sm font-mono text-darwin-text-dim uppercase tracking-wider mb-1">Share Price</p>
        <p className="text-lg font-mono font-bold text-darwin-text-bright">
          ${sharePrice ? parseFloat(sharePrice).toFixed(6) : "--"}
        </p>
      </div>
      <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-5 text-center">
        <p className="text-sm font-mono text-darwin-text-dim uppercase tracking-wider mb-1">Total Trades</p>
        <p className="text-lg font-mono font-bold text-darwin-text-bright">
          {totalTrades != null ? totalTrades.toLocaleString() : "--"}
        </p>
      </div>
      <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-5 text-center">
        <p className="text-sm font-mono text-darwin-text-dim uppercase tracking-wider mb-1">Days Live</p>
        <p className="text-lg font-mono font-bold text-darwin-text-bright">
          {daysSinceLaunch != null ? daysSinceLaunch : "--"}
        </p>
      </div>
      <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-5 text-center">
        <p className="text-sm font-mono text-darwin-text-dim uppercase tracking-wider mb-1">Champion</p>
        <p className="text-lg font-mono font-bold text-darwin-accent truncate">
          {champion ?? "--"}
        </p>
      </div>
    </div>
  );
}

function formatUSD(value: string | null): string {
  if (value == null) return "--";
  const num = parseFloat(value);
  if (isNaN(num)) return "--";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function VaultStatsBar() {
  const { tvl, sharePrice } = useVaultStats();
  const { agentState } = useDarwinFiAPI();

  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-4 text-center">
        <p className="text-sm font-mono text-darwin-text-dim uppercase tracking-wider mb-1">TVL</p>
        <p className="text-lg font-mono font-bold text-darwin-accent text-glow-accent">
          ${formatUSD(tvl)}
        </p>
      </div>
      <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-4 text-center">
        <p className="text-sm font-mono text-darwin-text-dim uppercase tracking-wider mb-1">Share Price</p>
        <p className="text-lg font-mono font-bold text-darwin-text-bright">
          ${sharePrice ? parseFloat(sharePrice).toFixed(6) : "--"}
        </p>
      </div>
      <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-4 text-center">
        <p className="text-sm font-mono text-darwin-text-dim uppercase tracking-wider mb-1">Agent PnL</p>
        <p className={`text-lg font-mono font-bold ${(agentState?.totalPnl ?? 0) >= 0 ? "text-darwin-accent" : "text-darwin-danger"}`}>
          {agentState?.totalPnl != null
            ? `${agentState.totalPnl >= 0 ? "+" : ""}$${Math.abs(agentState.totalPnl).toFixed(2)}`
            : "--"}
        </p>
      </div>
    </div>
  );
}

function StepExplainer() {
  const steps = [
    { num: "1", title: "Deposit USDC", desc: "Connect your wallet and deposit any amount of USDC into the vault." },
    { num: "2", title: "Bot Trades", desc: "16 AI strategies compete. The best one trades live on Uniswap V3." },
    { num: "3", title: "Withdraw Anytime", desc: "Your dvUSDC shares grow as the vault profits. Redeem whenever you want." },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {steps.map((step) => (
        <div key={step.num} className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-5 text-center">
          <div className="w-8 h-8 rounded-full bg-darwin-accent/20 border border-darwin-accent/30 flex items-center justify-center mx-auto mb-3">
            <span className="text-base font-mono font-bold text-darwin-accent">{step.num}</span>
          </div>
          <h3 className="text-base font-sans font-bold text-darwin-text-bright mb-1">{step.title}</h3>
          <p className="text-sm font-sans text-darwin-text-dim leading-relaxed">{step.desc}</p>
        </div>
      ))}
    </div>
  );
}

function PositionDisplay() {
  const { userShares, userShareValue, sharePrice } = useVaultStats();
  const sharesNum = userShares ? parseFloat(userShares) : 0;
  const valueNum = userShareValue ? parseFloat(userShareValue) : 0;
  const priceNum = sharePrice ? parseFloat(sharePrice) : 1;

  // PnL calculated from share price deviation from 1.0 (initial price)
  const pnlPct = ((priceNum - 1.0) / 1.0) * 100;
  const isPositive = pnlPct >= 0;

  return (
    <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-accent/30 rounded-xl p-6 glow-accent">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-mono text-darwin-text-dim uppercase tracking-wider">Your Position</span>
        <span className={`text-sm font-mono px-2 py-0.5 rounded ${isPositive ? "bg-darwin-accent/20 text-darwin-accent" : "bg-darwin-danger/20 text-darwin-danger"}`}>
          {isPositive ? "+" : ""}{pnlPct.toFixed(2)}%
        </span>
      </div>
      <p className="text-3xl font-mono font-bold text-darwin-text-bright mb-1">
        ${formatUSD(userShareValue)}
      </p>
      <p className="text-base font-mono text-darwin-text-dim">
        {sharesNum.toLocaleString("en-US", { maximumFractionDigits: 6 })} dvUSDC
      </p>
    </div>
  );
}

export function Home() {
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { userShares } = useVaultStats();
  const { agentState, agentLoading, trades, tradesLoading } = useDarwinFiAPI();
  const [showDetails, setShowDetails] = useState(false);

  const hasPosition = isConnected && userShares != null && parseFloat(userShares) > 0;

  // STATE 1: Not connected
  if (!isConnected) {
    return (
      <div className="space-y-8">
        {/* Full-bleed hero: break out of main's max-w-7xl constraint */}
        <div className="w-screen relative left-1/2 -translate-x-1/2 -mt-12">
          <ShaderHero>
            <div className="text-center px-6 max-w-4xl">
              {/* Logo */}
              <div className="mb-6">
                <img
                  src="/darwinfi/darwinfi-logo-bg.png"
                  alt="DarwinFi"
                  className="w-auto h-20 mx-auto rounded-2xl opacity-95 shadow-lg shadow-darwin-accent/30"
                />
              </div>

              {/* Live badge */}
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-darwin-accent/20 bg-darwin-accent/5 mb-8">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-darwin-accent opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-darwin-accent" />
                </span>
                <span className="text-xs font-mono font-medium text-darwin-accent tracking-wider uppercase">
                  Live on Base L2
                </span>
              </div>

              {/* Headline */}
              <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black text-darwin-text-bright mb-6 leading-[1.05] tracking-tight">
                Your Yield,{" "}
                <span className="text-darwin-accent text-glow-accent">Evolved.</span>
              </h1>

              {/* Sub-text */}
              <p className="font-sans text-lg md:text-xl text-darwin-text max-w-2xl mx-auto mb-10 leading-relaxed">
                16 strategies compete. AI mutates the winners. You collect the yield.
              </p>

              {/* Connect CTA */}
              <button
                onClick={openConnectModal}
                className="hero-connect-btn group relative overflow-hidden"
              >
                <span className="relative z-10">Connect Wallet</span>
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
              </button>
            </div>
          </ShaderHero>
        </div>

        <PerformanceBar />
        <AnimatedSection><StepExplainer /></AnimatedSection>
        <AnimatedSection delay={100}><VaultStatsBar /></AnimatedSection>
        <AnimatedSection delay={200}><TrustModel /></AnimatedSection>
      </div>
    );
  }

  // STATE 2: Connected, has position (primary view)
  if (hasPosition) {
    return (
      <div className="space-y-6">
        <PerformanceBar />
        {/* Position + Chart side by side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <PositionDisplay />
          <div className="space-y-4">
            <SharePriceChart />
            <ReturnsChart />
          </div>
        </div>

        {/* Withdraw section */}
        <div className="max-w-md">
          <WithdrawCard />
        </div>

        {/* Collapsible details */}
        <div className="space-y-3">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-2 text-sm font-mono text-darwin-text-dim hover:text-darwin-text transition-colors"
          >
            <span
              className="transition-transform duration-200"
              style={{ display: "inline-block", transform: showDetails ? "rotate(90deg)" : "rotate(0deg)" }}
            >
              {">"}
            </span>
            What's happening with my funds?
          </button>

          {showDetails && (
            <div className="space-y-6">
              <AgentStatus agentState={agentState} loading={agentLoading} />
              <TradesFeed trades={trades} loading={tradesLoading} maxItems={5} />
              <div className="text-center">
                <Link
                  to="/advanced"
                  className="text-sm font-mono text-darwin-purple hover:text-darwin-accent transition-colors"
                >
                  {"View advanced explorer ->"}
                </Link>
              </div>
            </div>
          )}
        </div>

        <TrustModel />
        <VaultStatsBar />
      </div>
    );
  }

  // STATE 3: Connected, no position
  return (
    <div className="space-y-8">
      {/* Full-bleed hero */}
      <div className="w-screen relative left-1/2 -translate-x-1/2 -mt-12">
        <ShaderHero>
          <div className="text-center px-6 max-w-4xl">
            {/* Logo */}
            <div className="mb-6">
              <img
                src="/darwinfi/darwinfi-logo-bg.png"
                alt="DarwinFi"
                className="w-auto h-20 mx-auto rounded-2xl opacity-95 shadow-lg shadow-darwin-accent/30"
              />
            </div>

            {/* Live badge */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-darwin-accent/20 bg-darwin-accent/5 mb-8">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-darwin-accent opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-darwin-accent" />
              </span>
              <span className="text-xs font-mono font-medium text-darwin-accent tracking-wider uppercase">
                Live on Base L2
              </span>
            </div>

            {/* Headline */}
            <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black text-darwin-text-bright mb-6 leading-[1.05] tracking-tight">
              Your Yield,{" "}
              <span className="text-darwin-accent text-glow-accent">Evolved.</span>
            </h1>

            {/* Sub-text */}
            <p className="font-sans text-lg md:text-xl text-darwin-text max-w-2xl mx-auto mb-6 leading-relaxed">
              Your USDC earns yield from AI-managed trading. Deposit to get started.
            </p>
          </div>
        </ShaderHero>
      </div>

      {/* DepositCard overlapping hero */}
      <div className="max-w-md mx-auto -mt-8 relative z-20">
        <DepositCard />
      </div>

      <PerformanceBar />
      <AnimatedSection delay={100}><VaultStatsBar /></AnimatedSection>
      <AnimatedSection delay={200}><StepExplainer /></AnimatedSection>
      <AnimatedSection delay={300}><TrustModel /></AnimatedSection>
    </div>
  );
}
