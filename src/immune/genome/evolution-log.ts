/**
 * DarwinFi Immune System - Evolution Log (Incident Analysis)
 *
 * Analyzes fix history and immune logs to produce IncidentSummary records.
 * Groups by checkId, computes frequency, false positive rate,
 * mean detection time, and fix success rate.
 */

import { FixRecord, LogEntry, IncidentSummary } from '../types';

const PREFIX = '[Immune:Genome]';
const RAPID_RESOLVE_MS = 60_000; // Alerts resolved within 60s suggest false positive

/**
 * Analyze fix history and logs to produce per-check incident summaries.
 */
export function analyzeIncidents(
  fixHistory: FixRecord[],
  logs: LogEntry[],
): IncidentSummary[] {
  // Group fixes by checkId
  const fixesByCheck = new Map<string, FixRecord[]>();
  for (const fix of fixHistory) {
    const group = fixesByCheck.get(fix.checkId) || [];
    group.push(fix);
    fixesByCheck.set(fix.checkId, group);
  }

  // Build alert timelines from logs for detection time estimation
  const alertTimestamps = new Map<string, number[]>();
  for (const entry of logs) {
    if (entry.checkId && (entry.level === 'warn' || entry.level === 'error' || entry.level === 'critical')) {
      const times = alertTimestamps.get(entry.checkId) || [];
      times.push(entry.timestamp);
      alertTimestamps.set(entry.checkId, times);
    }
  }

  const summaries: IncidentSummary[] = [];

  for (const [checkId, fixes] of fixesByCheck) {
    const count = fixes.length;
    const lastOccurred = Math.max(...fixes.map((f) => f.appliedAt));

    // Fix success rate
    const successCount = fixes.filter((f) => f.success).length;
    const fixSuccessRate = count > 0 ? successCount / count : 0;

    // Estimate false positives: fixes that succeeded very quickly
    // (resolved rapidly after alert) suggest the alert was premature
    const falsePositives = estimateFalsePositives(fixes, alertTimestamps.get(checkId) || []);

    // Mean detection time: average duration from alert log to fix application
    const meanDetectionMs = computeMeanDetectionMs(fixes, alertTimestamps.get(checkId) || []);

    summaries.push({
      checkId,
      count,
      lastOccurred,
      fixSuccessRate,
      falsePositives,
      meanDetectionMs,
    });
  }

  console.log(`${PREFIX} Analyzed ${fixHistory.length} fixes across ${summaries.length} check IDs`);
  return summaries;
}

/**
 * Estimate false positive count.
 * A fix that was applied and succeeded within RAPID_RESOLVE_MS of the alert
 * with no real state change (before/after snapshots equal or missing) suggests
 * the alert was a false positive.
 */
function estimateFalsePositives(fixes: FixRecord[], alertTimes: number[]): number {
  if (alertTimes.length === 0) return 0;

  let count = 0;
  const sortedAlerts = [...alertTimes].sort((a, b) => a - b);

  for (const fix of fixes) {
    if (!fix.success) continue;

    // Find the closest alert before this fix
    const alertBefore = findClosestBefore(sortedAlerts, fix.appliedAt);
    if (alertBefore === null) continue;

    const timeSinceAlert = fix.appliedAt - alertBefore;
    if (timeSinceAlert < RAPID_RESOLVE_MS) {
      // Rapid resolution suggests false positive
      count++;
    }
  }

  return count;
}

/**
 * Find the closest timestamp in sorted array that is before the target.
 */
function findClosestBefore(sorted: number[], target: number): number | null {
  let result: number | null = null;
  for (const t of sorted) {
    if (t <= target) {
      result = t;
    } else {
      break;
    }
  }
  return result;
}

/**
 * Compute mean detection time in ms.
 * Detection time = time from first alert log entry to fix application.
 */
function computeMeanDetectionMs(fixes: FixRecord[], alertTimes: number[]): number {
  if (fixes.length === 0 || alertTimes.length === 0) return 0;

  const sortedAlerts = [...alertTimes].sort((a, b) => a - b);
  const detectionTimes: number[] = [];

  for (const fix of fixes) {
    const alertBefore = findClosestBefore(sortedAlerts, fix.appliedAt);
    if (alertBefore !== null) {
      detectionTimes.push(fix.appliedAt - alertBefore);
    }
  }

  if (detectionTimes.length === 0) return 0;
  return detectionTimes.reduce((sum, t) => sum + t, 0) / detectionTimes.length;
}
