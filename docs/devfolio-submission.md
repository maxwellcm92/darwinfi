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

**Venice AI** powers DarwinFi's evolution with uncensored trading signals, private inference, and strategy mutations. No content filtering means raw market analysis -- bullish, bearish, or contrarian -- without sanitization. Strategy evolution runs through Venice's private inference so trading logic never leaks.

DarwinVaultV4 collects 1% annual management + 5% performance fees (high water mark), with 6 security hardening features over V3 including 48h timelocks on agent/feeRecipient changes and proportional emergency withdrawals. Built with Claude Code as the agent harness, Venice AI for evolution, Uniswap V3 for execution, and Lit Protocol for cryptographic trading guardrails.

## Demo Video

**Status:** Pipeline built and ready. ElevenLabs API key available for TTS generation.

DarwinFi generates its own demo video -- narrated in first person by a British AI voice (ElevenLabs TTS). The video is fully automated: one command runs TTS generation, Playwright screen recording of the live dapp, ImageMagick title cards, and ffmpeg compositing into a final 1080p MP4.

5 scenes (~3 min 10 sec total):
1. **Intro** (~25s) -- DarwinFi introduces itself as a self-evolving organism
2. **The Vault** (~40s) -- USDC deposit flow, dvUSDC shares, ERC-4626
3. **Live Trading** (~50s) -- Real on-chain Uniswap V3 swaps on Base mainnet
4. **Tournament & Evolution** (~50s) -- 16 strategies competing, code self-mutation, IPFS genome pinning
5. **Safety & Outro** (~25s) -- Lit Protocol guardrails, closing statement

Upload: YouTube (unlisted), embed in Devfolio submission.

**Pending for Chat D:** On-chain trade footage requires USDC deposit to deployer wallet. Placeholder scenes ready for swap once trades execute.

## Links

- **Live DApp:** https://corduroycloud.com/darwinfi/
- **Vault V4 (BaseScan):** https://basescan.org/address/0x4a55DEEC24C6b5c1aa6301b43b4D9680c10491d7
- **PerformanceLog (BaseScan):** https://basescan.org/address/0x7d7433A4aD04D6AD85E82Ce43CC4535ADb2fc9c9
- **GitHub:** https://github.com/maxwellcm92/darwinfi
- **Basename:** darwinfi.base.eth
- **Deployer/Agent:** [`0xb2db53Db9a2349186F0214BC3e1bF08a195570e3`](https://basescan.org/address/0xb2db53Db9a2349186F0214BC3e1bF08a195570e3)

## Sponsor Integration: Lit Protocol

**Status:** SDK integrated, PKP minting script ready, awaiting network availability.

Lit Protocol is mid-generation transition: Datil (V0) sunset Feb 25, Naga (V1) sunsets March 25, and Chipotle (V3) launches March 25. DarwinFi's Lit integration (trade-policy guardrails, cryptographic signing via PKPs) is fully built and will self-activate when Chipotle goes live -- no human intervention required. The minting script, Lit Action policy, and vault integration are all staged and waiting.

This is DarwinFi being DarwinFi: it detects an external dependency isn't available yet, queues the integration, and will autonomously complete it when the environment changes. The organism adapts to its ecosystem.

## Roadmap

| Date | Milestone |
|------|-----------|
| March 22 | Hackathon submission (V4 vault live, 16 strategies, self-evolution engine) |
| March 25 | Lit Protocol Chipotle launches -- DarwinFi auto-mints PKP + activates trade guardrails |
| April | First real depositors, tiered vault exploration |
| Q2 2026 | Cross-chain Frontier strategies go live (Arbitrum, Optimism) |

## Track

**Primary:** Autonomous Trading Agent (Base)

**All qualifying tracks (8 total):**

| # | Track | Fit |
|---|-------|-----|
| 1 | Autonomous Trading Agent (Base) | Primary track -- V4 vault deployed on Base mainnet, all trading on Base L2 |
| 2 | Synthesis Open Track | Auto-eligible, $28k prize pool |
| 3 | Private Agents, Trusted Actions (Venice) | Venice AI powers uncensored evolution engine + private strategy inference |
| 4 | Let the Agent Cook -- No Humans Required (Protocol Labs) | Self-evolution engine runs autonomously, genome pinning to IPFS via Storacha |
| 5 | Agentic Finance / Best Uniswap API Integration (Uniswap) | All swaps execute through Uniswap V3 SwapRouter + Quoter V2 |
| 6 | Best Use Case with Agentic Storage (Filecoin) | Genome pinning to IPFS via Storacha for immutable evolution audit trail |
| 7 | ENS Identity (ENS) | darwinfi.base.eth registered on Base, owned by deployer wallet |
| 8 | ENS Open Integration (ENS) | ENS name displayed in DApp, on-chain identity for agent |

## On-Chain Artifacts (Base Mainnet)

| Contract | Address | Status |
|----------|---------|--------|
| DarwinVaultV4 (ERC-4626) | `0x4a55DEEC24C6b5c1aa6301b43b4D9680c10491d7` | Live (active) |
| PerformanceLog | `0x7d7433A4aD04D6AD85E82Ce43CC4535ADb2fc9c9` | Live |
| DarwinVaultV3 (ERC-4626) | `0x2a01CDf9D2145a8b23cDf7E8DB65273259E17FcF` | Superseded by V4 |
| DarwinVaultV2 (ERC-4626) | `0xb01aD1140d7acA150BF56D7516Bd44eE64970FE3` | Superseded by V3 |
| StrategyExecutor | Deployed | Live |
| Deployer/Agent | `0xb2db53Db9a2349186F0214BC3e1bF08a195570e3` | Active |

## DApp Features (Current)

- Mobile-responsive navbar with pill-style navigation
- "Unaudited" banner -- honest about hackathon-stage security
- ENS name display (darwinfi.base.eth) for agent identity
- Corrected FAQ fees (1% mgmt + 5% perf, matching V4 contract)
- Dashboard with vault stats, tournament leaderboard, trade history
- Deposit/withdraw flow with ERC-4626 share accounting
- Dark theme with retro-biological aesthetic

## V4 Security Hardening (6 Audit Fixes Over V3)

1. **12-decimal shares** -- 6 USDC decimals + 6 offset, prevents share price rounding attacks
2. **48h timelock on agent/feeRecipient changes** -- governance cannot instantly swap agent or redirect fees
3. **Proportional emergency withdraw** -- users get fair share even when agent has borrowed funds
4. **80% max borrow ratio** -- vault always retains 20% liquidity for withdrawals
5. **7-day borrow timeout** with bad debt write-off -- prevents infinite capital lockup
6. **7-day lock time cap** -- prevents governance from trapping depositor funds indefinitely

## Testing

- **V4 vault tests:** 80 passing (covers all 6 security features + full vault math)
- **Total test suite:** 428 passing across 27+ modules
- **Contracts + agent + evolution + immune + instinct + frontier** all covered

## Venice AI Narrative

Venice AI is not just a fallback -- it is DarwinFi's uncensored evolution brain:

- **Uncensored trading signals:** No content filtering means raw market analysis. Bearish calls, contrarian bets, high-risk micro-cap assessments -- Venice delivers what sanitized models won't.
- **Strategy evolution:** Three AI personas (Mutant, Tuner, Hybrid) powered by Llama 3.3 70B propose code mutations. Venice's private inference means strategy logic never leaks to competitors.
- **Private inference:** Trading strategies are intellectual property. Venice's privacy guarantees ensure DarwinFi's evolved parameters stay confidential.

## Current Status (March 21, 2026)

**Completed:**
- V4 vault deployed and verified on Base mainnet
- PerformanceLog deployed at `0x7d7433A4aD04D6AD85E82Ce43CC4535ADb2fc9c9`
- darwinfi.base.eth registered on Base (owned by deployer)
- DApp live at corduroycloud.com/darwinfi/ with V4 integration
- 428 tests passing across all modules
- Demo video pipeline built (TTS + Playwright + ffmpeg)
- ElevenLabs API key available for voice generation
- Showcase site live at darwinfi.corduroycloud.com

**Pending (Chat D):**
- USDC deposit to deployer wallet for live on-chain trades
- Execute real trades through V4 vault (trade hashes TBD)
- Record demo video with live trade footage
- Devfolio submission form + YouTube upload

**Blockers:**
- USDC in deployer wallet (required for live trading + demo footage)
- Storacha billing (genome pinning blocked until billing resolved)
- Lit Protocol Chipotle launch (March 25 -- after hackathon deadline)

## Technologies

Base, Uniswap V3, ERC-4626 (OpenZeppelin v5), Claude Code, Venice AI, Ollama, Storacha/IPFS, Lit Protocol, ENS/Basenames, React 19, Hardhat, ethers.js v6, Tailscale, ElevenLabs TTS, Playwright, ffmpeg
