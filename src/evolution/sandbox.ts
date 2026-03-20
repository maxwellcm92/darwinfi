/**
 * DarwinFi Evolution Engine - Sandbox (Git Worktree)
 * Isolates proposal testing in a separate git worktree.
 * Applies diff, runs type-check, cleans up on failure.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { EvolutionProposal, SandboxResult } from './types';
import { PROJECT_ROOT } from './config';

const SANDBOX_PREFIX = '.darwin-sandbox-';
const TSC_TIMEOUT = 120_000; // 2 minutes

function exec(cmd: string, cwd: string, timeoutMs: number = 60_000): string {
  return execSync(cmd, {
    cwd,
    timeout: timeoutMs,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Create a git worktree sandbox, apply the proposal diff, and type-check.
 */
export async function createSandbox(proposal: EvolutionProposal): Promise<SandboxResult> {
  const shortId = proposal.id.slice(0, 8);
  const branchName = `evolution/${shortId}`;
  const worktreeDir = path.join(PROJECT_ROOT, `${SANDBOX_PREFIX}${shortId}`);

  const result: SandboxResult = {
    passed: false,
    worktreePath: worktreeDir,
    branch: branchName,
    compilationOutput: '',
    compilationErrors: [],
  };

  try {
    // Clean up any leftover sandbox with this name
    if (fs.existsSync(worktreeDir)) {
      cleanupSandbox(worktreeDir);
    }

    // Create git worktree with new branch based on HEAD
    console.log(`[Evolution] Creating sandbox worktree: ${worktreeDir}`);
    exec(`git worktree add "${worktreeDir}" -b "${branchName}" HEAD`, PROJECT_ROOT);

    // Write the diff to a temporary file and apply it
    const diffPath = path.join(worktreeDir, '.evolution-proposal.patch');
    fs.writeFileSync(diffPath, proposal.diff, 'utf-8');

    try {
      exec(`git apply --check "${diffPath}"`, worktreeDir);
      exec(`git apply "${diffPath}"`, worktreeDir);
    } catch (applyErr) {
      const errMsg = applyErr instanceof Error ? applyErr.message : String(applyErr);
      result.compilationErrors.push(`Diff apply failed: ${errMsg}`);
      result.compilationOutput = errMsg;
      console.error(`[Evolution] Diff apply failed for ${shortId}:`, errMsg.slice(0, 200));
      return result;
    } finally {
      // Clean up the patch file
      try { fs.unlinkSync(diffPath); } catch { /* ignore */ }
    }

    // Run TypeScript type-checking (no emit)
    console.log(`[Evolution] Type-checking sandbox ${shortId}...`);
    try {
      const tscOutput = exec('npx tsc --noEmit 2>&1', worktreeDir, TSC_TIMEOUT);
      result.compilationOutput = tscOutput;
      result.passed = true;
      console.log(`[Evolution] Sandbox ${shortId} type-check passed`);
    } catch (tscErr) {
      const errOutput = tscErr instanceof Error ? (tscErr as any).stdout || tscErr.message : String(tscErr);
      result.compilationOutput = errOutput;

      // Parse tsc errors
      const errorLines = errOutput.split('\n').filter(
        (line: string) => line.includes('error TS'),
      );
      result.compilationErrors = errorLines.slice(0, 20); // Cap at 20 errors
      console.error(`[Evolution] Sandbox ${shortId} type-check failed: ${errorLines.length} errors`);
    }

    return result;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    result.compilationErrors.push(`Sandbox creation failed: ${errMsg}`);
    result.compilationOutput = errMsg;
    console.error(`[Evolution] Sandbox creation failed for ${shortId}:`, errMsg.slice(0, 200));
    return result;
  }
}

/**
 * Remove a sandbox worktree and its branch.
 */
export function cleanupSandbox(worktreePath: string): void {
  const shortId = path.basename(worktreePath).replace(SANDBOX_PREFIX, '');
  const branchName = `evolution/${shortId}`;

  try {
    // Remove the worktree
    try {
      exec(`git worktree remove "${worktreePath}" --force`, PROJECT_ROOT);
    } catch {
      // If git worktree remove fails, try manual cleanup
      if (fs.existsSync(worktreePath)) {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
      try {
        exec(`git worktree prune`, PROJECT_ROOT);
      } catch { /* ignore */ }
    }

    // Delete the branch
    try {
      exec(`git branch -D "${branchName}"`, PROJECT_ROOT);
    } catch {
      // Branch may not exist, ignore
    }

    console.log(`[Evolution] Cleaned up sandbox: ${worktreePath}`);
  } catch (err) {
    console.error(
      `[Evolution] Failed to clean up sandbox ${worktreePath}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
