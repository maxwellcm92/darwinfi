/**
 * state-writer.ts - Atomic predictions-live.json writer
 *
 * Generates the InstinctState file every 30s by aggregating:
 *   - Latest predictions from all strategies/resolutions
 *   - Sentiment from recent events
 *   - Key support/resistance levels from candle data
 *   - Health metrics
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  InstinctState, TokenInstinct, PredictionSummary, Resolution,
  InstinctHealth,
} from '../types';
import { PredictionEngine } from '../reflexes/prediction-engine';
import { SourceManager } from '../senses/source-manager';
import { EventStore } from '../data/event-store';
import { CandleStore } from '../data/candle-store';
import { ALL_TOKENS } from '../data/pool-registry';

const STATE_PATH = path.resolve(process.cwd(), 'data/instinct/nerves/predictions-live.json');
const WRITE_INTERVAL_MS = 30_000;

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export class StateWriter {
  private predictionEngine: PredictionEngine;
  private sourceManager: SourceManager;
  private eventStore: EventStore;
  private candleStore: CandleStore;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startTime: number;

  constructor(
    predictionEngine: PredictionEngine,
    sourceManager: SourceManager,
    eventStore: EventStore,
    candleStore: CandleStore,
  ) {
    this.predictionEngine = predictionEngine;
    this.sourceManager = sourceManager;
    this.eventStore = eventStore;
    this.candleStore = candleStore;
    this.startTime = Date.now();
    ensureDir(path.dirname(STATE_PATH));
  }

  /**
   * Start periodic state writing.
   */
  start(): void {
    if (this.timer) return;

    // Initial write
    this.writeState();

    this.timer = setInterval(() => {
      try {
        this.writeState();
      } catch (err) {
        console.error('[Nerves] State write error:', (err as Error).message);
      }
    }, WRITE_INTERVAL_MS);

    console.log(`[Nerves] State writer started (${WRITE_INTERVAL_MS / 1000}s interval)`);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Build and atomically write the current InstinctState.
   */
  writeState(): void {
    const state = this.buildState();
    const json = JSON.stringify(state, null, 2);
    const tmpPath = STATE_PATH + '.tmp';
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, STATE_PATH);
  }

  /**
   * Read the current state from disk (for API consumers).
   */
  static readState(): InstinctState | null {
    try {
      if (!fs.existsSync(STATE_PATH)) return null;
      return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
    } catch {
      return null;
    }
  }

  private buildState(): InstinctState {
    const tokens: Record<string, TokenInstinct> = {};
    const resolutions: Resolution[] = ['1m', '5m', '15m', '1h'];

    for (const token of ALL_TOKENS) {
      const predictions: Partial<Record<Resolution, PredictionSummary>> = {};

      for (const res of resolutions) {
        const recent = this.predictionEngine.getRecentPredictions(token, res, 5);
        if (recent.length > 0) {
          // Take the most recent prediction
          const latest = recent[recent.length - 1];
          predictions[res] = {
            direction: latest.predictedDirection,
            predictedClose: latest.predictedClose,
            confidence: latest.confidence,
            strategyId: latest.strategyId,
            strategyType: this.getStrategyType(latest.strategyId),
            timestamp: latest.timestamp,
          };
        }
      }

      // Aggregate sentiment from recent events
      const events = this.eventStore.getRecentEvents(60, token);
      const sentimentScore = events.length > 0
        ? events.reduce((s, e) => s + e.sentiment * (e.magnitude / 100), 0) / events.length
        : 0;
      const sentimentConfidence = Math.min(100, events.length * 15);

      // Key levels from recent candle data
      const keyLevels = this.computeKeyLevels(token);

      tokens[token] = {
        predictions,
        sentiment: {
          score: Math.max(-1, Math.min(1, sentimentScore)),
          confidence: sentimentConfidence,
          topEvents: events.slice(-3).map(e => e.title),
        },
        keyLevels,
      };
    }

    const activeSources = this.sourceManager.getActiveSources();
    const activeStrategies = this.predictionEngine.getActiveStrategies();
    const avgConfidence = this.computeOverallConfidence(tokens);

    return {
      generatedAt: Date.now(),
      tokens,
      health: {
        sensesActive: activeSources.length,
        reflexesActive: activeStrategies.length,
        overallConfidence: avgConfidence,
        lastUpdateAt: Date.now(),
        uptimeMs: Date.now() - this.startTime,
      },
    };
  }

  private getStrategyType(strategyId: string): 'ai_reasoning' | 'statistical' | 'pattern_match' | 'hybrid' {
    if (strategyId.startsWith('ai_')) return 'ai_reasoning';
    if (strategyId.startsWith('stat_')) return 'statistical';
    if (strategyId === 'pattern_match') return 'pattern_match';
    return 'hybrid';
  }

  private computeKeyLevels(token: string): { support: number[]; resistance: number[] } {
    const candles = this.candleStore.getLatest(token, '1h', 24); // Last 24h of hourly candles
    if (candles.length < 5) return { support: [], resistance: [] };

    const currentPrice = candles[candles.length - 1].close;
    const support: number[] = [];
    const resistance: number[] = [];

    // Find local lows (support) and highs (resistance)
    for (let i = 1; i < candles.length - 1; i++) {
      const prev = candles[i - 1];
      const curr = candles[i];
      const next = candles[i + 1];

      if (curr.low <= prev.low && curr.low <= next.low) {
        support.push(curr.low);
      }
      if (curr.high >= prev.high && curr.high >= next.high) {
        resistance.push(curr.high);
      }
    }

    // Filter: only include levels near current price (within 5%)
    const nearSupport = support.filter(s => s < currentPrice && s > currentPrice * 0.95);
    const nearResistance = resistance.filter(r => r > currentPrice && r < currentPrice * 1.05);

    return {
      support: nearSupport.slice(-3),
      resistance: nearResistance.slice(-3),
    };
  }

  private computeOverallConfidence(tokens: Record<string, TokenInstinct>): number {
    const confidences: number[] = [];
    for (const t of Object.values(tokens)) {
      for (const p of Object.values(t.predictions)) {
        if (p) confidences.push(p.confidence);
      }
    }
    if (confidences.length === 0) return 0;
    return Math.round(confidences.reduce((s, c) => s + c, 0) / confidences.length);
  }
}
