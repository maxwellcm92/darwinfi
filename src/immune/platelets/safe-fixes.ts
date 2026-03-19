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
import { RPC_ENDPOINTS, MONITORED_STATE_FILES, PROJECT_ROOT } from '../config';
const PREFIX = '[Immune:Platelets]';

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
 * Rebuild agent state from .tmp backup if it exists.
 */
export async function stateRebuild(): Promise<boolean> {
  try {
    const statePath = path.join(PROJECT_ROOT, MONITORED_STATE_FILES.agentState);
    const tmpPath = statePath + '.tmp';

    if (!fs.existsSync(tmpPath)) {
      console.log(`${PREFIX} No .tmp backup found at ${tmpPath}, nothing to rebuild`);
      return false;
    }

    // Validate the tmp file is valid JSON before replacing
    const raw = fs.readFileSync(tmpPath, 'utf-8');
    JSON.parse(raw); // throws if invalid

    fs.renameSync(tmpPath, statePath);
    console.log(`${PREFIX} State rebuilt from ${tmpPath}`);
    return true;
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
