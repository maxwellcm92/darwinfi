/**
 * DarwinFi Venice Engine
 *
 * Uses the Venice AI API (OpenAI-compatible) for real-time market analysis
 * and trade signal confirmation. Venice provides fast, uncensored inference
 * suitable for time-sensitive trading decisions.
 */

import OpenAI from 'openai';
import { StrategyGenome } from './strategy-manager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarketSnapshot {
  token: string;
  price: number;
  priceChange1h: number;
  priceChange24h: number;
  volume24h: number;
  volumeChange: number;
  high24h: number;
  low24h: number;
  rsi?: number;
  ema9?: number;
  ema21?: number;
  bollingerUpper?: number;
  bollingerLower?: number;
  macd?: number;
  macdSignal?: number;
  atr?: number;
  adx?: number;
  instinctPrediction?: string;
  instinctSentiment?: string;
  instinctDirectionScore?: number;    // -1 (strong down) to +1 (strong up)
  instinctConfidenceBoost?: number;   // -20 to +20 point adjustment
}

export interface EntrySignal {
  token: string;
  action: 'buy' | 'skip';
  confidence: number; // 0-100
  reasoning: string;
  suggestedSize: number; // Percentage of available budget
  suggestedEntry: number;
  suggestedStop: number;
  suggestedTarget: number;
}

export interface ExitSignal {
  token: string;
  action: 'hold' | 'sell' | 'tighten_stop';
  confidence: number;
  reasoning: string;
  suggestedExitPrice?: number;
  newStopPrice?: number;
}

export interface TokenRecommendation {
  token: string;
  score: number; // 0-100
  reasoning: string;
  suggestedTimeframe: string;
  keyLevels: {
    support: number;
    resistance: number;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VENICE_BASE_URL = 'https://api.venice.ai/api/v1';
const VENICE_MODEL = 'llama-3.3-70b'; // Fast model for real-time decisions
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 15000; // 15s max for real-time signals

// ---------------------------------------------------------------------------
// VeniceEngine
// ---------------------------------------------------------------------------

export class VeniceEngine {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: VENICE_BASE_URL,
      timeout: REQUEST_TIMEOUT_MS,
    });
    console.log('[DarwinFi] Venice engine initialized (real-time analysis)');
  }

  /**
   * Analyze market conditions and generate an entry signal for a specific token
   * based on the active strategy's parameters.
   */
  async evaluateEntry(
    strategy: StrategyGenome,
    snapshot: MarketSnapshot,
  ): Promise<EntrySignal> {
    const systemPrompt = `You are a crypto trading signal engine. Analyze market data and decide whether to enter a trade based on the strategy's parameters. Be decisive and quantitative.

RESPOND WITH ONLY a JSON object:
{
  "action": "buy" or "skip",
  "confidence": 0-100,
  "reasoning": "1-2 sentences",
  "suggestedSize": 0-100 (pct of budget),
  "suggestedEntry": <price>,
  "suggestedStop": <price>,
  "suggestedTarget": <price>
}`;

    const userPrompt = `Strategy: ${strategy.name}
Entry Method: ${strategy.parameters.entryMethod} (threshold: ${strategy.parameters.entryThreshold})
Exit Method: ${strategy.parameters.exitMethod}
Trailing Stop: ${strategy.parameters.trailingStopPct}%
Take Profit: ${strategy.parameters.takeProfitPct}%
Timeframe: ${strategy.parameters.timeframe}
Indicators: ${strategy.parameters.indicators.join(', ')}
Risk Per Trade: ${strategy.parameters.riskPerTradePct}%

Market Data for ${snapshot.token}:
- Price: $${snapshot.price}
- 1h Change: ${snapshot.priceChange1h.toFixed(2)}%
- 24h Change: ${snapshot.priceChange24h.toFixed(2)}%
- 24h Volume: $${snapshot.volume24h.toLocaleString()}
- Volume Change: ${snapshot.volumeChange.toFixed(2)}%
- 24h High/Low: $${snapshot.high24h} / $${snapshot.low24h}
${snapshot.rsi !== undefined ? `- RSI(14): ${snapshot.rsi.toFixed(1)}` : ''}
${snapshot.ema9 !== undefined ? `- EMA(9): $${snapshot.ema9.toFixed(4)}` : ''}
${snapshot.ema21 !== undefined ? `- EMA(21): $${snapshot.ema21.toFixed(4)}` : ''}
${snapshot.bollingerUpper !== undefined ? `- Bollinger Upper: $${snapshot.bollingerUpper.toFixed(4)}` : ''}
${snapshot.bollingerLower !== undefined ? `- Bollinger Lower: $${snapshot.bollingerLower.toFixed(4)}` : ''}
${snapshot.macd !== undefined ? `- MACD: ${snapshot.macd.toFixed(4)}` : ''}
${snapshot.macdSignal !== undefined ? `- MACD Signal: ${snapshot.macdSignal.toFixed(4)}` : ''}
${snapshot.atr !== undefined ? `- ATR(14): ${snapshot.atr.toFixed(4)}` : ''}
${snapshot.adx !== undefined ? `- ADX(14): ${snapshot.adx.toFixed(1)}` : ''}

Should we enter this trade?`;

    const response = await this.callVenice(systemPrompt, userPrompt);
    const parsed = this.parseJson<Omit<EntrySignal, 'token'>>(response);

    if (!parsed) {
      return {
        token: snapshot.token,
        action: 'skip',
        confidence: 0,
        reasoning: 'Failed to parse Venice response',
        suggestedSize: 0,
        suggestedEntry: snapshot.price,
        suggestedStop: snapshot.price * 0.95,
        suggestedTarget: snapshot.price * 1.10,
      };
    }

    return {
      token: snapshot.token,
      action: parsed.action === 'buy' ? 'buy' : 'skip',
      confidence: Math.max(0, Math.min(100, parsed.confidence || 0)),
      reasoning: parsed.reasoning || 'No reasoning',
      suggestedSize: Math.max(0, Math.min(100, parsed.suggestedSize || 0)),
      suggestedEntry: parsed.suggestedEntry || snapshot.price,
      suggestedStop: parsed.suggestedStop || snapshot.price * (1 - strategy.parameters.trailingStopPct / 100),
      suggestedTarget: parsed.suggestedTarget || snapshot.price * (1 + strategy.parameters.takeProfitPct / 100),
    };
  }

  /**
   * Analyze an open position and generate an exit signal.
   */
  async evaluateExit(
    strategy: StrategyGenome,
    snapshot: MarketSnapshot,
    entryPrice: number,
    currentPnlPct: number,
    holdTimeMinutes: number,
  ): Promise<ExitSignal> {
    const systemPrompt = `You are a crypto trading exit engine. Analyze whether to hold, sell, or tighten stops on an open position. Protect capital first, then maximize gains.

RESPOND WITH ONLY a JSON object:
{
  "action": "hold" or "sell" or "tighten_stop",
  "confidence": 0-100,
  "reasoning": "1-2 sentences",
  "suggestedExitPrice": <price or null>,
  "newStopPrice": <price or null>
}`;

    const userPrompt = `Strategy: ${strategy.name}
Exit Method: ${strategy.parameters.exitMethod}
Trailing Stop: ${strategy.parameters.trailingStopPct}%
Take Profit: ${strategy.parameters.takeProfitPct}%
Timeframe: ${strategy.parameters.timeframe}

Position:
- Entry Price: $${entryPrice}
- Current Price: $${snapshot.price}
- Unrealized PnL: ${currentPnlPct.toFixed(2)}%
- Hold Time: ${holdTimeMinutes} minutes

Market Data for ${snapshot.token}:
- 1h Change: ${snapshot.priceChange1h.toFixed(2)}%
- 24h Volume: $${snapshot.volume24h.toLocaleString()}
- Volume Change: ${snapshot.volumeChange.toFixed(2)}%
${snapshot.rsi !== undefined ? `- RSI(14): ${snapshot.rsi.toFixed(1)}` : ''}
${snapshot.macd !== undefined ? `- MACD: ${snapshot.macd.toFixed(4)}` : ''}
${snapshot.macdSignal !== undefined ? `- MACD Signal: ${snapshot.macdSignal.toFixed(4)}` : ''}
${snapshot.atr !== undefined ? `- ATR(14): ${snapshot.atr.toFixed(4)}` : ''}

Should we exit, hold, or tighten the stop?`;

    const response = await this.callVenice(systemPrompt, userPrompt);
    const parsed = this.parseJson<Omit<ExitSignal, 'token'>>(response);

    if (!parsed) {
      // Default to hold if we can't parse
      return {
        token: snapshot.token,
        action: 'hold',
        confidence: 0,
        reasoning: 'Failed to parse Venice response, defaulting to hold',
      };
    }

    const validActions: ExitSignal['action'][] = ['hold', 'sell', 'tighten_stop'];
    const action = validActions.includes(parsed.action as ExitSignal['action'])
      ? (parsed.action as ExitSignal['action'])
      : 'hold';

    return {
      token: snapshot.token,
      action,
      confidence: Math.max(0, Math.min(100, parsed.confidence || 0)),
      reasoning: parsed.reasoning || 'No reasoning',
      suggestedExitPrice: parsed.suggestedExitPrice || undefined,
      newStopPrice: parsed.newStopPrice || undefined,
    };
  }

  /**
   * Get token selection recommendations from the approved universe.
   */
  async recommendTokens(
    strategy: StrategyGenome,
    snapshots: MarketSnapshot[],
  ): Promise<TokenRecommendation[]> {
    const systemPrompt = `You are a crypto token selection engine. Rank tokens by trading opportunity quality for the given strategy. Focus on momentum, volume, and volatility alignment with the strategy.

RESPOND WITH ONLY a JSON array of objects:
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
      `${s.token}: $${s.price} | 1h:${s.priceChange1h.toFixed(1)}% | 24h:${s.priceChange24h.toFixed(1)}% | Vol:$${s.volume24h.toLocaleString()} | VolChg:${s.volumeChange.toFixed(1)}%${s.rsi !== undefined ? ` | RSI:${s.rsi.toFixed(0)}` : ''}`
    ).join('\n');

    const userPrompt = `Strategy: ${strategy.name}
Entry Method: ${strategy.parameters.entryMethod}
Preferred Tokens: ${strategy.parameters.tokenPreferences.join(', ')}
Timeframe: ${strategy.parameters.timeframe}

Available Tokens:
${tokenSummaries}

Rank the best trading opportunities right now.`;

    const response = await this.callVenice(systemPrompt, userPrompt);
    const parsed = this.parseJson<TokenRecommendation[]>(response);

    if (!parsed || !Array.isArray(parsed)) {
      console.warn('[DarwinFi] Venice token recommendation parse failed, returning empty');
      return [];
    }

    // Validate and clamp
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
  // Private helpers
  // -------------------------------------------------------------------------

  private async callVenice(systemPrompt: string, userPrompt: string): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const completion = await this.client.chat.completions.create({
          model: VENICE_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 512,
          temperature: 0.3, // Low temperature for consistent trading signals
        });

        const content = completion.choices[0]?.message?.content;
        if (!content) {
          throw new Error('Empty response from Venice');
        }
        return content;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(
          `[DarwinFi] Venice API attempt ${attempt}/${MAX_RETRIES} failed: ${lastError.message}`
        );
        if (attempt < MAX_RETRIES) {
          await this.sleep(RETRY_DELAY_MS);
        }
      }
    }

    throw lastError || new Error('Venice API call failed after all retries');
  }

  private parseJson<T>(raw: string): T | null {
    try {
      // Strip code fences if present
      let cleaned = raw.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.slice(7);
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.slice(3);
      }
      if (cleaned.endsWith('```')) {
        cleaned = cleaned.slice(0, -3);
      }
      cleaned = cleaned.trim();

      return JSON.parse(cleaned) as T;
    } catch (err) {
      console.error(
        '[DarwinFi] JSON parse error from Venice:',
        err instanceof Error ? err.message : err,
      );
      console.error(`[DarwinFi] Raw response: ${raw.substring(0, 300)}`);
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
