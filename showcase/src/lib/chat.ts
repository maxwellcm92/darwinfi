// Chat types, guided flows, and utilities for the Darwin chatbot

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  cta?: FlowCTA;
  flowOptions?: FlowOption[];
}

export interface QuickReplyOption {
  label: string;
  value: string;
}

export interface FlowCTA {
  label: string;
  url: string;
}

export interface FlowOption {
  label: string;
  value: string;
}

export interface FlowBotStep {
  type: "bot";
  text: string;
  cta?: FlowCTA;
}

export interface FlowOptionsStep {
  type: "options";
  options: FlowOption[];
}

export type FlowStep = FlowBotStep | FlowOptionsStep;

// Guided conversation flows
export const CHAT_FLOWS: Record<string, FlowStep[]> = {
  "how-it-works": [
    {
      type: "bot",
      text: "DarwinFi is an **ERC-4626 vault** on Base L2. You deposit USDC and receive **dvUSDC shares** that appreciate as the vault profits from trading.",
    },
    {
      type: "bot",
      text: "Inside the vault, **12 trading strategies** compete simultaneously. Only the top performer trades live on Uniswap V3 -- the rest paper trade with real prices, fighting to dethrone the champion.",
    },
    {
      type: "bot",
      text: "Every 4 hours, the **Evolution Engine** kicks in. Venice AI (Llama 3.3 70B) mutates strategy parameters using 3 AI personas: Mutant (wildcard), Tuner (optimizer), and Hybrid (best-of-all).",
    },
    {
      type: "bot",
      text: "The champion strategy borrows USDC from the vault, executes swaps on **Uniswap V3**, and returns the proceeds. Every transaction is signed by a **Lit Protocol PKP** -- cryptographic proof the agent follows the rules.",
    },
    {
      type: "bot",
      text: "The result: an autonomous trading vault where strategies evolve like organisms. The fittest survive, the weakest adapt or get replaced. Your capital benefits from continuous AI-driven optimization.",
      cta: { label: "Launch DApp", url: "https://corduroycloud.com/darwinfi/" },
    },
  ],

  safety: [
    {
      type: "bot",
      text: "Every transaction is signed by a **Lit Protocol PKP** (Programmable Key Pair). An IPFS-hosted Lit Action enforces the trading policy before signing -- the agent literally cannot execute unauthorized transactions. The policy is immutable on IPFS.",
    },
    {
      type: "bot",
      text: "**Circuit breakers** protect at multiple levels: per-strategy drawdown limits, portfolio-wide halt conditions, consecutive loss limits, and price validation checks. The immune system has 7 divisions monitoring for anomalies.",
    },
    {
      type: "bot",
      text: "Even in the worst case, you can always use **emergency withdrawal** -- it works even when the vault is paused. Plus: 1-hour lock (anti-flash-loan), 10K USDC TVL cap, and 1K USDC per-trade limit enforced cryptographically.",
      cta: { label: "View Vault on BaseScan", url: "https://basescan.org/address/0xb01aD1140d7acA150BF56D7516Bd44eE64970FE3" },
    },
  ],

  evolution: [
    {
      type: "bot",
      text: "The Evolution Engine is the heart of DarwinFi -- it is what makes strategies improve over time without human intervention. What aspect interests you most?",
    },
    {
      type: "options",
      options: [
        { label: "Strategy competition", value: "evolution-competition" },
        { label: "Scoring formula", value: "evolution-scoring" },
        { label: "AI mutation process", value: "evolution-mutation" },
      ],
    },
  ],

  "evolution-competition": [
    {
      type: "bot",
      text: "**3 main strategies** compete for the live trading slot: Apex (momentum), Viper (mean-revert), and Blitz (breakout). Each has 3 variations (Mutant, Tuner, Hybrid) that evolve to challenge their parent.",
    },
    {
      type: "bot",
      text: "Only the highest-scoring main strategy trades live on-chain via Uniswap V3. The other 11 paper trade with real price feeds. When a variation outscores its parent, it gets promoted -- true Darwinian selection.",
    },
  ],

  "evolution-scoring": [
    {
      type: "bot",
      text: "Each strategy gets a **composite fitness score** calculated from 5 weighted metrics: 24h PnL (30%), Sharpe ratio with Bessel correction (25%), win rate (20%), total PnL (15%), and inverse max drawdown (10%).",
    },
    {
      type: "bot",
      text: "All metrics are sigmoid-normalized so no single outlier dominates. The formula rewards consistent, risk-adjusted returns over lucky single trades -- exactly how natural selection favors sustained fitness over one-time advantages.",
    },
  ],

  "evolution-mutation": [
    {
      type: "bot",
      text: "**Venice AI** (Llama 3.3 70B) drives mutation with 3 specialized personas matching the variation roles. The Mutant persona explores unconventional parameters. The Tuner conservatively fixes weaknesses. The Hybrid synthesizes the best traits.",
    },
    {
      type: "bot",
      text: "Evolution cycles run every 4 hours or every 10 trades. Claude analyzes performance data, Venice generates new parameters, and the fittest variations get promoted. It is genetic algorithms meets DeFi, powered by dual-AI collaboration.",
    },
  ],

  architecture: [
    {
      type: "bot",
      text: "DarwinFi runs a **dual-AI system**: Claude (Anthropic) handles trade signal evaluation and performance analysis. Venice AI (Llama 3.3 70B) handles strategy evolution with 3 AI personas. Two independent AI systems with complementary strengths.",
    },
    {
      type: "bot",
      text: "**On-chain**: DarwinVaultV2 (ERC-4626) holds deposits. StrategyExecutor routes swaps through Uniswap V3. PerformanceLog records every trade and evolution event immutably. All on Base L2 for low gas costs.",
    },
    {
      type: "bot",
      text: "**Off-chain**: The Darwin Agent orchestrates everything -- 3 tick speeds (1min/5min/15min), strategy management, circuit breakers, and vault integration. A Lit Protocol PKP signs every transaction through an IPFS-hosted policy.",
    },
    {
      type: "bot",
      text: "**Sponsor integrations**: Base (L2), Uniswap (trading), Venice AI (evolution), Lit Protocol (security), Filecoin/IPFS (storage), ENS/Basenames (identity: darwinfi.base.eth), Lido (wstETH trading). Total operational cost: ~$0.40/day.",
      cta: { label: "View Source", url: "https://github.com/maxwellcm92/darwinfi" },
    },
  ],
};

// Page-specific greetings with contextual quick replies
export const PAGE_GREETINGS: Record<
  string,
  { message: string; quickReplies: QuickReplyOption[] }
> = {
  "/": {
    message:
      "Welcome to DarwinFi -- the autonomous DeFi vault where trading strategies evolve to survive. I am Darwin, your guide to the ecosystem. What would you like to explore?",
    quickReplies: [
      { label: "How does it work?", value: "How does it work?" },
      { label: "Is it safe?", value: "Is it safe?" },
      { label: "Tell me about evolution", value: "Tell me about evolution" },
      { label: "Technical architecture", value: "Technical architecture" },
    ],
  },
  "/results": {
    message:
      "You are looking at live data from the DarwinFi vault on Base L2. Every number here comes from real on-chain activity and the agent's actual trading performance.",
    quickReplies: [
      { label: "How is the score calculated?", value: "How is the composite score calculated?" },
      { label: "What do the strategies do?", value: "Tell me about the 12 strategies" },
      { label: "Is it safe?", value: "Is it safe?" },
    ],
  },
  "/story": {
    message:
      "This is DarwinFi's build story -- from concept to deployed vault, every decision documented. Built in 10 sessions using Claude Code as the agent harness.",
    quickReplies: [
      { label: "How does it work?", value: "How does it work?" },
      { label: "Technical architecture", value: "Technical architecture" },
      { label: "Who built this?", value: "Who built DarwinFi?" },
    ],
  },
  "/product": {
    message:
      "Ready to see the DApp in action? The vault is live on Base L2 -- you can deposit USDC and earn from AI-evolved trading strategies right now.",
    quickReplies: [
      { label: "How do I deposit?", value: "How do I deposit into the vault?" },
      { label: "Is it safe?", value: "Is it safe?" },
      { label: "How does it work?", value: "How does it work?" },
    ],
  },
};

// Map quick reply labels to guided flow IDs
export const QUICK_REPLY_FLOW_MAP: Record<string, string> = {
  "How does it work?": "how-it-works",
  "Is it safe?": "safety",
  "Tell me about evolution": "evolution",
  "Technical architecture": "architecture",
};

// Generate a UUID v4 session ID
export function generateSessionId(): string {
  return crypto.randomUUID();
}

// Get or create a stored session ID
export function getStoredSessionId(): string {
  const key = "darwinfi-chat-session";
  if (typeof window === "undefined") return generateSessionId();
  let id = localStorage.getItem(key);
  if (!id) {
    id = generateSessionId();
    localStorage.setItem(key, id);
  }
  return id;
}

// SSE stream chat with the API
export function streamChat(opts: {
  message: string;
  sessionId: string;
  pathname: string;
  signal?: AbortSignal;
  onChunk: (text: string) => void;
  onError: (error: string) => void;
  onDone: () => void;
  onSuggestedActions?: (actions: Array<{ label: string; value: string }>) => void;
}) {
  const { message, sessionId, pathname, signal, onChunk, onError, onDone, onSuggestedActions } = opts;

  fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sessionId, pathname }),
    signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        onError(`Chat error (${res.status})`);
        onDone();
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        onError("No response stream");
        onDone();
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();

          if (payload === "[DONE]") {
            onDone();
            return;
          }

          try {
            const data = JSON.parse(payload);
            if (data.type === "content" && data.text) {
              onChunk(data.text);
            } else if (data.type === "suggested_actions" && data.actions && onSuggestedActions) {
              onSuggestedActions(data.actions);
            } else if (data.type === "error") {
              onError(data.message || "Unknown error");
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      onDone();
    })
    .catch((err) => {
      if (err.name !== "AbortError") {
        onError("Connection failed. Please try again.");
      }
      onDone();
    });
}
