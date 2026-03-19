/**
 * candle-collector.ts - GeckoTerminal OHLCV fetcher
 *
 * PM2 entry point for `darwinfi-candles` process.
 *
 * Two modes:
 *   1. Live: Every 60s, fetch latest 1m candle for each token (9 req/min)
 *   2. Backfill: Walk backwards 6 months per token using before_timestamp
 *
 * Usage:
 *   ts-node src/instinct/data/candle-collector.ts              # Live mode
 *   ts-node src/instinct/data/candle-collector.ts --backfill   # Backfill mode
 */

import { CandleStore } from './candle-store';
import { POOL_REGISTRY, ALL_TOKENS, buildOhlcvUrl } from './pool-registry';
import { Candle } from '../types';

const LIVE_INTERVAL_MS = 100_000;      // 100s between cycles (8 tokens * 8s delay = 64s per cycle + margin)
const BACKFILL_MONTHS = 6;
const REQUEST_DELAY_MS = 8000;         // 8s between requests (~7.5 req/min)
const BACKFILL_DELAY_MS = 6000;        // 6s for backfill (slightly faster since sequential)
const MAX_CANDLES_PER_REQUEST = 1000;

const store = new CandleStore();

// -------------------------------------------------------------------
// HTTP fetch with 429 retry (Node 18+ built-in fetch)
// -------------------------------------------------------------------

async function fetchJson(url: string, retries = 2): Promise<unknown> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });
    if (response.status === 429 && attempt < retries) {
      const backoff = (attempt + 1) * 15_000; // 15s, 30s
      console.warn(`[Candles] 429 rate limited, backing off ${backoff / 1000}s...`);
      await sleep(backoff);
      continue;
    }
    if (!response.ok) {
      throw new Error(`GeckoTerminal ${response.status}: ${response.statusText} -- ${url}`);
    }
    return response.json();
  }
  throw new Error(`GeckoTerminal: max retries exceeded for ${url}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// -------------------------------------------------------------------
// Parse GeckoTerminal OHLCV response
// -------------------------------------------------------------------

function parseOhlcv(data: unknown): Candle[] {
  const list = (data as { data: { attributes: { ohlcv_list: number[][] } } })
    ?.data?.attributes?.ohlcv_list;

  if (!Array.isArray(list)) return [];

  return list.map(row => ({
    timestamp: row[0],
    open: row[1],
    high: row[2],
    low: row[3],
    close: row[4],
    volume: row[5],
  }));
}

// -------------------------------------------------------------------
// Live collection: fetch latest candles every 60s
// -------------------------------------------------------------------

async function fetchLatestCandles(): Promise<void> {
  let fetched = 0;
  let errors = 0;

  for (const token of ALL_TOKENS) {
    try {
      const url = buildOhlcvUrl(token, '1m', 5); // Last 5 candles (overlap for dedup)
      const data = await fetchJson(url);
      const candles = parseOhlcv(data);
      const newCount = store.append(token, '1m', candles);
      fetched += newCount;

      // Aggregate to higher timeframes
      if (newCount > 0) {
        const fiveMinAgo = Math.floor(Date.now() / 1000) - 600;
        store.aggregateAll(token, fiveMinAgo);
      }

      await sleep(REQUEST_DELAY_MS);
    } catch (err) {
      errors++;
      console.error(`[Candles] Error fetching ${token}:`, (err as Error).message);
      await sleep(REQUEST_DELAY_MS);
    }
  }

  const total1m = ALL_TOKENS.reduce((sum, t) => sum + store.count(t, '1m'), 0);
  console.log(
    `[Candles] Tick: +${fetched} new candles, ${errors} errors, ${total1m} total 1m candles`
  );
}

// -------------------------------------------------------------------
// Backfill: walk backwards 6 months per token
// -------------------------------------------------------------------

async function backfillToken(token: string): Promise<void> {
  const sixMonthsAgo = Math.floor(Date.now() / 1000) - (BACKFILL_MONTHS * 30 * 24 * 60 * 60);
  let beforeTs = Math.floor(Date.now() / 1000);
  let totalCandles = 0;
  let requests = 0;

  console.log(`[Backfill] Starting ${token} -- target: ${new Date(sixMonthsAgo * 1000).toISOString()}`);

  while (beforeTs > sixMonthsAgo) {
    try {
      const url = buildOhlcvUrl(token, '1m', MAX_CANDLES_PER_REQUEST, beforeTs);
      const data = await fetchJson(url);
      const candles = parseOhlcv(data);
      requests++;

      if (candles.length === 0) {
        console.log(`[Backfill] ${token}: no more data at ${new Date(beforeTs * 1000).toISOString()}`);
        break;
      }

      const newCount = store.append(token, '1m', candles);
      totalCandles += newCount;

      // Move before_timestamp to oldest candle minus 1
      const oldestTs = Math.min(...candles.map(c => c.timestamp));
      beforeTs = oldestTs - 1;

      if (requests % 10 === 0) {
        const date = new Date(oldestTs * 1000).toISOString().split('T')[0];
        console.log(`[Backfill] ${token}: ${totalCandles} candles, reached ${date} (${requests} requests)`);
      }

      await sleep(BACKFILL_DELAY_MS);
    } catch (err) {
      console.error(`[Backfill] ${token} error:`, (err as Error).message);
      await sleep(15000); // 15s on error
    }
  }

  // Aggregate all higher timeframes
  console.log(`[Backfill] ${token}: aggregating 5m/15m/1h...`);
  store.aggregateAll(token);

  const counts = {
    '1m': store.count(token, '1m'),
    '5m': store.count(token, '5m'),
    '15m': store.count(token, '15m'),
    '1h': store.count(token, '1h'),
  };
  console.log(`[Backfill] ${token} complete: ${JSON.stringify(counts)} (${requests} API calls)`);
}

async function runBackfill(): Promise<void> {
  console.log(`[Backfill] Starting ${BACKFILL_MONTHS}-month backfill for ${ALL_TOKENS.length} tokens`);
  const start = Date.now();

  for (const token of ALL_TOKENS) {
    await backfillToken(token);
  }

  const elapsed = ((Date.now() - start) / 60_000).toFixed(1);
  console.log(`[Backfill] Complete in ${elapsed} minutes`);
}

// -------------------------------------------------------------------
// Live loop
// -------------------------------------------------------------------

async function runLiveLoop(): Promise<void> {
  console.log(`[Candles] Live collection started for ${ALL_TOKENS.length} tokens`);
  console.log(`[Candles] Interval: ${LIVE_INTERVAL_MS / 1000}s, tokens: ${ALL_TOKENS.join(', ')}`);

  // Initial fetch
  await fetchLatestCandles();

  // Recurring fetch
  setInterval(async () => {
    try {
      await fetchLatestCandles();
    } catch (err) {
      console.error('[Candles] Live loop error:', (err as Error).message);
    }
  }, LIVE_INTERVAL_MS);
}

// -------------------------------------------------------------------
// Entry point
// -------------------------------------------------------------------

async function main(): Promise<void> {
  const isBackfill = process.argv.includes('--backfill');

  if (isBackfill) {
    await runBackfill();
    process.exit(0);
  } else {
    await runLiveLoop();
  }
}

main().catch(err => {
  console.error('[Candles] Fatal error:', err);
  process.exit(1);
});
