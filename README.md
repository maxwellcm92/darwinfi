# DarwinFi

**Autonomous, self-evolving crypto trading agent powered by Darwinian competition.**

12 concurrent trading strategies compete on Uniswap V3 (Base). The top performer trades live on-chain; the rest paper trade and evolve to dethrone it. Strategy evolution is driven by AI (Claude + Venice AI), creating a system that continuously improves its own trading performance.

Built for the [Synthesis Hackathon](https://synthesis.md/) - "Agents that Pay" track.

---

## How It Works

```
                    +------------------+
                    |   Darwin Agent   |  (Main Orchestrator)
                    |   Every 4h OR    |
                    |   10 trades:     |
                    |   EVOLVE         |
                    +--------+---------+
                             |
              +--------------+--------------+
              |              |              |
     +--------v---+  +------v-----+  +-----v------+
     | Strategy 1 |  | Strategy 2 |  | Strategy 3 |
     | ($25 USDC) |  | ($25 USDC) |  | ($25 USDC) |
     +-----+------+  +-----+------+  +-----+------+
           |              |              |
     +--+--+--+     +--+--+--+     +--+--+--+
     |A  |B  |C     |A  |B  |C     |A  |B  |C
     Mut Tun Hyb    Mut Tun Hyb    Mut Tun Hyb
```

**3 Main Strategies** - Each with $25 USDC budget on Base
- **Apex** (Momentum) - RSI oversold + trailing stop
- **Viper** (Mean-Revert) - Bollinger bounce + fixed target
- **Blitz** (Breakout) - EMA crossover + trailing stop
- One trades LIVE on Uniswap V3; others paper trade with real price feeds

**9 Variations** - 3 per main strategy
- **Mutant** - Creative, unconventional parameter exploration
- **Tuner** - Conservative fixes to parent strategy weaknesses
- **Hybrid** - Best-of-all trait synthesis

**AI Evolution Loop** (every 4 hours or 10 trades):
1. Claude analyzes all 12 strategies' performance
2. Generates new variation parameters per role
3. Variations that outperform their parent get promoted
4. Top-performing main strategy becomes the live trader

**Composite Performance Score:**
```
score = (rolling_24h_PnL * 0.30)
      + (rolling_24h_Sharpe * 0.25)
      + (rolling_24h_WinRate * 0.20)
      + (total_PnL * 0.15)
      + ((1 - max_drawdown) * 0.10)
```

---

## Architecture

```
darwinfi/
  contracts/              # Solidity smart contracts (Base)
    DarwinVault.sol       # Fund management + per-strategy spending scopes
    StrategyExecutor.sol  # Uniswap V3 swap execution + trade logging
    PerformanceLog.sol    # On-chain performance + evolution event logging
  src/
    agent/
      darwin-agent.ts     # Main orchestrator loop (3 tick speeds)
      strategy-manager.ts # 12-strategy lifecycle + proving ground gate
      evolution-engine.ts # Venice AI - strategy evolution (3 persona roles)
      claude-cli-engine.ts# Claude CLI - batch signal evaluation
      performance.ts      # Composite scoring (sigmoid-normalized, Sharpe w/ Bessel)
      circuit-breaker.ts  # Per-strategy + portfolio-wide safety limits
      state-persistence.ts# JSON file-based state save/restore
      conversation-log.ts # Full agent decision audit trail
    trading/
      paper-engine.ts     # Paper trading simulator (real price feeds)
      live-engine.ts      # On-chain Uniswap V3 execution
      uniswap-client.ts   # Direct Uniswap V3 Quoter V2 interaction
      price-feed.ts       # Real-time price data from Uniswap pools
    chain/
      base-client.ts      # Base chain connection (ethers.js v6)
      wallet-manager.ts   # Multi-wallet + transaction management
      contract-client.ts  # Smart contract interaction layer
    integrations/
      ens.ts              # ENS/Basenames identity
      filecoin.ts         # IPFS/Filecoin strategy genome storage
    dashboard/
      server.ts           # Express API + event feed + genome endpoint
      index.html          # Strategy tournament dashboard (live event feed, DNA diff, health bars)
  test/
    performance.test.ts   # 15 tests: Sharpe, PnL%, composite, drawdown
    circuit-breaker.test.ts # 23 tests: drawdown, losses, halt, overrides
    strategy-manager.test.ts # 10 tests: init, proving ground, promotion
    paper-engine.test.ts  # 11 tests: slippage, VWAP, gas, PnL
  scripts/
    deploy.ts             # Contract deployment
  hardhat.config.ts       # Hardhat config (Base)
```

### Key Design Decisions

- **Proving Ground**: No strategy trades real money until it has made at least one profitable paper trade
- **Three-Tick Architecture**: Fast tick (30s, prices + rule-based stops), Signal tick (2min, Claude CLI batch), Evolution tick (4h, Venice AI mutations)
- **Circuit Breakers**: Per-strategy drawdown limits (15%), portfolio-wide halt (25%), consecutive loss counter (5)
- **Sigmoid-Normalized Scoring**: Consistent composite fitness scoring that doesn't shift when cohort composition changes (replaced min-max which had a shifting-scale bug)
- **Parallel Price Fetches**: All token prices fetched via Promise.allSettled instead of sequential awaits (5x faster)

---

## Token Universe

| Token | Address (Base) | Why |
|-------|---------------|-----|
| ETH/WETH | `0x4200000000000000000000000000000000000006` | Base native |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Stablecoin base pair |
| UNI | Uniswap governance | Sponsor alignment |
| wstETH | Lido staked ETH | Sponsor alignment |
| ENS | ENS governance | Sponsor alignment |
| AERO | Aerodrome | Top Base DEX token |

---

## Sponsor Integrations

| Sponsor | Integration | Status |
|---------|-------------|--------|
| **Base** | Native deployment, all contracts | Core |
| **Uniswap** | V3 Router for all swaps | Core |
| **Venice AI** | Strategy evolution + execution signals | Core |
| **ENS/Basenames** | Agent identity (darwinfi.base.eth) | Tier 1 |
| **Filecoin/IPFS** | Immutable strategy genome storage | Tier 1 |
| **Celo** | Multi-chain contract deployment (ready) | Tier 2 |

---

## Setup

### Prerequisites
- Node.js 18+
- An Ethereum wallet with Base ETH + USDC

### Install
```bash
git clone https://github.com/maxwellcm92/darwinfi.git
cd darwinfi
npm install
```

### Configure
```bash
cp .env.example .env
# Edit .env with your keys:
# - PRIVATE_KEY (wallet)
# - VENICE_API_KEY (Venice AI)
# - BASE_RPC_URL (optional, defaults to public RPC)
```

### Deploy Contracts
```bash
# Testnet first
npm run deploy:base-testnet

# Then mainnet
npm run deploy:base
npm run deploy:celo
```

### Run
```bash
npm start
```

---

## Testing

59 tests across 4 modules, all passing:

```bash
npm test
```

| Module | Tests | Coverage |
|--------|-------|----------|
| PerformanceTracker | 15 | Sharpe (Bessel), PnL% (fees), composite, drawdown, win rate |
| CircuitBreaker | 23 | Drawdown, losses, portfolio halt, overrides, price validation |
| StrategyManager | 10 | Initialization, proving ground, promotion, serialization |
| PaperEngine | 11 | Slippage, VWAP, gas costs, PnL calculations |

---

## Live Demo

**Dashboard**: [https://corduroycloud.com/darwinfi/](https://corduroycloud.com/darwinfi/)

12 named bots competing in real time with live price feeds from Uniswap V3 pools on Base.

## On-Chain Artifacts

| Contract | Base Address | Celo Address |
|----------|-------------|--------------|
| DarwinVault | Pending deployment | TBD |
| StrategyExecutor | Pending deployment | TBD |
| PerformanceLog | Pending deployment | TBD |

**DarwinFi Wallet**: `0xb2db53Db9a2349186F0214BC3e1bF08a195570e3` (Base)

**ENS**: darwinfi.base.eth

---

## Built With

- **Claude** (Anthropic) - Batch signal evaluation via Claude CLI (Haiku 4.5)
- **Venice AI** - Strategy evolution via 3 AI personas (Llama 3.3 70B)
- **Uniswap V3** - On-chain swap execution + Quoter V2 price feeds
- **Base** - Primary L2 chain (Coinbase)
- **Hardhat** - Smart contract development + test runner
- **ethers.js v6** - Chain interaction
- **Claude Code** - Agent harness

---

## License

MIT License - see [LICENSE](LICENSE)

---

*Built by Maxwell Morgan for the Synthesis Hackathon 2026. Agent harness: Claude Code.*
