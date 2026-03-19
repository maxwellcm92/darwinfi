/**
 * DarwinFi Frontier Manager
 *
 * Team 4's strategy manager. Manages a population of exactly 4 frontier
 * bots (one per archetype), handles internal competition scoring,
 * and genome updates from the evolution engine.
 */

import { PerformanceTracker } from './performance';
import { FrontierGenome, BotArchetype, createSeedFrontierGenomes } from './frontier-genome';

// ---------------------------------------------------------------------------
// FrontierManager
// ---------------------------------------------------------------------------

export class FrontierManager {
  private bots: Map<string, FrontierGenome> = new Map();
  private performanceTracker: PerformanceTracker;

  constructor(performanceTracker: PerformanceTracker) {
    this.performanceTracker = performanceTracker;
  }

  /**
   * Seed the 4 frontier bots and init performance tracking for each.
   */
  initialize(): void {
    const seeds = createSeedFrontierGenomes();

    for (const bot of seeds) {
      this.bots.set(bot.id, bot);
      this.performanceTracker.initStrategy(bot.id);
    }

    console.log(`[DarwinFi:Frontier] Population initialized: ${this.bots.size} bots`);
    this.logPopulationSummary();
  }

  /**
   * Get all frontier bots.
   */
  getAllBots(): FrontierGenome[] {
    return Array.from(this.bots.values());
  }

  /**
   * Get a single bot by ID.
   */
  getBot(id: string): FrontierGenome | undefined {
    return this.bots.get(id);
  }

  /**
   * Get a bot by its archetype.
   */
  getBotByArchetype(archetype: BotArchetype): FrontierGenome | undefined {
    return Array.from(this.bots.values()).find(b => b.archetype === archetype);
  }

  /**
   * Internal competition -- get the team winner by composite score.
   * Returns null if no bots have completed trades.
   */
  getTeamWinner(): { botId: string; score: number } | null {
    const rankings = this.evaluateInternalCompetition();
    if (rankings.length === 0 || rankings[0].trades === 0) return null;

    return {
      botId: rankings[0].id,
      score: rankings[0].score,
    };
  }

  /**
   * Evaluate internal competition -- returns all bots ranked by composite score.
   */
  evaluateInternalCompetition(): Array<{ id: string; name: string; score: number; trades: number }> {
    const rankings: Array<{ id: string; name: string; score: number; trades: number }> = [];

    const allBots = Array.from(this.bots.values());
    for (const bot of allBots) {
      const score = this.performanceTracker.getCompositeScore(bot.id);
      const metrics = this.performanceTracker.getMetrics(bot.id);

      rankings.push({
        id: bot.id,
        name: bot.name,
        score,
        trades: metrics?.tradesCompleted || 0,
      });
    }

    rankings.sort((a, b) => b.score - a.score);

    console.log('[DarwinFi:Frontier] --- Internal Competition ---');
    for (let i = 0; i < rankings.length; i++) {
      const r = rankings[i];
      console.log(
        `[DarwinFi:Frontier]   #${i + 1} ${r.name} (${r.id}): ` +
        `score=${r.score.toFixed(3)} trades=${r.trades}`
      );
    }
    console.log('[DarwinFi:Frontier] --- End Competition ---');

    return rankings;
  }

  /**
   * Update a bot's genome (used by evolution engine).
   * Resets performance metrics when the genome changes.
   */
  updateGenome(botId: string, newParams: Partial<FrontierGenome['parameters']>): void {
    const bot = this.bots.get(botId);
    if (!bot) {
      console.error(`[DarwinFi:Frontier] Cannot update genome -- bot ${botId} not found`);
      return;
    }

    const oldParams = JSON.stringify(bot.parameters);
    bot.parameters = { ...bot.parameters, ...newParams };
    const newParamsStr = JSON.stringify(bot.parameters);

    if (oldParams !== newParamsStr) {
      bot.generation += 1;
      this.performanceTracker.resetMetrics(botId);
      console.log(
        `[DarwinFi:Frontier] Genome updated for ${botId} (gen ${bot.generation}). Metrics reset.`
      );
    }
  }

  /**
   * Serialize all bot genomes for persistence.
   */
  serialize(): FrontierGenome[] {
    return Array.from(this.bots.values());
  }

  /**
   * Deserialize saved bot genomes back into the manager.
   */
  deserialize(bots: FrontierGenome[]): void {
    this.bots.clear();
    for (const bot of bots) {
      this.bots.set(bot.id, bot);
      this.performanceTracker.initStrategy(bot.id);
    }
    console.log(`[DarwinFi:Frontier] Deserialized ${this.bots.size} bots`);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private logPopulationSummary(): void {
    console.log('[DarwinFi:Frontier] --- Population Summary ---');

    const allBots = Array.from(this.bots.values());
    for (const bot of allBots) {
      const score = this.performanceTracker.getCompositeScore(bot.id);
      const metrics = this.performanceTracker.getMetrics(bot.id);
      console.log(
        `[DarwinFi:Frontier]   ${bot.archetype}: ${bot.id} [${bot.status}] ` +
        `score=${score.toFixed(3)} trades=${metrics?.tradesCompleted || 0} gen=${bot.generation}`
      );
    }

    console.log('[DarwinFi:Frontier] --- End Summary ---');
  }
}
