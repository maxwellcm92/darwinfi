/**
 * DarwinFi Immune System - Patrol Scheduler
 *
 * Central scheduler that runs each patrol check on its configured interval.
 * Accepts a result callback so downstream systems (fix-engine, dashboard)
 * can subscribe to check results.
 */

import { CheckResult } from '../types';
import { CHECK_INTERVALS, MONITORED_PROCESSES } from '../config';
import { LogAggregator } from '../lymph/log-aggregator';
import { checkSingleProcessHealth } from './process-patrol';
import { checkApiEndpoints } from './api-patrol';
import { checkChainHealth } from './chain-patrol';
import { checkStateFiles } from './state-patrol';
import { checkInstinctHealth } from './instinct-patrol';

export type CheckResultHandler = (result: CheckResult) => void;

export class PatrolScheduler {
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private logger: LogAggregator;
  private onResult: CheckResultHandler;

  constructor(logger: LogAggregator, onResult: CheckResultHandler) {
    this.logger = logger;
    this.onResult = onResult;
  }

  start(): void {
    this.logger.info('Patrol', 'Starting patrol scheduler');

    // Per-process health checks (skip darwinfi-immune -- can't restart itself)
    for (const proc of MONITORED_PROCESSES) {
      if (proc.name === 'darwinfi-immune') continue;
      this.schedule(
        proc.checkId,
        () => checkSingleProcessHealth(proc),
        CHECK_INTERVALS.processHealth,
      );
    }

    this.schedule('api_probe', checkApiEndpoints, CHECK_INTERVALS.apiProbe);
    this.schedule('chain_health', checkChainHealth, CHECK_INTERVALS.chainHealth);
    this.schedule('state_integrity', checkStateFiles, CHECK_INTERVALS.stateIntegrity);
    this.schedule('instinct_health', checkInstinctHealth, CHECK_INTERVALS.instinctHealth);
  }

  stop(): void {
    for (const [name, timer] of this.timers) {
      clearInterval(timer);
      this.logger.info('Patrol', `Stopped ${name}`);
    }
    this.timers.clear();
  }

  private schedule(name: string, checkFn: () => Promise<CheckResult>, intervalMs: number): void {
    // Run immediately, then on interval
    this.runCheck(name, checkFn);
    const timer = setInterval(() => this.runCheck(name, checkFn), intervalMs);
    this.timers.set(name, timer);
  }

  private async runCheck(name: string, checkFn: () => Promise<CheckResult>): Promise<void> {
    try {
      const result = await checkFn();
      this.onResult(result);
      if (result.severity !== 'ok') {
        this.logger.warn('Patrol', `${name}: ${result.severity} - ${result.message}`, result.checkId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error('Patrol', `${name} threw: ${msg}`, name);
    }
  }
}
