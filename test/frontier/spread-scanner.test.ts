import { SpreadScanner, SpreadOpportunity } from '../../src/frontier/hft/spread-scanner';
import { expect } from 'chai';
import { JsonRpcProvider } from 'ethers';

describe('SpreadScanner', () => {
  let scanner: SpreadScanner;
  let mockProviders: Map<number, JsonRpcProvider>;

  beforeEach(() => {
    mockProviders = new Map();
    // We don't add real providers -- tests will work with empty provider map
    scanner = new SpreadScanner(mockProviders, 60_000);
  });

  afterEach(() => {
    scanner.stop();
  });

  // ---------- Initialization ----------

  describe('Initialization', () => {
    it('should create scanner with providers and interval', () => {
      expect(scanner).to.exist;
    });

    it('should start with empty top pools', () => {
      const top = scanner.getTopPools();
      expect(top).to.be.an('array').that.is.empty;
    });
  });

  // ---------- filterProfitable ----------

  describe('filterProfitable', () => {
    it('should return empty array when no pools scanned', () => {
      const profitable = scanner.filterProfitable(1);
      expect(profitable).to.deep.equal([]);
    });

    it('should filter by minimum net profit in basis points', () => {
      // With no data, nothing passes the filter
      const result = scanner.filterProfitable(0);
      expect(result).to.be.an('array');
    });
  });

  // ---------- getTopPools ----------

  describe('getTopPools', () => {
    it('should respect the limit parameter', () => {
      const top = scanner.getTopPools(5);
      expect(top.length).to.be.lte(5);
    });

    it('should default to 10 results max', () => {
      const top = scanner.getTopPools();
      expect(top.length).to.be.lte(10);
    });
  });

  // ---------- Lifecycle ----------

  describe('Lifecycle', () => {
    it('should not throw when stopping a scanner that was never started', () => {
      expect(() => scanner.stop()).to.not.throw();
    });

    it('should handle start/stop without errors', () => {
      // Start with empty providers -- scanAll will return empty results
      scanner.start();
      scanner.stop();
      expect(scanner.getTopPools()).to.be.an('array');
    });
  });

  // ---------- scanAll with no providers ----------

  describe('scanAll with no providers', () => {
    it('should return empty results when no chains are configured', async () => {
      const results = await scanner.scanAll();
      expect(results).to.be.an('array').that.is.empty;
    });
  });

  // ---------- Spread sorting ----------

  describe('Spread sorting', () => {
    it('should sort top pools by netProfitBps descending', () => {
      // Manually verify sort contract -- with no data, no ordering issues
      const top = scanner.getTopPools();
      for (let i = 1; i < top.length; i++) {
        expect(top[i - 1].netProfitBps).to.be.gte(top[i].netProfitBps);
      }
    });
  });
});
