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

interface FixTypeStats {
  attempts: number;
  successes: number;
  lastAttempt: number;
  backoffMs: number;
}

export class FixEngine {
  private logger: LogAggregator;
  private alertManager: AlertManager;
  private history: FixHistory;

  // Rate limiting: track attempts per checkId
  private attemptTracker: Map<string, FixAttemptRecord> = new Map();

  // Per-fix-type success tracking with exponential backoff
  private fixTypeTracker: Map<string, FixTypeStats> = new Map();
  private static readonly MIN_FIX_TYPE_ATTEMPTS = 10;
  private static readonly MIN_FIX_SUCCESS_RATE = 0.10; // 10%
  private static readonly INITIAL_BACKOFF_MS = 60 * 60_000; // 1 hour
  private static readonly MAX_BACKOFF_MS = 12 * 60 * 60_000; // 12 hours

  // Global hourly counter tracked separately for speed
  private hourlyFixTimestamps: number[] = [];

  constructor(logger: LogAggregator, alertManager: AlertManager) {
    this.logger = logger;
    this.alertManager = alertManager;
    this.history = new FixHistory();
  }

  /**
   * Check if a fix type is backed off due to low success rate.
   * Returns { allowed: true } or { allowed: false, reason: string }.
   */
  private checkFixTypeBackoff(fixName: string): { allowed: boolean; reason?: string } {
    const stats = this.fixTypeTracker.get(fixName);
    if (!stats) return { allowed: true };

    // Not enough data yet to judge
    if (stats.attempts < FixEngine.MIN_FIX_TYPE_ATTEMPTS) return { allowed: true };

    const successRate = stats.successes / stats.attempts;
    if (successRate >= FixEngine.MIN_FIX_SUCCESS_RATE) return { allowed: true };

    // Check if we're still in backoff period
    const elapsed = Date.now() - stats.lastAttempt;
    if (elapsed < stats.backoffMs) {
      const remainingH = ((stats.backoffMs - elapsed) / 3_600_000).toFixed(1);
      return {
        allowed: false,
        reason: `Fix type '${fixName}' backed off (${(successRate * 100).toFixed(1)}% success rate after ${stats.attempts} attempts, ${remainingH}h remaining)`,
      };
    }

    // Backoff expired, allow one more attempt but keep tracking
    return { allowed: true };
  }

  /**
   * Record a fix type attempt result and update backoff.
   */
  private recordFixTypeAttempt(fixName: string, success: boolean): void {
    let stats = this.fixTypeTracker.get(fixName);
    if (!stats) {
      stats = { attempts: 0, successes: 0, lastAttempt: 0, backoffMs: 0 };
      this.fixTypeTracker.set(fixName, stats);
    }

    stats.attempts++;
    if (success) stats.successes++;
    stats.lastAttempt = Date.now();

    // Update backoff if success rate is too low
    if (stats.attempts >= FixEngine.MIN_FIX_TYPE_ATTEMPTS) {
      const successRate = stats.successes / stats.attempts;
      if (successRate < FixEngine.MIN_FIX_SUCCESS_RATE) {
        // Exponential backoff: double each time, cap at max
        if (stats.backoffMs === 0) {
          stats.backoffMs = FixEngine.INITIAL_BACKOFF_MS;
        } else {
          stats.backoffMs = Math.min(stats.backoffMs * 2, FixEngine.MAX_BACKOFF_MS);
        }
        this.logger.warn(
          DIVISION,
          `Fix type '${fixName}' backoff set to ${(stats.backoffMs / 3_600_000).toFixed(1)}h (${(successRate * 100).toFixed(1)}% success after ${stats.attempts} attempts)`,
          fixName,
        );
      } else {
        // Success rate recovered, reset backoff
        stats.backoffMs = 0;
      }
    }
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

    // Check fix type backoff (cross-check exponential backoff)
    const typeBackoff = this.checkFixTypeBackoff(entry.fixName);
    if (!typeBackoff.allowed) {
      this.logger.info(DIVISION, typeBackoff.reason!, result.checkId);
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

      this.recordFixTypeAttempt(entry.fixName, false);
      this.recordFixHistory(result.checkId, entry.fixName, entry.safety, appliedAt, false, recentAttempts + 1, error);
      this.alertManager.markFixAttempted(result.checkId, false);
      return;
    }

    const verifyDelay = entry.verifyDelayMs ?? Math.max(THRESHOLDS.fixVerifyDelayMs, 15_000);
    this.logger.info(
      DIVISION,
      `Fix '${entry.fixName}' applied for ${result.checkId}. Waiting ${verifyDelay / 1000}s to verify...`,
      result.checkId,
    );

    // Wait before verification
    await this.delay(verifyDelay);

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

    let verified = verifyResult.severity === 'ok' || verifyResult.severity === 'warning';

    // Retry once with doubled delay if first verification fails
    if (!verified) {
      const retryDelay = verifyDelay * 2;
      this.logger.info(DIVISION, `First verify failed for ${result.checkId}, retrying in ${retryDelay / 1000}s...`, result.checkId);
      await this.delay(retryDelay);
      try {
        verifyResult = await recheckFn();
        verified = verifyResult.severity === 'ok' || verifyResult.severity === 'warning';
      } catch { /* keep verified = false */ }
    }

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

    this.recordFixTypeAttempt(entry.fixName, verified);
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
