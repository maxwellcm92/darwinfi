import { useEvolutionAPI, AuditEntry } from "../hooks/useEvolutionAPI";

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}

function getEventColor(event: string): string {
  if (event.includes("promoted")) return "text-green-400";
  if (event.includes("rollback") || event.includes("rolled_back")) return "text-red-400";
  if (event.includes("rejected")) return "text-yellow-400";
  if (event.includes("canary")) return "text-darwin-accent";
  if (event.includes("test")) return "text-blue-400";
  return "text-darwin-text";
}

function getEventIcon(event: string): string {
  if (event.includes("promoted")) return "[+]";
  if (event.includes("rollback")) return "[!]";
  if (event.includes("rejected")) return "[x]";
  if (event.includes("canary")) return "[~]";
  if (event.includes("created")) return "[*]";
  if (event.includes("test")) return "[t]";
  if (event.includes("validation")) return "[v]";
  return "[.]";
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  return (
    <div className="flex items-start gap-3 text-sm font-mono py-2 border-b border-darwin-border/20 last:border-0">
      <span className="text-darwin-text-dim whitespace-nowrap">
        {formatTimestamp(entry.timestamp)}
      </span>
      <span className={`whitespace-nowrap ${getEventColor(entry.event)}`}>
        {getEventIcon(entry.event)} {entry.event}
      </span>
      {entry.proposalId && (
        <span className="text-darwin-text-dim truncate">
          {entry.proposalId.slice(0, 12)}
        </span>
      )}
      {entry.details && Object.keys(entry.details).length > 0 && (
        <span className="text-darwin-text-dim truncate flex-1 text-right">
          {Object.entries(entry.details)
            .slice(0, 3)
            .map(([k, v]) => `${k}=${typeof v === "number" ? (v as number).toFixed(2) : v}`)
            .join(" ")}
        </span>
      )}
    </div>
  );
}

export function EvolutionAudit() {
  const { audit, auditLoading } = useEvolutionAPI();

  if (auditLoading) {
    return (
      <div className="text-center text-darwin-text-dim font-mono text-base py-8">
        Loading audit trail...
      </div>
    );
  }

  if (audit.length === 0) {
    return (
      <div className="text-center text-darwin-text-dim font-mono text-base py-8">
        No evolution activity yet. The engine runs every 6 hours.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-darwin-text-dim font-mono text-sm uppercase tracking-wider">
          Audit Trail
        </h3>
        <span className="text-darwin-text-dim text-sm font-mono">
          {audit.length} entries
        </span>
      </div>
      <div className="bg-darwin-card rounded-xl border border-darwin-border/30 p-4 max-h-96 overflow-y-auto">
        {audit.slice().reverse().map((entry, i) => (
          <AuditRow key={i} entry={entry} />
        ))}
      </div>
    </div>
  );
}
