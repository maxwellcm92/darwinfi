/**
 * DarwinFi Evolution Engine
 *
 * Uses the Anthropic Claude API to evolve strategy variations each cycle.
 * Three roles per variation:
 *   - Mad Scientist (experimental): creative, unconventional parameters
 *   - Optimizer: fix weaknesses of the parent main
 *   - Synthesizer: hybrid best-of-all from main + experimental + optimizer
 */

import OpenAI from 'openai';
import {
  StrategyGenome,
  StrategyManager,
  VariationRole,
} from './strategy-manager';
import { PerformanceTracker, PerformanceMetrics } from './performance';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EvolutionResult {
  strategyId: string;
  role: VariationRole;
  newParameters: Partial<StrategyGenome['parameters']>;
  reasoning: string;
}

interface EvolutionCycleReport {
  cycleNumber: number;
  timestamp: Date;
  results: EvolutionResult[];
  promotionEvents: string[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VENICE_BASE_URL = 'https://api.venice.ai/api/v1';
const VENICE_MODEL = 'llama-3.3-70b';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

// ---------------------------------------------------------------------------
// EvolutionEngine
// ---------------------------------------------------------------------------

export class EvolutionEngine {
  private client: OpenAI;
  private cycleCount: number = 0;

  constructor(apiKey: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: VENICE_BASE_URL,
      timeout: 30_000,
    });
    console.log('[DarwinFi] Evolution engine initialized (Venice AI - sponsor showcase)');
  }

  /**
   * Run a full evolution cycle: send all 12 genomes + metrics to Claude,
   * receive updated parameters for each variation, apply them.
   */
  async runEvolutionCycle(
    strategyManager: StrategyManager,
    performanceTracker: PerformanceTracker,
  ): Promise<EvolutionCycleReport> {
    this.cycleCount += 1;
    const startTime = Date.now();
    console.log(`[DarwinFi] === Evolution Cycle #${this.cycleCount} START ===`);

    const allStrategies = strategyManager.getAllStrategies();
    const results: EvolutionResult[] = [];

    // Process each main strategy and its variations
    const mains = strategyManager.getMainStrategies();

    for (const main of mains) {
      const variations = strategyManager.getVariations(main.id);

      for (const variation of variations) {
        if (!variation.role) continue;

        try {
          const result = await this.evolveVariation(
            main,
            variation,
            variations,
            allStrategies,
            performanceTracker,
          );

          if (result) {
            results.push(result);
            strategyManager.updateGenome(variation.id, result.newParameters);
            console.log(
              `[DarwinFi] Evolved ${variation.id} (${variation.role}): ${result.reasoning.substring(0, 100)}...`
            );
          }
        } catch (err) {
          console.error(`[DarwinFi] Failed to evolve ${variation.id}:`, err);
        }
      }
    }

    // After evolution, run promotion evaluation
    const promotionEvents = strategyManager.evaluatePromotions();

    const durationMs = Date.now() - startTime;
    const report: EvolutionCycleReport = {
      cycleNumber: this.cycleCount,
      timestamp: new Date(),
      results,
      promotionEvents: promotionEvents.map(e => `${e.type}: ${e.fromId} -> ${e.toId || 'N/A'} (${e.reason})`),
      durationMs,
    };

    console.log(
      `[DarwinFi] === Evolution Cycle #${this.cycleCount} COMPLETE ` +
      `(${results.length} evolved, ${promotionEvents.length} promotions, ${durationMs}ms) ===`
    );

    return report;
  }

  /**
   * Get the current cycle count.
   */
  getCycleCount(): number {
    return this.cycleCount;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Evolve a single variation using Claude, with role-specific prompting.
   */
  private async evolveVariation(
    parent: StrategyGenome,
    variation: StrategyGenome,
    siblings: StrategyGenome[],
    allStrategies: StrategyGenome[],
    performanceTracker: PerformanceTracker,
  ): Promise<EvolutionResult | null> {
    const parentMetrics = performanceTracker.getMetrics(parent.id);
    const variationMetrics = performanceTracker.getMetrics(variation.id);

    // Build the context payload
    const context = this.buildEvolutionContext(
      parent,
      parentMetrics,
      variation,
      variationMetrics,
      siblings,
      allStrategies,
      performanceTracker,
    );

    const rolePrompt = this.getRolePrompt(variation.role!);
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = `${rolePrompt}\n\n${context}`;

    // Call Claude with retries
    let response: string | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        response = await this.callClaude(systemPrompt, userPrompt);
        break;
      } catch (err) {
        console.error(
          `[DarwinFi] Claude API attempt ${attempt}/${MAX_RETRIES} failed:`,
          err instanceof Error ? err.message : err,
        );
        if (attempt < MAX_RETRIES) {
          await this.sleep(RETRY_DELAY_MS * attempt);
        }
      }
    }

    if (!response) {
      console.error(`[DarwinFi] All Claude API attempts failed for ${variation.id}`);
      return null;
    }

    // Parse structured output
    return this.parseEvolutionResponse(response, variation.id, variation.role!);
  }

  private buildSystemPrompt(): string {
    return `You are the DarwinFi Evolution Engine -- a specialist in algorithmic trading strategy optimization.

You analyze strategy genomes and their performance metrics, then propose parameter mutations.
Your goal is to maximize the composite fitness score:
  score = (rolling24hPnL_norm * 0.30) + (rolling24hSharpe * 0.25) + (rolling24hWinRate * 0.20) + (totalPnL_norm * 0.15) + ((1 - maxDrawdown_norm) * 0.10)

CONSTRAINTS:
- entryMethod must be one of: rsi_oversold, ema_crossover, bollinger_bounce, macd_signal, volume_spike
- exitMethod must be one of: trailing_stop, fixed_target, time_based
- timeframe must be one of: 1m, 5m, 15m, 1h
- trailingStopPct: 1-25 (percentage)
- takeProfitPct: 5-100 (percentage)
- entryThreshold: depends on method (RSI: 10-40, EMA: 0.1-2.0, Bollinger: 1.0-3.0, MACD: -5 to 5, Volume: 1.5-5.0)
- riskPerTradePct: 0.5-5.0
- maxPositions: 1-6
- tokenPreferences: from [ETH, USDC, UNI, wstETH, ENS, AERO]
- instinctWeight: 0.0-1.0 (how much to trust Instinct prediction layer; 0=ignore, 1=full trust)

RESPOND WITH ONLY a JSON object in this exact format:
{
  "parameters": {
    "entryMethod": "...",
    "entryThreshold": ...,
    "exitMethod": "...",
    "trailingStopPct": ...,
    "takeProfitPct": ...,
    "timeframe": "...",
    "indicators": [...],
    "riskPerTradePct": ...,
    "maxPositions": ...,
    "tokenPreferences": [...],
    "instinctWeight": ...
  },
  "reasoning": "1-2 sentence explanation of the mutation rationale"
}

Do NOT include any text outside the JSON object.`;
  }

  private getRolePrompt(role: VariationRole): string {
    switch (role) {
      case 'experimental':
        return `ROLE: Mad Scientist (Experimental Variation)
You are the creative chaos agent. Your job is to explore UNCONVENTIONAL parameter combinations
that the optimizer would never try. Push boundaries: unusual timeframes, aggressive thresholds,
unexpected indicator combinations, contrarian token selections. Some of your ideas will fail
spectacularly -- that's the point. The ones that succeed will reveal hidden alpha.
Mutate AT LEAST 3 parameters significantly from the parent. Be bold.`;

      case 'optimizer':
        return `ROLE: Optimizer (Refinement Variation)
You are the precision engineer. Analyze the parent strategy's weaknesses based on metrics:
- Low win rate? Tighten entry conditions.
- High drawdown? Reduce position sizing or widen stops.
- Poor Sharpe? Reduce volatility exposure, favor stable tokens.
- Low PnL? Increase take-profit targets or improve entry timing.
Make TARGETED, small-to-medium adjustments. Change 1-3 parameters. Stay close to the parent's
core approach but fix what's broken.`;

      case 'synthesizer':
        return `ROLE: Synthesizer (Hybrid Variation)
You are the diplomat who finds the best of all worlds. You have access to the parent main,
the experimental variation, and the optimizer variation. Your job:
- Take the best-performing aspects from each
- Combine them into a balanced hybrid
- If the experimental found a winning indicator combo, adopt it
- If the optimizer improved risk management, use those settings
- If the parent's core approach is strong, keep it but enhance
Create a strategy that would rank #1 on the composite score by cherry-picking winners.`;
    }
  }

  private buildEvolutionContext(
    parent: StrategyGenome,
    parentMetrics: PerformanceMetrics | null,
    variation: StrategyGenome,
    variationMetrics: PerformanceMetrics | null,
    siblings: StrategyGenome[],
    allStrategies: StrategyGenome[],
    performanceTracker: PerformanceTracker,
  ): string {
    const sections: string[] = [];

    // Parent main strategy
    sections.push(`## Parent Main Strategy: ${parent.name} (${parent.id})`);
    sections.push(`Status: ${parent.status} | Generation: ${parent.generation}`);
    sections.push(`Parameters: ${JSON.stringify(parent.parameters, null, 2)}`);
    if (parentMetrics) {
      sections.push(`Metrics: PnL=$${parentMetrics.totalPnL.toFixed(2)} | WR=${(parentMetrics.winRate * 100).toFixed(1)}% | Sharpe=${parentMetrics.sharpeRatio.toFixed(2)} | MaxDD=${(parentMetrics.maxDrawdown * 100).toFixed(1)}% | Trades=${parentMetrics.tradesCompleted}`);
      sections.push(`Rolling 24h: PnL=$${parentMetrics.rolling24hPnL.toFixed(2)} | WR=${(parentMetrics.rolling24hWinRate * 100).toFixed(1)}% | Sharpe=${parentMetrics.rolling24hSharpe.toFixed(2)}`);
    }

    // Current variation
    sections.push(`\n## Current Variation: ${variation.name} (${variation.id}) [${variation.role}]`);
    sections.push(`Parameters: ${JSON.stringify(variation.parameters, null, 2)}`);
    if (variationMetrics) {
      sections.push(`Metrics: PnL=$${variationMetrics.totalPnL.toFixed(2)} | WR=${(variationMetrics.winRate * 100).toFixed(1)}% | Sharpe=${variationMetrics.sharpeRatio.toFixed(2)} | MaxDD=${(variationMetrics.maxDrawdown * 100).toFixed(1)}% | Trades=${variationMetrics.tradesCompleted}`);
    }

    // Sibling variations (for synthesizer context)
    if (variation.role === 'synthesizer') {
      sections.push('\n## Sibling Variations:');
      for (const sibling of siblings) {
        if (sibling.id === variation.id) continue;
        const sibMetrics = performanceTracker.getMetrics(sibling.id);
        sections.push(`  ${sibling.id} [${sibling.role}]: ${JSON.stringify(sibling.parameters)}`);
        if (sibMetrics) {
          sections.push(`    Metrics: PnL=$${sibMetrics.totalPnL.toFixed(2)} | WR=${(sibMetrics.winRate * 100).toFixed(1)}% | Sharpe=${sibMetrics.sharpeRatio.toFixed(2)} | Trades=${sibMetrics.tradesCompleted}`);
        }
      }
    }

    // Global leaderboard context
    sections.push('\n## Global Leaderboard (Top 5):');
    const leaderboard = performanceTracker.getLeaderboard().slice(0, 5);
    for (const entry of leaderboard) {
      sections.push(`  ${entry.strategyId}: score=${entry.score.toFixed(3)} | trades=${entry.metrics.tradesCompleted} | PnL=$${entry.metrics.totalPnL.toFixed(2)}`);
    }

    return sections.join('\n');
  }

  private async callClaude(systemPrompt: string, userPrompt: string): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model: VENICE_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 1024,
      temperature: 0.7, // Higher temperature for creative evolution
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from Venice evolution API');
    }
    return content;
  }

  private parseEvolutionResponse(
    response: string,
    strategyId: string,
    role: VariationRole,
  ): EvolutionResult | null {
    try {
      // Strip any markdown code fences if present
      let cleaned = response.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.slice(7);
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.slice(3);
      }
      if (cleaned.endsWith('```')) {
        cleaned = cleaned.slice(0, -3);
      }
      cleaned = cleaned.trim();

      const parsed = JSON.parse(cleaned);

      if (!parsed.parameters || typeof parsed.parameters !== 'object') {
        console.error(`[DarwinFi] Invalid evolution response structure for ${strategyId}`);
        return null;
      }

      // Validate parameter constraints
      const params = parsed.parameters;
      const validEntryMethods = ['rsi_oversold', 'ema_crossover', 'bollinger_bounce', 'macd_signal', 'volume_spike'];
      const validExitMethods = ['trailing_stop', 'fixed_target', 'time_based'];
      const validTimeframes = ['1m', '5m', '15m', '1h'];

      if (params.entryMethod && !validEntryMethods.includes(params.entryMethod)) {
        console.warn(`[DarwinFi] Invalid entryMethod "${params.entryMethod}" from Claude, skipping`);
        return null;
      }
      if (params.exitMethod && !validExitMethods.includes(params.exitMethod)) {
        console.warn(`[DarwinFi] Invalid exitMethod "${params.exitMethod}" from Claude, skipping`);
        return null;
      }
      if (params.timeframe && !validTimeframes.includes(params.timeframe)) {
        console.warn(`[DarwinFi] Invalid timeframe "${params.timeframe}" from Claude, skipping`);
        return null;
      }

      // Clamp numeric parameters to valid ranges
      if (params.trailingStopPct !== undefined) {
        params.trailingStopPct = Math.max(1, Math.min(25, params.trailingStopPct));
      }
      if (params.takeProfitPct !== undefined) {
        params.takeProfitPct = Math.max(5, Math.min(100, params.takeProfitPct));
      }
      if (params.riskPerTradePct !== undefined) {
        params.riskPerTradePct = Math.max(0.5, Math.min(5.0, params.riskPerTradePct));
      }
      if (params.maxPositions !== undefined) {
        params.maxPositions = Math.max(1, Math.min(6, Math.floor(params.maxPositions)));
      }
      if (params.instinctWeight !== undefined) {
        params.instinctWeight = Math.max(0, Math.min(1.0, params.instinctWeight));
      }

      return {
        strategyId,
        role,
        newParameters: params,
        reasoning: parsed.reasoning || 'No reasoning provided',
      };
    } catch (err) {
      console.error(
        `[DarwinFi] Failed to parse evolution response for ${strategyId}:`,
        err instanceof Error ? err.message : err,
      );
      console.error(`[DarwinFi] Raw response: ${response.substring(0, 200)}`);
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Frontier-specific evolution (Team 4 bots)
  // -------------------------------------------------------------------------

  /**
   * Get archetype-specific evolution prompt for frontier bots.
   */
  getFrontierRolePrompt(archetype: string): string {
    switch (archetype) {
      case 'abiogenesis':
        return `ROLE: Abiogenesis -- Micro-Cap Moonshot Hunter
You optimize for finding tokens at near-zero market cap with explosive potential.
Focus on: minSafetyScore (rug detection sensitivity), pumpExitMultiplier (when to take profit),
maxMarketCapUsd (size filter), maxHoldTimeMs (time limit). Think about asymmetric returns --
occasional 100x+ gains should outweigh frequent small losses. Be aggressive with entry,
disciplined with exit.`;

      case 'mitosis':
        return `ROLE: Mitosis -- Ultra-High-Frequency Micro-Scalper
You optimize for win rate and consistency. Hundreds of tiny trades per day.
Focus on: maxTradesPerHour, minSpreadBps (minimum profitable spread), targetProfitBps
(target per trade), maxPositionSizeUsd. Each trade should be tiny but positive.
Win rate >60% is the primary objective. Reduce gas cost by choosing cheapest chains.`;

      case 'cambrian':
        return `ROLE: Cambrian -- Volatility Hunter
You hunt moments of rapid change, not specific tokens. Deploy capital where the
ecosystem is experiencing maximum volatility.
Focus on: volThresholdMultiplier (sensitivity to vol spikes), volWindowMinutes
(measurement window), catalystWeight (importance of external catalysts),
maxExposurePerEvent. Be chain-agnostic -- trade wherever the heat is.`;

      case 'symbiont':
        return `ROLE: Symbiont -- Smart Money Tracker
You mirror proven whale wallets with smaller positions and tighter stops.
Focus on: mirrorDelayMs (how fast to copy), minWhaleScore (quality filter),
stopLossPct (tighter than whales), maxCopyPositions. Win rate should inherit
from whale accuracy minus slippage from entry delay.`;

      default:
        return `ROLE: Frontier Bot -- Cross-Chain Trader
Optimize for cross-chain opportunities. Balance risk, entry timing, and exit discipline.`;
    }
  }

  /**
   * Build frontier-specific parameter constraints for the system prompt.
   */
  getFrontierConstraints(): string {
    return `
FRONTIER BOT CONSTRAINTS:
- entryMethod: pair_created, rug_screened, micro_spread, mean_reversion, volatility_breakout, vol_compression, whale_mirror, whale_front_run
- exitMethod: pump_exit, micro_target, vol_decay, whale_exit_mirror
- chainSelectionMode: fixed, cheapest_gas, deepest_liquidity, highest_volume
- dexRouting: 1inch, uniswap_direct, auto
- riskPerTradePct: 0.1-5.0
- maxPositions: 1-20
- trailingStopPct: 0.5-30
- takeProfitPct: 0.5-200

BOT-SPECIFIC PARAM RANGES:
- abiogenesis.minSafetyScore: 30-90
- abiogenesis.maxMarketCapUsd: 100000-10000000
- abiogenesis.pumpExitMultiplier: 2-50
- mitosis.maxTradesPerHour: 10-200
- mitosis.minSpreadBps: 1-50
- mitosis.targetProfitBps: 1-20
- cambrian.volThresholdMultiplier: 1.2-5.0
- cambrian.volWindowMinutes: 5-240
- symbiont.mirrorDelayMs: 100-10000
- symbiont.minWhaleScore: 40-95`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
