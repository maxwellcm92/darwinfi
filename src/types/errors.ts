/**
 * errors.ts - Structured error taxonomy for DarwinFi
 *
 * Hierarchical error system with subsystem-specific error classes
 * and standardized error codes. All errors extend DarwinError which
 * carries a machine-readable code and subsystem identifier.
 */

// -------------------------------------------------------------------
// Base error
// -------------------------------------------------------------------

export class DarwinError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly subsystem: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DarwinError';
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      subsystem: this.subsystem,
      message: this.message,
      stack: this.stack,
    };
  }
}

// -------------------------------------------------------------------
// Agent subsystem
// -------------------------------------------------------------------

export class AgentError extends DarwinError {
  constructor(message: string, code: string, cause?: unknown) {
    super(message, code, 'agent', cause);
    this.name = 'AgentError';
  }
}

export const AgentErrorCodes = {
  BORROW_FAILED: 'AGENT_BORROW_FAILED',
  RETURN_FAILED: 'AGENT_RETURN_FAILED',
  INSUFFICIENT_BALANCE: 'AGENT_INSUFFICIENT_BALANCE',
  APPROVAL_FAILED: 'AGENT_APPROVAL_FAILED',
  WALLET_ERROR: 'AGENT_WALLET_ERROR',
  CONFIG_INVALID: 'AGENT_CONFIG_INVALID',
} as const;

// -------------------------------------------------------------------
// Trading subsystem
// -------------------------------------------------------------------

export class TradingError extends DarwinError {
  constructor(message: string, code: string, cause?: unknown) {
    super(message, code, 'trading', cause);
    this.name = 'TradingError';
  }
}

export const TradingErrorCodes = {
  SLIPPAGE_EXCEEDED: 'TRADE_SLIPPAGE_EXCEEDED',
  INSUFFICIENT_BALANCE: 'TRADE_INSUFFICIENT_BALANCE',
  INSUFFICIENT_LIQUIDITY: 'TRADE_INSUFFICIENT_LIQUIDITY',
  SWAP_FAILED: 'TRADE_SWAP_FAILED',
  QUOTE_FAILED: 'TRADE_QUOTE_FAILED',
  POSITION_SIZE_INVALID: 'TRADE_POSITION_SIZE_INVALID',
  DEADLINE_EXPIRED: 'TRADE_DEADLINE_EXPIRED',
  PAIR_NOT_FOUND: 'TRADE_PAIR_NOT_FOUND',
} as const;

// -------------------------------------------------------------------
// Evolution subsystem
// -------------------------------------------------------------------

export class EvolutionError extends DarwinError {
  constructor(message: string, code: string, cause?: unknown) {
    super(message, code, 'evolution', cause);
    this.name = 'EvolutionError';
  }
}

export const EvolutionErrorCodes = {
  DIFF_INVALID: 'EVOLUTION_DIFF_INVALID',
  SANDBOX_FAILED: 'EVOLUTION_SANDBOX_FAILED',
  MUTATION_REJECTED: 'EVOLUTION_MUTATION_REJECTED',
  CANARY_FAILED: 'EVOLUTION_CANARY_FAILED',
  ROLLBACK_FAILED: 'EVOLUTION_ROLLBACK_FAILED',
  AI_GENERATION_FAILED: 'EVOLUTION_AI_GENERATION_FAILED',
  TEST_FAILED: 'EVOLUTION_TEST_FAILED',
} as const;

// -------------------------------------------------------------------
// Immune / circuit breaker subsystem
// -------------------------------------------------------------------

export class ImmuneError extends DarwinError {
  constructor(message: string, code: string, cause?: unknown) {
    super(message, code, 'immune', cause);
    this.name = 'ImmuneError';
  }
}

export const ImmuneErrorCodes = {
  CIRCUIT_TRIPPED: 'IMMUNE_CIRCUIT_TRIPPED',
  THRESHOLD_EXCEEDED: 'IMMUNE_THRESHOLD_EXCEEDED',
  DRAWDOWN_LIMIT: 'IMMUNE_DRAWDOWN_LIMIT',
  LOSS_STREAK: 'IMMUNE_LOSS_STREAK',
  COOLDOWN_ACTIVE: 'IMMUNE_COOLDOWN_ACTIVE',
} as const;

// -------------------------------------------------------------------
// Frontier subsystem
// -------------------------------------------------------------------

export class FrontierError extends DarwinError {
  constructor(message: string, code: string, cause?: unknown) {
    super(message, code, 'frontier', cause);
    this.name = 'FrontierError';
  }
}

export const FrontierErrorCodes = {
  RUG_DETECTED: 'FRONTIER_RUG_DETECTED',
  WHALE_ALERT: 'FRONTIER_WHALE_ALERT',
  DISCOVERY_FAILED: 'FRONTIER_DISCOVERY_FAILED',
  SPREAD_SCAN_FAILED: 'FRONTIER_SPREAD_SCAN_FAILED',
  VOL_SCAN_FAILED: 'FRONTIER_VOL_SCAN_FAILED',
  WHALE_SCAN_FAILED: 'FRONTIER_WHALE_SCAN_FAILED',
  API_ERROR: 'FRONTIER_API_ERROR',
  PROVIDER_MISSING: 'FRONTIER_PROVIDER_MISSING',
  DATA_PARSE_ERROR: 'FRONTIER_DATA_PARSE_ERROR',
  HONEYPOT_DETECTED: 'FRONTIER_HONEYPOT_DETECTED',
} as const;

// -------------------------------------------------------------------
// Chain / on-chain interaction subsystem
// -------------------------------------------------------------------

export class ChainError extends DarwinError {
  constructor(message: string, code: string, cause?: unknown) {
    super(message, code, 'chain', cause);
    this.name = 'ChainError';
  }
}

export const ChainErrorCodes = {
  RPC_ERROR: 'CHAIN_RPC_ERROR',
  TX_REVERTED: 'CHAIN_TX_REVERTED',
  TX_TIMEOUT: 'CHAIN_TX_TIMEOUT',
  NONCE_ERROR: 'CHAIN_NONCE_ERROR',
  GAS_ESTIMATION_FAILED: 'CHAIN_GAS_ESTIMATION_FAILED',
  CONTRACT_CALL_FAILED: 'CHAIN_CONTRACT_CALL_FAILED',
  PROVIDER_UNAVAILABLE: 'CHAIN_PROVIDER_UNAVAILABLE',
  INSUFFICIENT_GAS: 'CHAIN_INSUFFICIENT_GAS',
} as const;

// -------------------------------------------------------------------
// Utility: wrap unknown errors
// -------------------------------------------------------------------

/**
 * Wrap an unknown caught error into the appropriate DarwinError subclass.
 * Preserves the original error as `cause`.
 */
export function wrapError(
  err: unknown,
  ErrorClass: new (message: string, code: string, cause?: unknown) => DarwinError,
  code: string,
  context?: string,
): DarwinError {
  const message = err instanceof Error ? err.message : String(err);
  return new ErrorClass(context ? `${context}: ${message}` : message, code, err);
}
