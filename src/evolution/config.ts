/**
 * DarwinFi Evolution Engine - Configuration
 * Ring definitions, velocity limits, thresholds, forbidden patterns.
 */

import * as path from 'path';
import * as fs from 'fs';
import { FileRingMapping, VelocityLimits, EvolutionConfig } from './types';

// Project root resolution (works from both src/ and dist/)
function resolveProjectRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const PROJECT_ROOT = resolveProjectRoot();
export const EVOLUTION_DATA_DIR = path.join(PROJECT_ROOT, 'data', 'evolution');

// Ensure data directory exists
if (!fs.existsSync(EVOLUTION_DATA_DIR)) {
  fs.mkdirSync(EVOLUTION_DATA_DIR, { recursive: true });
}

/**
 * File Mutability Rings
 * Ring 0 = IMMUTABLE (evolution cannot touch)
 * Ring 1 = EVOLVABLE (full proposal pipeline)
 * Ring 2 = ADDITIVE (can add new functions only, no modifications/deletions)
 */
export const FILE_RINGS: FileRingMapping[] = [
  // Ring 0 -- IMMUTABLE
  { pattern: 'src/chain/**/*', ring: 'immutable', description: 'Wallet, vault, chain connection' },
  { pattern: 'src/trading/live-engine.ts', ring: 'immutable', description: 'Real money execution' },
  { pattern: 'src/trading/uniswap-client.ts', ring: 'immutable', description: 'Swap router' },
  { pattern: 'src/agent/performance.ts', ring: 'immutable', description: 'Fitness function' },
  { pattern: 'src/evolution/**/*', ring: 'immutable', description: 'Cannot modify itself' },
  { pattern: 'contracts/**/*', ring: 'immutable', description: 'Smart contracts' },
  { pattern: 'lit-actions/**/*', ring: 'immutable', description: 'Lit Protocol actions' },
  { pattern: 'test/**/*', ring: 'immutable', description: 'Test suite' },
  { pattern: '.env', ring: 'immutable', description: 'Environment secrets' },
  { pattern: 'ecosystem.config.js', ring: 'immutable', description: 'PM2 config' },
  { pattern: 'package.json', ring: 'immutable', description: 'Dependencies' },
  { pattern: 'tsconfig.json', ring: 'immutable', description: 'TypeScript config' },
  { pattern: 'hardhat.config.ts', ring: 'immutable', description: 'Hardhat config' },

  // Ring 1 -- EVOLVABLE (full pipeline)
  { pattern: 'src/instinct/senses/**/*', ring: 'evolvable', description: 'Data sources' },
  { pattern: 'src/instinct/reflexes/**/*', ring: 'evolvable', description: 'Prediction models' },
  { pattern: 'src/instinct/cortex/**/*', ring: 'evolvable', description: 'Weight optimization' },
  { pattern: 'src/frontier/**/*', ring: 'evolvable', description: 'Frontier bot logic' },
  { pattern: 'src/immune/patrol/**/*', ring: 'evolvable', description: 'Health checks' },
  { pattern: 'src/immune/genome/**/*', ring: 'evolvable', description: 'Immune evolution' },
  { pattern: 'src/agent/circuit-breaker.ts', ring: 'evolvable', description: 'Threshold tuning' },
  { pattern: 'src/agent/strategy-manager.ts', ring: 'evolvable', description: 'Strategy parameters' },
  { pattern: 'src/dashboard/server.ts', ring: 'evolvable', description: 'API endpoints' },

  // Ring 2 -- ADDITIVE ONLY
  { pattern: 'src/trading/indicators.ts', ring: 'additive', description: 'Add indicators only' },
  { pattern: 'src/trading/price-feed.ts', ring: 'additive', description: 'Token definitions' },
];

/**
 * Forbidden patterns in generated code.
 * If any of these appear in a diff, the proposal is rejected.
 */
export const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /require\s*\(\s*['"]fs['"]\s*\)/, description: 'Direct fs import' },
  { pattern: /require\s*\(\s*['"]child_process['"]\s*\)/, description: 'child_process import' },
  { pattern: /import.*from\s+['"]fs['"]/, description: 'ES fs import' },
  { pattern: /import.*from\s+['"]child_process['"]/, description: 'ES child_process import' },
  { pattern: /\beval\s*\(/, description: 'eval() call' },
  { pattern: /new\s+Function\s*\(/, description: 'new Function() constructor' },
  { pattern: /process\.env\b/, description: 'Direct process.env access' },
  { pattern: /PRIVATE_KEY|API_KEY|SECRET|PASSWORD|CREDENTIAL/i, description: 'Credential reference' },
  { pattern: /\.env\b/, description: '.env file reference' },
  { pattern: /exec\s*\(|execSync\s*\(|spawn\s*\(|spawnSync\s*\(/, description: 'Shell execution' },
  { pattern: /globalThis|global\.\w/, description: 'Global state mutation' },
  { pattern: /process\.exit/, description: 'Process termination' },
  { pattern: /require\s*\(\s*['"]net['"]\s*\)/, description: 'net module import' },
  { pattern: /require\s*\(\s*['"]http['"]\s*\)/, description: 'Raw http import' },
];

export const VELOCITY_LIMITS: VelocityLimits = {
  maxProposalsPerDay: 4,
  minTimeBetweenProposals: 4 * 60 * 60_000, // 4 hours
  maxConcurrentCanaries: 1,
  forcedCooldownAfterRollback: 12 * 60 * 60_000, // 12 hours
  maxDiffLinesAdded: 200,
  maxDiffLinesModified: 50,
  maxFilesPerProposal: 3,
  minCanaryDuration: 4 * 60 * 60_000, // 4 hours
};

export const ROLLBACK_THRESHOLDS = {
  maxPnlDropPct: -0.02, // -2% TVL
  maxErrorRateIncreasePct: 0.50, // +50%
  maxCrashesIn10Min: 3,
};

export function loadEvolutionConfig(): EvolutionConfig {
  return {
    enabled: process.env.EVOLUTION_ENABLED !== 'false',
    dryRun: process.env.EVOLUTION_DRY_RUN === 'true',
    cycleIntervalMs: 6 * 60 * 60_000, // 6 hours
    velocityLimits: VELOCITY_LIMITS,
    rollbackThresholds: ROLLBACK_THRESHOLDS,
    antiLoop: {
      maxConsecutiveFailuresBeforeBackoff: 3,
      initialBackoffMs: 6 * 60 * 60_000, // 6h
      maxBackoffMs: 2 * 24 * 60 * 60_000, // 48h
      backoffMultiplier: 2,
      maxSameFileConsecutive: 3,
      failedPromptsToInject: 5,
    },
    aiEndpoint: process.env.VENICE_API_URL || 'https://api.venice.ai/api/v1/chat/completions',
    aiModel: process.env.EVOLUTION_AI_MODEL || 'llama-3.3-70b',
    aiApiKey: process.env.VENICE_API_KEY || '',
  };
}

/**
 * Evolution zones for target selection.
 * Each zone maps to a set of evolvable files.
 */
export const EVOLUTION_ZONES: Record<string, { files: string[]; description: string; priority: number }> = {
  'trading/indicators': {
    files: ['src/trading/indicators.ts'],
    description: 'Technical indicators (RSI, MACD, BB variants)',
    priority: 3,
  },
  'instinct/reflexes': {
    files: ['src/instinct/reflexes/pattern-matcher.ts', 'src/instinct/reflexes/statistical-predictor.ts'],
    description: 'Prediction models and pattern matching',
    priority: 5,
  },
  'instinct/cortex': {
    files: ['src/instinct/cortex/scorer.ts', 'src/instinct/cortex/weight-optimizer.ts'],
    description: 'Strategy scoring and weight optimization',
    priority: 4,
  },
  'instinct/senses': {
    files: ['src/instinct/senses/source-manager.ts', 'src/instinct/senses/grok-source.ts', 'src/instinct/senses/onchain-source.ts'],
    description: 'Data source ingestion',
    priority: 2,
  },
  'frontier/discovery': {
    files: ['src/frontier/discovery/token-discovery.ts', 'src/frontier/discovery/rug-detector.ts'],
    description: 'New token discovery and rug detection',
    priority: 3,
  },
  'frontier/strategies': {
    files: ['src/frontier/hft/spread-scanner.ts', 'src/frontier/volatility/vol-scanner.ts', 'src/frontier/whale/whale-tracker.ts'],
    description: 'Frontier bot trading strategies',
    priority: 3,
  },
  'immune/patrol': {
    files: ['src/immune/patrol/process-patrol.ts', 'src/immune/patrol/chain-patrol.ts', 'src/immune/patrol/api-patrol.ts'],
    description: 'Health monitoring checks',
    priority: 1,
  },
  'agent/circuit-breaker': {
    files: ['src/agent/circuit-breaker.ts'],
    description: 'Circuit breaker threshold tuning',
    priority: 4,
  },
  'strategy-params': {
    files: ['src/agent/strategy-manager.ts'],
    description: 'Strategy genome parameters (thresholds, weights, token preferences)',
    priority: 4,
  },
  'chain-expansion': {
    files: ['src/chain/chain-registry.ts'],
    description: 'Multi-chain expansion configuration and routing',
    priority: 1,
  },
};
