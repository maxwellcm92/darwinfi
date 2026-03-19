"use client";

import { usePollAPI } from "@/hooks/usePollAPI";
import type { VaultStats } from "@/lib/api";

function StatCard({
  label,
  value,
  prefix,
  suffix,
  loading,
}: {
  label: string;
  value: string | number | undefined;
  prefix?: string;
  suffix?: string;
  loading: boolean;
}) {
  return (
    <div className="darwin-card text-center">
      <p className="section-header text-darwin-text-dim mb-2">{label}</p>
      {loading ? (
        <div className="skeleton h-8 w-24 mx-auto" />
      ) : (
        <p className="text-2xl font-bold text-darwin-text-bright count-fade-in">
          {prefix}
          {value ?? "--"}
          {suffix}
        </p>
      )}
    </div>
  );
}

export function LiveVaultStats() {
  const { data, loading } = usePollAPI<VaultStats>("/api/vault", 10000);

  const formatUSD = (n?: number) =>
    n != null
      ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : undefined;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        label="Total Value Locked"
        value={formatUSD(data?.tvl)}
        prefix="$"
        loading={loading}
      />
      <StatCard
        label="Share Price"
        value={formatUSD(data?.sharePrice)}
        prefix="$"
        loading={loading}
      />
      <StatCard
        label="Depositors"
        value={data?.depositors}
        loading={loading}
      />
      <StatCard
        label="Capacity"
        value={
          data?.capacity != null
            ? `$${formatUSD(data.capacity)}`
            : undefined
        }
        loading={loading}
      />
    </div>
  );
}
