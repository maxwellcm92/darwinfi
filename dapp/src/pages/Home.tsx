import { VaultOverview } from "../components/VaultOverview";
import { DepositCard } from "../components/DepositCard";
import { WithdrawCard } from "../components/WithdrawCard";
import { AgentStatus } from "../components/AgentStatus";
import { TradesFeed } from "../components/TradesFeed";
import { InstinctSummary } from "../components/InstinctSummary";
import { useDarwinFiAPI } from "../hooks/useDarwinFiAPI";
import { useInstinctAPI } from "../hooks/useInstinctAPI";

export function Home() {
  const { agentState, agentLoading, trades, tradesLoading } = useDarwinFiAPI();
  const { instinctState, instinctLoading } = useInstinctAPI();

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

      {/* Instinct Summary */}
      <InstinctSummary instinctState={instinctState} loading={instinctLoading} />

      {/* Recent Trades */}
      <TradesFeed trades={trades} loading={tradesLoading} />
    </div>
  );
}
