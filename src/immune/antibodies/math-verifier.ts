/**
 * DarwinFi Immune System - Math Verifier (Antibody)
 *
 * Independently re-implements the composite scoring formulas from
 * src/agent/performance.ts and verifies stored values in agent-state.json.
 * Any drift beyond THRESHOLDS.compositeScoreDrift is flagged as an error.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CheckResult } from '../types';
import { THRESHOLDS, MONITORED_STATE_FILES } from '../config';

// ---------------------------------------------------------------------------
// Constants (mirrored from performance.ts -- independent re-implementation)
// ---------------------------------------------------------------------------

const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;
const MIN_TRADES_FOR_SHARPE = 3;
const RISK_FREE_RATE_HOURLY = 0.05 / (365 * 24);

const W_ROLLING_PNL = 0.30;
const W_ROLLING_SHARPE = 0.25;
const W_ROLLING_WINRATE = 0.20;
const W_TOTAL_PNL = 0.15;
const W_DRAWDOWN = 0.10;

const PNL_SCALE = 10;
const DRAWDOWN_SCALE = 5;

// ---------------------------------------------------------------------------
// Independent math functions
// ---------------------------------------------------------------------------

function sigmoidNormalize(value: number, center: number = 0, scale: number = 1): number {
  return 1 / (1 + Math.exp(-(value - center) / scale));
}

function calculateMaxDrawdown(equityCurve: number[]): number {
  if (equityCurve.length < 2) return 0;
  let peak = equityCurve[0];
  let maxDD = 0;
  for (const equity of equityCurve) {
    if (equity > peak) peak = equity;
    if (peak > 0) {
      const dd = (peak - equity) / peak;
      if (dd > maxDD) maxDD = dd;
    }
  }
  return maxDD;
}

function calculateSharpeRatio(returns: number[]): number {
  if (returns.length < MIN_TRADES_FOR_SHARPE) return 0;
  const values = returns.map(r => r / 100); // pct to decimal
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  return (mean - RISK_FREE_RATE_HOURLY) / stdDev;
}

function calculateWinRate(trades: any[]): number {
  const closed = trades.filter((t: any) => t.status === 'closed' && t.pnl !== undefined);
  if (closed.length === 0) return 0;
  const wins = closed.filter((t: any) => t.pnl > 0).length;
  return wins / closed.length;
}

function buildEquityCurve(trades: any[]): number[] {
  const curve = [0];
  const closed = trades.filter((t: any) => t.status === 'closed' && t.pnl !== undefined);
  for (const trade of closed) {
    curve.push(curve[curve.length - 1] + trade.pnl);
  }
  return curve;
}

function buildHourlyReturns(trades: any[], rolling: boolean): number[] {
  const cutoff = rolling ? Date.now() - ROLLING_WINDOW_MS : 0;
  const closed = trades.filter((t: any) => {
    if (t.status !== 'closed' || t.pnlPct === undefined) return false;
    const exitTime = t.exitTime ? new Date(t.exitTime).getTime() : 0;
    return exitTime >= cutoff;
  });

  // Bucket by hour
  const hourBuckets = new Map<number, number>();
  for (const trade of closed) {
    const exitDate = new Date(trade.exitTime);
    exitDate.setMinutes(0, 0, 0);
    const key = exitDate.getTime();
    hourBuckets.set(key, (hourBuckets.get(key) || 0) + trade.pnlPct);
  }

  return Array.from(hourBuckets.values());
}

function recomputeRollingPnL(trades: any[]): number {
  const cutoff = Date.now() - ROLLING_WINDOW_MS;
  return trades
    .filter((t: any) => {
      if (t.status !== 'closed' || t.pnl === undefined) return false;
      const exitTime = t.exitTime ? new Date(t.exitTime).getTime() : 0;
      return exitTime >= cutoff;
    })
    .reduce((sum: number, t: any) => sum + (t.pnl || 0), 0);
}

function recomputeRollingWinRate(trades: any[]): number {
  const cutoff = Date.now() - ROLLING_WINDOW_MS;
  const recent = trades.filter((t: any) => {
    if (t.status !== 'closed' || t.pnl === undefined) return false;
    const exitTime = t.exitTime ? new Date(t.exitTime).getTime() : 0;
    return exitTime >= cutoff;
  });
  if (recent.length === 0) return 0;
  const wins = recent.filter((t: any) => t.pnl > 0).length;
  return wins / recent.length;
}

interface StrategyPerf {
  totalPnL: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  tradesCompleted: number;
  rolling24hPnL: number;
  rolling24hSharpe: number;
  rolling24hWinRate: number;
  tradeHistory: any[];
}

function computeCompositeScore(metrics: StrategyPerf): number {
  if (metrics.tradesCompleted === 0) return 0;

  const normalizedRolling24hPnL = sigmoidNormalize(metrics.rolling24hPnL, 0, PNL_SCALE);
  const normalizedRollingSharpe = sigmoidNormalize(metrics.rolling24hSharpe, 0, 1);
  const normalizedRollingWinRate = metrics.rolling24hWinRate;
  const normalizedTotalPnL = sigmoidNormalize(metrics.totalPnL, 0, PNL_SCALE);
  const normalizedDrawdown = 1 - sigmoidNormalize(metrics.maxDrawdown, 0, DRAWDOWN_SCALE);

  const score =
    normalizedRolling24hPnL * W_ROLLING_PNL +
    normalizedRollingSharpe * W_ROLLING_SHARPE +
    normalizedRollingWinRate * W_ROLLING_WINRATE +
    normalizedTotalPnL * W_TOTAL_PNL +
    normalizedDrawdown * W_DRAWDOWN;

  return Math.max(0, Math.min(1, score));
}

// ---------------------------------------------------------------------------
// Main verifier
// ---------------------------------------------------------------------------

export async function verifyMath(): Promise<CheckResult> {
  const start = Date.now();
  const drifts: Array<{ strategyId: string; field: string; stored: number; computed: number; delta: number }> = [];

  try {
    const statePath = path.resolve(process.cwd(), MONITORED_STATE_FILES.agentState);
    const raw = fs.readFileSync(statePath, 'utf-8');
    const state = JSON.parse(raw);

    const performance: Record<string, StrategyPerf> = state.performance || {};
    const strategyIds = Object.keys(performance);

    if (strategyIds.length === 0) {
      return {
        checkId: 'antibody.math_verifier',
        category: 'math',
        severity: 'warning',
        message: 'No performance data found in agent-state.json',
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      };
    }

    for (const sid of strategyIds) {
      const stored = performance[sid];
      const trades = stored.tradeHistory || [];

      // Re-compute total PnL
      const closedTrades = trades.filter((t: any) => t.status === 'closed' && t.pnl !== undefined);
      const computedTotalPnL = closedTrades.reduce((sum: number, t: any) => sum + t.pnl, 0);
      const pnlDelta = Math.abs(stored.totalPnL - computedTotalPnL);
      if (pnlDelta > 0.001) {
        drifts.push({ strategyId: sid, field: 'totalPnL', stored: stored.totalPnL, computed: computedTotalPnL, delta: pnlDelta });
      }

      // Re-compute win rate
      const computedWinRate = calculateWinRate(trades);
      const wrDelta = Math.abs(stored.winRate - computedWinRate);
      if (wrDelta > 0.001) {
        drifts.push({ strategyId: sid, field: 'winRate', stored: stored.winRate, computed: computedWinRate, delta: wrDelta });
      }

      // Re-compute max drawdown
      const equityCurve = buildEquityCurve(trades);
      const computedMaxDD = calculateMaxDrawdown(equityCurve);
      const ddDelta = Math.abs(stored.maxDrawdown - computedMaxDD);
      if (ddDelta > 0.001) {
        drifts.push({ strategyId: sid, field: 'maxDrawdown', stored: stored.maxDrawdown, computed: computedMaxDD, delta: ddDelta });
      }

      // Re-compute Sharpe (all-time)
      const allReturns = buildHourlyReturns(trades, false);
      const computedSharpe = calculateSharpeRatio(allReturns);
      const sharpeDelta = Math.abs(stored.sharpeRatio - computedSharpe);
      if (sharpeDelta > 0.001) {
        drifts.push({ strategyId: sid, field: 'sharpeRatio', stored: stored.sharpeRatio, computed: computedSharpe, delta: sharpeDelta });
      }

      // Re-compute rolling 24h PnL
      const computedRollingPnL = recomputeRollingPnL(trades);
      const rPnlDelta = Math.abs(stored.rolling24hPnL - computedRollingPnL);
      if (rPnlDelta > 0.001) {
        drifts.push({ strategyId: sid, field: 'rolling24hPnL', stored: stored.rolling24hPnL, computed: computedRollingPnL, delta: rPnlDelta });
      }

      // Re-compute rolling 24h win rate
      const computedRollingWR = recomputeRollingWinRate(trades);
      const rwrDelta = Math.abs(stored.rolling24hWinRate - computedRollingWR);
      if (rwrDelta > 0.001) {
        drifts.push({ strategyId: sid, field: 'rolling24hWinRate', stored: stored.rolling24hWinRate, computed: computedRollingWR, delta: rwrDelta });
      }

      // Re-compute rolling 24h Sharpe
      const rollingReturns = buildHourlyReturns(trades, true);
      const computedRollingSharpe = calculateSharpeRatio(rollingReturns);
      const rSharpeDelta = Math.abs(stored.rolling24hSharpe - computedRollingSharpe);
      if (rSharpeDelta > 0.001) {
        drifts.push({ strategyId: sid, field: 'rolling24hSharpe', stored: stored.rolling24hSharpe, computed: computedRollingSharpe, delta: rSharpeDelta });
      }

      // Re-compute composite score and verify it matches what the agent would compute
      const recomputedMetrics: StrategyPerf = {
        totalPnL: computedTotalPnL,
        winRate: computedWinRate,
        sharpeRatio: computedSharpe,
        maxDrawdown: computedMaxDD,
        tradesCompleted: closedTrades.length,
        rolling24hPnL: computedRollingPnL,
        rolling24hSharpe: computedRollingSharpe,
        rolling24hWinRate: computedRollingWR,
        tradeHistory: trades,
      };

      const storedMetrics: StrategyPerf = {
        ...stored,
      };

      const compositeFromStored = computeCompositeScore(storedMetrics);
      const compositeFromRecomputed = computeCompositeScore(recomputedMetrics);
      const compositeDelta = Math.abs(compositeFromStored - compositeFromRecomputed);
      if (compositeDelta > THRESHOLDS.compositeScoreDrift) {
        drifts.push({
          strategyId: sid,
          field: 'compositeScore',
          stored: compositeFromStored,
          computed: compositeFromRecomputed,
          delta: compositeDelta,
        });
      }
    }

    if (drifts.length > 0) {
      return {
        checkId: 'antibody.math_verifier',
        category: 'math',
        severity: 'error',
        message: `Math drift detected in ${drifts.length} metric(s) across strategies`,
        details: { drifts },
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      };
    }

    return {
      checkId: 'antibody.math_verifier',
      category: 'math',
      severity: 'ok',
      message: `All metrics verified for ${strategyIds.length} strategies -- no drift detected`,
      details: { strategiesChecked: strategyIds.length },
      timestamp: Date.now(),
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      checkId: 'antibody.math_verifier',
      category: 'math',
      severity: 'error',
      message: `Math verification failed: ${err.message}`,
      details: { error: err.message, stack: err.stack },
      timestamp: Date.now(),
      durationMs: Date.now() - start,
    };
  }
}
