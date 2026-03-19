/**
 * DarwinFi Immune System - Configuration
 *
 * Default thresholds, intervals, and safe-fix categories.
 * Values can be overridden by the Genome self-evolution system.
 */

import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Project Root (works both in src/ dev and dist/ compiled contexts)
// ---------------------------------------------------------------------------

function resolveProjectRoot(): string {
  // Walk up from __dirname until we find package.json
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: process.cwd() (PM2 always runs from project root)
  return process.cwd();
}

export const PROJECT_ROOT = resolveProjectRoot();

// ---------------------------------------------------------------------------
// Check Intervals (ms)
// ---------------------------------------------------------------------------

export const CHECK_INTERVALS = {
  processHealth: 30_000,        // 30s
  apiProbe: 60_000,             // 60s
  chainHealth: 120_000,         // 2min
  stateIntegrity: 5 * 60_000,   // 5min
  instinctHealth: 5 * 60_000,   // 5min
  mathVerification: 30 * 60_000, // 30min
  stateInvariants: 15 * 60_000, // 15min
  uiTruth: 5 * 60_000,          // 5min
  integrationConsistency: 30 * 60_000, // 30min
  hardhatTests: 6 * 60 * 60_000,      // 6hr
  depScan: 24 * 60 * 60_000,          // 24hr
  keySafety: 12 * 60 * 60_000,        // 12hr
  contractScan: 24 * 60 * 60_000,     // 24hr
  apiExposure: 12 * 60 * 60_000,      // 12hr
  genomeEvolution: 12 * 60 * 60_000,  // 12hr
} as const;

// ---------------------------------------------------------------------------
// Patrol Thresholds
// ---------------------------------------------------------------------------

export const THRESHOLDS = {
  // Process patrol
  maxMemoryMiB: 200,
  maxRestartsPerHour: 5,

  // API patrol
  apiTimeoutMs: 5_000,

  // Chain patrol
  maxBlockStalenessS: 60,

  // State patrol
  maxStateAgeMins: 10,

  // Instinct patrol
  minActiveSourcesOrStrategies: 1,
  minConfidenceFloor: 10,

  // Math verification
  compositeScoreDrift: 0.001,
  sharePriceMismatchWei: 1n,

  // State invariants
  expectedStrategyCount: 12,
  maxTradeAgeHours: 48,

  // Self-healing
  maxFixAttempts: 3,
  maxFixesPerHour: 10,
  fixCooldownMs: 30 * 60_000, // 30min same fix
  fixVerifyDelayMs: 10_000,   // 10s after fix before verify

  // Alert dedup
  alertDedupWindowMs: 10 * 60_000, // 10min

  // Log limits
  maxLogEntries: 10_000,
  maxFixHistory: 1_000,

  // Genome
  emaAlpha: 0.3,
  falsePositiveRelaxRate: 0.10,
  missedIncidentTightenRate: 0.10,
  thresholdMinMultiplier: 0.5,
  thresholdMaxMultiplier: 2.0,
  checkGenerationTriggerCount: 3, // >3x in 24h
} as const;

// ---------------------------------------------------------------------------
// File Paths
// ---------------------------------------------------------------------------

export const IMMUNE_DATA_DIR = 'data/immune';

export const IMMUNE_FILES = {
  state: `${IMMUNE_DATA_DIR}/immune-state.json`,
  log: `${IMMUNE_DATA_DIR}/immune-log.json`,
  fixHistory: `${IMMUNE_DATA_DIR}/fix-history.json`,
  genome: `${IMMUNE_DATA_DIR}/genome.json`,
  antibodyResults: `${IMMUNE_DATA_DIR}/antibody-results`,
} as const;

// Agent state files monitored
export const MONITORED_STATE_FILES = {
  agentState: 'data/agent-state.json',
  predictionsLive: 'data/instinct/nerves/predictions-live.json',
} as const;

// ---------------------------------------------------------------------------
// API Endpoints to Probe
// ---------------------------------------------------------------------------

export const API_ENDPOINTS = [
  { path: '/api/health', name: 'health' },
  { path: '/api/state', name: 'state' },
  { path: '/api/vault', name: 'vault' },
] as const;

// Dashboard port (same as main agent)
export const DASHBOARD_PORT = Number(process.env.DASHBOARD_PORT) || 3502;

// ---------------------------------------------------------------------------
// RPC Endpoints (for rotation)
// ---------------------------------------------------------------------------

export const RPC_ENDPOINTS = [
  'https://base.llamarpc.com',
  'https://mainnet.base.org',
  'https://base.meowrpc.com',
  'https://1rpc.io/base',
] as const;

// ---------------------------------------------------------------------------
// Safe Fix Categories
// ---------------------------------------------------------------------------

export const SAFE_FIX_IDS = new Set([
  'pm2_restart',
  'rpc_rotation',
  'state_rebuild',
  'cache_clear',
  'hardhat_cache_clear',
]);

export const RISKY_FIX_IDS = new Set([
  'env_modification',
  'contract_interaction',
  'strategy_param_change',
  'stop_trading',
]);
