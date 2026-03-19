import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Integration tests: State file integrity.
 *
 * Validates that data/agent-state.json is well-formed, contains expected
 * structure, and has no NaN/Infinity corruption in numeric fields.
 */

const STATE_FILE = path.resolve(process.cwd(), 'data/agent-state.json');

describe('State File Integrity (integration)', function () {
  let stateExists = false;
  let state: any;

  before(function () {
    stateExists = fs.existsSync(STATE_FILE);
    if (!stateExists) {
      this.skip();
    } else {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      state = JSON.parse(raw);
    }
  });

  it('data/agent-state.json should be valid JSON', function () {
    // If we got here, JSON.parse succeeded in before()
    expect(state).to.be.an('object');
  });

  it('should contain strategies array with length 12', function () {
    expect(state).to.have.property('strategies');
    expect(state.strategies).to.be.an('array');
    expect(state.strategies).to.have.length(12);
  });

  it('should have no NaN values in performance metrics', function () {
    const performance = state.performance || {};

    for (const [sid, metrics] of Object.entries(performance) as [string, any][]) {
      const numericFields = [
        'totalPnL', 'winRate', 'sharpeRatio', 'maxDrawdown',
        'tradesCompleted', 'rolling24hPnL', 'rolling24hSharpe', 'rolling24hWinRate',
      ];
      for (const field of numericFields) {
        if (metrics[field] !== undefined) {
          expect(
            Number.isNaN(metrics[field]),
            `${sid}.${field} is NaN`
          ).to.be.false;
        }
      }
    }
  });

  it('should have no Infinity values in performance metrics', function () {
    const performance = state.performance || {};

    for (const [sid, metrics] of Object.entries(performance) as [string, any][]) {
      const numericFields = [
        'totalPnL', 'winRate', 'sharpeRatio', 'maxDrawdown',
        'tradesCompleted', 'rolling24hPnL', 'rolling24hSharpe', 'rolling24hWinRate',
      ];
      for (const field of numericFields) {
        if (typeof metrics[field] === 'number') {
          expect(
            Number.isFinite(metrics[field]),
            `${sid}.${field} is Infinity`
          ).to.be.true;
        }
      }
    }
  });

  it('should have all unique strategy IDs', function () {
    const ids = state.strategies.map((s: any) => s.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).to.equal(ids.length);
  });
});
