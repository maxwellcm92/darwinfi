/**
 * DarwinFi Immune System - Check Generator
 *
 * Analyzes fix history patterns to automatically generate new health checks.
 * When a fix type triggers repeatedly (>3x in 24h), generates a predictive
 * check to catch the root cause earlier.
 */

import { GenomeStateManager } from './genome-state';
import { FixRecord, GeneratedCheck, LearnedPattern } from '../types';
import { THRESHOLDS, CHECK_INTERVALS } from '../config';

const PREFIX = '[Immune:Genome]';
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

interface CheckTemplate {
  id: string;
  name: string;
  description: string;
  checkFn: string;
  intervalMs: number;
  thresholds: Record<string, number>;
  patternTrigger: string;
  patternAction: string;
}

const CHECK_TEMPLATES: Record<string, CheckTemplate> = {
  pm2_restart: {
    id: 'gen_memory_growth_rate',
    name: 'memory_growth_rate',
    description: 'Tracks MiB/hour memory growth to predict OOM before PM2 restart is needed',
    checkFn: 'checkMemoryGrowthRate',
    intervalMs: CHECK_INTERVALS.processHealth,
    thresholds: { maxGrowthMiBPerHour: 20, warnGrowthMiBPerHour: 10 },
    patternTrigger: 'pm2_restart > 3x/24h',
    patternAction: 'generate_memory_growth_check',
  },
  rpc_rotation: {
    id: 'gen_rpc_latency_trend',
    name: 'rpc_latency_trend',
    description: 'Tracks RPC endpoint p99 latency trends to rotate before failures',
    checkFn: 'checkRpcLatencyTrend',
    intervalMs: CHECK_INTERVALS.apiProbe,
    thresholds: { maxP99Ms: 3000, warnP99Ms: 1500 },
    patternTrigger: 'rpc_rotation > 3x/24h',
    patternAction: 'generate_rpc_latency_check',
  },
  state_rebuild: {
    id: 'gen_file_size_anomaly',
    name: 'file_size_anomaly',
    description: 'Detects >50% sudden change in state file sizes indicating corruption',
    checkFn: 'checkFileSizeAnomaly',
    intervalMs: CHECK_INTERVALS.stateIntegrity,
    thresholds: { maxSizeChangePercent: 50 },
    patternTrigger: 'state_rebuild > 3x/24h',
    patternAction: 'generate_file_size_anomaly_check',
  },
};

/**
 * Analyze fix history and generate new checks for recurring fix patterns.
 */
export function generateChecks(
  genome: GenomeStateManager,
  fixHistory: FixRecord[],
): GeneratedCheck[] {
  const cutoff = Date.now() - TWENTY_FOUR_HOURS;
  const recentFixes = fixHistory.filter((f) => f.appliedAt >= cutoff);

  // Count fixes by fixName in last 24h
  const fixCounts = new Map<string, number>();
  for (const fix of recentFixes) {
    fixCounts.set(fix.fixName, (fixCounts.get(fix.fixName) || 0) + 1);
  }

  const generated: GeneratedCheck[] = [];
  const triggerThreshold = THRESHOLDS.checkGenerationTriggerCount;

  for (const [fixName, count] of fixCounts) {
    if (count <= triggerThreshold) continue;

    const template = CHECK_TEMPLATES[fixName];
    if (!template) continue;

    // Skip if this check already exists and is enabled
    const existingChecks = genome.getState().generatedChecks;
    const existing = existingChecks.find((c) => c.id === template.id);
    if (existing?.enabled) {
      console.log(`${PREFIX} Check ${template.id} already active, skipping generation`);
      continue;
    }

    console.log(
      `${PREFIX} Fix "${fixName}" triggered ${count}x in 24h (threshold: ${triggerThreshold}). ` +
      `Generating check: ${template.name}`
    );

    const check: GeneratedCheck = {
      id: template.id,
      name: template.name,
      description: template.description,
      generatedAt: Date.now(),
      sourcePattern: template.patternTrigger,
      intervalMs: template.intervalMs,
      enabled: true,
      checkFn: template.checkFn,
      thresholds: template.thresholds,
    };

    generated.push(check);

    // Record the learned pattern
    const pattern: LearnedPattern = {
      id: `pattern_${fixName}`,
      trigger: template.patternTrigger,
      action: template.patternAction,
      learnedAt: Date.now(),
      timesTriggered: 1,
    };
    genome.addLearnedPattern(pattern);
  }

  if (generated.length > 0) {
    console.log(`${PREFIX} Generated ${generated.length} new checks from fix patterns`);
  }

  return generated;
}
