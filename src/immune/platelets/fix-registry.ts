/**
 * DarwinFi Immune System - Fix Registry
 *
 * Maps checkId -> FixRegistryEntry. Each entry defines what fix to apply
 * when a specific check fails, along with its safety classification.
 */

import { FixRegistryEntry } from '../types';
import { pm2Restart, rpcRotation, stateRebuild, hardhatCacheClear } from './safe-fixes';

const registry = new Map<string, FixRegistryEntry>();

// ---------------------------------------------------------------------------
// Safe fixes (auto-applied by the fix engine)
// ---------------------------------------------------------------------------

registry.set('process_health', {
  checkId: 'process_health',
  fixName: 'pm2_restart',
  safety: 'safe',
  description: 'Restart darwinfi PM2 process',
  fixFn: () => pm2Restart('darwinfi'),
});

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
  description: 'Rebuild state from .tmp backup',
  fixFn: stateRebuild,
});

registry.set('antibody.test_runner', {
  checkId: 'antibody.test_runner',
  fixName: 'hardhat_cache_clear',
  safety: 'safe',
  description: 'Clear Hardhat cache and recompile',
  fixFn: hardhatCacheClear,
});

// ---------------------------------------------------------------------------
// Manual-review checks (no auto-fix -- logged and escalated only)
// ---------------------------------------------------------------------------

const manualCheckIds = [
  'antibody.math_verifier',
  'antibody.state_invariants',
  'antibody.integration_checks',
  'antibody.test_runner',
  'membrane.share_price_auditor',
  'membrane.vault_consistency',
  'membrane.ui_truth_checker',
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
