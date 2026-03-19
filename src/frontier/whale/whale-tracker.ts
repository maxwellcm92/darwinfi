/**
 * whale-tracker.ts - Whale wallet discovery, scoring, and activity monitoring
 *
 * For the Symbiont bot. Maintains a registry of high-performing whale wallets,
 * monitors their on-chain swap activity via Uniswap V3 Swap events, and
 * emits 'whale_buy' / 'whale_sell' events for copy-trading signals.
 */

import { EventEmitter } from 'events';
import { ethers, JsonRpcProvider, Contract } from 'ethers';

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export interface WhaleWallet {
  address: string;
  chainId: number;
  winRate: number;
  avgPnlPct: number;
  totalTrades: number;
  score: number;
  lastActivity: number;
  trackedSince: number;
}

export interface WhaleActivity {
  whaleAddress: string;
  chainId: number;
  chainName: string;
  action: 'buy' | 'sell';
  tokenAddress: string;
  amountUsd: number;
  txHash: string;
  timestamp: number;
}

// -------------------------------------------------------------------
// ABIs
// -------------------------------------------------------------------

const SWAP_EVENT_ABI = [
  'event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)',
];

const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

const POOL_ABI = [
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function fee() external view returns (uint24)',
];

const FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];

// -------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------

const CHAIN_NAMES: Record<number, string> = {
  8453: 'Base',
  42161: 'Arbitrum',
};

// Stablecoin addresses used to determine buy vs sell direction
const STABLECOINS: Record<number, Set<string>> = {
  8453: new Set([
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
    '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', // DAI
  ].map((a) => a.toLowerCase())),
  42161: new Set([
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
    '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT
    '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', // DAI
  ].map((a) => a.toLowerCase())),
};

// Well-known WETH addresses
const WETH_ADDRESSES: Record<number, string> = {
  8453: '0x4200000000000000000000000000000000000006',
  42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
};

// Top Uniswap V3 pool addresses to monitor for whale swaps
const MONITORED_POOLS: Record<number, string[]> = {
  8453: [
    '0xd0b53D9277642d899DF5C87A3966A349A798F224', // WETH/USDC 500
    '0x4C36388bE6F416A29C8d8Eee81C771cE6bE14B18', // WETH/USDC 3000
  ],
  42161: [
    '0xC6962004f452bE9203591991D15f6b388e09E8D0', // WETH/USDC 500
    '0xC31E54c7a869B9FcBEcc14363CF510d1c41fa443', // WETH/USDC 3000
  ],
};

// -------------------------------------------------------------------
// WhaleTracker
// -------------------------------------------------------------------

export class WhaleTracker extends EventEmitter {
  private registry: Map<string, WhaleWallet> = new Map();
  private providers: Map<number, JsonRpcProvider>;
  private minTradeUsd: number;
  private running = false;
  private poolContracts: Contract[] = [];
  private recentActivities: WhaleActivity[] = [];
  private maxRecentActivities = 1000;

  constructor(providers: Map<number, JsonRpcProvider>, minTradeUsd = 10_000) {
    super();
    this.providers = providers;
    this.minTradeUsd = minTradeUsd;
  }

  // ---------------------------------------------------------------
  // Registry management
  // ---------------------------------------------------------------

  /**
   * Seed the registry with known whale addresses.
   */
  seedRegistry(wallets: Array<{ address: string; chainId: number }>): void {
    for (const w of wallets) {
      const key = `${w.chainId}:${w.address.toLowerCase()}`;
      if (this.registry.has(key)) continue;

      this.registry.set(key, {
        address: w.address.toLowerCase(),
        chainId: w.chainId,
        winRate: 0.5,
        avgPnlPct: 0,
        totalTrades: 0,
        score: 50,
        lastActivity: 0,
        trackedSince: Date.now(),
      });
    }

    console.log(`[WhaleTracker] Registry seeded with ${wallets.length} wallet(s). Total: ${this.registry.size}`);
  }

  /**
   * Discover new whales by scanning recent large swap events.
   * Adds wallets that executed swaps above the minimum trade size.
   */
  async discoverWhalesFromSwapEvents(chainId: number): Promise<void> {
    const provider = this.providers.get(chainId);
    if (!provider) return;

    const pools = MONITORED_POOLS[chainId];
    if (!pools || pools.length === 0) return;

    const currentBlock = await provider.getBlockNumber();
    // Scan last ~1000 blocks (~30 min on Base/Arbitrum)
    const fromBlock = Math.max(0, currentBlock - 1000);

    for (const poolAddress of pools) {
      try {
        const pool = new Contract(poolAddress, [...SWAP_EVENT_ABI, ...POOL_ABI], provider);

        const events = await pool.queryFilter('Swap', fromBlock, currentBlock);

        for (const event of events) {
          if (!('args' in event)) continue;

          const args = event.args as unknown as {
            sender: string;
            recipient: string;
            amount0: bigint;
            amount1: bigint;
          };

          // Estimate USD value from amount (rough: assume amount1 is USDC-denominated)
          const absAmount0 = args.amount0 < 0n ? -args.amount0 : args.amount0;
          const absAmount1 = args.amount1 < 0n ? -args.amount1 : args.amount1;

          // Use amount1 as USD proxy (USDC has 6 decimals)
          const estimatedUsd = Number(absAmount1) / 1e6;

          if (estimatedUsd >= this.minTradeUsd) {
            const walletAddress = args.recipient.toLowerCase();
            const key = `${chainId}:${walletAddress}`;

            if (!this.registry.has(key)) {
              this.registry.set(key, {
                address: walletAddress,
                chainId,
                winRate: 0.5,
                avgPnlPct: 0,
                totalTrades: 1,
                score: 50,
                lastActivity: Date.now(),
                trackedSince: Date.now(),
              });
            }
          }
        }
      } catch (err) {
        console.error(`[WhaleTracker] Swap event scan error for pool ${poolAddress}:`, err);
      }
    }

    console.log(`[WhaleTracker] Discovery complete for chain ${chainId}. Registry size: ${this.registry.size}`);
  }

  // ---------------------------------------------------------------
  // Monitoring
  // ---------------------------------------------------------------

  /**
   * Start real-time monitoring of swap events on tracked pools.
   * Emits 'whale_buy' or 'whale_sell' when a registered whale transacts.
   */
  startMonitoring(): void {
    if (this.running) return;
    this.running = true;

    for (const [chainId, provider] of this.providers.entries()) {
      const pools = MONITORED_POOLS[chainId];
      if (!pools) continue;

      for (const poolAddress of pools) {
        const pool = new Contract(poolAddress, [...SWAP_EVENT_ABI, ...POOL_ABI], provider);

        pool.on('Swap', async (
          sender: string,
          recipient: string,
          amount0: bigint,
          amount1: bigint,
          _sqrtPriceX96: bigint,
          _liquidity: bigint,
          _tick: number,
          event: { transactionHash: string }
        ) => {
          try {
            await this.handleSwapEvent(chainId, poolAddress, {
              sender,
              recipient,
              amount0,
              amount1,
              txHash: event.transactionHash,
            });
          } catch (err) {
            console.error('[WhaleTracker] Swap handler error:', err);
          }
        });

        this.poolContracts.push(pool);
      }
    }

    console.log(
      `[WhaleTracker] Monitoring started. Pools: ${this.poolContracts.length}, ` +
      `registry: ${this.registry.size} wallets`
    );
  }

  stopMonitoring(): void {
    if (!this.running) return;
    this.running = false;

    for (const contract of this.poolContracts) {
      contract.removeAllListeners();
    }
    this.poolContracts = [];

    console.log('[WhaleTracker] Monitoring stopped.');
  }

  private async handleSwapEvent(
    chainId: number,
    poolAddress: string,
    swap: {
      sender: string;
      recipient: string;
      amount0: bigint;
      amount1: bigint;
      txHash: string;
    }
  ): Promise<void> {
    // Check if sender or recipient is a tracked whale
    const senderKey = `${chainId}:${swap.sender.toLowerCase()}`;
    const recipientKey = `${chainId}:${swap.recipient.toLowerCase()}`;

    const whale = this.registry.get(senderKey) ?? this.registry.get(recipientKey);
    if (!whale) return;

    const provider = this.providers.get(chainId);
    if (!provider) return;

    // Determine token addresses from pool
    const pool = new Contract(poolAddress, POOL_ABI, provider);
    let token0: string, token1: string;
    try {
      [token0, token1] = await Promise.all([
        pool.token0() as Promise<string>,
        pool.token1() as Promise<string>,
      ]);
    } catch {
      return;
    }

    // Estimate USD value
    const absAmount1 = swap.amount1 < 0n ? -swap.amount1 : swap.amount1;
    const estimatedUsd = Number(absAmount1) / 1e6; // Assume token1 is USDC-scale

    if (estimatedUsd < this.minTradeUsd) return;

    // Determine buy vs sell based on token flow direction
    // If whale receives a non-stable token, it's a buy
    const stables = STABLECOINS[chainId] ?? new Set();
    const weth = WETH_ADDRESSES[chainId]?.toLowerCase();

    // amount0 > 0 means token0 went INTO the pool (whale sold token0)
    // amount0 < 0 means token0 came OUT of the pool (whale bought token0)
    const token0IsStable = stables.has(token0.toLowerCase()) || token0.toLowerCase() === weth;
    const boughtToken = swap.amount0 < 0n ? token0 : token1;
    const isBuy = !stables.has(boughtToken.toLowerCase()) && boughtToken.toLowerCase() !== weth;

    const activity: WhaleActivity = {
      whaleAddress: whale.address,
      chainId,
      chainName: CHAIN_NAMES[chainId] ?? `Chain ${chainId}`,
      action: isBuy ? 'buy' : 'sell',
      tokenAddress: isBuy ? boughtToken : (swap.amount0 > 0n ? token0 : token1),
      amountUsd: estimatedUsd,
      txHash: swap.txHash,
      timestamp: Date.now(),
    };

    // Update whale stats
    whale.totalTrades++;
    whale.lastActivity = Date.now();
    whale.score = this.scoreWallet(whale.address);

    // Track recent activity
    this.recentActivities.push(activity);
    if (this.recentActivities.length > this.maxRecentActivities) {
      this.recentActivities = this.recentActivities.slice(-this.maxRecentActivities / 2);
    }

    // Emit event
    this.emit(isBuy ? 'whale_buy' : 'whale_sell', activity);
  }

  // ---------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------

  /**
   * Get recent whale buy activities for copy-trading signals.
   */
  getRecentWhaleBuys(maxAgeMs = 300_000): WhaleActivity[] {
    const cutoff = Date.now() - maxAgeMs;
    return this.recentActivities
      .filter((a) => a.action === 'buy' && a.timestamp >= cutoff)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Score a wallet's quality based on win rate, PnL, and trade count.
   * Score range: 0-100.
   */
  scoreWallet(address: string): number {
    // Find across all chains
    let wallet: WhaleWallet | undefined;
    for (const [key, w] of this.registry.entries()) {
      if (key.endsWith(`:${address.toLowerCase()}`)) {
        wallet = w;
        break;
      }
    }

    if (!wallet) return 0;

    // Score components (each 0-1, weighted to 100):
    // - Win rate: 40% weight
    // - Average PnL: 30% weight
    // - Trade count (experience): 20% weight
    // - Recency: 10% weight

    const winRateScore = Math.min(wallet.winRate, 1) * 40;

    // PnL: cap at +/- 100% for scoring, normalize to 0-1
    const pnlNormalized = Math.max(0, Math.min(1, (wallet.avgPnlPct + 100) / 200));
    const pnlScore = pnlNormalized * 30;

    // Trade count: log scale, cap at 100 trades for full marks
    const tradeScore = Math.min(1, Math.log10(wallet.totalTrades + 1) / 2) * 20;

    // Recency: full marks if active in last 24h, linear decay to 7 days
    const hoursSinceActive = (Date.now() - wallet.lastActivity) / (1000 * 60 * 60);
    const recencyScore = Math.max(0, 1 - hoursSinceActive / (24 * 7)) * 10;

    const totalScore = Math.round(winRateScore + pnlScore + tradeScore + recencyScore);
    return Math.max(0, Math.min(100, totalScore));
  }

  /**
   * Get top-scoring whale wallets.
   */
  getTopWhales(limit = 20): WhaleWallet[] {
    const whales = [...this.registry.values()];

    // Recompute scores
    for (const w of whales) {
      w.score = this.scoreWallet(w.address);
    }

    return whales
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  getRegistrySize(): number {
    return this.registry.size;
  }

  // ---------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------

  serialize(): WhaleWallet[] {
    return [...this.registry.values()];
  }

  deserialize(wallets: WhaleWallet[]): void {
    this.registry.clear();
    for (const w of wallets) {
      const key = `${w.chainId}:${w.address.toLowerCase()}`;
      this.registry.set(key, { ...w, address: w.address.toLowerCase() });
    }
    console.log(`[WhaleTracker] Deserialized ${wallets.length} whale wallet(s).`);
  }
}
