/**
 * vol-scanner.ts - Realized volatility scanner with catalyst detection
 *
 * For the Cambrian bot. Tracks price histories for tokens across chains,
 * computes rolling realized volatility, and detects vol spikes that
 * exceed a configurable threshold multiplier. Also checks DexScreener
 * for social/catalyst signals.
 */

import { JsonRpcProvider } from 'ethers';
import { FrontierError, FrontierErrorCodes, wrapError } from '../../types/errors';

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export interface VolatilityEvent {
  chainId: number;
  chainName: string;
  tokenAddress: string;
  tokenSymbol: string;
  currentVol: number;
  averageVol: number;
  volRatio: number;
  catalyst?: string;
  timestamp: number;
}

interface PricePoint {
  price: number;
  timestamp: number;
}

// -------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------

const CHAIN_NAMES: Record<number, string> = {
  8453: 'Base',
  42161: 'Arbitrum',
};

const DEXSCREENER_CHAIN_MAP: Record<number, string> = {
  8453: 'base',
  42161: 'arbitrum',
};

// Maximum price history entries per token to prevent unbounded growth
const MAX_HISTORY_LENGTH = 10_000;

// -------------------------------------------------------------------
// VolScanner
// -------------------------------------------------------------------

export class VolScanner {
  private priceHistories: Map<string, PricePoint[]> = new Map();
  private providers: Map<number, JsonRpcProvider>;
  private windowMinutes: number;
  private symbolCache: Map<string, string> = new Map(); // key -> symbol

  constructor(providers: Map<number, JsonRpcProvider>, windowMinutes = 60) {
    this.providers = providers;
    this.windowMinutes = windowMinutes;
  }

  // ---------------------------------------------------------------
  // Price recording
  // ---------------------------------------------------------------

  /**
   * Record a price data point for a token on a specific chain.
   */
  recordPrice(chainId: number, tokenAddress: string, price: number, symbol?: string): void {
    const key = `${chainId}:${tokenAddress.toLowerCase()}`;

    let history = this.priceHistories.get(key);
    if (!history) {
      history = [];
      this.priceHistories.set(key, history);
    }

    history.push({ price, timestamp: Date.now() });

    // Trim to prevent unbounded growth
    if (history.length > MAX_HISTORY_LENGTH) {
      this.priceHistories.set(key, history.slice(history.length - MAX_HISTORY_LENGTH / 2));
    }

    // Cache symbol if provided
    if (symbol) {
      this.symbolCache.set(key, symbol);
    }
  }

  // ---------------------------------------------------------------
  // Volatility computation
  // ---------------------------------------------------------------

  /**
   * Compute realized volatility for a token using log returns
   * over the configured window. Returns annualized volatility as a decimal.
   */
  computeRealizedVol(chainId: number, tokenAddress: string): number {
    const key = `${chainId}:${tokenAddress.toLowerCase()}`;
    const history = this.priceHistories.get(key);
    if (!history || history.length < 3) return 0;

    const windowMs = this.windowMinutes * 60 * 1000;
    const cutoff = Date.now() - windowMs;

    // Filter to window
    const windowPrices = history.filter((p) => p.timestamp >= cutoff);
    if (windowPrices.length < 3) return 0;

    // Compute log returns
    const logReturns: number[] = [];
    for (let i = 1; i < windowPrices.length; i++) {
      const prev = windowPrices[i - 1].price;
      const curr = windowPrices[i].price;
      if (prev > 0 && curr > 0) {
        logReturns.push(Math.log(curr / prev));
      }
    }

    if (logReturns.length < 2) return 0;

    // Standard deviation of log returns
    const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
    const variance = logReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (logReturns.length - 1);
    const stdDev = Math.sqrt(variance);

    // Annualize: assume ~4 data points per minute (15s intervals)
    // Periods per year = 4 * 60 * 24 * 365 = 2,102,400
    const avgIntervalMs = windowMs / windowPrices.length;
    const periodsPerYear = (365 * 24 * 60 * 60 * 1000) / avgIntervalMs;
    const annualizedVol = stdDev * Math.sqrt(periodsPerYear);

    return annualizedVol;
  }

  /**
   * Compute the average realized volatility over a longer lookback
   * (3x the window) for comparison against current vol.
   */
  private computeAverageVol(chainId: number, tokenAddress: string): number {
    const key = `${chainId}:${tokenAddress.toLowerCase()}`;
    const history = this.priceHistories.get(key);
    if (!history || history.length < 5) return 0;

    // Use 3x window for the average baseline
    const longWindowMs = this.windowMinutes * 3 * 60 * 1000;
    const cutoff = Date.now() - longWindowMs;
    const longPrices = history.filter((p) => p.timestamp >= cutoff);
    if (longPrices.length < 5) return 0;

    // Compute vol over the long window in chunks equal to the short window
    const chunkMs = this.windowMinutes * 60 * 1000;
    const vols: number[] = [];

    let chunkStart = cutoff;
    while (chunkStart < Date.now() - chunkMs) {
      const chunkEnd = chunkStart + chunkMs;
      const chunkPrices = longPrices.filter(
        (p) => p.timestamp >= chunkStart && p.timestamp < chunkEnd
      );

      if (chunkPrices.length >= 3) {
        const logReturns: number[] = [];
        for (let i = 1; i < chunkPrices.length; i++) {
          const prev = chunkPrices[i - 1].price;
          const curr = chunkPrices[i].price;
          if (prev > 0 && curr > 0) {
            logReturns.push(Math.log(curr / prev));
          }
        }

        if (logReturns.length >= 2) {
          const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
          const variance = logReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (logReturns.length - 1);
          vols.push(Math.sqrt(variance));
        }
      }

      chunkStart = chunkEnd;
    }

    if (vols.length === 0) return 0;
    return vols.reduce((a, b) => a + b, 0) / vols.length;
  }

  // ---------------------------------------------------------------
  // Scanning
  // ---------------------------------------------------------------

  /**
   * Scan all tracked tokens for volatility events exceeding threshold.
   */
  scanAll(thresholdMultiplier = 2.0): VolatilityEvent[] {
    return this.getVolatilityEvents(thresholdMultiplier);
  }

  /**
   * Get tokens with vol spikes exceeding the threshold multiplier.
   */
  getVolatilityEvents(thresholdMultiplier = 2.0): VolatilityEvent[] {
    const events: VolatilityEvent[] = [];

    for (const key of this.priceHistories.keys()) {
      const [chainIdStr, tokenAddress] = key.split(':');
      const chainId = Number(chainIdStr);

      const currentVol = this.computeRealizedVol(chainId, tokenAddress);
      const averageVol = this.computeAverageVol(chainId, tokenAddress);

      if (currentVol <= 0 || averageVol <= 0) continue;

      const volRatio = currentVol / averageVol;

      if (volRatio >= thresholdMultiplier) {
        events.push({
          chainId,
          chainName: CHAIN_NAMES[chainId] ?? `Chain ${chainId}`,
          tokenAddress,
          tokenSymbol: this.symbolCache.get(key) ?? 'UNKNOWN',
          currentVol,
          averageVol,
          volRatio,
          timestamp: Date.now(),
        });
      }
    }

    // Sort by vol ratio descending
    events.sort((a, b) => b.volRatio - a.volRatio);
    return events;
  }

  // ---------------------------------------------------------------
  // Catalyst detection
  // ---------------------------------------------------------------

  /**
   * Check DexScreener for social/community signals that might explain
   * a volatility spike. Returns a catalyst label if found.
   */
  async checkCatalysts(tokenAddress: string, chainId: number): Promise<string | undefined> {
    const network = DEXSCREENER_CHAIN_MAP[chainId];
    if (!network) return undefined;

    try {
      const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
      const resp = await fetch(url);
      if (!resp.ok) return undefined;

      const data = await resp.json() as {
        pairs?: Array<{
          priceChange?: { h1?: number; h24?: number };
          txns?: { h1?: { buys: number; sells: number } };
          info?: { socials?: Array<{ type: string }> };
          labels?: string[];
        }>;
      };

      if (!data.pairs || data.pairs.length === 0) return undefined;

      const pair = data.pairs[0];

      // Check for governance-related labels
      if (pair.labels?.some((l) => l.toLowerCase().includes('governance'))) {
        return 'governance_vote';
      }

      // Check for airdrop signals (sudden buy spike with social presence)
      const h1Buys = pair.txns?.h1?.buys ?? 0;
      const h1Sells = pair.txns?.h1?.sells ?? 0;
      if (h1Buys > 0 && h1Sells > 0 && h1Buys / h1Sells > 5) {
        return 'airdrop';
      }

      // Check for protocol launch (massive price change)
      const h1Change = pair.priceChange?.h1 ?? 0;
      if (Math.abs(h1Change) > 50) {
        return 'protocol_launch';
      }

      // Check for social presence
      if (pair.info?.socials && pair.info.socials.length > 0) {
        return 'social_activity';
      }

      return undefined;
    } catch (err) {
      const wrapped = wrapError(err, FrontierError, FrontierErrorCodes.API_ERROR, `DexScreener catalyst check failed for ${tokenAddress}`);
      console.error('[VolScanner] Catalyst check error:', wrapped.code, wrapped.message);
      return undefined;
    }
  }
}
