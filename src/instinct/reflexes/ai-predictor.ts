/**
 * ai-predictor.ts - AI-based price prediction
 *
 * Uses Claude CLI (Haiku) for 1m/5m predictions (free via subscription)
 * Uses Venice Llama 3.3 70B for 15m/1h predictions (~$0.30/day)
 */

import { spawn } from 'child_process';
import OpenAI from 'openai';
import { randomUUID } from 'crypto';

function spawnAsync(cmd: string, args: string[], input: string, opts: { timeout: number; env: NodeJS.ProcessEnv }): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      timeout: opts.timeout,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`${cmd} exited ${code}: ${stderr}`));
      else resolve(stdout);
    });
    proc.on('error', reject);
    proc.stdin.write(input);
    proc.stdin.end();
  });
}
import { Prediction, Resolution, Candle, WorldEvent, PredictionStrategyConfig } from '../types';
import { OllamaEngine } from '../../agent/ollama-engine';

const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const VENICE_MODEL = 'llama-3.3-70b';
const VENICE_BASE_URL = 'https://api.venice.ai/api/v1';
const CLI_TIMEOUT_MS = 45_000;

interface AIPredictorConfig {
  veniceApiKey: string;
}

function parseAIResponse(raw: string): Record<string, unknown> | null {
  try {
    let cleaned = raw.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
    if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
    if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
    return JSON.parse(cleaned.trim());
  } catch {
    return null;
  }
}

export class AIPredictor {
  private veniceClient: OpenAI;
  private ollamaEngine: OllamaEngine;
  private ollamaHealthy: boolean = false;
  private lastOllamaCheck: number = 0;
  private readonly OLLAMA_CHECK_INTERVAL = 60_000;

  constructor(config: AIPredictorConfig) {
    this.veniceClient = new OpenAI({
      apiKey: config.veniceApiKey,
      baseURL: VENICE_BASE_URL,
      timeout: 30_000,
    });
    this.ollamaEngine = new OllamaEngine();
  }

  /**
   * Generate prediction for a token at a given resolution.
   * Routes: 1m/5m -> Ollama (fast) -> Claude CLI fallback
   *         15m/1h -> Venice (quality)
   */
  async predict(
    token: string,
    resolution: Resolution,
    candles: Candle[],
    events: WorldEvent[],
    indicators: Record<string, number | undefined>,
  ): Promise<Prediction | null> {
    if (resolution === '1m' || resolution === '5m') {
      // Try Ollama first for fast predictions
      await this.refreshOllamaHealth();
      if (this.ollamaHealthy) {
        try {
          return await this.predictWithOllama(token, resolution, candles, events, indicators);
        } catch (err) {
          console.warn(`[AIPredictor] Ollama prediction failed, falling back to Claude CLI:`, (err as Error).message);
        }
      }
      return this.predictWithClaude(token, resolution, candles, events, indicators);
    } else {
      return this.predictWithVenice(token, resolution, candles, events, indicators);
    }
  }

  private async refreshOllamaHealth(): Promise<void> {
    if (Date.now() - this.lastOllamaCheck < this.OLLAMA_CHECK_INTERVAL) return;
    this.lastOllamaCheck = Date.now();
    this.ollamaHealthy = await this.ollamaEngine.isHealthy();
  }

  /**
   * Ollama prediction (gemma2:9b) for fast 1m/5m timeframes. ~2-3s latency.
   */
  private async predictWithOllama(
    token: string,
    resolution: Resolution,
    candles: Candle[],
    events: WorldEvent[],
    indicators: Record<string, number | undefined>,
  ): Promise<Prediction | null> {
    const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;
    if (currentPrice === 0) return null;

    const systemPrompt = `You are a crypto price prediction engine. Predict the NEXT ${resolution} candle. Output ONLY valid JSON.
{"direction":"up"|"down"|"flat","predictedClose":number,"predictedHigh":number,"predictedLow":number,"confidence":0-100,"reasoning":"brief"}`;

    const recentCandles = candles.slice(-20).map(c =>
      `${new Date(c.timestamp * 1000).toISOString().slice(11, 19)} O:${c.open.toFixed(4)} H:${c.high.toFixed(4)} L:${c.low.toFixed(4)} C:${c.close.toFixed(4)} V:${c.volume.toFixed(0)}`
    ).join('\n');

    const indicatorStr = Object.entries(indicators)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: ${(v as number).toFixed(4)}`)
      .join(', ');

    const userPrompt = `Token: ${token} | ${resolution} | Price: $${currentPrice.toFixed(4)}
Candles:
${recentCandles}
Indicators: ${indicatorStr || 'none'}`;

    const response = await this.ollamaEngine.generate(systemPrompt, userPrompt);
    const parsed = parseAIResponse(response);
    if (!parsed) return null;

    return {
      id: randomUUID(),
      strategyId: 'ai_ollama',
      timestamp: Date.now(),
      token,
      resolution,
      predictedDirection: this.validateDirection(parsed.direction as string),
      predictedClose: Number(parsed.predictedClose) || currentPrice,
      predictedHigh: Number(parsed.predictedHigh) || currentPrice * 1.001,
      predictedLow: Number(parsed.predictedLow) || currentPrice * 0.999,
      confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 50)),
      currentPrice,
      eventIds: events.map(e => e.id),
    };
  }

  /**
   * Claude CLI prediction (Haiku) for fast 1m/5m timeframes.
   */
  private async predictWithClaude(
    token: string,
    resolution: Resolution,
    candles: Candle[],
    events: WorldEvent[],
    indicators: Record<string, number | undefined>,
  ): Promise<Prediction | null> {
    const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;
    if (currentPrice === 0) return null;

    const systemPrompt = `You are a crypto price prediction engine. Analyze the candle data, indicators, and market events to predict the NEXT ${resolution} candle. Output ONLY valid JSON.

Output format:
{
  "direction": "up" | "down" | "flat",
  "predictedClose": number,
  "predictedHigh": number,
  "predictedLow": number,
  "confidence": 0-100,
  "reasoning": "brief explanation"
}

Rules:
- "flat" means price moves less than 0.1%
- Confidence 70+: strong signal alignment (multiple indicators + events agree)
- Confidence 50-69: moderate signal (some indicators align)
- Confidence 30-49: weak/mixed signals
- Keep predictions within realistic ranges (use recent volatility as guide)`;

    // Compact candle representation for token efficiency
    const recentCandles = candles.slice(-20).map(c =>
      `${new Date(c.timestamp * 1000).toISOString().slice(11, 19)} O:${c.open.toFixed(4)} H:${c.high.toFixed(4)} L:${c.low.toFixed(4)} C:${c.close.toFixed(4)} V:${c.volume.toFixed(0)}`
    ).join('\n');

    const eventSummary = events.slice(-5).map(e =>
      `[${e.category}] ${e.title} (sentiment: ${e.sentiment.toFixed(2)}, magnitude: ${e.magnitude})`
    ).join('\n');

    const indicatorStr = Object.entries(indicators)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: ${(v as number).toFixed(4)}`)
      .join(', ');

    const userPrompt = `Token: ${token} | Resolution: ${resolution} | Current price: $${currentPrice.toFixed(4)}

Recent candles (${resolution}):
${recentCandles}

Indicators: ${indicatorStr || 'none available'}

Recent events:
${eventSummary || 'none'}

Predict the next ${resolution} candle.`;

    try {
      const result = await spawnAsync(
        'claude',
        ['-p', '--model', CLAUDE_MODEL, '--output-format', 'json', '--system-prompt', systemPrompt],
        userPrompt,
        {
          timeout: CLI_TIMEOUT_MS,
          env: { ...process.env, HOME: process.env.HOME || '/home/maxwell', CLAUDECODE: '' } as NodeJS.ProcessEnv,
        },
      );

      // Parse CLI envelope
      let content = result.trim();
      try {
        const envelope = JSON.parse(content);
        if (envelope.result) content = envelope.result;
      } catch { /* not envelope */ }

      const parsed = parseAIResponse(content);
      if (!parsed) return null;

      return {
        id: randomUUID(),
        strategyId: 'ai_claude',
        timestamp: Date.now(),
        token,
        resolution,
        predictedDirection: this.validateDirection(parsed.direction as string),
        predictedClose: Number(parsed.predictedClose) || currentPrice,
        predictedHigh: Number(parsed.predictedHigh) || currentPrice * 1.001,
        predictedLow: Number(parsed.predictedLow) || currentPrice * 0.999,
        confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 50)),
        currentPrice,
        eventIds: events.map(e => e.id),
      };
    } catch (err) {
      console.error(`[AIPredictor] Claude error for ${token}/${resolution}:`, (err as Error).message);
      return null;
    }
  }

  /**
   * Venice Llama prediction for slower 15m/1h timeframes.
   */
  private async predictWithVenice(
    token: string,
    resolution: Resolution,
    candles: Candle[],
    events: WorldEvent[],
    indicators: Record<string, number | undefined>,
  ): Promise<Prediction | null> {
    const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;
    if (currentPrice === 0) return null;

    const recentCandles = candles.slice(-30).map(c =>
      `${new Date(c.timestamp * 1000).toISOString().slice(11, 19)} O:${c.open.toFixed(4)} H:${c.high.toFixed(4)} L:${c.low.toFixed(4)} C:${c.close.toFixed(4)} V:${c.volume.toFixed(0)}`
    ).join('\n');

    const eventSummary = events.slice(-10).map(e =>
      `[${e.category}] ${e.title} (sentiment: ${e.sentiment.toFixed(2)}, magnitude: ${e.magnitude})`
    ).join('\n');

    const indicatorStr = Object.entries(indicators)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: ${(v as number).toFixed(4)}`)
      .join(', ');

    const systemPrompt = `You are an advanced crypto price prediction engine analyzing ${resolution} candles for ${token} on Base L2. Output ONLY valid JSON with your prediction for the NEXT candle.

JSON format:
{"direction":"up|down|flat","predictedClose":number,"predictedHigh":number,"predictedLow":number,"confidence":0-100,"reasoning":"brief"}

Use technical analysis, event sentiment, and pattern recognition. Be precise with price levels.`;

    const userPrompt = `Token: ${token} | ${resolution} candles | Price: $${currentPrice.toFixed(4)}

Candles:
${recentCandles}

Indicators: ${indicatorStr || 'N/A'}

Events:
${eventSummary || 'None'}`;

    try {
      const response = await this.veniceClient.chat.completions.create({
        model: VENICE_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 512,
        temperature: 0.3,
      });

      const content = response.choices[0]?.message?.content ?? '';
      const parsed = parseAIResponse(content);
      if (!parsed) return null;

      return {
        id: randomUUID(),
        strategyId: 'ai_venice',
        timestamp: Date.now(),
        token,
        resolution,
        predictedDirection: this.validateDirection(parsed.direction as string),
        predictedClose: Number(parsed.predictedClose) || currentPrice,
        predictedHigh: Number(parsed.predictedHigh) || currentPrice * 1.002,
        predictedLow: Number(parsed.predictedLow) || currentPrice * 0.998,
        confidence: Math.max(0, Math.min(100, Number(parsed.confidence) || 50)),
        currentPrice,
        eventIds: events.map(e => e.id),
      };
    } catch (err) {
      console.error(`[AIPredictor] Venice error for ${token}/${resolution}:`, (err as Error).message);
      return null;
    }
  }

  private validateDirection(dir: string): 'up' | 'down' | 'flat' {
    if (dir === 'up' || dir === 'down' || dir === 'flat') return dir;
    return 'flat';
  }

  static defaultConfigs(): PredictionStrategyConfig[] {
    return [
      {
        id: 'ai_claude',
        name: 'Claude Haiku Predictor',
        type: 'ai_reasoning',
        status: 'active',
        resolutions: ['1m', '5m'],
        tokens: [],  // All tokens
        fitness: {
          directionAccuracy: 0.5,
          magnitudeMAE: 0.5,
          confidenceCalibration: 0.5,
          consistency: 0.5,
          resolutionFit: 0.5,
          compositeScore: 0.5,
          lastEvaluatedAt: 0,
          evaluationCount: 0,
        },
        parameters: { model: CLAUDE_MODEL },
        lastPredictionAt: 0,
        totalPredictions: 0,
      },
      {
        id: 'ai_venice',
        name: 'Venice Llama Predictor',
        type: 'ai_reasoning',
        status: 'active',
        resolutions: ['15m', '1h'],
        tokens: [],
        fitness: {
          directionAccuracy: 0.5,
          magnitudeMAE: 0.5,
          confidenceCalibration: 0.5,
          consistency: 0.5,
          resolutionFit: 0.5,
          compositeScore: 0.5,
          lastEvaluatedAt: 0,
          evaluationCount: 0,
        },
        parameters: { model: VENICE_MODEL },
        lastPredictionAt: 0,
        totalPredictions: 0,
      },
    ];
  }
}
