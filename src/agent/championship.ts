/**
 * DarwinFi Championship System
 *
 * 4-team championship: gets winners from StrategyManager (Teams 1-3)
 * and FrontierManager (Team 4). Compares composite scores to determine
 * the overall champion who gets the live trading slot.
 *
 * Runs hourly as part of darwin-agent's tick loop.
 */

import { PerformanceTracker } from './performance';
import { StrategyManager } from './strategy-manager';
import { FrontierManager } from './frontier-manager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamChampion {
  teamId: number;
  teamName: string;
  strategyId: string;
  strategyName: string;
  compositeScore: number;
  trades: number;
  pnl: number;
  winRate: number;
}

export interface ChampionshipStandings {
  timestamp: string;
  champions: TeamChampion[];
  overallChampion: TeamChampion | null;
  evaluationCount: number;
}

// ---------------------------------------------------------------------------
// Team definitions
// ---------------------------------------------------------------------------

interface TeamInfo {
  id: number;
  name: string;
  description: string;
}

const TEAMS: TeamInfo[] = [
  { id: 1, name: 'Apex', description: 'RSI-based momentum trading' },
  { id: 2, name: 'Viper', description: 'Bollinger band mean reversion' },
  { id: 3, name: 'Blitz', description: 'EMA crossover trend following' },
  { id: 4, name: 'Frontier', description: 'Cross-chain evolutionary trading' },
];

// Strategy ID to team mapping for Teams 1-3
const TEAM_STRATEGY_MAP: Record<string, number> = {
  'main-alpha': 1,
  'main-beta': 2,
  'main-gamma': 3,
};

// ---------------------------------------------------------------------------
// Championship
// ---------------------------------------------------------------------------

export class Championship {
  private performanceTracker: PerformanceTracker;
  private strategyManager: StrategyManager | null;
  private frontierManager: FrontierManager | null;
  private evaluationCount: number = 0;
  private lastStandings: ChampionshipStandings | null = null;

  constructor(
    performanceTracker: PerformanceTracker,
    strategyManager?: StrategyManager | null,
    frontierManager?: FrontierManager | null,
  ) {
    this.performanceTracker = performanceTracker;
    this.strategyManager = strategyManager ?? null;
    this.frontierManager = frontierManager ?? null;
  }

  /**
   * Set the strategy manager (Teams 1-3).
   */
  setStrategyManager(manager: StrategyManager): void {
    this.strategyManager = manager;
  }

  /**
   * Set the frontier manager (Team 4).
   */
  setFrontierManager(manager: FrontierManager): void {
    this.frontierManager = manager;
  }

  /**
   * Get the champion from each team.
   */
  getChampions(): TeamChampion[] {
    const champions: TeamChampion[] = [];

    // Teams 1-3: get the best main strategy per team
    if (this.strategyManager) {
      const mains = this.strategyManager.getMainStrategies();
      for (const main of mains) {
        const teamId = TEAM_STRATEGY_MAP[main.id];
        if (!teamId) continue;

        const team = TEAMS.find(t => t.id === teamId);
        if (!team) continue;

        const metrics = this.performanceTracker.getMetrics(main.id);
        const score = this.performanceTracker.getCompositeScore(main.id);

        champions.push({
          teamId,
          teamName: team.name,
          strategyId: main.id,
          strategyName: main.name,
          compositeScore: Math.round(score * 1000) / 1000,
          trades: metrics?.tradesCompleted ?? 0,
          pnl: Math.round((metrics?.totalPnL ?? 0) * 100) / 100,
          winRate: Math.round((metrics?.winRate ?? 0) * 1000) / 1000,
        });
      }
    }

    // Team 4: get the frontier team winner
    if (this.frontierManager) {
      const winner = this.frontierManager.getTeamWinner();
      if (winner) {
        const bot = this.frontierManager.getBot(winner.botId);
        const metrics = this.performanceTracker.getMetrics(winner.botId);

        champions.push({
          teamId: 4,
          teamName: 'Frontier',
          strategyId: winner.botId,
          strategyName: bot?.name ?? winner.botId,
          compositeScore: Math.round(winner.score * 1000) / 1000,
          trades: metrics?.tradesCompleted ?? 0,
          pnl: Math.round((metrics?.totalPnL ?? 0) * 100) / 100,
          winRate: Math.round((metrics?.winRate ?? 0) * 1000) / 1000,
        });
      }
    }

    // Sort by composite score descending
    champions.sort((a, b) => b.compositeScore - a.compositeScore);

    return champions;
  }

  /**
   * Get the overall champion across all 4 teams.
   */
  getOverallChampion(): TeamChampion | null {
    const champions = this.getChampions();
    if (champions.length === 0) return null;

    // Must have at least 5 trades to be champion
    const eligible = champions.filter(c => c.trades >= 5);
    return eligible.length > 0 ? eligible[0] : null;
  }

  /**
   * Run a full championship evaluation.
   * Returns the current standings.
   */
  evaluateChampionship(): ChampionshipStandings {
    this.evaluationCount++;

    const champions = this.getChampions();
    const overallChampion = this.getOverallChampion();

    const standings: ChampionshipStandings = {
      timestamp: new Date().toISOString(),
      champions,
      overallChampion,
      evaluationCount: this.evaluationCount,
    };

    this.lastStandings = standings;

    if (overallChampion) {
      console.log(
        `[Championship] Evaluation #${this.evaluationCount}: ` +
        `Champion = ${overallChampion.strategyName} (Team ${overallChampion.teamName}, ` +
        `score=${overallChampion.compositeScore}, PnL=$${overallChampion.pnl})`
      );
    } else {
      console.log(
        `[Championship] Evaluation #${this.evaluationCount}: No eligible champion yet`
      );
    }

    return standings;
  }

  /**
   * Get the last evaluation results.
   */
  getLastStandings(): ChampionshipStandings | null {
    return this.lastStandings;
  }

  /**
   * Get evaluation count.
   */
  getEvaluationCount(): number {
    return this.evaluationCount;
  }
}
