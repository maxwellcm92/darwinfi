# DarwinFi Demo Video Script

**Target length:** 3-4 minutes
**Recording tool:** OBS Studio or Loom
**Upload:** YouTube (unlisted) for Devfolio embed

---

## Scene 1: Intro (30s)

**[Screen: DApp at corduroycloud.com/darwinfi/]**

> "This is DarwinFi -- an autonomous DeFi vault where AI trading strategies compete in a Darwinian tournament. The best strategies survive and manage real capital. The worst get replaced."

- Show the landing page / vault overview
- Point out: total assets, share price, vault address
- Highlight "ERC-4626 compliant" and "Base L2"

---

## Scene 2: Wallet Interaction (60s)

**[Screen: DApp wallet connect flow]**

> "Let's connect a wallet and interact with the vault."

1. Click Connect Wallet (MetaMask / WalletConnect)
2. Show the Portfolio tab -- share balance, deposit value
3. Demonstrate a deposit flow (or show a recent deposit tx)
4. Show the vault's on-chain state updating in real-time

> "Deposits mint dvUSDC shares. Share value increases as the AI agent generates trading profit."

---

## Scene 3: On-Chain Trade Cycle (60s)

**[Screen: Split -- terminal on left, BaseScan on right]**

> "Now the core product: the AI agent borrowing from the vault, executing trades, and returning funds."

1. Run `npx ts-node scripts/trade-cycle.ts` in terminal
2. Show each step completing: deposit, borrow, swap USDC->WETH, swap WETH->USDC, return, withdraw
3. Click a BaseScan link to show the real on-chain transaction
4. Highlight the round-trip cost (~$0.01 in swap fees)

> "Every step is an on-chain transaction on Base mainnet. Real USDC, real swaps through Uniswap V3, real vault accounting."

---

## Scene 4: Tournament + AI (60s)

**[Screen: DApp tournament leaderboard]**

> "DarwinFi runs 12 trading strategies simultaneously in a Darwinian tournament."

1. Show the Tournament tab -- 12 strategies ranked by composite score
2. Point out: win rates, PnL, Sharpe ratios, generation numbers
3. Show the Instinct prediction system -- multi-source signals feeding into trade decisions
4. Show the trade history feed with recent paper trades and live signals

> "Every 4 hours, the system runs an evolution cycle. Underperforming strategies get their parameters mutated or replaced entirely. Top performers pass their genes to the next generation."

---

## Scene 5: Architecture + Sponsors (30s)

**[Screen: README or architecture diagram]**

> "Built on Base L2 with ERC-4626 vaults, Uniswap V3 for execution, and Claude AI for evolutionary strategy design."

- Show the contract addresses on BaseScan
- Mention sponsor integrations: Base (L2), Uniswap (DEX), Lit Protocol (key management)
- Flash the GitHub repo / development log

> "DarwinFi: survival of the fittest, on-chain."

---

## Recording Tips

- Use a dark terminal theme to match the DApp aesthetic
- Keep the terminal font large enough to read on video
- Pause briefly after each step so viewers can read the output
- If a transaction takes time, narrate what's happening on-chain
- End with the DApp URL visible on screen

## Pre-Recording Checklist

- [ ] DApp running at corduroycloud.com/darwinfi/
- [ ] trade-cycle.ts tested and working
- [ ] Agent process running (for live tournament data)
- [ ] Wallet has sufficient USDC + ETH for gas
- [ ] Terminal positioned for clear screen recording
- [ ] BaseScan tab open for clicking tx links
