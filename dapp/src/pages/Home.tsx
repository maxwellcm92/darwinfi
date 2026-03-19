import { VaultOverview } from "../components/VaultOverview";
import { DepositCard } from "../components/DepositCard";
import { WithdrawCard } from "../components/WithdrawCard";
import { AgentStatus } from "../components/AgentStatus";
import { TradesFeed } from "../components/TradesFeed";
import { useDarwinFiAPI } from "../hooks/useDarwinFiAPI";

export function Home() {
  const { agentState, agentLoading, trades, tradesLoading } = useDarwinFiAPI();

  return (
    <div className="space-y-6">
      {/* Vault Overview */}
      <VaultOverview />

      {/* Deposit + Withdraw side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DepositCard />
        <WithdrawCard />
      </div>

      {/* Agent Status */}
      <AgentStatus agentState={agentState} loading={agentLoading} />

      {/* Recent Trades */}
      <TradesFeed trades={trades} loading={tradesLoading} />
    </div>
  );
}
