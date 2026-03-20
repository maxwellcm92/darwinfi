# DarwinFi - Devfolio Submission

## Tagline

A self-evolving financial organism that increases profits and win rate, autonomously, forever.

## Description (~300 words)

DarwinFi applies Darwinian natural selection to DeFi trading. 12 AI-powered strategies compete in real-time on Base L2 -- the strongest trades live with real capital through an ERC-4626 vault, while the rest paper trade and evolve to dethrone it. Users deposit USDC, receive dvUSDC shares, and earn proportional returns. One vault, one engine, all depositors share pro-rata.

The Golden Rule drives every module: increase profits and win rate. If DarwinFi were left running with no human input, it should continuously get better at turning money into more money.

What makes DarwinFi genuinely autonomous:

**Outcome Attribution** decomposes every trade into entry timing, exit timing, slippage, and market regime scores. The evolution engine knows *why* strategies fail, not just that they failed.

**Signal Calibration** tracks AI confidence accuracy per source and per token. If Ollama says 80% confidence on DEGEN but only wins 50% of the time, DarwinFi automatically treats it as 50%.

**Dynamic Fitness Weights** adapt to market conditions. Volatile markets emphasize Sharpe ratio. Trending markets emphasize PnL. The fitness function itself evolves.

**Self-Evolution Engine** (11 modules, 2,114 LOC) lets DarwinFi modify its own source code through AI-proposed mutations, sandboxed in git worktrees with full test gates and canary deployment. Winning genomes are pinned to IPFS via Storacha for immutable proof of Darwinian evolution.

**Murphy Compute Fabric** routes inference to a self-hosted RTX 3090 via Tailscale (2-3s latency, $0/month), with automatic fallback to Venice API and Claude CLI. Zero-downtime, zero human intervention.

**Adaptive Circuit Breakers** scale thresholds with strategy quality and market volatility. Recovery mode re-enters at 50% position sizing after a trip.

DarwinVaultV3 collects 1% annual management + 5% performance fees (high water mark). Built with Claude Code as the agent harness, Venice AI for evolution, Uniswap V3 for execution, and Lit Protocol for cryptographic trading guardrails.

## Track

Agents that Pay

## Technologies

Base, Uniswap V3, ERC-4626 (OpenZeppelin v5), Claude Code, Venice AI, Ollama, Storacha/IPFS, Lit Protocol, ENS/Basenames, React 19, Hardhat, ethers.js v6, Tailscale
