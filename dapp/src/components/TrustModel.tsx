import { Link } from "react-router-dom";

export function TrustModel() {
  return (
    <div className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-5">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 rounded-lg bg-darwin-accent/20 border border-darwin-accent/30 flex items-center justify-center">
            <svg className="w-5 h-5 text-darwin-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
        </div>
        <p className="text-sm font-sans text-darwin-text leading-relaxed flex-1">
          Audited ERC-4626 vault on Base. On-chain trade limits with 80% max borrow cap.
          Lit Protocol signed transactions. 48h timelock on agent changes.
          Emergency withdraw always works.
        </p>
        <Link
          to="/faq"
          className="text-sm font-mono text-darwin-accent hover:text-darwin-text-bright transition-colors whitespace-nowrap shrink-0"
        >
          {"Read the FAQ ->"}
        </Link>
      </div>
    </div>
  );
}
