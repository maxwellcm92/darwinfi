#!/usr/bin/env node
/**
 * DarwinFi Evolution Engine - Orchestrator
 * PM2 entry point. Runs evolution cycles every 6 hours.
 *
 * Pipeline per cycle:
 *   1. Velocity check (can we run?)
 *   2. Active canary check (monitor instead of new cycle)
 *   3. Zone selection (priority + anti-loop)
 *   4. Context assembly (file contents, metrics, failed proposals)
 *   5. AI proposal generation
 *   6. Static validation (rings, forbidden patterns, size)
 *   7. Sandbox (git worktree + tsc)
 *   8. Test gate (hardhat tests)
 *   9. Canary deployment
 *  10. Canary monitoring (60s checks, 4h minimum)
 *  11. Evaluation: promote or rollback
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { loadEvolutionConfig, EVOLUTION_ZONES, PROJECT_ROOT } from './config';
import { EvolutionProposal, EvolutionConfig } from './types';
import { loadMemory, saveMemory, canSubmitProposal, isZoneInBackoff, isDuplicate, canTargetFile, recordOutcome, incrementDailyCount, resetAllBackoffs } from './memory';
import { generateProposal, ProposalContext } from './proposal';
import { validateProposal } from './static-validator';
import { createSandbox, cleanupSandbox } from './sandbox';
import { runTests } from './test-gate';
import { startCanary, checkCanary, shouldRollback, isCanaryComplete, loadCanaryState, clearCanaryState } from './canary';
import { rollback } from './rollback';
import { auditProposalCreated, auditValidationResult, auditSandboxResult, auditTestResult, auditCanaryStarted, auditProposalPromoted, auditProposalRejected, auditRollback, auditCycleStarted, auditCycleCompleted } from './audit';
import { ContractClient } from '../chain/contract-client';

// Load environment from project root
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const LOG_PREFIX = '[Evolution]';
let shutdownRequested = false;
let cycleTimer: ReturnType<typeof setTimeout> | null = null;
let canaryMonitorTimer: ReturnType<typeof setInterval> | null = null;

// On-chain logging (optional -- only if PerformanceLog deployed)
let contractClient: ContractClient | null = null;
if (process.env.PERFORMANCE_LOG_ADDRESS) {
  try {
    contractClient = new ContractClient();
  } catch {
    contractClient = null;
  }
}

/**
 * Log an evolution decision on-chain (non-blocking, fire-and-forget).
 */
function logEvolutionOnChain(
  decision: 'proposal_created' | 'proposal_promoted' | 'proposal_rejected' | 'proposal_rolled_back',
  proposalId: string,
  zone: string,
): void {
  if (!contractClient?.hasPerformanceLog()) return;
  contractClient.logEvolutionDecision(decision, proposalId, zone)
    .then(hash => {
      if (hash) console.log(`${LOG_PREFIX} On-chain evolution log: ${decision} -> ${hash}`);
    })
    .catch(err => {
      console.warn(`${LOG_PREFIX} On-chain evolution log failed:`, err instanceof Error ? err.message : err);
    });
}

// -------------------------------------------------------------------------
// Metrics reading (from agent-state.json)
// -------------------------------------------------------------------------

function readPerformanceContext(): ProposalContext {
  const ctx: ProposalContext = {
    currentPnl: 0,
    winRate: 0,
    sharpeRatio: 0,
    rolling24hPnl: 0,
    failedProposals: [],
    fileContents: {},
  };

  try {
    const statePath = path.join(PROJECT_ROOT, 'data', 'agent-state.json');
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      const perf = state.performance || {};
      const entries = Object.values(perf) as Array<{
        totalPnL?: number;
        winRate?: number;
        sharpeRatio?: number;
        rolling24hPnL?: number;
      }>;

      for (const entry of entries) {
        ctx.currentPnl += entry.totalPnL || 0;
        ctx.winRate = Math.max(ctx.winRate, entry.winRate || 0);
        ctx.sharpeRatio = Math.max(ctx.sharpeRatio, entry.sharpeRatio || 0);
        ctx.rolling24hPnl += entry.rolling24hPnL || 0;
      }
    }
  } catch {
    // Use defaults
  }

  return ctx;
}

// -------------------------------------------------------------------------
// Zone selection
// -------------------------------------------------------------------------

function selectTargetZone(config: EvolutionConfig): { zone: string; files: string[]; description: string } | null {
  const memory = loadMemory();
  const zones = Object.entries(EVOLUTION_ZONES)
    .map(([name, info]) => ({ name, ...info }))
    .sort((a, b) => b.priority - a.priority);

  for (const zone of zones) {
    // Skip zones in backoff
    if (isZoneInBackoff(memory, zone.name)) {
      console.log(`${LOG_PREFIX} Skipping zone ${zone.name} (in backoff)`);
      continue;
    }

    // Skip if all files in zone were targeted too many times consecutively
    const allFilesBlocked = zone.files.every(f => !canTargetFile(memory, f));
    if (allFilesBlocked) {
      console.log(`${LOG_PREFIX} Skipping zone ${zone.name} (file targeting limit)`);
      continue;
    }

    // Filter to only files that can be targeted
    const eligibleFiles = zone.files.filter(f => canTargetFile(memory, f));
    if (eligibleFiles.length === 0) continue;

    return { zone: zone.name, files: eligibleFiles, description: zone.description };
  }

  return null;
}

// -------------------------------------------------------------------------
// Canary monitoring loop
// -------------------------------------------------------------------------

function startCanaryMonitoring(config: EvolutionConfig): void {
  if (canaryMonitorTimer) return;

  canaryMonitorTimer = setInterval(async () => {
    if (shutdownRequested) {
      stopCanaryMonitoring();
      return;
    }

    const state = loadCanaryState();
    if (!state || !state.active) {
      stopCanaryMonitoring();
      return;
    }

    try {
      const updated = await checkCanary(state);
      const memory = loadMemory();

      // Check rollback thresholds
      const { rollback: needsRollback, reason } = shouldRollback(updated, config.rollbackThresholds);
      if (needsRollback) {
        console.log(`${LOG_PREFIX} Canary FAILED: ${reason}`);
        await rollback(updated.proposalId, reason);

        // Record as rolled_back
        const proposal: EvolutionProposal = {
          id: updated.proposalId,
          createdAt: updated.startedAt,
          status: 'rolled_back',
          targetZone: '',
          targetFiles: [],
          rationale: '',
          diff: '',
          diffHash: '',
          linesAdded: 0,
          linesModified: 0,
          filesChanged: 0,
          aiModel: '',
          aiPromptTokens: 0,
          aiCompletionTokens: 0,
          rollbackReason: reason,
          rolledBackAt: Date.now(),
        };
        logEvolutionOnChain('proposal_rolled_back', updated.proposalId, 'canary');
        recordOutcome(memory, proposal, 'rolled_back');
        stopCanaryMonitoring();
        return;
      }

      // Check if canary is complete (minimum duration met)
      if (isCanaryComplete(updated, config.velocityLimits.minCanaryDuration)) {
        console.log(`${LOG_PREFIX} Canary PASSED for ${updated.proposalId.slice(0, 8)}`);
        auditProposalPromoted(updated.proposalId);
        logEvolutionOnChain('proposal_promoted', updated.proposalId, 'canary');

        // Record as promoted
        const proposal: EvolutionProposal = {
          id: updated.proposalId,
          createdAt: updated.startedAt,
          status: 'promoted',
          targetZone: '',
          targetFiles: [],
          rationale: '',
          diff: '',
          diffHash: '',
          linesAdded: 0,
          linesModified: 0,
          filesChanged: 0,
          aiModel: '',
          aiPromptTokens: 0,
          aiCompletionTokens: 0,
          promotedAt: Date.now(),
        };
        recordOutcome(memory, proposal, 'promoted');
        clearCanaryState();
        stopCanaryMonitoring();

        console.log(`${LOG_PREFIX} Evolution promoted to master`);
      }
    } catch (err) {
      console.error(
        `${LOG_PREFIX} Error during canary check:`,
        err instanceof Error ? err.message : err,
      );
    }
  }, 60_000); // Check every 60 seconds
}

function stopCanaryMonitoring(): void {
  if (canaryMonitorTimer) {
    clearInterval(canaryMonitorTimer);
    canaryMonitorTimer = null;
  }
}

// -------------------------------------------------------------------------
// Main evolution cycle
// -------------------------------------------------------------------------

async function runEvolutionCycle(): Promise<void> {
  const config = loadEvolutionConfig();

  if (!config.enabled) {
    console.log(`${LOG_PREFIX} Evolution engine disabled`);
    return;
  }

  auditCycleStarted();
  console.log(`${LOG_PREFIX} === Evolution cycle started ===`);

  // 1. Check for active canary (resume monitoring)
  const existingCanary = loadCanaryState();
  if (existingCanary && existingCanary.active) {
    console.log(`${LOG_PREFIX} Active canary found (${existingCanary.proposalId.slice(0, 8)}), monitoring...`);
    startCanaryMonitoring(config);
    auditCycleCompleted(existingCanary.proposalId, 'resumed_canary_monitoring');
    return;
  }

  // 2. Velocity check
  const memory = loadMemory();
  const { allowed, reason } = canSubmitProposal(memory, config);
  if (!allowed) {
    console.log(`${LOG_PREFIX} Velocity limit: ${reason}`);
    auditCycleCompleted(undefined, `velocity_limited: ${reason}`);
    return;
  }

  // 3. Select target zone
  const target = selectTargetZone(config);
  if (!target) {
    console.log(`${LOG_PREFIX} No eligible zones available`);
    auditCycleCompleted(undefined, 'no_eligible_zones');
    return;
  }

  console.log(`${LOG_PREFIX} Target zone: ${target.zone} (${target.files.length} files)`);

  // 4. Build context
  const context = readPerformanceContext();

  // 5. Generate proposal via AI
  console.log(`${LOG_PREFIX} Generating proposal via ${config.aiModel}...`);
  const proposal = await generateProposal(target.zone, target.files, target.description, context);

  if (!proposal) {
    console.log(`${LOG_PREFIX} AI failed to generate proposal`);
    auditCycleCompleted(undefined, 'ai_generation_failed');
    return;
  }

  auditProposalCreated(proposal);
  logEvolutionOnChain('proposal_created', proposal.id, target.zone);

  // Check for duplicate diff
  if (isDuplicate(memory, proposal.diffHash)) {
    proposal.status = 'rejected';
    proposal.rejectionReason = 'Duplicate diff (already tried)';
    auditProposalRejected(proposal.id, proposal.rejectionReason);
    logEvolutionOnChain('proposal_rejected', proposal.id, target.zone);
    recordOutcome(memory, proposal, 'rejected');
    console.log(`${LOG_PREFIX} Proposal rejected: duplicate diff`);
    auditCycleCompleted(proposal.id, 'duplicate_diff');
    return;
  }

  // 6. Static validation
  console.log(`${LOG_PREFIX} Validating proposal ${proposal.id.slice(0, 8)}...`);
  proposal.status = 'validating';
  const validation = validateProposal(proposal);
  proposal.staticValidation = validation;
  auditValidationResult(proposal.id, validation);

  if (!validation.passed) {
    proposal.status = 'rejected';
    proposal.rejectionReason = [
      ...validation.ringViolations,
      ...validation.forbiddenPatterns,
      ...validation.sizeViolations,
      ...validation.errors,
    ].join('; ');
    auditProposalRejected(proposal.id, proposal.rejectionReason);
    logEvolutionOnChain('proposal_rejected', proposal.id, target.zone);
    recordOutcome(memory, proposal, 'rejected');
    console.log(`${LOG_PREFIX} Proposal rejected: ${proposal.rejectionReason}`);
    auditCycleCompleted(proposal.id, 'validation_failed');
    return;
  }

  // Dry run mode stops here
  if (config.dryRun) {
    console.log(`${LOG_PREFIX} DRY RUN: Proposal passed validation, stopping before sandbox`);
    auditCycleCompleted(proposal.id, 'dry_run_complete');
    incrementDailyCount(memory);
    return;
  }

  // 7. Sandbox (git worktree + tsc)
  console.log(`${LOG_PREFIX} Creating sandbox for ${proposal.id.slice(0, 8)}...`);
  proposal.status = 'sandboxing';
  const sandboxResult = await createSandbox(proposal);
  proposal.sandboxResult = sandboxResult;
  auditSandboxResult(proposal.id, sandboxResult.passed, sandboxResult.compilationErrors);

  if (!sandboxResult.passed) {
    proposal.status = 'rejected';
    proposal.rejectionReason = `Compilation failed: ${sandboxResult.compilationErrors.slice(0, 3).join('; ')}`;
    auditProposalRejected(proposal.id, proposal.rejectionReason);
    logEvolutionOnChain('proposal_rejected', proposal.id, target.zone);
    recordOutcome(memory, proposal, 'rejected');
    cleanupSandbox(sandboxResult.worktreePath);
    console.log(`${LOG_PREFIX} Proposal rejected: compilation failed`);
    auditCycleCompleted(proposal.id, 'sandbox_failed');
    return;
  }

  // 8. Test gate
  console.log(`${LOG_PREFIX} Running tests for ${proposal.id.slice(0, 8)}...`);
  proposal.status = 'testing';
  const testResult = await runTests(sandboxResult.worktreePath);
  proposal.testResult = testResult;
  auditTestResult(proposal.id, testResult);

  if (!testResult.passed) {
    proposal.status = 'rejected';
    proposal.rejectionReason = `Tests failed: ${testResult.failingTests} failures`;
    auditProposalRejected(proposal.id, proposal.rejectionReason);
    logEvolutionOnChain('proposal_rejected', proposal.id, target.zone);
    recordOutcome(memory, proposal, 'rejected');
    cleanupSandbox(sandboxResult.worktreePath);
    console.log(`${LOG_PREFIX} Proposal rejected: tests failed`);
    auditCycleCompleted(proposal.id, 'tests_failed');
    return;
  }

  // Clean up sandbox (tests passed, ready for canary)
  cleanupSandbox(sandboxResult.worktreePath);

  // 9. Start canary deployment
  console.log(`${LOG_PREFIX} Starting canary for ${proposal.id.slice(0, 8)}...`);
  proposal.status = 'canary';
  const canaryState = await startCanary(proposal, sandboxResult.branch);
  proposal.canaryState = canaryState;
  auditCanaryStarted(proposal.id);

  // Increment daily count (proposal is now in-flight)
  incrementDailyCount(memory);

  // 10. Start canary monitoring
  startCanaryMonitoring(config);

  console.log(
    `${LOG_PREFIX} Canary deployed for ${proposal.id.slice(0, 8)}, ` +
    `monitoring for ${config.velocityLimits.minCanaryDuration / 3_600_000}h`,
  );
  auditCycleCompleted(proposal.id, 'canary_started');
}

// -------------------------------------------------------------------------
// Main loop + graceful shutdown
// -------------------------------------------------------------------------

function scheduleCycle(config: EvolutionConfig): void {
  if (shutdownRequested) return;

  cycleTimer = setTimeout(async () => {
    try {
      await runEvolutionCycle();
    } catch (err) {
      console.error(
        `${LOG_PREFIX} Cycle error:`,
        err instanceof Error ? err.message : err,
      );
    }
    scheduleCycle(config);
  }, config.cycleIntervalMs);
}

async function main(): Promise<void> {
  const config = loadEvolutionConfig();

  // Handle --reset-backoffs CLI flag
  if (process.argv.includes('--reset-backoffs')) {
    const mem = loadMemory();
    resetAllBackoffs(mem);
    console.log(`${LOG_PREFIX} All zone backoffs have been reset`);
    if (process.argv.includes('--exit-after-reset')) {
      process.exit(0);
    }
  }

  console.log(`${LOG_PREFIX} ======================================`);
  console.log(`${LOG_PREFIX}  DarwinFi Evolution Engine starting`);
  console.log(`${LOG_PREFIX}  Enabled: ${config.enabled}`);
  console.log(`${LOG_PREFIX}  Dry Run: ${config.dryRun}`);
  console.log(`${LOG_PREFIX}  Cycle Interval: ${config.cycleIntervalMs / 3_600_000}h`);
  console.log(`${LOG_PREFIX}  AI Model: ${config.aiModel}`);
  console.log(`${LOG_PREFIX}  Max proposals/day: ${config.velocityLimits.maxProposalsPerDay}`);
  console.log(`${LOG_PREFIX} ======================================`);

  // Diagnostic: log zone backoff state on startup
  const startupMemory = loadMemory();
  const zones = Object.entries(startupMemory.zoneBackoff);
  if (zones.length > 0) {
    console.log(`${LOG_PREFIX} Zone backoff state:`);
    for (const [zone, backoff] of zones) {
      const inBackoff = Date.now() < backoff.backoffUntil;
      const remaining = inBackoff ? Math.ceil((backoff.backoffUntil - Date.now()) / 3_600_000) : 0;
      console.log(`${LOG_PREFIX}   ${zone}: failures=${backoff.consecutiveFailures}, ${inBackoff ? `LOCKED (${remaining}h remaining)` : 'available'}`);
    }
  } else {
    console.log(`${LOG_PREFIX} No zone backoff history`);
  }

  // Check for active canary on startup (resume monitoring)
  const existingCanary = loadCanaryState();
  if (existingCanary && existingCanary.active) {
    console.log(`${LOG_PREFIX} Resuming canary monitoring for ${existingCanary.proposalId.slice(0, 8)}`);
    startCanaryMonitoring(config);
  }

  // Run first cycle immediately
  try {
    await runEvolutionCycle();
  } catch (err) {
    console.error(
      `${LOG_PREFIX} Initial cycle error:`,
      err instanceof Error ? err.message : err,
    );
  }

  // Schedule subsequent cycles
  scheduleCycle(config);
}

// Graceful shutdown
function handleShutdown(signal: string): void {
  console.log(`${LOG_PREFIX} Received ${signal}, shutting down gracefully...`);
  shutdownRequested = true;

  if (cycleTimer) {
    clearTimeout(cycleTimer);
    cycleTimer = null;
  }

  stopCanaryMonitoring();

  // Allow time for any in-progress operations
  setTimeout(() => {
    console.log(`${LOG_PREFIX} Shutdown complete`);
    process.exit(0);
  }, 5000);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

main().catch(err => {
  console.error(`${LOG_PREFIX} Fatal error:`, err);
  process.exit(1);
});
