"use client";

interface QuickReplyProps {
  options: Array<{ label: string; value: string }>;
  onSelect: (value: string) => void;
  disabled?: boolean;
}

export function QuickReply({ options, onSelect, disabled }: QuickReplyProps) {
  if (options.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-4 py-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onSelect(opt.value)}
          disabled={disabled}
          className="px-3 py-1.5 text-sm font-medium rounded-lg border border-darwin-border bg-darwin-card text-darwin-text hover:border-darwin-accent/50 hover:text-darwin-accent transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
