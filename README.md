![Coverage](https://img.shields.io/badge/Coverage-70%25-yellow)

# DarwinFi

**A self-evolving financial organism that increases profits and win rate, autonomously, forever.**

DarwinFi is an autonomous DeFi trading agent that applies Darwinian natural selection to trading strategies. A dynamic population of strategies competes in real-time on Base L2 -- the strongest trades live with real capital, the rest paper trade and evolve to dethrone it. The population grows and shrinks as the engine mutates winners and eliminates the weak. Users deposit USDC into an ERC-4626 vault and earn proportional returns.

The Golden Rule: every module, every parameter, every decision exists to serve one objective -- **increase profits and win rate**. If DarwinFi were left running with no human input, it should continuously get better at turning money into more money.

Built for the [Synthesis Hackathon](https://synthesis.md/) -- competing across 8 tracks including Autonomous Trading Agent (Base), Private Agents (Venice), Let the Agent Cook (Protocol Labs), and more.

**Live Dashboard**: [https://corduroycloud.com/darwinfi/](https://corduroycloud.com/darwinfi/)

---

## The Golden Rule Architecture

DarwinFi is not just a trading bot. It is a closed-loop optimization system where the only constant is the objective function (increase profits, increase win rate) and everything else is a variable that gets optimized through Darwinian selection.

### What Makes DarwinFi Different

1. **Darwinian Tournament**: A dynamic population of strategies competes. Winners trade live. Losers evolve or die. No manual parameter tuning -- the population self-optimizes.
2. **Outcome Attribution**: After every trade, DarwinFi decomposes the result into entry timing, exit timing, slippage, and market regime. This feedback loop tells the evolution engine *why* a strategy fails, not just *that* it failed.
3. **Self-Calibrating Signals**: AI confidence scores are continuously validated against actual outcomes. If Ollama says 80% confidence on DEGEN but only wins 50% of the time, DarwinFi automatically treats it as 50%.
4. **Adaptive Safety**: Circuit breaker thresholds scale with strategy quality (Sharpe ratio) and market volatility. A proven strategy gets more leeway. An unproven one gets less.
5. **Dynamic Fitness Function**: The weights in the composite fitness score adapt to market regime. Volatile markets emphasize Sharpe. Trending markets emphasize PnL. Ranging markets emphasize win rate.
6. **Distributed Compute (MCF)**: Murphy Compute Fabric routes AI inference to a GPU node (RTX 3090) via Tailscale for 2-3s signal latency, with automatic fallback to Venice API and Claude CLI.
7. **ERC-4626 Vault**: Single-pool Yearn-style vault with 1% annual management fee + 5% performance fee (high water mark). DarwinFi decides when to tier.

---

## System Architecture

```
                      Users (MetaMask / WalletConnect)
                                   |
                              React DApp
                         (wagmi + RainbowKit)
                                   |
                      +-------- Base L2 --------+
                      |                         |
               DarwinVaultV4              Uniswap V3
                (ERC-4626)               SwapRouter
             1% mgmt + 5% perf           Quoter V2
                      |                         |
                +-----+---------+               |
                |               |               |
           agentBorrow    agentReturn           |
                |               |               |
                +-------+-------+               |
                        |                       |
                  Darwin Agent  <-----> AI Router
                 (Orchestrator)     Ollama|Venice|Claude
                        |
           +------------+------------+
           |            |            |
      Strategy 1   Strategy 2   Strategy 3   Team 4: Frontier
      (+ 3 vars)   (+ 3 vars)   (+ 3 vars)   (4 archetypes)
           |            |            |
      Live/Paper    Paper Only   Paper Only
                        |
           +--------- Feedback Loops ---------+
           |            |            |         |
      Attribution  Calibration  Dynamic     Real-Time
       (per trade)  (per signal) Fitness    Strategy
       Entry/Exit/  Confidence  Weights    Switching
       Slippage/    Auto-Adjust (Regime-   (Emergency
       Regime                   Aware)     Promote)
```

### Self-Evolution Engine

The code evolution engine (11 modules, 2,114 LOC) gives DarwinFi the ability to modify its own source code:

1. **Zone Selection**: Identifies which module to mutate (anti-loop memory prevents repeated failures)
2. **AI Proposal**: Venice AI (Llama 3.3 70B) generates code mutations
3. **Static Validation**: Ring checks prevent mutations to critical infrastructure
4. **Sandbox**: Git worktree isolation + TypeScript compilation
5. **Test Gate**: All 488 tests must pass
6. **Canary Deploy**: 4-hour minimum monitoring with 60-second health checks
7. **Promote or Rollback**: If canary degrades performance, automatic git rollback

Every evolution cycle is logged to an append-only JSONL audit trail, with winning genomes pinned to IPFS via Storacha (now active via CLI) for immutable proof of Darwinian evolution.

---

## Murphy Compute Fabric (MCF)

DarwinFi's inference runs on a distributed compute mesh via Tailscale:

| Node | Hardware | Role | Latency |
|------|----------|------|---------|
| KS (Primary) | RTX 3090 | Ollama gemma2:9b | 2-3s |
| Venice API (Fallback) | Cloud GPU | Llama 3.3 70B | 5-10s |
| Claude CLI (Last Resort) | Anthropic | Haiku 4.5 | 10-60s |

The AI Router health-checks KS every 60s. If KS goes down, traffic automatically falls back to Venice, then Claude CLI. When KS recovers, traffic routes back to local GPU -- zero downtime, zero human intervention.

**Cost at hackathon scale**: $0/month (KS is self-hosted). Scales to RunPod/cloud when AUM grows.

---

## Feedback Loops (The 6 Autonomy Gaps, Closed)

| System | What It Does | Why It Matters |
|--------|-------------|----------------|
| **Outcome Attribution** | Decomposes every trade into entry/exit/slippage/regime scores | Evolution knows *why* strategies fail, not just that they fail |
| **Signal Calibration** | Tracks per-source, per-token AI confidence accuracy | Overconfident AI signals get automatically downweighted |
| **Dynamic Fitness** | Adapts scoring weights to market regime (trending/ranging/volatile) | The fitness function itself evolves with market conditions |
| **Real-Time Switching** | Continuous monitoring, auto-promote paper strategy on sustained outperformance | No more waiting 6 hours while the live strategy bleeds |
| **Adaptive Circuit Breakers** | Thresholds scale with strategy Sharpe and market volatility | High-quality strategies get room to breathe, low-quality ones get tight leashes |
| **Recovery Mode** | After circuit breaker trip, resume at 50% position sizing | Gradual re-entry prevents cascading losses |

---

## Smart Contracts

### DarwinVaultV4 (ERC-4626, Security Hardened)

Single-pool Yearn-style vault. One vault, one engine, all depositors share returns pro-rata. V4 adds 7 security hardening features over V3: 12-decimal shares (6 USDC + 6 offset), 48h fee timelocks on agent/feeRecipient changes, proportional emergency withdraw, emergencyWithdraw rounding guard (reverts `WithdrawalTooSmall` when sharesToBurn rounds to 0), 80% max borrow ratio, 7-day borrow timeout with bad debt write-off, and 7-day lock time cap.

| Function | Who | What |
|----------|-----|------|
| `deposit(assets, receiver)` | Any user | Deposit USDC, receive dvUSDC shares |
| `withdraw(assets, receiver, owner)` | Any user | Redeem shares for USDC |
| `agentBorrow(amount)` | Agent only | Pull USDC for trading (max 80% of vault) |
| `agentReturn(amount)` | Agent only | Return proceeds (fees auto-collected) |
| `emergencyWithdraw()` | Any user | Proportional withdraw, always works even when paused |
| `proposeAgent(newAgent)` | Owner only | 48h timelock before agent change takes effect |

**Fees**: 1% annual management (100 bps, auto-collected via share dilution) + 5% performance (high water mark).

### 96 Tests (V4) + 51 Tests (V3) = 147 Vault Tests

Full coverage of vault math, fee calculations, multi-user deposits, agent borrow/return, HWM tracking, pause/emergency, access control, timelock transitions, proportional emergency withdraw, emergencyWithdraw rounding guard (WithdrawalTooSmall), max borrow ratio, borrow timeout, bad debt write-off.

---

## Token Universe (Base L2)

| Token | Category | Volatility |
|-------|----------|-----------|
| ETH/WETH | Core | Medium |
| wstETH | Yield-bearing | Low |
| UNI | DeFi blue-chip | Medium |
| AERO | Base DEX | Medium-High |
| DEGEN | Culture | High |
| BRETT | Culture | High |
| VIRTUAL | AI | High |
| HIGHER | Culture | High |

---

## Vault Economics

| AUM | Mgmt Fee/yr | Perf Fee (20% return) | Total Revenue | Compute Cost | Net |
|-----|-----------|---------------------|---------------|-------------|-----|
| $10k | $100 | $100 | $200/yr | $0 (KS) | $200 |
| $50k | $500 | $500 | $1,000/yr | $0 (KS) | $1,000 |
| $100k | $1,000 | $1,000 | $2,000/yr | $500 (RunPod) | $1,500 |
| $500k | $5,000 | $5,000 | $10,000/yr | $1,000 (H100) | $9,000 |

---

## Testing

488 tests across 27+ modules:

```bash
npm test
```

| Module | Tests | Coverage |
|--------|-------|----------|
| DarwinVaultV4 | 96 | V3 coverage + timelock, proportional emergency, max borrow, borrow timeout, rounding guard |
| DarwinVaultV3 | 51 | Deposit/withdraw, fees, HWM, multi-user, agent flow, emergency |
| DarwinAgent | 18 | Config, initialization, entries/exits, evolution triggers, paper/live, persistence |
| Evolution Smoke | 18 | Config, validation, sandbox, test gate, canary, audit |
| Frontier | 46 | Archetype strategies, chain registry, niche selection |
| Circuit Breakers | 32 | Adaptive thresholds, recovery mode, strategy quality scaling |
| Instinct (Predictions) | 28 | 5-department signals, consensus, timing |
| Immune System | 24 | Self-healing, division coordination, threat detection |
| AI Router | 22 | Health-check failover, provider routing, latency tracking |
| Attribution | 18 | 4-factor decomposition, per-token profiles, evolution context |
| Signal Calibration | 16 | Per-source accuracy, confidence adjustment, clamping |
| Dynamic Fitness | 14 | Regime detection, weight adaptation, scoring |
| Strategy Switching | 12 | Continuous monitoring, emergency promote, sell-only mode |
| Candle Service | 11 | Price feeds, OHLCV aggregation, multi-token |
| Other modules | 38 | Integration, e2e, utilities |

---

## Getting Started (Users)

New to DarwinFi? See the [Getting Started Guide](docs/getting-started.md) for a step-by-step walkthrough:
1. Connect your wallet to the [live DApp](https://corduroycloud.com/darwinfi/)
2. Deposit USDC into the vault
3. Monitor your position as AI strategies trade
4. Withdraw anytime

## Setup (Developers)

```bash
git clone https://github.com/maxwellcm92/darwinfi.git
cd darwinfi && npm install
cd dapp && npm install && cd ..
cp .env.example .env
# Configure: PRIVATE_KEY, VENICE_API_KEY, BASE_RPC_URL
npx hardhat compile && npm run build
cd dapp && npm run build && cd ..
npm start
```

---

## Documentation

- [Competitor Analysis](docs/competitor-analysis.md) -- How DarwinFi compares to Yearn, dHEDGE, Enzyme, and others
- [Coverage Report](docs/coverage-report.md) -- Solidity test coverage breakdown
- [Devfolio Submission](docs/devfolio-submission.md) -- Full hackathon submission details
- [Development Log](docs/development-log.md) -- Build diary
- [Evolution Proof](docs/evolution-proof.md) -- 5 real autonomous evolution cycles documented
- [Getting Started](docs/getting-started.md) -- User guide for depositing and withdrawing
- [Trade Proof](docs/trade-proof.md) -- On-chain transaction verification

---

## On-Chain Artifacts (Base Mainnet)

| Contract | Address | Status |
|----------|---------|--------|
| DarwinVaultV4 (ERC-4626) | [`0x4a55DEEC24C6b5c1aa6301b43b4D9680c10491d7`](https://basescan.org/address/0x4a55DEEC24C6b5c1aa6301b43b4D9680c10491d7) | Live |
| DarwinVaultV3 (ERC-4626) | [`0x2a01CDf9D2145a8b23cDf7E8DB65273259E17FcF`](https://basescan.org/address/0x2a01CDf9D2145a8b23cDf7E8DB65273259E17FcF) | Superseded |
| DarwinVaultV2 (ERC-4626) | [`0xb01aD1140d7acA150BF56D7516Bd44eE64970FE3`](https://basescan.org/address/0xb01aD1140d7acA150BF56D7516Bd44eE64970FE3) | Superseded |
| StrategyExecutor | Deployed | Live |
| PerformanceLog | [`0x7d7433A4aD04D6AD85E82Ce43CC4535ADb2fc9c9`](https://basescan.org/address/0x7d7433A4aD04D6AD85E82Ce43CC4535ADb2fc9c9) | Live |

**DarwinFi Wallet**: [`0xb2db53Db9a2349186F0214BC3e1bF08a195570e3`](https://basescan.org/address/0xb2db53Db9a2349186F0214BC3e1bF08a195570e3)

---

## Sponsor Integrations

| Sponsor | Integration |
|---------|-------------|
| **Base** | Native L2 deployment, all contracts + agent |
| **Uniswap** | V3 SwapRouter + Quoter V2, real-time quotes |
| **Venice AI** | Strategy evolution (Llama 3.3 70B), quality-critical inference |
| **Storacha/IPFS** | Genome pinning, immutable evolution audit trail |
| **Lit Protocol** | PKP trading guardrails (cryptographic policy enforcement) |
| **ENS/Basenames** | darwinfi.base.eth with 4 on-chain text records (url, description, com.twitter, com.github), displayed in DApp UI |

---

## Why Venice AI

DarwinFi uses Venice AI (Llama 3.3 70B) for two critical functions where privacy and uncensored inference are non-negotiable:

1. **Trading Signal Generation**: Financial analysis requests are frequently refused by safety-filtered models ("I can't provide financial advice"). Venice's uncensored inference means DarwinFi always gets actionable signals, not refusals.

2. **Strategy Evolution Proposals**: The evolution engine asks AI to propose code mutations to trading strategies. Safety-filtered models refuse to modify financial code. Venice treats this as a legitimate engineering task.

3. **Private Inference**: Trading strategies are alpha. If competitors can observe what signals DarwinFi requests, they can front-run or copy the strategy. Venice's privacy-preserving inference ensures no one sees DarwinFi's queries -- not even Venice.

Venice powers `src/agent/venice-engine.ts` (real-time execution signals) and `src/evolution/proposal.ts` (code mutation proposals). The AI Router (`src/agent/ai-router.ts`) health-checks the GPU node first, falls back to Venice for quality-critical inference, and uses Claude CLI as last resort.

---

## Traction Metrics

| Metric | Value |
|--------|-------|
| Tests passing | 488 |
| Solidity statement coverage | 70% (V4 vault: 91%) |
| On-chain transactions | 19 (Base mainnet) |
| Autonomous evolution cycles | 5 (all safety-gated) |
| Vault version | V4 (security hardened) |
| Contracts deployed | 4 (V4 Vault, PerformanceLog, StrategyExecutor, ENS) |
| Vault TVL | ~$90 USDC deposited, trading live |
| Trade cycles completed | 2 (8 USDC volume, Uniswap V3) |
| PerformanceLog entries | 2 trades + 1 generation advance |

---

## Built With

- **Claude Code** (Anthropic): Agent harness + batch signal evaluation
- **Venice AI**: Strategy evolution via 3 AI personas (Llama 3.3 70B)
- **Ollama** (gemma2:9b): Local GPU fast inference via MCF
- **Uniswap V3**: On-chain swap execution
- **Base**: Primary L2 chain
- **Lit Protocol**: PKP cryptographic guardrails
- **Storacha**: IPFS genome storage
- **OpenZeppelin v5**: ERC-4626, Ownable, ReentrancyGuard, Pausable
- **React 19 + Vite 6 + Tailwind**: DApp frontend
- **Hardhat + ethers.js v6**: Smart contract development

---

*Built by Maxwell Morgan for the Synthesis Hackathon 2026.*
*"Anything that can go wrong, will go wrong -- unless DarwinFi evolves around it."*
