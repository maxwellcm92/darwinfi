import { useVaultStats } from "../hooks/useVaultStats";
import { VAULT_ADDRESS, BASENAME, AGENT_ADDRESS } from "../lib/constants";

function formatUSD(value: string | null): string {
  if (value == null) return "--";
  const num = parseFloat(value);
  if (isNaN(num)) return "--";
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function StatCard({
  label,
  value,
  suffix,
  accent,
}: {
  label: string;
  value: string;
  suffix?: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-6 transition-all duration-300 hover:border-darwin-border/80 hover:shadow-lg hover:shadow-black/20">
      <p className="text-darwin-text-dim text-sm font-mono uppercase tracking-wider mb-2">
        {label}
      </p>
      <p
        className={`text-2xl font-mono font-bold ${
          accent ? "text-darwin-accent text-glow-accent" : "text-darwin-text-bright"
        }`}
      >
        {value}
        {suffix && (
          <span className="text-base text-darwin-text-dim ml-1">{suffix}</span>
        )}
      </p>
    </div>
  );
}

function StatSkeleton() {
  return (
    <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-6">
      <div className="skeleton-text w-24 mb-3" />
      <div className="skeleton-value w-32" />
    </div>
  );
}

export function VaultOverview() {
  const {
    tvl,
    sharePrice,
    available,
    borrowed,
    maxCapacity,
    paused,
    feeBps,
    mgmtFeeBps,
  } = useVaultStats();

  const isLoading = tvl == null && sharePrice == null;

  const utilizationPct =
    tvl && borrowed && parseFloat(tvl) > 0
      ? ((parseFloat(borrowed) / parseFloat(tvl)) * 100).toFixed(1)
      : null;

  const capacityPct =
    tvl && maxCapacity && parseFloat(maxCapacity) > 0
      ? ((parseFloat(tvl) / parseFloat(maxCapacity)) * 100).toFixed(1)
      : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="section-header text-darwin-text-bright">
          VAULT STATUS
        </h2>
        {paused && (
          <span className="px-3 py-1 bg-darwin-danger/20 text-darwin-danger text-sm font-mono rounded border border-darwin-danger/40 animate-pulse-glow">
            PAUSED
          </span>
        )}
      </div>

      {/* Vault identity */}
      <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <div>
          <span className="text-sm font-mono text-darwin-text-dim mr-2">Vault:</span>
          <a
            href={`https://basescan.org/address/${VAULT_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-base font-mono text-darwin-accent hover:underline"
            title={String(VAULT_ADDRESS)}
          >
            {BASENAME}
          </a>
          <span className="text-sm font-mono text-darwin-text-dim ml-2">
            ({String(VAULT_ADDRESS).slice(0, 6)}...{String(VAULT_ADDRESS).slice(-4)})
          </span>
        </div>
        <div>
          <span className="text-sm font-mono text-darwin-text-dim mr-2">Agent:</span>
          <a
            href={`https://basescan.org/address/${AGENT_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-base font-mono text-darwin-accent hover:underline"
            title={AGENT_ADDRESS}
          >
            {BASENAME}
          </a>
          <span className="text-sm font-mono text-darwin-text-dim ml-2">
            ({AGENT_ADDRESS.slice(0, 6)}...{AGENT_ADDRESS.slice(-4)})
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {isLoading ? (
          <>
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
          </>
        ) : (
          <>
            <StatCard
              label="Total Value Locked"
              value={`$${formatUSD(tvl)}`}
              accent
            />
            <StatCard
              label="Share Price"
              value={sharePrice ? `$${parseFloat(sharePrice).toFixed(6)}` : "--"}
            />
            <StatCard
              label="Available USDC"
              value={`$${formatUSD(available)}`}
            />
            <StatCard
              label="Agent Borrowed"
              value={`$${formatUSD(borrowed)}`}
            />
            <StatCard
              label="Max Capacity"
              value={`$${formatUSD(maxCapacity)}`}
            />
          </>
        )}
      </div>

      {/* Utilization bar */}
      <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-6 transition-all duration-300 hover:border-darwin-border/80">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-mono text-darwin-text-dim uppercase">
            Vault Utilization
          </span>
          <span className="text-sm font-mono text-darwin-text">
            {utilizationPct != null ? `${utilizationPct}%` : "--"} borrowed
            {" / "}
            {capacityPct != null ? `${capacityPct}%` : "--"} filled
          </span>
        </div>
        <div className="w-full h-2 bg-darwin-bg rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-darwin-accent to-darwin-purple rounded-full transition-all duration-500"
            style={{
              width: `${capacityPct ? Math.min(parseFloat(capacityPct), 100) : 0}%`,
            }}
          />
        </div>
        {(mgmtFeeBps != null || feeBps != null) && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2">
            {mgmtFeeBps != null && (
              <p className="text-sm font-mono text-darwin-text-dim">
                Management Fee: {(mgmtFeeBps / 100).toFixed(1)}% / yr
              </p>
            )}
            {feeBps != null && (
              <p className="text-sm font-mono text-darwin-text-dim">
                Performance Fee: {(feeBps / 100).toFixed(1)}%
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
