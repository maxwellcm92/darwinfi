/**
 * DarwinFi Conversation Log
 *
 * Complete audit trail of agent decisions for hackathon judging.
 * Records system events, AI calls, trade decisions, evolution cycles,
 * and promotion events with full context.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogEntryType =
  | 'system'
  | 'agent_decision'
  | 'ai_call'
  | 'trade'
  | 'evolution'
  | 'promotion'
  | 'error';

export interface ConversationLogEntry {
  timestamp: string;
  type: LogEntryType;
  source: string;
  summary: string;
  details?: Record<string, unknown>;
  aiContext?: {
    model: string;
    promptSummary: string;
    responseSummary: string;
    tokensUsed?: number;
  };
}

// ---------------------------------------------------------------------------
// ConversationLog
// ---------------------------------------------------------------------------

const LOG_FILE = 'conversation-log.json';
const MAX_ENTRIES = 5000;

export class ConversationLog {
  private entries: ConversationLogEntry[] = [];
  private dataDir: string;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private dirty: boolean = false;

  constructor(dataDir?: string) {
    this.dataDir = dataDir ?? path.join(process.cwd(), 'data');
    this.loadFromDisk();
  }

  /**
   * Add a log entry.
   */
  log(
    type: LogEntryType,
    source: string,
    summary: string,
    details?: Record<string, unknown>,
    aiContext?: ConversationLogEntry['aiContext'],
  ): void {
    const entry: ConversationLogEntry = {
      timestamp: new Date().toISOString(),
      type,
      source,
      summary,
      details,
      aiContext,
    };

    this.entries.push(entry);
    this.dirty = true;

    // Trim if over max
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }
  }

  /**
   * Convenience: log a system event.
   */
  system(source: string, summary: string, details?: Record<string, unknown>): void {
    this.log('system', source, summary, details);
  }

  /**
   * Convenience: log an agent decision.
   */
  decision(source: string, summary: string, details?: Record<string, unknown>): void {
    this.log('agent_decision', source, summary, details);
  }

  /**
   * Convenience: log an AI API call.
   */
  aiCall(
    source: string,
    summary: string,
    model: string,
    promptSummary: string,
    responseSummary: string,
    details?: Record<string, unknown>,
  ): void {
    this.log('ai_call', source, summary, details, {
      model,
      promptSummary: promptSummary.substring(0, 500),
      responseSummary: responseSummary.substring(0, 500),
    });
  }

  /**
   * Convenience: log a trade event.
   */
  trade(source: string, summary: string, details?: Record<string, unknown>): void {
    this.log('trade', source, summary, details);
  }

  /**
   * Convenience: log an evolution event.
   */
  evolution(source: string, summary: string, details?: Record<string, unknown>): void {
    this.log('evolution', source, summary, details);
  }

  /**
   * Convenience: log a promotion event.
   */
  promotion(source: string, summary: string, details?: Record<string, unknown>): void {
    this.log('promotion', source, summary, details);
  }

  /**
   * Convenience: log an error.
   */
  error(source: string, summary: string, details?: Record<string, unknown>): void {
    this.log('error', source, summary, details);
  }

  /**
   * Get all entries, optionally filtered by type.
   */
  getEntries(type?: LogEntryType, limit?: number): ConversationLogEntry[] {
    let result = this.entries;
    if (type) {
      result = result.filter(e => e.type === type);
    }
    if (limit) {
      result = result.slice(-limit);
    }
    return result;
  }

  /**
   * Get the total count of entries.
   */
  count(): number {
    return this.entries.length;
  }

  /**
   * Get entries as serializable array.
   */
  serialize(): ConversationLogEntry[] {
    return [...this.entries];
  }

  /**
   * Start periodic flushing to disk.
   */
  startPeriodicFlush(intervalMs: number = 30_000): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      if (this.dirty) {
        this.flushToDisk();
      }
    }, intervalMs);
  }

  /**
   * Stop periodic flushing.
   */
  stopPeriodicFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Flush entries to disk.
   */
  flushToDisk(): void {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      const filePath = path.join(this.dataDir, LOG_FILE);
      const tmpPath = filePath + '.tmp';
      const json = JSON.stringify(this.entries, null, 2);
      fs.writeFileSync(tmpPath, json, 'utf-8');
      fs.renameSync(tmpPath, filePath);
      this.dirty = false;
    } catch (err) {
      console.error(
        '[DarwinFi] Failed to flush conversation log:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  /**
   * Load entries from disk on startup.
   */
  private loadFromDisk(): void {
    const filePath = path.join(this.dataDir, LOG_FILE);
    if (!fs.existsSync(filePath)) return;

    try {
      const json = fs.readFileSync(filePath, 'utf-8');
      const loaded = JSON.parse(json);
      if (Array.isArray(loaded)) {
        this.entries = loaded;
        console.log(`[DarwinFi] Loaded ${this.entries.length} conversation log entries`);
      }
    } catch (err) {
      console.error(
        '[DarwinFi] Failed to load conversation log:',
        err instanceof Error ? err.message : err,
      );
    }
  }
}
