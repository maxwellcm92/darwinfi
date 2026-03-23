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

export function parseSearchReplaceBlocks(diff: string): SearchReplaceBlock[] {
  const blocks: SearchReplaceBlock[] = [];
  const regex = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
  let match;
  while ((match = regex.exec(diff)) !== null) {
    blocks.push({ search: match[1], replace: match[2] });
  }
  return blocks;
}

/**
 * Parse a SEARCH/REPLACE diff string that includes `// File: path` comments.
 * Returns a Map of file path -> blocks, or null if no file comments found.
 */
export function parsePerFileBlocks(diff: string): Map<string, SearchReplaceBlock[]> | null {
  if (!diff.includes('// File: ')) return null;

  const fileBlocks = new Map<string, SearchReplaceBlock[]>();
  let currentFile: string | null = null;

  // Split by file comment markers
  const lines = diff.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fileMatch = line.match(/^\/\/ File: (.+)$/);
    if (fileMatch) {
      currentFile = fileMatch[1].trim();
      if (!fileBlocks.has(currentFile)) {
        fileBlocks.set(currentFile, []);
      }
      i++;
      continue;
    }
    i++;
  }

  // Now parse blocks and associate with files using position
  const blockRegex = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
  const fileCommentRegex = /\/\/ File: (.+)/g;

  // Find all file comment positions
  const filePositions: { file: string; pos: number }[] = [];
  let fcMatch;
  while ((fcMatch = fileCommentRegex.exec(diff)) !== null) {
    filePositions.push({ file: fcMatch[1].trim(), pos: fcMatch.index });
  }

  if (filePositions.length === 0) return null;

  // Reset map
  fileBlocks.clear();

  let blockMatch;
  while ((blockMatch = blockRegex.exec(diff)) !== null) {
    // Find which file this block belongs to (last file comment before this block)
    let ownerFile = filePositions[0].file;
    for (const fp of filePositions) {
      if (fp.pos < blockMatch.index) {
        ownerFile = fp.file;
      } else {
        break;
      }
    }
    if (!fileBlocks.has(ownerFile)) {
      fileBlocks.set(ownerFile, []);
    }
    fileBlocks.get(ownerFile)!.push({
      search: blockMatch[1],
      replace: blockMatch[2],
    });
  }

  return fileBlocks.size > 0 ? fileBlocks : null;
}

/**
 * Convert a unified diff (from Venice AI) into per-file SEARCH/REPLACE blocks.
 * Venice outputs standard `--- a/file` / `+++ b/file` / `@@ ... @@` diffs,
 * but the sandbox expects `<<<<<<< SEARCH` / `=======` / `>>>>>>> REPLACE` blocks.
 *
 * Returns a Map of file path -> SearchReplaceBlock[], or null if no blocks found.
 * File paths are stripped of the `a/` and `b/` prefixes from unified diff headers.
 */
export function convertUnifiedToSearchReplace(
  diff: string,
  fileContents: Record<string, string>,
): Map<string, SearchReplaceBlock[]> | null {
  const lines = diff.split('\n');
  const fileBlocks = new Map<string, SearchReplaceBlock[]>();
  let currentFile: string | null = null;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Track file path from unified diff headers
    if (line.startsWith('+++ b/')) {
      currentFile = line.substring(6).trim();
      i++;
      continue;
    }
    if (line.startsWith('--- a/') || line.startsWith('--- /dev/null')) {
      // Skip --- header (we use +++ for the target file path)
      i++;
      continue;
    }
    if (line.startsWith('\\ No newline at end of file')) {
      i++;
      continue;
    }

    // Process hunk
    if (line.startsWith('@@')) {
      const searchLines: string[] = [];
      const replaceLines: string[] = [];
      i++; // skip the @@ line

      while (i < lines.length) {
        const hunkLine = lines[i];
        // Stop at next hunk, next file, or diff boundary
        if (hunkLine.startsWith('@@') || hunkLine.startsWith('diff ') ||
            hunkLine.startsWith('--- ') || hunkLine.startsWith('+++ ')) {
          break;
        }
        // Skip "no newline" markers
        if (hunkLine.startsWith('\\ No newline at end of file')) {
          i++;
          continue;
        }
        if (hunkLine.startsWith('-')) {
          // Removed line: goes in SEARCH only
          searchLines.push(hunkLine.substring(1));
        } else if (hunkLine.startsWith('+')) {
          // Added line: goes in REPLACE only
          replaceLines.push(hunkLine.substring(1));
        } else if (hunkLine.startsWith(' ')) {
          // Context line (starts with space): goes in both
          searchLines.push(hunkLine.substring(1));
          replaceLines.push(hunkLine.substring(1));
        } else if (hunkLine === '') {
          // Empty line in unified diff = empty context line in source
          searchLines.push('');
          replaceLines.push('');
        }
        i++;
      }

      if (searchLines.length > 0 || replaceLines.length > 0) {
        const block: SearchReplaceBlock = {
          search: searchLines.join('\n'),
          replace: replaceLines.join('\n'),
        };
        const filePath = currentFile || '__unknown__';
        if (!fileBlocks.has(filePath)) {
          fileBlocks.set(filePath, []);
        }
        fileBlocks.get(filePath)!.push(block);
      }
    } else {
      i++;
    }
  }

  if (fileBlocks.size === 0) {
    return null;
  }

  return fileBlocks;
}

/**
 * Convert a per-file block map into a flat SEARCH/REPLACE string with file comments.
 * This preserves compatibility with parseSearchReplaceBlocks() and proposal.diff format.
 */
export function fileBlockMapToString(fileBlocks: Map<string, SearchReplaceBlock[]>): string {
  const parts: string[] = [];
  for (const [filePath, blocks] of fileBlocks) {
    parts.push(`// File: ${filePath}`);
    for (const block of blocks) {
      parts.push(
        '<<<<<<< SEARCH\n' +
        block.search +
        '\n=======\n' +
        block.replace +
        '\n>>>>>>> REPLACE',
      );
    }
  }
  return parts.join('\n\n');
}

function applySearchReplace(fileContent: string, blocks: SearchReplaceBlock[]): string {
  let result = fileContent;
  for (const block of blocks) {
    if (result.includes(block.search)) {
      result = result.replace(block.search, block.replace);
      continue;
    }
    // Fuzzy fallback: normalize trailing whitespace per line
    const normalizeWs = (s: string) => s.split('\n').map(l => l.trimEnd()).join('\n');
    const normalizedResult = normalizeWs(result);
    const normalizedSearch = normalizeWs(block.search);
    if (normalizedResult.includes(normalizedSearch)) {
      const idx = normalizedResult.indexOf(normalizedSearch);
      const lines = result.split('\n');
      const normalizedLines = normalizedResult.split('\n');
      let charCount = 0;
      let startLine = 0;
      for (let i = 0; i < normalizedLines.length; i++) {
        if (charCount + normalizedLines[i].length >= idx) {
          startLine = i;
          break;
        }
        charCount += normalizedLines[i].length + 1;
      }
      const searchLineCount = block.search.split('\n').length;
      const originalChunk = lines.slice(startLine, startLine + searchLineCount).join('\n');
      result = result.replace(originalChunk, block.replace);
      console.log(`[Evolution] Fuzzy match applied (whitespace-normalized) for block: ${block.search.substring(0, 60)}...`);
      continue;
    }
    // Diagnostic logging before throwing
    const searchLines = block.search.split('\n');
    console.error(`[Evolution] SEARCH block match failed. First 3 lines of SEARCH:`);
    searchLines.slice(0, 3).forEach((l, i) => console.error(`  ${i}: "${l}"`));
    // Find first mismatch character
    for (let ci = 0; ci < Math.min(result.length, block.search.length); ci++) {
      if (result[ci] !== block.search[ci]) {
        console.error(`[Evolution] First char mismatch at index ${ci}: expected '${block.search[ci]}' (${block.search.charCodeAt(ci)}), got '${result[ci]}' (${result.charCodeAt(ci)})`);
        break;
      }
    }
    throw new Error(`SEARCH block not found in file (exact and fuzzy failed): ${block.search.substring(0, 80)}...`);
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

    // Check if proposal has per-file block comments (from unified diff conversion)
    const perFileBlocks = parsePerFileBlocks(proposal.diff);

    if (perFileBlocks && perFileBlocks.size > 0) {
      // Per-file SEARCH/REPLACE blocks: apply each file's blocks only to that file
      let totalBlocks = 0;
      for (const b of perFileBlocks.values()) totalBlocks += b.length;
      console.log(`[Evolution] Applying ${totalBlocks} per-file SEARCH/REPLACE block(s) across ${perFileBlocks.size} file(s) for ${shortId}`);
      try {
        for (const [targetFile, fileSpecificBlocks] of perFileBlocks) {
          const filePath = path.join(worktreeDir, targetFile);
          if (!fs.existsSync(filePath)) {
            throw new Error(`Target file not found: ${targetFile}`);
          }
          const content = fs.readFileSync(filePath, 'utf-8');
          const updated = applySearchReplace(content, fileSpecificBlocks);
          fs.writeFileSync(filePath, updated, 'utf-8');
        }
      } catch (applyErr) {
        const errMsg = applyErr instanceof Error ? applyErr.message : String(applyErr);
        result.compilationErrors.push(`SEARCH/REPLACE apply failed: ${errMsg}`);
        result.compilationOutput = errMsg;
        console.error(`[Evolution] SEARCH/REPLACE apply failed for ${shortId}:`, errMsg.slice(0, 200));
        return result;
      }
    } else if (blocks.length > 0) {
      // Flat SEARCH/REPLACE blocks (no per-file comments): apply to all target files
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
      console.error(`[Evolution] Diff format unrecognized. Total length: ${proposal.diff.length}, first 500 chars: ${proposal.diff.substring(0, 500)}`);
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
