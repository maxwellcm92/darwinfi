/**
 * price-feed.ts - Real-time price data from Uniswap V3 pools on Base
 *
 * Fetches prices using the Quoter V2 contract. Supports multiple token
 * pairs with configurable caching to avoid excessive RPC calls.
 *
 * Token universe: ETH, USDC, UNI, wstETH, ENS, AERO
 */

import { ethers } from 'ethers';
import { UniswapClient, BASE_TOKENS } from './uniswap-client';

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export interface TokenDefinition {
  address: string;
  symbol: string;
  decimals: number;
  /** Fee tier to use when quoting against WETH (default: 3000) */
  ethFeeTier?: number;
  /** Fee tier to use when quoting against USDC (default: 500 for stables, 3000 otherwise) */
  usdcFeeTier?: number;
}

export interface PriceData {
  token: string;
  symbol: string;
  priceUsd: number;
  priceEth: number;
  timestamp: number;
  source: 'quoter' | 'pool' | 'derived';
}

export interface PriceFeedConfig {
  /** How long cached prices remain valid, in milliseconds (default: 15000 = 15s) */
  cacheTtlMs?: number;
  /** Default slippage for 1 ETH quote (used to derive USD prices) */
  ethUsdcFeeTier?: number;
}

// -------------------------------------------------------------------
// Token Universe
// -------------------------------------------------------------------

export const TOKEN_UNIVERSE: Record<string, TokenDefinition> = {
  ETH: {
    address: BASE_TOKENS.WETH,
    symbol: 'ETH',
    decimals: 18,
    usdcFeeTier: 500,
  },
  USDC: {
    address: BASE_TOKENS.USDC,
    symbol: 'USDC',
    decimals: 6,
  },
  UNI: {
    address: BASE_TOKENS.UNI,
    symbol: 'UNI',
    decimals: 18,
    ethFeeTier: 3000,
    usdcFeeTier: 3000,
  },
  wstETH: {
    address: BASE_TOKENS.wstETH,
    symbol: 'wstETH',
    decimals: 18,
    ethFeeTier: 100, // wstETH/WETH is typically the 0.01% tier
  },
  AERO: {
    address: BASE_TOKENS.AERO,
    symbol: 'AERO',
    decimals: 18,
    ethFeeTier: 3000,
    usdcFeeTier: 3000,
  },
};

// -------------------------------------------------------------------
// Cache entry
// -------------------------------------------------------------------

interface CacheEntry {
  data: PriceData;
  expiresAt: number;
}

// -------------------------------------------------------------------
// PriceFeed
// -------------------------------------------------------------------

export class PriceFeed {
  private uniswap: UniswapClient;
  private cache: Map<string, CacheEntry> = new Map();
  private cacheTtlMs: number;
  private ethUsdcFeeTier: number;

  constructor(uniswap?: UniswapClient, config?: PriceFeedConfig) {
    this.uniswap = uniswap ?? new UniswapClient();
    this.cacheTtlMs = config?.cacheTtlMs ?? 15_000;
    this.ethUsdcFeeTier = config?.ethUsdcFeeTier ?? 500;
  }

  // ---------------------------------------------------------------
  // Core price fetching
  // ---------------------------------------------------------------

  /**
   * Get the USD price for a token by quoting through Uniswap V3.
   *
   * Strategy:
   *   - ETH: quote WETH -> USDC directly
   *   - USDC: always $1.00
   *   - Others: quote TOKEN -> WETH, then multiply by ETH/USD
   */
  async getPrice(symbol: string): Promise<PriceData> {
    const cacheKey = `price:${symbol}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }

    const tokenDef = TOKEN_UNIVERSE[symbol];
    if (!tokenDef) {
      throw new Error(
        `Unknown token symbol: ${symbol}. ` +
        `Available: ${Object.keys(TOKEN_UNIVERSE).join(', ')}`
      );
    }

    let priceData: PriceData;

    if (symbol === 'USDC') {
      priceData = {
        token: tokenDef.address,
        symbol: 'USDC',
        priceUsd: 1.0,
        priceEth: 0,
        timestamp: Date.now(),
        source: 'derived',
      };
      // Fill in priceEth from ETH price
      const ethPrice = await this.getPrice('ETH');
      priceData.priceEth = ethPrice.priceUsd > 0 ? 1 / ethPrice.priceUsd : 0;
    } else if (symbol === 'ETH') {
      priceData = await this.fetchEthPrice(tokenDef);
    } else {
      priceData = await this.fetchTokenPrice(symbol, tokenDef);
    }

    // Cache the result
    this.cache.set(cacheKey, {
      data: priceData,
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    return priceData;
  }

  /**
   * Get prices for all tokens in the universe.
   */
  async getAllPrices(): Promise<PriceData[]> {
    const symbols = Object.keys(TOKEN_UNIVERSE);
    // Fetch ETH first (others depend on it)
    await this.getPrice('ETH');
    // Then fetch the rest in parallel
    const others = symbols.filter((s) => s !== 'ETH');
    const prices = await Promise.all(others.map((s) => this.getPrice(s)));
    const ethPrice = await this.getPrice('ETH');
    return [ethPrice, ...prices];
  }

  /**
   * Get price for a specific token pair (not necessarily in USD).
   */
  async getPairPrice(
    tokenInSymbol: string,
    tokenOutSymbol: string,
    amountIn?: bigint
  ): Promise<{ amountOut: bigint; price: number }> {
    const tokenIn = TOKEN_UNIVERSE[tokenInSymbol];
    const tokenOut = TOKEN_UNIVERSE[tokenOutSymbol];
    if (!tokenIn || !tokenOut) {
      throw new Error(`Unknown token: ${tokenInSymbol} or ${tokenOutSymbol}`);
    }

    const inputAmount = amountIn ?? ethers.parseUnits('1', tokenIn.decimals);
    const fee = tokenIn.ethFeeTier ?? tokenOut.ethFeeTier ?? 3000;

    const quote = await this.uniswap.getQuote(
      tokenIn.address,
      tokenOut.address,
      inputAmount,
      fee
    );

    const price =
      Number(ethers.formatUnits(quote.amountOut, tokenOut.decimals)) /
      Number(ethers.formatUnits(inputAmount, tokenIn.decimals));

    return { amountOut: quote.amountOut, price };
  }

  // ---------------------------------------------------------------
  // Cache management
  // ---------------------------------------------------------------

  /**
   * Force invalidate all cached prices.
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Invalidate cache for a specific token.
   */
  invalidate(symbol: string): void {
    this.cache.delete(`price:${symbol}`);
  }

  /**
   * Set cache TTL (in milliseconds).
   */
  setCacheTtl(ms: number): void {
    this.cacheTtlMs = ms;
  }

  // ---------------------------------------------------------------
  // Internal price fetchers
  // ---------------------------------------------------------------

  private async fetchEthPrice(tokenDef: TokenDefinition): Promise<PriceData> {
    // Quote 1 WETH -> USDC
    const oneEth = ethers.parseUnits('1', 18);
    const quote = await this.uniswap.getQuote(
      tokenDef.address,
      BASE_TOKENS.USDC,
      oneEth,
      this.ethUsdcFeeTier
    );

    const priceUsd = Number(ethers.formatUnits(quote.amountOut, 6));

    return {
      token: tokenDef.address,
      symbol: 'ETH',
      priceUsd,
      priceEth: 1.0,
      timestamp: Date.now(),
      source: 'quoter',
    };
  }

  private async fetchTokenPrice(
    symbol: string,
    tokenDef: TokenDefinition
  ): Promise<PriceData> {
    // Try quoting TOKEN -> USDC directly first
    let priceUsd: number | null = null;
    let priceEth: number | null = null;
    let source: PriceData['source'] = 'quoter';

    const oneToken = ethers.parseUnits('1', tokenDef.decimals);

    // Attempt direct USDC quote
    if (tokenDef.usdcFeeTier) {
      try {
        const usdcQuote = await this.uniswap.getQuote(
          tokenDef.address,
          BASE_TOKENS.USDC,
          oneToken,
          tokenDef.usdcFeeTier
        );
        priceUsd = Number(ethers.formatUnits(usdcQuote.amountOut, 6));
      } catch {
        // Pool may not exist or have insufficient liquidity
      }
    }

    // Quote TOKEN -> WETH
    const ethFeeTier = tokenDef.ethFeeTier ?? 3000;
    try {
      const ethQuote = await this.uniswap.getQuote(
        tokenDef.address,
        BASE_TOKENS.WETH,
        oneToken,
        ethFeeTier
      );
      priceEth = Number(ethers.formatUnits(ethQuote.amountOut, 18));
    } catch {
      // Pool may not exist
    }

    // If we have ETH price but not USD, derive it
    if (priceEth !== null && priceUsd === null) {
      const ethPrice = await this.getPrice('ETH');
      priceUsd = priceEth * ethPrice.priceUsd;
      source = 'derived';
    }

    // If we have USD price but not ETH, derive it
    if (priceUsd !== null && priceEth === null) {
      const ethPrice = await this.getPrice('ETH');
      priceEth = ethPrice.priceUsd > 0 ? priceUsd / ethPrice.priceUsd : 0;
      source = 'derived';
    }

    if (priceUsd === null || priceEth === null) {
      throw new Error(
        `Unable to fetch price for ${symbol}. ` +
        `No USDC or WETH pool found with sufficient liquidity.`
      );
    }

    return {
      token: tokenDef.address,
      symbol,
      priceUsd,
      priceEth,
      timestamp: Date.now(),
      source,
    };
  }
}
