import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";

const SESSION_DIR = "/tmp/darwinfi-chat-sessions";
const MAX_SESSIONS_PER_IP = 5;
const MAX_MESSAGES_PER_SESSION = 30;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const PROCESS_TIMEOUT_MS = 120_000;
const KILL_GRACE_MS = 5_000;
const MAX_HISTORY_MESSAGES = 20;

// In-memory rate limiting
const ipSessions = new Map<string, { sessions: Set<string>; expiry: number }>();
const sessionMessages = new Map<string, { count: number; expiry: number }>();

function hashIP(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

function isValidUUIDv4(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function checkRateLimit(ipHash: string, sessionId: string): string | null {
  const now = Date.now();

  // Clean expired entries
  for (const [key, val] of ipSessions) {
    if (val.expiry < now) ipSessions.delete(key);
  }
  for (const [key, val] of sessionMessages) {
    if (val.expiry < now) sessionMessages.delete(key);
  }

  // Check IP session limit
  let ipData = ipSessions.get(ipHash);
  if (!ipData) {
    ipData = { sessions: new Set(), expiry: now + RATE_WINDOW_MS };
    ipSessions.set(ipHash, ipData);
  }
  ipData.sessions.add(sessionId);
  if (ipData.sessions.size > MAX_SESSIONS_PER_IP) {
    return "Too many chat sessions. Please try again later.";
  }

  // Check message limit per session
  let msgData = sessionMessages.get(sessionId);
  if (!msgData) {
    msgData = { count: 0, expiry: now + RATE_WINDOW_MS };
    sessionMessages.set(sessionId, msgData);
  }
  msgData.count++;
  if (msgData.count > MAX_MESSAGES_PER_SESSION) {
    return "Message limit reached for this session. Please start a new session.";
  }

  return null;
}

interface ConversationEntry {
  role: "user" | "assistant";
  content: string;
}

function loadSession(sessionId: string): ConversationEntry[] {
  try {
    const filePath = path.join(SESSION_DIR, `${sessionId}.json`);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (Array.isArray(data)) return data;
    }
  } catch {
    // Corrupted session file, start fresh
  }
  return [];
}

function saveSession(sessionId: string, history: ConversationEntry[]): void {
  try {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    const filePath = path.join(SESSION_DIR, `${sessionId}.json`);
    // Keep only recent history to prevent unbounded growth
    const trimmed = history.slice(-MAX_HISTORY_MESSAGES);
    fs.writeFileSync(filePath, JSON.stringify(trimmed));
  } catch {
    // Non-critical failure
  }
}

function loadSystemPrompt(): string {
  try {
    // Try multiple locations -- standalone Next.js builds may not have the expected cwd
    const locations = [
      path.join(process.cwd(), "DARWINFI-CLAUDE.md"),
      path.join(__dirname, "../../../../DARWINFI-CLAUDE.md"),
      "/opt/murphy/darwinfi/showcase/DARWINFI-CLAUDE.md",
    ];
    for (const loc of locations) {
      if (fs.existsSync(loc)) {
        return fs.readFileSync(loc, "utf-8");
      }
    }
    return "You are Darwin, the AI guide for DarwinFi, an autonomous self-evolving DeFi vault on Base L2. Be helpful, concise, and use evolution metaphors.";
  } catch {
    return "You are Darwin, the AI guide for DarwinFi, an autonomous self-evolving DeFi vault on Base L2. Be helpful, concise, and use evolution metaphors.";
  }
}

function buildPrompt(
  systemPrompt: string,
  history: ConversationEntry[],
  userMessage: string
): string {
  let prompt = systemPrompt + "\n\n---\n\n";

  // Add recent conversation history
  const recent = history.slice(-10);
  if (recent.length > 0) {
    prompt += "## Recent Conversation\n\n";
    for (const entry of recent) {
      const speaker = entry.role === "user" ? "User" : "Darwin";
      prompt += `**${speaker}**: ${entry.content}\n\n`;
    }
  }

  prompt += `**User**: ${userMessage}\n\n**Darwin**:`;
  return prompt;
}

function parseSuggestedActions(
  text: string
): { cleanText: string; actions: Array<{ label: string; value: string }> | null } {
  const regex = /\[SUGGESTED_ACTIONS\]\s*([\s\S]*?)\s*\[\/SUGGESTED_ACTIONS\]/;
  const match = text.match(regex);

  if (!match) {
    return { cleanText: text, actions: null };
  }

  const cleanText = text.replace(regex, "").trim();

  try {
    const actions = JSON.parse(match[1].trim());
    if (Array.isArray(actions)) {
      return { cleanText, actions };
    }
  } catch {
    // Malformed actions block
  }

  return { cleanText, actions: null };
}

export async function POST(request: NextRequest) {
  let body: { message?: string; sessionId?: string; pathname?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { message, sessionId, pathname } = body;

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return new Response(JSON.stringify({ error: "Message required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!sessionId || !isValidUUIDv4(sessionId)) {
    return new Response(JSON.stringify({ error: "Valid session ID required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Truncate message to prevent abuse
  const userMessage = message.trim().slice(0, 2000);

  // Rate limiting
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  const ipHash = hashIP(ip);
  const rateLimitError = checkRateLimit(ipHash, sessionId);
  if (rateLimitError) {
    return new Response(JSON.stringify({ error: rateLimitError }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Load session and build prompt
  const history = loadSession(sessionId);
  const systemPrompt = loadSystemPrompt();
  const fullPrompt = buildPrompt(systemPrompt, history, userMessage);
  const base64Prompt = Buffer.from(fullPrompt).toString("base64");

  // Create SSE stream
  const encoder = new TextEncoder();
  let processKilled = false;

  const stream = new ReadableStream({
    start(controller) {
      const claudePath = "/usr/bin/claude";
      const proc = spawn(
        "bash",
        ["-c", `printf '%s' "$PROMPT_B64" | base64 -d | ${claudePath} -p --model claude-haiku-4-5-20251001 2>/dev/null`],
        { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PROMPT_B64: base64Prompt } }
      );

      let fullResponse = "";
      let timeoutId: ReturnType<typeof setTimeout>;
      let killId: ReturnType<typeof setTimeout>;

      // Timeout handling
      timeoutId = setTimeout(() => {
        processKilled = true;
        proc.kill("SIGTERM");
        killId = setTimeout(() => {
          try {
            proc.kill("SIGKILL");
          } catch {
            // Already dead
          }
        }, KILL_GRACE_MS);
      }, PROCESS_TIMEOUT_MS);

      proc.stdout.on("data", (data: Buffer) => {
        const text = data.toString();
        fullResponse += text;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "content", text })}\n\n`)
          );
        } catch {
          // Controller closed
        }
      });

      proc.stderr.on("data", () => {
        // Ignore stderr noise from claude CLI
      });

      proc.on("close", (code) => {
        clearTimeout(timeoutId);
        clearTimeout(killId);

        // Parse suggested actions from full response
        const { cleanText, actions } = parseSuggestedActions(fullResponse);

        if (actions) {
          try {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "suggested_actions", actions })}\n\n`
              )
            );
          } catch {
            // Controller closed
          }
        }

        // Save conversation
        history.push({ role: "user", content: userMessage });
        if (cleanText) {
          history.push({ role: "assistant", content: cleanText });
        }
        saveSession(sessionId, history);

        if (processKilled) {
          try {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "error", message: "Response timed out" })}\n\n`
              )
            );
          } catch {
            // Controller closed
          }
        }

        try {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch {
          // Controller already closed
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timeoutId);
        clearTimeout(killId);
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", message: "Failed to process request" })}\n\n`
            )
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch {
          // Controller closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
