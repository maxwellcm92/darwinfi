/**
 * DarwinFi Immune System - Process Patrol
 *
 * Monitors darwinfi PM2 process: status, memory usage, restart rate.
 */

import { execSync } from 'child_process';
import { CheckResult } from '../types';
import { THRESHOLDS } from '../config';

// Track restart count over time to compute per-hour rate
// PM2's restart_time is a lifetime counter, not a rate.
let lastRestartSnapshot: { count: number; timestamp: number } | null = null;

export async function checkProcessHealth(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const raw = execSync('pm2 jlist', { encoding: 'utf-8', timeout: 10000 });
    const processes = JSON.parse(raw);
    const darwin = processes.find((p: any) => p.name === 'darwinfi');

    if (!darwin) {
      return {
        checkId: 'process_health',
        category: 'process',
        severity: 'critical',
        message: 'darwinfi process not found in PM2',
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      };
    }

    const memMiB = (darwin.monit?.memory || 0) / (1024 * 1024);
    const totalRestarts = darwin.pm2_env?.restart_time || 0;
    const status = darwin.pm2_env?.status;
    const now = Date.now();

    // Compute restart rate per hour from snapshots
    let restartsPerHour = 0;
    if (lastRestartSnapshot) {
      const elapsedMs = now - lastRestartSnapshot.timestamp;
      const deltaRestarts = totalRestarts - lastRestartSnapshot.count;
      if (elapsedMs > 0 && deltaRestarts >= 0) {
        restartsPerHour = (deltaRestarts / elapsedMs) * 3_600_000;
      }
    }
    lastRestartSnapshot = { count: totalRestarts, timestamp: now };

    const issues: string[] = [];
    if (status !== 'online') issues.push(`status=${status}`);
    if (memMiB > THRESHOLDS.maxMemoryMiB)
      issues.push(`memory=${memMiB.toFixed(0)}MiB>${THRESHOLDS.maxMemoryMiB}MiB`);
    if (restartsPerHour > THRESHOLDS.maxRestartsPerHour)
      issues.push(`restarts=${restartsPerHour.toFixed(1)}/hr>${THRESHOLDS.maxRestartsPerHour}/hr`);

    if (issues.length === 0) {
      return {
        checkId: 'process_health',
        category: 'process',
        severity: 'ok',
        message: `darwinfi online, ${memMiB.toFixed(0)}MiB, ${restartsPerHour.toFixed(1)} restarts/hr`,
        timestamp: Date.now(),
        durationMs: Date.now() - start,
        details: { memMiB, totalRestarts, restartsPerHour, status },
      };
    }

    const severity = status !== 'online' ? 'critical' : 'error';
    return {
      checkId: 'process_health',
      category: 'process',
      severity,
      message: issues.join(', '),
      timestamp: Date.now(),
      durationMs: Date.now() - start,
      details: { memMiB, totalRestarts, restartsPerHour, status },
    };
  } catch (err) {
    return {
      checkId: 'process_health',
      category: 'process',
      severity: 'critical',
      message: `PM2 check failed: ${err instanceof Error ? err.message : err}`,
      timestamp: Date.now(),
      durationMs: Date.now() - start,
    };
  }
}
