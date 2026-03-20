/**
 * DarwinFi Immune System - Process Patrol
 *
 * Monitors all DarwinFi PM2 processes: status, memory usage, restart rate.
 */

import { execSync } from 'child_process';
import { CheckResult } from '../types';
import { THRESHOLDS, MONITORED_PROCESSES, MonitoredProcess } from '../config';

// Track restart count over time per process to compute per-hour rate.
// PM2's restart_time is a lifetime counter, not a rate.
const restartSnapshots = new Map<string, { count: number; timestamp: number }>();

/**
 * Get the current PM2 process list (cached per call batch).
 */
function getPm2Processes(): any[] {
  const raw = execSync('pm2 jlist', { encoding: 'utf-8', timeout: 10000 });
  return JSON.parse(raw);
}

/**
 * Check health of a single PM2 process.
 */
export async function checkSingleProcessHealth(proc: MonitoredProcess): Promise<CheckResult> {
  const start = Date.now();
  try {
    const processes = getPm2Processes();
    const pm2Proc = processes.find((p: any) => p.name === proc.name);

    if (!pm2Proc) {
      return {
        checkId: proc.checkId,
        category: 'process',
        severity: proc.critical ? 'critical' : 'error',
        message: `${proc.name} not found in PM2`,
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      };
    }

    const memMiB = (pm2Proc.monit?.memory || 0) / (1024 * 1024);
    const totalRestarts = pm2Proc.pm2_env?.restart_time || 0;
    const status = pm2Proc.pm2_env?.status;
    const now = Date.now();

    // Compute restart rate per hour from snapshots
    let restartsPerHour = 0;
    const lastSnapshot = restartSnapshots.get(proc.name);
    if (lastSnapshot) {
      const elapsedMs = now - lastSnapshot.timestamp;
      const deltaRestarts = totalRestarts - lastSnapshot.count;
      if (elapsedMs > 0 && deltaRestarts >= 0) {
        restartsPerHour = (deltaRestarts / elapsedMs) * 3_600_000;
      }
    }
    restartSnapshots.set(proc.name, { count: totalRestarts, timestamp: now });

    const issues: string[] = [];
    if (status !== 'online') issues.push(`status=${status}`);
    if (memMiB > THRESHOLDS.maxMemoryMiB)
      issues.push(`memory=${memMiB.toFixed(0)}MiB>${THRESHOLDS.maxMemoryMiB}MiB`);
    if (restartsPerHour > THRESHOLDS.maxRestartsPerHour)
      issues.push(`restarts=${restartsPerHour.toFixed(1)}/hr>${THRESHOLDS.maxRestartsPerHour}/hr`);

    if (issues.length === 0) {
      return {
        checkId: proc.checkId,
        category: 'process',
        severity: 'ok',
        message: `${proc.name} online, ${memMiB.toFixed(0)}MiB, ${restartsPerHour.toFixed(1)} restarts/hr`,
        timestamp: Date.now(),
        durationMs: Date.now() - start,
        details: { processName: proc.name, memMiB, totalRestarts, restartsPerHour, status },
      };
    }

    const severity = status !== 'online' ? (proc.critical ? 'critical' : 'error') : 'error';
    return {
      checkId: proc.checkId,
      category: 'process',
      severity,
      message: `${proc.name}: ${issues.join(', ')}`,
      timestamp: Date.now(),
      durationMs: Date.now() - start,
      details: { processName: proc.name, memMiB, totalRestarts, restartsPerHour, status },
    };
  } catch (err) {
    return {
      checkId: proc.checkId,
      category: 'process',
      severity: 'critical',
      message: `PM2 check for ${proc.name} failed: ${err instanceof Error ? err.message : err}`,
      timestamp: Date.now(),
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Check health of all monitored processes. Returns one CheckResult per process.
 */
export async function checkAllProcessHealth(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const proc of MONITORED_PROCESSES) {
    results.push(await checkSingleProcessHealth(proc));
  }
  return results;
}

/**
 * Legacy wrapper: returns worst-case result across all processes.
 * Keeps backward compatibility with code expecting a single CheckResult.
 */
export async function checkProcessHealth(): Promise<CheckResult> {
  const results = await checkAllProcessHealth();
  const severityOrder = ['critical', 'error', 'warning', 'ok'];

  let worst = results[0];
  for (const r of results) {
    if (severityOrder.indexOf(r.severity) < severityOrder.indexOf(worst.severity)) {
      worst = r;
    }
  }

  // Return with legacy checkId for backward compat
  return {
    ...worst,
    checkId: 'process_health',
  };
}
