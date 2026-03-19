/**
 * DarwinFi Performance Tracking & Composite Scoring
 *
 * Tracks per-strategy metrics, calculates composite fitness scores,
 * and manages rolling 24h windows for promotion decisions.
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface TradeRecord {
  id: string;
  strategyId: string;
  token: string;
  side: 'buy' | 'sell';
  entryPrice: number;
  exitPrice?: number;
  quantity: number;
  pnl?: number;
  pnlPct?: number;
  entryTime: Date;
  exitTime?: Date;
  status: 'open' | 'closed' | 'cancelled';
  fees: number;
}

export interface PerformanceMetrics {
  totalPnL: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  tradesCompleted: number;
  rolling24hPnL: number;
  rolling24hSharpe: number;
  rolling24hWinRate: number;
  lastMetricsReset: Date;
  tradeHistory: TradeRecord[];
  consecutiveOutperformCycles: number;
}

export interface HourlyReturn {
  hour: Date;
  returnPct: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const MIN_TRADES_FOR_SHARPE = 3;
const RISK_FREE_RATE_HOURLY = 0.05 / (365 * 24); // ~5% APR in hourly terms
const MIN_TRADES_FOR_PROMOTION = 5;

// Composite score weights
const W_ROLLING_PNL = 0.30;
const W_ROLLING_SHARPE = 0.25;
const W_ROLLING_WINRATE = 0.20;
const W_TOTAL_PNL = 0.15;
const W_DRAWDOWN = 0.10;

// ---------------------------------------------------------------------------
// PerformanceTracker
// ---------------------------------------------------------------------------

export class PerformanceTracker {
  private metrics: Map<string, PerformanceMetrics> = new Map();
  private hourlyReturns: Map<string, HourlyReturn[]> = new Map();
  private equityCurves: Map<string, number[]> = new Map();

  /**
   * Initialize tracking for a strategy. Safe to call multiple times --
   * will not overwrite existing data unless force is true.
   */
  initStrategy(strategyId: string, force = false): void {
    if (this.metrics.has(strategyId) && !force) {
      return;
    }
    this.metrics.set(strategyId, {
      totalPnL: 0,
      winRate: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      tradesCompleted: 0,
      rolling24hPnL: 0,
      rolling24hSharpe: 0,
      rolling24hWinRate: 0,
      lastMetricsReset: new Date(),
      tradeHistory: [],
      consecutiveOutperformCycles: 0,
    });
    this.hourlyReturns.set(strategyId, []);
    this.equityCurves.set(strategyId, [0]);
    console.log(`[DarwinFi] Performance tracker initialized for strategy ${strategyId}`);
  }

  /**
   * Record a completed trade and update all derived metrics.
   */
  recordTrade(trade: TradeRecord): void {
    const m = this.metrics.get(trade.strategyId);
    if (!m) {
      console.error(`[DarwinFi] Cannot record trade -- strategy ${trade.strategyId} not tracked`);
      return;
    }

    // Ensure the trade is marked closed with PnL
    if (trade.status !== 'closed' || trade.pnl === undefined) {
      // Store as open position, don't count in metrics
      m.tradeHistory.push(trade);
      return;
    }

    m.tradeHistory.push(trade);
    m.tradesCompleted += 1;
    m.totalPnL += trade.pnl;

    // Update equity curve
    const curve = this.equityCurves.get(trade.strategyId) || [0];
    const lastEquity = curve[curve.length - 1];
    curve.push(lastEquity + trade.pnl);
    this.equityCurves.set(trade.strategyId, curve);

    // Update max drawdown from equity curve
    m.maxDrawdown = this.calculateMaxDrawdown(curve);

    // Update win rate (all time)
    const closedTrades = m.tradeHistory.filter(t => t.status === 'closed' && t.pnl !== undefined);
    const wins = closedTrades.filter(t => (t.pnl as number) > 0).length;
    m.winRate = closedTrades.length > 0 ? wins / closedTrades.length : 0;

    // Record hourly return bucket
    this.recordHourlyReturn(trade.strategyId, trade);

    // Recompute rolling metrics
    this.recomputeRollingMetrics(trade.strategyId);

    // Recompute all-time Sharpe
    m.sharpeRatio = this.calculateSharpeRatio(trade.strategyId, false);

    console.log(
      `[DarwinFi] Trade recorded for ${trade.strategyId}: ` +
      `PnL=$${trade.pnl.toFixed(2)} | Total=$${m.totalPnL.toFixed(2)} | ` +
      `WR=${(m.winRate * 100).toFixed(1)}% | Trades=${m.tradesCompleted}`
    );
  }

  /**
   * Update a trade record (e.g., when a position closes).
   */
  closeTrade(
    strategyId: string,
    tradeId: string,
    exitPrice: number,
    exitTime: Date,
    fees: number = 0,
  ): TradeRecord | null {
    const m = this.metrics.get(strategyId);
    if (!m) return null;

    const trade = m.tradeHistory.find(t => t.id === tradeId && t.status === 'open');
    if (!trade) {
      console.error(`[DarwinFi] Open trade ${tradeId} not found for strategy ${strategyId}`);
      return null;
    }

    trade.exitPrice = exitPrice;
    trade.exitTime = exitTime;
    trade.fees += fees;
    trade.status = 'closed';

    if (trade.side === 'buy') {
      trade.pnl = (exitPrice - trade.entryPrice) * trade.quantity - trade.fees;
      trade.pnlPct = (trade.pnl / (trade.entryPrice * trade.quantity)) * 100;
    } else {
      trade.pnl = (trade.entryPrice - exitPrice) * trade.quantity - trade.fees;
      trade.pnlPct = (trade.pnl / (trade.entryPrice * trade.quantity)) * 100;
    }

    // Now re-record as closed to update metrics
    // Remove the old entry first, then re-record
    const idx = m.tradeHistory.indexOf(trade);
    m.tradeHistory.splice(idx, 1);
    this.recordTrade(trade);

    return trade;
  }

  /**
   * Get the composite fitness score for a strategy.
   * Returns 0 if insufficient data.
   */
  getCompositeScore(strategyId: string): number {
    const m = this.metrics.get(strategyId);
    if (!m) return 0;

    // Need the full set of strategy IDs for normalization
    const allIds = Array.from(this.metrics.keys());
    return this.computeCompositeScore(strategyId, allIds);
  }

  /**
   * Get sorted leaderboard of all tracked strategies.
   */
  getLeaderboard(): Array<{ strategyId: string; score: number; metrics: PerformanceMetrics }> {
    const allIds = Array.from(this.metrics.keys());
    const entries = allIds.map(id => ({
      strategyId: id,
      score: this.computeCompositeScore(id, allIds),
      metrics: this.getMetrics(id)!,
    }));
    entries.sort((a, b) => b.score - a.score);
    return entries;
  }

  /**
   * Check if a strategy is eligible for promotion (min trade count met).
   */
  isPromotionEligible(strategyId: string): boolean {
    const m = this.metrics.get(strategyId);
    if (!m) return false;
    return m.tradesCompleted >= MIN_TRADES_FOR_PROMOTION;
  }

  /**
   * Increment the consecutive outperform cycle counter for a strategy.
   */
  incrementOutperformCycle(strategyId: string): void {
    const m = this.metrics.get(strategyId);
    if (m) {
      m.consecutiveOutperformCycles += 1;
    }
  }

  /**
   * Reset the consecutive outperform cycle counter.
   */
  resetOutperformCycle(strategyId: string): void {
    const m = this.metrics.get(strategyId);
    if (m) {
      m.consecutiveOutperformCycles = 0;
    }
  }

  /**
   * Get raw metrics for a strategy.
   */
  getMetrics(strategyId: string): PerformanceMetrics | null {
    return this.metrics.get(strategyId) || null;
  }

  /**
   * Reset all metrics for a strategy (used when a variation changes genome).
   * Preserves the tracker entry but zeros everything.
   */
  resetMetrics(strategyId: string): void {
    console.log(`[DarwinFi] Resetting performance metrics for ${strategyId}`);
    this.initStrategy(strategyId, true);
  }

  /**
   * Get the number of completed trades across all strategies.
   */
  getTotalCompletedTrades(): number {
    let total = 0;
    for (const m of this.metrics.values()) {
      total += m.tradesCompleted;
    }
    return total;
  }

  /**
   * Get open positions for a strategy.
   */
  getOpenPositions(strategyId: string): TradeRecord[] {
    const m = this.metrics.get(strategyId);
    if (!m) return [];
    return m.tradeHistory.filter(t => t.status === 'open');
  }

  /**
   * Serialize all metrics to a plain object for persistence or reporting.
   */
  serialize(): Record<string, PerformanceMetrics> {
    const result: Record<string, PerformanceMetrics> = {};
    for (const [id, m] of this.metrics.entries()) {
      result[id] = { ...m };
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private recordHourlyReturn(strategyId: string, trade: TradeRecord): void {
    if (!trade.pnlPct) return;
    const returns = this.hourlyReturns.get(strategyId) || [];
    const hourBucket = new Date(trade.exitTime || new Date());
    hourBucket.setMinutes(0, 0, 0);

    const existing = returns.find(r => r.hour.getTime() === hourBucket.getTime());
    if (existing) {
      // Aggregate returns within the same hour
      existing.returnPct += trade.pnlPct;
    } else {
      returns.push({ hour: hourBucket, returnPct: trade.pnlPct });
    }
    this.hourlyReturns.set(strategyId, returns);
  }

  private recomputeRollingMetrics(strategyId: string): void {
    const m = this.metrics.get(strategyId);
    if (!m) return;

    const cutoff = new Date(Date.now() - ROLLING_WINDOW_MS);
    const recentTrades = m.tradeHistory.filter(
      t => t.status === 'closed' && t.exitTime && t.exitTime >= cutoff && t.pnl !== undefined
    );

    // Rolling 24h PnL
    m.rolling24hPnL = recentTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);

    // Rolling 24h Win Rate
    if (recentTrades.length > 0) {
      const recentWins = recentTrades.filter(t => (t.pnl as number) > 0).length;
      m.rolling24hWinRate = recentWins / recentTrades.length;
    } else {
      m.rolling24hWinRate = 0;
    }

    // Rolling 24h Sharpe
    m.rolling24hSharpe = this.calculateSharpeRatio(strategyId, true);
  }

  private calculateSharpeRatio(strategyId: string, rolling: boolean): number {
    const returns = this.hourlyReturns.get(strategyId) || [];
    const cutoff = rolling ? new Date(Date.now() - ROLLING_WINDOW_MS) : new Date(0);
    const filtered = returns.filter(r => r.hour >= cutoff);

    if (filtered.length < MIN_TRADES_FOR_SHARPE) {
      return 0;
    }

    const values = filtered.map(r => r.returnPct / 100); // Convert to decimal
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1);
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;

    return (mean - RISK_FREE_RATE_HOURLY) / stdDev;
  }

  private calculateMaxDrawdown(equityCurve: number[]): number {
    if (equityCurve.length < 2) return 0;

    let peak = equityCurve[0];
    let maxDD = 0;

    for (const equity of equityCurve) {
      if (equity > peak) {
        peak = equity;
      }
      if (peak > 0) {
        const dd = (peak - equity) / peak;
        if (dd > maxDD) {
          maxDD = dd;
        }
      }
    }
    return maxDD;
  }

  private computeCompositeScore(strategyId: string, allIds: string[]): number {
    const m = this.metrics.get(strategyId);
    if (!m || m.tradesCompleted === 0) return 0;

    // Gather raw values for normalization across all strategies
    const allMetrics = allIds
      .map(id => this.metrics.get(id))
      .filter((x): x is PerformanceMetrics => x !== undefined && x.tradesCompleted > 0);

    if (allMetrics.length === 0) return 0;

    // Sigmoid normalization constants
    const PNL_SCALE = 10; // Scale for dollar-denominated PnL values
    const DRAWDOWN_SCALE = 5; // Scale for drawdown (0-1 range, so amplify)

    // Normalize rolling 24h PnL via sigmoid (center=0, positive PnL -> higher score)
    const normalizedRolling24hPnL = this.sigmoidNormalize(m.rolling24hPnL, 0, PNL_SCALE);

    // Rolling 24h Sharpe via sigmoid (center=0)
    const normalizedRollingSharpe = this.sigmoidNormalize(m.rolling24hSharpe);

    // Rolling 24h Win Rate -- already [0, 1], keep as-is
    const normalizedRollingWinRate = m.rolling24hWinRate;

    // Normalize total PnL via sigmoid (center=0)
    const normalizedTotalPnL = this.sigmoidNormalize(m.totalPnL, 0, PNL_SCALE);

    // Normalize max drawdown via sigmoid (invert: lower drawdown is better)
    const normalizedDrawdown = 1 - this.sigmoidNormalize(m.maxDrawdown, 0, DRAWDOWN_SCALE);

    const score =
      normalizedRolling24hPnL * W_ROLLING_PNL +
      normalizedRollingSharpe * W_ROLLING_SHARPE +
      normalizedRollingWinRate * W_ROLLING_WINRATE +
      normalizedTotalPnL * W_TOTAL_PNL +
      normalizedDrawdown * W_DRAWDOWN;

    return Math.max(0, Math.min(1, score)); // Clamp [0, 1]
  }

  private sigmoidNormalize(value: number, center: number = 0, scale: number = 1): number {
    // Maps any real number to (0, 1), centered at 0.5 for value=center
    return 1 / (1 + Math.exp(-(value - center) / scale));
  }
}
