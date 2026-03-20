/**
 * DarwinFi Evolution Engine - AI Code Generation
 * Uses Venice AI (Llama 3.3 70B) to generate evolution proposals
 * via OpenAI-compatible API.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { EvolutionProposal, AntiLoopEntry } from './types';
import { PROJECT_ROOT, loadEvolutionConfig } from './config';
import { getFailedProposals, loadMemory } from './memory';

export interface ProposalContext {
  currentPnl: number;
  winRate: number;
  sharpeRatio: number;
  rolling24hPnl: number;
  failedProposals: AntiLoopEntry[];
  fileContents: Record<string, string>; // path -> content
}

interface AiProposalResponse {
  rationale: string;
  targetFiles: string[];
  diff: string;
}

const SYSTEM_PROMPT = `You are the DarwinFi Evolution Engine. Your purpose is to improve a DeFi trading bot's performance by generating targeted code changes.

RULES:
1. Output ONLY valid JSON with keys: rationale, targetFiles, diff
2. The "diff" must be in unified diff format (--- a/file, +++ b/file, @@ hunks)
3. Focus on improving PnL, win rate, and risk-adjusted returns
4. Respect existing function signatures - do not change exported interfaces
5. Only modify files you are told are evolvable
6. Do NOT import fs, child_process, net, http, or access process.env
7. Do NOT use eval(), new Function(), exec(), spawn(), or global state
8. Keep changes focused and small (under 200 added lines, 50 modified)
9. Each proposal should target one specific improvement

OUTPUT FORMAT (strict JSON, no markdown):
{
  "rationale": "Brief explanation of what this change improves and why",
  "targetFiles": ["src/path/to/file.ts"],
  "diff": "unified diff content"
}`;

function buildUserPrompt(
  zone: string,
  zoneDescription: string,
  context: ProposalContext,
  failedHistory: AntiLoopEntry[],
): string {
  let prompt = `## Current Performance
- Total PnL: $${context.currentPnl.toFixed(2)}
- Win Rate: ${(context.winRate * 100).toFixed(1)}%
- Sharpe Ratio: ${context.sharpeRatio.toFixed(3)}
- Rolling 24h PnL: $${context.rolling24hPnl.toFixed(2)}

## Target Zone: ${zone}
${zoneDescription}

## Evolvable Files:
`;

  for (const [filePath, content] of Object.entries(context.fileContents)) {
    prompt += `\n### ${filePath}\n\`\`\`typescript\n${content}\n\`\`\`\n`;
  }

  if (failedHistory.length > 0) {
    prompt += '\n## Previously Failed Proposals (DO NOT repeat these):\n';
    for (const entry of failedHistory) {
      prompt += `- [${entry.outcome}] Zone: ${entry.zone}, Files: ${entry.targetFiles.join(', ')}`;
      if (entry.rejectionReason) {
        prompt += ` -- Reason: ${entry.rejectionReason}`;
      }
      prompt += '\n';
    }
  }

  prompt += '\nGenerate a single improvement proposal as JSON.';
  return prompt;
}

function parseDiffStats(diff: string): { linesAdded: number; linesModified: number; filesChanged: number } {
  const lines = diff.split('\n');
  let added = 0;
  let modified = 0;
  const files = new Set<string>();

  for (const line of lines) {
    if (line.startsWith('+++') && !line.startsWith('+++ /dev/null')) {
      const filePath = line.replace('+++ b/', '').trim();
      if (filePath) files.add(filePath);
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      added++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      modified++;
    }
  }

  return { linesAdded: added, linesModified: modified, filesChanged: files.size || 1 };
}

export async function generateProposal(
  zone: string,
  zoneFiles: string[],
  zoneDescription: string,
  context: ProposalContext,
): Promise<EvolutionProposal | null> {
  const config = loadEvolutionConfig();
  const memory = loadMemory();

  if (!config.aiApiKey) {
    console.error('[Evolution] No AI API key configured');
    return null;
  }

  // Read current file contents
  const fileContents: Record<string, string> = {};
  for (const file of zoneFiles) {
    const fullPath = path.join(PROJECT_ROOT, file);
    try {
      if (fs.existsSync(fullPath)) {
        fileContents[file] = fs.readFileSync(fullPath, 'utf-8');
      }
    } catch {
      // Skip unreadable files
    }
  }
  context.fileContents = fileContents;

  // Get failed proposals for anti-loop injection
  const failedHistory = getFailedProposals(
    memory,
    zone,
    config.antiLoop.failedPromptsToInject,
  );

  const userPrompt = buildUserPrompt(zone, zoneDescription, context, failedHistory);

  try {
    const response = await fetch(config.aiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.aiApiKey}`,
      },
      body: JSON.stringify({
        model: config.aiModel,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[Evolution] AI API error ${response.status}: ${errText}`);
      return null;
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.error('[Evolution] AI returned empty response');
      return null;
    }

    // Parse the AI response as JSON
    let parsed: AiProposalResponse;
    try {
      // Try to extract JSON from the response (handle markdown code blocks)
      let jsonStr = content.trim();
      const jsonMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error('[Evolution] Failed to parse AI response as JSON');
      console.error('[Evolution] Raw response:', content.slice(0, 500));
      return null;
    }

    if (!parsed.rationale || !parsed.diff || !parsed.targetFiles) {
      console.error('[Evolution] AI response missing required fields');
      return null;
    }

    const diffHash = crypto.createHash('sha256').update(parsed.diff).digest('hex');
    const stats = parseDiffStats(parsed.diff);

    const proposal: EvolutionProposal = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      status: 'pending',
      targetZone: zone,
      targetFiles: parsed.targetFiles,
      rationale: parsed.rationale,
      diff: parsed.diff,
      diffHash,
      linesAdded: stats.linesAdded,
      linesModified: stats.linesModified,
      filesChanged: stats.filesChanged,
      aiModel: config.aiModel,
      aiPromptTokens: data.usage?.prompt_tokens || 0,
      aiCompletionTokens: data.usage?.completion_tokens || 0,
    };

    console.log(
      `[Evolution] Proposal generated: ${proposal.id.slice(0, 8)} | ` +
      `Zone: ${zone} | +${stats.linesAdded}/-${stats.linesModified} lines`,
    );

    return proposal;
  } catch (err) {
    console.error(
      '[Evolution] Failed to generate proposal:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
