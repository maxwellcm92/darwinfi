/**
 * DarwinFi Immune System - Integration Checks (Antibody)
 *
 * Fetches GET /api/state from the dashboard and compares strategy count
 * and key fields against data/agent-state.json on disk.
 */

import * as fs from 'fs';
import * as path from 'path';
import { CheckResult } from '../types';
import { DASHBOARD_PORT, MONITORED_STATE_FILES } from '../config';

interface MismatchDetail {
  field: string;
  apiValue: unknown;
  fileValue: unknown;
}

export async function checkIntegration(): Promise<CheckResult> {
  const start = Date.now();
  const mismatches: MismatchDetail[] = [];

  try {
    // Fetch from dashboard API
    const url = `http://localhost:${DASHBOARD_PORT}/api/state`;
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });

    if (!response.ok) {
      return {
        checkId: 'antibody.integration_checks',
        category: 'integration',
        severity: 'error',
        message: `Dashboard /api/state returned HTTP ${response.status}`,
        details: { statusCode: response.status },
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      };
    }

    const apiState = await response.json() as any;

    // Read file state
    const statePath = path.resolve(process.cwd(), MONITORED_STATE_FILES.agentState);
    const raw = fs.readFileSync(statePath, 'utf-8');
    const fileState = JSON.parse(raw);

    // Compare strategy count
    const apiStrategies = apiState.strategies || [];
    const fileStrategies = fileState.strategies || [];

    if (apiStrategies.length !== fileStrategies.length) {
      mismatches.push({
        field: 'strategies.length',
        apiValue: apiStrategies.length,
        fileValue: fileStrategies.length,
      });
    }

    // Compare each strategy's key fields
    const fileStrategyMap = new Map<string, any>();
    for (const s of fileStrategies) {
      fileStrategyMap.set(s.id, s);
    }

    for (const apiStrategy of apiStrategies) {
      const fileStrategy = fileStrategyMap.get(apiStrategy.id);
      if (!fileStrategy) {
        mismatches.push({
          field: `strategy.${apiStrategy.id}`,
          apiValue: 'exists',
          fileValue: 'missing',
        });
        continue;
      }

      // Compare status
      if (apiStrategy.status !== fileStrategy.status) {
        mismatches.push({
          field: `strategy.${apiStrategy.id}.status`,
          apiValue: apiStrategy.status,
          fileValue: fileStrategy.status,
        });
      }

      // Compare generation
      if (apiStrategy.generation !== fileStrategy.generation) {
        mismatches.push({
          field: `strategy.${apiStrategy.id}.generation`,
          apiValue: apiStrategy.generation,
          fileValue: fileStrategy.generation,
        });
      }

      // Compare type
      if (apiStrategy.type !== fileStrategy.type) {
        mismatches.push({
          field: `strategy.${apiStrategy.id}.type`,
          apiValue: apiStrategy.type,
          fileValue: fileStrategy.type,
        });
      }
    }

    // Compare performance entry count
    const apiPerf = apiState.performance || {};
    const filePerf = fileState.performance || {};
    const apiPerfCount = Object.keys(apiPerf).length;
    const filePerfCount = Object.keys(filePerf).length;

    if (apiPerfCount !== filePerfCount) {
      mismatches.push({
        field: 'performance.entryCount',
        apiValue: apiPerfCount,
        fileValue: filePerfCount,
      });
    }

    // Compare per-strategy performance totals
    for (const [sid, apiP] of Object.entries(apiPerf) as [string, any][]) {
      const fileP = filePerf[sid];
      if (!fileP) {
        mismatches.push({ field: `performance.${sid}`, apiValue: 'exists', fileValue: 'missing' });
        continue;
      }

      if ((apiP as any).tradesCompleted !== fileP.tradesCompleted) {
        mismatches.push({
          field: `performance.${sid}.tradesCompleted`,
          apiValue: (apiP as any).tradesCompleted,
          fileValue: fileP.tradesCompleted,
        });
      }

      if (Math.abs(((apiP as any).totalPnL || 0) - (fileP.totalPnL || 0)) > 0.001) {
        mismatches.push({
          field: `performance.${sid}.totalPnL`,
          apiValue: (apiP as any).totalPnL,
          fileValue: fileP.totalPnL,
        });
      }
    }

    if (mismatches.length > 0) {
      return {
        checkId: 'antibody.integration_checks',
        category: 'integration',
        severity: 'error',
        message: `${mismatches.length} mismatch(es) between API and file state`,
        details: { mismatches },
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      };
    }

    return {
      checkId: 'antibody.integration_checks',
      category: 'integration',
      severity: 'ok',
      message: `API and file state consistent (${apiStrategies.length} strategies, ${apiPerfCount} perf entries)`,
      timestamp: Date.now(),
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      checkId: 'antibody.integration_checks',
      category: 'integration',
      severity: 'error',
      message: `Integration check failed: ${err.message}`,
      details: { error: err.message },
      timestamp: Date.now(),
      durationMs: Date.now() - start,
    };
  }
}
