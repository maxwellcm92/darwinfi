/**
 * DarwinFi Immune System - State Patrol
 *
 * Checks monitored state files for existence, valid JSON, and freshness
 * (savedAt / generatedAt within threshold).
 */

import * as fs from 'fs';
import * as path from 'path';
import { CheckResult, CheckSeverity } from '../types';
import { MONITORED_STATE_FILES, THRESHOLDS, PROJECT_ROOT } from '../config';

interface FileCheckResult {
  file: string;
  exists: boolean;
  validJson: boolean;
  ageMinutes?: number;
  error?: string;
}

function checkFile(relPath: string): FileCheckResult {
  const fullPath = path.join(PROJECT_ROOT, relPath);

  if (!fs.existsSync(fullPath)) {
    return { file: relPath, exists: false, validJson: false, error: 'file missing' };
  }

  let data: any;
  try {
    const raw = fs.readFileSync(fullPath, 'utf-8');
    data = JSON.parse(raw);
  } catch (err) {
    return { file: relPath, exists: true, validJson: false, error: 'invalid JSON' };
  }

  // Check freshness via savedAt or generatedAt
  const timestamp = data.savedAt || data.generatedAt;
  if (!timestamp) {
    return { file: relPath, exists: true, validJson: true, error: 'no savedAt/generatedAt field' };
  }

  const ageMs = Date.now() - timestamp;
  const ageMinutes = ageMs / 60_000;

  if (ageMinutes > THRESHOLDS.maxStateAgeMins) {
    return { file: relPath, exists: true, validJson: true, ageMinutes, error: `stale ${ageMinutes.toFixed(1)}min>${THRESHOLDS.maxStateAgeMins}min` };
  }

  return { file: relPath, exists: true, validJson: true, ageMinutes };
}

export async function checkStateFiles(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const files = Object.values(MONITORED_STATE_FILES);
    const results = files.map(checkFile);
    const failures = results.filter((r) => r.error);

    if (failures.length === 0) {
      return {
        checkId: 'state_integrity',
        category: 'state',
        severity: 'ok',
        message: `All ${results.length} state files valid and fresh`,
        timestamp: Date.now(),
        durationMs: Date.now() - start,
        details: { files: results },
      };
    }

    // Determine severity: missing file = critical, stale/invalid = warning
    let severity: CheckSeverity = 'warning';
    if (failures.some((f) => !f.exists || !f.validJson)) {
      severity = 'error';
    }

    const issues = failures.map((f) => `${f.file}: ${f.error}`).join('; ');
    return {
      checkId: 'state_integrity',
      category: 'state',
      severity,
      message: `${failures.length}/${results.length} issues: ${issues}`,
      timestamp: Date.now(),
      durationMs: Date.now() - start,
      details: { files: results },
    };
  } catch (err) {
    return {
      checkId: 'state_integrity',
      category: 'state',
      severity: 'critical',
      message: `State check failed: ${err instanceof Error ? err.message : err}`,
      timestamp: Date.now(),
      durationMs: Date.now() - start,
    };
  }
}
