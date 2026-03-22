/**
 * DarwinFi Evolution Engine - Sandbox (Git Worktree)
 * Isolates proposal testing in a separate git worktree.
 * Applies SEARCH/REPLACE mutations, runs type-check, cleans up on failure.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { EvolutionProposal, SandboxResult } from './types';
import { PROJECT_ROOT } from './config';

const SANDBOX_PREFIX = '.darwin-sandbox-';
const TSC_TIMEOUT = 120_000; // 2 minutes

interface SearchReplaceBlock {
  search: string;
  replace: string;
}

function exec(cmd: string, cwd: string, timeoutMs: number = 60_000): string {
  return execSync(cmd, {
    cwd,
    timeout: timeoutMs,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function parseSearchReplaceBlocks(diff: string): SearchReplaceBlock[] {
  const blocks: SearchReplaceBlock[] = [];
  const regex = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
  let match;
  while ((match = regex.exec(diff)) !== null) {
    blocks.push({ search: match[1], replace: match[2] });
  }
  return blocks;
}

/**
 * Convert a unified diff (from Venice AI) into SEARCH/REPLACE block format.
 * Venice outputs standard `--- a/file` / `+++ b/file` / `@@ ... @@` diffs,
 * but the sandbox expects `<<<<<<< SEARCH` / `=======` / `>>>>>>> REPLACE` blocks.
 */
export function convertUnifiedToSearchReplace(
  diff: string,
  fileContents: Record<string, string>,
): string | null {
  const lines = diff.split('\n');
  const blocks: string[] = [];

  let i = 0;
  while (i < lines.length) {
    // Skip to next hunk header
    if (lines[i].startsWith('@@')) {
      const searchLines: string[] = [];
      const replaceLines: string[] = [];
      i++; // skip the @@ line

      // Process hunk lines
      while (i < lines.length && !lines[i].startsWith('@@') && !lines[i].startsWith('diff ') && !lines[i].startsWith('--- ')) {
        const line = lines[i];
        if (line.startsWith('-')) {
          // Removed line: goes in SEARCH only
          searchLines.push(line.substring(1));
        } else if (line.startsWith('+')) {
          // Added line: goes in REPLACE only
          replaceLines.push(line.substring(1));
        } else if (line.startsWith(' ') || line === '') {
          // Context line: goes in both
          const contextLine = line.startsWith(' ') ? line.substring(1) : line;
          searchLines.push(contextLine);
          replaceLines.push(contextLine);
        }
        i++;
      }

      if (searchLines.length > 0 || replaceLines.length > 0) {
        blocks.push(
          '<<<<<<< SEARCH\n' +
          searchLines.join('\n') +
          '\n=======\n' +
          replaceLines.join('\n') +
          '\n>>>>>>> REPLACE',
        );
      }
    } else {
      i++;
    }
  }

  if (blocks.length === 0) {
    return null;
  }

  return blocks.join('\n\n');
}

function applySearchReplace(fileContent: string, blocks: SearchReplaceBlock[]): string {
  let result = fileContent;
  for (const block of blocks) {
    if (!result.includes(block.search)) {
      throw new Error(`SEARCH block not found in file: ${block.search.substring(0, 80)}...`);
    }
    result = result.replace(block.search, block.replace);
  }
  return result;
}

/**
 * Create a git worktree sandbox, apply the proposal mutations, and type-check.
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

    // Try SEARCH/REPLACE blocks first, fall back to git apply --3way
    const blocks = parseSearchReplaceBlocks(proposal.diff);

    if (blocks.length > 0) {
      // Apply SEARCH/REPLACE blocks directly to target files
      console.log(`[Evolution] Applying ${blocks.length} SEARCH/REPLACE block(s) for ${shortId}`);
      try {
        for (const targetFile of proposal.targetFiles) {
          const filePath = path.join(worktreeDir, targetFile);
          if (!fs.existsSync(filePath)) {
            throw new Error(`Target file not found: ${targetFile}`);
          }
          const content = fs.readFileSync(filePath, 'utf-8');
          const updated = applySearchReplace(content, blocks);
          fs.writeFileSync(filePath, updated, 'utf-8');
        }
      } catch (applyErr) {
        const errMsg = applyErr instanceof Error ? applyErr.message : String(applyErr);
        result.compilationErrors.push(`SEARCH/REPLACE apply failed: ${errMsg}`);
        result.compilationOutput = errMsg;
        console.error(`[Evolution] SEARCH/REPLACE apply failed for ${shortId}:`, errMsg.slice(0, 200));
        return result;
      }
    } else {
      // Check if the diff contains SEARCH/REPLACE markers that the regex missed
      // (e.g., due to whitespace differences or malformed markers)
      const hasSearchReplaceMarkers = proposal.diff.includes('<<<<<<< SEARCH') || proposal.diff.includes('>>>>>>> REPLACE');

      if (hasSearchReplaceMarkers) {
        // Diff is in SEARCH/REPLACE format but parsing failed -- try relaxed parsing
        console.log(`[Evolution] SEARCH/REPLACE markers detected but parsing failed for ${shortId}, trying relaxed parse`);

        // Relaxed regex: allow optional whitespace around markers
        const relaxedRegex = /<<<<<<<?[\s]*SEARCH\s*\n([\s\S]*?)\n={3,}\s*\n([\s\S]*?)\n>>>>>>>?[\s]*REPLACE/g;
        const relaxedBlocks: SearchReplaceBlock[] = [];
        let relaxedMatch;
        while ((relaxedMatch = relaxedRegex.exec(proposal.diff)) !== null) {
          relaxedBlocks.push({ search: relaxedMatch[1], replace: relaxedMatch[2] });
        }

        if (relaxedBlocks.length > 0) {
          console.log(`[Evolution] Relaxed parse found ${relaxedBlocks.length} block(s) for ${shortId}`);
          try {
            for (const targetFile of proposal.targetFiles) {
              const filePath = path.join(worktreeDir, targetFile);
              if (!fs.existsSync(filePath)) {
                throw new Error(`Target file not found: ${targetFile}`);
              }
              const content = fs.readFileSync(filePath, 'utf-8');
              const updated = applySearchReplace(content, relaxedBlocks);
              fs.writeFileSync(filePath, updated, 'utf-8');
            }
          } catch (applyErr) {
            const errMsg = applyErr instanceof Error ? applyErr.message : String(applyErr);
            result.compilationErrors.push(`SEARCH/REPLACE relaxed apply failed: ${errMsg}`);
            result.compilationOutput = errMsg;
            console.error(`[Evolution] SEARCH/REPLACE relaxed apply failed for ${shortId}:`, errMsg.slice(0, 200));
            return result;
          }
        } else {
          // Markers present but neither strict nor relaxed parsing found valid blocks
          const errMsg = 'Diff contains SEARCH/REPLACE markers but no valid blocks could be parsed. Cannot git apply SEARCH/REPLACE format.';
          result.compilationErrors.push(errMsg);
          result.compilationOutput = errMsg;
          console.error(`[Evolution] ${errMsg} (proposal ${shortId})`);
          return result;
        }
      } else {
        // Genuine unified diff format -- safe to use git apply
        console.log(`[Evolution] Unified diff detected, applying via git apply --3way for ${shortId}`);
        const diffPath = path.join(worktreeDir, '.evolution-proposal.patch');
        fs.writeFileSync(diffPath, proposal.diff, 'utf-8');
        try {
          exec(`git apply --3way "${diffPath}"`, worktreeDir);
        } catch (applyErr) {
          const errMsg = applyErr instanceof Error ? applyErr.message : String(applyErr);
          result.compilationErrors.push(`Unified diff apply failed: ${errMsg}`);
          result.compilationOutput = errMsg;
          console.error(`[Evolution] git apply --3way failed for ${shortId}:`, errMsg.slice(0, 200));
          return result;
        } finally {
          try { fs.unlinkSync(diffPath); } catch { /* ignore */ }
        }
      }
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
