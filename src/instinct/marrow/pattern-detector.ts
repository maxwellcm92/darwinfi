/**
 * pattern-detector.ts - Detects repeatable operational patterns
 *
 * Watches for:
 *   1. Same prompt called >10x with only token/price substitution
 *   2. Same sequential steps repeated
 *   3. Batch opportunities (N separate API calls for N tokens)
 */

import * as fs from 'fs';
import * as path from 'path';
import { DetectedPattern } from '../types';

const PATTERNS_PATH = path.resolve(process.cwd(), 'data/instinct/marrow-patterns.json');

interface OperationLog {
  timestamp: number;
  operation: string;     // e.g. 'ai_prediction', 'candle_fetch', 'event_collection'
  target: string;        // e.g. token symbol
  parameters: string;    // Serialized params for dedup
  durationMs: number;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export class PatternDetector {
  private operations: OperationLog[] = [];
  private patterns: Map<string, DetectedPattern> = new Map();
  private maxOperations: number = 5000;

  constructor() {
    this.loadPatterns();
  }

  /**
   * Log an operation for pattern analysis.
   */
  logOperation(operation: string, target: string, parameters: string, durationMs: number): void {
    this.operations.push({
      timestamp: Date.now(),
      operation,
      target,
      parameters,
      durationMs,
    });

    // Trim old operations
    if (this.operations.length > this.maxOperations) {
      this.operations = this.operations.slice(-this.maxOperations);
    }
  }

  /**
   * Analyze logged operations for repeatable patterns.
   * Called during the 4h evolution tick.
   */
  detectPatterns(): DetectedPattern[] {
    const newPatterns: DetectedPattern[] = [];

    // 1. Detect repeated prompts (same operation, different targets)
    newPatterns.push(...this.detectRepeatedOperations());

    // 2. Detect batch opportunities (same operation for multiple targets in sequence)
    newPatterns.push(...this.detectBatchOpportunities());

    // 3. Detect sequential patterns (same sequence of operations repeated)
    newPatterns.push(...this.detectSequentialPatterns());

    // Merge with existing patterns
    for (const pattern of newPatterns) {
      const existing = this.patterns.get(pattern.id);
      if (existing) {
        existing.occurrences = Math.max(existing.occurrences, pattern.occurrences);
        existing.lastSeenAt = pattern.lastSeenAt;
      } else {
        this.patterns.set(pattern.id, pattern);
      }
    }

    this.savePatterns();
    return Array.from(this.patterns.values());
  }

  /**
   * Find operations called >10x with only target substitution.
   */
  private detectRepeatedOperations(): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];
    const opCounts = new Map<string, { count: number; targets: Set<string>; firstSeen: number; lastSeen: number }>();

    for (const op of this.operations) {
      const key = op.operation;
      if (!opCounts.has(key)) {
        opCounts.set(key, { count: 0, targets: new Set(), firstSeen: op.timestamp, lastSeen: op.timestamp });
      }
      const entry = opCounts.get(key)!;
      entry.count++;
      entry.targets.add(op.target);
      entry.lastSeen = Math.max(entry.lastSeen, op.timestamp);
    }

    for (const [operation, data] of opCounts) {
      if (data.count > 10 && data.targets.size > 1) {
        patterns.push({
          id: `repeated_${operation}`,
          type: 'repeated_prompt',
          description: `Operation "${operation}" called ${data.count}x across ${data.targets.size} targets`,
          occurrences: data.count,
          firstSeenAt: data.firstSeen,
          lastSeenAt: data.lastSeen,
          estimatedSavings: `Template could reduce ${data.count} calls to ${data.targets.size} with variable substitution`,
          automated: false,
        });
      }
    }

    return patterns;
  }

  /**
   * Find cases where the same operation runs for multiple targets in rapid succession.
   */
  private detectBatchOpportunities(): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];
    const RAPID_THRESHOLD_MS = 5000; // Operations within 5s are "rapid succession"

    // Group sequential operations of the same type
    let currentGroup: OperationLog[] = [];
    const groups: OperationLog[][] = [];

    for (const op of this.operations) {
      if (currentGroup.length === 0 || (
        op.operation === currentGroup[0].operation &&
        op.timestamp - currentGroup[currentGroup.length - 1].timestamp < RAPID_THRESHOLD_MS
      )) {
        currentGroup.push(op);
      } else {
        if (currentGroup.length >= 3) groups.push([...currentGroup]);
        currentGroup = [op];
      }
    }
    if (currentGroup.length >= 3) groups.push(currentGroup);

    // Count groups by operation type
    const groupCounts = new Map<string, number>();
    for (const group of groups) {
      const key = group[0].operation;
      groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
    }

    for (const [operation, count] of groupCounts) {
      if (count >= 3) {
        const avgSize = groups.filter(g => g[0].operation === operation)
          .reduce((s, g) => s + g.length, 0) / count;

        patterns.push({
          id: `batch_${operation}`,
          type: 'batch_opportunity',
          description: `"${operation}" runs ${Math.round(avgSize)} sequential calls that could be batched`,
          occurrences: count,
          firstSeenAt: groups[0][0].timestamp,
          lastSeenAt: groups[groups.length - 1][0].timestamp,
          estimatedSavings: `Batching could reduce ${Math.round(avgSize)} API calls to 1-2`,
          automated: false,
        });
      }
    }

    return patterns;
  }

  /**
   * Find repeated sequences of different operations.
   */
  private detectSequentialPatterns(): DetectedPattern[] {
    const patterns: DetectedPattern[] = [];
    if (this.operations.length < 6) return patterns;

    // Look for 3-step sequences that repeat
    const SEQUENCE_LENGTH = 3;
    const sequences = new Map<string, { count: number; firstSeen: number; lastSeen: number }>();

    for (let i = 0; i <= this.operations.length - SEQUENCE_LENGTH; i++) {
      const seq = this.operations.slice(i, i + SEQUENCE_LENGTH)
        .map(op => op.operation)
        .join(' -> ');

      if (!sequences.has(seq)) {
        sequences.set(seq, { count: 0, firstSeen: this.operations[i].timestamp, lastSeen: this.operations[i].timestamp });
      }
      const entry = sequences.get(seq)!;
      entry.count++;
      entry.lastSeen = this.operations[i].timestamp;
    }

    for (const [seq, data] of sequences) {
      if (data.count >= 5) {
        patterns.push({
          id: `seq_${seq.replace(/[^a-z0-9]/gi, '_').slice(0, 50)}`,
          type: 'sequential_steps',
          description: `Sequence "${seq}" repeated ${data.count}x`,
          occurrences: data.count,
          firstSeenAt: data.firstSeen,
          lastSeenAt: data.lastSeen,
          estimatedSavings: 'Could be turned into a single n8n workflow',
          automated: false,
        });
      }
    }

    return patterns;
  }

  getPatterns(): DetectedPattern[] {
    return Array.from(this.patterns.values());
  }

  getUnanautomatedPatterns(): DetectedPattern[] {
    return Array.from(this.patterns.values()).filter(p => !p.automated);
  }

  markAutomated(patternId: string, workflowId: string): void {
    const pattern = this.patterns.get(patternId);
    if (pattern) {
      pattern.automated = true;
      pattern.workflowId = workflowId;
      this.savePatterns();
    }
  }

  private loadPatterns(): void {
    try {
      if (fs.existsSync(PATTERNS_PATH)) {
        const data = JSON.parse(fs.readFileSync(PATTERNS_PATH, 'utf-8'));
        for (const p of data) this.patterns.set(p.id, p);
      }
    } catch { /* ignore */ }
  }

  private savePatterns(): void {
    ensureDir(path.dirname(PATTERNS_PATH));
    const tmpPath = PATTERNS_PATH + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(Array.from(this.patterns.values()), null, 2), 'utf-8');
    fs.renameSync(tmpPath, PATTERNS_PATH);
  }
}
