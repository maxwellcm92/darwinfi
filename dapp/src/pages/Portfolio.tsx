import { useAccount } from "wagmi";
import { PortfolioCard } from "../components/PortfolioCard";
import { DepositCard } from "../components/DepositCard";
import { WithdrawCard } from "../components/WithdrawCard";

export function Portfolio() {
  const { isConnected } = useAccount();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-arcade text-sm text-darwin-text-bright tracking-wide">
          PORTFOLIO
        </h1>
      </div>

      {/* Main portfolio card */}
      <PortfolioCard />

      {/* Deposit + Withdraw */}
      {isConnected && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <DepositCard />
          <WithdrawCard />
        </div>
      )}

      {/* Transaction History placeholder */}
      <div className="bg-darwin-card border border-darwin-border rounded-lg p-5">
        <h3 className="font-arcade text-xs text-darwin-purple tracking-wider mb-4 text-glow-purple">
          TRANSACTION HISTORY
        </h3>

        {!isConnected ? (
          <p className="text-sm font-mono text-darwin-text-dim text-center py-4">
            Connect wallet to view transaction history.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-4 gap-2 px-3 py-2 border-b border-darwin-border">
              <span className="text-xs font-mono text-darwin-text-dim uppercase">Type</span>
              <span className="text-xs font-mono text-darwin-text-dim uppercase">Amount</span>
              <span className="text-xs font-mono text-darwin-text-dim uppercase">Shares</span>
              <span className="text-xs font-mono text-darwin-text-dim uppercase text-right">Date</span>
            </div>
            <div className="text-center py-8">
              <p className="text-sm font-mono text-darwin-text-dim">
                Transaction history will populate from on-chain events.
              </p>
              <p className="text-xs font-mono text-darwin-text-dim mt-1">
                Deposit and Withdraw events are indexed from the vault contract.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
