/**
 * spread-scanner.ts - DEX spread opportunity scanner
 *
 * For the Mitosis bot. Periodically scans Uniswap V3 pools across chains
 * for bid-ask spreads that exceed a minimum threshold after gas costs.
 * Maintains a ranked list of top spread opportunities.
 */

import { ethers, JsonRpcProvider, Contract } from 'ethers';

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export interface SpreadOpportunity {
  chainId: number;
  chainName: string;
  poolAddress: string;
  token0: string;
  token1: string;
  spreadBps: number;
  estimatedGasUsd: number;
  netProfitBps: number;
  liquidity: bigint;
  volume24h?: number;
  timestamp: number;
}

// -------------------------------------------------------------------
// ABIs
// -------------------------------------------------------------------

const POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function fee() external view returns (uint24)',
  'function liquidity() external view returns (uint128)',
  'function observe(uint32[] secondsAgos) external view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)',
];

const FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];

const ERC20_ABI = [
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

// -------------------------------------------------------------------
// Chain configs
// -------------------------------------------------------------------

const CHAIN_NAMES: Record<number, string> = {
  8453: 'Base',
  42161: 'Arbitrum',
};

// Well-known token addresses per chain for scanning
const SCAN_TOKENS: Record<number, Array<{ symbol: string; address: string }>> = {
  8453: [
    { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006' },
    { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
    { symbol: 'AERO', address: '0x940181a94A35A4569E4529A3CDfB74e38FD98631' },
    { symbol: 'DEGEN', address: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed' },
    { symbol: 'BRETT', address: '0x532f27101965dd16442E59d40670FaF5eBB142E4' },
    { symbol: 'VIRTUAL', address: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b' },
  ],
  42161: [
    { symbol: 'WETH', address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' },
    { symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' },
    { symbol: 'ARB', address: '0x912CE59144191C1204E64559FE8253a0e49E6548' },
    { symbol: 'GMX', address: '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a' },
  ],
};

const FACTORY_ADDRESSES: Record<number, string> = {
  8453: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  42161: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
};

const FEE_TIERS = [100, 500, 3000, 10000]; // 0.01%, 0.05%, 0.3%, 1%

// Approximate gas cost for a Uniswap V3 swap
const SWAP_GAS_UNITS = 150_000n;

// -------------------------------------------------------------------
// SpreadScanner
// -------------------------------------------------------------------

export class SpreadScanner {
  private providers: Map<number, JsonRpcProvider>;
  private scanIntervalMs: number;
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private topPools: Map<string, SpreadOpportunity> = new Map();

  constructor(providers: Map<number, JsonRpcProvider>, scanIntervalMs = 15_000) {
    this.providers = providers;
    this.scanIntervalMs = scanIntervalMs;
  }

  // ---------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;

    // Run first scan immediately
    this.scanAll().catch((err) =>
      console.error('[SpreadScanner] Initial scan error:', err)
    );

    this.timer = setInterval(async () => {
      try {
        await this.scanAll();
      } catch (err) {
        console.error('[SpreadScanner] Scan error:', err);
      }
    }, this.scanIntervalMs);

    console.log(
      `[SpreadScanner] Started. Interval: ${this.scanIntervalMs}ms, ` +
      `chains: ${[...this.providers.keys()].join(', ')}`
    );
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    console.log('[SpreadScanner] Stopped.');
  }

  // ---------------------------------------------------------------
  // Scanning
  // ---------------------------------------------------------------

  async scanAll(): Promise<SpreadOpportunity[]> {
    const allOpportunities: SpreadOpportunity[] = [];

    const chainScans = [...this.providers.entries()].map(async ([chainId, provider]) => {
      try {
        const opportunities = await this.scanChain(chainId, provider);
        allOpportunities.push(...opportunities);
      } catch (err) {
        console.error(`[SpreadScanner] Chain ${chainId} scan error:`, err);
      }
    });

    await Promise.all(chainScans);

    // Update top pools map
    for (const opp of allOpportunities) {
      const key = `${opp.chainId}:${opp.poolAddress}`;
      this.topPools.set(key, opp);
    }

    return allOpportunities;
  }

  filterProfitable(minNetProfitBps = 1): SpreadOpportunity[] {
    return [...this.topPools.values()]
      .filter((opp) => opp.netProfitBps >= minNetProfitBps)
      .sort((a, b) => b.netProfitBps - a.netProfitBps);
  }

  getTopPools(limit = 10): SpreadOpportunity[] {
    return [...this.topPools.values()]
      .sort((a, b) => b.netProfitBps - a.netProfitBps)
      .slice(0, limit);
  }

  // ---------------------------------------------------------------
  // Per-chain scanning
  // ---------------------------------------------------------------

  private async scanChain(chainId: number, provider: JsonRpcProvider): Promise<SpreadOpportunity[]> {
    const tokens = SCAN_TOKENS[chainId];
    const factoryAddress = FACTORY_ADDRESSES[chainId];
    if (!tokens || !factoryAddress) return [];

    const factory = new Contract(factoryAddress, FACTORY_ABI, provider);
    const opportunities: SpreadOpportunity[] = [];

    // Get current gas price for cost estimation
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? 0n;
    const ethPriceUsd = await this.getEthPriceUsd(chainId, provider);

    // Generate unique token pairs
    const pairs: Array<[typeof tokens[0], typeof tokens[0]]> = [];
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        pairs.push([tokens[i], tokens[j]]);
      }
    }

    // Scan each pair across fee tiers
    const pairScans = pairs.map(async ([tokenA, tokenB]) => {
      for (const fee of FEE_TIERS) {
        try {
          const poolAddress: string = await factory.getPool(tokenA.address, tokenB.address, fee);
          if (poolAddress === ethers.ZeroAddress) continue;

          const spreadBps = await this.getPoolSpread(poolAddress, provider);
          if (spreadBps <= 0) continue;

          // Estimate gas cost in USD
          const gasCostWei = gasPrice * SWAP_GAS_UNITS;
          const gasCostEth = Number(ethers.formatEther(gasCostWei));
          const estimatedGasUsd = gasCostEth * ethPriceUsd;

          // Get pool liquidity
          const pool = new Contract(poolAddress, POOL_ABI, provider);
          const liquidity: bigint = await pool.liquidity();

          // Net profit: spread minus gas cost as basis points of a reference trade size ($100)
          const gasCostBps = (estimatedGasUsd / 100) * 10000; // gas as bps of $100 trade
          const netProfitBps = spreadBps - gasCostBps;

          opportunities.push({
            chainId,
            chainName: CHAIN_NAMES[chainId] ?? `Chain ${chainId}`,
            poolAddress,
            token0: tokenA.address,
            token1: tokenB.address,
            spreadBps,
            estimatedGasUsd,
            netProfitBps,
            liquidity,
            timestamp: Date.now(),
          });
        } catch {
          // Pool doesn't exist or read failed, skip
        }
      }
    });

    await Promise.all(pairScans);
    return opportunities;
  }

  /**
   * Estimate the effective spread of a pool by looking at tick spacing
   * and the difference between the current tick and the nearest initialized ticks.
   * Uses the observe() function to get recent price movement as a spread proxy.
   */
  private async getPoolSpread(poolAddress: string, provider: JsonRpcProvider): Promise<number> {
    try {
      const pool = new Contract(poolAddress, POOL_ABI, provider);

      // Get slot0 for current price
      const slot0 = await pool.slot0();
      const currentTick = Number(slot0[1]);

      // Use observe() to get tick at 10 seconds ago vs now
      // The difference gives us price movement (a proxy for spread)
      try {
        const [tickCumulatives] = await pool.observe([10, 0]);
        const tickDiff = Number(tickCumulatives[1] - tickCumulatives[0]);
        const avgTick = tickDiff / 10;

        // Convert tick movement to basis points
        // Each tick = ~0.01% (1 bps) price change
        const spreadBps = Math.abs(avgTick);
        return spreadBps;
      } catch {
        // observe() may fail if pool is too new
        // Fall back to fee tier as minimum spread estimate
        const fee: number = Number(await pool.fee());
        return fee / 100; // Convert from hundredths of a bip to bps
      }
    } catch {
      return 0;
    }
  }

  /**
   * Get approximate ETH price in USD using WETH/USDC pool.
   */
  private async getEthPriceUsd(chainId: number, provider: JsonRpcProvider): Promise<number> {
    try {
      const tokens = SCAN_TOKENS[chainId];
      if (!tokens) return 3000; // fallback

      const weth = tokens.find((t) => t.symbol === 'WETH');
      const usdc = tokens.find((t) => t.symbol === 'USDC');
      if (!weth || !usdc) return 3000;

      const factoryAddress = FACTORY_ADDRESSES[chainId];
      if (!factoryAddress) return 3000;

      const factory = new Contract(factoryAddress, FACTORY_ABI, provider);
      const poolAddress: string = await factory.getPool(weth.address, usdc.address, 500);
      if (poolAddress === ethers.ZeroAddress) return 3000;

      const pool = new Contract(poolAddress, POOL_ABI, provider);
      const slot0 = await pool.slot0();
      const sqrtPriceX96: bigint = slot0[0];

      // price = (sqrtPriceX96 / 2^96)^2 * 10^(18-6) for WETH(18)/USDC(6)
      const Q96 = 2n ** 96n;
      const numerator = sqrtPriceX96 * sqrtPriceX96;
      const denominator = Q96 * Q96;
      const rawPrice = Number(numerator) / Number(denominator);

      // Adjust for decimals: WETH has 18, USDC has 6
      const price = rawPrice * 10 ** (18 - 6);

      // If token0 is USDC (lower address), price is inverted
      const token0 = await pool.token0() as string;
      if (token0.toLowerCase() === usdc.address.toLowerCase()) {
        return 1 / price;
      }
      return price;
    } catch {
      return 3000; // fallback estimate
    }
  }
}
