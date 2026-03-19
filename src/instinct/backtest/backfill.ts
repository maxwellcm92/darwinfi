/**
 * backfill.ts - Historical data download utility
 *
 * Downloads 6 months of 1m OHLCV data from GeckoTerminal
 * using before_timestamp pagination.
 *
 * Usage: ts-node src/instinct/backtest/backfill.ts [--token ETH] [--months 6]
 *
 * This is a convenience wrapper around candle-collector's backfill mode.
 * For full backfill of all tokens, use:
 *   ts-node src/instinct/data/candle-collector.ts --backfill
 */

import { CandleStore } from '../data/candle-store';
import { ALL_TOKENS, buildOhlcvUrl } from '../data/pool-registry';
import { Candle } from '../types';

const DEFAULT_MONTHS = 6;
const MAX_CANDLES_PER_REQUEST = 1000;
const REQUEST_DELAY_MS = 2200;

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`GeckoTerminal ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

function parseOhlcv(data: unknown): Candle[] {
  const list = (data as { data: { attributes: { ohlcv_list: number[][] } } })
    ?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list)) return [];
  return list.map(row => ({
    timestamp: row[0], open: row[1], high: row[2],
    low: row[3], close: row[4], volume: row[5],
  }));
}

async function backfillToken(store: CandleStore, token: string, months: number): Promise<void> {
  const targetTs = Math.floor(Date.now() / 1000) - (months * 30 * 24 * 60 * 60);
  let beforeTs = Math.floor(Date.now() / 1000);
  let totalCandles = 0;
  let requests = 0;

  console.log(`[Backfill] ${token}: target ${new Date(targetTs * 1000).toISOString().split('T')[0]}`);

  while (beforeTs > targetTs) {
    try {
      const url = buildOhlcvUrl(token, '1m', MAX_CANDLES_PER_REQUEST, beforeTs);
      const data = await fetchJson(url);
      const candles = parseOhlcv(data);
      requests++;

      if (candles.length === 0) break;

      const newCount = store.append(token, '1m', candles);
      totalCandles += newCount;

      const oldestTs = Math.min(...candles.map(c => c.timestamp));
      beforeTs = oldestTs - 1;

      if (requests % 10 === 0) {
        const date = new Date(oldestTs * 1000).toISOString().split('T')[0];
        console.log(`  ${token}: ${totalCandles} candles, reached ${date}`);
      }

      await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
    } catch (err) {
      console.error(`  ${token} error:`, (err as Error).message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  // Aggregate higher timeframes
  store.aggregateAll(token);

  console.log(`[Backfill] ${token}: ${totalCandles} new candles (${requests} requests)`);
  console.log(`  1m: ${store.count(token, '1m')}, 5m: ${store.count(token, '5m')}, 15m: ${store.count(token, '15m')}, 1h: ${store.count(token, '1h')}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const tokenIdx = args.indexOf('--token');
  const monthsIdx = args.indexOf('--months');

  const tokens = tokenIdx >= 0 ? [args[tokenIdx + 1]] : ALL_TOKENS;
  const months = monthsIdx >= 0 ? parseInt(args[monthsIdx + 1]) : DEFAULT_MONTHS;

  const store = new CandleStore();

  console.log(`[Backfill] Starting ${months}-month backfill for ${tokens.length} tokens`);
  const start = Date.now();

  for (const token of tokens) {
    await backfillToken(store, token, months);
  }

  const elapsed = ((Date.now() - start) / 60_000).toFixed(1);
  console.log(`[Backfill] Complete in ${elapsed} minutes`);
}

main().catch(err => {
  console.error('[Backfill] Fatal error:', err);
  process.exit(1);
});
