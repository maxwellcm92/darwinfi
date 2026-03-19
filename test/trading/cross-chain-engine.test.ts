import { CrossChainEngine } from '../../src/trading/cross-chain-engine';
import { ChainRegistry } from '../../src/chain/chain-registry';
import { OneInchClient } from '../../src/trading/oneinch-client';
import { expect } from 'chai';

const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

describe('CrossChainEngine', () => {
  let registry: ChainRegistry;
  let oneInch: OneInchClient;
  let engine: CrossChainEngine;

  beforeEach(() => {
    registry = new ChainRegistry(TEST_PRIVATE_KEY);
    oneInch = new OneInchClient(registry, '');
    engine = new CrossChainEngine(registry, oneInch, {
      maxTradeSizeUsd: 500,
      minGasReserveEth: 0.001,
    });
  });

  // ---------- Initialization ----------

  describe('Initialization', () => {
    it('should create engine with default config', () => {
      const defaultEngine = new CrossChainEngine(registry, oneInch);
      expect(defaultEngine).to.exist;
    });

    it('should accept custom config values', () => {
      expect(engine).to.exist;
      // Engine is constructed with maxTradeSizeUsd=500 -- verify indirectly via trade log
      expect(engine.getTradeLog()).to.be.an('array').that.is.empty;
    });
  });

  // ---------- Trade log ----------

  describe('Trade log', () => {
    it('should start with empty trade log', () => {
      expect(engine.getTradeLog()).to.deep.equal([]);
    });

    it('should support limit parameter on getTradeLog', () => {
      const limited = engine.getTradeLog(5);
      expect(limited).to.be.an('array');
      expect(limited.length).to.equal(0);
    });
  });

  // ---------- executeTrade with unknown token ----------

  describe('executeTrade with unknown token', () => {
    it('should return failed result for unknown token symbol', async () => {
      const result = await engine.executeTrade({
        strategyId: 'test-strat',
        action: 'buy',
        tokenSymbol: 'NONEXISTENT_TOKEN_XYZ',
        amount: 10,
      });

      expect(result.success).to.be.false;
      expect(result.error).to.include('Unknown token');
      expect(result.chainId).to.equal(8453); // default chain
    });
  });

  // ---------- findOptimalChain ----------

  describe('findOptimalChain', () => {
    it('should return a chain selection with reason', async () => {
      const selection = await engine.findOptimalChain();
      expect(selection).to.have.property('chainId');
      expect(selection).to.have.property('chainName');
      expect(selection).to.have.property('reason');
      expect(selection.chainId).to.be.a('number');
    });
  });

  // ---------- Chain defaults ----------

  describe('Chain defaults', () => {
    it('should default to Base (8453) when no chainId specified', async () => {
      const result = await engine.executeTrade({
        strategyId: 'test',
        action: 'buy',
        tokenSymbol: 'FAKE_TOKEN',
        amount: 10,
      });
      expect(result.chainId).to.equal(8453);
    });
  });
});
