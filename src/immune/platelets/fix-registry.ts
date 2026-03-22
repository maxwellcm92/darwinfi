/**
 * DarwinFi Immune System - Fix Registry
 *
 * Maps checkId -> FixRegistryEntry. Each entry defines what fix to apply
 * when a specific check fails, along with its safety classification.
 */

import { FixRegistryEntry } from '../types';
import { MONITORED_PROCESSES } from '../config';
import {
  pm2Restart, pm2Start, rpcRotation, stateRebuild, hardhatCacheClear,
  mathRecompute, stateInvariantRepair, integrationRestart, dashboardRestart,
} from './safe-fixes';

const registry = new Map<string, FixRegistryEntry>();

// ---------------------------------------------------------------------------
// Safe fixes (auto-applied by the fix engine)
// ---------------------------------------------------------------------------

// Legacy single-process entry (backward compat)
registry.set('process_health', {
  checkId: 'process_health',
  fixName: 'pm2_restart',
  safety: 'safe',
  description: 'Restart darwinfi PM2 process',
  fixFn: () => pm2Restart('darwinfi'),
  verifyDelayMs: 20_000,
});

// Per-process pm2_start fixes (skip darwinfi-immune -- can't restart itself)
for (const proc of MONITORED_PROCESSES) {
  if (proc.name === 'darwinfi-immune') continue;
  registry.set(proc.checkId, {
    checkId: proc.checkId,
    fixName: 'pm2_start',
    safety: 'safe',
    description: `Start/restart ${proc.name} PM2 process`,
    fixFn: () => pm2Start(proc.name),
    verifyDelayMs: 20_000,
  });
}

registry.set('chain_health', {
  checkId: 'chain_health',
  fixName: 'rpc_rotation',
  safety: 'safe',
  description: 'Rotate to next RPC endpoint',
  fixFn: rpcRotation,
});

registry.set('state_integrity', {
  checkId: 'state_integrity',
  fixName: 'state_rebuild',
  safety: 'safe',
  description: 'Rebuild state from .tmp backup or repair corrupt state',
  fixFn: stateRebuild,
  verifyDelayMs: 5_000,
});

registry.set('api_probe', {
  checkId: 'api_probe',
  fixName: 'pm2_restart',
  safety: 'safe',
  description: 'Restart darwinfi (main API server) if API endpoints unreachable',
  fixFn: () => pm2Restart('darwinfi'),
  verifyDelayMs: 20_000,
});

registry.set('antibody.test_runner', {
  checkId: 'antibody.test_runner',
  fixName: 'hardhat_cache_clear',
  safety: 'safe',
  description: 'Clear Hardhat cache and recompile',
  fixFn: hardhatCacheClear,
});

// ---------------------------------------------------------------------------
// Evolution rollback (safe fix: reverts to known-good master branch)
// ---------------------------------------------------------------------------

registry.set('evolution_canary_health', {
  checkId: 'evolution_canary_health',
  fixName: 'evolution_rollback',
  safety: 'safe',
  description: 'Rollback evolution canary to master branch',
  fixFn: async () => {
    try {
      const { execSync } = require('child_process');
      const cwd = process.cwd();
      execSync('git checkout master', { cwd, encoding: 'utf-8' });
      execSync('npx tsc', { cwd, encoding: 'utf-8', timeout: 120_000 });
      execSync('pm2 reload darwinfi darwinfi-instinct frontier', { cwd, encoding: 'utf-8' });
      // Clear canary state
      const fs = require('fs');
      const path = require('path');
      const canaryPath = path.join(cwd, 'data', 'evolution', 'canary-state.json');
      fs.writeFileSync(canaryPath, 'null', 'utf-8');
      return true;
    } catch {
      return false;
    }
  },
});

registry.set('evolution_branch_integrity', {
  checkId: 'evolution_branch_integrity',
  fixName: 'evolution_rollback',
  safety: 'safe',
  description: 'Reset to master branch on unexpected git state',
  fixFn: async () => {
    try {
      const { execSync } = require('child_process');
      execSync('git checkout master', { cwd: process.cwd(), encoding: 'utf-8' });
      return true;
    } catch {
      return false;
    }
  },
});

// ---------------------------------------------------------------------------
// Automatable antibody/membrane fixes
// ---------------------------------------------------------------------------

registry.set('antibody.math_verifier', {
  checkId: 'antibody.math_verifier',
  fixName: 'math_recompute',
  safety: 'safe',
  description: 'Recompute totalPnL, winRate from tradeHistory and write corrected values',
  fixFn: mathRecompute,
});

registry.set('antibody.state_invariants', {
  checkId: 'antibody.state_invariants',
  fixName: 'state_invariant_repair',
  safety: 'safe',
  description: 'Prune stale open trades and ensure all strategies have performance entries',
  fixFn: stateInvariantRepair,
});

registry.set('antibody.integration_checks', {
  checkId: 'antibody.integration_checks',
  fixName: 'integration_restart',
  safety: 'safe',
  description: 'Restart all non-immune PM2 processes to fix API/file state mismatches',
  fixFn: integrationRestart,
  verifyDelayMs: 20_000,
});

registry.set('membrane.ui_truth_checker', {
  checkId: 'membrane.ui_truth_checker',
  fixName: 'dashboard_restart',
  safety: 'safe',
  description: 'Restart darwinfi process to refresh dashboard state',
  fixFn: dashboardRestart,
  verifyDelayMs: 20_000,
});

// ---------------------------------------------------------------------------
// Manual-review checks (no auto-fix -- logged and escalated only)
// ---------------------------------------------------------------------------

const manualCheckIds = [
  'membrane.share_price_auditor',
  'membrane.vault_consistency',
  'dep_scan',
  'key_safety',
  'contract_scan',
  'api_exposure',
];

for (const checkId of manualCheckIds) {
  registry.set(checkId, {
    checkId,
    fixName: 'manual_review',
    safety: 'manual',
    description: `Manual review required for ${checkId}`,
    fixFn: async () => false,
  });
}

/**
 * Look up the fix entry for a given checkId.
 */
export function getFixForCheck(checkId: string): FixRegistryEntry | undefined {
  return registry.get(checkId);
}

/**
 * Get all registered fix entries.
 */
export function getAllRegisteredFixes(): FixRegistryEntry[] {
  return Array.from(registry.values());
}
