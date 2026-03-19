/**
 * DarwinFi Claude CLI Engine
 *
 * Uses the Claude Code Max subscription (claude -p CLI) for signal evaluation.
 * This replaces per-token API calls with free CLI calls, dropping costs from
 * ~$65-75/2wk to ~$2-5/2wk.
 *
 * Batch mode: evaluates multiple snapshots/positions in a single CLI call
 * to minimize subprocess overhead.
 */

import { execSync } from 'child_process';
import { StrategyGenome } from './strategy-manager';
import { MarketSnapshot, EntrySignal, ExitSignal, TokenRecommendation } from './venice-engine';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLI_TIMEOUT_MS = 60_000;
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

// ---------------------------------------------------------------------------
// ClaudeCliEngine
// ---------------------------------------------------------------------------

export class ClaudeCliEngine {
  constructor() {
    console.log('[DarwinFi] Claude CLI engine initialized (subscription-based signals)');
  }

  /**
   * Batch evaluate entry signals for multiple snapshots in one CLI call.
   */
  async evaluateEntry(
    strategy: StrategyGenome,
    snapshots: MarketSnapshot[],
  ): Promise<EntrySignal[]> {
    if (snapshots.length === 0) return [];

    const systemPrompt = `You are a crypto trading signal engine. Analyze market data and decide whether to enter trades based on the strategy parameters. Be decisive and quantitative.

RESPOND WITH ONLY a JSON array of objects, one per token:
[
  {
    "token": "...",
    "action": "buy" or "skip",
    "confidence": 0-100,
    "reasoning": "1-2 sentences",
    "suggestedSize": 0-100,
    "suggestedEntry": <price>,
    "suggestedStop": <price>,
    "suggestedTarget": <price>
  }
]`;

    const tokenData = snapshots.map(s =>
      `${s.token}: $${s.price} | 1h:${s.priceChange1h.toFixed(2)}% | 24h:${s.priceChange24h.toFixed(2)}% | Vol:$${s.volume24h.toLocaleString()}${s.rsi !== undefined ? ` | RSI:${s.rsi.toFixed(0)}` : ''}${s.macd !== undefined ? ` | MACD:${s.macd.toFixed(4)}` : ''}`
    ).join('\n');

    const userPrompt = `Strategy: ${strategy.name}
Entry Method: ${strategy.parameters.entryMethod} (threshold: ${strategy.parameters.entryThreshold})
Exit Method: ${strategy.parameters.exitMethod}
Trailing Stop: ${strategy.parameters.trailingStopPct}%
Take Profit: ${strategy.parameters.takeProfitPct}%
Timeframe: ${strategy.parameters.timeframe}
Indicators: ${strategy.parameters.indicators.join(', ')}
Risk Per Trade: ${strategy.parameters.riskPerTradePct}%

Market Data:
${tokenData}

Evaluate each token for entry.`;

    const response = this.callCli(systemPrompt, userPrompt);
    const parsed = this.parseJson<Array<Omit<EntrySignal, 'token'> & { token: string }>>(response);

    if (!parsed || !Array.isArray(parsed)) {
      console.warn('[DarwinFi] Claude CLI entry parse failed, returning skips');
      return snapshots.map(s => this.defaultSkipSignal(s, strategy));
    }

    // Map responses back, filling defaults for any missing tokens
    return snapshots.map(snapshot => {
      const match = parsed.find(p => p.token === snapshot.token);
      if (!match) return this.defaultSkipSignal(snapshot, strategy);

      return {
        token: snapshot.token,
        action: match.action === 'buy' ? 'buy' as const : 'skip' as const,
        confidence: Math.max(0, Math.min(100, match.confidence || 0)),
        reasoning: match.reasoning || 'No reasoning',
        suggestedSize: Math.max(0, Math.min(100, match.suggestedSize || 0)),
        suggestedEntry: match.suggestedEntry || snapshot.price,
        suggestedStop: match.suggestedStop || snapshot.price * (1 - strategy.parameters.trailingStopPct / 100),
        suggestedTarget: match.suggestedTarget || snapshot.price * (1 + strategy.parameters.takeProfitPct / 100),
      };
    });
  }

  /**
   * Batch evaluate exit signals for multiple positions in one CLI call.
   */
  async evaluateExit(
    strategy: StrategyGenome,
    positions: Array<{
      token: string;
      snapshot: MarketSnapshot;
      entryPrice: number;
      currentPnlPct: number;
      holdTimeMinutes: number;
    }>,
  ): Promise<ExitSignal[]> {
    if (positions.length === 0) return [];

    const systemPrompt = `You are a crypto trading exit engine. Analyze open positions and decide whether to hold, sell, or tighten stops. Protect capital first, then maximize gains.

RESPOND WITH ONLY a JSON array of objects, one per position:
[
  {
    "token": "...",
    "action": "hold" or "sell" or "tighten_stop",
    "confidence": 0-100,
    "reasoning": "1-2 sentences",
    "suggestedExitPrice": <price or null>,
    "newStopPrice": <price or null>
  }
]`;

    const positionData = positions.map(p =>
      `${p.token}: entry=$${p.entryPrice} current=$${p.snapshot.price} pnl=${p.currentPnlPct.toFixed(2)}% hold=${p.holdTimeMinutes}min${p.snapshot.rsi !== undefined ? ` RSI:${p.snapshot.rsi.toFixed(0)}` : ''}${p.snapshot.macd !== undefined ? ` MACD:${p.snapshot.macd.toFixed(4)}` : ''}`
    ).join('\n');

    const userPrompt = `Strategy: ${strategy.name}
Exit Method: ${strategy.parameters.exitMethod}
Trailing Stop: ${strategy.parameters.trailingStopPct}%
Take Profit: ${strategy.parameters.takeProfitPct}%
Timeframe: ${strategy.parameters.timeframe}

Open Positions:
${positionData}

Evaluate each position for exit.`;

    const response = this.callCli(systemPrompt, userPrompt);
    const parsed = this.parseJson<Array<Omit<ExitSignal, 'token'> & { token: string }>>(response);

    if (!parsed || !Array.isArray(parsed)) {
      console.warn('[DarwinFi] Claude CLI exit parse failed, defaulting to hold');
      return positions.map(p => ({
        token: p.token,
        action: 'hold' as const,
        confidence: 0,
        reasoning: 'Failed to parse CLI response, defaulting to hold',
      }));
    }

    return positions.map(p => {
      const match = parsed.find(r => r.token === p.token);
      if (!match) {
        return {
          token: p.token,
          action: 'hold' as const,
          confidence: 0,
          reasoning: 'No response for this token, defaulting to hold',
        };
      }

      const validActions: ExitSignal['action'][] = ['hold', 'sell', 'tighten_stop'];
      const action = validActions.includes(match.action as ExitSignal['action'])
        ? (match.action as ExitSignal['action'])
        : 'hold' as const;

      return {
        token: p.token,
        action,
        confidence: Math.max(0, Math.min(100, match.confidence || 0)),
        reasoning: match.reasoning || 'No reasoning',
        suggestedExitPrice: match.suggestedExitPrice || undefined,
        newStopPrice: match.newStopPrice || undefined,
      };
    });
  }

  /**
   * Get token selection recommendations via CLI.
   */
  async recommendTokens(
    strategy: StrategyGenome,
    snapshots: MarketSnapshot[],
  ): Promise<TokenRecommendation[]> {
    const systemPrompt = `You are a crypto token selection engine. Rank tokens by trading opportunity quality. Focus on momentum, volume, and volatility alignment with the strategy.

RESPOND WITH ONLY a JSON array:
[
  {
    "token": "...",
    "score": 0-100,
    "reasoning": "1 sentence",
    "suggestedTimeframe": "1m|5m|15m|1h",
    "keyLevels": { "support": <price>, "resistance": <price> }
  }
]
Return AT MOST 5 tokens, sorted by score descending.`;

    const tokenSummaries = snapshots.map(s =>
      `${s.token}: $${s.price} | 1h:${s.priceChange1h.toFixed(1)}% | 24h:${s.priceChange24h.toFixed(1)}% | Vol:$${s.volume24h.toLocaleString()}${s.rsi !== undefined ? ` | RSI:${s.rsi.toFixed(0)}` : ''}`
    ).join('\n');

    const userPrompt = `Strategy: ${strategy.name}
Entry Method: ${strategy.parameters.entryMethod}
Preferred Tokens: ${strategy.parameters.tokenPreferences.join(', ')}
Timeframe: ${strategy.parameters.timeframe}

Available Tokens:
${tokenSummaries}

Rank the best trading opportunities right now.`;

    const response = this.callCli(systemPrompt, userPrompt);
    const parsed = this.parseJson<TokenRecommendation[]>(response);

    if (!parsed || !Array.isArray(parsed)) {
      console.warn('[DarwinFi] Claude CLI token recommendation parse failed');
      return [];
    }

    return parsed
      .filter(r => r && r.token && typeof r.score === 'number')
      .map(r => ({
        token: r.token,
        score: Math.max(0, Math.min(100, r.score)),
        reasoning: r.reasoning || '',
        suggestedTimeframe: r.suggestedTimeframe || strategy.parameters.timeframe,
        keyLevels: {
          support: r.keyLevels?.support || 0,
          resistance: r.keyLevels?.resistance || 0,
        },
      }))
      .slice(0, 5);
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private callCli(systemPrompt: string, userPrompt: string): string {
    const prompt = JSON.stringify({
      system: systemPrompt,
      user: userPrompt,
    });

    try {
      const result = execSync(
        `echo ${this.shellEscape(userPrompt)} | claude -p --model ${CLAUDE_MODEL} --output-format json --system-prompt ${this.shellEscape(systemPrompt)}`,
        {
          timeout: CLI_TIMEOUT_MS,
          encoding: 'utf-8',
          maxBuffer: 1024 * 1024,
          env: { ...process.env, HOME: process.env.HOME || '/home/maxwell', CLAUDECODE: '' },
        },
      );

      // claude -p --output-format json returns {"result":"...","is_error":false,...}
      // Extract the actual text result
      try {
        const envelope = JSON.parse(result.trim());
        if (envelope.result) {
          return envelope.result;
        }
      } catch {
        // Not JSON envelope, return raw
      }

      return result.trim();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[DarwinFi] Claude CLI call failed: ${msg}`);
      throw err;
    }
  }

  private shellEscape(str: string): string {
    // Use $'...' quoting with escaped single quotes and special chars
    return "'" + str.replace(/'/g, "'\\''") + "'";
  }

  private defaultSkipSignal(snapshot: MarketSnapshot, strategy: StrategyGenome): EntrySignal {
    return {
      token: snapshot.token,
      action: 'skip',
      confidence: 0,
      reasoning: 'CLI evaluation unavailable',
      suggestedSize: 0,
      suggestedEntry: snapshot.price,
      suggestedStop: snapshot.price * (1 - strategy.parameters.trailingStopPct / 100),
      suggestedTarget: snapshot.price * (1 + strategy.parameters.takeProfitPct / 100),
    };
  }

  private parseJson<T>(raw: string): T | null {
    try {
      // Extract JSON array or object from the response, ignoring surrounding text/fences
      const arrayMatch = raw.match(/\[[\s\S]*\]/);
      const objectMatch = raw.match(/\{[\s\S]*\}/);

      // Prefer array match (our prompts ask for arrays)
      const jsonStr = arrayMatch ? arrayMatch[0] : objectMatch ? objectMatch[0] : null;
      if (!jsonStr) {
        console.error('[DarwinFi] No JSON found in Claude CLI response');
        console.error(`[DarwinFi] Raw response: ${raw.substring(0, 300)}`);
        return null;
      }

      return JSON.parse(jsonStr) as T;
    } catch (err) {
      console.error(
        '[DarwinFi] JSON parse error from Claude CLI:',
        err instanceof Error ? err.message : err,
      );
      console.error(`[DarwinFi] Raw response: ${raw.substring(0, 300)}`);
      return null;
    }
  }
}
