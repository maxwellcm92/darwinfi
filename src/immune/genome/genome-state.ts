/**
 * DarwinFi Immune System - Genome State Manager
 *
 * Persists and manages genome.json using atomic writes.
 * Provides the central state for self-evolution: thresholds,
 * learned patterns, generated checks, and incident history.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  GenomeState,
  ThresholdConfig,
  LearnedPattern,
  GeneratedCheck,
  IncidentSummary,
  FixRecord,
  LogEntry,
} from '../types';
import { IMMUNE_FILES, THRESHOLDS, CHECK_INTERVALS, PROJECT_ROOT } from '../config';
import { analyzeIncidents } from './evolution-log';
import { tuneThresholds } from './threshold-tuner';
import { generateChecks } from './check-generator';
const PREFIX = '[Immune:Genome]';

export class GenomeStateManager {
  private filePath: string;
  private state: GenomeState;

  constructor() {
    this.filePath = path.join(PROJECT_ROOT, IMMUNE_FILES.genome);
    this.state = this.load();
  }

  load(): GenomeState {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw) as GenomeState;
        console.log(`${PREFIX} Loaded genome state (v${parsed.version}, ${parsed.evolutionCycles} cycles)`);
        return parsed;
      }
    } catch (err) {
      console.warn(`${PREFIX} Failed to load genome state, starting fresh:`, err);
    }
    console.log(`${PREFIX} Initializing default genome state`);
    return this.defaultState();
  }

  save(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf-8');
    fs.renameSync(tmp, this.filePath);
  }

  getState(): GenomeState {
    return this.state;
  }

  getThreshold(checkId: string): number {
    const config = this.state.thresholds[checkId];
    if (!config) return 0;
    return config.currentValue ?? config.defaultValue;
  }

  updateThreshold(checkId: string, config: Partial<ThresholdConfig>): void {
    if (this.state.thresholds[checkId]) {
      Object.assign(this.state.thresholds[checkId], config);
      this.state.thresholds[checkId].lastAdjusted = Date.now();
      this.state.updatedAt = Date.now();
    }
  }

  addLearnedPattern(pattern: LearnedPattern): void {
    const existing = this.state.learnedPatterns.find((p) => p.id === pattern.id);
    if (existing) {
      existing.timesTriggered++;
    } else {
      this.state.learnedPatterns.push(pattern);
    }
    this.state.updatedAt = Date.now();
  }

  addGeneratedCheck(check: GeneratedCheck): void {
    const existing = this.state.generatedChecks.find((c) => c.id === check.id);
    if (existing) {
      Object.assign(existing, check);
    } else {
      this.state.generatedChecks.push(check);
    }
    this.state.updatedAt = Date.now();
  }

  updateIncidentLog(summary: IncidentSummary): void {
    const idx = this.state.incidentLog.findIndex((s) => s.checkId === summary.checkId);
    if (idx >= 0) {
      this.state.incidentLog[idx] = summary;
    } else {
      this.state.incidentLog.push(summary);
    }
    this.state.updatedAt = Date.now();
  }

  incrementEvolutionCycles(): void {
    this.state.evolutionCycles++;
    this.state.updatedAt = Date.now();
  }

  /**
   * Run a full evolution cycle: analyze incidents, tune thresholds, generate checks.
   */
  runEvolutionCycle(fixHistory: FixRecord[], logs: LogEntry[]): void {
    console.log(`${PREFIX} Starting evolution cycle #${this.state.evolutionCycles + 1}`);

    // Phase 1: Analyze incidents from fix history and logs
    const incidents = analyzeIncidents(fixHistory, logs);
    for (const incident of incidents) {
      this.updateIncidentLog(incident);
    }
    console.log(`${PREFIX} Phase 1 complete: ${incidents.length} incident summaries`);

    // Phase 2: Tune thresholds based on incident analysis
    tuneThresholds(this, incidents);
    console.log(`${PREFIX} Phase 2 complete: thresholds tuned`);

    // Phase 3: Generate new checks from fix patterns
    const newChecks = generateChecks(this, fixHistory);
    for (const check of newChecks) {
      this.addGeneratedCheck(check);
    }
    console.log(`${PREFIX} Phase 3 complete: ${newChecks.length} checks generated`);

    this.incrementEvolutionCycles();
    this.save();
    console.log(`${PREFIX} Evolution cycle complete. Total cycles: ${this.state.evolutionCycles}`);
  }

  private defaultState(): GenomeState {
    return {
      version: 1,
      updatedAt: Date.now(),
      thresholds: this.buildDefaultThresholds(),
      learnedPatterns: [],
      generatedChecks: [],
      incidentLog: [],
      evolutionCycles: 0,
    };
  }

  private buildDefaultThresholds(): Record<string, ThresholdConfig> {
    const thresholds: Record<string, ThresholdConfig> = {};
    const now = Date.now();

    const entries: Array<{ checkId: string; defaultValue: number }> = [
      { checkId: 'maxMemoryMiB', defaultValue: THRESHOLDS.maxMemoryMiB },
      { checkId: 'maxRestartsPerHour', defaultValue: THRESHOLDS.maxRestartsPerHour },
      { checkId: 'apiTimeoutMs', defaultValue: THRESHOLDS.apiTimeoutMs },
      { checkId: 'maxBlockStalenessS', defaultValue: THRESHOLDS.maxBlockStalenessS },
      { checkId: 'maxStateAgeMins', defaultValue: THRESHOLDS.maxStateAgeMins },
      { checkId: 'minActiveSourcesOrStrategies', defaultValue: THRESHOLDS.minActiveSourcesOrStrategies },
      { checkId: 'minConfidenceFloor', defaultValue: THRESHOLDS.minConfidenceFloor },
      { checkId: 'compositeScoreDrift', defaultValue: THRESHOLDS.compositeScoreDrift },
      { checkId: 'expectedStrategyCount', defaultValue: THRESHOLDS.expectedStrategyCount },
      { checkId: 'maxTradeAgeHours', defaultValue: THRESHOLDS.maxTradeAgeHours },
      { checkId: 'alertDedupWindowMs', defaultValue: THRESHOLDS.alertDedupWindowMs },
      { checkId: 'maxFixAttempts', defaultValue: THRESHOLDS.maxFixAttempts },
      { checkId: 'maxFixesPerHour', defaultValue: THRESHOLDS.maxFixesPerHour },
      { checkId: 'fixCooldownMs', defaultValue: THRESHOLDS.fixCooldownMs },
    ];

    for (const entry of entries) {
      thresholds[entry.checkId] = {
        checkId: entry.checkId,
        defaultValue: entry.defaultValue,
        currentValue: entry.defaultValue,
        minBound: entry.defaultValue * THRESHOLDS.thresholdMinMultiplier,
        maxBound: entry.defaultValue * THRESHOLDS.thresholdMaxMultiplier,
        lastAdjusted: now,
        falsePositiveRate: 0,
        missedIncidentRate: 0,
      };
    }

    return thresholds;
  }
}
