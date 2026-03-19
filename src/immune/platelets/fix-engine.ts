/**
 * DarwinFi Immune System - Fix Engine
 *
 * Core self-healing loop: detect -> triage -> diagnose -> safety check ->
 * apply fix -> cooldown -> verify. Rate-limited and fully logged.
 */

import { CheckResult, FixRecord } from '../types';
import { THRESHOLDS } from '../config';
import { LogAggregator } from '../lymph/log-aggregator';
import { AlertManager } from '../lymph/alert-manager';
import { getFixForCheck } from './fix-registry';
import { FixHistory } from './fix-history';

const DIVISION = 'Platelets';

interface FixAttemptRecord {
  timestamps: number[];
  lastFixName: string;
}

export class FixEngine {
  private logger: LogAggregator;
  private alertManager: AlertManager;
  private history: FixHistory;

  // Rate limiting: track attempts per checkId
  private attemptTracker: Map<string, FixAttemptRecord> = new Map();

  // Global hourly counter tracked separately for speed
  private hourlyFixTimestamps: number[] = [];

  constructor(logger: LogAggregator, alertManager: AlertManager) {
    this.logger = logger;
    this.alertManager = alertManager;
    this.history = new FixHistory();
  }

  /**
   * Process a failed check result. Looks up the fix, enforces rate limits,
   * applies the fix, waits, then re-verifies using the provided callback.
   *
   * @param result - The failing CheckResult
   * @param recheckFn - Callback to re-run the original check for verification
   */
  async processCheckResult(
    result: CheckResult,
    recheckFn: () => Promise<CheckResult>,
  ): Promise<void> {
    // Only act on error/critical
    if (result.severity !== 'error' && result.severity !== 'critical') {
      return;
    }

    const entry = getFixForCheck(result.checkId);
    if (!entry) {
      this.logger.warn(DIVISION, `No fix registered for check: ${result.checkId}`, result.checkId);
      return;
    }

    // Safety gate: only auto-apply safe fixes
    if (entry.safety !== 'safe') {
      this.logger.info(
        DIVISION,
        `Fix for ${result.checkId} is '${entry.safety}' - skipping auto-fix, escalating`,
        result.checkId,
      );
      this.alertManager.processCheck(result);
      return;
    }

    // Rate limit: max fixes per hour (global)
    if (this.getHourlyFixCount() >= THRESHOLDS.maxFixesPerHour) {
      this.logger.warn(
        DIVISION,
        `Hourly fix limit reached (${THRESHOLDS.maxFixesPerHour}). Skipping fix for ${result.checkId}`,
        result.checkId,
      );
      return;
    }

    // Rate limit: cooldown for same fix
    const tracker = this.attemptTracker.get(result.checkId);
    if (tracker && tracker.timestamps.length > 0) {
      const lastAttempt = tracker.timestamps[tracker.timestamps.length - 1];
      const elapsed = Date.now() - lastAttempt;
      if (elapsed < THRESHOLDS.fixCooldownMs) {
        this.logger.info(
          DIVISION,
          `Cooldown active for ${result.checkId} (${Math.round((THRESHOLDS.fixCooldownMs - elapsed) / 1000)}s remaining)`,
          result.checkId,
        );
        return;
      }
    }

    // Rate limit: max attempts per incident
    const recentAttempts = this.getRecentAttemptCount(result.checkId);
    if (recentAttempts >= THRESHOLDS.maxFixAttempts) {
      this.logger.error(
        DIVISION,
        `Max fix attempts (${THRESHOLDS.maxFixAttempts}) exhausted for ${result.checkId}. Escalating.`,
        result.checkId,
      );
      this.alertManager.processCheck(result);
      return;
    }

    // Apply the fix
    this.logger.info(
      DIVISION,
      `Applying fix '${entry.fixName}' for ${result.checkId} (attempt ${recentAttempts + 1}/${THRESHOLDS.maxFixAttempts})`,
      result.checkId,
    );

    const appliedAt = Date.now();
    let success = false;
    let error: string | undefined;

    try {
      success = await entry.fixFn();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      success = false;
    }

    // Track the attempt
    this.recordAttempt(result.checkId, entry.fixName);
    this.hourlyFixTimestamps.push(Date.now());

    if (!success) {
      this.logger.error(
        DIVISION,
        `Fix '${entry.fixName}' failed for ${result.checkId}${error ? ': ' + error : ''}`,
        result.checkId,
      );

      this.recordFixHistory(result.checkId, entry.fixName, entry.safety, appliedAt, false, recentAttempts + 1, error);
      this.alertManager.markFixAttempted(result.checkId, false);
      return;
    }

    this.logger.info(
      DIVISION,
      `Fix '${entry.fixName}' applied for ${result.checkId}. Waiting ${THRESHOLDS.fixVerifyDelayMs / 1000}s to verify...`,
      result.checkId,
    );

    // Wait before verification
    await this.delay(THRESHOLDS.fixVerifyDelayMs);

    // Verify the fix
    let verifyResult: CheckResult;
    try {
      verifyResult = await recheckFn();
    } catch (err) {
      this.logger.error(
        DIVISION,
        `Verification re-check threw for ${result.checkId}: ${err instanceof Error ? err.message : err}`,
        result.checkId,
      );
      this.recordFixHistory(result.checkId, entry.fixName, entry.safety, appliedAt, false, recentAttempts + 1, 'Verify re-check threw');
      this.alertManager.markFixAttempted(result.checkId, false);
      return;
    }

    const verified = verifyResult.severity === 'ok' || verifyResult.severity === 'warning';

    if (verified) {
      this.logger.info(
        DIVISION,
        `Fix verified: '${entry.fixName}' resolved ${result.checkId}`,
        result.checkId,
      );
      this.alertManager.markFixAttempted(result.checkId, true);
      this.alertManager.resolveAlert(result.checkId);
    } else {
      this.logger.warn(
        DIVISION,
        `Fix '${entry.fixName}' did not resolve ${result.checkId} (still ${verifyResult.severity})`,
        result.checkId,
      );
      this.alertManager.markFixAttempted(result.checkId, false);
    }

    this.recordFixHistory(
      result.checkId,
      entry.fixName,
      entry.safety,
      appliedAt,
      verified,
      recentAttempts + 1,
      verified ? undefined : `Verification failed: ${verifyResult.severity}`,
    );
  }

  /**
   * Get the fix history instance for external queries.
   */
  getHistory(): FixHistory {
    return this.history;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private recordAttempt(checkId: string, fixName: string): void {
    let tracker = this.attemptTracker.get(checkId);
    if (!tracker) {
      tracker = { timestamps: [], lastFixName: fixName };
      this.attemptTracker.set(checkId, tracker);
    }
    tracker.timestamps.push(Date.now());
    tracker.lastFixName = fixName;
  }

  private getRecentAttemptCount(checkId: string): number {
    const tracker = this.attemptTracker.get(checkId);
    if (!tracker) return 0;

    // Count attempts within the cooldown window
    const cutoff = Date.now() - THRESHOLDS.fixCooldownMs;
    tracker.timestamps = tracker.timestamps.filter(t => t > cutoff);
    return tracker.timestamps.length;
  }

  private getHourlyFixCount(): number {
    const oneHourAgo = Date.now() - 60 * 60_000;
    this.hourlyFixTimestamps = this.hourlyFixTimestamps.filter(t => t > oneHourAgo);
    return this.hourlyFixTimestamps.length;
  }

  private recordFixHistory(
    checkId: string,
    fixName: string,
    safety: string,
    appliedAt: number,
    success: boolean,
    attempts: number,
    error?: string,
  ): void {
    const record: FixRecord = {
      id: `fix-${appliedAt}-${Math.random().toString(36).slice(2, 8)}`,
      checkId,
      fixName,
      safety: safety as FixRecord['safety'],
      appliedAt,
      success,
      attempts,
      rollback: false,
      ...(error && { error }),
    };
    this.history.addFix(record);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
