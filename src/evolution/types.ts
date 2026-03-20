/**
 * DarwinFi Evolution Engine - Type Definitions
 */

export type MutabilityRing = 'immutable' | 'evolvable' | 'additive';

export interface FileRingMapping {
  pattern: string; // glob pattern
  ring: MutabilityRing;
  description: string;
}

export type ProposalStatus =
  | 'pending' | 'validating' | 'sandboxing' | 'testing'
  | 'canary' | 'evaluating' | 'promoted' | 'rejected' | 'rolled_back';

export interface EvolutionProposal {
  id: string; // UUID
  createdAt: number; // Unix ms
  status: ProposalStatus;
  targetZone: string; // e.g. 'trading/indicators', 'instinct/reflexes'
  targetFiles: string[]; // relative paths from project root
  rationale: string; // AI-generated reasoning
  diff: string; // unified diff
  diffHash: string; // SHA256 of diff for dedup
  linesAdded: number;
  linesModified: number;
  filesChanged: number;
  aiModel: string; // e.g. 'llama-3.3-70b'
  aiPromptTokens: number;
  aiCompletionTokens: number;

  // Pipeline results
  staticValidation?: ValidationResult;
  sandboxResult?: SandboxResult;
  testResult?: TestResult;
  canaryState?: CanaryState;
  evaluationResult?: EvaluationResult;

  // Outcome
  rejectionReason?: string;
  promotedAt?: number;
  rolledBackAt?: number;
  rollbackReason?: string;
}

export interface ValidationResult {
  passed: boolean;
  ringViolations: string[];
  forbiddenPatterns: string[];
  sizeViolations: string[];
  errors: string[];
}

export interface SandboxResult {
  passed: boolean;
  worktreePath: string;
  branch: string;
  compilationOutput: string;
  compilationErrors: string[];
}

export interface TestResult {
  passed: boolean;
  totalTests: number;
  passingTests: number;
  failingTests: number;
  pendingTests: number;
  durationMs: number;
  failures: string[];
  output: string;
}

export interface CanaryState {
  active: boolean;
  startedAt: number;
  proposalId: string;
  branch: string;
  baselineMetrics: CanaryMetrics;
  currentMetrics: CanaryMetrics;
  checkCount: number;
  lastCheckAt: number;
}

export interface CanaryMetrics {
  pnlDelta: number; // as fraction of TVL
  errorRate: number; // errors per minute
  crashCount: number; // in last 10min
  processUptime: number; // seconds
  sharePriceDelta: number; // change since canary start
}

export interface EvaluationResult {
  passed: boolean;
  pnlDelta: number;
  errorRateDelta: number;
  crashCount: number;
  reason: string;
}

export interface VelocityLimits {
  maxProposalsPerDay: number;
  minTimeBetweenProposals: number; // ms
  maxConcurrentCanaries: number;
  forcedCooldownAfterRollback: number; // ms
  maxDiffLinesAdded: number;
  maxDiffLinesModified: number;
  maxFilesPerProposal: number;
  minCanaryDuration: number; // ms
}

export interface AntiLoopEntry {
  proposalId: string;
  diffHash: string;
  zone: string;
  targetFiles: string[];
  timestamp: number;
  outcome: 'promoted' | 'rejected' | 'rolled_back';
  rejectionReason?: string;
}

export interface AntiLoopMemory {
  entries: AntiLoopEntry[];
  zoneBackoff: Record<string, ZoneBackoff>;
  lastProposalTime: number;
  proposalsToday: number;
  todayDate: string; // YYYY-MM-DD
}

export interface ZoneBackoff {
  zone: string;
  consecutiveFailures: number;
  backoffUntil: number; // Unix ms
  lastFailure: number;
}

export interface AuditEntry {
  timestamp: number;
  event: string;
  proposalId?: string;
  details: Record<string, unknown>;
}

export interface EvolutionConfig {
  enabled: boolean;
  dryRun: boolean; // generate proposals but don't deploy
  cycleIntervalMs: number;
  velocityLimits: VelocityLimits;
  rollbackThresholds: {
    maxPnlDropPct: number; // -2% TVL
    maxErrorRateIncreasePct: number; // +50%
    maxCrashesIn10Min: number; // 3
  };
  antiLoop: {
    maxConsecutiveFailuresBeforeBackoff: number; // 3
    initialBackoffMs: number; // 24h
    maxBackoffMs: number; // 7 days
    backoffMultiplier: number; // 2 (exponential)
    maxSameFileConsecutive: number; // 3
    failedPromptsToInject: number; // 5
  };
  aiEndpoint: string;
  aiModel: string;
  aiApiKey: string;
}
