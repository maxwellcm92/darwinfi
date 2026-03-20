"use client";

import Link from "next/link";
import { AnimatedSection } from "@/components/AnimatedSection";
import { StoryTimeline } from "@/components/StoryTimeline";
import type { SessionData } from "@/components/SessionCard";
import { DAPP_URL } from "@/lib/constants";

const sessions: SessionData[] = [
  {
    number: 1,
    title: "Architecture & Full Scaffold",
    objective:
      "Design and implement the complete DarwinFi system from scratch -- an autonomous, self-evolving crypto trading agent built on Darwinian competition principles.",
    highlights: [
      "12-strategy Darwinian competition model with 3 main strategies x 4 roles",
      "Dual-AI architecture: Claude for evolution, Venice AI for execution",
      "3 Solidity contracts (717 LOC) + full agent core, trading layer, chain layer",
    ],
    details:
      "Built the entire foundation in a single session: DarwinVault, StrategyExecutor, and PerformanceLog contracts. Agent core with darwin-agent orchestrator, strategy-manager lifecycle, evolution-engine for Claude-driven mutation, and venice-engine for real-time signals. Paper and live trading engines, Uniswap V3 client, real-time price feeds, and file-based state persistence with atomic writes.",
    codeImpact: "29 files created, 15,117 lines added (beb1b82)",
    type: "architecture",
  },
  {
    number: 2,
    title: "ERC-4626 Vault & React DApp",
    objective:
      "Transform DarwinFi from a single-operator agent into a multi-user protocol with an ERC-4626 tokenized vault and full React DApp.",
    highlights: [
      "ERC-4626 tokenized vault (DarwinVaultV2) -- deposit USDC, receive dvUSDC shares",
      "Agent borrow/return pattern with high water mark performance fees",
      "Full React DApp: Home, Portfolio, Tournament pages with Wagmi + RainbowKit",
    ],
    details:
      "DarwinVaultV2 (374 lines Solidity) implements ERC-4626 with agent borrow/return tracking, 10% performance fee above high water mark, 10K USDC deposit cap, 1-hour anti-flash-loan lock, and emergency withdrawal. Built 11 React components, 6 hooks, and deployed to Base mainnet at 0xb01aD1140d7acA150BF56D7516Bd44eE64970FE3.",
    codeImpact: "36 files created (1 Solidity, 35 DApp TS/TSX), ~4,900 lines added",
    type: "deployment",
  },
  {
    number: 3,
    title: "Full Test Suite & Audit Sprint",
    objective:
      "Comprehensive audit sprint addressing agentic judge feedback (scores 5.7-6.4/10). Judges flagged: no tests, math bugs, no circuit breakers, sparse docs.",
    highlights: [
      "59 tests across 4 modules: performance, circuit-breaker, strategy-manager, paper-engine",
      "Proving Ground Rule: strategies must profit in paper before going live",
      "Circuit breaker system with 3 independent trip conditions + stale price detection",
    ],
    details:
      "Used 4 parallel Claude Code agents on isolated worktrees. Fixed Sharpe ratio (N-1 denominator), added sigmoid score normalization, built CircuitBreaker class (~400 lines) with per-strategy drawdown, portfolio-wide halt, and consecutive loss tracking. Added ESLint v10 flat config, full README rewrite, and dashboard polish with live event feed.",
    codeImpact: "7 files created, 12 files modified, ~2,900 lines added",
    type: "audit",
  },
  {
    number: 4,
    title: "DApp Frontend & Wallet Integration",
    objective:
      "Wire together the scaffold into a working system. Fix deployment bugs, connect real price feeds, build a proper dashboard with DarwinFi brand identity.",
    highlights: [
      "Dashboard redesign: dark navy + neon cyan/purple, Press Start 2P + JetBrains Mono fonts",
      "Strategy Tournament Leaderboard, Recent Trades Feed, Evolution Timeline",
      "Structured conversation log audit trail for hackathon judge review",
    ],
    details:
      "Fixed deploy script constructor arg ordering and post-deploy wiring. Wired PriceFeed + LiveEngine into the agent main loop. Built conversation-log.ts (239 lines) with typed entries, AI context tracking, and REST API. Expanded dashboard from 154 to 730 lines with retro gaming aesthetic.",
    codeImpact: "9 files modified, 1,444 lines added, 190 lines removed (65d5cbc)",
    type: "architecture",
  },
  {
    number: 5,
    title: "Cost Optimization & Multi-AI Pipeline",
    objective:
      "Redesign the signal pipeline to reduce costs from ~$65-75/2wk to ~$2-5/2wk. The original architecture required 28K paid API calls/day.",
    highlights: [
      "Three-tier loop: 30s rule-based (free), 2min Claude CLI (free), 4h Venice evolution (~$0.30/day)",
      "Claude CLI as signal engine via ClaudeCliEngine (Haiku batch eval)",
      "Venice API for evolution only -- sponsor showcase at minimal cost",
    ],
    details:
      "Split the monolithic 30s main loop into three cost tiers. Created ClaudeCliEngine spawning claude -p for free signal evaluation. Swapped evolution from Anthropic SDK to Venice API (llama-3.3-70b). Removed Anthropic API key dependency entirely. Also fixed dashboard routing (absolute vs relative paths), named all 12 bots (Apex, Viper, Blitz + Mutant, Tuner, Hybrid variants), and lowered trade threshold from 50 to 15.",
    codeImpact: "6 files modified, 1 file created. Cost: $65-75/2wk -> $2-5/2wk",
    type: "fix",
  },
  {
    number: 6,
    title: "IPFS, Filecoin & Sponsor Integrations",
    objective:
      "Wire Filecoin/IPFS genome pinning into the evolution loop and audit all sponsor integrations for genuine value.",
    highlights: [
      "IPFS genome pinning: CID recorded on-chain via PerformanceLog contract",
      "Sponsor audit: 6 genuine integrations, 2 skipped as architectural mismatches",
      "Verifiable evolution: genome JSON on IPFS -> keccak256 hash -> on-chain match",
    ],
    details:
      "Evaluated 8 sponsor integrations. Built: Base (core chain), Uniswap V3 (DEX), Venice AI (evolution), Filecoin/IPFS (genome pinning), Lido/wstETH (yield token), ENS/Basenames (darwinfi.base.eth identity). Skipped Olas (FSM mismatch) and Lit Protocol (over-engineering at $75 scale). Also wired on-chain performance logging with strategy ID mapping and non-fatal .catch() guards.",
    codeImpact: "4 files modified, ~200 lines added. ContractClient ABI fully rewritten",
    type: "deployment",
  },
  {
    number: 7,
    title: "Brutal Audit Sprint",
    objective:
      "Diagnose and fix why zero trades executed after 1,401 loop iterations. Complete bootstrap deadlock: no prices, no indicators, no volume.",
    highlights: [
      "Root cause: RPC 503 -> no snapshots -> empty AI data -> zero buy signals -> no trades",
      "Built technical indicators engine: RSI-14, MACD, Bollinger Bands, EMA-9/21",
      "Added 4 high-volatility tokens (DEGEN, BRETT, VIRTUAL, HIGHER) + rule-based entry bypass",
    ],
    details:
      "Six fixes in Sprint 1: RPC fallback chain (3 endpoints with auto-rotation), technical indicators engine (210 lines), DexScreener volume integration, signal prompt scoring rubric, token universe expansion from 5 to 9, and rule-based entry bypass that breaks the AI-gated Catch-22. Sprint 2 added evolution acceleration (4h -> 1h during qualification).",
    codeImpact: "7 files modified, 1 file created (indicators.ts), ~400 lines added",
    type: "audit",
  },
  {
    number: 8,
    title: "DApp UI/UX Overhaul",
    objective:
      "Build the Instinct prediction system -- a biological nervous system for DarwinFi with five departments that collect intelligence and generate directional predictions.",
    highlights: [
      "5-department biological model: Senses, Reflexes, Cortex, Nerves, Marrow",
      "Adaptive evolution with 3 triggers: timer, emergency (accuracy < 30%), weight shift (> 20%)",
      "Venice AI for Grok/X sentiment scraping, source fitness scoring",
    ],
    details:
      "Built ~5,200 lines across 23 files. Senses collect from Grok/X, RSS feeds, and on-chain events. Reflexes generate predictions at 4 timeframes (1m, 5m, 15m, 1h). Cortex runs Bayesian-inspired weight optimization every 24h. Nerves publish predictions-live.json every 30s. Marrow detects recurring signal patterns. Adaptive evolution speeds up when accuracy drops, slows when stable.",
    codeImpact: "23 files created, ~5,200 lines added. PM2 process: darwinfi-instinct",
    type: "architecture",
  },
  {
    number: 9,
    title: "Live Deployment & Battle Testing",
    objective:
      "Fund the wallet, deploy smart contracts to Base mainnet, and build the autonomous Immune System for self-monitoring and self-healing.",
    highlights: [
      "3 contracts deployed to Base mainnet, vault funded with 73 USDC",
      "7-division Immune System: Patrol, Antibodies, Thymus, Platelets, Membrane, Lymph, Genome",
      "Self-healing engine with fix-then-verify pattern and 12h self-evolution",
    ],
    details:
      "Deployed PerformanceLog, DarwinVault, and StrategyExecutor to Base. Built the Immune System (~4,400 lines, 31 files) as a separate PM2 process. Patrol monitors health every 30s-5min. Antibodies verify math and state invariants. Thymus scans for security vulnerabilities. Platelets auto-fix detected issues. Membrane checks boundary truth. Lymph handles logging/alerts. Genome evolves its own thresholds every 12h.",
    codeImpact: "31 files created, ~4,400 lines added. PM2 process: darwinfi-immune",
    type: "deployment",
  },
  {
    number: 10,
    title: "Frontier, Championship & Final Audit",
    objective:
      "Build Team 4: four entirely new bot archetypes that hunt across multiple EVM chains, filling distinct ecological niches inspired by biological evolution.",
    highlights: [
      "4 frontier archetypes: Abiogenesis (moonshots), Mitosis (HFT), Cambrian (volatility), Symbiont (whale following)",
      "Multi-chain: ChainRegistry for Base, Arbitrum, Optimism with 1inch aggregation",
      "Cross-team championship: Team 4 winner competes against Teams 1-3 champion",
    ],
    details:
      "Built the Frontier system (~7,200 lines, 33 files) with chain layer (ChainRegistry, EVM client), trading layer (1inch aggregator, cross-chain engine, bridge client), and 5 frontier modules (token discovery, rug detector, spread scanner, vol scanner, whale tracker). Agent runs 3 tick speeds (8s, 30s, 4h). Full test suite with 99 tests across 10 files. DApp Frontier page with tabbed sections, bot cards, championship standings, and WebGL DNA helix hero.",
    codeImpact: "33 files created, 10 test files, ~7,200 lines added. 99 new tests",
    type: "audit",
  },
  {
    number: 11,
    title: "Instinct System",
    objective:
      "Build a 5-department biological prediction layer that gives DarwinFi market intuition across multiple intelligence sources.",
    highlights: [
      "5 departments: Senses, Reflexes, Cortex, Nerves, Marrow",
      "Multi-timeframe predictions (1m, 5m, 15m, 1h)",
      "Adaptive evolution with emergency triggers on accuracy drops",
    ],
    details:
      "Senses collect intelligence from Grok/X sentiment, RSS feeds, and on-chain events. Reflexes generate directional predictions at 4 timeframes. Cortex runs Bayesian weight optimization every 24h. Nerves publish predictions-live.json every 30s. Marrow detects recurring signal patterns. Adaptive evolution speeds up when accuracy drops below 30%.",
    codeImpact: "23 files created, ~5,200 lines added. PM2 process: darwinfi-instinct",
    type: "architecture",
  },
  {
    number: 12,
    title: "Instinct Dashboard UI & Evolution Tuning",
    objective:
      "Build the DApp Instinct page and tune evolution parameters for faster adaptation.",
    highlights: [
      "Instinct dashboard with live prediction feeds",
      "Source fitness scoring visible per department",
      "Evolution cycle acceleration (4h -> 1h during qualification)",
    ],
    details:
      "Added the Instinct tab to the DApp showing real-time predictions, source fitness scores, and department health. Tuned evolution parameters so cycles accelerate during low-accuracy periods. Built confidence visualization with color-coded directional indicators.",
    codeImpact: "UI components + evolution parameter tuning",
    type: "architecture",
  },
  {
    number: 13,
    title: "Immune System",
    objective:
      "Build a 7-division autonomous monitoring and self-healing system inspired by biological immunity.",
    highlights: [
      "7 divisions: Patrol, Antibodies, Thymus, Platelets, Membrane, Lymph, Genome",
      "Self-healing with fix-then-verify pattern",
      "12h self-evolution cycle for threshold tuning",
    ],
    details:
      "Patrol monitors health every 30s-5min. Antibodies verify math and state invariants. Thymus scans for security vulnerabilities. Platelets auto-fix detected issues. Membrane checks boundary truth against external sources. Lymph handles logging and alerts. Genome evolves its own detection thresholds every 12h.",
    codeImpact: "31 files created, ~4,400 lines added. PM2 process: darwinfi-immune",
    type: "deployment",
  },
  {
    number: 14,
    title: "Frontier System",
    objective:
      "Deploy four new bot archetypes that hunt across Base, Arbitrum, and Optimism -- each filling a distinct ecological niche.",
    highlights: [
      "4 archetypes: Abiogenesis, Mitosis, Cambrian, Symbiont",
      "ChainRegistry for multi-chain with 1inch aggregation",
      "Cross-team championship bracket",
    ],
    details:
      "Built the Frontier system with chain layer (ChainRegistry, EVM client), trading layer (1inch aggregator, cross-chain engine, bridge client), and 5 frontier modules (token discovery, rug detector, spread scanner, vol scanner, whale tracker). Agent runs 3 tick speeds (8s, 30s, 4h). Full test suite with 99 tests across 10 files.",
    codeImpact: "33 files created, 10 test files, ~7,200 lines added",
    type: "architecture",
  },
  {
    number: 15,
    title: "DApp Deployment",
    objective:
      "Deploy the React SPA to production with VaultV2 integration, wallet connect, and live data feeds.",
    highlights: [
      "React SPA deployed at corduroycloud.com/darwinfi/",
      "VaultV2 (ERC-4626) integration with deposit/withdraw",
      "RainbowKit wallet connect + Base chain",
    ],
    details:
      "Deployed the full DApp as a React SPA served via Express on port 3502 with Caddy reverse proxy stripping the /darwinfi prefix. Integrated VaultV2 contract at 0xb01aD1140d7acA150BF56D7516Bd44eE64970FE3 with wagmi hooks for deposit, withdraw, share price, and TVL. RainbowKit provides wallet connection with Base chain support.",
    codeImpact: "DApp deployed, Express server configured, Caddy routes added",
    type: "deployment",
  },
  {
    number: 16,
    title: "VaultV3 Contract & Evolution Enhancements",
    objective:
      "Build the next-generation vault contract with management and performance fees, plus evolution engine upgrades.",
    highlights: [
      "VaultV3: 1% management fee + 5% performance fee (high water mark)",
      "51 contract tests passing",
      "Deploy script ready for mainnet launch",
    ],
    details:
      "Developed DarwinVaultV3 extending ERC-4626 with a dual-fee model: 1% annual management fee accrued per-block and 5% performance fee above a high water mark. Includes fee recipient configuration, fee claim functions, and admin controls. Full test suite with 51 tests covering fee math, edge cases, and access control.",
    codeImpact: "VaultV3 contract + deploy script + 51 tests",
    type: "audit",
  },
  {
    number: 17,
    title: "Self-Evolution Engine & Frontier Freedom",
    objective:
      "Build the self-evolution engine that lets DarwinFi mutate its own source code, plus expand Frontier bot autonomy.",
    highlights: [
      "Venice AI code generation with git worktree sandboxing",
      "Canary deploy with auto-rollback on degradation",
      "18 smoke tests gate every mutation",
    ],
    details:
      "Built src/evolution/ with Venice AI (Llama 3.3 70B) generating code mutations. Each candidate is tested in an isolated git worktree sandbox. Mutations that pass 18 smoke tests get canary-deployed alongside the live system. If the canary degrades performance metrics, the system auto-rolls back. Also expanded Frontier bot autonomy with independent decision cycles.",
    codeImpact: "Evolution engine + 18 smoke tests + canary deploy system",
    type: "architecture",
  },
  {
    number: 18,
    title: "AI Router & Autonomy Gap Closures",
    objective:
      "Build a cascading AI router with local Ollama fallback and close critical autonomy gaps identified in the March 20 audit.",
    highlights: [
      "AI Router: Claude -> Ollama/Gemma2 -> rule-based fallback chain",
      "Ollama engine for $0 local AI inference",
      "Autonomy audit: 40% -> closing 6 critical gaps",
    ],
    details:
      "Built a three-tier AI routing system: primary Claude API, fallback to local Ollama/Gemma2 running on RTX 3090 via Tailscale ($0 cost), and final deterministic rule-based fallback. This ensures DarwinFi always has a working AI brain even when external APIs fail. Addressed 6 critical autonomy gaps: no real-time strategy switching, disconnected evolution engines, no outcome attribution, static fitness weights, disconnected predictions, and rigid circuit breakers.",
    codeImpact: "AI router + Ollama engine + autonomy gap fixes across multiple modules",
    type: "fix",
  },
];

export default function StoryPage() {
  return (
    <div>
      {/* Hero */}
      <div className="relative overflow-hidden py-20 md:py-32">
        <div className="absolute inset-0 bg-gradient-to-b from-[#8040DD]/10 via-transparent to-transparent" />
        <div className="max-w-4xl mx-auto px-6 text-center relative z-10">
          <AnimatedSection>
            <p className="section-header text-darwin-accent mb-4">Development Log</p>
            <h1 className="font-serif text-4xl md:text-6xl font-black text-darwin-text-bright mb-6 leading-tight">
              The Build Story
            </h1>
            <p className="text-darwin-text text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
              18 sessions. 106 source files. 27,000 lines of code. 325 tests.
              Built across March 13-20, 2026 with Claude Code as the agent harness.
            </p>
            <div className="flex flex-wrap justify-center gap-6 text-center">
              {[
                { value: "18", label: "Sessions" },
                { value: "106", label: "Files" },
                { value: "27k", label: "Lines" },
                { value: "325", label: "Tests" },
              ].map((stat) => (
                <div key={stat.label}>
                  <p className="text-2xl md:text-3xl font-bold text-darwin-accent font-mono">
                    {stat.value}
                  </p>
                  <p className="text-xs text-darwin-text-dim font-mono uppercase tracking-wider">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
          </AnimatedSection>
        </div>
      </div>

      {/* Legend */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-12">
        <AnimatedSection>
          <div className="flex flex-wrap justify-center gap-4 md:gap-8">
            {[
              { color: "bg-[#8040DD]", label: "Architecture" },
              { color: "bg-[#00F0C0]", label: "Deployment" },
              { color: "bg-[#E4C64B]", label: "Audit" },
              { color: "bg-[#FFB020]", label: "Optimization" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${item.color}`} />
                <span className="text-sm text-darwin-text-dim font-mono">{item.label}</span>
              </div>
            ))}
          </div>
        </AnimatedSection>
      </div>

      {/* Timeline */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <StoryTimeline sessions={sessions} />
      </div>

      {/* What's Next */}
      <div className="max-w-4xl mx-auto px-6 pb-20 md:pb-28">
        <AnimatedSection>
          <div className="darwin-card text-center py-12 md:py-16 glow-purple">
            <h2 className="font-serif text-3xl md:text-4xl font-bold text-darwin-text-bright mb-4">
              What Comes Next
            </h2>
            <p className="text-darwin-text-dim max-w-lg mx-auto mb-8 leading-relaxed">
              The Frontier bots are hunting across chains. The Immune System is self-healing.
              The vault is open. DarwinFi is a living financial organism -- and it never stops evolving.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <a
                href={DAPP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="px-8 py-3 bg-darwin-accent text-darwin-bg font-semibold rounded-lg hover:bg-darwin-accent-dim transition-colors glow-accent"
              >
                Launch DApp
              </a>
              <Link
                href="/product"
                className="px-8 py-3 border border-darwin-border text-darwin-text-bright rounded-lg hover:border-darwin-purple/50 hover:text-darwin-purple transition-colors"
              >
                See the Product
              </Link>
            </div>
          </div>
        </AnimatedSection>
      </div>
    </div>
  );
}
