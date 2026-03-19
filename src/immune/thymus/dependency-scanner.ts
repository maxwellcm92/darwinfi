/**
 * DarwinFi Immune System - Thymus: Dependency Scanner
 *
 * Runs `npm audit --json` and converts vulnerability counts into a CheckResult.
 * Scheduled at CHECK_INTERVALS.depScan (24h).
 */

import { exec } from 'child_process';
import * as path from 'path';
import { CheckResult } from '../types';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

export async function scanDependencies(): Promise<CheckResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    exec('npm audit --json', { cwd: PROJECT_ROOT, timeout: 60000 }, (error, stdout) => {
      try {
        const audit = JSON.parse(stdout || '{}');
        const vuln = audit.metadata?.vulnerabilities || {};
        const critical = vuln.critical || 0;
        const high = vuln.high || 0;
        const moderate = vuln.moderate || 0;
        const low = vuln.low || 0;
        const total = critical + high + moderate + low;

        let severity: 'ok' | 'warning' | 'error' | 'critical' = 'ok';
        if (critical > 0) severity = 'critical';
        else if (high > 0) severity = 'error';
        else if (moderate > 0) severity = 'warning';

        resolve({
          checkId: 'dep_scan',
          category: 'security',
          severity,
          message: total === 0
            ? 'No vulnerabilities found'
            : `${total} vulnerabilities: ${critical} critical, ${high} high, ${moderate} moderate, ${low} low`,
          details: { critical, high, moderate, low, total },
          timestamp: Date.now(),
          durationMs: Date.now() - start,
        });
      } catch {
        resolve({
          checkId: 'dep_scan',
          category: 'security',
          severity: 'warning',
          message: 'Failed to parse npm audit output',
          timestamp: Date.now(),
          durationMs: Date.now() - start,
        });
      }
    });
  });
}
