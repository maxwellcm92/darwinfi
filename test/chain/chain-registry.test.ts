import { ChainRegistry } from '../../src/chain/chain-registry';
import { expect } from 'chai';

const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

describe('ChainRegistry', () => {
  let registry: ChainRegistry;

  beforeEach(() => {
    registry = new ChainRegistry(TEST_PRIVATE_KEY);
  });

  // ---------- Registration ----------

  describe('Chain registration', () => {
    it('should auto-register Base (8453) on construction', () => {
      const client = registry.getClient(8453);
      expect(client).to.exist;
      expect(client.chainId).to.equal(8453);
      expect(client.chainName).to.equal('Base');
    });

    it('should throw when getting an unregistered chain', () => {
      expect(() => registry.getClient(999999)).to.throw('Chain 999999 not registered');
    });

    it('should register a custom chain', () => {
      const client = registry.registerChain({
        chainId: 137,
        chainName: 'Polygon',
        rpcUrls: ['https://polygon-rpc.com'],
        maxGasPriceGwei: 100,
      });

      expect(client.chainId).to.equal(137);
      expect(client.chainName).to.equal('Polygon');
      expect(registry.getClient(137)).to.equal(client);
    });

    it('should overwrite existing registration for the same chainId', () => {
      const first = registry.getClient(8453);
      const newClient = registry.registerChain({
        chainId: 8453,
        chainName: 'Base-V2',
        rpcUrls: ['https://new-rpc.example.com'],
      });

      expect(registry.getClient(8453).chainName).to.equal('Base-V2');
      expect(newClient).to.not.equal(first);
    });
  });

  // ---------- getActiveChains ----------

  describe('getActiveChains', () => {
    it('should return all registered chains', () => {
      const chains = registry.getActiveChains();
      expect(chains.length).to.be.greaterThanOrEqual(1); // At least Base
      expect(chains.some(c => c.chainId === 8453)).to.be.true;
    });

    it('should include newly registered chains', () => {
      registry.registerChain({
        chainId: 10,
        chainName: 'Optimism',
        rpcUrls: ['https://optimism-rpc.com'],
      });

      const chains = registry.getActiveChains();
      expect(chains.some(c => c.chainId === 10)).to.be.true;
    });
  });

  // ---------- Constructor validation ----------

  describe('Constructor validation', () => {
    it('should throw when no private key is available', () => {
      const origTeam4 = process.env.TEAM4_PRIVATE_KEY;
      const origPk = process.env.PRIVATE_KEY;
      delete process.env.TEAM4_PRIVATE_KEY;
      delete process.env.PRIVATE_KEY;

      expect(() => new ChainRegistry('')).to.throw('Private key required');

      if (origTeam4) process.env.TEAM4_PRIVATE_KEY = origTeam4;
      if (origPk) process.env.PRIVATE_KEY = origPk;
    });
  });
});
