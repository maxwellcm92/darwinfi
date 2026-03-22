/**
 * DarwinFi Immune System - Main Orchestrator
 *
 * PM2 entry point that coordinates all seven immune divisions:
 * Patrol, Antibodies, Thymus, Platelets, Membrane, Lymph, Genome.
 *
 * Runs as a separate PM2 process (darwinfi-immune) so it can
 * monitor and restart the main agent independently.
 *
 * Usage: pm2 start dist/src/immune/immune-agent.js --name darwinfi-immune --max-memory-restart 150M
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

import { CheckResult, ImmuneHealthSummary, DivisionStatus } from './types';
import { CHECK_INTERVALS, IMMUNE_FILES, PROJECT_ROOT, MONITORED_PROCESSES } from './config';
import { ContractClient } from '../chain/contract-client';
import { LogAggregator } from './lymph/log-aggregator';
import { AlertManager } from './lymph/alert-manager';
import { PatrolScheduler } from './patrol/patrol-scheduler';
import { FixEngine } from './platelets/fix-engine';
import { FixHistory } from './platelets/fix-history';
import { GenomeStateManager } from './genome/genome-state';
import { analyzeIncidents } from './genome/evolution-log';
import { tuneThresholds } from './genome/threshold-tuner';
import { generateChecks } from './genome/check-generator';

// Antibody checks (run on longer intervals)
import { verifyMath } from './antibodies/math-verifier';
import { checkStateInvariants } from './antibodies/state-invariants';
import { runHardhatTests } from './antibodies/test-runner';
import { checkIntegration } from './antibodies/integration-checks';

// Membrane checks
import { auditSharePrice } from './membrane/share-price-auditor';
import { checkVaultConsistency } from './membrane/vault-consistency';
import { checkUiTruth } from './membrane/ui-truth-checker';

// Thymus checks
import { scanDependencies } from './thymus/dependency-scanner';
import { scanKeySafety } from './thymus/key-safety';
import { scanContracts } from './thymus/contract-scanner';
import { scanApiExposure } from './thymus/api-exposure';

// ---------------------------------------------------------------------------
// Immune Agent
// ---------------------------------------------------------------------------

class ImmuneAgent {
  private logger: LogAggregator;
  private alertManager: AlertManager;
  private patrolScheduler: PatrolScheduler;
  private fixEngine: FixEngine;
  private fixHistory: FixHistory;
  private genomeState: GenomeStateManager;
  private contractClient: ContractClient | null = null;

  // Timers for non-patrol checks
  private timers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private stateWriteTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private startTime = Date.now();

  // Division status tracking
  private divisionStatus: Record<string, DivisionStatus> = {};

  // Check function registry (for fix-engine re-verification)
  private checkFunctions: Map<string, () => Promise<CheckResult>> = new Map();

  constructor() {
    this.logger = new LogAggregator();
    this.alertManager = new AlertManager(this.logger);

    // On-chain logging (optional -- only if PerformanceLog deployed)
    try {
      if (process.env.PERFORMANCE_LOG_ADDRESS) {
        this.contractClient = new ContractClient();
      }
    } catch {
      this.contractClient = null;
    }
    this.fixEngine = new FixEngine(this.logger, this.alertManager);
    this.fixHistory = this.fixEngine.getHistory();
    this.genomeState = new GenomeStateManager();
    this.patrolScheduler = new PatrolScheduler(this.logger, (result) => this.handleCheckResult(result));

    // Register all check functions for re-verification by fix engine
    // Use exact checkId values matching what each module returns
    this.checkFunctions.set('antibody.math_verifier', verifyMath);
    this.checkFunctions.set('antibody.state_invariants', checkStateInvariants);
    this.checkFunctions.set('membrane.share_price_auditor', auditSharePrice);
    this.checkFunctions.set('membrane.vault_consistency', checkVaultConsistency);
    this.checkFunctions.set('membrane.ui_truth_checker', checkUiTruth);
    this.checkFunctions.set('dep_scan', scanDependencies);
    this.checkFunctions.set('key_safety', scanKeySafety);
    this.checkFunctions.set('contract_scan', scanContracts);
    this.checkFunctions.set('api_exposure', scanApiExposure);
    this.checkFunctions.set('antibody.test_runner', runHardhatTests);
    this.checkFunctions.set('antibody.integration_checks', checkIntegration);
    // Patrol checkIds are handled by PatrolScheduler directly
    this.checkFunctions.set('process_health', () => import('./patrol/process-patrol').then(m => m.checkProcessHealth()));
    this.checkFunctions.set('chain_health', () => import('./patrol/chain-patrol').then(m => m.checkChainHealth()));
    this.checkFunctions.set('state_integrity', () => import('./patrol/state-patrol').then(m => m.checkStateFiles()));
    this.checkFunctions.set('api_probe', () => import('./patrol/api-patrol').then(m => m.checkApiEndpoints()));
    this.checkFunctions.set('instinct_health', () => import('./patrol/instinct-patrol').then(m => m.checkInstinctHealth()));

    // Evolution division check functions
    this.checkFunctions.set('evolution_branch_integrity', () => this.checkEvolutionBranchIntegrity());
    this.checkFunctions.set('evolution_canary_health', () => this.checkEvolutionCanaryHealth());

    // Per-process recheck functions for fix-engine verification
    for (const proc of MONITORED_PROCESSES) {
      this.checkFunctions.set(proc.checkId, () =>
        import('./patrol/process-patrol').then(m => m.checkSingleProcessHealth(proc))
      );
    }

    // Initialize division statuses
    for (const div of ['Patrol', 'Antibodies', 'Thymus', 'Platelets', 'Membrane', 'Lymph', 'Genome', 'Evolution']) {
      this.divisionStatus[div] = {
        name: div,
        status: 'ok',
        lastCheck: 0,
        checksRun: 0,
        checksFailed: 0,
        message: 'Initializing',
      };
    }
  }

  /**
   * Start all immune divisions.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.startTime = Date.now();

    this.logger.info('Agent', 'DarwinFi Immune System starting...');
    this.logger.startFlush();

    // Phase 1: Start Patrol (core monitoring)
    this.patrolScheduler.start();
    this.divisionStatus['Patrol'].message = 'Active';
    this.logger.info('Agent', 'Patrol division online');

    // Phase 2: Schedule Antibody checks
    this.scheduleCheck('math_verification', verifyMath, CHECK_INTERVALS.mathVerification, 'Antibodies');
    this.scheduleCheck('state_invariants', checkStateInvariants, CHECK_INTERVALS.stateInvariants, 'Antibodies');
    this.scheduleCheck('integration', checkIntegration, CHECK_INTERVALS.integrationConsistency, 'Antibodies');
    this.scheduleCheck('test_suite', runHardhatTests, CHECK_INTERVALS.hardhatTests, 'Antibodies');
    this.divisionStatus['Antibodies'].message = 'Active';
    this.logger.info('Agent', 'Antibodies division online');

    // Phase 3: Schedule Membrane checks
    this.scheduleCheck('share_price', auditSharePrice, CHECK_INTERVALS.uiTruth, 'Membrane');
    this.scheduleCheck('vault_consistency', checkVaultConsistency, CHECK_INTERVALS.uiTruth, 'Membrane');
    this.scheduleCheck('ui_truth', checkUiTruth, CHECK_INTERVALS.uiTruth, 'Membrane');
    this.divisionStatus['Membrane'].message = 'Active';
    this.logger.info('Agent', 'Membrane division online');

    // Phase 4: Schedule Thymus checks
    this.scheduleCheck('dep_scan', scanDependencies, CHECK_INTERVALS.depScan, 'Thymus');
    this.scheduleCheck('key_safety', scanKeySafety, CHECK_INTERVALS.keySafety, 'Thymus');
    this.scheduleCheck('contract_scan', scanContracts, CHECK_INTERVALS.contractScan, 'Thymus');
    this.scheduleCheck('api_exposure', scanApiExposure, CHECK_INTERVALS.apiExposure, 'Thymus');
    this.divisionStatus['Thymus'].message = 'Active';
    this.logger.info('Agent', 'Thymus division online');

    // Platelets (self-healing) are event-driven, always ready
    this.divisionStatus['Platelets'].message = 'Standing by';
    this.logger.info('Agent', 'Platelets division standing by');

    // Lymph is already active (logger + alerts)
    this.divisionStatus['Lymph'].message = 'Active';

    // Phase 5: Schedule Genome evolution cycle
    this.scheduleGenomeEvolution();
    this.divisionStatus['Genome'].message = 'Active';
    this.logger.info('Agent', 'Genome division online');

    // Phase 6: Schedule Evolution division checks
    this.scheduleCheck('evolution_branch_integrity', () => this.checkEvolutionBranchIntegrity(), CHECK_INTERVALS.evolutionBranchIntegrity, 'Evolution');
    this.scheduleCheck('evolution_canary_health', () => this.checkEvolutionCanaryHealth(), CHECK_INTERVALS.evolutionCanaryHealth, 'Evolution');
    this.divisionStatus['Evolution'].message = 'Active';
    this.logger.info('Agent', 'Evolution division online');

    // Write immune state to disk every 30s
    this.stateWriteTimer = setInterval(() => this.writeStateToDisk(), 30_000);

    this.logger.info('Agent', 'All divisions online. Immune system fully operational.');
  }

  /**
   * Get numerical scores for each immune division.
   * Used by the GradingDepartment for cross-department comparison.
   */
  getDivisionScores(): Array<{ name: string; score: number; rank: number; metrics: Record<string, number> }> {
    const scores: Array<{ name: string; score: number; metrics: Record<string, number> }> = [];

    for (const [name, status] of Object.entries(this.divisionStatus)) {
      const passRate = status.checksRun > 0
        ? (status.checksRun - status.checksFailed) / status.checksRun
        : 1;
      const uptime = status.status === 'ok' ? 1 : status.status === 'warning' ? 0.7 : 0.3;

      // Score: pass rate 60%, uptime status 30%, checks run volume 10%
      const volumeScore = Math.min(1, (status.checksRun || 0) / 100); // normalize to 0-1
      const score = Math.round((passRate * 60 + uptime * 30 + volumeScore * 10) * 100) / 100;

      scores.push({
        name,
        score,
        metrics: {
          passRate: Math.round(passRate * 100),
          checksRun: status.checksRun,
          checksFailed: status.checksFailed,
          uptimeScore: Math.round(uptime * 100),
        },
      });
    }

    // Rank by score (highest first)
    scores.sort((a, b) => b.score - a.score);
    return scores.map((s, i) => ({ ...s, rank: i + 1 }));
  }

  /**
   * Graceful shutdown.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.logger.info('Agent', 'Immune system shutting down...');

    // Stop patrol
    this.patrolScheduler.stop();

    // Stop all scheduled checks
    for (const [name, timer] of this.timers) {
      clearInterval(timer);
      this.logger.debug('Agent', `Stopped timer: ${name}`);
    }
    this.timers.clear();

    // Stop state writer
    if (this.stateWriteTimer) {
      clearInterval(this.stateWriteTimer);
      this.stateWriteTimer = null;
    }

    // Final state write and log flush
    this.writeStateToDisk();
    this.logger.stopFlush();
    this.logger.info('Agent', 'Immune system shutdown complete');
  }

  /**
   * Log critical immune actions on-chain for transparency.
   */
  private async logImmuneOnChain(action: 'fix_applied' | 'alert_raised' | 'division_degraded', details: string): Promise<void> {
    try {
      if (this.contractClient?.hasPerformanceLog()) {
        await this.contractClient.logImmuneAction(action, details);
      }
    } catch {
      // Non-critical: don't block immune system for on-chain logging
    }
  }

  /**
   * Central handler for all check results.
   * Routes through alert manager and fix engine.
   */
  private async handleCheckResult(result: CheckResult): Promise<void> {
    // Update division status
    const division = this.categoryToDivision(result.category);
    if (this.divisionStatus[division]) {
      const ds = this.divisionStatus[division];
      ds.lastCheck = result.timestamp;
      ds.checksRun++;
      if (result.severity !== 'ok') {
        ds.checksFailed++;
        if (this.severityRank(result.severity) > this.severityRank(ds.status)) {
          ds.status = result.severity;
        }
        ds.message = result.message;
      } else {
        // Reset division status if all checks passing
        ds.status = 'ok';
        ds.message = 'All checks passing';
      }
    }

    // Route through alert manager
    const alert = this.alertManager.processCheck(result);

    // If critical or error, attempt self-healing
    if (alert && (result.severity === 'critical' || result.severity === 'error')) {
      const recheckFn = this.checkFunctions.get(result.checkId);
      if (recheckFn) {
        await this.fixEngine.processCheckResult(result, recheckFn);
      }
      // Log critical immune actions on-chain for transparency
      await this.logImmuneOnChain('alert_raised', `${result.checkId}: ${result.message.slice(0, 80)}`);
    }
  }

  /**
   * Schedule a check on an interval with initial stagger.
   */
  private scheduleCheck(
    name: string,
    checkFn: () => Promise<CheckResult>,
    intervalMs: number,
    division: string,
  ): void {
    // Stagger initial run (0-30s) to avoid thundering herd
    const stagger = Math.floor(Math.random() * 30_000);
    setTimeout(() => {
      this.runCheck(name, checkFn, division);
    }, stagger);

    const timer = setInterval(() => {
      this.runCheck(name, checkFn, division);
    }, intervalMs);
    this.timers.set(name, timer);
  }

  /**
   * Execute a single check with error handling.
   */
  private async runCheck(name: string, checkFn: () => Promise<CheckResult>, division: string): Promise<void> {
    if (!this.running) return;
    try {
      const result = await checkFn();
      await this.handleCheckResult(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(division, `Check ${name} threw: ${msg}`, name);
    }
  }

  /**
   * Run the Genome evolution cycle (every 12h).
   */
  private scheduleGenomeEvolution(): void {
    // Run once after 5 min warm-up, then every 12h
    setTimeout(() => this.runGenomeCycle(), 5 * 60_000);
    const timer = setInterval(() => this.runGenomeCycle(), CHECK_INTERVALS.genomeEvolution);
    this.timers.set('genome_evolution', timer);
  }

  private async runGenomeCycle(): Promise<void> {
    if (!this.running) return;
    this.logger.info('Genome', 'Starting evolution cycle');

    try {
      // Phase 1: Incident analysis
      const fixes = this.fixHistory.getRecentFixes(500);
      const logs = this.logger.getEntries({ since: Date.now() - 24 * 60 * 60_000 });
      const incidents = analyzeIncidents(fixes, logs);

      // Phase 2: Threshold tuning
      tuneThresholds(this.genomeState, incidents);

      // Phase 3: Check generation
      const newChecks = generateChecks(this.genomeState, fixes);
      if (newChecks.length > 0) {
        this.logger.info('Genome', `Generated ${newChecks.length} new checks`);
      }

      // Save updated genome state
      this.genomeState.incrementEvolutionCycles();
      this.genomeState.save();

      this.divisionStatus['Genome'].lastCheck = Date.now();
      this.divisionStatus['Genome'].checksRun++;
      this.logger.info('Genome', `Evolution cycle complete (#${this.genomeState.getState().evolutionCycles})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error('Genome', `Evolution cycle failed: ${msg}`);
      this.divisionStatus['Genome'].checksFailed++;
    }
  }

  /**
   * Write immune health summary to disk (read by dashboard).
   */
  private writeStateToDisk(): void {
    // Compute division scores for grading department
    const divisionScores: Record<string, number> = {};
    for (const [name, status] of Object.entries(this.divisionStatus)) {
      const passRate = status.checksRun > 0
        ? (status.checksRun - status.checksFailed) / status.checksRun
        : 1;
      const uptime = status.status === 'ok' ? 1 : status.status === 'warning' ? 0.7 : 0.3;
      const volumeScore = Math.min(1, (status.checksRun || 0) / 100);
      divisionScores[name] = Math.round((passRate * 60 + uptime * 30 + volumeScore * 10) * 100) / 100;
    }

    const summary: ImmuneHealthSummary = {
      updatedAt: Date.now(),
      overall: this.alertManager.getOverallSeverity(),
      divisions: { ...this.divisionStatus },
      activeAlerts: this.alertManager.getActiveAlerts().length,
      fixesLast24h: this.fixHistory.getRecentFixes(500).filter(f => f.appliedAt >= Date.now() - 24 * 60 * 60_000).length,
      divisionScores,
    };

    const filePath = path.join(PROJECT_ROOT, IMMUNE_FILES.state);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    try {
      const tmp = filePath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(summary, null, 2), 'utf-8');
      fs.renameSync(tmp, filePath);
    } catch (err) {
      console.error(`[Immune:Agent] Failed to write state: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Map check category to division name.
   */
  private categoryToDivision(category: string): string {
    switch (category) {
      case 'process': case 'api': case 'chain': case 'state': case 'instinct':
        return 'Patrol';
      case 'math': case 'invariant': case 'test': case 'integration':
        return 'Antibodies';
      case 'membrane':
        return 'Membrane';
      case 'security':
        return 'Thymus';
      case 'genome':
        return 'Genome';
      case 'evolution':
        return 'Evolution';
      default:
        return 'Lymph';
    }
  }

  /**
   * Evolution check: verify git branch is clean (no uncommitted changes from evolution).
   */
  private async checkEvolutionBranchIntegrity(): Promise<CheckResult> {
    const start = Date.now();
    try {
      const { execSync } = require('child_process');
      const status = execSync('git status --porcelain', { cwd: PROJECT_ROOT, encoding: 'utf-8' }).trim();
      const branch = execSync('git branch --show-current', { cwd: PROJECT_ROOT, encoding: 'utf-8' }).trim();

      if (branch !== 'master' && !branch.startsWith('evolution/')) {
        return {
          checkId: 'evolution_branch_integrity',
          category: 'evolution',
          severity: 'warning',
          message: `Unexpected branch: ${branch} (expected master or evolution/*)`,
          timestamp: Date.now(),
          durationMs: Date.now() - start,
        };
      }

      return {
        checkId: 'evolution_branch_integrity',
        category: 'evolution',
        severity: 'ok',
        message: `Branch: ${branch}, clean: ${status.length === 0}`,
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        checkId: 'evolution_branch_integrity',
        category: 'evolution',
        severity: 'error',
        message: `Git check failed: ${err instanceof Error ? err.message : err}`,
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Evolution check: monitor active canary health.
   * Reads canary-state.json and checks if metrics are degrading.
   */
  private async checkEvolutionCanaryHealth(): Promise<CheckResult> {
    const start = Date.now();
    try {
      const canaryPath = path.join(PROJECT_ROOT, 'data', 'evolution', 'canary-state.json');
      if (!fs.existsSync(canaryPath)) {
        return {
          checkId: 'evolution_canary_health',
          category: 'evolution',
          severity: 'ok',
          message: 'No active canary',
          timestamp: Date.now(),
          durationMs: Date.now() - start,
        };
      }

      const raw = fs.readFileSync(canaryPath, 'utf-8');
      const canaryState = JSON.parse(raw);

      if (!canaryState || !canaryState.active) {
        return {
          checkId: 'evolution_canary_health',
          category: 'evolution',
          severity: 'ok',
          message: 'No active canary',
          timestamp: Date.now(),
          durationMs: Date.now() - start,
        };
      }

      const metrics = canaryState.currentMetrics;
      if (!metrics) {
        return {
          checkId: 'evolution_canary_health',
          category: 'evolution',
          severity: 'warning',
          message: 'Active canary but no metrics yet',
          details: { proposalId: canaryState.proposalId },
          timestamp: Date.now(),
          durationMs: Date.now() - start,
        };
      }

      // Check rollback triggers
      if (metrics.pnlDelta < -0.02) {
        return {
          checkId: 'evolution_canary_health',
          category: 'evolution',
          severity: 'critical',
          message: `Canary PnL drop: ${(metrics.pnlDelta * 100).toFixed(2)}% (threshold: -2%)`,
          details: { proposalId: canaryState.proposalId, metrics },
          timestamp: Date.now(),
          durationMs: Date.now() - start,
        };
      }

      if (metrics.crashCount >= 3) {
        return {
          checkId: 'evolution_canary_health',
          category: 'evolution',
          severity: 'critical',
          message: `Canary crash count: ${metrics.crashCount} (threshold: 3)`,
          details: { proposalId: canaryState.proposalId, metrics },
          timestamp: Date.now(),
          durationMs: Date.now() - start,
        };
      }

      return {
        checkId: 'evolution_canary_health',
        category: 'evolution',
        severity: 'ok',
        message: `Canary active: ${canaryState.proposalId}, PnL: ${(metrics.pnlDelta * 100).toFixed(2)}%`,
        details: { proposalId: canaryState.proposalId, metrics },
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        checkId: 'evolution_canary_health',
        category: 'evolution',
        severity: 'error',
        message: `Canary health check failed: ${err instanceof Error ? err.message : err}`,
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      };
    }
  }

  private severityRank(s: string): number {
    switch (s) {
      case 'critical': return 4;
      case 'error': return 3;
      case 'warning': return 2;
      case 'ok': return 1;
      default: return 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Main Entry Point
// ---------------------------------------------------------------------------

const agent = new ImmuneAgent();

// Graceful shutdown on SIGINT/SIGTERM
process.on('SIGINT', () => { agent.stop(); process.exit(0); });
process.on('SIGTERM', () => { agent.stop(); process.exit(0); });
process.on('uncaughtException', (err) => {
  console.error(`[Immune:Agent] Uncaught exception: ${err.message}`);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error(`[Immune:Agent] Unhandled rejection: ${reason}`);
});

agent.start().catch((err) => {
  console.error(`[Immune:Agent] Failed to start: ${err.message}`);
  process.exit(1);
});
