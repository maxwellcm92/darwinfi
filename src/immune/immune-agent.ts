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
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

import { CheckResult, ImmuneHealthSummary, DivisionStatus } from './types';
import { CHECK_INTERVALS, IMMUNE_FILES, PROJECT_ROOT, MONITORED_PROCESSES } from './config';
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

    // Per-process recheck functions for fix-engine verification
    for (const proc of MONITORED_PROCESSES) {
      this.checkFunctions.set(proc.checkId, () =>
        import('./patrol/process-patrol').then(m => m.checkSingleProcessHealth(proc))
      );
    }

    // Initialize division statuses
    for (const div of ['Patrol', 'Antibodies', 'Thymus', 'Platelets', 'Membrane', 'Lymph', 'Genome']) {
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

    // Write immune state to disk every 30s
    this.stateWriteTimer = setInterval(() => this.writeStateToDisk(), 30_000);

    this.logger.info('Agent', 'All divisions online. Immune system fully operational.');
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
    const summary: ImmuneHealthSummary = {
      updatedAt: Date.now(),
      overall: this.alertManager.getOverallSeverity(),
      divisions: { ...this.divisionStatus },
      activeAlerts: this.alertManager.getActiveAlerts().length,
      fixesLast24h: this.fixHistory.getRecentFixes(500).filter(f => f.appliedAt >= Date.now() - 24 * 60 * 60_000).length,
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
      default:
        return 'Lymph';
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
