/**
 * frontier-state-reader.ts - File-based bridge for frontier process state
 *
 * Reads the frontier agent's state file (data/frontier/agent-state.json)
 * and returns formatted data for the main dashboard and championship.
 * Caches reads for 30s to avoid excessive disk I/O.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DashboardState } from '../dashboard/server';

function resolveProjectRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const PROJECT_ROOT = resolveProjectRoot();
const FRONTIER_STATE_PATH = path.join(PROJECT_ROOT, 'data', 'frontier', 'agent-state.json');
const CACHE_TTL_MS = 30_000;

interface FrontierBot {
  id: string;
  name: string;
  archetype: string;
  status: string;
  generation: number;
  parameters?: Record<string, unknown>;
}

interface FrontierPerformanceMetrics {
  totalPnL: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  tradesCompleted: number;
  rolling24hPnL: number;
  rolling24hSharpe: number;
  rolling24hWinRate: number;
  consecutiveOutperformCycles: number;
}

export interface FrontierData {
  bots: FrontierBot[];
  performance: Record<string, FrontierPerformanceMetrics>;
}

let cachedData: FrontierData | null = null;
let cacheTimestamp = 0;

/**
 * Read frontier state from disk with 30s caching.
 */
export function readFrontierState(): FrontierData | null {
  const now = Date.now();
  if (cachedData && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedData;
  }

  try {
    if (!fs.existsSync(FRONTIER_STATE_PATH)) {
      return null;
    }

    const raw = fs.readFileSync(FRONTIER_STATE_PATH, 'utf-8');
    const state = JSON.parse(raw);

    const bots: FrontierBot[] = state.frontier?.bots ?? [];
    const performance: Record<string, FrontierPerformanceMetrics> = state.performance ?? {};

    if (bots.length === 0) {
      return null;
    }

    cachedData = { bots, performance };
    cacheTimestamp = now;
    return cachedData;
  } catch (err) {
    console.warn('[FrontierStateReader] Failed to read frontier state:', (err as Error).message);
    return null;
  }
}

/**
 * Get frontier strategies formatted for the dashboard.
 */
export function getFrontierStrategies(): NonNullable<DashboardState['frontierStrategies']> {
  const data = readFrontierState();
  if (!data) return [];

  return data.bots.map(bot => {
    const perf = data.performance[bot.id];
    return {
      id: bot.id,
      name: bot.name,
      archetype: bot.archetype,
      status: bot.status,
      score: perf ? Math.round((perf.winRate * 50 + (perf.totalPnL > 0 ? 30 : 0) + (1 - perf.maxDrawdown) * 20) * 100) / 100 : 0,
      pnl: perf ? Math.round(perf.totalPnL * 100) / 100 : 0,
      winRate: perf ? Math.round(perf.winRate * 1000) / 1000 : 0,
      trades: perf?.tradesCompleted ?? 0,
    };
  });
}

/**
 * Get the best frontier bot as a Team 4 champion candidate.
 * Returns null if no frontier bots have data.
 */
export function getFrontierTeamWinner(): {
  botId: string;
  botName: string;
  score: number;
  pnl: number;
  winRate: number;
  trades: number;
} | null {
  const data = readFrontierState();
  if (!data || data.bots.length === 0) return null;

  let bestBot: FrontierBot | null = null;
  let bestScore = -Infinity;

  for (const bot of data.bots) {
    const perf = data.performance[bot.id];
    if (!perf) continue;

    // Composite: winRate*50 + profitability*30 + drawdown*20
    const score = perf.winRate * 50 + (perf.totalPnL > 0 ? 30 : 0) + (1 - perf.maxDrawdown) * 20;
    if (score > bestScore) {
      bestScore = score;
      bestBot = bot;
    }
  }

  if (!bestBot) return null;

  const perf = data.performance[bestBot.id]!;
  return {
    botId: bestBot.id,
    botName: bestBot.name,
    score: Math.round(bestScore * 1000) / 1000,
    pnl: Math.round(perf.totalPnL * 100) / 100,
    winRate: Math.round(perf.winRate * 1000) / 1000,
    trades: perf.tradesCompleted,
  };
}
