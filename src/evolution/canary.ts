/**
 * DarwinFi Evolution Engine - Canary Deployment & Monitoring
 * Deploys proposals as canary, monitors metrics, decides rollback/promote.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { EvolutionProposal, CanaryState, CanaryMetrics } from './types';
import { PROJECT_ROOT, EVOLUTION_DATA_DIR, ROLLBACK_THRESHOLDS } from './config';

const CANARY_STATE_FILE = path.join(EVOLUTION_DATA_DIR, 'canary-state.json');
const AGENT_STATE_FILE = path.join(PROJECT_ROOT, 'data', 'agent-state.json');
const PM2_PROCESSES = ['darwinfi', 'darwinfi-instinct', 'frontier'];

function exec(cmd: string, cwd: string = PROJECT_ROOT, timeoutMs: number = 60_000): string {
  return execSync(cmd, {
    cwd,
    timeout: timeoutMs,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Read current system metrics for canary comparison.
 */
function readCurrentMetrics(): CanaryMetrics {
  const metrics: CanaryMetrics = {
    pnlDelta: 0,
    errorRate: 0,
    crashCount: 0,
    processUptime: 0,
    sharePriceDelta: 0,
  };

  // Read PnL from agent-state.json
  try {
    if (fs.existsSync(AGENT_STATE_FILE)) {
      const state = JSON.parse(fs.readFileSync(AGENT_STATE_FILE, 'utf-8'));
      const perfEntries = Object.values(state.performance || {}) as Array<{ totalPnL?: number }>;
      metrics.pnlDelta = perfEntries.reduce((sum, p) => sum + (p.totalPnL || 0), 0);
    }
  } catch { /* ignore */ }

  // Read PM2 crash count and uptime
  try {
    const pm2Output = exec('pm2 jlist 2>/dev/null');
    const processes = JSON.parse(pm2Output) as Array<{
      name: string;
      pm2_env?: { restart_time?: number; pm_uptime?: number };
    }>;

    let totalCrashes = 0;
    let minUptime = Infinity;

    for (const proc of processes) {
      if (PM2_PROCESSES.includes(proc.name)) {
        totalCrashes += proc.pm2_env?.restart_time || 0;
        const uptime = proc.pm2_env?.pm_uptime
          ? (Date.now() - proc.pm2_env.pm_uptime) / 1000
          : 0;
        if (uptime < minUptime) minUptime = uptime;
      }
    }

    metrics.crashCount = totalCrashes;
    metrics.processUptime = minUptime === Infinity ? 0 : minUptime;
  } catch { /* ignore */ }

  // Read error rate from immune logs
  try {
    const immuneLogPath = path.join(PROJECT_ROOT, 'data', 'immune', 'health-log.json');
    if (fs.existsSync(immuneLogPath)) {
      const logContent = fs.readFileSync(immuneLogPath, 'utf-8');
      const logs = JSON.parse(logContent);
      const tenMinAgo = Date.now() - 10 * 60_000;
      const recentErrors = Array.isArray(logs)
        ? logs.filter((l: { timestamp?: number; severity?: string }) =>
            l.timestamp && l.timestamp > tenMinAgo &&
            (l.severity === 'error' || l.severity === 'critical'))
        : [];
      metrics.errorRate = recentErrors.length / 10; // errors per minute
    }
  } catch { /* ignore */ }

  return metrics;
}

/**
 * Start a canary deployment by merging the proposal branch and reloading PM2.
 */
export async function startCanary(
  proposal: EvolutionProposal,
  branch: string,
): Promise<CanaryState> {
  const shortId = proposal.id.slice(0, 8);
  console.log(`[Evolution] Starting canary deployment for ${shortId} (branch: ${branch})`);

  // Record baseline metrics before merge
  const baselineMetrics = readCurrentMetrics();

  // Merge the evolution branch into working tree
  exec(`git merge "${branch}" --no-edit`, PROJECT_ROOT);

  // Recompile TypeScript
  exec('npx tsc', PROJECT_ROOT, 120_000);

  // Reload affected PM2 processes
  for (const proc of PM2_PROCESSES) {
    try {
      exec(`pm2 reload ${proc}`);
    } catch {
      console.error(`[Evolution] Failed to reload PM2 process: ${proc}`);
    }
  }

  const state: CanaryState = {
    active: true,
    startedAt: Date.now(),
    proposalId: proposal.id,
    branch,
    baselineMetrics,
    currentMetrics: baselineMetrics,
    checkCount: 0,
    lastCheckAt: Date.now(),
  };

  saveCanaryState(state);
  console.log(`[Evolution] Canary ${shortId} deployed, monitoring started`);
  return state;
}

/**
 * Check canary health by reading current metrics and comparing to baseline.
 */
export async function checkCanary(state: CanaryState): Promise<CanaryState> {
  const currentMetrics = readCurrentMetrics();

  state.currentMetrics = currentMetrics;
  state.checkCount += 1;
  state.lastCheckAt = Date.now();

  saveCanaryState(state);

  const shortId = state.proposalId.slice(0, 8);
  console.log(
    `[Evolution] Canary check #${state.checkCount} for ${shortId}: ` +
    `PnL delta=${(currentMetrics.pnlDelta - state.baselineMetrics.pnlDelta).toFixed(4)}, ` +
    `errors/min=${currentMetrics.errorRate.toFixed(2)}, ` +
    `crashes=${currentMetrics.crashCount - state.baselineMetrics.crashCount}`,
  );

  return state;
}

/**
 * Determine if canary should be rolled back based on thresholds.
 */
export function shouldRollback(
  state: CanaryState,
  thresholds: typeof ROLLBACK_THRESHOLDS = ROLLBACK_THRESHOLDS,
): { rollback: boolean; reason: string } {
  const baseline = state.baselineMetrics;
  const current = state.currentMetrics;

  // PnL drop check (as fraction of TVL)
  const pnlDrop = current.pnlDelta - baseline.pnlDelta;
  if (pnlDrop < thresholds.maxPnlDropPct) {
    return {
      rollback: true,
      reason: `PnL dropped ${(pnlDrop * 100).toFixed(2)}% (threshold: ${(thresholds.maxPnlDropPct * 100).toFixed(2)}%)`,
    };
  }

  // Error rate increase check
  const errorRateIncrease = baseline.errorRate > 0
    ? (current.errorRate - baseline.errorRate) / baseline.errorRate
    : current.errorRate > 0 ? 1 : 0;
  if (errorRateIncrease > thresholds.maxErrorRateIncreasePct) {
    return {
      rollback: true,
      reason: `Error rate increased ${(errorRateIncrease * 100).toFixed(1)}% (threshold: ${(thresholds.maxErrorRateIncreasePct * 100).toFixed(1)}%)`,
    };
  }

  // Crash count check (delta since canary start)
  const crashDelta = current.crashCount - baseline.crashCount;
  if (crashDelta >= thresholds.maxCrashesIn10Min) {
    return {
      rollback: true,
      reason: `${crashDelta} crashes since canary start (threshold: ${thresholds.maxCrashesIn10Min})`,
    };
  }

  return { rollback: false, reason: 'Metrics within thresholds' };
}

/**
 * Check if canary has run long enough.
 */
export function isCanaryComplete(state: CanaryState, minDuration: number): boolean {
  const elapsed = Date.now() - state.startedAt;
  return elapsed >= minDuration;
}

/**
 * Load persisted canary state from disk.
 */
export function loadCanaryState(): CanaryState | null {
  try {
    if (!fs.existsSync(CANARY_STATE_FILE)) return null;
    const raw = fs.readFileSync(CANARY_STATE_FILE, 'utf-8').trim();
    if (!raw || raw === 'null') return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.active) return null;
    return parsed as CanaryState;
  } catch {
    return null;
  }
}

/**
 * Save canary state to disk (atomic write).
 */
export function saveCanaryState(state: CanaryState | null): void {
  if (!fs.existsSync(EVOLUTION_DATA_DIR)) {
    fs.mkdirSync(EVOLUTION_DATA_DIR, { recursive: true });
  }
  const tmpPath = CANARY_STATE_FILE + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmpPath, CANARY_STATE_FILE);
}

/**
 * Clear canary state (after rollback or promotion).
 */
export function clearCanaryState(): void {
  saveCanaryState(null);
}
