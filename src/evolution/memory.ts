/**
 * DarwinFi Evolution Engine - Anti-Loop Memory
 * Tracks past proposals to prevent oscillation and repeated failures.
 * Uses exponential backoff per zone on consecutive failures.
 */

import * as fs from 'fs';
import * as path from 'path';
import { AntiLoopMemory, AntiLoopEntry, EvolutionProposal, EvolutionConfig } from './types';
import { EVOLUTION_DATA_DIR } from './config';

const MEMORY_FILE = path.join(EVOLUTION_DATA_DIR, 'memory.json');

function defaultMemory(): AntiLoopMemory {
  return {
    entries: [],
    zoneBackoff: {},
    lastProposalTime: 0,
    proposalsToday: 0,
    todayDate: '',
  };
}

export function loadMemory(): AntiLoopMemory {
  try {
    if (!fs.existsSync(MEMORY_FILE)) return defaultMemory();
    const raw = fs.readFileSync(MEMORY_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    // Validate shape
    if (!parsed || !Array.isArray(parsed.entries)) return defaultMemory();
    return parsed as AntiLoopMemory;
  } catch {
    return defaultMemory();
  }
}

export function saveMemory(memory: AntiLoopMemory): void {
  if (!fs.existsSync(EVOLUTION_DATA_DIR)) {
    fs.mkdirSync(EVOLUTION_DATA_DIR, { recursive: true });
  }
  const tmpPath = MEMORY_FILE + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(memory, null, 2), 'utf-8');
  fs.renameSync(tmpPath, MEMORY_FILE);
}

export function recordOutcome(
  memory: AntiLoopMemory,
  proposal: EvolutionProposal,
  outcome: 'promoted' | 'rejected' | 'rolled_back',
): void {
  const entry: AntiLoopEntry = {
    proposalId: proposal.id,
    diffHash: proposal.diffHash,
    zone: proposal.targetZone,
    targetFiles: proposal.targetFiles,
    timestamp: Date.now(),
    outcome,
    rejectionReason: proposal.rejectionReason,
  };
  memory.entries.push(entry);

  // Keep memory bounded (last 200 entries)
  if (memory.entries.length > 200) {
    memory.entries = memory.entries.slice(-200);
  }

  // Update zone backoff
  const failed = outcome === 'rejected' || outcome === 'rolled_back';
  updateZoneBackoff(memory, proposal.targetZone, failed);

  memory.lastProposalTime = Date.now();
  saveMemory(memory);
}

export function isDuplicate(memory: AntiLoopMemory, diffHash: string): boolean {
  return memory.entries.some(e => e.diffHash === diffHash);
}

export function isZoneInBackoff(memory: AntiLoopMemory, zone: string): boolean {
  const backoff = memory.zoneBackoff[zone];
  if (!backoff) return false;
  return Date.now() < backoff.backoffUntil;
}

export function updateZoneBackoff(
  memory: AntiLoopMemory,
  zone: string,
  failed: boolean,
): void {
  if (!memory.zoneBackoff[zone]) {
    memory.zoneBackoff[zone] = {
      zone,
      consecutiveFailures: 0,
      backoffUntil: 0,
      lastFailure: 0,
    };
  }

  const backoff = memory.zoneBackoff[zone];

  if (failed) {
    backoff.consecutiveFailures += 1;
    backoff.lastFailure = Date.now();

    // Apply exponential backoff after threshold
    if (backoff.consecutiveFailures >= 3) {
      const exponent = backoff.consecutiveFailures - 3;
      const backoffMs = Math.min(
        6 * 60 * 60_000 * Math.pow(2, exponent), // 6h * 2^n
        2 * 24 * 60 * 60_000, // cap at 48h
      );
      backoff.backoffUntil = Date.now() + backoffMs;
    }
  } else {
    // Success resets consecutive failures
    backoff.consecutiveFailures = 0;
    backoff.backoffUntil = 0;
  }
}

export function canTargetFile(memory: AntiLoopMemory, file: string): boolean {
  // Check if this file has been targeted in the last 3 consecutive proposals
  const recentEntries = memory.entries.slice(-3);
  const consecutiveSameFile = recentEntries.every(
    e => e.targetFiles.includes(file),
  );
  return !(consecutiveSameFile && recentEntries.length >= 3);
}

export function getFailedProposals(
  memory: AntiLoopMemory,
  zone: string,
  limit: number,
): AntiLoopEntry[] {
  return memory.entries
    .filter(e => e.zone === zone && (e.outcome === 'rejected' || e.outcome === 'rolled_back'))
    .slice(-limit);
}

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function canSubmitProposal(
  memory: AntiLoopMemory,
  config: EvolutionConfig,
): { allowed: boolean; reason?: string } {
  const today = getTodayDate();
  const limits = config.velocityLimits;

  // Reset daily counter if new day
  if (memory.todayDate !== today) {
    memory.todayDate = today;
    memory.proposalsToday = 0;
    saveMemory(memory);
  }

  // Check daily limit
  if (memory.proposalsToday >= limits.maxProposalsPerDay) {
    return { allowed: false, reason: `Daily limit reached (${limits.maxProposalsPerDay} proposals/day)` };
  }

  // Check minimum time between proposals
  const elapsed = Date.now() - memory.lastProposalTime;
  if (memory.lastProposalTime > 0 && elapsed < limits.minTimeBetweenProposals) {
    const remainingMin = Math.ceil((limits.minTimeBetweenProposals - elapsed) / 60_000);
    return { allowed: false, reason: `Cooldown active, ${remainingMin} minutes remaining` };
  }

  // Check forced cooldown after rollback
  const lastRollback = memory.entries
    .filter(e => e.outcome === 'rolled_back')
    .pop();
  if (lastRollback) {
    const rollbackElapsed = Date.now() - lastRollback.timestamp;
    if (rollbackElapsed < limits.forcedCooldownAfterRollback) {
      const remainingHrs = Math.ceil(
        (limits.forcedCooldownAfterRollback - rollbackElapsed) / 3_600_000,
      );
      return { allowed: false, reason: `Post-rollback cooldown, ${remainingHrs}h remaining` };
    }
  }

  return { allowed: true };
}

export function incrementDailyCount(memory: AntiLoopMemory): void {
  const today = getTodayDate();
  if (memory.todayDate !== today) {
    memory.todayDate = today;
    memory.proposalsToday = 0;
  }
  memory.proposalsToday += 1;
  memory.lastProposalTime = Date.now();
  saveMemory(memory);
}

/**
 * Reset backoff for a specific zone.
 */
export function resetZoneBackoff(memory: AntiLoopMemory, zone: string): void {
  if (memory.zoneBackoff[zone]) {
    memory.zoneBackoff[zone].consecutiveFailures = 0;
    memory.zoneBackoff[zone].backoffUntil = 0;
    memory.zoneBackoff[zone].lastFailure = 0;
  }
  saveMemory(memory);
}

/**
 * Reset all zone backoffs (used for manual recovery).
 */
export function resetAllBackoffs(memory: AntiLoopMemory): void {
  for (const zone of Object.keys(memory.zoneBackoff)) {
    memory.zoneBackoff[zone].consecutiveFailures = 0;
    memory.zoneBackoff[zone].backoffUntil = 0;
    memory.zoneBackoff[zone].lastFailure = 0;
  }
  saveMemory(memory);
}
