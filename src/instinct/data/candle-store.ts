/**
 * candle-store.ts - JSONL candlestick storage with aggregation
 *
 * Source of truth: 1m candles in data/candles/{TOKEN}/1m.jsonl
 * Aggregated: 5m, 15m, 1h derived from 1m data
 *
 * JSONL format: one JSON object per line
 *   {"t":1710000000,"o":2100.5,"h":2105.2,"l":2098.1,"c":2103.8,"v":1234.56}
 */

import * as fs from 'fs';
import * as path from 'path';
import { Candle, Resolution, RESOLUTION_MS } from '../types';

const DATA_DIR = path.resolve(process.cwd(), 'data/candles');

interface CompactCandle {
  t: number;  // timestamp (unix seconds)
  o: number;  // open
  h: number;  // high
  l: number;  // low
  c: number;  // close
  v: number;  // volume
}

function toCompact(c: Candle): CompactCandle {
  return { t: c.timestamp, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume };
}

function fromCompact(c: CompactCandle): Candle {
  return { timestamp: c.t, open: c.o, high: c.h, low: c.l, close: c.c, volume: c.v };
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getFilePath(token: string, resolution: Resolution): string {
  return path.join(DATA_DIR, token, `${resolution}.jsonl`);
}

export class CandleStore {
  /**
   * Append candles to storage, deduplicating by timestamp.
   * Returns the number of new candles written.
   */
  append(token: string, resolution: Resolution, candles: Candle[]): number {
    if (candles.length === 0) return 0;

    const filePath = getFilePath(token, resolution);
    ensureDir(path.dirname(filePath));

    // Load existing timestamps for dedup (only check last ~2000 entries for speed)
    const existing = this.getLatest(token, resolution, 2000);
    const existingTs = new Set(existing.map(c => c.timestamp));

    const newCandles = candles.filter(c => !existingTs.has(c.timestamp));
    if (newCandles.length === 0) return 0;

    // Sort by timestamp ascending
    newCandles.sort((a, b) => a.timestamp - b.timestamp);

    const lines = newCandles.map(c => JSON.stringify(toCompact(c))).join('\n') + '\n';
    fs.appendFileSync(filePath, lines, 'utf-8');

    return newCandles.length;
  }

  /**
   * Get candles within a time range (unix seconds).
   */
  getCandles(token: string, resolution: Resolution, fromTs?: number, toTs?: number): Candle[] {
    const filePath = getFilePath(token, resolution);
    if (!fs.existsSync(filePath)) return [];

    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    const candles: Candle[] = [];

    for (const line of lines) {
      if (!line) continue;
      try {
        const compact: CompactCandle = JSON.parse(line);
        if (fromTs !== undefined && compact.t < fromTs) continue;
        if (toTs !== undefined && compact.t > toTs) continue;
        candles.push(fromCompact(compact));
      } catch {
        // Skip malformed lines
      }
    }

    return candles.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get the N most recent candles.
   */
  getLatest(token: string, resolution: Resolution, count: number): Candle[] {
    const filePath = getFilePath(token, resolution);
    if (!fs.existsSync(filePath)) return [];

    // Read file in reverse for efficiency on large files
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    const startIdx = Math.max(0, lines.length - count);
    const candles: Candle[] = [];

    for (let i = startIdx; i < lines.length; i++) {
      if (!lines[i]) continue;
      try {
        candles.push(fromCompact(JSON.parse(lines[i])));
      } catch {
        // Skip malformed
      }
    }

    return candles.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get the last timestamp stored for a token/resolution.
   */
  getLastTimestamp(token: string, resolution: Resolution): number | null {
    const latest = this.getLatest(token, resolution, 1);
    return latest.length > 0 ? latest[0].timestamp : null;
  }

  /**
   * Count total candles stored.
   */
  count(token: string, resolution: Resolution): number {
    const filePath = getFilePath(token, resolution);
    if (!fs.existsSync(filePath)) return 0;

    const content = fs.readFileSync(filePath, 'utf-8');
    return content.trim().split('\n').filter(l => l.length > 0).length;
  }

  /**
   * Aggregate 1m candles into higher timeframes.
   *
   * Logic:
   *   - 5m: group 1m candles by floor(timestamp / 300) * 300
   *   - 15m: group by floor(timestamp / 900) * 900
   *   - 1h: group by floor(timestamp / 3600) * 3600
   *
   * Uses first open, max high, min low, last close, sum volume.
   */
  aggregate(token: string, targetResolution: '5m' | '15m' | '1h', fromTs?: number): number {
    const periodSec = RESOLUTION_MS[targetResolution] / 1000;

    // Load 1m candles from the given timestamp
    const oneMinCandles = this.getCandles(token, '1m', fromTs);
    if (oneMinCandles.length === 0) return 0;

    // Group by period bucket
    const buckets = new Map<number, Candle[]>();
    for (const c of oneMinCandles) {
      const bucketTs = Math.floor(c.timestamp / periodSec) * periodSec;
      if (!buckets.has(bucketTs)) buckets.set(bucketTs, []);
      buckets.get(bucketTs)!.push(c);
    }

    // Build aggregated candles
    const aggregated: Candle[] = [];
    for (const [bucketTs, group] of buckets) {
      // Only include complete candles (has expected number of 1m candles)
      // For live, the last bucket may be incomplete -- include it anyway
      const sorted = group.sort((a, b) => a.timestamp - b.timestamp);
      aggregated.push({
        timestamp: bucketTs,
        open: sorted[0].open,
        high: Math.max(...sorted.map(c => c.high)),
        low: Math.min(...sorted.map(c => c.low)),
        close: sorted[sorted.length - 1].close,
        volume: sorted.reduce((sum, c) => sum + c.volume, 0),
      });
    }

    return this.append(token, targetResolution, aggregated);
  }

  /**
   * Run aggregation for all higher timeframes from 1m data.
   */
  aggregateAll(token: string, fromTs?: number): void {
    this.aggregate(token, '5m', fromTs);
    this.aggregate(token, '15m', fromTs);
    this.aggregate(token, '1h', fromTs);
  }
}
