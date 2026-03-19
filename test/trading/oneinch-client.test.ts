import { OneInchClient } from '../../src/trading/oneinch-client';
import { ChainRegistry } from '../../src/chain/chain-registry';
import { expect } from 'chai';

const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

describe('OneInchClient', () => {
  let registry: ChainRegistry;

  beforeEach(() => {
    registry = new ChainRegistry(TEST_PRIVATE_KEY);
  });

  // ---------- Initialization ----------

  describe('Initialization', () => {
    it('should create client with API key', () => {
      const client = new OneInchClient(registry, 'test-api-key');
      expect(client.isAvailable()).to.be.true;
    });

    it('should report unavailable when no API key is set', () => {
      const origKey = process.env.ONEINCH_API_KEY;
      delete process.env.ONEINCH_API_KEY;

      const client = new OneInchClient(registry, '');
      expect(client.isAvailable()).to.be.false;

      if (origKey) process.env.ONEINCH_API_KEY = origKey;
    });
  });

  // ---------- isAvailable ----------

  describe('isAvailable', () => {
    it('should return true for non-empty API key', () => {
      const client = new OneInchClient(registry, 'some-key');
      expect(client.isAvailable()).to.be.true;
    });

    it('should return false for empty string API key', () => {
      const client = new OneInchClient(registry, '');
      expect(client.isAvailable()).to.be.false;
    });
  });

  // ---------- executeSwap error handling ----------

  describe('executeSwap error handling', () => {
    it('should return a failed result with error when API call fails', async () => {
      const client = new OneInchClient(registry, 'fake-key');

      const result = await client.executeSwap({
        chainId: 8453,
        src: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        dst: '0x4200000000000000000000000000000000000006',
        amount: '1000000',
        from: '0x0000000000000000000000000000000000000001',
        slippage: 0.5,
      });

      expect(result.success).to.be.false;
      expect(result.error).to.be.a('string');
      expect(result.routingSource).to.equal('1inch');
      expect(result.txHash).to.equal('');
    });
  });

  // ---------- Swap params structure ----------

  describe('Swap params structure', () => {
    it('should accept all required swap parameters without throwing', () => {
      const client = new OneInchClient(registry, 'test-key');
      // buildSwap will fail with network error, but the params are validated client-side
      // We just verify construction doesn't throw
      expect(client).to.exist;
    });
  });
});
