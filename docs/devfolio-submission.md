# DarwinFi - Devfolio Submission

## Tagline

A self-evolving financial organism that increases profits and win rate, autonomously, forever.

## Description (~300 words)

DarwinFi applies Darwinian natural selection to DeFi trading. 16 AI-powered strategies compete in real-time -- 12 classic bots on Base L2 and 4 Frontier archetypes hunting cross-chain -- the strongest trades live with real capital through an ERC-4626 vault, while the rest paper trade and evolve to dethrone it. Users deposit USDC, receive dvUSDC shares, and earn proportional returns. One vault, one engine, all depositors share pro-rata.

The Golden Rule drives every module: increase profits and win rate. If DarwinFi were left running with no human input, it should continuously get better at turning money into more money.

What makes DarwinFi genuinely autonomous:

**Outcome Attribution** decomposes every trade into entry timing, exit timing, slippage, and market regime scores. The evolution engine knows *why* strategies fail, not just that they failed.

**Signal Calibration** tracks AI confidence accuracy per source and per token. If Ollama says 80% confidence on DEGEN but only wins 50% of the time, DarwinFi automatically treats it as 50%.

**Dynamic Fitness Weights** adapt to market conditions. Volatile markets emphasize Sharpe ratio. Trending markets emphasize PnL. The fitness function itself evolves.

**Self-Evolution Engine** (11 modules, 2,114 LOC) lets DarwinFi modify its own source code through AI-proposed mutations, sandboxed in git worktrees with full test gates and canary deployment. Winning genomes are pinned to IPFS via Storacha for immutable proof of Darwinian evolution.

**Murphy Compute Fabric** routes inference to a self-hosted RTX 3090 via Tailscale (2-3s latency, $0/month), with automatic fallback to Venice API and Claude CLI. Zero-downtime, zero human intervention.

**Adaptive Circuit Breakers** scale thresholds with strategy quality and market volatility. Recovery mode re-enters at 50% position sizing after a trip.

DarwinVaultV3 collects 1% annual management + 5% performance fees (high water mark). Built with Claude Code as the agent harness, Venice AI for evolution, Uniswap V3 for execution, and Lit Protocol for cryptographic trading guardrails.

## Demo Video

**Status:** Pipeline built, ready to execute March 21.

DarwinFi generates its own demo video -- narrated in first person by a British AI voice (ElevenLabs TTS). The video is fully automated: one command runs TTS generation, Playwright screen recording of the live dapp, ImageMagick title cards, and ffmpeg compositing into a final 1080p MP4.

5 scenes (~3 min 10 sec total):
1. **Intro** (~25s) -- DarwinFi introduces itself as a self-evolving organism
2. **The Vault** (~40s) -- USDC deposit flow, dvUSDC shares, ERC-4626
3. **Live Trading** (~50s) -- Real on-chain Uniswap V3 swaps on Base mainnet
4. **Tournament & Evolution** (~50s) -- 16 strategies competing, code self-mutation, IPFS genome pinning
5. **Safety & Outro** (~25s) -- Lit Protocol guardrails, closing statement

Upload: YouTube (unlisted), embed in Devfolio submission.

## Links

- **Live DApp:** https://corduroycloud.com/darwinfi/
- **Vault (BaseScan):** https://basescan.org/address/0x4a55DEEC24C6b5c1aa6301b43b4D9680c10491d7
- **GitHub:** https://github.com/maxwellcm92/darwinfi
- **Basename:** darwinfi.base.eth

## Sponsor Integration: Lit Protocol

**Status:** SDK integrated, PKP minting script ready, awaiting network availability.

Lit Protocol is mid-generation transition: Datil (V0) sunset Feb 25, Naga (V1) sunsets March 25, and Chipotle (V3) launches March 25. DarwinFi's Lit integration (trade-policy guardrails, cryptographic signing via PKPs) is fully built and will self-activate when Chipotle goes live -- no human intervention required. The minting script, Lit Action policy, and vault integration are all staged and waiting.

This is DarwinFi being DarwinFi: it detects an external dependency isn't available yet, queues the integration, and will autonomously complete it when the environment changes. The organism adapts to its ecosystem.

## Roadmap

| Date | Milestone |
|------|-----------|
| March 22 | Hackathon submission (v4 vault live, 16 strategies, self-evolution engine) |
| March 25 | Lit Protocol Chipotle launches -- DarwinFi auto-mints PKP + activates trade guardrails |
| April | First real depositors, tiered vault exploration |
| Q2 2026 | Cross-chain Frontier strategies go live (Arbitrum, Optimism) |

## Track

Agents that Pay

## Technologies

Base, Uniswap V3, ERC-4626 (OpenZeppelin v5), Claude Code, Venice AI, Ollama, Storacha/IPFS, Lit Protocol, ENS/Basenames, React 19, Hardhat, ethers.js v6, Tailscale, ElevenLabs TTS, Playwright, ffmpeg
