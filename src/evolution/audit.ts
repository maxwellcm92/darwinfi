/**
 * DarwinFi Evolution Engine - Append-Only Audit Trail
 * JSONL format for reliable, parseable audit logging.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AuditEntry, ValidationResult, TestResult, EvolutionProposal } from './types';
import { EVOLUTION_DATA_DIR } from './config';

const AUDIT_FILE = path.join(EVOLUTION_DATA_DIR, 'audit.jsonl');

function ensureAuditFile(): void {
  if (!fs.existsSync(EVOLUTION_DATA_DIR)) {
    fs.mkdirSync(EVOLUTION_DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(AUDIT_FILE)) {
    fs.writeFileSync(AUDIT_FILE, '', 'utf-8');
  }
}

export function appendAudit(entry: AuditEntry): void {
  ensureAuditFile();
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(AUDIT_FILE, line, 'utf-8');
}

export function readAuditEntries(limit?: number): AuditEntry[] {
  ensureAuditFile();
  const content = fs.readFileSync(AUDIT_FILE, 'utf-8').trim();
  if (!content) return [];

  const lines = content.split('\n').filter(l => l.trim());
  const entries: AuditEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }

  if (limit && limit > 0) {
    return entries.slice(-limit);
  }
  return entries;
}

export function auditProposalCreated(proposal: EvolutionProposal): void {
  appendAudit({
    timestamp: Date.now(),
    event: 'proposal_created',
    proposalId: proposal.id,
    details: {
      targetZone: proposal.targetZone,
      targetFiles: proposal.targetFiles,
      linesAdded: proposal.linesAdded,
      linesModified: proposal.linesModified,
      filesChanged: proposal.filesChanged,
      aiModel: proposal.aiModel,
    },
  });
}

export function auditValidationResult(proposalId: string, result: ValidationResult): void {
  appendAudit({
    timestamp: Date.now(),
    event: result.passed ? 'validation_passed' : 'validation_failed',
    proposalId,
    details: {
      passed: result.passed,
      ringViolations: result.ringViolations,
      forbiddenPatterns: result.forbiddenPatterns,
      sizeViolations: result.sizeViolations,
      errors: result.errors,
    },
  });
}

export function auditSandboxResult(proposalId: string, passed: boolean, errors: string[]): void {
  appendAudit({
    timestamp: Date.now(),
    event: passed ? 'sandbox_passed' : 'sandbox_failed',
    proposalId,
    details: { passed, compilationErrors: errors },
  });
}

export function auditTestResult(proposalId: string, result: TestResult): void {
  appendAudit({
    timestamp: Date.now(),
    event: result.passed ? 'tests_passed' : 'tests_failed',
    proposalId,
    details: {
      passed: result.passed,
      totalTests: result.totalTests,
      passingTests: result.passingTests,
      failingTests: result.failingTests,
      durationMs: result.durationMs,
    },
  });
}

export function auditCanaryStarted(proposalId: string): void {
  appendAudit({
    timestamp: Date.now(),
    event: 'canary_started',
    proposalId,
    details: {},
  });
}

export function auditCanaryCheck(proposalId: string, checkCount: number, metrics: Record<string, unknown>): void {
  appendAudit({
    timestamp: Date.now(),
    event: 'canary_check',
    proposalId,
    details: { checkCount, ...metrics },
  });
}

export function auditProposalPromoted(proposalId: string): void {
  appendAudit({
    timestamp: Date.now(),
    event: 'proposal_promoted',
    proposalId,
    details: {},
  });
}

export function auditProposalRejected(proposalId: string, reason: string): void {
  appendAudit({
    timestamp: Date.now(),
    event: 'proposal_rejected',
    proposalId,
    details: { reason },
  });
}

export function auditRollback(proposalId: string, reason: string): void {
  appendAudit({
    timestamp: Date.now(),
    event: 'rollback',
    proposalId,
    details: { reason },
  });
}

export function auditCycleStarted(): void {
  appendAudit({
    timestamp: Date.now(),
    event: 'cycle_started',
    details: {},
  });
}

export function auditCycleCompleted(proposalId?: string, outcome?: string): void {
  appendAudit({
    timestamp: Date.now(),
    event: 'cycle_completed',
    proposalId,
    details: { outcome: outcome || 'no_proposal' },
  });
}
