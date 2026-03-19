/**
 * DarwinFi Immune System - Log Aggregator
 *
 * Structured logging with atomic writes to data/immune/immune-log.json.
 * FIFO buffer capped at maxLogEntries. Every division writes through this.
 */

import * as fs from 'fs';
import * as path from 'path';
import { LogEntry, LogLevel } from '../types';
import { IMMUNE_FILES, THRESHOLDS, PROJECT_ROOT } from '../config';

export class LogAggregator {
  private entries: LogEntry[] = [];
  private filePath: string;
  private maxEntries: number;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private dirty = false;

  constructor(maxEntries = THRESHOLDS.maxLogEntries) {
    this.filePath = path.join(PROJECT_ROOT, IMMUNE_FILES.log);
    this.maxEntries = maxEntries;
    this.load();
  }

  /**
   * Add a log entry. Prints to console and buffers for disk write.
   */
  log(level: LogLevel, division: string, message: string, checkId?: string, details?: Record<string, unknown>): void {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      division,
      message,
      ...(checkId && { checkId }),
      ...(details && { details }),
    };

    this.entries.push(entry);
    this.dirty = true;

    // Enforce FIFO cap
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    // Console output with prefix
    const prefix = `[Immune:${division}]`;
    const ts = new Date(entry.timestamp).toISOString();
    switch (level) {
      case 'critical':
      case 'error':
        console.error(`${ts} ${prefix} [${level.toUpperCase()}] ${message}`);
        break;
      case 'warn':
        console.warn(`${ts} ${prefix} [WARN] ${message}`);
        break;
      default:
        console.log(`${ts} ${prefix} [${level.toUpperCase()}] ${message}`);
    }
  }

  // Convenience methods
  debug(division: string, message: string, checkId?: string, details?: Record<string, unknown>): void {
    this.log('debug', division, message, checkId, details);
  }
  info(division: string, message: string, checkId?: string, details?: Record<string, unknown>): void {
    this.log('info', division, message, checkId, details);
  }
  warn(division: string, message: string, checkId?: string, details?: Record<string, unknown>): void {
    this.log('warn', division, message, checkId, details);
  }
  error(division: string, message: string, checkId?: string, details?: Record<string, unknown>): void {
    this.log('error', division, message, checkId, details);
  }
  critical(division: string, message: string, checkId?: string, details?: Record<string, unknown>): void {
    this.log('critical', division, message, checkId, details);
  }

  /**
   * Get recent log entries, optionally filtered.
   */
  getEntries(opts?: { level?: LogLevel; division?: string; since?: number; limit?: number }): LogEntry[] {
    let filtered = this.entries;
    if (opts?.level) filtered = filtered.filter(e => e.level === opts.level);
    if (opts?.division) filtered = filtered.filter(e => e.division === opts.division);
    if (opts?.since) filtered = filtered.filter(e => e.timestamp >= opts.since!);
    if (opts?.limit) filtered = filtered.slice(-opts.limit);
    return filtered;
  }

  /**
   * Start periodic flush to disk (every 10s if dirty).
   */
  startFlush(intervalMs = 10_000): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      if (this.dirty) this.flush();
    }, intervalMs);
  }

  /**
   * Stop periodic flush and do a final write.
   */
  stopFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.dirty) this.flush();
  }

  /**
   * Atomic write to disk (tmp + rename pattern).
   */
  flush(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const tmpPath = this.filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(this.entries, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
      this.dirty = false;
    } catch (err) {
      console.error(`[Immune:Lymph] Failed to flush log: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Load existing log from disk on startup.
   */
  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.entries = parsed.slice(-this.maxEntries);
        }
      }
    } catch {
      // Start fresh if corrupt
      this.entries = [];
    }
  }

  /**
   * Get total entry count.
   */
  get count(): number {
    return this.entries.length;
  }
}
