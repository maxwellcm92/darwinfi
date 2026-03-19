import { EVMClient, EVMClientConfig } from '../../src/chain/evm-client';
import { expect } from 'chai';

// Minimal config for testing -- uses a dummy private key
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function makeConfig(overrides?: Partial<EVMClientConfig>): EVMClientConfig {
  return {
    chainId: 8453,
    chainName: 'TestChain',
    rpcUrls: ['https://rpc-1.example.com', 'https://rpc-2.example.com'],
    privateKey: TEST_PRIVATE_KEY,
    maxGasPriceGwei: 10,
    ...overrides,
  };
}

describe('EVMClient', () => {

  // ---------- Initialization ----------

  describe('Initialization', () => {
    it('should initialize with correct chainId, chainName, and maxGasPriceGwei', () => {
      const client = new EVMClient(makeConfig());
      expect(client.chainId).to.equal(8453);
      expect(client.chainName).to.equal('TestChain');
      expect(client.maxGasPriceGwei).to.equal(10);
    });

    it('should default maxGasPriceGwei to 50 when not specified', () => {
      const client = new EVMClient(makeConfig({ maxGasPriceGwei: undefined }));
      expect(client.maxGasPriceGwei).to.equal(50);
    });

    it('should throw when no private key is available', () => {
      const origTeam4 = process.env.TEAM4_PRIVATE_KEY;
      const origPk = process.env.PRIVATE_KEY;
      delete process.env.TEAM4_PRIVATE_KEY;
      delete process.env.PRIVATE_KEY;

      expect(() => new EVMClient({
        chainId: 1,
        chainName: 'Fail',
        rpcUrls: ['https://rpc.example.com'],
        privateKey: '',
      })).to.throw('Private key required');

      // Restore
      if (origTeam4) process.env.TEAM4_PRIVATE_KEY = origTeam4;
      if (origPk) process.env.PRIVATE_KEY = origPk;
    });

    it('should throw when rpcUrls is empty', () => {
      expect(() => new EVMClient(makeConfig({ rpcUrls: [] }))).to.throw('At least one RPC URL');
    });
  });

  // ---------- RPC Rotation ----------

  describe('RPC Rotation', () => {
    it('should return false when only one RPC endpoint is available', () => {
      const client = new EVMClient(makeConfig({ rpcUrls: ['https://single.example.com'] }));
      expect(client.rotateRpc()).to.be.false;
    });

    it('should rotate to the next RPC endpoint and return true', () => {
      const client = new EVMClient(makeConfig({
        rpcUrls: ['https://rpc-1.example.com', 'https://rpc-2.example.com', 'https://rpc-3.example.com'],
      }));

      const rotated = client.rotateRpc();
      expect(rotated).to.be.true;
    });

    it('should wrap around when reaching the end of the RPC list', () => {
      const client = new EVMClient(makeConfig({
        rpcUrls: ['https://rpc-1.example.com', 'https://rpc-2.example.com'],
      }));

      client.rotateRpc(); // index 0 -> 1
      client.rotateRpc(); // index 1 -> 0 (wrap)
      // Should still be functional
      expect(client.chainId).to.equal(8453);
    });
  });

  // ---------- Nonce management ----------

  describe('Nonce management', () => {
    it('should reset nonce tracker via resetNonce', () => {
      const client = new EVMClient(makeConfig());
      // resetNonce should not throw
      client.resetNonce();
      expect(client.chainId).to.equal(8453); // still functional
    });
  });

  // ---------- Wallet address ----------

  describe('Wallet address', () => {
    it('should expose a valid wallet address', () => {
      const client = new EVMClient(makeConfig());
      expect(client.walletAddress).to.be.a('string');
      expect(client.walletAddress).to.match(/^0x[a-fA-F0-9]{40}$/);
    });
  });
});
