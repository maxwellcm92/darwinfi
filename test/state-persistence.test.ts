import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { StatePersistence, PersistedState } from '../src/agent/state-persistence';

describe('StatePersistence', () => {
  let tmpDir: string;
  let persistence: StatePersistence;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'darwinfi-test-'));
    persistence = new StatePersistence({ dataDir: tmpDir });
  });

  afterEach(() => {
    persistence.stopAutoSave();
    // Clean up temp directory
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeSampleState(): PersistedState {
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      agent: {
        loopCount: 42,
        tradeIdCounter: 100,
        lastEvolutionTime: new Date('2025-06-01T00:00:00Z').toISOString(),
        tradesAtLastEvolution: 50,
        evolutionCycleCount: 5,
        startTime: new Date('2025-06-01T00:00:00Z').toISOString(),
      },
      strategies: [],
      performance: {
        'strat-1': {
          totalPnL: 123.45,
          winRate: 0.6,
          sharpeRatio: 1.2,
          maxDrawdown: 0.15,
          tradesCompleted: 10,
          rolling24hPnL: 50,
          rolling24hSharpe: 0.8,
          rolling24hWinRate: 0.7,
          lastMetricsReset: new Date('2025-06-01T00:00:00Z') as any,
          tradeHistory: [
            {
              id: 't-1',
              strategyId: 'strat-1',
              token: 'ETH',
              side: 'buy',
              entryPrice: 100,
              exitPrice: 110,
              quantity: 1,
              pnl: 10,
              pnlPct: 10,
              entryTime: new Date('2025-06-01T00:00:00Z'),
              exitTime: new Date('2025-06-01T01:00:00Z'),
              status: 'closed',
              fees: 0,
            },
          ],
          consecutiveOutperformCycles: 3,
        } as any,
      },
    };
  }

  // ---------- Save then load round-trip ----------

  describe('Save and load round-trip', () => {
    it('should return identical state after save then load', () => {
      const state = makeSampleState();
      persistence.save(state);

      const loaded = persistence.load();
      expect(loaded).to.not.be.null;
      expect(loaded!.agent.loopCount).to.equal(42);
      expect(loaded!.agent.tradeIdCounter).to.equal(100);
      expect(loaded!.performance['strat-1'].totalPnL).to.equal(123.45);
      expect(loaded!.performance['strat-1'].winRate).to.equal(0.6);
      expect(loaded!.performance['strat-1'].tradesCompleted).to.equal(10);
    });
  });

  // ---------- Missing file ----------

  describe('Missing file handling', () => {
    it('should return null for missing file (not throw)', () => {
      const emptyPersistence = new StatePersistence({ dataDir: path.join(tmpDir, 'nonexistent') });
      const result = emptyPersistence.load();
      expect(result).to.be.null;
    });
  });

  // ---------- Version field ----------

  describe('Version field preservation', () => {
    it('should preserve version field through save/load', () => {
      const state = makeSampleState();
      persistence.save(state);

      const loaded = persistence.load();
      expect(loaded).to.not.be.null;
      expect(loaded!.version).to.equal(1);
    });

    it('should return null for mismatched version', () => {
      const state = makeSampleState();
      persistence.save(state);

      // Manually corrupt the version
      const filePath = path.join(tmpDir, 'agent-state.json');
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      raw.version = 999;
      fs.writeFileSync(filePath, JSON.stringify(raw));

      const loaded = persistence.load();
      expect(loaded).to.be.null;
    });
  });

  // ---------- Date rehydration ----------

  describe('Date rehydration', () => {
    it('should rehydrate Date objects from ISO strings', () => {
      const state = makeSampleState();
      persistence.save(state);

      const loaded = persistence.load();
      expect(loaded).to.not.be.null;

      const perf = loaded!.performance['strat-1'];
      // lastMetricsReset should be rehydrated as Date
      expect(perf.lastMetricsReset).to.be.instanceOf(Date);

      // Trade entry/exit times should be rehydrated
      const trade = perf.tradeHistory[0];
      expect(trade.entryTime).to.be.instanceOf(Date);
      expect(trade.exitTime).to.be.instanceOf(Date);
    });
  });

  // ---------- Atomic write ----------

  describe('Atomic write (tmp file)', () => {
    it('should use tmp file during write (no partial state file)', () => {
      const state = makeSampleState();

      // After save, there should be no .tmp file remaining
      persistence.save(state);

      const tmpPath = path.join(tmpDir, 'agent-state.json.tmp');
      expect(fs.existsSync(tmpPath)).to.be.false;

      // The actual state file should exist
      const statePath = path.join(tmpDir, 'agent-state.json');
      expect(fs.existsSync(statePath)).to.be.true;
    });
  });
});
