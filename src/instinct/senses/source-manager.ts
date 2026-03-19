/**
 * source-manager.ts - Source lifecycle management + survival mechanism
 *
 * Manages data-gathering sources (Grok X, RSS, On-Chain, Formula).
 * Every 4h, evaluates source fitness and applies survival rules:
 *   - Active: score > 0.5
 *   - Probation: score < 0.4 for 2 consecutive evals (frequency halved)
 *   - Demoted: score < 0.3 for 3 consecutive evals (collection stopped)
 *   - Retired: demoted 1 week with no improvement (archived)
 */

import * as fs from 'fs';
import * as path from 'path';
import { SourceConfig, SourceFitness, SourceStatus, WorldEvent } from '../types';
import { CandleStore } from '../data/candle-store';
import { EventStore } from '../data/event-store';

const SOURCES_PATH = path.resolve(process.cwd(), 'data/instinct/senses/sources.json');
const EVALUATION_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4h

interface SourceAgent {
  collect(): Promise<WorldEvent[]>;
}

export class SourceManager {
  private sources: Map<string, SourceConfig> = new Map();
  private agents: Map<string, SourceAgent> = new Map();
  private candleStore: CandleStore;
  private eventStore: EventStore;
  private evalTimer: ReturnType<typeof setInterval> | null = null;

  constructor(candleStore: CandleStore, eventStore: EventStore) {
    this.candleStore = candleStore;
    this.eventStore = eventStore;
    this.loadSources();
  }

  registerAgent(sourceId: string, agent: SourceAgent): void {
    this.agents.set(sourceId, agent);
  }

  getSource(id: string): SourceConfig | undefined {
    return this.sources.get(id);
  }

  getActiveSources(): SourceConfig[] {
    return Array.from(this.sources.values()).filter(s => s.status === 'active' || s.status === 'probation');
  }

  getAllSources(): SourceConfig[] {
    return Array.from(this.sources.values());
  }

  addSource(config: SourceConfig): void {
    this.sources.set(config.id, config);
    this.saveSources();
  }

  /**
   * Run collection for a specific source.
   */
  async collectFromSource(sourceId: string): Promise<WorldEvent[]> {
    const source = this.sources.get(sourceId);
    const agent = this.agents.get(sourceId);
    if (!source || !agent) return [];
    if (source.status === 'demoted' || source.status === 'retired') return [];

    try {
      const events = await agent.collect();
      source.lastCollectionAt = Date.now();
      source.eventsProduced += events.length;

      if (events.length > 0) {
        this.eventStore.appendEvents(events);
      }

      this.saveSources();
      return events;
    } catch (err) {
      console.error(`[Senses] Source ${sourceId} collection error:`, (err as Error).message);
      return [];
    }
  }

  /**
   * Run collection for all active sources.
   */
  async collectAll(): Promise<WorldEvent[]> {
    const allEvents: WorldEvent[] = [];
    for (const source of this.getActiveSources()) {
      const events = await this.collectFromSource(source.id);
      allEvents.push(...events);
    }
    return allEvents;
  }

  /**
   * Evaluate source fitness and apply survival rules.
   * Called every 4h.
   */
  async evaluateSources(): Promise<void> {
    console.log('[Senses] Evaluating source fitness...');
    const now = Date.now();

    for (const source of this.sources.values()) {
      if (source.status === 'retired') continue;

      const fitness = await this.computeFitness(source, now);
      source.fitness = fitness;

      this.applySurvivalRules(source, fitness);
    }

    this.saveSources();
    console.log('[Senses] Evaluation complete. Active:', this.getActiveSources().length);
  }

  /**
   * Compute fitness metrics for a source.
   */
  private async computeFitness(source: SourceConfig, now: number): Promise<SourceFitness> {
    // Get events from last 4h window
    const lookbackMs = EVALUATION_INTERVAL_MS;
    const events = this.eventStore.getRecentEvents(lookbackMs / 60_000)
      .filter(e => e.sourceId === source.id);

    if (events.length === 0) {
      return {
        ...source.fitness,
        lastEvaluatedAt: now,
        evaluationCount: source.fitness.evaluationCount + 1,
      };
    }

    // Predictive score: for each event, did price move in predicted direction?
    let correctDirection = 0;
    let impactful = 0;
    let totalScored = 0;

    for (const event of events) {
      for (const token of event.tokens) {
        const eventTime = Math.floor(event.timestamp / 1000);
        // Check price 15m and 1h after event
        const candles15m = this.candleStore.getCandles(token, '1m', eventTime, eventTime + 900);
        const candles1h = this.candleStore.getCandles(token, '1m', eventTime, eventTime + 3600);

        if (candles15m.length < 2) continue;
        totalScored++;

        const priceAtEvent = candles15m[0].close;
        const priceLater = candles15m[candles15m.length - 1].close;
        const pctMove = (priceLater - priceAtEvent) / priceAtEvent;

        // Check if sentiment direction matches price direction
        const predictedUp = event.sentiment > 0;
        const actualUp = pctMove > 0;
        if ((predictedUp && actualUp) || (!predictedUp && !actualUp)) {
          correctDirection++;
        }

        // Signal-to-noise: >0.5% move in 1h = impactful
        if (candles1h.length >= 2) {
          const price1h = candles1h[candles1h.length - 1].close;
          const pctMove1h = Math.abs((price1h - priceAtEvent) / priceAtEvent);
          if (pctMove1h > 0.005) impactful++;
        }
      }
    }

    const predictiveScore = totalScored > 0 ? correctDirection / totalScored : source.fitness.predictiveScore;
    const signalToNoise = totalScored > 0 ? impactful / totalScored : source.fitness.signalToNoise;

    const compositeScore = predictiveScore * 0.5 + signalToNoise * 0.3 + source.fitness.timeliness * 0.1 + source.fitness.costEfficiency * 0.1;

    return {
      predictiveScore,
      signalToNoise,
      timeliness: source.fitness.timeliness,       // Requires deeper analysis, keep existing
      uniqueValue: source.fitness.uniqueValue,
      costEfficiency: source.fitness.costEfficiency,
      compositeScore,
      lastEvaluatedAt: now,
      evaluationCount: source.fitness.evaluationCount + 1,
    };
  }

  /**
   * Apply survival mechanism rules.
   */
  private applySurvivalRules(source: SourceConfig, fitness: SourceFitness): void {
    const score = fitness.compositeScore;
    const prevStatus = source.status;

    if (score >= 0.5) {
      source.status = 'active';
      source.consecutiveLowScores = 0;
    } else if (score < 0.3) {
      source.consecutiveLowScores++;
      if (source.consecutiveLowScores >= 3) {
        source.status = 'demoted';
      } else if (source.consecutiveLowScores >= 2) {
        source.status = 'probation';
        source.collectionIntervalMs = source.collectionIntervalMs * 2; // Halve frequency
      }
    } else if (score < 0.4) {
      source.consecutiveLowScores++;
      if (source.consecutiveLowScores >= 2) {
        source.status = 'probation';
        source.collectionIntervalMs = source.collectionIntervalMs * 2;
      }
    }

    // Retirement check: demoted for 1 week
    if (source.status === 'demoted') {
      const demotedDuration = Date.now() - fitness.lastEvaluatedAt;
      if (demotedDuration > 7 * 24 * 60 * 60 * 1000) {
        source.status = 'retired';
      }
    }

    if (prevStatus !== source.status) {
      console.log(`[Senses] Source ${source.id}: ${prevStatus} -> ${source.status} (score: ${score.toFixed(3)})`);
    }
  }

  /**
   * Start periodic evaluation timer.
   */
  startEvaluation(): void {
    if (this.evalTimer) return;
    this.evalTimer = setInterval(() => {
      this.evaluateSources().catch(err =>
        console.error('[Senses] Evaluation error:', (err as Error).message)
      );
    }, EVALUATION_INTERVAL_MS);
  }

  stopEvaluation(): void {
    if (this.evalTimer) {
      clearInterval(this.evalTimer);
      this.evalTimer = null;
    }
  }

  // -------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------

  private loadSources(): void {
    try {
      if (fs.existsSync(SOURCES_PATH)) {
        const data = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf-8'));
        for (const source of data) {
          this.sources.set(source.id, source);
        }
        console.log(`[Senses] Loaded ${this.sources.size} sources`);
      }
    } catch (err) {
      console.error('[Senses] Failed to load sources:', (err as Error).message);
    }
  }

  private saveSources(): void {
    const dir = path.dirname(SOURCES_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const tmpPath = SOURCES_PATH + '.tmp';
    const json = JSON.stringify(Array.from(this.sources.values()), null, 2);
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, SOURCES_PATH);
  }
}
