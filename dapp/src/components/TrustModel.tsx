import { useState } from "react";

const VAULT_ADDRESS = "0x4a55DEEC24C6b5c1aa6301b43b4D9680c10491d7";

interface TrustCardProps {
  icon: string;
  question: string;
  answer: string;
  detail: string;
  accentColor: "accent" | "purple" | "warning";
}

function TrustCard({ icon, question, answer, detail, accentColor }: TrustCardProps) {
  const colorMap = {
    accent: {
      border: "border-darwin-accent/30",
      bg: "bg-darwin-accent/10",
      text: "text-darwin-accent",
      iconBg: "bg-darwin-accent/20",
    },
    purple: {
      border: "border-darwin-purple/30",
      bg: "bg-darwin-purple/10",
      text: "text-darwin-purple",
      iconBg: "bg-darwin-purple/20",
    },
    warning: {
      border: "border-darwin-warning/30",
      bg: "bg-darwin-warning/10",
      text: "text-darwin-warning",
      iconBg: "bg-darwin-warning/20",
    },
  };
  const c = colorMap[accentColor];

  return (
    <div className={`bg-darwin-card/70 backdrop-blur-sm border ${c.border} rounded-xl p-5 transition-all duration-300 hover:shadow-lg hover:shadow-black/20`}>
      <div className={`w-10 h-10 rounded-lg ${c.iconBg} flex items-center justify-center mb-3`}>
        <span className="text-lg">{icon}</span>
      </div>
      <h4 className={`text-sm font-mono font-bold ${c.text} mb-2`}>
        {question}
      </h4>
      <p className="text-sm font-mono text-darwin-text-bright mb-2">
        {answer}
      </p>
      <p className="text-xs font-mono text-darwin-text-dim leading-relaxed">
        {detail}
      </p>
    </div>
  );
}

export function TrustModel() {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="space-y-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-xs font-mono text-darwin-text-dim hover:text-darwin-text transition-colors"
      >
        <span
          className="transition-transform duration-200"
          style={{ display: "inline-block", transform: expanded ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          {">"}
        </span>
        How does DarwinFi protect my funds?
      </button>

      {expanded && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-fade-in">
          <TrustCard
            icon="$"
            question="Where is my money?"
            answer="In a Solidity vault on Base L2."
            detail={`Your USDC is held in an auditable ERC-4626 smart contract (${VAULT_ADDRESS.slice(0, 6)}...${VAULT_ADDRESS.slice(-4)}) on Base. The vault code is immutable and verifiable on BaseScan.`}
            accentColor="accent"
          />
          <TrustCard
            icon="~"
            question="What trades does it make?"
            answer="AI trades within strict on-chain limits."
            detail="The agent can only trade approved tokens on Uniswap V3, with a max trade size of $1,000 USDC, restricted to Base chain. Every transaction is validated by a Lit Protocol PKP before signing."
            accentColor="purple"
          />
          <TrustCard
            icon="!"
            question="Can the bot rug me?"
            answer="No. Cryptographic + on-chain safeguards."
            detail="A Lit Protocol PKP signs every trade through an immutable IPFS policy. The vault enforces a 48-hour timelock on agent changes, 80% max borrow cap, 7-day borrow timeout, and emergency withdrawal that always works. Verify on BaseScan."
            accentColor="warning"
          />
        </div>
      )}
    </div>
  );
}
