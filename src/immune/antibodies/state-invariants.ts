/**
 * DarwinFi Immune System - State Invariants (Antibody)
 *
 * Verifies structural invariants of agent-state.json:
 * - Expected strategy count (12)
 * - Valid strategy types (3 main + 9 variation)
 * - Valid statuses (paper|live|sell_only)
 * - No stale open trades (> 48h)
 * - All required fields present on every strategy
 */

import * as fs from 'fs';
import * as path from 'path';
import { CheckResult } from '../types';
import { THRESHOLDS, MONITORED_STATE_FILES, PROJECT_ROOT } from '../config';

const VALID_STATUSES = new Set(['paper', 'live', 'sell_only']);
const VALID_TYPES = new Set(['main', 'variation']);
const REQUIRED_STRATEGY_FIELDS = ['id', 'name', 'type', 'parameters', 'status', 'generation'];

export async function checkStateInvariants(): Promise<CheckResult> {
  const start = Date.now();
  const violations: Array<{ rule: string; detail: string }> = [];

  try {
    const statePath = path.join(PROJECT_ROOT, MONITORED_STATE_FILES.agentState);
    const raw = fs.readFileSync(statePath, 'utf-8');
    const state = JSON.parse(raw);

    const strategies: any[] = state.strategies || [];

    // Invariant 1: Exactly 12 strategies
    if (strategies.length !== THRESHOLDS.expectedStrategyCount) {
      violations.push({
        rule: 'strategy_count',
        detail: `Expected ${THRESHOLDS.expectedStrategyCount} strategies, found ${strategies.length}`,
      });
    }

    // Invariant 2: Strategy type distribution (3 main + 9 variation)
    const mainCount = strategies.filter((s: any) => s.type === 'main').length;
    const variationCount = strategies.filter((s: any) => s.type === 'variation').length;
    if (mainCount !== 3) {
      violations.push({
        rule: 'main_strategy_count',
        detail: `Expected 3 main strategies, found ${mainCount}`,
      });
    }
    if (variationCount !== 9) {
      violations.push({
        rule: 'variation_strategy_count',
        detail: `Expected 9 variation strategies, found ${variationCount}`,
      });
    }

    for (const strategy of strategies) {
      // Invariant 3: All required fields present
      for (const field of REQUIRED_STRATEGY_FIELDS) {
        if (strategy[field] === undefined || strategy[field] === null) {
          violations.push({
            rule: 'missing_field',
            detail: `Strategy ${strategy.id || '(no id)'} missing required field: ${field}`,
          });
        }
      }

      // Invariant 4: Valid status
      if (strategy.status && !VALID_STATUSES.has(strategy.status)) {
        violations.push({
          rule: 'invalid_status',
          detail: `Strategy ${strategy.id} has invalid status: ${strategy.status}`,
        });
      }

      // Invariant 5: Valid type
      if (strategy.type && !VALID_TYPES.has(strategy.type)) {
        violations.push({
          rule: 'invalid_type',
          detail: `Strategy ${strategy.id} has invalid type: ${strategy.type}`,
        });
      }
    }

    // Invariant 6: No stale open trades (> 48h)
    const performance: Record<string, any> = state.performance || {};
    const maxTradeAgeMs = THRESHOLDS.maxTradeAgeHours * 60 * 60 * 1000;
    const now = Date.now();

    for (const [sid, perf] of Object.entries(performance)) {
      const trades = (perf as any).tradeHistory || [];
      for (const trade of trades) {
        if (trade.status === 'open' && trade.entryTime) {
          const entryMs = new Date(trade.entryTime).getTime();
          const ageMs = now - entryMs;
          if (ageMs > maxTradeAgeMs) {
            const ageHours = Math.round(ageMs / (60 * 60 * 1000));
            violations.push({
              rule: 'stale_open_trade',
              detail: `Strategy ${sid} has open trade ${trade.id} aged ${ageHours}h (max ${THRESHOLDS.maxTradeAgeHours}h)`,
            });
          }
        }
      }
    }

    // Invariant 7: Strategy IDs should be unique
    const ids = strategies.map((s: any) => s.id);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
      const dupes = ids.filter((id: string, i: number) => ids.indexOf(id) !== i);
      violations.push({
        rule: 'duplicate_strategy_ids',
        detail: `Duplicate strategy IDs found: ${dupes.join(', ')}`,
      });
    }

    // Invariant 8: Performance keys should match strategy IDs
    const perfKeys = new Set(Object.keys(performance));
    for (const sid of ids) {
      if (!perfKeys.has(sid)) {
        violations.push({
          rule: 'missing_performance_entry',
          detail: `Strategy ${sid} has no corresponding performance entry`,
        });
      }
    }

    if (violations.length > 0) {
      return {
        checkId: 'antibody.state_invariants',
        category: 'invariant',
        severity: 'error',
        message: `${violations.length} state invariant violation(s) detected`,
        details: { violations },
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      };
    }

    return {
      checkId: 'antibody.state_invariants',
      category: 'invariant',
      severity: 'ok',
      message: `All state invariants hold (${strategies.length} strategies, ${Object.keys(performance).length} perf entries)`,
      timestamp: Date.now(),
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      checkId: 'antibody.state_invariants',
      category: 'invariant',
      severity: 'error',
      message: `State invariant check failed: ${err.message}`,
      details: { error: err.message, stack: err.stack },
      timestamp: Date.now(),
      durationMs: Date.now() - start,
    };
  }
}
