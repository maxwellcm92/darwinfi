# DarwinFi Development Log

> Built with [Claude Code](https://claude.com/claude-code) (`claude-opus-4-6`) as the agent harness.
> All sessions on March 18, 2026. Total: 24 source files, 7,635 lines of code.

---

## Session 1: Architecture & Full Scaffold

**Objective:** Design and implement the complete DarwinFi system from scratch -- an autonomous, self-evolving crypto trading agent built on Darwinian competition principles.

### Key Decisions

- **12-strategy Darwinian competition model.** Rather than a single trading bot, we designed a population of 12 strategies that compete for capital. 3 main strategies each spawn 3 variations (Mad Scientist, Optimizer, Synthesizer), creating evolutionary pressure. The best-performing strategy gets promoted to live trading; the rest paper trade with real price feeds.

- **Why 12?** Three main strategies provide diversity (momentum, mean-reversion, breakout), while three variation roles per strategy ensure both exploration (Mad Scientist) and exploitation (Optimizer). The Synthesizer hybridizes the best traits across all strategies. 3 x 4 = 12 total -- large enough for meaningful competition, small enough to evaluate in real time.

- **Composite performance scoring.** Strategies are ranked by a weighted formula, not just raw PnL:
  ```
  score = (rolling_24h_PnL * 0.30)
        + (rolling_24h_Sharpe * 0.25)
        + (rolling_24h_WinRate * 0.20)
        + (total_PnL * 0.15)
        + ((1 - max_drawdown) * 0.10)
  ```
  This prevents a strategy from winning purely on one lucky trade. Rolling 24h metrics (75% weight) favor recent performance while total PnL (15%) rewards sustained results and drawdown penalty (10%) punishes reckless risk.

- **Dual-AI architecture.** Claude handles high-level strategy evolution (parameter mutation, architecture analysis). Venice AI handles real-time execution decisions (buy/sell signals per tick). This separation lets each model focus on what it does best -- Claude for reasoning about strategy design, Venice for fast tactical calls.

- **Token universe: ETH, USDC, UNI, wstETH, ENS, AERO.** Selected for liquidity on Base and alignment with hackathon sponsors (Uniswap, ENS, Lido). AERO included as the top native Base DEX token.

- **Per-strategy budget isolation.** DarwinVault allocates $25 USDC per main strategy with hard spending scopes. If a strategy blows up, it can only lose its own allocation. This is enforced at the smart contract level.

### What Claude Code Built

**Smart Contracts (3 files, 717 lines of Solidity):**
- `DarwinVault.sol` -- Fund management vault with per-strategy spending scopes, owner deposit/withdraw, and budget allocation. Uses OpenZeppelin Ownable + ReentrancyGuard.
- `StrategyExecutor.sol` -- Uniswap V3 swap execution with trade logging. Only callable by authorized wallet, pulls budget from DarwinVault per trade.
- `PerformanceLog.sol` -- On-chain performance and evolution event logging. Immutable audit trail of strategy promotions and score snapshots.

**Agent Core (6 files, 2,880 lines of TypeScript):**
- `darwin-agent.ts` -- Main orchestrator loop. Runs 4h evolution cycles (or after 10 trades). Manages the full agent lifecycle: initialize, price loop, evolution triggers, promotion logic.
- `strategy-manager.ts` -- Lifecycle management for all 12 strategies. Seed strategies define three trading philosophies: Alpha Momentum (RSI oversold + trailing stop), Beta Mean-Reversion (Bollinger bounce + fixed target), Gamma Breakout (volume spike + time-based exit). Handles promotion, demotion, and sell-only transitions.
- `evolution-engine.ts` -- Claude API integration for strategy evolution. Analyzes all 12 strategies' performance and generates new parameters per variation role (experimental pushes boundaries, optimizer fixes weaknesses, synthesizer combines best traits).
- `venice-engine.ts` -- Venice AI integration for real-time execution decisions. Gets buy/sell/hold signals based on current market conditions and strategy parameters.
- `performance.ts` -- Composite scoring engine with rolling 24h windows. Calculates Sharpe ratio, win rate, max drawdown, and the weighted composite score used for promotion decisions.
- `state-persistence.ts` -- JSON file-based state persistence with atomic writes (write to .tmp, rename). Auto-saves every 5 minutes. Allows agent to survive restarts without losing strategy state, trade history, or evolution progress.

**Trading Layer (4 files, 1,772 lines):**
- `paper-engine.ts` -- Paper trading simulator using real price feeds. 11 of 12 strategies paper trade at any given time.
- `live-engine.ts` -- On-chain Uniswap V3 execution for the promoted strategy. Manages real transactions with gas estimation and slippage protection.
- `uniswap-client.ts` -- Direct Uniswap V3 Router and Quoter contract interaction. Handles quoteExactInputSingle, exactInputSingle swaps.
- `price-feed.ts` -- Real-time price data from Uniswap V3 pools via slot0 oracle reads. Feeds both paper and live engines.

**Chain Layer (3 files, 837 lines):**
- `base-client.ts` -- Base L2 chain connection via ethers.js v6.
- `wallet-manager.ts` -- Multi-wallet management with nonce tracking and transaction retry logic.
- `contract-client.ts` -- Typed smart contract interaction layer with ABI encoding.

**Integrations (3 files, 257 lines):**
- `ens.ts` -- ENS/Basenames identity registration (darwinfi.base.eth).
- `filecoin.ts` -- IPFS/Filecoin for immutable strategy genome storage. Each evolution cycle pins the genome to IPFS for full audit trail.
- `celo-client.ts` -- Multi-chain contract deployment to Celo.

**Dashboard (2 files, 239 lines):**
- `server.ts` -- Express API exposing /api/strategies, /api/performance, /api/trades, /api/evolution.
- `index.html` -- Basic monitoring UI.

**Infrastructure (4 files):**
- `hardhat.config.ts` -- Hardhat config for Base mainnet, Base testnet, and Celo.
- `deploy.ts` -- Contract deployment script.
- `register.ts` -- Strategy registration script.
- `.env.example` -- Environment template.

**Code Impact:** 29 files created, 15,117 lines added in a single commit (`beb1b82`).

---

## Session 2: Core System Wiring & Bug Fixes

**Objective:** Wire together the scaffold into a working system. Fix deployment bugs, connect real price feeds to the trading engine, add state persistence, build a proper dashboard, and create the conversation log audit trail.

### Phase 2: Deploy Script Fixes & System Integration

**Challenges & Solutions:**

- **Constructor argument mismatch.** The deploy script passed arguments in the wrong order to DarwinVault's constructor. Reordered to match the Solidity constructor signature.
- **Missing setStrategyExecutor call.** After deploying both contracts, the script didn't link them. Added `vault.setStrategyExecutor(executor.address)` to the deployment flow.
- **Token universe misalignment.** The strategy manager referenced tokens that didn't exist in the price feed's supported list. Realigned both modules to the same 6-token universe: ETH, USDC, UNI, wstETH, ENS, AERO.

**What Claude Code Did:**
- Fixed deploy script constructor args and added post-deploy wiring.
- Wired PriceFeed + LiveEngine into darwin-agent's main loop so strategies receive real price data.
- Aligned the token universe across strategy-manager, price-feed, and live-engine.

### Phase 3: State Persistence

**Key Decision:** File-based JSON persistence with atomic writes rather than a database. For a hackathon project running on a single node, SQLite or Redis would be over-engineering. JSON files are debuggable (just `cat data/state.json`), portable, and sufficient for the data volume.

**What Claude Code Built:**
- `state-persistence.ts` (185 lines) -- Saves full agent state (strategies, performance metrics, trade history, evolution state) to `data/agent-state.json`.
- **Atomic writes:** Writes to `agent-state.tmp` first, then `fs.renameSync` to the final path. This prevents corrupted state files if the process crashes mid-write.
- **Auto-save:** Interval timer saves every 5 minutes. Also saves on clean shutdown (SIGTERM/SIGINT handlers).
- **Load on startup:** If a state file exists, the agent resumes from where it left off -- same strategies, same performance data, same evolution cycle count.

### Phase 4: Dashboard Redesign

**Key Decision:** Full redesign of the dashboard with DarwinFi brand identity rather than the generic monitoring UI from Phase 1. Dark navy background with neon cyan/red/purple accent colors. Press Start 2P font for headers (retro gaming aesthetic), JetBrains Mono for data. Glow effects on active elements.

**What Claude Code Built:**
- Expanded `index.html` from 154 to 730 lines.
- **Strategy Tournament Leaderboard:** All 12 strategies displayed with composite scores, PnL, Sharpe ratios, and live/paper status indicators.
- **Recent Trades Feed:** Real-time trade stream with buy/sell coloring and PnL display.
- **Evolution Timeline:** Visual log of evolution cycles showing which strategies mutated and which got promoted.
- **Conversation Log Viewer:** Filterable display of the agent's decision log with type-based color coding (system events in cyan, trades in green, AI calls in purple, errors in red).

### Phase 5: Conversation Log System

**Key Decision:** A structured audit trail, not just application logs. The conversation log records every meaningful agent decision with full context: what the AI was asked, what it responded, why a trade was placed, which strategy got promoted and why. This is the "show your work" requirement for hackathon judges.

**What Claude Code Built:**
- `conversation-log.ts` (239 lines) -- Typed log entries with categories: system, agent_decision, ai_call, trade, evolution, promotion, error.
- AI context tracking: For every Claude/Venice API call, records the model used, prompt summary, response summary, and token count.
- File persistence: Writes to `data/conversation-log.json` with flush batching (writes every 30 seconds or on 50 new entries).
- REST API: Exposed via `/api/conversation-log` with optional type filter query parameter.
- Max 5,000 entries with FIFO rotation to prevent unbounded growth.

**Code Impact:** 9 files modified, 1,444 lines added, 190 lines removed (`65d5cbc`).

---

## Session 3: Brand Assets & Polish

**Objective:** Create visual identity assets and finalize the project for submission.

### What Claude Code Did

- **Logo creation:** Generated the DarwinFi helix logo (DNA double-helix representing strategy evolution) and wordmark assets. Placed in `assets/` directory.
- **Favicon pipeline:** Converted logo to favicon format for the dashboard.

**Code Impact:** 1 file added (`a370c1a`).

---

## Technical Summary

| Metric | Value |
|--------|-------|
| Source files | 24 |
| Lines of code | 7,635 |
| Smart contracts | 3 (Solidity) |
| TypeScript modules | 18 |
| Trading strategies | 12 (3 main + 9 variations) |
| Token pairs | 6 (ETH, USDC, UNI, wstETH, ENS, AERO) |
| Chains supported | 2 (Base, Celo) |
| AI models integrated | 2 (Claude for evolution, Venice AI for execution) |
| Sponsor integrations | 7 (Base, Uniswap, Venice AI, Celo, ENS, Filecoin, Locus) |
| Git commits | 4 |
| Build time | ~2 hours |

---

## Architecture Decisions Log

| Decision | Chosen | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| Strategy competition model | 12-strategy Darwinian tournament | Single adaptive strategy, ensemble voting | Natural selection produces robust strategies without manual tuning. The 12-strategy population balances diversity with computational feasibility. |
| AI role separation | Claude for evolution, Venice for execution | Single model for both, no AI | Claude excels at strategic reasoning (what parameters to change); Venice AI adds sponsor alignment and fast inference for real-time decisions. |
| State persistence | JSON files with atomic writes | SQLite, Redis, on-chain storage | Debuggable, portable, zero dependencies. Atomic writes prevent corruption. Sufficient for single-node hackathon deployment. |
| Performance scoring | Weighted composite (5 factors) | Raw PnL ranking, Sharpe-only, ELO rating | Multi-factor scoring prevents gaming (one lucky trade) and rewards consistency. Rolling 24h window keeps evaluation current. |
| Fund isolation | Per-strategy budgets in DarwinVault | Shared pool, off-chain accounting | On-chain enforcement means a rogue strategy literally cannot overspend. Trustless by design. |
| Token universe | 6 tokens (sponsor-aligned) | Top-20 by volume, stablecoins only | Balances liquidity with sponsor integration requirements. All tokens have deep Uniswap V3 pools on Base. |
| Dashboard UX | Dark theme + retro gaming aesthetic | Minimal charts, no dashboard | The tournament visualization makes the Darwinian competition tangible and engaging for judges reviewing the demo. |

---

*This development log was generated from Claude Code session transcripts and git history. Agent harness: Claude Code (claude-opus-4-6).*
