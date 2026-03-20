/**
 * DarwinFi Evolution Engine - Static Validator
 * Validates proposals against mutability rings, forbidden patterns,
 * and velocity/size limits before any code is applied.
 */

import { minimatch } from 'minimatch';
import { EvolutionProposal, ValidationResult } from './types';
import { FILE_RINGS, FORBIDDEN_PATTERNS, VELOCITY_LIMITS } from './config';

/**
 * Parse a unified diff to extract which lines are added vs modified/deleted.
 * Returns counts and the set of added-only lines (for additive ring check).
 */
function parseDiffStats(diff: string): {
  linesAdded: number;
  linesModified: number;
  addedLines: string[];
  removedLines: string[];
} {
  const lines = diff.split('\n');
  const addedLines: string[] = [];
  const removedLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) {
      addedLines.push(line.slice(1));
    } else if (line.startsWith('-')) {
      removedLines.push(line.slice(1));
    }
  }

  return {
    linesAdded: addedLines.length,
    linesModified: removedLines.length,
    addedLines,
    removedLines,
  };
}

/**
 * Check if a file path matches any ring pattern and return its ring.
 * Files not matching any pattern default to 'immutable' (safe default).
 */
function getFileRing(filePath: string): { ring: 'immutable' | 'evolvable' | 'additive'; description: string } {
  for (const mapping of FILE_RINGS) {
    if (minimatch(filePath, mapping.pattern)) {
      return { ring: mapping.ring, description: mapping.description };
    }
  }
  // Default: immutable (unknown files cannot be touched)
  return { ring: 'immutable', description: 'Unknown file (default immutable)' };
}

/**
 * Check if a diff is purely additive (only adds new lines, no modifications or deletions).
 * For Ring 2 (additive) files, we require that the diff does not remove any lines.
 */
function isDiffAdditiveOnly(diff: string): boolean {
  const { removedLines } = parseDiffStats(diff);
  // Filter out empty lines from removed (diff artifacts)
  const meaningfulRemovals = removedLines.filter(l => l.trim().length > 0);
  return meaningfulRemovals.length === 0;
}

/**
 * Validate a proposal against all static checks.
 */
export function validateProposal(proposal: EvolutionProposal): ValidationResult {
  const ringViolations: string[] = [];
  const forbiddenPatterns: string[] = [];
  const sizeViolations: string[] = [];
  const errors: string[] = [];

  // 1. Check each target file against ring permissions
  for (const file of proposal.targetFiles) {
    const { ring, description } = getFileRing(file);

    if (ring === 'immutable') {
      ringViolations.push(`${file} is IMMUTABLE (${description})`);
    } else if (ring === 'additive') {
      // For additive files, verify the diff only adds
      if (!isDiffAdditiveOnly(proposal.diff)) {
        ringViolations.push(
          `${file} is ADDITIVE-ONLY (${description}) but diff modifies/deletes existing lines`,
        );
      }
    }
    // 'evolvable' files pass ring check
  }

  // 2. Scan diff for forbidden patterns
  for (const { pattern, description } of FORBIDDEN_PATTERNS) {
    if (pattern.test(proposal.diff)) {
      forbiddenPatterns.push(`Forbidden pattern detected: ${description}`);
    }
  }

  // 3. Check diff size against velocity limits
  const stats = parseDiffStats(proposal.diff);

  if (stats.linesAdded > VELOCITY_LIMITS.maxDiffLinesAdded) {
    sizeViolations.push(
      `Lines added (${stats.linesAdded}) exceeds limit (${VELOCITY_LIMITS.maxDiffLinesAdded})`,
    );
  }

  if (stats.linesModified > VELOCITY_LIMITS.maxDiffLinesModified) {
    sizeViolations.push(
      `Lines modified (${stats.linesModified}) exceeds limit (${VELOCITY_LIMITS.maxDiffLinesModified})`,
    );
  }

  if (proposal.targetFiles.length > VELOCITY_LIMITS.maxFilesPerProposal) {
    sizeViolations.push(
      `Files changed (${proposal.targetFiles.length}) exceeds limit (${VELOCITY_LIMITS.maxFilesPerProposal})`,
    );
  }

  // 4. Basic sanity checks
  if (!proposal.diff || proposal.diff.trim().length === 0) {
    errors.push('Proposal has empty diff');
  }

  if (proposal.targetFiles.length === 0) {
    errors.push('Proposal has no target files');
  }

  const passed =
    ringViolations.length === 0 &&
    forbiddenPatterns.length === 0 &&
    sizeViolations.length === 0 &&
    errors.length === 0;

  return { passed, ringViolations, forbiddenPatterns, sizeViolations, errors };
}
