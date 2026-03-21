const faqs = [
  {
    q: "What is DarwinFi?",
    a: "DarwinFi is an autonomous DeFi vault on Base L2. You deposit USDC, and AI-managed trading strategies compete to generate yield. The best-performing strategy trades live on Uniswap V3 while underperformers are eliminated -- survival of the fittest, applied to DeFi.",
  },
  {
    q: "How does the AI decide what to trade?",
    a: "16 strategies run simultaneously, each with different trading logic. A fitness evaluation ranks them by risk-adjusted returns. The champion strategy gets to execute real trades. Every evolution cycle, the weakest strategies are replaced by mutated versions of the strongest ones.",
  },
  {
    q: "Is my money safe?",
    a: "Your USDC is held in an auditable ERC-4626 smart contract on Base. Every trade is validated and signed by a Lit Protocol Programmable Key Pair (PKP) that enforces whitelisted contracts, tokens, and size limits. The agent cannot transfer funds to unauthorized addresses.",
  },
  {
    q: "What are dvUSDC shares?",
    a: "When you deposit USDC, you receive dvUSDC shares representing your proportional ownership of the vault. As the vault profits from trading, the share price increases -- meaning your dvUSDC is worth more USDC when you withdraw.",
  },
  {
    q: "How do I withdraw?",
    a: "Enter the USDC amount you want to withdraw and click Withdraw. The vault converts your request to the equivalent dvUSDC shares and redeems them. You receive USDC directly to your wallet. There may be a short lock period after depositing.",
  },
  {
    q: "What fees does DarwinFi charge?",
    a: "DarwinFi charges a 1% annual management fee and a 5% performance fee on profits above a high-water mark. There are no deposit or withdrawal fees.",
  },
];

export function FAQ() {
  return (
    <div className="space-y-6">
      <h1 className="font-serif text-2xl font-bold text-darwin-text-bright">
        Frequently Asked Questions
      </h1>
      <div className="space-y-4">
        {faqs.map((item, i) => (
          <div
            key={i}
            className="bg-darwin-card/70 backdrop-blur-sm border border-darwin-border/50 rounded-xl p-5"
          >
            <h3 className="text-sm font-sans font-bold text-darwin-text-bright mb-2">
              {item.q}
            </h3>
            <p className="text-sm font-sans text-darwin-text-dim leading-relaxed">
              {item.a}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
