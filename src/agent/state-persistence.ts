/**
 * DarwinFi State Persistence
 *
 * JSON file-based persistence for agent state. Allows the agent to survive
 * restarts by saving and loading strategy genomes, performance metrics,
 * trade history, and evolution state.
 */

import * as fs from 'fs';
import * as path from 'path';
import { StrategyGenome } from './strategy-manager';
import { FrontierGenome } from './frontier-genome';
import { PerformanceMetrics } from './performance';
import { WhaleWallet } from '../frontier/whale/whale-tracker';
import { BreakerState } from './circuit-breaker';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PersistedState {
  version: number;
  savedAt: string;
  agent: {
    loopCount: number;
    tradeIdCounter: number;
    lastEvolutionTime: string;
    tradesAtLastEvolution: number;
    evolutionCycleCount: number;
    startTime: string;
  };
  strategies: StrategyGenome[];
  performance: Record<string, PerformanceMetrics>;
  conversationLog?: unknown[];
  /** Team 4 Frontier state */
  frontier?: {
    bots: FrontierGenome[];
    whaleRegistry?: WhaleWallet[];
    circuitBreakers?: Record<string, BreakerState>;
    championship?: {
      evaluationCount: number;
      lastStandings?: unknown;
    };
  };
}

export interface StatePersistenceConfig {
  /** Directory where state files are stored (default: ./data) */
  dataDir?: string;
  /** Auto-save interval in ms (default: 300000 = 5 minutes) */
  autoSaveIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// StatePersistence
// ---------------------------------------------------------------------------

const STATE_FILE = 'agent-state.json';
const STATE_VERSION = 1;

export class StatePersistence {
  private dataDir: string;
  private autoSaveIntervalMs: number;
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: StatePersistenceConfig) {
    this.dataDir = config?.dataDir ?? path.join(process.cwd(), 'data');
    this.autoSaveIntervalMs = config?.autoSaveIntervalMs ?? 300_000;
  }

  /**
   * Ensure the data directory exists.
   */
  private ensureDataDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      console.log(`[DarwinFi] Created data directory: ${this.dataDir}`);
    }
  }

  /**
   * Get the full path to the state file.
   */
  private getStatePath(): string {
    return path.join(this.dataDir, STATE_FILE);
  }

  /**
   * Check if a saved state exists.
   */
  hasState(): boolean {
    return fs.existsSync(this.getStatePath());
  }

  /**
   * Save agent state to disk. Uses atomic write (tmp + rename).
   */
  save(state: PersistedState): void {
    this.ensureDataDir();
    const filePath = this.getStatePath();
    const tmpPath = filePath + '.tmp';

    state.version = STATE_VERSION;
    state.savedAt = new Date().toISOString();

    try {
      const json = JSON.stringify(state, null, 2);
      fs.writeFileSync(tmpPath, json, 'utf-8');
      fs.renameSync(tmpPath, filePath);
      console.log(`[DarwinFi] State saved (${(json.length / 1024).toFixed(1)} KB)`);
    } catch (err) {
      console.error(
        '[DarwinFi] Failed to save state:',
        err instanceof Error ? err.message : err,
      );
      // Clean up tmp file if it exists
      try { fs.unlinkSync(tmpPath); } catch {}
    }
  }

  /**
   * Load agent state from disk.
   */
  load(): PersistedState | null {
    const filePath = this.getStatePath();
    if (!fs.existsSync(filePath)) {
      console.log('[DarwinFi] No saved state found, starting fresh');
      return null;
    }

    try {
      const json = fs.readFileSync(filePath, 'utf-8');
      const state: PersistedState = JSON.parse(json);

      if (state.version !== STATE_VERSION) {
        console.warn(
          `[DarwinFi] State version mismatch (file: ${state.version}, expected: ${STATE_VERSION}). Starting fresh.`
        );
        return null;
      }

      // Rehydrate Date objects in trade history
      if (state.performance) {
        for (const metrics of Object.values(state.performance)) {
          if (metrics.lastMetricsReset) {
            metrics.lastMetricsReset = new Date(metrics.lastMetricsReset);
          }
          if (metrics.tradeHistory) {
            for (const trade of metrics.tradeHistory) {
              trade.entryTime = new Date(trade.entryTime);
              if (trade.exitTime) {
                trade.exitTime = new Date(trade.exitTime);
              }
            }
          }
        }
      }

      console.log(`[DarwinFi] State loaded from ${state.savedAt} (${state.strategies?.length || 0} strategies)`);
      return state;
    } catch (err) {
      console.error(
        '[DarwinFi] Failed to load state:',
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }

  /**
   * Start auto-saving on a periodic interval.
   */
  startAutoSave(getState: () => PersistedState): void {
    if (this.autoSaveTimer) return;
    this.autoSaveTimer = setInterval(() => {
      try {
        this.save(getState());
      } catch (err) {
        console.error(
          '[DarwinFi] Auto-save failed:',
          err instanceof Error ? err.message : err,
        );
      }
    }, this.autoSaveIntervalMs);
    console.log(`[DarwinFi] Auto-save enabled (every ${this.autoSaveIntervalMs / 1000}s)`);
  }

  /**
   * Stop auto-saving.
   */
  stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
      console.log('[DarwinFi] Auto-save stopped');
    }
  }
}
