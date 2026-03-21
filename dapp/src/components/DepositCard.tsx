import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { useVaultStats } from "../hooks/useVaultStats";
import { useVaultDeposit } from "../hooks/useVaultDeposit";

export function DepositCard() {
  const { isConnected } = useAccount();
  const { userUsdc, paused } = useVaultStats();
  const {
    step,
    error,
    needsApproval,
    approve,
    deposit,
    reset,
    isApproving,
    isApproveConfirmed,
    isDepositing,
    isDepositConfirmed,
    approveTxHash,
    depositTxHash,
  } = useVaultDeposit();

  const [amount, setAmount] = useState("");

  // Auto-proceed to deposit after approval confirms
  useEffect(() => {
    if (isApproveConfirmed && step === "approved" && amount) {
      deposit(amount);
    }
  }, [isApproveConfirmed, step, amount, deposit]);

  const handleMax = () => {
    if (userUsdc) {
      setAmount(userUsdc);
    }
  };

  const handleSubmit = () => {
    if (!amount || parseFloat(amount) <= 0) return;

    if (needsApproval(amount)) {
      approve(amount);
    } else {
      deposit(amount);
    }
  };

  const handleReset = () => {
    setAmount("");
    reset();
  };

  const isLoading = isApproving || isDepositing;
  const isSuccess = isDepositConfirmed;

  return (
    <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-6 transition-all duration-300 hover:border-darwin-border/80 hover:shadow-lg hover:shadow-black/20">
      <h3 className="section-header text-darwin-text-bright mb-4">
        DEPOSIT USDC
      </h3>

      {/* Amount Input */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-mono text-darwin-text-dim">Amount</label>
          <span className="text-xs font-mono text-darwin-text-dim">
            Balance: {userUsdc ? parseFloat(userUsdc).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "--"} USDC
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={isLoading || isSuccess}
              className="w-full bg-darwin-bg border border-darwin-border rounded-lg px-3 py-3 text-darwin-text-bright font-mono text-lg
                focus:border-darwin-accent focus:outline-none focus:ring-1 focus:ring-darwin-accent/30
                disabled:opacity-50 disabled:cursor-not-allowed
                placeholder:text-darwin-text-dim/40"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-darwin-text-dim text-sm font-mono">
              USDC
            </span>
          </div>
          <button
            onClick={handleMax}
            disabled={isLoading || isSuccess || !userUsdc}
            className="px-3 py-3 bg-darwin-accent/10 text-darwin-accent border border-darwin-accent/30 rounded-lg
              text-xs font-mono uppercase tracking-wider
              hover:bg-darwin-accent/20 transition-all active:scale-[0.97]
              disabled:opacity-30 disabled:cursor-not-allowed"
          >
            MAX
          </button>
        </div>
      </div>

      {/* Action Button */}
      {!isConnected ? (
        <div className="text-center py-3 text-darwin-text-dim text-sm font-mono">
          Connect wallet to deposit
        </div>
      ) : isSuccess ? (
        <div className="space-y-3">
          <div className="text-center py-3 text-darwin-accent font-mono text-sm glow-accent rounded-lg border border-darwin-accent/30 bg-darwin-accent/5">
            Deposit successful!
          </div>
          {depositTxHash && (
            <a
              href={`https://basescan.org/tx/${depositTxHash}`}
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
              font-mono text-sm hover:border-darwin-accent/30 transition-all active:scale-[0.97]"
          >
            New Deposit
          </button>
        </div>
      ) : (
        <button
          onClick={handleSubmit}
          disabled={
            isLoading ||
            paused ||
            !amount ||
            parseFloat(amount) <= 0
          }
          className="w-full py-3 rounded-lg font-mono text-sm font-bold uppercase tracking-wider transition-all duration-200
            bg-darwin-accent text-darwin-bg btn-shine
            hover:shadow-lg hover:shadow-darwin-accent/20
            active:scale-[0.97]
            disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:shadow-none"
        >
          {isApproving
            ? "Approving USDC..."
            : isDepositing
              ? "Depositing..."
              : paused
                ? "Vault Paused"
                : needsApproval(amount)
                  ? "Approve & Deposit"
                  : "Deposit"}
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

      {/* Pending tx indicator */}
      {approveTxHash && isApproving && (
        <p className="mt-2 text-xs font-mono text-darwin-text-dim animate-pulse-glow">
          Waiting for approval confirmation...
        </p>
      )}
    </div>
  );
}
