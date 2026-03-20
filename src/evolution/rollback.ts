/**
 * DarwinFi Evolution Engine - Rollback
 * Git-based rollback to known-good state with PM2 reload.
 */

import { execSync } from 'child_process';
import { PROJECT_ROOT } from './config';
import { clearCanaryState } from './canary';
import { auditRollback } from './audit';

const PM2_PROCESSES = ['darwinfi', 'darwinfi-instinct', 'frontier'];
const ROLLBACK_TIMEOUT = 120_000; // 2 minutes

function exec(cmd: string, cwd: string = PROJECT_ROOT, timeoutMs: number = 60_000): string {
  return execSync(cmd, {
    cwd,
    timeout: timeoutMs,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Rollback to master (known-good state).
 * 1. Reset to master HEAD
 * 2. Recompile TypeScript
 * 3. Reload all affected PM2 processes
 * 4. Clear canary state
 * 5. Audit the rollback
 */
export async function rollback(proposalId: string, reason: string): Promise<void> {
  const shortId = proposalId.slice(0, 8);
  console.log(`[Evolution] ROLLBACK initiated for ${shortId}: ${reason}`);

  try {
    // Abort any in-progress merge
    try {
      exec('git merge --abort');
    } catch { /* not in a merge, ignore */ }

    // Hard reset to master (discard evolution changes)
    exec('git checkout master --force');
    exec('git reset --hard HEAD');

    // Clean up any evolution branches
    try {
      const branches = exec('git branch --list "evolution/*"').trim();
      if (branches) {
        for (const branch of branches.split('\n')) {
          const name = branch.trim();
          if (name) {
            try {
              exec(`git branch -D "${name}"`);
            } catch { /* ignore */ }
          }
        }
      }
    } catch { /* ignore */ }

    // Clean up any leftover worktrees
    try {
      exec('git worktree prune');
    } catch { /* ignore */ }

    // Recompile TypeScript from clean master
    console.log('[Evolution] Recompiling from clean master...');
    exec('npx tsc', PROJECT_ROOT, ROLLBACK_TIMEOUT);

    // Reload all affected PM2 processes
    for (const proc of PM2_PROCESSES) {
      try {
        exec(`pm2 reload ${proc}`);
        console.log(`[Evolution] Reloaded PM2 process: ${proc}`);
      } catch (err) {
        console.error(
          `[Evolution] Failed to reload ${proc}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // Clear canary state
    clearCanaryState();

    // Audit the rollback
    auditRollback(proposalId, reason);

    console.log(`[Evolution] Rollback complete for ${shortId}`);
  } catch (err) {
    console.error(
      '[Evolution] CRITICAL: Rollback failed:',
      err instanceof Error ? err.message : err,
    );
    // Even if rollback fails, clear canary state to prevent re-monitoring
    clearCanaryState();
    auditRollback(proposalId, `Rollback partially failed: ${reason}`);
    throw err;
  }
}
