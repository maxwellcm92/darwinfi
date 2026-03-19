import { useAccount } from "wagmi";
import { useVaultStats } from "../hooks/useVaultStats";

export function PortfolioCard() {
  const { isConnected, address } = useAccount();
  const {
    userShares,
    userShareValue,
    userUsdc,
    sharePrice,
    userDepositTimestamp,
    lockSeconds,
  } = useVaultStats();

  if (!isConnected) {
    return (
      <div className="bg-darwin-card border border-darwin-border rounded-lg p-8 text-center">
        <p className="font-arcade text-xs text-darwin-text-dim mb-2">
          CONNECT YOUR WALLET
        </p>
        <p className="text-sm font-mono text-darwin-text-dim">
          Connect your wallet to view your portfolio position.
        </p>
      </div>
    );
  }

  const sharesNum = userShares ? parseFloat(userShares) : 0;
  const valueNum = userShareValue ? parseFloat(userShareValue) : 0;
  const sharePriceNum = sharePrice ? parseFloat(sharePrice) : 1;

  // Estimated PnL: (current value - cost basis)
  // Cost basis approximation: shares * 1.0 (initial price)
  // In reality, this would track actual deposit amounts, but for the frontend
  // we approximate using the difference from 1.0 share price
  const costBasis = sharesNum * 1.0; // Assumes deposited at 1:1
  const estimatedPnl = valueNum - costBasis;
  const pnlPct = costBasis > 0 ? (estimatedPnl / costBasis) * 100 : 0;

  const now = Math.floor(Date.now() / 1000);
  const isLocked =
    lockSeconds != null &&
    userDepositTimestamp != null &&
    userDepositTimestamp > 0 &&
    now < userDepositTimestamp + lockSeconds;

  return (
    <div className="bg-darwin-card border border-darwin-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-arcade text-xs text-darwin-accent tracking-wider">
          YOUR POSITION
        </h3>
        {isLocked && (
          <span className="px-2 py-1 bg-darwin-warning/20 text-darwin-warning text-xs font-mono rounded border border-darwin-warning/30">
            LOCKED
          </span>
        )}
      </div>

      <div className="space-y-4">
        {/* Address */}
        <div className="bg-darwin-bg rounded p-3">
          <p className="text-xs font-mono text-darwin-text-dim mb-1">Connected Address</p>
          <p className="text-sm font-mono text-darwin-text-bright break-all">
            {address}
          </p>
        </div>

        {/* Position Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-darwin-bg rounded p-3">
            <p className="text-xs font-mono text-darwin-text-dim mb-1">dvUSDC Shares</p>
            <p className="text-lg font-mono text-darwin-text-bright font-bold">
              {sharesNum.toLocaleString("en-US", { maximumFractionDigits: 6 })}
            </p>
          </div>
          <div className="bg-darwin-bg rounded p-3">
            <p className="text-xs font-mono text-darwin-text-dim mb-1">Current Value</p>
            <p className="text-lg font-mono text-darwin-accent font-bold">
              ${valueNum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="bg-darwin-bg rounded p-3">
            <p className="text-xs font-mono text-darwin-text-dim mb-1">Share Price</p>
            <p className="text-lg font-mono text-darwin-text-bright font-bold">
              ${sharePriceNum.toFixed(6)}
            </p>
          </div>
          <div className="bg-darwin-bg rounded p-3">
            <p className="text-xs font-mono text-darwin-text-dim mb-1">Est. PnL</p>
            <p
              className={`text-lg font-mono font-bold ${
                estimatedPnl >= 0 ? "text-darwin-accent" : "text-darwin-danger"
              }`}
            >
              {estimatedPnl >= 0 ? "+" : ""}
              ${Math.abs(estimatedPnl).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-xs ml-1">
                ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)
              </span>
            </p>
          </div>
        </div>

        {/* Wallet USDC balance */}
        <div className="flex items-center justify-between bg-darwin-bg rounded p-3">
          <span className="text-xs font-mono text-darwin-text-dim">Wallet USDC Balance</span>
          <span className="text-sm font-mono text-darwin-text-bright">
            ${userUsdc ? parseFloat(userUsdc).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "0.00"}
          </span>
        </div>
      </div>
    </div>
  );
}
