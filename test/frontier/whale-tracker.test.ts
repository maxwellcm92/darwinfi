import { WhaleTracker, WhaleWallet } from '../../src/frontier/whale/whale-tracker';
import { expect } from 'chai';
import { JsonRpcProvider } from 'ethers';

describe('WhaleTracker', () => {
  let tracker: WhaleTracker;

  beforeEach(() => {
    const providers = new Map<number, JsonRpcProvider>();
    tracker = new WhaleTracker(providers, 10_000);
  });

  afterEach(() => {
    tracker.stopMonitoring();
    tracker.removeAllListeners();
  });

  // ---------- Registry seeding ----------

  describe('Registry seeding', () => {
    it('should seed wallets into the registry', () => {
      tracker.seedRegistry([
        { address: '0xWhale1', chainId: 8453 },
        { address: '0xWhale2', chainId: 8453 },
      ]);
      expect(tracker.getRegistrySize()).to.equal(2);
    });

    it('should not duplicate wallets on repeated seeding', () => {
      tracker.seedRegistry([{ address: '0xWhale1', chainId: 8453 }]);
      tracker.seedRegistry([{ address: '0xWhale1', chainId: 8453 }]);
      expect(tracker.getRegistrySize()).to.equal(1);
    });

    it('should treat same address on different chains as separate entries', () => {
      tracker.seedRegistry([
        { address: '0xWhale1', chainId: 8453 },
        { address: '0xWhale1', chainId: 42161 },
      ]);
      expect(tracker.getRegistrySize()).to.equal(2);
    });
  });

  // ---------- Wallet scoring ----------

  describe('Wallet scoring', () => {
    it('should return 0 for unknown wallet', () => {
      const score = tracker.scoreWallet('0xUnknown');
      expect(score).to.equal(0);
    });

    it('should return a score between 0 and 100 for seeded wallet', () => {
      tracker.seedRegistry([{ address: '0xScoreTest', chainId: 8453 }]);
      const score = tracker.scoreWallet('0xScoreTest');
      expect(score).to.be.gte(0);
      expect(score).to.be.lte(100);
    });

    it('should produce a baseline score of ~50 for default seeded wallet', () => {
      // Default seed: winRate=0.5, avgPnlPct=0, totalTrades=0
      tracker.seedRegistry([{ address: '0xBaseline', chainId: 8453 }]);
      const score = tracker.scoreWallet('0xBaseline');
      // winRate=0.5 -> 20pts, pnl=0 -> normalized=0.5 -> 15pts, trades=0 -> 0pts, recency varies
      expect(score).to.be.gte(20);
      expect(score).to.be.lte(50);
    });
  });

  // ---------- Serialization / Deserialization ----------

  describe('Serialization / Deserialization', () => {
    it('should round-trip through serialize/deserialize', () => {
      tracker.seedRegistry([
        { address: '0xSer1', chainId: 8453 },
        { address: '0xSer2', chainId: 42161 },
      ]);

      const serialized = tracker.serialize();
      expect(serialized).to.have.length(2);

      // Create new tracker and deserialize
      const newTracker = new WhaleTracker(new Map(), 10_000);
      newTracker.deserialize(serialized);

      expect(newTracker.getRegistrySize()).to.equal(2);
      expect(newTracker.serialize()).to.deep.equal(serialized);
    });

    it('should preserve wallet properties through serialization', () => {
      tracker.seedRegistry([{ address: '0xProps', chainId: 8453 }]);

      const serialized = tracker.serialize();
      const wallet = serialized.find(w => w.address === '0xprops'); // lowercase
      expect(wallet).to.exist;
      expect(wallet!.chainId).to.equal(8453);
      expect(wallet!.winRate).to.equal(0.5);
      expect(wallet!.score).to.equal(50); // default seed score
    });
  });

  // ---------- Top whales ranking ----------

  describe('Top whales ranking', () => {
    it('should return whales sorted by score descending', () => {
      tracker.seedRegistry([
        { address: '0xA', chainId: 8453 },
        { address: '0xB', chainId: 8453 },
        { address: '0xC', chainId: 8453 },
      ]);

      const top = tracker.getTopWhales(10);
      for (let i = 1; i < top.length; i++) {
        expect(top[i - 1].score).to.be.gte(top[i].score);
      }
    });

    it('should respect the limit parameter', () => {
      tracker.seedRegistry([
        { address: '0x1', chainId: 8453 },
        { address: '0x2', chainId: 8453 },
        { address: '0x3', chainId: 8453 },
        { address: '0x4', chainId: 8453 },
        { address: '0x5', chainId: 8453 },
      ]);

      const top = tracker.getTopWhales(3);
      expect(top.length).to.equal(3);
    });
  });

  // ---------- Recent whale buys ----------

  describe('Recent whale buys', () => {
    it('should return empty array when no activity exists', () => {
      const buys = tracker.getRecentWhaleBuys();
      expect(buys).to.be.an('array').that.is.empty;
    });
  });
});
