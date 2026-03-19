/**
 * DarwinFi Immune System - Fix History
 *
 * Persistent log of all fix attempts. Writes to data/immune/fix-history.json
 * using atomic tmp+rename. FIFO capped at THRESHOLDS.maxFixHistory.
 */

import * as fs from 'fs';
import * as path from 'path';
import { FixRecord } from '../types';
import { IMMUNE_FILES, THRESHOLDS, PROJECT_ROOT } from '../config';
const PREFIX = '[Immune:Platelets]';

export class FixHistory {
  private records: FixRecord[] = [];
  private filePath: string;
  private maxRecords: number;

  constructor(maxRecords = THRESHOLDS.maxFixHistory) {
    this.filePath = path.join(PROJECT_ROOT, IMMUNE_FILES.fixHistory);
    this.maxRecords = maxRecords;
    this.load();
  }

  /**
   * Add a fix record and persist to disk.
   */
  addFix(record: FixRecord): void {
    this.records.push(record);

    // Enforce FIFO cap
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }

    this.save();
  }

  /**
   * Get the most recent fix records.
   */
  getRecentFixes(limit = 100): FixRecord[] {
    return this.records.slice(-limit);
  }

  /**
   * Get all fix records for a specific checkId.
   */
  getFixesByCheckId(checkId: string): FixRecord[] {
    return this.records.filter(r => r.checkId === checkId);
  }

  /**
   * Count fixes applied in the last hour.
   */
  getFixCountLastHour(): number {
    const oneHourAgo = Date.now() - 60 * 60_000;
    return this.records.filter(r => r.appliedAt >= oneHourAgo).length;
  }

  /**
   * Total number of fix records.
   */
  get count(): number {
    return this.records.length;
  }

  /**
   * Atomic write to disk (tmp + rename).
   */
  private save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const tmpPath = this.filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(this.records, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.filePath);
    } catch (err) {
      console.error(`${PREFIX} Failed to save fix history: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * Load existing history from disk on startup.
   */
  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.records = parsed.slice(-this.maxRecords);
        }
      }
    } catch {
      // Start fresh if corrupt
      this.records = [];
    }
  }
}
