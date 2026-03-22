/**
 * DarwinFi Immune System - Safe Fix Functions
 *
 * Each function returns Promise<boolean>: true = fix succeeded, false = failed.
 * These are pre-approved, low-risk remediation actions that the fix engine
 * can apply automatically without human approval.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { RPC_ENDPOINTS, MONITORED_STATE_FILES, MONITORED_PROCESSES, PROJECT_ROOT, THRESHOLDS } from '../config';

const PREFIX = '[Immune:Platelets]';
const ECOSYSTEM_CONFIG = path.join(PROJECT_ROOT, 'ecosystem.config.js');

/**
 * Start a stopped/missing PM2 process.
 * If the process exists in PM2 (stopped/errored): restarts it.
 * If not in PM2: starts it from ecosystem.config.js.
 */
export async function pm2Start(processName: string): Promise<boolean> {
  try {
    const raw = execSync('pm2 jlist', { encoding: 'utf-8', timeout: 10000 });
    const processes = JSON.parse(raw);
    const existing = processes.find((p: any) => p.name === processName);

    if (existing) {
      // Process exists in PM2 (stopped/errored) -- restart it
      execSync(`pm2 restart ${processName}`, { timeout: 15_000, stdio: 'pipe' });
      console.log(`${PREFIX} pm2 restart ${processName} succeeded (was ${existing.pm2_env?.status})`);
      return true;
    }

    // Not in PM2 -- start from ecosystem config
    if (!fs.existsSync(ECOSYSTEM_CONFIG)) {
      console.error(`${PREFIX} Cannot start ${processName}: ecosystem.config.js not found`);
      return false;
    }
    execSync(`pm2 start ${ECOSYSTEM_CONFIG} --only ${processName}`, {
      timeout: 15_000,
      stdio: 'pipe',
    });
    console.log(`${PREFIX} pm2 start ${processName} from ecosystem.config.js succeeded`);
    return true;
  } catch (err) {
    console.error(`${PREFIX} pm2 start ${processName} failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

/**
 * Restart a PM2 process by name.
 */
export async function pm2Restart(processName: string): Promise<boolean> {
  try {
    execSync(`pm2 restart ${processName}`, {
      timeout: 15_000,
      stdio: 'pipe',
    });
    console.log(`${PREFIX} pm2 restart ${processName} succeeded`);
    return true;
  } catch (err) {
    console.error(`${PREFIX} pm2 restart ${processName} failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

/**
 * Rotate BASE_RPC_URL to the next endpoint in the RPC_ENDPOINTS list.
 * Updates process.env in memory only (writing .env is risky).
 */
export async function rpcRotation(): Promise<boolean> {
  try {
    const current = process.env.BASE_RPC_URL || '';
    const endpoints: string[] = Array.from(RPC_ENDPOINTS);
    const currentIndex = endpoints.indexOf(current);
    const nextIndex = (currentIndex + 1) % endpoints.length;
    const next = endpoints[nextIndex];

    process.env.BASE_RPC_URL = next;
    console.log(`${PREFIX} RPC rotated: ${current || '(unset)'} -> ${next}`);
    return true;
  } catch (err) {
    console.error(`${PREFIX} RPC rotation failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

/**
 * Rebuild agent state from .tmp backup if it exists, or repair corrupt state in-place.
 */
export async function stateRebuild(): Promise<boolean> {
  try {
    const statePath = path.join(PROJECT_ROOT, MONITORED_STATE_FILES.agentState);
    const tmpPath = statePath + '.tmp';

    // Path A: .tmp backup exists -- validate and rename (original behavior)
    if (fs.existsSync(tmpPath)) {
      const raw = fs.readFileSync(tmpPath, 'utf-8');
      JSON.parse(raw); // throws if invalid
      fs.renameSync(tmpPath, statePath);
      console.log(`${PREFIX} State rebuilt from ${tmpPath}`);
      await pm2Restart('darwinfi');
      return true;
    }

    // Path B: No .tmp -- check the current state file
    const SKELETON_STATE = {
      strategies: [],
      performance: {},
      config: {},
      version: 1,
      updatedAt: Date.now(),
    };

    if (!fs.existsSync(statePath)) {
      // State file missing entirely -- write skeleton
      fs.writeFileSync(statePath, JSON.stringify(SKELETON_STATE, null, 2), 'utf-8');
      console.log(`${PREFIX} State file missing, wrote skeleton state`);
      await pm2Restart('darwinfi');
      return true;
    }

    // State file exists -- check if it's valid JSON
    const raw = fs.readFileSync(statePath, 'utf-8');
    try {
      JSON.parse(raw);
      // Valid JSON -- the check was triggered but state is readable, return true
      console.log(`${PREFIX} State file is valid JSON, no rebuild needed`);
      return true;
    } catch {
      // Corrupt JSON -- write skeleton state
      console.log(`${PREFIX} State file is corrupt JSON, writing skeleton state`);
      fs.writeFileSync(statePath, JSON.stringify(SKELETON_STATE, null, 2), 'utf-8');
      await pm2Restart('darwinfi');
      return true;
    }
  } catch (err) {
    console.error(`${PREFIX} State rebuild failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

/**
 * Clear Hardhat cache and recompile contracts.
 */
export async function hardhatCacheClear(): Promise<boolean> {
  try {
    execSync('rm -rf cache/ artifacts/ && npx hardhat compile', {
      cwd: PROJECT_ROOT,
      timeout: 60_000,
      stdio: 'pipe',
    });
    console.log(`${PREFIX} Hardhat cache cleared and recompiled`);
    return true;
  } catch (err) {
    console.error(`${PREFIX} Hardhat cache clear failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

/**
 * Recompute key metrics (totalPnL, winRate) from tradeHistory and write corrected values.
 */
export async function mathRecompute(): Promise<boolean> {
  try {
    const statePath = path.join(PROJECT_ROOT, MONITORED_STATE_FILES.agentState);
    const raw = fs.readFileSync(statePath, 'utf-8');
    const state = JSON.parse(raw);

    const performance: Record<string, any> = state.performance || {};
    let corrected = 0;

    for (const [sid, perf] of Object.entries(performance)) {
      const trades: any[] = (perf as any).tradeHistory || [];
      const closed = trades.filter((t: any) => t.status === 'closed' && t.pnl !== undefined);

      // Recompute totalPnL
      const computedPnL = closed.reduce((sum: number, t: any) => sum + t.pnl, 0);
      if (Math.abs((perf as any).totalPnL - computedPnL) > 0.001) {
        (perf as any).totalPnL = computedPnL;
        corrected++;
      }

      // Recompute winRate
      const computedWinRate = closed.length > 0
        ? closed.filter((t: any) => t.pnl > 0).length / closed.length
        : 0;
      if (Math.abs((perf as any).winRate - computedWinRate) > 0.001) {
        (perf as any).winRate = computedWinRate;
        corrected++;
      }

      // Recompute tradesCompleted
      if ((perf as any).tradesCompleted !== closed.length) {
        (perf as any).tradesCompleted = closed.length;
        corrected++;
      }
    }

    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
    console.log(`${PREFIX} Math recompute: corrected ${corrected} metric(s)`);
    return true;
  } catch (err) {
    console.error(`${PREFIX} Math recompute failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

/**
 * Repair state invariant violations: prune stale trades, ensure perf entries exist.
 */
export async function stateInvariantRepair(): Promise<boolean> {
  try {
    const statePath = path.join(PROJECT_ROOT, MONITORED_STATE_FILES.agentState);
    const raw = fs.readFileSync(statePath, 'utf-8');
    const state = JSON.parse(raw);

    const strategies: any[] = state.strategies || [];
    const performance: Record<string, any> = state.performance || {};
    const maxTradeAgeMs = THRESHOLDS.maxTradeAgeHours * 60 * 60 * 1000;
    const now = Date.now();
    let repairs = 0;

    // Prune stale open trades (>48h) by marking them as closed with pnl: 0
    for (const [sid, perf] of Object.entries(performance)) {
      const trades: any[] = (perf as any).tradeHistory || [];
      for (const trade of trades) {
        if (trade.status === 'open' && trade.entryTime) {
          const entryMs = new Date(trade.entryTime).getTime();
          if (now - entryMs > maxTradeAgeMs) {
            trade.status = 'closed';
            trade.pnl = 0;
            trade.exitTime = new Date().toISOString();
            trade.exitReason = 'stale_trade_pruned_by_immune';
            repairs++;
          }
        }
      }
    }

    // Ensure all strategies have performance entries
    for (const strategy of strategies) {
      if (strategy.id && !performance[strategy.id]) {
        performance[strategy.id] = {
          totalPnL: 0,
          winRate: 0,
          sharpeRatio: 0,
          maxDrawdown: 0,
          tradesCompleted: 0,
          rolling24hPnL: 0,
          rolling24hSharpe: 0,
          rolling24hWinRate: 0,
          tradeHistory: [],
        };
        repairs++;
      }
    }

    // Ensure required top-level fields exist
    if (!state.version) { state.version = 1; repairs++; }
    if (!state.updatedAt) { state.updatedAt = now; repairs++; }
    if (!state.config) { state.config = {}; repairs++; }

    state.performance = performance;
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
    console.log(`${PREFIX} State invariant repair: ${repairs} repair(s) applied`);
    return true;
  } catch (err) {
    console.error(`${PREFIX} State invariant repair failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

/**
 * Restart all non-immune PM2 processes to fix integration mismatches.
 */
export async function integrationRestart(): Promise<boolean> {
  try {
    let successes = 0;
    for (const proc of MONITORED_PROCESSES) {
      if (proc.name === 'darwinfi-immune') continue;
      const ok = await pm2Restart(proc.name);
      if (ok) successes++;
    }
    console.log(`${PREFIX} Integration restart: ${successes}/${MONITORED_PROCESSES.length - 1} processes restarted`);
    return successes > 0;
  } catch (err) {
    console.error(`${PREFIX} Integration restart failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

/**
 * Restart the darwinfi process (dashboard/API server) to fix UI truth mismatches.
 */
export async function dashboardRestart(): Promise<boolean> {
  try {
    const ok = await pm2Restart('darwinfi');
    console.log(`${PREFIX} Dashboard restart: ${ok ? 'succeeded' : 'failed'}`);
    return ok;
  } catch (err) {
    console.error(`${PREFIX} Dashboard restart failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}
