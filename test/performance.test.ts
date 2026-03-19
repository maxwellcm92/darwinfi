import { PerformanceTracker, TradeRecord } from '../src/agent/performance';
import { expect } from 'chai';

/**
 * Helper: create a closed trade record with defaults.
 */
function closedTrade(overrides: Partial<TradeRecord> & { strategyId: string }): TradeRecord {
  return {
    id: `trade-${Math.random().toString(36).slice(2, 8)}`,
    token: 'ETH',
    side: 'buy',
    entryPrice: 100,
    exitPrice: 110,
    quantity: 1,
    pnl: 10,
    pnlPct: 10,
    entryTime: new Date('2025-01-01T00:00:00Z'),
    exitTime: new Date('2025-01-01T01:00:00Z'),
    status: 'closed',
    fees: 0,
    ...overrides,
  };
}

/**
 * Helper: create an open trade record.
 */
function openTrade(overrides: Partial<TradeRecord> & { strategyId: string }): TradeRecord {
  return {
    id: `trade-${Math.random().toString(36).slice(2, 8)}`,
    token: 'ETH',
    side: 'buy',
    entryPrice: 100,
    quantity: 1,
    entryTime: new Date(),
    status: 'open',
    fees: 0.5,
    ...overrides,
  };
}

describe('PerformanceTracker', () => {
  let tracker: PerformanceTracker;

  beforeEach(() => {
    tracker = new PerformanceTracker();
  });

  // ---------- Sharpe ratio ----------

  describe('Sharpe ratio', () => {
    it('should compute Sharpe ratio with sample variance (N-1 denominator)', () => {
      const sid = 'sharpe-test';
      tracker.initStrategy(sid);

      // Record 5 trades with known hourly returns: [1%, -0.5%, 2%, 1.5%, -1%]
      // Each trade gets a distinct exit hour so each maps to its own bucket.
      const returns = [1, -0.5, 2, 1.5, -1];
      const baseTime = new Date('2025-06-01T00:00:00Z');

      returns.forEach((retPct, i) => {
        const exitTime = new Date(baseTime.getTime() + i * 60 * 60 * 1000);
        const trade = closedTrade({
          strategyId: sid,
          id: `t-${i}`,
          entryPrice: 100,
          exitPrice: 100 + retPct,
          quantity: 1,
          pnl: retPct,
          pnlPct: retPct,
          exitTime,
          entryTime: new Date(exitTime.getTime() - 5 * 60 * 1000),
        });
        tracker.recordTrade(trade);
      });

      const metrics = tracker.getMetrics(sid)!;

      // Manual calculation:
      // returnPct values (as decimals): [0.01, -0.005, 0.02, 0.015, -0.01]
      const vals = returns.map(r => r / 100);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance = vals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (vals.length - 1);
      const stdDev = Math.sqrt(variance);
      const rfRate = 0.05 / (365 * 24);
      const expectedSharpe = (mean - rfRate) / stdDev;

      expect(metrics.sharpeRatio).to.be.closeTo(expectedSharpe, 1e-6);
    });

    it('should return 0 when fewer than 3 data points', () => {
      const sid = 'sharpe-few';
      tracker.initStrategy(sid);

      // Record only 2 trades
      for (let i = 0; i < 2; i++) {
        const exitTime = new Date(Date.now() - (2 - i) * 3600000);
        tracker.recordTrade(closedTrade({
          strategyId: sid,
          id: `t-${i}`,
          pnlPct: 1,
          pnl: 1,
          exitTime,
          entryTime: new Date(exitTime.getTime() - 60000),
        }));
      }

      const metrics = tracker.getMetrics(sid)!;
      expect(metrics.sharpeRatio).to.equal(0);
    });
  });

  // ---------- PnL calculation with fees ----------

  describe('PnL calculation via closeTrade', () => {
    it('should compute pnlPct = (pnl / (entryPrice * quantity)) * 100 with fees subtracted', () => {
      const sid = 'pnl-fees';
      tracker.initStrategy(sid);

      // Open a trade
      const trade = openTrade({
        strategyId: sid,
        id: 'trade-1',
        entryPrice: 200,
        quantity: 5,
        fees: 1, // entry fee
      });
      tracker.recordTrade(trade);

      // Close with additional fees
      const result = tracker.closeTrade(sid, 'trade-1', 220, new Date(), 2);

      expect(result).to.not.be.null;
      // pnl = (220 - 200) * 5 - totalFees(1 + 2) = 100 - 3 = 97
      expect(result!.pnl).to.equal(97);
      // pnlPct = (97 / (200 * 5)) * 100 = 9.7
      expect(result!.pnlPct).to.be.closeTo(9.7, 1e-6);
    });

    it('should handle sell-side PnL correctly', () => {
      const sid = 'pnl-sell';
      tracker.initStrategy(sid);

      const trade = openTrade({
        strategyId: sid,
        id: 'sell-1',
        side: 'sell',
        entryPrice: 300,
        quantity: 2,
        fees: 0,
      });
      tracker.recordTrade(trade);

      const result = tracker.closeTrade(sid, 'sell-1', 280, new Date(), 1);
      // sell pnl = (300 - 280) * 2 - 1 = 39
      expect(result!.pnl).to.equal(39);
      expect(result!.pnlPct).to.be.closeTo((39 / (300 * 2)) * 100, 1e-6);
    });
  });

  // ---------- Composite score ----------

  describe('Composite score sigmoid normalization', () => {
    it('should produce scores between 0 and 1', () => {
      const sid = 'score-range';
      tracker.initStrategy(sid);

      // Record a few trades to get a nonzero score
      for (let i = 0; i < 5; i++) {
        tracker.recordTrade(closedTrade({
          strategyId: sid,
          id: `t-${i}`,
          pnl: 5,
          pnlPct: 5,
          exitTime: new Date(Date.now() - i * 3600000),
          entryTime: new Date(Date.now() - i * 3600000 - 60000),
        }));
      }

      const score = tracker.getCompositeScore(sid);
      expect(score).to.be.greaterThanOrEqual(0);
      expect(score).to.be.lessThanOrEqual(1);
    });

    it('should score positive-PnL strategies higher than negative-PnL strategies', () => {
      const posId = 'positive-strat';
      const negId = 'negative-strat';
      tracker.initStrategy(posId);
      tracker.initStrategy(negId);

      for (let i = 0; i < 5; i++) {
        const exitTime = new Date(Date.now() - i * 3600000);
        const entryTime = new Date(exitTime.getTime() - 60000);

        tracker.recordTrade(closedTrade({
          strategyId: posId,
          id: `pos-${i}`,
          pnl: 10,
          pnlPct: 5,
          exitTime,
          entryTime,
        }));

        tracker.recordTrade(closedTrade({
          strategyId: negId,
          id: `neg-${i}`,
          pnl: -10,
          pnlPct: -5,
          exitTime,
          entryTime,
        }));
      }

      const posScore = tracker.getCompositeScore(posId);
      const negScore = tracker.getCompositeScore(negId);
      expect(posScore).to.be.greaterThan(negScore);
    });
  });

  // ---------- Max drawdown ----------

  describe('Max drawdown calculation', () => {
    it('should compute correct max drawdown from equity curve', () => {
      const sid = 'dd-test';
      tracker.initStrategy(sid);

      // Equity curve: [0, +100, -50, +25, -50]
      // Cumulative: [0, 100, 50, 75, 25]
      // Peak=100, trough=25 -> dd = 75/100 = 75%
      const pnls = [100, -50, 25, -50];
      pnls.forEach((pnl, i) => {
        tracker.recordTrade(closedTrade({
          strategyId: sid,
          id: `dd-${i}`,
          pnl,
          pnlPct: pnl,
          exitTime: new Date(Date.now() - (pnls.length - i) * 3600000),
          entryTime: new Date(Date.now() - (pnls.length - i) * 3600000 - 60000),
        }));
      });

      const metrics = tracker.getMetrics(sid)!;
      expect(metrics.maxDrawdown).to.be.closeTo(0.75, 1e-6);
    });

    it('should return 0 for monotonically increasing equity', () => {
      const sid = 'dd-mono';
      tracker.initStrategy(sid);

      for (let i = 0; i < 3; i++) {
        tracker.recordTrade(closedTrade({
          strategyId: sid,
          id: `dd-${i}`,
          pnl: 10,
          pnlPct: 10,
          exitTime: new Date(Date.now() - (3 - i) * 3600000),
          entryTime: new Date(Date.now() - (3 - i) * 3600000 - 60000),
        }));
      }

      const metrics = tracker.getMetrics(sid)!;
      expect(metrics.maxDrawdown).to.equal(0);
    });
  });

  // ---------- Win rate ----------

  describe('Win rate calculation', () => {
    it('should return 0 for 0 trades', () => {
      const sid = 'wr-zero';
      tracker.initStrategy(sid);
      const metrics = tracker.getMetrics(sid)!;
      expect(metrics.winRate).to.equal(0);
    });

    it('should return 1.0 for all winning trades', () => {
      const sid = 'wr-all-win';
      tracker.initStrategy(sid);

      for (let i = 0; i < 4; i++) {
        tracker.recordTrade(closedTrade({
          strategyId: sid,
          id: `t-${i}`,
          pnl: 5,
          pnlPct: 5,
          exitTime: new Date(Date.now() - i * 3600000),
          entryTime: new Date(Date.now() - i * 3600000 - 60000),
        }));
      }

      const metrics = tracker.getMetrics(sid)!;
      expect(metrics.winRate).to.equal(1.0);
    });

    it('should compute correct mixed win rate', () => {
      const sid = 'wr-mixed';
      tracker.initStrategy(sid);

      // 3 wins, 2 losses -> 60%
      const pnls = [10, 10, -5, 10, -5];
      pnls.forEach((pnl, i) => {
        tracker.recordTrade(closedTrade({
          strategyId: sid,
          id: `t-${i}`,
          pnl,
          pnlPct: pnl,
          exitTime: new Date(Date.now() - (pnls.length - i) * 3600000),
          entryTime: new Date(Date.now() - (pnls.length - i) * 3600000 - 60000),
        }));
      });

      const metrics = tracker.getMetrics(sid)!;
      expect(metrics.winRate).to.be.closeTo(0.6, 1e-6);
    });
  });

  // ---------- Trade recording lifecycle ----------

  describe('Trade recording', () => {
    it('should record open trade and close it, updating metrics', () => {
      const sid = 'lifecycle';
      tracker.initStrategy(sid);

      // Record open trade -- should not count in completed metrics
      const trade = openTrade({
        strategyId: sid,
        id: 'open-1',
        entryPrice: 100,
        quantity: 2,
        fees: 0,
      });
      tracker.recordTrade(trade);

      let metrics = tracker.getMetrics(sid)!;
      expect(metrics.tradesCompleted).to.equal(0);
      expect(metrics.tradeHistory).to.have.length(1);

      // Close the trade
      const closed = tracker.closeTrade(sid, 'open-1', 120, new Date(), 0);
      expect(closed).to.not.be.null;
      expect(closed!.status).to.equal('closed');

      metrics = tracker.getMetrics(sid)!;
      expect(metrics.tradesCompleted).to.equal(1);
      expect(metrics.totalPnL).to.equal(40); // (120 - 100) * 2 = 40
    });

    it('should return null when closing a nonexistent trade', () => {
      const sid = 'no-trade';
      tracker.initStrategy(sid);
      const result = tracker.closeTrade(sid, 'nonexistent', 100, new Date());
      expect(result).to.be.null;
    });

    it('should not count open trades in metrics', () => {
      const sid = 'open-only';
      tracker.initStrategy(sid);

      tracker.recordTrade(openTrade({ strategyId: sid, id: 'o1' }));
      tracker.recordTrade(openTrade({ strategyId: sid, id: 'o2' }));

      const metrics = tracker.getMetrics(sid)!;
      expect(metrics.tradesCompleted).to.equal(0);
      expect(metrics.totalPnL).to.equal(0);
      expect(metrics.winRate).to.equal(0);
    });
  });

  // ---------- Serialization ----------

  describe('Serialization', () => {
    it('should serialize all tracked strategies', () => {
      tracker.initStrategy('s1');
      tracker.initStrategy('s2');
      tracker.recordTrade(closedTrade({ strategyId: 's1', pnl: 10, pnlPct: 10 }));

      const data = tracker.serialize();
      expect(Object.keys(data)).to.have.length(2);
      expect(data['s1'].totalPnL).to.equal(10);
      expect(data['s2'].totalPnL).to.equal(0);
    });
  });
});
