import * as dotenv from "dotenv";

dotenv.config();

// Synthesis Hackathon Registration
// Requires questionnaire answers from Maxwell

interface RegistrationPayload {
  agent: {
    name: string;
    description: string;
    harness: string;
    model: string;
    problemStatement: string;
  };
  participant: {
    name: string;
    email: string;
    social: string;
    background: string;
    cryptoExperience: string;
    aiExperience: string;
    codingComfort: number;
  };
}

async function register(payload: RegistrationPayload): Promise<void> {
  console.log("[DarwinFi] Submitting hackathon registration...");

  const response = await fetch("https://synthesis.devfolio.co/register", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: payload.agent.name,
      description: payload.agent.description,
      agentHarness: payload.agent.harness,
      model: payload.agent.model,
      problemStatement: payload.agent.problemStatement,
      humanInfo: {
        name: payload.participant.name,
        email: payload.participant.email,
        social: payload.participant.social,
        background: payload.participant.background,
        cryptoExperience: payload.participant.cryptoExperience,
        aiAgentExperience: payload.participant.aiExperience,
        codingComfort: payload.participant.codingComfort,
        problemToSolve: payload.agent.problemStatement,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Registration failed: ${response.status} - ${body}`);
  }

  const result = await response.json();
  console.log("[DarwinFi] Registration successful!");
  console.log("[DarwinFi] Response:", JSON.stringify(result, null, 2));

  // If API key is returned, save it
  if ((result as Record<string, string>).api_key) {
    console.log(`\nAdd to .env:\nSYNTHESIS_API_KEY=${(result as Record<string, string>).api_key}`);
  }
}

// Pre-filled agent info (Maxwell approves description)
const agentInfo = {
  name: "DarwinFi",
  description: "An autonomous, self-evolving trading agent that uses Darwinian competition between 12 concurrent strategies on Uniswap V3 (Base + Celo). The top-performing strategy trades live on-chain; the rest paper trade and compete to dethrone it. Strategies are evolved by AI (Claude + Venice AI) analyzing performance metrics and generating parameter variations across three roles: Mad Scientist (creative exploration), Optimizer (conservative improvements), and Synthesizer (hybrid best-of-all). All trades, evolution events, and strategy genomes are logged on-chain and pinned to IPFS for full transparency.",
  harness: "claude-code",
  model: "claude-opus-4-6",
  problemStatement: "Autonomous agents managing real money need transparent, auditable decision-making with built-in risk controls. DarwinFi solves this by creating a self-improving trading system where strategy performance is publicly verifiable on-chain, spending scopes are enforced by smart contracts, and the AI evolution process is fully logged. The Darwinian competition mechanism ensures continuous improvement without human intervention, while per-strategy budget limits cap downside risk.",
};

// Participant info
const participantInfo = {
  name: "Maxwell Morgan",
  email: "maxwell.morgan@creativesolarusa.com",
  social: "@maxcm92 (X) | github.com/maxwellcm92 | linkedin.com/in/themaxwellmorgan/",
  background: "builder",
  cryptoExperience: "yes",
  aiExperience: "yes",
  codingComfort: 7,
};

// Only run if all fields are filled
if (participantInfo.name && participantInfo.email) {
  register({ agent: agentInfo, participant: participantInfo }).catch(console.error);
} else {
  console.log("[DarwinFi] Registration script ready.");
  console.log("[DarwinFi] Fill in participant info in scripts/register.ts, then run:");
  console.log("  npx ts-node scripts/register.ts");
  console.log("\nAgent info (pre-filled):");
  console.log(JSON.stringify(agentInfo, null, 2));
  console.log("\nParticipant info (needs Maxwell's answers):");
  console.log(JSON.stringify(participantInfo, null, 2));
}
