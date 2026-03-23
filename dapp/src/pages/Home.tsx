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

function formatUSD(value: string | null): string {
  if (value == null) return "--";
  const num = parseFloat(value);
  if (isNaN(num)) return "--";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Compute aggregate stats from raw API data (field names differ from AgentState type)
function useAgentStats() {
  const { agentState, strategies } = useDarwinFiAPI();
  const raw = agentState as Record<string, unknown> | null;

  const totalTrades = strategies.reduce((sum, s) => sum + (s.trades || 0), 0);

  // API returns totalPnL (capital L), not totalPnl
  const totalPnl = typeof raw?.totalPnL === "number" ? (raw.totalPnL as number) : null;

  // Champion = liveStrategy name or best-scoring strategy
  let champion: string | null = null;
  if (raw?.liveStrategy && typeof raw.liveStrategy === "string") {
    champion = raw.liveStrategy;
  } else if (strategies.length > 0) {
    const best = strategies.reduce((a, b) => (b.score > a.score ? b : a));
    if (best.score > 0) champion = best.name;
  }

  // Win rate from strategies with trades
  const withTrades = strategies.filter((s) => s.trades > 0);
  const winRate =
    withTrades.length > 0
      ? withTrades.reduce((sum, s) => sum + s.winRate * s.trades, 0) /
        withTrades.reduce((sum, s) => sum + s.trades, 0)
      : null;

  return { totalTrades, totalPnl, champion, winRate };
}

function LiveStats({ items }: { items: { label: string; value: string; accent?: boolean; color?: string }[] }) {
  return (
    <div className={`grid gap-4 ${items.length === 4 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-1 md:grid-cols-3"}`}>
      {items.map((item) => (
        <div key={item.label} className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-4 text-center">
          <p className="text-sm font-mono text-darwin-text-dim uppercase tracking-wider mb-1">{item.label}</p>
          <p className={`text-lg font-mono font-bold ${
            item.color ? item.color : item.accent ? "text-darwin-accent text-glow-accent" : "text-darwin-text-bright"
          }`}>
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function StepExplainer() {
  const steps = [
    { num: "1", title: "Connect & Deposit", desc: "Connect your wallet and deposit USDC. That's your only decision." },
    { num: "2", title: "AI Takes Over", desc: "16 strategies compete. The winner trades live. No action needed." },
    { num: "3", title: "Withdraw Anytime", desc: "Your shares track vault profits. Cash out whenever you want." },
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

function HeroSection({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full relative -mx-4 sm:-mx-6 lg:-mx-8 -mt-12">
      <ShaderHero>{children}</ShaderHero>
    </div>
  );
}

export function Home() {
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { tvl, sharePrice, userShares, userShareValue } = useVaultStats();
  const { agentState, agentLoading, trades, tradesLoading } = useDarwinFiAPI();
  const { totalTrades, totalPnl, champion, winRate } = useAgentStats();

  const hasPosition = isConnected && userShares != null && parseFloat(userShares) > 0;

  const pnlFormatted =
    totalPnl != null
      ? `${totalPnl >= 0 ? "+" : ""}$${Math.abs(totalPnl).toFixed(2)}`
      : "--";
  const pnlColor =
    totalPnl != null && totalPnl >= 0 ? "text-darwin-accent" : totalPnl != null ? "text-darwin-danger" : undefined;

  // STATE 1: Not connected (Landing Page)
  if (!isConnected) {
    return (
      <div className="space-y-8">
        <HeroSection>
          <div className="text-center px-6 max-w-4xl">
            <div className="mb-6">
              <img
                src="/darwinfi/darwinfi-logo-bg.png"
                alt="DarwinFi"
                className="w-auto h-20 mx-auto rounded-2xl opacity-95 shadow-lg shadow-darwin-accent/30"
              />
            </div>

            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-darwin-accent/20 bg-darwin-accent/5 mb-8">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-darwin-accent opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-darwin-accent" />
              </span>
              <span className="text-xs font-mono font-medium text-darwin-accent tracking-wider uppercase">
                Live on Base L2
              </span>
            </div>

            <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black text-darwin-text-bright mb-6 leading-[1.05] tracking-tight">
              Your Yield,{" "}
              <span className="text-darwin-accent text-glow-accent">Evolved.</span>
            </h1>

            <p className="font-sans text-lg md:text-xl text-darwin-text max-w-2xl mx-auto mb-10 leading-relaxed">
              Deposit USDC. AI trades. You earn.
            </p>

            <button
              onClick={openConnectModal}
              className="hero-connect-btn group relative overflow-hidden"
            >
              <span className="relative z-10">Connect Wallet</span>
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700" />
            </button>
          </div>
        </HeroSection>

        <LiveStats items={[
          { label: "TVL", value: `$${formatUSD(tvl)}`, accent: true },
          { label: "Share Price", value: sharePrice ? `$${parseFloat(sharePrice).toFixed(6)}` : "--" },
          { label: "Agent PnL", value: pnlFormatted, color: pnlColor },
        ]} />

        <AnimatedSection><StepExplainer /></AnimatedSection>
        <AnimatedSection delay={100}><TrustModel /></AnimatedSection>
      </div>
    );
  }

  // STATE 2: Connected, has position (Dashboard)
  if (hasPosition) {
    const sharesNum = userShares ? parseFloat(userShares) : 0;
    const priceNum = sharePrice ? parseFloat(sharePrice) : 1;
    const pnlPct = ((priceNum - 1.0) / 1.0) * 100;
    const isPositive = pnlPct >= 0;

    return (
      <div className="space-y-6">
        {/* YOUR POSITION - hero prominence */}
        <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-accent/30 rounded-xl p-8 glow-accent text-center">
          <p className="text-sm font-mono text-darwin-text-dim uppercase tracking-wider mb-3">Your Position</p>
          <p className="text-4xl sm:text-5xl font-mono font-bold text-darwin-text-bright mb-2">
            ${formatUSD(userShareValue)}
          </p>
          <span className={`inline-block text-sm font-mono px-3 py-1 rounded-full mb-2 ${
            isPositive ? "bg-darwin-accent/20 text-darwin-accent" : "bg-darwin-danger/20 text-darwin-danger"
          }`}>
            {isPositive ? "+" : ""}{pnlPct.toFixed(2)}%
          </span>
          <p className="text-sm font-mono text-darwin-text-dim">
            {sharesNum.toLocaleString("en-US", { maximumFractionDigits: 6 })} dvUSDC shares
          </p>
        </div>

        {/* Charts side by side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <SharePriceChart />
          <ReturnsChart />
        </div>

        {/* Deposit & Withdraw side by side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <DepositCard />
          <WithdrawCard />
        </div>

        {/* Compact live stats strip */}
        <LiveStats items={[
          { label: "TVL", value: `$${formatUSD(tvl)}`, accent: true },
          { label: "Trades", value: totalTrades > 0 ? totalTrades.toLocaleString() : "--" },
          { label: "Champion", value: champion ?? "--", accent: !!champion },
          { label: "Win Rate", value: winRate != null ? `${(winRate * 100).toFixed(1)}%` : "--" },
        ]} />

        {/* Agent Activity - visible by default */}
        <AgentStatus agentState={agentState} loading={agentLoading} />
        <TradesFeed trades={trades} loading={tradesLoading} maxItems={5} />
        <div className="text-center">
          <Link
            to="/results"
            className="text-sm font-mono text-darwin-purple hover:text-darwin-accent transition-colors"
          >
            {"View full results ->"}
          </Link>
        </div>
      </div>
    );
  }

  // STATE 3: Connected, no position (First Deposit)
  return (
    <div className="space-y-8">
      <HeroSection>
        <div className="text-center px-6 max-w-4xl">
          <div className="mb-6">
            <img
              src="/darwinfi/darwinfi-logo-bg.png"
              alt="DarwinFi"
              className="w-auto h-20 mx-auto rounded-2xl opacity-95 shadow-lg shadow-darwin-accent/30"
            />
          </div>

          <h1 className="font-serif text-4xl sm:text-5xl md:text-6xl font-black text-darwin-text-bright mb-4 leading-[1.05] tracking-tight">
            Your Yield,{" "}
            <span className="text-darwin-accent text-glow-accent">Evolved.</span>
          </h1>

          <p className="font-sans text-lg md:text-xl text-darwin-text max-w-2xl mx-auto mb-6 leading-relaxed">
            Deposit USDC to get started.
          </p>
        </div>
      </HeroSection>

      {/* Deposit card overlapping hero */}
      <div className="max-w-md mx-auto -mt-8 relative z-20">
        <DepositCard />
      </div>

      <LiveStats items={[
        { label: "TVL", value: `$${formatUSD(tvl)}`, accent: true },
        { label: "Share Price", value: sharePrice ? `$${parseFloat(sharePrice).toFixed(6)}` : "--" },
        { label: "Agent PnL", value: pnlFormatted, color: pnlColor },
      ]} />

      <AnimatedSection delay={100}><StepExplainer /></AnimatedSection>
      <AnimatedSection delay={200}><TrustModel /></AnimatedSection>
    </div>
  );
}
