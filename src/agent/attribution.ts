/**
 * DarwinFi Outcome Attribution System
 *
 * After every closed trade, decomposes the outcome into:
 *   - Entry timing quality (was the entry price optimal?)
 *   - Exit timing quality (did we exit at the right time?)
 *   - Slippage impact (how much did slippage cost us?)
 *   - Market regime alignment (were conditions favorable for the strategy?)
 *
 * Feeds attribution data into evolution prompts so the AI can make
 * targeted improvements instead of blind parameter mutations.
 */

import { TradeRecord } from './performance';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AttributionFactor = 'entry_timing' | 'exit_timing' | 'slippage' | 'market_regime';

export interface TradeAttribution {
  tradeId: string;
  strategyId: string;
  token: string;
  timestamp: number;

  // Overall
  totalPnlPct: number;
  outcome: 'win' | 'loss' | 'breakeven';

  // Decomposition: each factor gets a score from -1 (hurt) to +1 (helped)
  factors: Record<AttributionFactor, {
    score: number;       // -1 to +1
    impact: number;      // estimated PnL contribution in %
    detail: string;      // human-readable explanation
  }>;

  // Raw data used for calculation
  entryPrice: number;
  exitPrice: number;
  bestPriceDuringHold: number;
  worstPriceDuringHold: number;
  holdTimeMinutes: number;
  volatilityDuringHold: number;
}

export interface StrategyTokenProfile {
  strategyId: string;
  token: string;
  totalTrades: number;
  winRate: number;
  avgPnlPct: number;
  avgEntryScore: number;
  avgExitScore: number;
  avgSlippageImpact: number;
  avgRegimeScore: number;
  dominantLossFactor: AttributionFactor | null;
}

// ---------------------------------------------------------------------------
// Attribution Engine
// ---------------------------------------------------------------------------

export class AttributionEngine {
  private attributions: TradeAttribution[] = [];
  private priceCache: Map<string, Array<{ price: number; timestamp: number }>> = new Map();
  private readonly MAX_ATTRIBUTIONS = 1000;

  /**
   * Feed price data for attribution calculations.
   * Called from the main loop with current snapshots.
   */
  recordPrice(token: string, price: number): void {
    const history = this.priceCache.get(token) || [];
    history.push({ price, timestamp: Date.now() });
    // Keep last 2 hours of data (at 30s intervals = 240 entries)
    if (history.length > 240) history.shift();
    this.priceCache.set(token, history);
  }

  /**
   * Attribute a closed trade's outcome.
   * Call this immediately after closeTrade() in the main agent.
   */
  attributeTrade(trade: TradeRecord): TradeAttribution | null {
    if (trade.status !== 'closed' || trade.pnl === undefined || trade.exitPrice === undefined) {
      return null;
    }

    const priceHistory = this.priceCache.get(trade.token) || [];
    const entryTime = trade.entryTime.getTime();
    const exitTime = trade.exitTime?.getTime() || Date.now();

    // Get prices during hold period
    const holdPrices = priceHistory.filter(
      p => p.timestamp >= entryTime && p.timestamp <= exitTime
    );

    const bestPrice = holdPrices.length > 0
      ? Math.max(...holdPrices.map(p => p.price))
      : trade.exitPrice;
    const worstPrice = holdPrices.length > 0
      ? Math.min(...holdPrices.map(p => p.price))
      : trade.entryPrice;

    const holdTimeMinutes = (exitTime - entryTime) / 60000;
    const totalPnlPct = trade.pnlPct || 0;

    // Calculate volatility during hold
    const volatility = this.calculateVolatility(holdPrices.map(p => p.price));

    // Decompose the trade outcome
    const entryTiming = this.scoreEntryTiming(trade.entryPrice, bestPrice, worstPrice);
    const exitTiming = this.scoreExitTiming(trade.exitPrice, bestPrice, worstPrice, trade.entryPrice);
    const slippage = this.scoreSlippage(trade.fees, trade.entryPrice, trade.quantity);
    const regime = this.scoreMarketRegime(volatility, totalPnlPct, holdTimeMinutes);

    const attribution: TradeAttribution = {
      tradeId: trade.id,
      strategyId: trade.strategyId,
      token: trade.token,
      timestamp: Date.now(),
      totalPnlPct,
      outcome: totalPnlPct > 0.1 ? 'win' : totalPnlPct < -0.1 ? 'loss' : 'breakeven',
      factors: {
        entry_timing: entryTiming,
        exit_timing: exitTiming,
        slippage,
        market_regime: regime,
      },
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      bestPriceDuringHold: bestPrice,
      worstPriceDuringHold: worstPrice,
      holdTimeMinutes,
      volatilityDuringHold: volatility,
    };

    this.attributions.push(attribution);
    if (this.attributions.length > this.MAX_ATTRIBUTIONS) {
      this.attributions.shift();
    }

    console.log(
      `[Attribution] ${trade.token} ${attribution.outcome}: ` +
      `entry=${entryTiming.score.toFixed(2)} exit=${exitTiming.score.toFixed(2)} ` +
      `slip=${slippage.score.toFixed(2)} regime=${regime.score.toFixed(2)}`
    );

    return attribution;
  }

  /**
   * Get attribution profile for a strategy+token pair.
   * Used by evolution engine to understand WHY a strategy fails on specific tokens.
   */
  getStrategyTokenProfile(strategyId: string, token: string): StrategyTokenProfile {
    const relevant = this.attributions.filter(
      a => a.strategyId === strategyId && a.token === token
    );

    if (relevant.length === 0) {
      return {
        strategyId, token,
        totalTrades: 0, winRate: 0, avgPnlPct: 0,
        avgEntryScore: 0, avgExitScore: 0,
        avgSlippageImpact: 0, avgRegimeScore: 0,
        dominantLossFactor: null,
      };
    }

    const wins = relevant.filter(a => a.outcome === 'win').length;
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

    // Find dominant loss factor
    const losses = relevant.filter(a => a.outcome === 'loss');
    let dominantLossFactor: AttributionFactor | null = null;
    if (losses.length > 0) {
      const factorScores: Record<AttributionFactor, number> = {
        entry_timing: avg(losses.map(l => l.factors.entry_timing.score)),
        exit_timing: avg(losses.map(l => l.factors.exit_timing.score)),
        slippage: avg(losses.map(l => l.factors.slippage.score)),
        market_regime: avg(losses.map(l => l.factors.market_regime.score)),
      };
      // Most negative score = dominant loss factor
      dominantLossFactor = (Object.entries(factorScores) as [AttributionFactor, number][])
        .sort((a, b) => a[1] - b[1])[0][0];
    }

    return {
      strategyId,
      token,
      totalTrades: relevant.length,
      winRate: wins / relevant.length,
      avgPnlPct: avg(relevant.map(a => a.totalPnlPct)),
      avgEntryScore: avg(relevant.map(a => a.factors.entry_timing.score)),
      avgExitScore: avg(relevant.map(a => a.factors.exit_timing.score)),
      avgSlippageImpact: avg(relevant.map(a => a.factors.slippage.impact)),
      avgRegimeScore: avg(relevant.map(a => a.factors.market_regime.score)),
      dominantLossFactor,
    };
  }

  /**
   * Generate attribution summary for evolution prompts.
   * Returns a concise text block the evolution engine can inject.
   */
  getEvolutionContext(strategyId: string): string {
    const recent = this.attributions
      .filter(a => a.strategyId === strategyId)
      .slice(-20); // Last 20 trades

    if (recent.length === 0) return '';

    // Aggregate by token
    const tokens = [...new Set(recent.map(a => a.token))];
    const lines: string[] = ['## Attribution Analysis (Last 20 Trades)'];

    for (const token of tokens) {
      const profile = this.getStrategyTokenProfile(strategyId, token);
      if (profile.totalTrades === 0) continue;

      let line = `${token}: ${profile.totalTrades} trades, WR=${(profile.winRate * 100).toFixed(0)}%, avg PnL=${profile.avgPnlPct.toFixed(2)}%`;

      if (profile.dominantLossFactor) {
        const factorNames: Record<AttributionFactor, string> = {
          entry_timing: 'poor entry timing',
          exit_timing: 'poor exit timing',
          slippage: 'high slippage',
          market_regime: 'unfavorable market regime',
        };
        line += ` | Primary loss factor: ${factorNames[profile.dominantLossFactor]}`;
      }

      lines.push(`  ${line}`);
    }

    // Overall pattern
    const avgEntry = recent.reduce((s, a) => s + a.factors.entry_timing.score, 0) / recent.length;
    const avgExit = recent.reduce((s, a) => s + a.factors.exit_timing.score, 0) / recent.length;

    if (avgEntry < -0.3) lines.push('  WARNING: Consistently poor entry timing across tokens');
    if (avgExit < -0.3) lines.push('  WARNING: Consistently poor exit timing -- consider adjusting stops/targets');

    return lines.join('\n');
  }

  /**
   * Get all attributions for serialization.
   */
  getAll(): TradeAttribution[] {
    return [...this.attributions];
  }

  /**
   * Load attributions from persisted state.
   */
  load(data: TradeAttribution[]): void {
    this.attributions = data.slice(-this.MAX_ATTRIBUTIONS);
  }

  // -----------------------------------------------------------------------
  // Scoring functions
  // -----------------------------------------------------------------------

  private scoreEntryTiming(
    entryPrice: number,
    bestPrice: number,
    worstPrice: number,
  ): { score: number; impact: number; detail: string } {
    if (bestPrice === worstPrice) {
      return { score: 0, impact: 0, detail: 'Insufficient price range data' };
    }

    // How close was entry to the low? (lower = better for long)
    const range = bestPrice - worstPrice;
    const entryPosition = (entryPrice - worstPrice) / range; // 0 = entered at low, 1 = entered at high

    // Score: 0 at worst = entered at high, 1 at best = entered at low
    const score = 1 - 2 * entryPosition; // Maps [0,1] -> [1,-1]
    const impact = -(entryPosition - 0.5) * range / entryPrice * 100; // % impact vs midpoint

    let detail: string;
    if (score > 0.3) detail = 'Good entry near the low of the hold period';
    else if (score < -0.3) detail = 'Poor entry near the high -- entered too late';
    else detail = 'Entry near midpoint of hold range';

    return { score: Math.max(-1, Math.min(1, score)), impact, detail };
  }

  private scoreExitTiming(
    exitPrice: number,
    bestPrice: number,
    worstPrice: number,
    entryPrice: number,
  ): { score: number; impact: number; detail: string } {
    if (bestPrice === worstPrice) {
      return { score: 0, impact: 0, detail: 'Insufficient price range data' };
    }

    const range = bestPrice - worstPrice;
    const exitPosition = (exitPrice - worstPrice) / range; // 1 = exited at top, 0 = exited at bottom

    // For longs: higher exit = better
    const score = 2 * exitPosition - 1; // Maps [0,1] -> [-1,1]

    // How much we left on the table vs the best price
    const leftOnTable = ((bestPrice - exitPrice) / entryPrice) * 100;
    const impact = -leftOnTable;

    let detail: string;
    if (score > 0.3) detail = 'Exited near the high -- good exit timing';
    else if (score < -0.3) detail = `Exited near the low, left ${leftOnTable.toFixed(1)}% on the table`;
    else detail = 'Exit near midpoint of range';

    return { score: Math.max(-1, Math.min(1, score)), impact, detail };
  }

  private scoreSlippage(
    fees: number,
    entryPrice: number,
    quantity: number,
  ): { score: number; impact: number; detail: string } {
    const notional = entryPrice * quantity;
    if (notional === 0) {
      return { score: 0, impact: 0, detail: 'No notional value' };
    }

    const slippagePct = (fees / notional) * 100;

    // Under 0.3% is excellent, 0.3-1% is normal, over 1% is bad
    let score: number;
    if (slippagePct < 0.1) score = 1;
    else if (slippagePct < 0.3) score = 0.5;
    else if (slippagePct < 0.5) score = 0;
    else if (slippagePct < 1.0) score = -0.5;
    else score = -1;

    return {
      score,
      impact: -slippagePct,
      detail: `Slippage/fees: ${slippagePct.toFixed(3)}% of notional`,
    };
  }

  private scoreMarketRegime(
    volatility: number,
    pnlPct: number,
    holdMinutes: number,
  ): { score: number; impact: number; detail: string } {
    // High volatility + loss = bad regime for the strategy
    // Low volatility + win = good regime
    // Use volatility as a proxy for regime difficulty

    let score: number;
    if (pnlPct > 0) {
      // Won: regime was favorable (higher vol wins = even better)
      score = volatility > 0.02 ? 0.8 : 0.5; // High vol + win = strong signal
    } else {
      // Lost: was it the regime's fault?
      if (volatility > 0.03) {
        score = -0.8; // Very high vol + loss = regime was hostile
      } else if (volatility > 0.01) {
        score = -0.3; // Normal vol + loss = partial regime blame
      } else {
        score = -0.1; // Low vol + loss = regime wasn't the problem
      }
    }

    let detail: string;
    if (score > 0.3) detail = `Favorable market conditions (vol: ${(volatility * 100).toFixed(2)}%)`;
    else if (score < -0.3) detail = `Hostile market regime (vol: ${(volatility * 100).toFixed(2)}%) -- strategy may not suit this environment`;
    else detail = `Neutral market conditions (vol: ${(volatility * 100).toFixed(2)}%)`;

    return { score, impact: 0, detail };
  }

  private calculateVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    return Math.sqrt(variance);
  }
}
