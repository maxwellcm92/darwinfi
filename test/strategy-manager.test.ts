import { StrategyManager } from '../src/agent/strategy-manager';
import { PerformanceTracker, TradeRecord } from '../src/agent/performance';
import { expect } from 'chai';

describe('StrategyManager', () => {
  let tracker: PerformanceTracker;
  let manager: StrategyManager;

  beforeEach(() => {
    tracker = new PerformanceTracker();
    manager = new StrategyManager(tracker);
    manager.initialize();
  });

  // ---------- Initialization ----------

  describe('Initialization', () => {
    it('should initialize 12 strategies (3 mains + 9 variations)', () => {
      const all = manager.getAllStrategies();
      expect(all).to.have.length(12);

      const mains = manager.getMainStrategies();
      expect(mains).to.have.length(3);

      // Each main should have 3 variations
      for (const main of mains) {
        const vars = manager.getVariations(main.id);
        expect(vars).to.have.length(3);
      }
    });

    it('should start all strategies as paper (proving ground rule)', () => {
      const all = manager.getAllStrategies();
      const liveStrategies = all.filter(s => s.status === 'live');
      expect(liveStrategies).to.have.length(0);

      for (const s of all) {
        expect(s.status).to.equal('paper');
      }
    });

    it('should have qualificationMode=true initially', () => {
      expect(manager.qualificationMode).to.be.true;
    });
  });

  // ---------- promoteFirstQualified ----------

  describe('promoteFirstQualified', () => {
    it('should require 3 profitable trades before promotion', () => {
      // First profitable trade -- not yet promoted
      const result1 = manager.promoteFirstQualified({
        strategyId: 'main-alpha',
        pnl: 5.0,
      });
      expect(result1).to.be.null;
      expect(manager.qualificationMode).to.be.true;

      // Second profitable trade -- still not promoted
      const result2 = manager.promoteFirstQualified({
        strategyId: 'main-alpha',
        pnl: 3.0,
      });
      expect(result2).to.be.null;
      expect(manager.qualificationMode).to.be.true;

      // Third profitable trade -- NOW promoted
      const result3 = manager.promoteFirstQualified({
        strategyId: 'main-alpha',
        pnl: 7.0,
      });
      expect(result3).to.equal('main-alpha');
      expect(manager.qualificationMode).to.be.false;

      const live = manager.getLiveStrategy();
      expect(live).to.not.be.undefined;
      expect(live!.id).to.equal('main-alpha');
      expect(live!.status).to.equal('live');
    });

    it('should reject unprofitable trade (pnl <= 0)', () => {
      const result1 = manager.promoteFirstQualified({
        strategyId: 'main-alpha',
        pnl: 0,
      });
      expect(result1).to.be.null;

      const result2 = manager.promoteFirstQualified({
        strategyId: 'main-alpha',
        pnl: -5,
      });
      expect(result2).to.be.null;

      // Still in qualification mode
      expect(manager.qualificationMode).to.be.true;
      expect(manager.getLiveStrategy()).to.be.undefined;
    });

    it('should not promote when already out of qualification mode', () => {
      // Promote first (3 profitable trades)
      manager.promoteFirstQualified({ strategyId: 'main-alpha', pnl: 1 });
      manager.promoteFirstQualified({ strategyId: 'main-alpha', pnl: 1 });
      manager.promoteFirstQualified({ strategyId: 'main-alpha', pnl: 1 });

      // Try again with a different strategy
      const result = manager.promoteFirstQualified({ strategyId: 'main-beta', pnl: 10 });
      expect(result).to.be.null;

      // main-alpha should still be the only live
      expect(manager.getLiveStrategy()!.id).to.equal('main-alpha');
    });
  });

  // ---------- Promotion evaluation ----------

  describe('Promotion evaluation (variation outperform cycles)', () => {
    it('should increment outperform cycles when variation scores higher than parent', () => {
      // Give the variation enough trades and a good score
      const varId = 'main-alpha-exp';
      const parentId = 'main-alpha';

      // Record 5+ closed trades for the variation with positive PnL
      for (let i = 0; i < 6; i++) {
        const trade: TradeRecord = {
          id: `var-t-${i}`,
          strategyId: varId,
          token: 'ETH',
          side: 'buy',
          entryPrice: 100,
          exitPrice: 110,
          quantity: 1,
          pnl: 10,
          pnlPct: 10,
          entryTime: new Date(Date.now() - (6 - i) * 3600000 - 60000),
          exitTime: new Date(Date.now() - (6 - i) * 3600000),
          status: 'closed',
          fees: 0,
        };
        tracker.recordTrade(trade);
      }

      // Parent has no trades, so parent score = 0
      // Variation should score > 0 after trades
      const varScore = tracker.getCompositeScore(varId);
      const parentScore = tracker.getCompositeScore(parentId);
      expect(varScore).to.be.greaterThan(parentScore);

      // Run one evaluation cycle
      manager.evaluatePromotions();

      const metrics = tracker.getMetrics(varId)!;
      expect(metrics.consecutiveOutperformCycles).to.equal(1);
    });

    it('should NOT promote if outperform cycles < 2', () => {
      const varId = 'main-beta-opt';

      // Record trades for the variation
      for (let i = 0; i < 6; i++) {
        tracker.recordTrade({
          id: `opt-t-${i}`,
          strategyId: varId,
          token: 'ETH',
          side: 'buy',
          entryPrice: 100,
          exitPrice: 115,
          quantity: 1,
          pnl: 15,
          pnlPct: 15,
          entryTime: new Date(Date.now() - (6 - i) * 3600000 - 60000),
          exitTime: new Date(Date.now() - (6 - i) * 3600000),
          status: 'closed',
          fees: 0,
        });
      }

      // One cycle -- should not promote yet
      manager.evaluatePromotions();

      // Parent should still have its original parameters
      const parent = manager.getStrategy('main-beta');
      expect(parent!.generation).to.equal(0);
    });
  });

  // ---------- Serialization ----------

  describe('Serialization', () => {
    it('should serialize and return all 12 strategy genomes', () => {
      const serialized = manager.serialize();
      expect(serialized).to.have.length(12);

      // Each genome should have required fields
      for (const genome of serialized) {
        expect(genome).to.have.property('id');
        expect(genome).to.have.property('name');
        expect(genome).to.have.property('type');
        expect(genome).to.have.property('parameters');
        expect(genome).to.have.property('status');
        expect(genome).to.have.property('generation');
      }

      // Check that mains and variations are present
      const mains = serialized.filter(g => g.type === 'main');
      const vars = serialized.filter(g => g.type === 'variation');
      expect(mains).to.have.length(3);
      expect(vars).to.have.length(9);
    });
  });

  // ---------- Status report ----------

  describe('Status report', () => {
    it('should return correct structure', () => {
      const report = manager.getStatusReport();
      expect(report.live).to.be.null;
      expect(report.mains).to.have.length(3);
      expect(report.sellOnly).to.have.length(0);
      expect(Object.keys(report.variations)).to.have.length(3);
    });
  });
});
