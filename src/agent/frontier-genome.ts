/**
 * DarwinFi Frontier Genome Types
 *
 * Extended genome types for Team 4 "Frontier" cross-chain bots.
 * Defines 4 bot archetypes: Abiogenesis, Mitosis, Cambrian, Symbiont.
 */

// ---------------------------------------------------------------------------
// Entry & Exit Methods
// ---------------------------------------------------------------------------

export type FrontierEntryMethod =
  | 'pair_created'       // Abiogenesis: new pair detected
  | 'rug_screened'       // Abiogenesis: passed rug detection
  | 'micro_spread'       // Mitosis: profitable spread found
  | 'mean_reversion'     // Mitosis: price deviation from mean
  | 'volatility_breakout'// Cambrian: vol spike above threshold
  | 'vol_compression'    // Cambrian: vol compression before breakout
  | 'whale_mirror'       // Symbiont: mirror whale entry
  | 'whale_front_run';   // Symbiont: front-run detected whale

export type FrontierExitMethod =
  | 'pump_exit'          // Abiogenesis: exit on first major pump
  | 'micro_target'       // Mitosis: fixed micro profit target
  | 'vol_decay'          // Cambrian: exit when volatility decays
  | 'whale_exit_mirror'; // Symbiont: mirror whale exit

// ---------------------------------------------------------------------------
// Chain & Routing Modes
// ---------------------------------------------------------------------------

export type ChainSelectionMode = 'fixed' | 'cheapest_gas' | 'deepest_liquidity' | 'highest_volume';
export type DexRouting = '1inch' | 'uniswap_direct' | 'auto';
export type BotArchetype = 'abiogenesis' | 'mitosis' | 'cambrian' | 'symbiont';

// ---------------------------------------------------------------------------
// Bot-Specific Parameter Blocks
// ---------------------------------------------------------------------------

export interface AbiogenesisParams {
  minSafetyScore: number;          // 0-100, minimum rug detection score
  maxMarketCapUsd: number;         // Maximum market cap to consider
  pumpExitMultiplier: number;      // Exit at Nx entry price
  maxHoldTimeMs: number;           // Auto-exit timer
}

export interface MitosisParams {
  maxTradesPerHour: number;        // Rate limit
  minSpreadBps: number;            // Minimum spread in basis points
  targetProfitBps: number;         // Target profit per trade in bps
  maxPositionSizeUsd: number;      // Per-trade size cap
}

export interface CambrianParams {
  volThresholdMultiplier: number;  // Current/avg vol ratio to trigger
  volWindowMinutes: number;        // Rolling window for vol calc
  catalystWeight: number;          // 0-1: weight given to catalyst signals
  maxExposurePerEvent: number;     // Max USD per volatility event
}

export interface SymbiontParams {
  mirrorDelayMs: number;           // Delay before mirroring whale
  minWhaleScore: number;           // 0-100: minimum whale quality score
  stopLossPct: number;             // Tighter stop than whales
  maxCopyPositions: number;        // Max concurrent copy positions
}

// ---------------------------------------------------------------------------
// Frontier Genome
// ---------------------------------------------------------------------------

export interface FrontierGenome {
  id: string;
  name: string;
  archetype: BotArchetype;
  parameters: {
    entryMethod: FrontierEntryMethod;
    exitMethod: FrontierExitMethod;
    chainPreferences: number[];      // Preferred chain IDs
    chainSelectionMode: ChainSelectionMode;
    dexRouting: DexRouting;
    riskPerTradePct: number;
    maxPositions: number;
    trailingStopPct: number;
    takeProfitPct: number;
    // Bot-specific params
    abiogenesis?: AbiogenesisParams;
    mitosis?: MitosisParams;
    cambrian?: CambrianParams;
    symbiont?: SymbiontParams;
  };
  status: 'paper' | 'live' | 'sell_only';
  generation: number;
}

// ---------------------------------------------------------------------------
// Seed Genomes
// ---------------------------------------------------------------------------

export function createSeedFrontierGenomes(): FrontierGenome[] {
  const abiogenesis: FrontierGenome = {
    id: 'frontier-abiogenesis',
    name: 'Abiogenesis',
    archetype: 'abiogenesis',
    parameters: {
      entryMethod: 'rug_screened',
      exitMethod: 'pump_exit',
      chainPreferences: [8453, 42161],
      chainSelectionMode: 'highest_volume',
      dexRouting: 'auto',
      riskPerTradePct: 1.0,
      maxPositions: 2,
      trailingStopPct: 20,
      takeProfitPct: 100,
      abiogenesis: {
        minSafetyScore: 60,
        maxMarketCapUsd: 1_000_000,
        pumpExitMultiplier: 5,
        maxHoldTimeMs: 3_600_000,
      },
    },
    status: 'paper',
    generation: 0,
  };

  const mitosis: FrontierGenome = {
    id: 'frontier-mitosis',
    name: 'Mitosis',
    archetype: 'mitosis',
    parameters: {
      entryMethod: 'micro_spread',
      exitMethod: 'micro_target',
      chainPreferences: [8453, 42161],
      chainSelectionMode: 'cheapest_gas',
      dexRouting: '1inch',
      riskPerTradePct: 0.5,
      maxPositions: 10,
      trailingStopPct: 2,
      takeProfitPct: 1,
      mitosis: {
        maxTradesPerHour: 60,
        minSpreadBps: 5,
        targetProfitBps: 3,
        maxPositionSizeUsd: 50,
      },
    },
    status: 'paper',
    generation: 0,
  };

  const cambrian: FrontierGenome = {
    id: 'frontier-cambrian',
    name: 'Cambrian',
    archetype: 'cambrian',
    parameters: {
      entryMethod: 'volatility_breakout',
      exitMethod: 'vol_decay',
      chainPreferences: [8453, 42161],
      chainSelectionMode: 'highest_volume',
      dexRouting: 'auto',
      riskPerTradePct: 2.0,
      maxPositions: 3,
      trailingStopPct: 10,
      takeProfitPct: 30,
      cambrian: {
        volThresholdMultiplier: 2.0,
        volWindowMinutes: 60,
        catalystWeight: 0.5,
        maxExposurePerEvent: 200,
      },
    },
    status: 'paper',
    generation: 0,
  };

  const symbiont: FrontierGenome = {
    id: 'frontier-symbiont',
    name: 'Symbiont',
    archetype: 'symbiont',
    parameters: {
      entryMethod: 'whale_mirror',
      exitMethod: 'whale_exit_mirror',
      chainPreferences: [8453, 42161],
      chainSelectionMode: 'deepest_liquidity',
      dexRouting: '1inch',
      riskPerTradePct: 1.5,
      maxPositions: 4,
      trailingStopPct: 5,
      takeProfitPct: 15,
      symbiont: {
        mirrorDelayMs: 2000,
        minWhaleScore: 70,
        stopLossPct: 5,
        maxCopyPositions: 4,
      },
    },
    status: 'paper',
    generation: 0,
  };

  return [abiogenesis, mitosis, cambrian, symbiont];
}
