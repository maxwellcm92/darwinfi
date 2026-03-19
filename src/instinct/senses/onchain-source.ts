/**
 * onchain-source.ts - On-chain data source (DexScreener + GeckoTerminal)
 *
 * Monitors: whale transfers, DEX volume spikes, unusual price movements.
 * Uses GeckoTerminal (already available) for volume data.
 */

import { randomUUID } from 'crypto';
import { WorldEvent, SourceConfig, Candle } from '../types';
import { CandleStore } from '../data/candle-store';
import { ALL_TOKENS, POOL_REGISTRY, GECKO_BASE_URL, NETWORK } from '../data/pool-registry';

interface PoolTradeData {
  token: string;
  volume5m: number;
  volumeAvg5m: number;
  priceChange5m: number;
  buySellRatio: number;
}

export class OnChainSource {
  private candleStore: CandleStore;
  private volumeBaselines: Map<string, number> = new Map(); // Token -> avg 5m volume

  constructor(candleStore: CandleStore) {
    this.candleStore = candleStore;
  }

  async collect(): Promise<WorldEvent[]> {
    const events: WorldEvent[] = [];

    // 1. Check for volume spikes using stored candle data
    const volumeEvents = this.detectVolumeSpikes();
    events.push(...volumeEvents);

    // 2. Check for unusual price movements
    const priceEvents = this.detectPriceAnomalies();
    events.push(...priceEvents);

    // 3. Fetch pool trade data from GeckoTerminal for buy/sell ratio
    const tradeEvents = await this.fetchTradeData();
    events.push(...tradeEvents);

    console.log(`[OnChain] Collected ${events.length} events`);
    return events;
  }

  /**
   * Detect volume spikes: current 5m volume > 3x average 5m volume.
   */
  private detectVolumeSpikes(): WorldEvent[] {
    const events: WorldEvent[] = [];

    for (const token of ALL_TOKENS) {
      const candles = this.candleStore.getLatest(token, '5m', 50); // ~4h of 5m candles
      if (candles.length < 10) continue;

      // Compute average volume (excluding latest)
      const historical = candles.slice(0, -1);
      const avgVolume = historical.reduce((s, c) => s + c.volume, 0) / historical.length;
      this.volumeBaselines.set(token, avgVolume);

      const latest = candles[candles.length - 1];
      if (avgVolume <= 0) continue;

      const volumeRatio = latest.volume / avgVolume;

      if (volumeRatio > 3) {
        const pctChange = ((latest.close - latest.open) / latest.open) * 100;
        events.push({
          id: randomUUID(),
          sourceId: 'onchain',
          timestamp: Date.now(),
          category: 'volume',
          tokens: [token],
          sentiment: pctChange > 0 ? 0.4 : -0.4,
          magnitude: Math.min(90, 30 + volumeRatio * 10),
          title: `${token} volume spike: ${volumeRatio.toFixed(1)}x average`,
          details: `5m volume: $${latest.volume.toFixed(0)} vs avg $${avgVolume.toFixed(0)} (${volumeRatio.toFixed(1)}x). Price ${pctChange > 0 ? 'up' : 'down'} ${Math.abs(pctChange).toFixed(2)}%`,
        });
      }
    }

    return events;
  }

  /**
   * Detect unusual price movements: >2% move in 5 minutes.
   */
  private detectPriceAnomalies(): WorldEvent[] {
    const events: WorldEvent[] = [];

    for (const token of ALL_TOKENS) {
      const candles = this.candleStore.getLatest(token, '5m', 3);
      if (candles.length < 2) continue;

      const latest = candles[candles.length - 1];
      const prev = candles[candles.length - 2];
      const pctChange = ((latest.close - prev.close) / prev.close) * 100;

      if (Math.abs(pctChange) > 2) {
        events.push({
          id: randomUUID(),
          sourceId: 'onchain',
          timestamp: Date.now(),
          category: 'volume',
          tokens: [token],
          sentiment: pctChange > 0 ? 0.6 : -0.6,
          magnitude: Math.min(85, 40 + Math.abs(pctChange) * 10),
          title: `${token} sharp move: ${pctChange > 0 ? '+' : ''}${pctChange.toFixed(2)}% in 5m`,
          details: `Price moved from $${prev.close.toFixed(4)} to $${latest.close.toFixed(4)} in 5 minutes. Volume: $${latest.volume.toFixed(0)}`,
        });
      }
    }

    return events;
  }

  /**
   * Fetch trade data from GeckoTerminal for buy/sell ratio analysis.
   * Uses the /trades endpoint for the most liquid pool.
   */
  private async fetchTradeData(): Promise<WorldEvent[]> {
    const events: WorldEvent[] = [];

    // Sample 2-3 tokens per collection cycle to stay under rate limits
    const sampleTokens = ALL_TOKENS.slice(0, 3);

    for (const token of sampleTokens) {
      try {
        const pool = POOL_REGISTRY[token];
        const url = `${GECKO_BASE_URL}/networks/${NETWORK}/pools/${pool.poolAddress}/trades`;
        const response = await fetch(url, {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) continue;
        const data = await response.json() as { data: Array<{ attributes: { kind: string; volume_in_usd: string } }> };

        if (!data.data || data.data.length === 0) continue;

        // Analyze buy/sell ratio from recent trades
        let buyVolume = 0;
        let sellVolume = 0;
        for (const trade of data.data.slice(0, 50)) {
          const vol = parseFloat(trade.attributes.volume_in_usd) || 0;
          if (trade.attributes.kind === 'buy') buyVolume += vol;
          else sellVolume += vol;
        }

        const totalVolume = buyVolume + sellVolume;
        if (totalVolume < 100) continue;

        const buyRatio = buyVolume / totalVolume;
        // Only flag if significantly imbalanced (>65% one way)
        if (buyRatio > 0.65) {
          events.push({
            id: randomUUID(),
            sourceId: 'onchain',
            timestamp: Date.now(),
            category: 'whale',
            tokens: [token],
            sentiment: 0.5,
            magnitude: 40 + (buyRatio - 0.5) * 100,
            title: `${token} buy pressure: ${(buyRatio * 100).toFixed(0)}% buy volume`,
            details: `Recent trades: $${buyVolume.toFixed(0)} buys vs $${sellVolume.toFixed(0)} sells (${(buyRatio * 100).toFixed(1)}% buy)`,
          });
        } else if (buyRatio < 0.35) {
          events.push({
            id: randomUUID(),
            sourceId: 'onchain',
            timestamp: Date.now(),
            category: 'whale',
            tokens: [token],
            sentiment: -0.5,
            magnitude: 40 + (0.5 - buyRatio) * 100,
            title: `${token} sell pressure: ${((1 - buyRatio) * 100).toFixed(0)}% sell volume`,
            details: `Recent trades: $${buyVolume.toFixed(0)} buys vs $${sellVolume.toFixed(0)} sells (${((1 - buyRatio) * 100).toFixed(1)}% sell)`,
          });
        }

        await new Promise(r => setTimeout(r, 2200)); // Rate limit
      } catch (err) {
        console.error(`[OnChain] Trade data error for ${token}:`, (err as Error).message);
      }
    }

    return events;
  }

  static defaultConfig(): SourceConfig {
    return {
      id: 'onchain',
      name: 'On-Chain Analytics',
      type: 'onchain',
      status: 'active',
      collectionIntervalMs: 5 * 60 * 1000,  // Every 5 min
      fitness: {
        predictiveScore: 0.5,
        signalToNoise: 0.6,
        timeliness: 0.8,   // Near real-time
        uniqueValue: 0.7,
        costEfficiency: 1.0,  // Free
        compositeScore: 0.5,
        lastEvaluatedAt: 0,
        evaluationCount: 0,
      },
      consecutiveLowScores: 0,
      lastCollectionAt: 0,
      eventsProduced: 0,
    };
  }
}
