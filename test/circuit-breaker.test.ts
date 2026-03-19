import { CircuitBreaker, BreakerState } from '../src/agent/circuit-breaker';
import { expect } from 'chai';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker();
  });

  // ---------- Init state ----------

  describe('Initialization', () => {
    it('should have isPaused=false and consecutiveLosses=0 after initStrategy', () => {
      breaker.initStrategy('strat-1');
      const state = breaker.getBreakerState('strat-1')!;
      expect(state.isPaused).to.be.false;
      expect(state.consecutiveLosses).to.equal(0);
      expect(state.currentDrawdown).to.equal(0);
      expect(state.peakEquity).to.equal(0);
      expect(state.manualOverride).to.be.false;
    });

    it('should not overwrite existing state on duplicate init', () => {
      breaker.initStrategy('strat-1');
      // Record a loss to change state
      breaker.recordTradeResult('strat-1', -5, 95);
      breaker.initStrategy('strat-1'); // duplicate init
      const state = breaker.getBreakerState('strat-1')!;
      expect(state.consecutiveLosses).to.equal(1); // should still be 1
    });
  });

  // ---------- Consecutive loss trigger ----------

  describe('Consecutive loss trigger', () => {
    it('should trip after 5 consecutive losses (default threshold)', () => {
      breaker.initStrategy('loser');

      for (let i = 0; i < 4; i++) {
        const result = breaker.recordTradeResult('loser', -1, 100 - (i + 1));
        expect(result.tripped).to.be.false;
      }

      // 5th loss should trip
      const result = breaker.recordTradeResult('loser', -1, 95);
      expect(result.tripped).to.be.true;
      expect(result.reason).to.include('Consecutive losses');

      const state = breaker.getBreakerState('loser')!;
      expect(state.isPaused).to.be.true;
    });
  });

  // ---------- Win resets counter ----------

  describe('Win resets consecutive loss counter', () => {
    it('should reset consecutiveLosses after a win', () => {
      breaker.initStrategy('mixed');

      breaker.recordTradeResult('mixed', -1, 99);
      breaker.recordTradeResult('mixed', -1, 98);
      breaker.recordTradeResult('mixed', -1, 97);

      let state = breaker.getBreakerState('mixed')!;
      expect(state.consecutiveLosses).to.equal(3);

      // Record a win
      breaker.recordTradeResult('mixed', 5, 102);

      state = breaker.getBreakerState('mixed')!;
      expect(state.consecutiveLosses).to.equal(0);
    });
  });

  // ---------- Drawdown trigger ----------

  describe('Drawdown trigger', () => {
    it('should trip when strategy drawdown exceeds 15%', () => {
      breaker.initStrategy('dd-strat');

      // Set peak equity to 100 via a winning trade
      breaker.recordTradeResult('dd-strat', 100, 100);
      const state = breaker.getBreakerState('dd-strat')!;
      expect(state.peakEquity).to.equal(100);

      // 20% drawdown: equity drops to 80
      const result = breaker.recordTradeResult('dd-strat', -20, 80);
      expect(result.tripped).to.be.true;
      expect(result.reason).to.include('drawdown');
      expect(state.isPaused).to.be.true;
    });

    it('should not trip at exactly 15%', () => {
      breaker.initStrategy('dd-exact');
      breaker.recordTradeResult('dd-exact', 100, 100);
      // Exactly 15% drawdown
      const result = breaker.recordTradeResult('dd-exact', -15, 85);
      expect(result.tripped).to.be.true; // 15% >= 15% threshold trips
    });
  });

  // ---------- Portfolio halt ----------

  describe('Portfolio halt', () => {
    it('should halt when portfolio drawdown exceeds 25%', () => {
      // Set peak
      breaker.checkPortfolioHalt(1000);
      // 30% loss
      const result = breaker.checkPortfolioHalt(700);
      expect(result.halted).to.be.true;
      expect(result.reason).to.include('Portfolio drawdown');
    });

    it('should not halt at 20% portfolio drawdown', () => {
      breaker.checkPortfolioHalt(1000);
      const result = breaker.checkPortfolioHalt(800);
      expect(result.halted).to.be.false;
    });

    it('should block all strategy trades when portfolio is halted', () => {
      breaker.initStrategy('any-strat');

      // Halt the portfolio
      breaker.checkPortfolioHalt(1000);
      breaker.checkPortfolioHalt(700);

      const { allowed, reason } = breaker.canTrade('any-strat');
      expect(allowed).to.be.false;
      expect(reason).to.include('Portfolio-wide halt');
    });
  });

  // ---------- canTrade ----------

  describe('canTrade', () => {
    it('should return true when not paused', () => {
      breaker.initStrategy('healthy');
      const { allowed } = breaker.canTrade('healthy');
      expect(allowed).to.be.true;
    });

    it('should return false when paused', () => {
      breaker.initStrategy('paused-strat');

      // Trip via consecutive losses
      for (let i = 0; i < 5; i++) {
        breaker.recordTradeResult('paused-strat', -1, 100);
      }

      const { allowed, reason } = breaker.canTrade('paused-strat');
      expect(allowed).to.be.false;
      expect(reason).to.include('Consecutive losses');
    });

    it('should allow trading for unknown strategy (not initialized)', () => {
      const { allowed } = breaker.canTrade('unknown');
      expect(allowed).to.be.true;
    });
  });

  // ---------- Manual override ----------

  describe('Manual override', () => {
    it('should allow trading when manual override is set even if paused', () => {
      breaker.initStrategy('override-strat');

      // Trip the breaker
      for (let i = 0; i < 5; i++) {
        breaker.recordTradeResult('override-strat', -1, 100);
      }

      expect(breaker.canTrade('override-strat').allowed).to.be.false;

      // Set override
      breaker.setManualOverride('override-strat', true);
      expect(breaker.canTrade('override-strat').allowed).to.be.true;

      // Remove override
      breaker.setManualOverride('override-strat', false);
      expect(breaker.canTrade('override-strat').allowed).to.be.false;
    });
  });

  // ---------- Position age check ----------

  describe('Position age check', () => {
    it('should return expired=true when position is >24h old', () => {
      breaker.initStrategy('age-test');
      const twentySixHoursAgo = Date.now() - 26 * 60 * 60 * 1000;
      const result = breaker.checkPositionAge('age-test', twentySixHoursAgo);
      expect(result.expired).to.be.true;
      expect(result.ageMs).to.be.greaterThan(24 * 60 * 60 * 1000);
    });

    it('should return expired=false for a recent position', () => {
      breaker.initStrategy('young');
      const oneHourAgo = Date.now() - 1 * 60 * 60 * 1000;
      const result = breaker.checkPositionAge('young', oneHourAgo);
      expect(result.expired).to.be.false;
    });
  });

  // ---------- Price validation ----------

  describe('Price validation (static)', () => {
    it('should reject price=0', () => {
      const result = CircuitBreaker.validatePrice(0);
      expect(result.valid).to.be.false;
      expect(result.reason).to.include('positive');
    });

    it('should reject negative price', () => {
      const result = CircuitBreaker.validatePrice(-10);
      expect(result.valid).to.be.false;
    });

    it('should accept valid price with no last price', () => {
      const result = CircuitBreaker.validatePrice(100);
      expect(result.valid).to.be.true;
    });

    it('should reject >10% price change from last', () => {
      const result = CircuitBreaker.validatePrice(112, 100);
      expect(result.valid).to.be.false;
      expect(result.reason).to.include('>10%');
    });

    it('should accept <=10% price change', () => {
      const result = CircuitBreaker.validatePrice(109, 100);
      expect(result.valid).to.be.true;
    });

    it('should reject >10% drop', () => {
      const result = CircuitBreaker.validatePrice(88, 100);
      expect(result.valid).to.be.false;
    });
  });

  // ---------- Serialize / Deserialize ----------

  describe('Serialize / Deserialize round-trip', () => {
    it('should preserve state through serialize/deserialize', () => {
      breaker.initStrategy('s1');
      breaker.initStrategy('s2');

      // Modify s1 state
      breaker.recordTradeResult('s1', -1, 99);
      breaker.recordTradeResult('s1', -1, 98);

      const serialized = breaker.serialize();
      expect(Object.keys(serialized)).to.have.length(2);
      expect(serialized['s1'].consecutiveLosses).to.equal(2);

      // Create a new breaker and deserialize
      const breaker2 = new CircuitBreaker();
      breaker2.deserialize(serialized);

      const state = breaker2.getBreakerState('s1')!;
      expect(state.consecutiveLosses).to.equal(2);
      expect(state.strategyId).to.equal('s1');

      const state2 = breaker2.getBreakerState('s2')!;
      expect(state2.consecutiveLosses).to.equal(0);
    });
  });

  // ---------- Custom config ----------

  describe('Custom configuration', () => {
    it('should respect custom maxConsecutiveLosses', () => {
      const custom = new CircuitBreaker({ maxConsecutiveLosses: 3 });
      custom.initStrategy('custom');

      for (let i = 0; i < 2; i++) {
        const r = custom.recordTradeResult('custom', -1, 100);
        expect(r.tripped).to.be.false;
      }

      const result = custom.recordTradeResult('custom', -1, 97);
      expect(result.tripped).to.be.true;
    });
  });
});
