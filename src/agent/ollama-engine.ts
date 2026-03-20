/**
 * DarwinFi Ollama Engine
 *
 * HTTP client to KS RTX 3090 via Tailscale for local LLM inference.
 * Same interface pattern as VeniceEngine/ClaudeCliEngine.
 * Model: gemma2:9b (2-3s response time, fits in KS system memory)
 */

import { StrategyGenome } from './strategy-manager';
import { MarketSnapshot, EntrySignal, ExitSignal, TokenRecommendation } from './venice-engine';

const DEFAULT_OLLAMA_URL = 'http://100.89.161.12:30068';
const DEFAULT_MODEL = 'gemma2:9b';
const TIMEOUT_MS = 15_000;

interface OllamaGenerateResponse {
  response: string;
  done: boolean;
  total_duration?: number;
  eval_count?: number;
}

export class OllamaEngine {
  private baseUrl: string;
  private model: string;

  constructor(baseUrl?: string, model?: string) {
    this.baseUrl = baseUrl || process.env.OLLAMA_URL || DEFAULT_OLLAMA_URL;
    this.model = model || process.env.OLLAMA_MODEL || DEFAULT_MODEL;
    console.log(`[DarwinFi] Ollama engine initialized: ${this.baseUrl} model=${this.model}`);
  }

  /**
   * Health check -- returns true if Ollama is responsive.
   */
  async isHealthy(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Raw prompt -> structured JSON response.
   */
  async generate(systemPrompt: string, userPrompt: string): Promise<string> {
    const prompt = `${systemPrompt}\n\n${userPrompt}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          options: {
            temperature: 0.3,
            num_predict: 1024,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
      }

      const data = (await res.json()) as OllamaGenerateResponse;
      const evalTime = data.total_duration ? (data.total_duration / 1e9).toFixed(2) : '?';
      console.log(`[Ollama] Response in ${evalTime}s, ${data.eval_count || '?'} tokens`);
      return data.response;
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  /**
   * Batch evaluate entry signals (same interface as ClaudeCliEngine).
   */
  async evaluateEntry(
    strategy: StrategyGenome,
    snapshots: MarketSnapshot[],
  ): Promise<EntrySignal[]> {
    if (snapshots.length === 0) return [];

    const systemPrompt = `You are a crypto trading signal engine. Analyze market data and decide whether to enter trades. Output ONLY a JSON array.

SCORING RUBRIC:
- Entry condition mathematically met: confidence 60-85
- Close to threshold (within 15%): confidence 40-59
- Not close: confidence below 40
- Volume + momentum aligned: add 10 to confidence

Output format:
[{"token":"...","action":"buy"|"skip","confidence":0-100,"reasoning":"brief","suggestedSize":0-100,"suggestedEntry":price,"suggestedStop":price,"suggestedTarget":price}]`;

    const tokenData = snapshots.map(s =>
      `${s.token}: $${s.price} | 1h:${s.priceChange1h.toFixed(2)}% | 24h:${s.priceChange24h.toFixed(2)}% | Vol:$${s.volume24h.toLocaleString()}${s.rsi !== undefined ? ` | RSI:${s.rsi.toFixed(0)}` : ''}${s.macd !== undefined ? ` | MACD:${s.macd.toFixed(4)}` : ''}`
    ).join('\n');

    const userPrompt = `Strategy: ${strategy.name}
Entry: ${strategy.parameters.entryMethod} (threshold: ${strategy.parameters.entryThreshold})
Exit: ${strategy.parameters.exitMethod}, Stop: ${strategy.parameters.trailingStopPct}%, TP: ${strategy.parameters.takeProfitPct}%
Timeframe: ${strategy.parameters.timeframe}

Market Data:
${tokenData}

Evaluate each token for entry.`;

    try {
      const response = await this.generate(systemPrompt, userPrompt);
      const parsed = this.parseJson<Array<{ token: string; action: string; confidence: number; reasoning: string; suggestedSize: number; suggestedEntry: number; suggestedStop: number; suggestedTarget: number }>>(response);

      if (!parsed || !Array.isArray(parsed)) {
        return snapshots.map(s => this.defaultSkipSignal(s, strategy));
      }

      return snapshots.map(snapshot => {
        const match = parsed.find(p => p.token === snapshot.token);
        if (!match) return this.defaultSkipSignal(snapshot, strategy);

        return {
          token: snapshot.token,
          action: match.action === 'buy' ? 'buy' as const : 'skip' as const,
          confidence: Math.max(0, Math.min(100, match.confidence || 0)),
          reasoning: match.reasoning || 'Ollama signal',
          suggestedSize: Math.max(0, Math.min(100, match.suggestedSize || 0)),
          suggestedEntry: match.suggestedEntry || snapshot.price,
          suggestedStop: match.suggestedStop || snapshot.price * (1 - strategy.parameters.trailingStopPct / 100),
          suggestedTarget: match.suggestedTarget || snapshot.price * (1 + strategy.parameters.takeProfitPct / 100),
        };
      });
    } catch (err) {
      console.error('[Ollama] Entry evaluation failed:', (err as Error).message);
      return snapshots.map(s => this.defaultSkipSignal(s, strategy));
    }
  }

  /**
   * Batch evaluate exit signals.
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

    const systemPrompt = `You are a crypto exit engine. Decide hold/sell/tighten_stop for open positions. Output ONLY a JSON array.
[{"token":"...","action":"hold"|"sell"|"tighten_stop","confidence":0-100,"reasoning":"brief","suggestedExitPrice":null,"newStopPrice":null}]`;

    const positionData = positions.map(p =>
      `${p.token}: entry=$${p.entryPrice} current=$${p.snapshot.price} pnl=${p.currentPnlPct.toFixed(2)}% hold=${p.holdTimeMinutes}min${p.snapshot.rsi !== undefined ? ` RSI:${p.snapshot.rsi.toFixed(0)}` : ''}`
    ).join('\n');

    const userPrompt = `Strategy: ${strategy.name}
Exit: ${strategy.parameters.exitMethod}, Stop: ${strategy.parameters.trailingStopPct}%, TP: ${strategy.parameters.takeProfitPct}%

Positions:
${positionData}`;

    try {
      const response = await this.generate(systemPrompt, userPrompt);
      const parsed = this.parseJson<Array<{ token: string; action: string; confidence: number; reasoning: string; suggestedExitPrice?: number; newStopPrice?: number }>>(response);

      if (!parsed || !Array.isArray(parsed)) {
        return positions.map(p => ({ token: p.token, action: 'hold' as const, confidence: 0, reasoning: 'Ollama parse failed' }));
      }

      return positions.map(p => {
        const match = parsed.find(r => r.token === p.token);
        if (!match) return { token: p.token, action: 'hold' as const, confidence: 0, reasoning: 'No match' };

        const validActions: ExitSignal['action'][] = ['hold', 'sell', 'tighten_stop'];
        const action = validActions.includes(match.action as ExitSignal['action'])
          ? (match.action as ExitSignal['action'])
          : 'hold' as const;

        return {
          token: p.token,
          action,
          confidence: Math.max(0, Math.min(100, match.confidence || 0)),
          reasoning: match.reasoning || 'Ollama signal',
          suggestedExitPrice: match.suggestedExitPrice || undefined,
          newStopPrice: match.newStopPrice || undefined,
        };
      });
    } catch (err) {
      console.error('[Ollama] Exit evaluation failed:', (err as Error).message);
      return positions.map(p => ({ token: p.token, action: 'hold' as const, confidence: 0, reasoning: 'Ollama error' }));
    }
  }

  /**
   * Evolution prompt (same interface as Venice).
   */
  async evolve(systemPrompt: string, userPrompt: string): Promise<string> {
    return this.generate(systemPrompt, userPrompt);
  }

  private defaultSkipSignal(snapshot: MarketSnapshot, strategy: StrategyGenome): EntrySignal {
    return {
      token: snapshot.token,
      action: 'skip',
      confidence: 0,
      reasoning: 'Ollama unavailable',
      suggestedSize: 0,
      suggestedEntry: snapshot.price,
      suggestedStop: snapshot.price * (1 - strategy.parameters.trailingStopPct / 100),
      suggestedTarget: snapshot.price * (1 + strategy.parameters.takeProfitPct / 100),
    };
  }

  private parseJson<T>(raw: string): T | null {
    try {
      const arrayMatch = raw.match(/\[[\s\S]*\]/);
      const objectMatch = raw.match(/\{[\s\S]*\}/);
      const jsonStr = arrayMatch ? arrayMatch[0] : objectMatch ? objectMatch[0] : null;
      if (!jsonStr) return null;
      return JSON.parse(jsonStr) as T;
    } catch {
      return null;
    }
  }
}
