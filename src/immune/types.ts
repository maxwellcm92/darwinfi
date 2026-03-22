/**
 * DarwinFi Immune System - Core Type Definitions
 *
 * Shared interfaces used across all immune divisions:
 * Patrol, Antibodies, Thymus, Platelets, Membrane, Lymph, Genome.
 */

// ---------------------------------------------------------------------------
// Check Results
// ---------------------------------------------------------------------------

export type CheckSeverity = 'ok' | 'warning' | 'error' | 'critical';
export type CheckCategory =
  | 'process' | 'api' | 'chain' | 'state' | 'instinct'
  | 'math' | 'invariant' | 'membrane' | 'integration'
  | 'test' | 'security' | 'genome' | 'evolution';

export interface CheckResult {
  checkId: string;
  category: CheckCategory;
  severity: CheckSeverity;
  message: string;
  details?: Record<string, unknown>;
  timestamp: number; // Unix ms
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Fix Records (Platelets)
// ---------------------------------------------------------------------------

export type FixSafety = 'safe' | 'risky' | 'manual';

export interface FixRecord {
  id: string;
  checkId: string;
  fixName: string;
  safety: FixSafety;
  appliedAt: number; // Unix ms
  success: boolean;
  attempts: number;
  beforeSnapshot?: Record<string, unknown>;
  afterSnapshot?: Record<string, unknown>;
  rollback: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Alerts (Lymph)
// ---------------------------------------------------------------------------

export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface Alert {
  id: string;
  checkId: string;
  severity: AlertSeverity;
  message: string;
  details?: Record<string, unknown>;
  createdAt: number; // Unix ms
  resolvedAt?: number;
  acknowledged: boolean;
  fixAttempted: boolean;
  fixSuccess?: boolean;
}

// ---------------------------------------------------------------------------
// Immune State (Dashboard)
// ---------------------------------------------------------------------------

export interface ImmuneHealthSummary {
  updatedAt: number;
  overall: CheckSeverity;
  divisions: Record<string, DivisionStatus>;
  activeAlerts: number;
  fixesLast24h: number;
  lastTestRun?: TestRunSummary;
  divisionScores?: Record<string, number>;
}

export interface DivisionStatus {
  name: string;
  status: CheckSeverity;
  lastCheck: number;
  checksRun: number;
  checksFailed: number;
  message: string;
}

export interface TestRunSummary {
  timestamp: number;
  passing: number;
  failing: number;
  pending: number;
  duration: number;
  failures: string[];
}

// ---------------------------------------------------------------------------
// Genome (Self-Evolution)
// ---------------------------------------------------------------------------

export interface GenomeState {
  version: number;
  updatedAt: number;
  thresholds: Record<string, ThresholdConfig>;
  learnedPatterns: LearnedPattern[];
  generatedChecks: GeneratedCheck[];
  incidentLog: IncidentSummary[];
  evolutionCycles: number;
}

export interface ThresholdConfig {
  checkId: string;
  defaultValue: number;
  currentValue: number;
  minBound: number; // 0.5x default
  maxBound: number; // 2.0x default
  lastAdjusted: number;
  falsePositiveRate: number;
  missedIncidentRate: number;
}

export interface LearnedPattern {
  id: string;
  trigger: string; // e.g. "pm2_restart_memory > 3x/24h"
  action: string; // e.g. "generate_memory_growth_check"
  learnedAt: number;
  timesTriggered: number;
}

export interface GeneratedCheck {
  id: string;
  name: string;
  description: string;
  generatedAt: number;
  sourcePattern: string;
  intervalMs: number;
  enabled: boolean;
  checkFn: string; // serialized check function name
  thresholds: Record<string, number>;
}

export interface IncidentSummary {
  checkId: string;
  count: number;
  lastOccurred: number;
  fixSuccessRate: number;
  falsePositives: number;
  meanDetectionMs: number;
}

// ---------------------------------------------------------------------------
// Log Entry
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  division: string;
  message: string;
  checkId?: string;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Fix Registry Types
// ---------------------------------------------------------------------------

export type FixFunction = () => Promise<boolean>;

export interface FixRegistryEntry {
  checkId: string;
  fixName: string;
  safety: FixSafety;
  description: string;
  fixFn: FixFunction;
  verifyDelayMs?: number;
}
