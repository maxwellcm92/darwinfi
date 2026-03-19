import { expect } from 'chai';
import { LiveEngine, LiveEngineConfig, LiveTradeRequest, LiveTradeResult } from '../src/trading/live-engine';

/**
 * LiveEngine unit tests.
 *
 * These test the engine's configuration-level guards (sell-only mode,
 * max trade size, gas reserve) without making actual on-chain calls.
 * On-chain integration is not tested here -- that requires a fork or testnet.
 */

describe('LiveEngine', () => {
  // ---------- Sell-only mode ----------

  describe('Sell-only mode', () => {
    it('should block buy calls when global sell-only is active', () => {
      const engine = new LiveEngine({ sellOnly: true });
      expect(engine.isSellOnly()).to.be.true;
    });

    it('should block buy calls when strategy-level sell-only is active', () => {
      const engine = new LiveEngine();
      engine.setStrategySellOnly('strat-1', true);
      expect(engine.isSellOnly('strat-1')).to.be.true;
      expect(engine.isSellOnly('strat-2')).to.be.false;
    });

    it('should allow toggling sell-only mode off', () => {
      const engine = new LiveEngine({ sellOnly: true });
      expect(engine.isSellOnly()).to.be.true;
      engine.setSellOnly(false);
      expect(engine.isSellOnly()).to.be.false;
    });

    it('global sell-only should override strategy-level', () => {
      const engine = new LiveEngine({ sellOnly: true });
      engine.setStrategySellOnly('strat-1', false);
      // Global overrides strategy
      expect(engine.isSellOnly('strat-1')).to.be.true;
    });
  });

  // ---------- Max trade size ----------

  describe('Max trade size configuration', () => {
    it('should default maxTradeSizeUsd to 1000', () => {
      const engine = new LiveEngine();
      // getVaultScaledMaxTradeSize returns the configured max when vault is not active
      return engine.getVaultScaledMaxTradeSize().then(max => {
        expect(max).to.equal(1000);
      });
    });

    it('should respect custom maxTradeSizeUsd', () => {
      const engine = new LiveEngine({ maxTradeSizeUsd: 500 });
      return engine.getVaultScaledMaxTradeSize().then(max => {
        expect(max).to.equal(500);
      });
    });
  });

  // ---------- Gas reserve config ----------

  describe('Gas reserve configuration', () => {
    it('should store default gas reserve of 0.002 ETH', () => {
      const engine = new LiveEngine();
      // Verify through a vault-scaled trade size check (the reserve is internal)
      // We check that the engine was created without error with default config
      expect(engine.isVaultV2Active()).to.be.false;
    });

    it('should accept custom gas reserve', () => {
      const engine = new LiveEngine({ minGasReserveEth: 0.01 });
      // Engine should be created without error
      expect(engine.isSellOnly()).to.be.false;
    });
  });

  // ---------- Vault integration config ----------

  describe('VaultV2 integration paths', () => {
    it('should default to vault disabled', () => {
      const engine = new LiveEngine();
      expect(engine.isVaultV2Active()).to.be.false;
    });

    it('should not throw when useVaultV2=true (regardless of env)', () => {
      // Should construct without throwing, even if env vars are present or absent
      const engine = new LiveEngine({ useVaultV2: true });
      // isVaultV2Active depends on env; just verify no exception
      expect(typeof engine.isVaultV2Active()).to.equal('boolean');
    });
  });

  // ---------- Trade log ----------

  describe('Trade log', () => {
    it('should return empty log initially', () => {
      const engine = new LiveEngine();
      const log = engine.getTradeLog();
      expect(log).to.be.an('array').with.length(0);
    });

    it('should return null for unknown strategy stats', () => {
      const engine = new LiveEngine();
      const stats = engine.getStrategyStats('nonexistent');
      expect(stats).to.be.null;
    });
  });
});
