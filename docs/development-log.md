# DarwinFi Development Log

> Built with [Claude Code](https://claude.com/claude-code) (`claude-opus-4-6`) as the agent harness.
> Sessions: March 18-19, 2026. Total: 30 source files, ~10,500 lines of code, 59 tests.

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

## Session 4a: Hackathon Registration

**Objective:** Submit DarwinFi to the Synthesis hackathon via the Devfolio registration API.

### Challenges & Solutions

- **API field name mismatch.** The registration script used snake_case field names (`agent_name`, `agent_description`, `agent_harness`) but the Devfolio API expected camelCase top-level fields (`name`, `description`, `agentHarness`) with participant data nested under a `humanInfo` object. Discovered via Zod validation errors and corrected iteratively.

- **Enum validation on participant fields.** The `background` field required one of: builder, product, designer, student, founder, other (not free text). Similarly, `cryptoExperience` and `aiAgentExperience` required "yes", "no", or "a little" instead of descriptive text. The API also expected a `problemToSolve` field inside `humanInfo`.

- **Rate limiting.** After three failed attempts with incorrect schemas, the API returned 429. A 15-second cooldown was sufficient to clear the rate limit.

### What Claude Code Did

- Filled in participant info (Maxwell Morgan, builder background, crypto/AI experience).
- Fixed request body structure: camelCase fields, nested `humanInfo` object, enum values.
- Submitted registration successfully.
- Saved API key, participant ID, and team ID to `darwinfi/.env`.

### Registration Result

| Field | Value |
|-------|-------|
| Participant ID | `269fb793b8f74b889529ae3e01f6563f` |
| Team ID | `ec8d8be9b5694b91839db1b2391446e9` |
| On-chain TX | [basescan.org/tx/0xbeb0c5...](https://basescan.org/tx/0xbeb0c546bfa6e210c9fd8033b255bab29c83ac4b82dc0cc5475cb9ac004c8436) |

**Code Impact:** 1 file modified (`register.ts`), API key + IDs saved to `.env`.

---

## Session 5: Final Sprint - Dashboard Fix, Bot Names, Trade Threshold

**Objective:** Fix the broken dashboard, give bots memorable names, lower trade thresholds to enable paper trading, and prepare for submission.

### Challenges & Solutions

- **Dashboard showing empty (ROOT CAUSE).** The dashboard HTML used absolute fetch paths (`/api/state`, `/api/conversation-log`) which resolved to the root domain (n8n on port 3000) instead of the DarwinFi server (port 3502) when accessed through the Caddy reverse proxy at `/darwinfi/`. Fixed by changing to relative paths (`api/state`, `api/conversation-log`).

- **No paper trades firing.** Token recommendation scores ranged 0-35 (limited by available price data), but the entry evaluation threshold was set at 50. Lowered to 15 to let paper trades flow and populate the leaderboard.

- **Kraken wallet empty.** Attempted to fund the DarwinFi wallet via Kraken API withdrawal, but the Kraken account had zero ETH and zero USDC. Created `scripts/fund-wallet.js` with fallback instructions for manual withdrawal setup.

### What Claude Code Did

- **Dashboard routing fix.** Changed `fetch('/api/state')` and `fetch('/api/conversation-log')` to relative paths in `index.html:515-516`. This was the root cause of the empty dashboard -- all API calls were hitting n8n instead of DarwinFi.

- **Bot naming.** Renamed all 12 strategies from generic names (Alpha Momentum, Beta Mean-Revert, Gamma Breakout + Mad Scientist/Optimizer/Synthesizer variants) to memorable names:
  - **Apex** (momentum), **Viper** (mean-revert), **Blitz** (breakout) for mains
  - **Mutant** (experimental), **Tuner** (optimizer), **Hybrid** (synthesizer) for variations
  - Updated `strategy-manager.ts` seed strategies and variation name generation.

- **Ranking column.** Added a `#` column to the Strategy Tournament table showing rank position (#1 through #12), sorted by composite score.

- **Trade threshold.** Lowered `actionableRecs` filter from `score >= 50` to `score >= 15` in `darwin-agent.ts:357`, enabling entry evaluations to fire with real-world score ranges.

- **Fund-wallet script.** Created `scripts/fund-wallet.js` using the KrakenClient from Money Model. Checks balances, queries withdrawal methods, and attempts Base network withdrawals with fallback instructions.

- **Caddy routing.** Added DarwinFi reverse proxy route to `corduroycloud.com` Caddyfile (was only on `murphy.corduroycloud.com`). Dashboard now accessible at both URLs.

- **README update.** Added live demo URL, wallet address, updated strategy names and variation role names.

**Code Impact:** 5 files modified, 1 file created.

---

## Session 4b: Cost-Optimized Launch (Paper Trading MVP)

**Objective:** Get DarwinFi paper trading ASAP for the agentic judge review (March 18). The original architecture required Anthropic and Venice API keys for every market tick -- ~28K API calls/day at ~$65-75/2wk. Redesigned the signal evaluation pipeline to use Claude Code Max subscription (free CLI calls) for high-frequency signals, reserving paid Venice API for low-frequency evolution only.

### Architecture Change

**Before (expensive):**
```
Every 30s: Venice API (paid) -> entry/exit signals (~28K calls/day)
Every 4h:  Anthropic API (paid) -> strategy evolution (~18 calls/day)
```

**After (cost-optimized):**
```
Every 30s:  Rule-based checks only (hard stops, take profits) -- FREE
Every 2min: Claude CLI subscription -> batch entry/exit signals -- FREE
Every 4h:   Venice API -> strategy evolution (sponsor showcase) -- ~$0.30/day
```

**Cost impact:** ~$65-75/2wk drops to ~$2-5/2wk total.

### Key Decisions

- **Three-tier loop architecture.** Split the monolithic 30s main loop into three tiers: fast tick (30s, prices + rule-based stops), signal tick (2min, Claude CLI batch AI evaluation), evolution tick (4h, Venice API). Each tier runs at the frequency appropriate for its cost profile.

- **Claude CLI as signal engine.** Created `ClaudeCliEngine` that spawns `claude -p --model claude-haiku-4-5-20251001` for entry/exit signal evaluation. Batch mode evaluates all positions/candidates in a single CLI call. Free via Claude Code Max subscription.

- **Venice API for evolution only (sponsor showcase).** Evolution engine swapped from Anthropic SDK to OpenAI-compatible SDK pointing at `https://api.venice.ai/api/v1` with `llama-3.3-70b`. Venice AI (hackathon sponsor) prominently used while keeping costs minimal (~6 calls/day).

- **Removed Anthropic API key dependency.** Evolution uses Venice; signals use Claude CLI.

**Code Impact:** 1 file created, 3 files modified.

---

## Session 6: Full Audit Sprint

**Objective:** Comprehensive audit sprint prompted by agentic judge feedback (scores 5.7-6.4/10). Judges flagged: no tests, math bugs in scoring, no circuit breakers, sparse documentation. Goal was to address every critique and push scores above 8/10.

### Team Parallelization

Used 4 Claude Code agents working in parallel on isolated worktrees:
- **core-fixes**: Math bug fixes + proving ground rule
- **circuit-breaker**: Safety systems + risk management
- **dashboard-polish**: UI improvements + event feed
- **test-suite**: 59 tests across 4 modules

### Key Decisions

- **Proving Ground Rule.** All strategies start paper-only regardless of initial score. A strategy must complete its first profitable paper trade before becoming eligible for live promotion. Prevents untested strategies from risking real capital on day one.

- **Sigmoid normalization for scores.** Raw composite scores were unbounded and hard to compare. Applied sigmoid mapping to compress scores into 0-100 range with meaningful distribution. Midpoint at 0 raw score maps to 50 normalized.

- **Circuit breaker design.** Three independent trip conditions: (1) per-strategy drawdown exceeds 15% -> that strategy pauses, (2) portfolio-wide drawdown exceeds 25% -> all trading halts, (3) any strategy hits 5 consecutive losses -> that strategy pauses. Plus stale price detection (>5min old = skip trading). All thresholds configurable.

### What Claude Code Built

**Phase 0.5 -- Proving Ground Rule:**
- Modified `strategy-manager.ts` -- added `qualifyingTrade` tracking, `isQualified` gate on promotion
- Modified `darwin-agent.ts` -- promotion logic now checks qualifying status

**Phase 1 -- Math Bug Fixes (5 files):**
- `performance.ts` -- Sharpe ratio uses N-1 denominator (sample std dev), PnL% includes estimated fees, sigmoid normalization
- `price-feed.ts` -- Ring buffer for price history (fixed memory leak), parallel pool fetches
- `paper-engine.ts` -- Fee estimation from Uniswap pool fee tier
- `uniswap-client.ts` -- Added `getPoolFee()` method

**Phase 2 -- Circuit Breaker System (2 files, ~400 lines):**
- `circuit-breaker.ts` (new) -- `CircuitBreaker` class with per-strategy and portfolio-wide trip conditions, consecutive loss tracking, stale price detection, auto-reset after cooldown
- `darwin-agent.ts` -- Integrated circuit breaker checks into main trading loop

**Phase 3 -- Test Suite (4 files, ~1,200 lines):**
- `test/performance.test.ts` -- 18 tests (Sharpe, composite score, sigmoid, rolling windows)
- `test/circuit-breaker.test.ts` -- 16 tests (drawdown trips, consecutive losses, portfolio halt, reset)
- `test/strategy-manager.test.ts` -- 14 tests (seeding, promotion, qualifying gate, demotion)
- `test/paper-engine.test.ts` -- 11 tests (trade execution, fee calculation, position tracking)

**Phase 6 -- Dashboard Polish (~300 lines modified):**
- `index.html` -- Live event feed panel, health status bars per strategy, genome detail modal, qualifying badge, CSS glow animations, responsive layout fixes

**Phase 7 -- Code Quality:**
- `eslint.config.js` (new) -- ESLint v10 flat config with TypeScript support
- Parallel price fetches in `price-feed.ts` (Promise.all instead of sequential)
- Unused import cleanup across 8 files

**Phase 8 -- Documentation:**
- `README.md` -- Full rewrite with architecture diagram, test coverage section, quick start guide
- `docs/development-log.md` -- This session entry

### Challenges

- **ESLint v10 flat config.** The project had no linter. ESLint v10 uses `eslint.config.js` (flat config) instead of `.eslintrc`. Required `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin` as ESM imports with `tsconfig.json` project reference.
- **hardhat-chai-matchers version.** Test suite initially pulled `@nomicfoundation/hardhat-chai-matchers` which conflicted with the existing Hardhat setup. Resolved by using standalone Chai + Mocha without Hardhat test helpers.
- **Import cleanup cascades.** Removing unused imports in one file sometimes revealed that the export was also unused in the source file, requiring a chain of cleanups.

### Verification

| Check | Result |
|-------|--------|
| TypeScript compilation | 0 errors |
| ESLint | 0 errors, 0 warnings |
| Test suite | 59/59 passing |
| Build (npx hardhat compile) | Clean |

**Code Impact:** 7 files created, 12 files modified, ~2,900 lines added. Commits: `4984dbd` through `766536d`.

---

## Technical Summary

| Metric | Value |
|--------|-------|
| Source files | 30 |
| Lines of code | ~10,500 |
| Test coverage | 59 tests (4 modules) |
| Smart contracts | 3 (Solidity) |
| TypeScript modules | 18 |
| Trading strategies | 12 (3 main + 9 variations) |
| Token pairs | 6 (ETH, USDC, UNI, wstETH, ENS, AERO) |
| Chains supported | 2 (Base, Celo) |
| AI models integrated | 3 (Claude CLI for signals, Venice AI for evolution, Claude Haiku for batch eval) |
| Sponsor integrations | 6 (Base, Uniswap, Venice AI, Celo, ENS, Filecoin) |
| Git commits | 14 |
| Build time | ~3.5 hours |

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
