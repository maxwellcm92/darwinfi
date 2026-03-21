# Getting Started with DarwinFi

A step-by-step guide for depositing USDC into the DarwinFi vault and earning yield from AI-managed trading.

## Prerequisites

Before you begin, you need:
- **A Web3 wallet** (MetaMask, Coinbase Wallet, or Rainbow)
- **USDC on Base** (the Base L2 network, chain ID 8453)
- **A small amount of ETH on Base** for gas fees (less than $0.01 per transaction)

If you don't have USDC on Base yet, you can bridge from Ethereum mainnet using the [Base Bridge](https://bridge.base.org/) or buy directly on Base through your wallet.

## Step 1: Connect Your Wallet

1. Go to [https://corduroycloud.com/darwinfi/](https://corduroycloud.com/darwinfi/)
2. Click **"Connect Wallet"** in the top-right corner
3. Select your wallet provider (MetaMask, Coinbase Wallet, etc.)
4. Approve the connection request in your wallet
5. Make sure you're on the **Base** network (the DApp will prompt you to switch if needed)

## Step 2: Deposit USDC

1. On the home page, you'll see the **Deposit** card
2. Enter the amount of USDC you want to deposit (minimum: any amount)
3. Click **"Approve"** -- this allows the vault contract to access your USDC (one-time per amount)
4. After approval confirms, click **"Deposit"**
5. Confirm the transaction in your wallet
6. You'll receive **dvUSDC shares** representing your proportional ownership of the vault

## Step 3: Monitor Your Position

Once deposited, the home page shows:
- **Your Position** -- current value of your dvUSDC shares in USDC
- **Share Price** -- the current price of one dvUSDC share (starts at $1.000000)
- **Share Price Chart** -- historical price trend
- **Agent PnL** -- the trading agent's cumulative profit/loss

The AI trading agent borrows USDC from the vault, executes trades on Uniswap V3, and returns proceeds. If the agent profits, the share price increases and your position grows.

You can also explore:
- **Tournament** tab -- see which of the 16 strategies is currently the champion
- **Portfolio** tab -- detailed view of your shares and transaction history
- **Advanced** tab -- deep dive into strategy genomes and evolution history

## Step 4: Withdraw Anytime

1. Navigate to the **Portfolio** tab or find the Withdraw card on the home page
2. Enter the USDC amount you want to withdraw
3. Click **"Withdraw"**
4. Confirm the transaction in your wallet
5. Your dvUSDC shares are burned and you receive USDC

**Note:** There may be a short lock period after depositing. Emergency withdrawals are always available and work even if the vault is paused.

## Fees

- **Management fee:** 1% per year (collected automatically via share price)
- **Performance fee:** 5% on profits above a high-water mark
- **No deposit or withdrawal fees**

## FAQ

**Q: What happens if the trading agent loses money?**
A: The share price decreases, meaning your dvUSDC is worth less USDC. DarwinFi uses adaptive circuit breakers that halt trading during drawdowns and recovery mode that re-enters at reduced position sizing. Emergency withdrawals are always available.

**Q: How often does the agent trade?**
A: The agent evaluates trading opportunities continuously. Trade frequency depends on market conditions and which strategy is the current champion.

**Q: Can I see what trades the agent is making?**
A: Yes. The home page shows a live trades feed, and all trades are logged on-chain via the PerformanceLog contract, independently verifiable on [BaseScan](https://basescan.org/address/0x7d7433A4aD04D6AD85E82Ce43CC4535ADb2fc9c9).

**Q: What is the minimum deposit?**
A: There is no minimum. You can deposit any amount of USDC.

**Q: Is this audited?**
A: DarwinFi is a hackathon-stage project. The "Unaudited" banner on the DApp is intentional transparency. The V4 vault has 96 dedicated tests covering all security features, and the full test suite has 488 tests across 27+ modules.
