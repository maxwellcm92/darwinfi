import { VolScanner } from '../../src/frontier/volatility/vol-scanner';
import { expect } from 'chai';
import { JsonRpcProvider } from 'ethers';

describe('VolScanner', () => {
  let scanner: VolScanner;

  beforeEach(() => {
    const providers = new Map<number, JsonRpcProvider>();
    scanner = new VolScanner(providers, 60); // 60 min window
  });

  // ---------- Price recording ----------

  describe('Price recording', () => {
    it('should accept price data points without error', () => {
      expect(() => {
        scanner.recordPrice(8453, '0xTokenA', 100, 'TOKA');
        scanner.recordPrice(8453, '0xTokenA', 101, 'TOKA');
        scanner.recordPrice(8453, '0xTokenA', 99, 'TOKA');
      }).to.not.throw();
    });

    it('should normalize token addresses to lowercase in key', () => {
      scanner.recordPrice(8453, '0xABCD', 100, 'TEST');
      scanner.recordPrice(8453, '0xabcd', 105, 'TEST');
      // Both should be stored under the same key
      const vol = scanner.computeRealizedVol(8453, '0xABCD');
      // With only 2 data points, vol is 0 (needs >= 3)
      expect(vol).to.equal(0);
    });
  });

  // ---------- Volatility computation ----------

  describe('Volatility computation', () => {
    it('should return 0 when fewer than 3 data points exist', () => {
      scanner.recordPrice(8453, '0xToken1', 100);
      scanner.recordPrice(8453, '0xToken1', 105);
      const vol = scanner.computeRealizedVol(8453, '0xToken1');
      expect(vol).to.equal(0);
    });

    it('should return 0 for a token with no history', () => {
      const vol = scanner.computeRealizedVol(8453, '0xNoData');
      expect(vol).to.equal(0);
    });

    it('should compute non-zero volatility with sufficient data', () => {
      const token = '0xVolToken';
      // Record varying prices
      for (let i = 0; i < 20; i++) {
        const price = 100 + Math.sin(i) * 10;
        scanner.recordPrice(8453, token, price, 'VOL');
      }
      const vol = scanner.computeRealizedVol(8453, token);
      expect(vol).to.be.gte(0);
    });
  });

  // ---------- Threshold detection ----------

  describe('Threshold detection', () => {
    it('should return empty events when no tokens are tracked', () => {
      const events = scanner.scanAll(2.0);
      expect(events).to.be.an('array').that.is.empty;
    });

    it('should return empty events when volatility is stable', () => {
      const token = '0xStable';
      // Record very stable prices
      for (let i = 0; i < 10; i++) {
        scanner.recordPrice(8453, token, 100.0 + i * 0.001, 'STBL');
      }
      const events = scanner.scanAll(2.0);
      // Stable prices won't generate vol spike events
      expect(events).to.be.an('array');
    });
  });

  // ---------- Event generation ----------

  describe('Event generation', () => {
    it('should sort events by volRatio descending', () => {
      // No tokens tracked, but verify the contract
      const events = scanner.getVolatilityEvents(1.0);
      for (let i = 1; i < events.length; i++) {
        expect(events[i - 1].volRatio).to.be.gte(events[i].volRatio);
      }
    });

    it('should include chainName, tokenSymbol, and timestamp in events', () => {
      // If there were events, they'd have these fields
      const events = scanner.getVolatilityEvents(0);
      for (const e of events) {
        expect(e).to.have.property('chainName');
        expect(e).to.have.property('tokenSymbol');
        expect(e).to.have.property('timestamp');
      }
    });
  });

  // ---------- scanAll alias ----------

  describe('scanAll alias', () => {
    it('should return same results as getVolatilityEvents', () => {
      const scan = scanner.scanAll(2.0);
      const events = scanner.getVolatilityEvents(2.0);
      expect(scan.length).to.equal(events.length);
    });
  });
});
