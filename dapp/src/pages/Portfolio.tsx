import { useAccount } from "wagmi";
import { PortfolioCard } from "../components/PortfolioCard";
import { DepositCard } from "../components/DepositCard";
import { WithdrawCard } from "../components/WithdrawCard";
import { VAULT_ADDRESS } from "../lib/contracts";

export function Portfolio() {
  const { isConnected } = useAccount();

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="section-header text-darwin-text-bright text-sm">
          PORTFOLIO
        </h1>
      </div>

      {/* Main portfolio card */}
      <PortfolioCard />

      {/* Deposit + Withdraw */}
      {isConnected && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <DepositCard />
          <WithdrawCard />
        </div>
      )}

      {/* Transaction History placeholder */}
      <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-6 transition-all duration-300 hover:border-darwin-border/80 hover:shadow-lg hover:shadow-black/20">
        <h3 className="section-header text-darwin-purple text-glow-purple mb-4">
          TRANSACTION HISTORY
        </h3>

        {!isConnected ? (
          <p className="text-sm font-mono text-darwin-text-dim text-center py-4">
            Connect wallet to view transaction history.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-4 gap-2 px-3 py-2 border-b border-darwin-border/50">
              <span className="text-xs font-mono text-darwin-text-dim uppercase">Type</span>
              <span className="text-xs font-mono text-darwin-text-dim uppercase">Amount</span>
              <span className="text-xs font-mono text-darwin-text-dim uppercase">Shares</span>
              <span className="text-xs font-mono text-darwin-text-dim uppercase text-right">Date</span>
            </div>
            <div className="text-center py-8">
              <a
                href={`https://basescan.org/address/${VAULT_ADDRESS}#events`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-mono text-darwin-purple hover:text-darwin-accent transition-colors"
              >
                {"View all transactions on BaseScan ->"}
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
