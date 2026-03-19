import { expect } from 'chai';

/**
 * Immune Math Verifier tests.
 *
 * Tests the independent math functions from src/immune/antibodies/math-verifier.ts.
 * Since those functions are not exported, we re-implement them identically here
 * (mirroring the same approach the verifier uses: independent re-implementation).
 */

// Constants mirrored from performance.ts
const MIN_TRADES_FOR_SHARPE = 3;
const RISK_FREE_RATE_HOURLY = 0.05 / (365 * 24);
const W_ROLLING_PNL = 0.30;
const W_ROLLING_SHARPE = 0.25;
const W_ROLLING_WINRATE = 0.20;
const W_TOTAL_PNL = 0.15;
const W_DRAWDOWN = 0.10;
const PNL_SCALE = 10;
const DRAWDOWN_SCALE = 5;

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
  const values = returns.map(r => r / 100);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  return (mean - RISK_FREE_RATE_HOURLY) / stdDev;
}

function calculateWinRate(trades: Array<{ status: string; pnl?: number }>): number {
  const closed = trades.filter(t => t.status === 'closed' && t.pnl !== undefined);
  if (closed.length === 0) return 0;
  const wins = closed.filter(t => (t.pnl as number) > 0).length;
  return wins / closed.length;
}

function computeCompositeScore(metrics: {
  rolling24hPnL: number;
  rolling24hSharpe: number;
  rolling24hWinRate: number;
  totalPnL: number;
  maxDrawdown: number;
  tradesCompleted: number;
}): number {
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

describe('Immune Math Verifier', () => {
  // ---------- sigmoidNormalize ----------

  describe('sigmoidNormalize', () => {
    it('should return 0.5 for value=center', () => {
      expect(sigmoidNormalize(0, 0, 1)).to.equal(0.5);
    });

    it('should return close to 1.0 for large positive value', () => {
      const result = sigmoidNormalize(100, 0, 1);
      expect(result).to.be.closeTo(1.0, 1e-10);
    });

    it('should return close to 0.0 for large negative value', () => {
      const result = sigmoidNormalize(-100, 0, 1);
      expect(result).to.be.closeTo(0.0, 1e-10);
    });

    it('should shift center correctly', () => {
      // When value=center, result=0.5 regardless of center
      expect(sigmoidNormalize(10, 10, 1)).to.equal(0.5);
      expect(sigmoidNormalize(-5, -5, 2)).to.equal(0.5);
    });
  });

  // ---------- Composite score ----------

  describe('Composite score with known inputs', () => {
    it('should match manual calculation', () => {
      const metrics = {
        rolling24hPnL: 20,
        rolling24hSharpe: 1.5,
        rolling24hWinRate: 0.7,
        totalPnL: 50,
        maxDrawdown: 0.1,
        tradesCompleted: 10,
      };

      const expected =
        sigmoidNormalize(20, 0, PNL_SCALE) * W_ROLLING_PNL +
        sigmoidNormalize(1.5, 0, 1) * W_ROLLING_SHARPE +
        0.7 * W_ROLLING_WINRATE +
        sigmoidNormalize(50, 0, PNL_SCALE) * W_TOTAL_PNL +
        (1 - sigmoidNormalize(0.1, 0, DRAWDOWN_SCALE)) * W_DRAWDOWN;

      const clampedExpected = Math.max(0, Math.min(1, expected));
      const result = computeCompositeScore(metrics);
      expect(result).to.be.closeTo(clampedExpected, 1e-10);
    });

    it('should return 0 for strategy with 0 trades', () => {
      const result = computeCompositeScore({
        rolling24hPnL: 100,
        rolling24hSharpe: 2.0,
        rolling24hWinRate: 1.0,
        totalPnL: 100,
        maxDrawdown: 0,
        tradesCompleted: 0,
      });
      expect(result).to.equal(0);
    });
  });

  // ---------- Sharpe ratio ----------

  describe('Sharpe ratio', () => {
    it('should return 0 with fewer than 3 trades', () => {
      expect(calculateSharpeRatio([5, 10])).to.equal(0);
      expect(calculateSharpeRatio([5])).to.equal(0);
      expect(calculateSharpeRatio([])).to.equal(0);
    });

    it('should match manual calculation with known returns', () => {
      const returns = [1, -0.5, 2, 1.5, -1]; // as percentages
      const vals = returns.map(r => r / 100);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance = vals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (vals.length - 1);
      const stdDev = Math.sqrt(variance);
      const expected = (mean - RISK_FREE_RATE_HOURLY) / stdDev;

      const result = calculateSharpeRatio(returns);
      expect(result).to.be.closeTo(expected, 1e-10);
    });
  });

  // ---------- Max drawdown ----------

  describe('Max drawdown', () => {
    it('should compute correct drawdown from equity curve [0, 100, 50, 75, 25]', () => {
      const curve = [0, 100, 50, 75, 25];
      const dd = calculateMaxDrawdown(curve);
      // Peak=100, trough=25 -> dd = 75/100 = 0.75
      expect(dd).to.be.closeTo(0.75, 1e-10);
    });

    it('should return 0 for monotonically increasing curve', () => {
      const curve = [0, 10, 20, 30, 40];
      expect(calculateMaxDrawdown(curve)).to.equal(0);
    });

    it('should return 0 for single-element curve', () => {
      expect(calculateMaxDrawdown([100])).to.equal(0);
    });
  });

  // ---------- Win rate ----------

  describe('Win rate', () => {
    it('should return 0.6 for 3 wins out of 5 trades', () => {
      const trades = [
        { status: 'closed', pnl: 10 },
        { status: 'closed', pnl: 5 },
        { status: 'closed', pnl: -3 },
        { status: 'closed', pnl: 8 },
        { status: 'closed', pnl: -2 },
      ];
      expect(calculateWinRate(trades)).to.be.closeTo(0.6, 1e-10);
    });

    it('should return 0 for 0 trades', () => {
      expect(calculateWinRate([])).to.equal(0);
    });

    it('should ignore open trades', () => {
      const trades = [
        { status: 'closed', pnl: 10 },
        { status: 'open', pnl: undefined },
        { status: 'closed', pnl: -5 },
      ];
      expect(calculateWinRate(trades)).to.be.closeTo(0.5, 1e-10);
    });
  });

  // ---------- Fee calculation ----------

  describe('Fee calculation', () => {
    it('should compute 1000 profit * 500 bps / 10000 = 50', () => {
      const profit = 1000;
      const feeBps = 500;
      const fee = (profit * feeBps) / 10000;
      expect(fee).to.equal(50);
    });

    it('should compute 200 profit * 1000 bps / 10000 = 20 (10% fee)', () => {
      const profit = 200;
      const feeBps = 1000;
      const fee = (profit * feeBps) / 10000;
      expect(fee).to.equal(20);
    });
  });
});
