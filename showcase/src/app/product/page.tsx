"use client";

import Link from "next/link";
import { AnimatedSection } from "@/components/AnimatedSection";
import { DAPP_URL, VAULT_ADDRESS, DEPLOYER_ADDRESS } from "@/lib/constants";

const features = [
  {
    title: "Home",
    subtitle: "Vault Overview",
    description:
      "Real-time vault telemetry showing total assets, share price, utilization, and agent status. Deposit and withdraw USDC directly.",
    capabilities: [
      "Live share price + vault TVL",
      "Agent wallet balance + active strategy",
      "One-click deposit/withdraw with approval flow",
      "Recent trades feed",
    ],
    gradient: "from-[#00F0C0]/20 via-[#8040DD]/10 to-transparent",
    accent: "text-darwin-accent",
  },
  {
    title: "Tournament",
    subtitle: "Strategy Leaderboard",
    description:
      "Watch 12+ strategies compete in real time. Ranked by composite fitness score across PnL, Sharpe ratio, win rate, consistency, and drawdown.",
    capabilities: [
      "Live composite score rankings",
      "Strategy PnL + Sharpe ratio per strategy",
      "Evolution cycle history + genome diffs",
      "Promotion/demotion event timeline",
    ],
    gradient: "from-[#E4C64B]/20 via-[#FFB020]/10 to-transparent",
    accent: "text-darwin-gold",
  },
  {
    title: "Portfolio",
    subtitle: "Your Position",
    description:
      "Track your dvUSDC share balance, current value in USDC, and profit/loss since deposit. Withdraw anytime.",
    capabilities: [
      "dvUSDC share balance + current value",
      "PnL tracking since deposit",
      "Withdraw with lock-time awareness",
      "Emergency withdrawal (always available)",
    ],
    gradient: "from-[#8040DD]/20 via-[#00F0C0]/10 to-transparent",
    accent: "text-darwin-purple",
  },
  {
    title: "Instinct",
    subtitle: "AI Predictions",
    description:
      "Multi-source intelligence from a 5-department biological nervous system. Predictions at 4 timeframes, source fitness scoring, and adaptive evolution.",
    capabilities: [
      "Directional predictions (1m, 5m, 15m, 1h)",
      "Source fitness scores (Grok, RSS, on-chain)",
      "Adaptive evolution triggers",
      "Pattern detection + workflow suggestions",
    ],
    gradient: "from-[#FFB020]/20 via-[#E4C64B]/10 to-transparent",
    accent: "text-darwin-warning",
  },
  {
    title: "Frontier",
    subtitle: "Cross-Chain Expansion",
    description:
      "Team 4 sends four new bot archetypes hunting across Base, Arbitrum, and Optimism. Each fills a distinct ecological niche.",
    capabilities: [
      "Abiogenesis: micro-cap moonshot detection",
      "Mitosis: ultra-HFT micro-scalping",
      "Cambrian: volatility spike hunting",
      "Symbiont: smart money whale following",
    ],
    gradient: "from-[#00F0C0]/20 via-[#E4C64B]/10 to-transparent",
    accent: "text-darwin-accent",
  },
];

const techStack = [
  { category: "Smart Contracts", items: ["Solidity", "Hardhat", "OpenZeppelin ERC-4626", "Base Mainnet"] },
  { category: "Agent Core", items: ["TypeScript", "ethers.js v6", "Uniswap V3 SDK", "1inch Aggregator"] },
  { category: "AI Models", items: ["Claude Haiku (signals)", "Venice AI / Llama 3.3 70B (evolution)", "Grok/X (sentiment)"] },
  { category: "DApp", items: ["React", "Vite", "Wagmi", "RainbowKit", "Tailwind CSS"] },
  { category: "Infrastructure", items: ["PM2", "Express", "Caddy", "IPFS/Filecoin", "Base / Arbitrum / Optimism"] },
];

function truncateAddress(addr: string) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

export default function ProductPage() {
  return (
    <div>
      {/* Hero */}
      <div className="relative overflow-hidden py-20 md:py-32">
        <div className="absolute inset-0 bg-gradient-to-b from-[#00F0C0]/8 via-transparent to-transparent" />
        <div className="max-w-4xl mx-auto px-6 text-center relative z-10">
          <AnimatedSection>
            <p className="section-header text-darwin-accent mb-4">Product Showcase</p>
            <h1 className="font-serif text-4xl md:text-6xl font-black text-darwin-text-bright mb-6 leading-tight">
              See DarwinFi in Action
            </h1>
            <p className="text-darwin-text text-lg md:text-xl max-w-2xl mx-auto leading-relaxed">
              A full-stack DeFi application: ERC-4626 vault, 16 competing strategies,
              biological AI systems, and cross-chain expansion. All live on Base mainnet.
            </p>
          </AnimatedSection>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6">
        {/* Feature Grid */}
        <AnimatedSection className="pb-20">
          <h2 className="font-serif text-3xl md:text-4xl font-bold text-darwin-text-bright text-center mb-4">
            DApp Features
          </h2>
          <p className="text-darwin-text-dim text-center max-w-lg mx-auto mb-12">
            Five pages, each exposing a different layer of the living organism.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((f, i) => (
              <AnimatedSection key={f.title} delay={i * 80}>
                <div className="darwin-card h-full flex flex-col">
                  {/* Screenshot placeholder */}
                  <div
                    className={`w-full h-40 rounded-lg mb-4 bg-gradient-to-br ${f.gradient} border border-darwin-border/30 flex items-center justify-center`}
                  >
                    <span className="text-darwin-text-dim text-sm font-mono">
                      Screenshot pending
                    </span>
                  </div>

                  <p className={`section-header ${f.accent} mb-1`}>{f.subtitle}</p>
                  <h3 className="font-semibold text-darwin-text-bright text-xl mb-2">
                    {f.title}
                  </h3>
                  <p className="text-darwin-text-dim text-sm leading-relaxed mb-4">
                    {f.description}
                  </p>

                  <ul className="mt-auto space-y-1.5">
                    {f.capabilities.map((cap) => (
                      <li
                        key={cap}
                        className="text-xs text-darwin-text-dim flex items-start gap-2"
                      >
                        <span className="text-darwin-accent mt-0.5">+</span>
                        {cap}
                      </li>
                    ))}
                  </ul>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </AnimatedSection>

        {/* Smart Contracts */}
        <AnimatedSection className="pb-20">
          <h2 className="font-serif text-3xl md:text-4xl font-bold text-darwin-text-bright text-center mb-4">
            Smart Contracts
          </h2>
          <p className="text-darwin-text-dim text-center max-w-lg mx-auto mb-12">
            Deployed and verified on Base mainnet (chain 8453).
          </p>

          <div className="max-w-2xl mx-auto space-y-4">
            <div className="darwin-card">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-darwin-text-bright">DarwinVaultV2 (ERC-4626)</h3>
                <span className="text-xs font-mono text-darwin-accent bg-darwin-accent/10 px-2 py-0.5 rounded">
                  Live
                </span>
              </div>
              <p className="font-mono text-sm text-darwin-text-dim mb-2 break-all">
                {VAULT_ADDRESS}
              </p>
              <div className="flex gap-3">
                <a
                  href={`https://basescan.org/address/${VAULT_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-darwin-accent hover:text-darwin-accent-dim transition-colors"
                >
                  View on Basescan
                </a>
              </div>
            </div>

            <div className="darwin-card">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-darwin-text-bright">Deployer Wallet</h3>
              </div>
              <p className="font-mono text-sm text-darwin-text-dim mb-2 break-all">
                {DEPLOYER_ADDRESS}
              </p>
              <a
                href={`https://basescan.org/address/${DEPLOYER_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-darwin-accent hover:text-darwin-accent-dim transition-colors"
              >
                View on Basescan
              </a>
            </div>

            <div className="darwin-card">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-darwin-text-bright">ENS Identity</h3>
              </div>
              <p className="font-mono text-sm text-darwin-accent">darwinfi.base.eth</p>
            </div>
          </div>
        </AnimatedSection>

        {/* Tech Stack */}
        <AnimatedSection className="pb-20">
          <h2 className="font-serif text-3xl md:text-4xl font-bold text-darwin-text-bright text-center mb-4">
            Tech Stack
          </h2>
          <p className="text-darwin-text-dim text-center max-w-lg mx-auto mb-12">
            157 source files across 5 layers.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-4xl mx-auto">
            {techStack.map((group) => (
              <div key={group.category} className="darwin-card">
                <h3 className="font-semibold text-darwin-text-bright text-sm mb-3">
                  {group.category}
                </h3>
                <div className="flex flex-wrap gap-2">
                  {group.items.map((item) => (
                    <span
                      key={item}
                      className="text-xs font-mono text-darwin-text-dim bg-darwin-border/30 px-2 py-1 rounded"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </AnimatedSection>

        {/* CTA */}
        <AnimatedSection className="pb-20 md:pb-28">
          <div className="darwin-card text-center py-12 md:py-16 glow-accent">
            <h2 className="font-serif text-3xl md:text-4xl font-bold text-darwin-text-bright mb-4">
              Try it yourself
            </h2>
            <p className="text-darwin-text-dim max-w-md mx-auto mb-8">
              Connect your wallet, explore the vault, watch strategies compete.
              The DApp is live on Base mainnet.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <a
                href={DAPP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="px-10 py-4 bg-darwin-accent text-darwin-bg font-semibold rounded-lg hover:bg-darwin-accent-dim transition-colors text-lg glow-accent"
              >
                Launch DApp
              </a>
              <a
                href="https://github.com/maxwellcm92/darwinfi"
                target="_blank"
                rel="noopener noreferrer"
                className="px-8 py-3 border border-darwin-border text-darwin-text-bright rounded-lg hover:border-darwin-accent/50 hover:text-darwin-accent transition-colors"
              >
                View on GitHub
              </a>
            </div>
          </div>
        </AnimatedSection>
      </div>
    </div>
  );
}
