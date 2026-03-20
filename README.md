# DarwinFi

**Autonomous, self-evolving DeFi agent with multi-user vault and cryptographic trading guardrails.**

12 concurrent trading strategies compete on Uniswap V3 (Base L2). The top performer trades live on-chain; the rest paper trade and evolve to dethrone it. Users deposit USDC into an ERC-4626 vault and earn proportional returns from the agent's trading profits, with Lit Protocol PKP guardrails ensuring the agent can never rug depositors.

Built for the [Synthesis Hackathon](https://synthesis.md/), "Agents that Pay" track.

**Live Dashboard**: [https://corduroycloud.com/darwinfi/](https://corduroycloud.com/darwinfi/)

---

## What Makes DarwinFi Different

1. **Self-Evolving Strategies**: AI generates, mutates, and promotes trading strategies through Darwinian competition. No manual parameter tuning.
2. **ERC-4626 Multi-User Vault**: Standard tokenized vault. Deposit USDC, receive dvUSDC shares. As the pool grows from trading profits, shares appreciate automatically.
3. **Lit Protocol Guardrails**: AProgrammable Key Pair (PKP) signs every transaction. An IPFS-hosted Lit Action enforces a strict trading policy: whitelisted contracts, whitelisted tokens, per-trade size limits (max 1000 USDC). The agent provably cannot steal funds.
4. **Multi-AI Architecture**: Claude (Anthropic) evaluates trade signals. Venice AI (Llama 3.3 70B) evolves strategy parameters. Two independent AI systems with different strengths.

---

## Trust Architecture: Immutable / Mutable / Bridge

DarwinFi separates concerns into three layers so that the evolving AI brain can never exceed its boundaries:

- **Immutable (on-chain):** The ERC-4626 vault (deposit/withdraw/borrow/return) and the Lit Protocol trade policy (approved tokens, max trade size, approved contracts) are deployed on-chain and pinned to IPFS. They cannot be changed after deployment.
- **Mutable (off-chain):** The TypeScript agent with 12 trading strategies, Venice AI evolution engine, and Claude CLI signal evaluation all run off-chain. These components evolve and improve over time through Darwinian competition.
- **Bridge (Lit Protocol PKP):** A Programmable Key Pair signs every transaction only if it passes the immutable IPFS policy. This provides cryptographic proof that the evolving brain can never steal funds, trade unauthorized tokens, or exceed size limits.

This three-layer design means users get the benefits of an adaptive, self-improving trading agent while retaining the security guarantees of immutable smart contracts.

## Architecture

```
                         Users (MetaMask / Coinbase Wallet / WalletConnect)
                                        |
                                   React DApp
                              (wagmi + RainbowKit)
                                        |
                         +-------- Base L2 --------+
                         |                         |
                  DarwinVaultV2              Uniswap V3
                   (ERC-4626)              SwapRouter
                   dvUSDC shares            Quoter V2
                         |                         |
                   +-----+---------+               |
                   |               |               |
              agentBorrow    agentReturn           |
                   |               |               |
                   +-------+-------+               |
                           |                       |
                     Darwin Agent  <-----> Lit PKP Signer
                    (Orchestrator)         (trade-policy.js)
                           |
              +------------+------------+
              |            |            |
         Strategy 1   Strategy 2   Strategy 3
         (+ 3 vars)   (+ 3 vars)   (+ 3 vars)
              |            |            |
         Live/Paper    Paper Only   Paper Only
         Trading       Trading      Trading
```

### Project Structure

```
darwinfi/
  contracts/
    DarwinVaultV2.sol         # ERC-4626 multi-user vault (dvUSDC shares)
    DarwinVault.sol           # Original vault (deprecated)
    StrategyExecutor.sol      # Uniswap V3 trade execution + logging
    PerformanceLog.sol        # On-chain performance + evolution events
  dapp/                       # React/Vite DApp frontend
    src/
      hooks/                  # useVaultDeposit, useVaultWithdraw, useVaultStats
      components/             # DepositCard, WithdrawCard, VaultOverview, Leaderboard
      pages/                  # Home, Portfolio, Tournament
      lib/                    # Contract ABIs, constants
  lit-actions/
    trade-policy.js           # IPFS-hosted Lit Action (immutable trading policy)
  src/
    agent/
      darwin-agent.ts         # Main orchestrator (3 tick speeds, vault integration)
      strategy-manager.ts     # 12-strategy lifecycle + proving ground
      evolution-engine.ts     # Venice AI strategy evolution (3 persona roles)
      claude-cli-engine.ts    # Claude CLI batch signal evaluation
      performance.ts          # Composite scoring (sigmoid-normalized, Sharpe w/ Bessel)
      circuit-breaker.ts      # Per-strategy + portfolio-wide safety limits
    trading/
      live-engine.ts          # On-chain Uniswap V3 execution + vault borrow/return
      paper-engine.ts         # Paper trading simulator (real price feeds)
      uniswap-client.ts       # Direct Uniswap V3 Router + Quoter V2 interaction
      price-feed.ts           # Real-time prices from Uniswap pools
    chain/
      base-client.ts          # Base chain connection (ethers.js v6, Lit-compatible)
      lit-wallet.ts           # Lit Protocol PKP signer (AbstractSigner drop-in)
      wallet-manager.ts       # Multi-wallet + transaction management
      contract-client.ts      # Smart contract interaction (VaultV2 + legacy)
    dashboard/
      server.ts               # Express API (vault stats, portfolio, trades, events)
    integrations/
      ens.ts                  # ENS/Basenames identity
      filecoin.ts             # IPFS/Filecoin strategy genome storage
      celo-client.ts          # Celo chain client (multi-chain ready)
  test/
    darwin-vault-v2.test.ts   # 27 tests: vault math, fees, agent flow, safety
    performance.test.ts       # 15 tests: Sharpe, PnL%, composite, drawdown
    circuit-breaker.test.ts   # 23 tests: drawdown, losses, halt, overrides
    strategy-manager.test.ts  # 10 tests: init, proving ground, promotion
    paper-engine.test.ts      # 11 tests: slippage, VWAP, gas, PnL
```

---

## Smart Contracts

### DarwinVaultV2 (ERC-4626)

The vault is the core financial primitive. Users deposit USDC and receive `dvUSDC` shares. The agent borrows funds to trade and returns proceeds. Share price appreciates as the vault accumulates trading profits.

| Function | Who | What |
|----------|-----|------|
| `deposit(assets, receiver)` | Any user | Deposit USDC, receive dvUSDC shares |
| `withdraw(assets, receiver, owner)` | Any user | Redeem shares for USDC (1hr lock enforced) |
| `agentBorrow(amount)` | Agent only | Pull USDC for trading |
| `agentReturn(amount)` | Agent only | Return proceeds after trades |
| `emergencyWithdraw()` | Any user | Always works, even when paused |

**Safety features:**
- 1-hour minimum lock (anti-flash-loan)
- `maxWithdraw`/`maxRedeem` return 0 during lock (ERC-4626 compliant)
- 10,000 USDC max TVL cap
- 1,000 USDC per-trade size limit (enforced in Lit Action)
- Pausable deposits (owner emergency control)
- Emergency withdrawal always available (emits standard `Withdraw` event)
- 10% performance fee above high water mark

### StrategyExecutor & PerformanceLog

On-chain trade execution and immutable performance/evolution event logging.

---

## DApp Frontend

React 19 + Vite 6 + wagmi 2.14 + RainbowKit 2.2 + Tailwind CSS v4.

**Wallet Support:** MetaMask, Coinbase Wallet, WalletConnect (auto-prompts Base chain switch).

**Deposit Flow:**
1. Enter USDC amount
2. Approve USDC allowance (wallet popup)
3. Deposit into vault (wallet popup)
4. Receive dvUSDC shares

**Features:**
- Vault overview: TVL, share price, depositor count
- Portfolio card: user position, PnL, share value
- Strategy tournament leaderboard
- Live trades feed
- Agent status (uptime, current champion)

---

## Lit Protocol Integration

Every transaction the agent signs is validated by a Lit Action before the PKP signs it. The policy is uploaded to IPFS (immutable CID), providing cryptographic proof of the exact rules.

**Trade Policy Checks (trade-policy.js):**
1. Chain ID must be Base (8453)
2. Target contract must be whitelisted (Uniswap V3 SwapRouter or DarwinVaultV2)
3. Tokens must be on the approved list (10 tokens)
4. SwapRouter calls restricted to `exactInputSingle` and `multicall`
5. No arbitrary ETH transfers to unknown addresses

If any check fails, the PKP refuses to sign. The agent literally cannot execute unauthorized transactions.

---

## Strategy Evolution

**3 Main Strategies** compete for the live trading slot:
- **Apex** (Momentum): RSI oversold + trailing stop
- **Viper** (Mean-Revert): Bollinger bounce + fixed target
- **Blitz** (Breakout): EMA crossover + trailing stop

**9 Variations** (3 per main) evolve to challenge their parent:
- **Mutant**: Creative, unconventional parameter exploration
- **Tuner**: Conservative fixes to parent weaknesses
- **Hybrid**: Best-of-all trait synthesis

**Evolution Loop** (every 4 hours or 10 trades):
1. Claude analyzes all 12 strategies' performance
2. Venice AI generates new variation parameters per persona role
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

## Token Universe

| Token | Address (Base) | Category |
|-------|---------------|----------|
| ETH/WETH | `0x4200000000000000000000000000000000000006` | Base native |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Stablecoin base |
| UNI | `0xc3De830EA07524a0761646a6a4e4be0e114a3C83` | Sponsor (Uniswap) |
| wstETH | `0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452` | Sponsor (Lido) |
| ENS | `0x2a2764E1472e0a09D70e10B1bfA4AFBE144F72a3` | Sponsor (ENS) |
| AERO | `0x940181a94A35A4569E4529A3CDfB74e38FD98631` | Top Base DEX |
| DEGEN | `0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed` | Base culture |
| BRETT | `0x532f27101965dd16442E59d40670FaF5eBB142E4` | Base culture |
| VIRTUAL | `0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b` | AI token |
| HIGHER | `0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe` | Base culture |

---

## Sponsor Integrations

| Sponsor | Integration | How |
|---------|-------------|-----|
| **Base** | Native L2 deployment | All contracts + agent on Base mainnet |
| **Uniswap** | V3 Router + Quoter V2 | All swaps via exactInputSingle, real-time quotes |
| **Venice AI** | Strategy evolution | 3 AI personas (Mutant/Tuner/Hybrid) via Llama 3.3 70B |
| **ENS/Basenames** | Agent identity | darwinfi.base.eth |
| **Filecoin/IPFS** | Strategy genomes + Lit Actions | Immutable storage via Storacha |
| **Lit Protocol** | PKP trading guardrails | Cryptographic policy enforcement on every tx |
| **Celo** | Multi-chain deployment | Contracts + client ready for Celo deployment |

---

## Testing

86 tests across 5 modules, all passing:

```bash
npm test
```

| Module | Tests | Coverage |
|--------|-------|----------|
| DarwinVaultV2 | 27 | Deposit/withdraw, share math, multi-user, agent borrow/return, performance fee, HWM, pause, emergency, access control |
| PerformanceTracker | 15 | Sharpe (Bessel), PnL% (fees), composite, drawdown, win rate |
| CircuitBreaker | 23 | Drawdown, losses, portfolio halt, overrides, price validation |
| StrategyManager | 10 | Initialization, proving ground, promotion, serialization |
| PaperEngine | 11 | Slippage, VWAP, gas costs, PnL calculations |

---

## Setup

### Prerequisites
- Node.js 18+
- Ethereum wallet with Base ETH + USDC

### Install
```bash
git clone https://github.com/maxwellcm92/darwinfi.git
cd darwinfi
npm install
cd dapp && npm install && cd ..
```

### Configure
```bash
cp .env.example .env
# Required:
#   PRIVATE_KEY or LIT_PKP_PUBLIC_KEY + LIT_ACTION_IPFS_CID
#   VENICE_API_KEY
# Optional:
#   BASE_RPC_URL (defaults to public RPC)
#   DARWIN_VAULT_V2_ADDRESS (for vault integration)
```

### Deploy Contracts
```bash
npx hardhat compile
npx hardhat test                    # 86 tests
npx hardhat run scripts/deploy-v2.ts --network base
```

### Build DApp
```bash
cd dapp
npm run build                       # -> dapp/dist/
```

### Run Agent
```bash
npm start
```

---

## On-Chain Artifacts

| Contract | Base Address | Status |
|----------|-------------|--------|
| DarwinVaultV2 (ERC-4626) | [`0xb01aD1140d7acA150BF56D7516Bd44eE64970FE3`](https://basescan.org/address/0xb01aD1140d7acA150BF56D7516Bd44eE64970FE3) | Live |
| DarwinVault (v1) | [`0x02649973e13c5bb6aFFCD2d9d870bcd3BF8f446B`](https://basescan.org/address/0x02649973e13c5bb6aFFCD2d9d870bcd3BF8f446B) | Deprecated |
| StrategyExecutor | Deployed | Live |
| PerformanceLog | Deployed | Live |

**DarwinFi Wallet**: [`0xb2db53Db9a2349186F0214BC3e1bF08a195570e3`](https://basescan.org/address/0xb2db53Db9a2349186F0214BC3e1bF08a195570e3) (Base)

**ENS**: darwinfi.base.eth

---

## Built With

- **Claude** (Anthropic): Batch signal evaluation via Claude CLI
- **Venice AI**: Strategy evolution via 3 AI personas (Llama 3.3 70B)
- **Uniswap V3**: On-chain swap execution + Quoter V2 price feeds
- **Base**: Primary L2 chain (Coinbase)
- **Lit Protocol**: PKP cryptographic trading guardrails
- **OpenZeppelin v5**: ERC-4626, Ownable, ReentrancyGuard, Pausable
- **React 19 + Vite 6**: DApp frontend
- **wagmi + RainbowKit**: Wallet connection
- **Tailwind CSS v4**: Styling
- **Hardhat**: Smart contract development + testing
- **ethers.js v6**: Chain interaction
- **Claude Code**: Agent harness

---

## License

MIT License. See [LICENSE](LICENSE).

---

## Operational Costs

| Component | Daily Cost | Notes |
|-----------|-----------|-------|
| Venice AI (Llama 3.3 70B) | ~$0.30 | Strategy evolution, 15m/1h predictions |
| Claude Haiku | ~$0.00 | 1m/5m predictions (included in subscription) |
| Base L2 gas | ~$0.10 | Swaps + vault interactions |
| **Total** | **~$0.40/day** | vs projected 10% performance fee on profits |

---

*Built by Maxwell Morgan for the Synthesis Hackathon 2026. Agent harness: Claude Code.*
