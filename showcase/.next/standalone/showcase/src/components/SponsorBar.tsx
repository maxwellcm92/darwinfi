import { SPONSORS } from "@/lib/constants";

export function SponsorBar() {
  return (
    <div className="py-12 border-y border-darwin-border/20">
      <p className="section-header text-darwin-text-dim text-center mb-8">
        Built With
      </p>
      <div className="flex flex-wrap items-center justify-center gap-8 md:gap-12">
        {SPONSORS.map((s) => (
          <div
            key={s.name}
            className="flex items-center gap-2 text-darwin-text-dim hover:text-darwin-text transition-colors"
          >
            <div className="w-8 h-8 rounded-lg bg-darwin-card border border-darwin-border/50 flex items-center justify-center text-sm font-bold font-mono">
              {s.name.charAt(0)}
            </div>
            <span className="text-base font-medium">{s.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
