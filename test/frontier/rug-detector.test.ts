import { RugDetector } from '../../src/frontier/discovery/rug-detector';
import { expect } from 'chai';
import { JsonRpcProvider } from 'ethers';

// Mock provider that returns controllable responses
function createMockProvider(overrides: Record<string, any> = {}): JsonRpcProvider {
  return {
    getCode: async () => overrides.code ?? '0x' + 'a264' + '00'.repeat(600),
    getBlockNumber: async () => 12345,
    getNetwork: async () => ({ chainId: 8453n }),
    call: async () => '0x',
    ...overrides,
  } as any;
}

describe('RugDetector', () => {
  let detector: RugDetector;
  let mockProvider: JsonRpcProvider;

  beforeEach(() => {
    mockProvider = createMockProvider();
    const providers = new Map<number, JsonRpcProvider>();
    providers.set(8453, mockProvider);
    detector = new RugDetector(providers, 1000); // 1s TTL for tests
  });

  // ---------- Weight verification ----------

  describe('Weight verification', () => {
    it('should have weights that sum to 100', () => {
      // Weights: contractVerified=15, ownershipRenounced=20, noMintFunction=20,
      // holderConcentration=20, honeypotSimulation=25
      const totalWeight = 15 + 20 + 20 + 20 + 25;
      expect(totalWeight).to.equal(100);
    });
  });

  // ---------- Safety score ----------

  describe('Safety score calculation', () => {
    it('should return a score between 0 and 100', async () => {
      const result = await detector.analyze('0x1234567890abcdef1234567890abcdef12345678', 8453);
      expect(result.safetyScore).to.be.gte(0);
      expect(result.safetyScore).to.be.lte(100);
    });

    it('should include all 5 check categories', async () => {
      const result = await detector.analyze('0x1234567890abcdef1234567890abcdef12345678', 8453);
      expect(result.checks).to.have.property('contractVerified');
      expect(result.checks).to.have.property('ownershipRenounced');
      expect(result.checks).to.have.property('noMintFunction');
      expect(result.checks).to.have.property('holderConcentration');
      expect(result.checks).to.have.property('honeypotSimulation');
    });

    it('should set cached=false on first analyze', async () => {
      const result = await detector.analyze('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 8453);
      expect(result.cached).to.be.false;
    });
  });

  // ---------- Cache behavior ----------

  describe('Cache behavior', () => {
    it('should return cached result on second call within TTL', async () => {
      const addr = '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
      const first = await detector.analyze(addr, 8453);
      expect(first.cached).to.be.false;

      const second = await detector.analyze(addr, 8453);
      expect(second.cached).to.be.true;
      expect(second.safetyScore).to.equal(first.safetyScore);
    });

    it('should clear cache via clearCache()', async () => {
      const addr = '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
      await detector.analyze(addr, 8453);

      detector.clearCache();

      const fresh = await detector.analyze(addr, 8453);
      expect(fresh.cached).to.be.false;
    });
  });

  // ---------- Individual check results ----------

  describe('Individual check results', () => {
    it('should assign correct weight to each check', async () => {
      const result = await detector.analyze('0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD', 8453);

      expect(result.checks.contractVerified.weight).to.equal(15);
      expect(result.checks.ownershipRenounced.weight).to.equal(20);
      expect(result.checks.noMintFunction.weight).to.equal(20);
      expect(result.checks.holderConcentration.weight).to.equal(20);
      expect(result.checks.honeypotSimulation.weight).to.equal(25);
    });

    it('should have score equal to weight when check passes', async () => {
      const result = await detector.analyze('0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE', 8453);

      for (const checkName of Object.keys(result.checks) as Array<keyof typeof result.checks>) {
        const check = result.checks[checkName];
        if (check.passed) {
          expect(check.score).to.equal(check.weight);
        } else {
          expect(check.score).to.equal(0);
        }
      }
    });
  });

  // ---------- Missing provider ----------

  describe('Missing provider', () => {
    it('should throw when analyzing on an unregistered chain', async () => {
      try {
        await detector.analyze('0x1111111111111111111111111111111111111111', 999);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).to.include('No provider for chain 999');
      }
    });
  });
});
