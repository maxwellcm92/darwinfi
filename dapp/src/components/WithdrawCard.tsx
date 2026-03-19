import { useState } from "react";
import { useAccount } from "wagmi";
import { useVaultStats } from "../hooks/useVaultStats";
import { useVaultWithdraw } from "../hooks/useVaultWithdraw";

export function WithdrawCard() {
  const { isConnected } = useAccount();
  const { userShares, userShareValue, lockSeconds, userDepositTimestamp } =
    useVaultStats();
  const { step, error, redeem, reset, isRedeeming, isRedeemConfirmed, redeemTxHash } =
    useVaultWithdraw();

  const [amount, setAmount] = useState("");

  const handleMax = () => {
    if (userShares) {
      setAmount(userShares);
    }
  };

  const handleSubmit = () => {
    if (!amount || parseFloat(amount) <= 0) return;
    redeem(amount);
  };

  const handleReset = () => {
    setAmount("");
    reset();
  };

  // Lock time check
  const now = Math.floor(Date.now() / 1000);
  const isLocked =
    lockSeconds != null &&
    userDepositTimestamp != null &&
    userDepositTimestamp > 0 &&
    now < userDepositTimestamp + lockSeconds;

  const unlockTime =
    isLocked && userDepositTimestamp != null && lockSeconds != null
      ? new Date((userDepositTimestamp + lockSeconds) * 1000)
      : null;

  const isSuccess = isRedeemConfirmed;

  return (
    <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-6 transition-all duration-300 hover:border-darwin-border/80 hover:shadow-lg hover:shadow-black/20">
      <h3 className="section-header text-darwin-purple text-glow-purple mb-4">
        WITHDRAW
      </h3>

      {/* User position summary */}
      <div className="bg-darwin-bg rounded-lg p-4 mb-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono text-darwin-text-dim">Your dvUSDC</span>
          <span className="text-sm font-mono text-darwin-text-bright">
            {userShares ? parseFloat(userShares).toLocaleString("en-US", { maximumFractionDigits: 6 }) : "0.00"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono text-darwin-text-dim">Estimated Value</span>
          <span className="text-sm font-mono text-darwin-accent">
            ${userShareValue ? parseFloat(userShareValue).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "0.00"}
          </span>
        </div>
      </div>

      {/* Lock warning */}
      {isLocked && unlockTime && (
        <div className="mb-4 p-3 bg-darwin-warning/10 border border-darwin-warning/30 rounded-lg">
          <p className="text-xs font-mono text-darwin-warning">
            Funds locked until {unlockTime.toLocaleString()}
          </p>
        </div>
      )}

      {/* Amount Input */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-mono text-darwin-text-dim">Shares to Redeem</label>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={isRedeeming || isSuccess}
              className="w-full bg-darwin-bg border border-darwin-border rounded-lg px-3 py-3 text-darwin-text-bright font-mono text-lg
                focus:border-darwin-purple focus:outline-none focus:ring-1 focus:ring-darwin-purple/30
                disabled:opacity-50 disabled:cursor-not-allowed
                placeholder:text-darwin-text-dim/40"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-darwin-text-dim text-sm font-mono">
              dvUSDC
            </span>
          </div>
          <button
            onClick={handleMax}
            disabled={isRedeeming || isSuccess || !userShares}
            className="px-3 py-3 bg-darwin-purple/10 text-darwin-purple border border-darwin-purple/30 rounded-lg
              text-xs font-mono uppercase tracking-wider
              hover:bg-darwin-purple/20 transition-all active:scale-[0.97]
              disabled:opacity-30 disabled:cursor-not-allowed"
          >
            MAX
          </button>
        </div>
      </div>

      {/* Action Button */}
      {!isConnected ? (
        <div className="text-center py-3 text-darwin-text-dim text-sm font-mono">
          Connect wallet to withdraw
        </div>
      ) : isSuccess ? (
        <div className="space-y-3">
          <div className="text-center py-3 text-darwin-accent font-mono text-sm glow-accent rounded-lg border border-darwin-accent/30 bg-darwin-accent/5">
            Withdrawal successful!
          </div>
          {redeemTxHash && (
            <a
              href={`https://basescan.org/tx/${redeemTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-center text-xs font-mono text-darwin-purple hover:text-darwin-accent transition-colors"
            >
              {"View on BaseScan ->"}
            </a>
          )}
          <button
            onClick={handleReset}
            className="w-full py-3 bg-darwin-card-hover text-darwin-text border border-darwin-border rounded-lg
              font-mono text-sm hover:border-darwin-purple/30 transition-all active:scale-[0.97]"
          >
            New Withdrawal
          </button>
        </div>
      ) : (
        <button
          onClick={handleSubmit}
          disabled={
            isRedeeming ||
            isLocked ||
            !amount ||
            parseFloat(amount) <= 0 ||
            (userShares != null && parseFloat(amount) > parseFloat(userShares))
          }
          className="w-full py-3 rounded-lg font-mono text-sm font-bold uppercase tracking-wider transition-all duration-200
            bg-darwin-purple text-darwin-text-bright
            hover:shadow-lg hover:shadow-darwin-purple/20
            active:scale-[0.97]
            disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:shadow-none"
        >
          {isRedeeming
            ? "Withdrawing..."
            : isLocked
              ? "Locked"
              : "Withdraw"}
        </button>
      )}

      {/* Error display */}
      {error && (
        <div className="mt-3 p-3 bg-darwin-danger/10 border border-darwin-danger/30 rounded-lg">
          <p className="text-darwin-danger text-xs font-mono break-all">
            {error.length > 200 ? error.substring(0, 200) + "..." : error}
          </p>
          <button
            onClick={handleReset}
            className="mt-2 text-xs font-mono text-darwin-text-dim hover:text-darwin-text transition-colors"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
