/**
 * DarwinFi Immune System - Instinct Patrol
 *
 * Reads predictions-live.json and validates the Instinct layer's health
 * indicators: active senses, active reflexes, overall confidence.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CheckResult, CheckSeverity } from '../types';
import { MONITORED_STATE_FILES, THRESHOLDS, PROJECT_ROOT } from '../config';

export async function checkInstinctHealth(): Promise<CheckResult> {
  const start = Date.now();
  const filePath = path.join(PROJECT_ROOT, MONITORED_STATE_FILES.predictionsLive);

  try {
    if (!fs.existsSync(filePath)) {
      return {
        checkId: 'instinct_health',
        category: 'instinct',
        severity: 'error',
        message: 'predictions-live.json not found',
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      };
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    const health = data.health;

    if (!health) {
      return {
        checkId: 'instinct_health',
        category: 'instinct',
        severity: 'error',
        message: 'predictions-live.json missing health object',
        timestamp: Date.now(),
        durationMs: Date.now() - start,
        details: { keys: Object.keys(data) },
      };
    }

    const issues: string[] = [];
    const details: Record<string, unknown> = {
      sensesActive: health.sensesActive,
      reflexesActive: health.reflexesActive,
      overallConfidence: health.overallConfidence,
    };

    if ((health.sensesActive ?? 0) < THRESHOLDS.minActiveSourcesOrStrategies) {
      issues.push(`sensesActive=${health.sensesActive ?? 0}<${THRESHOLDS.minActiveSourcesOrStrategies}`);
    }

    if ((health.reflexesActive ?? 0) < THRESHOLDS.minActiveSourcesOrStrategies) {
      issues.push(`reflexesActive=${health.reflexesActive ?? 0}<${THRESHOLDS.minActiveSourcesOrStrategies}`);
    }

    if ((health.overallConfidence ?? 0) < THRESHOLDS.minConfidenceFloor) {
      issues.push(`confidence=${health.overallConfidence ?? 0}%<${THRESHOLDS.minConfidenceFloor}%`);
    }

    if (issues.length === 0) {
      return {
        checkId: 'instinct_health',
        category: 'instinct',
        severity: 'ok',
        message: `Instinct healthy: ${health.sensesActive} senses, ${health.reflexesActive} reflexes, ${health.overallConfidence}% confidence`,
        timestamp: Date.now(),
        durationMs: Date.now() - start,
        details,
      };
    }

    let severity: CheckSeverity = 'warning';
    if ((health.sensesActive ?? 0) === 0 && (health.reflexesActive ?? 0) === 0) {
      severity = 'critical';
    }

    return {
      checkId: 'instinct_health',
      category: 'instinct',
      severity,
      message: issues.join(', '),
      timestamp: Date.now(),
      durationMs: Date.now() - start,
      details,
    };
  } catch (err) {
    return {
      checkId: 'instinct_health',
      category: 'instinct',
      severity: 'critical',
      message: `Instinct check failed: ${err instanceof Error ? err.message : err}`,
      timestamp: Date.now(),
      durationMs: Date.now() - start,
    };
  }
}
