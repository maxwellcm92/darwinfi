/**
 * DarwinFi Circuit Breaker Safety System
 *
 * Per-strategy and portfolio-wide circuit breakers that automatically
 * pause trading when drawdown, consecutive losses, or position age
 * thresholds are exceeded. Protects capital during adverse conditions.
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface CircuitBreakerConfig {
  /** Max drawdown per strategy before pausing (default: 0.15 = 15%) */
  maxStrategyDrawdown: number;
  /** Max portfolio-wide drawdown before halting all trading (default: 0.25 = 25%) */
  maxPortfolioDrawdown: number;
  /** Number of consecutive losses to trigger auto-pause (default: 5) */
  maxConsecutiveLosses: number;
  /** Max position age in ms before auto-exit (default: 24h) */
  maxPositionAgeMs: number;
}

export interface BreakerState {
  strategyId: string;
  isPaused: boolean;
  pauseReason?: string;
  consecutiveLosses: number;
  currentDrawdown: number;
  peakEquity: number;
  manualOverride: boolean;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  maxStrategyDrawdown: 0.15,
  maxPortfolioDrawdown: 0.25,
  maxConsecutiveLosses: 5,
  maxPositionAgeMs: 24 * 60 * 60 * 1000,
};

// ---------------------------------------------------------------------------
// CircuitBreaker
// ---------------------------------------------------------------------------

export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private states: Map<string, BreakerState> = new Map();
  private portfolioHalted = false;
  private portfolioPeakValue = 0;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ---- Strategy lifecycle ------------------------------------------------

  /** Initialize breaker state for a strategy */
  initStrategy(strategyId: string): void {
    if (this.states.has(strategyId)) return;
    this.states.set(strategyId, {
      strategyId,
      isPaused: false,
      consecutiveLosses: 0,
      currentDrawdown: 0,
      peakEquity: 0,
      manualOverride: false,
    });
  }

  // ---- Trade recording ---------------------------------------------------

  /** Record a trade result and check if breaker should trip */
  recordTradeResult(
    strategyId: string,
    pnl: number,
    equityAfterTrade: number,
  ): { tripped: boolean; reason?: string } {
    const state = this.getOrInit(strategyId);

    // Update consecutive losses
    if (pnl < 0) {
      state.consecutiveLosses++;
    } else {
      state.consecutiveLosses = 0;
    }

    // Update peak equity and drawdown
    if (equityAfterTrade > state.peakEquity) {
      state.peakEquity = equityAfterTrade;
    }
    state.currentDrawdown =
      state.peakEquity > 0
        ? (state.peakEquity - equityAfterTrade) / state.peakEquity
        : 0;

    // Check consecutive loss threshold
    if (state.consecutiveLosses >= this.config.maxConsecutiveLosses) {
      const reason = `Consecutive losses reached ${state.consecutiveLosses} (limit: ${this.config.maxConsecutiveLosses})`;
      state.isPaused = true;
      state.pauseReason = reason;
      return { tripped: true, reason };
    }

    // Check drawdown threshold
    if (state.currentDrawdown >= this.config.maxStrategyDrawdown) {
      const reason = `Strategy drawdown ${(state.currentDrawdown * 100).toFixed(1)}% exceeds limit ${(this.config.maxStrategyDrawdown * 100).toFixed(1)}%`;
      state.isPaused = true;
      state.pauseReason = reason;
      return { tripped: true, reason };
    }

    return { tripped: false };
  }

  // ---- Portfolio-wide halt -----------------------------------------------

  /** Check portfolio-wide halt condition */
  checkPortfolioHalt(totalPortfolioValue: number): {
    halted: boolean;
    reason?: string;
  } {
    if (totalPortfolioValue > this.portfolioPeakValue) {
      this.portfolioPeakValue = totalPortfolioValue;
    }

    const drawdown =
      this.portfolioPeakValue > 0
        ? (this.portfolioPeakValue - totalPortfolioValue) /
          this.portfolioPeakValue
        : 0;

    if (drawdown >= this.config.maxPortfolioDrawdown) {
      this.portfolioHalted = true;
      const reason = `Portfolio drawdown ${(drawdown * 100).toFixed(1)}% exceeds limit ${(this.config.maxPortfolioDrawdown * 100).toFixed(1)}%`;
      return { halted: true, reason };
    }

    return { halted: false };
  }

  // ---- Trade gating ------------------------------------------------------

  /** Check if a strategy is allowed to trade */
  canTrade(strategyId: string): { allowed: boolean; reason?: string } {
    if (this.portfolioHalted) {
      return {
        allowed: false,
        reason: 'Portfolio-wide halt is active',
      };
    }

    const state = this.states.get(strategyId);
    if (!state) return { allowed: true };

    if (state.isPaused && !state.manualOverride) {
      return {
        allowed: false,
        reason: state.pauseReason || 'Strategy is paused',
      };
    }

    return { allowed: true };
  }

  // ---- Manual override ---------------------------------------------------

  /** Manual override - allow trading despite breaker */
  setManualOverride(strategyId: string, override: boolean): void {
    const state = this.getOrInit(strategyId);
    state.manualOverride = override;
  }

  // ---- Reset -------------------------------------------------------------

  /** Reset a strategy's breaker state */
  resetBreaker(strategyId: string): void {
    const state = this.states.get(strategyId);
    if (!state) return;
    state.isPaused = false;
    state.pauseReason = undefined;
    state.consecutiveLosses = 0;
    state.currentDrawdown = 0;
    state.manualOverride = false;
  }

  // ---- State access ------------------------------------------------------

  /** Get breaker state for dashboard display */
  getBreakerState(strategyId: string): BreakerState | undefined {
    return this.states.get(strategyId);
  }

  /** Get all breaker states */
  getAllBreakerStates(): BreakerState[] {
    return Array.from(this.states.values());
  }

  // ---- Position age check ------------------------------------------------

  /** Check if any position is too old */
  checkPositionAge(
    strategyId: string,
    positionOpenTime: number,
  ): { expired: boolean; ageMs: number } {
    const ageMs = Date.now() - positionOpenTime;
    return {
      expired: ageMs >= this.config.maxPositionAgeMs,
      ageMs,
    };
  }

  // ---- Price validation (static) -----------------------------------------

  /** Validate a price for sanity (non-negative, not a >10% spike) */
  static validatePrice(
    price: number,
    lastPrice?: number,
  ): { valid: boolean; reason?: string } {
    if (price <= 0) {
      return { valid: false, reason: 'Price must be positive' };
    }
    if (lastPrice && Math.abs((price - lastPrice) / lastPrice) > 0.1) {
      return {
        valid: false,
        reason: `Price change >10%: ${lastPrice} -> ${price}`,
      };
    }
    return { valid: true };
  }

  // ---- Serialization -----------------------------------------------------

  /** Serialize all breaker states for persistence */
  serialize(): Record<string, BreakerState> {
    const result: Record<string, BreakerState> = {};
    for (const [id, state] of this.states) {
      result[id] = { ...state };
    }
    return result;
  }

  /** Deserialize saved breaker states */
  deserialize(data: Record<string, BreakerState>): void {
    this.states.clear();
    for (const [id, state] of Object.entries(data)) {
      this.states.set(id, { ...state });
    }
  }

  // ---- Internal helpers --------------------------------------------------

  private getOrInit(strategyId: string): BreakerState {
    let state = this.states.get(strategyId);
    if (!state) {
      this.initStrategy(strategyId);
      state = this.states.get(strategyId)!;
    }
    return state;
  }
}
