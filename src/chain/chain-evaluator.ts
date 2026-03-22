/**
 * DarwinFi Chain Expansion Evaluator
 *
 * Probes candidate EVM chains for trading viability:
 *   - RPC connectivity and latency
 *   - Gas costs
 *   - DEX availability (Uniswap V3 factory presence)
 *   - USDC liquidity
 *   - Block time and finality
 *
 * Returns ranked expansion candidates with confidence scores.
 */

import { ethers } from 'ethers';

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export interface CandidateChain {
  chainId: number;
  name: string;
  rpcUrls: string[];
  uniswapV3Factory?: string;   // Known factory address if available
  usdcAddress?: string;        // Known USDC address if available
}

export interface ChainEvaluation {
  chainId: number;
  name: string;
  score: number;               // 0-100 viability score
  rank: number;
  metrics: {
    rpcLatencyMs: number;      // Average RPC response time
    rpcReachable: boolean;
    gasPrice: string;          // In gwei
    gasCostScore: number;      // 0-100 (lower gas = higher score)
    hasUniswapV3: boolean;
    usdcLiquidity: string;     // Human-readable USDC amount
    liquidityScore: number;    // 0-100
    blockTimeMs: number;       // Average block time
    blockHeight: number;
  };
  recommendation: 'expand' | 'monitor' | 'skip';
  evaluatedAt: number;
}

export interface ChainExpansionReport {
  generatedAt: number;
  candidates: ChainEvaluation[];
  topCandidate: ChainEvaluation | null;
  activeChains: number;
}

// -------------------------------------------------------------------
// Known candidate chains
// -------------------------------------------------------------------

const CANDIDATE_CHAINS: CandidateChain[] = [
  {
    chainId: 10,
    name: 'Optimism',
    rpcUrls: ['https://mainnet.optimism.io', 'https://1rpc.io/op'],
    uniswapV3Factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    usdcAddress: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  },
  {
    chainId: 137,
    name: 'Polygon',
    rpcUrls: ['https://polygon-rpc.com', 'https://1rpc.io/matic'],
    uniswapV3Factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    usdcAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  },
  {
    chainId: 43114,
    name: 'Avalanche',
    rpcUrls: ['https://api.avax.network/ext/bc/C/rpc', 'https://1rpc.io/avax/c'],
    usdcAddress: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  },
  {
    chainId: 324,
    name: 'zkSync Era',
    rpcUrls: ['https://mainnet.era.zksync.io'],
    usdcAddress: '0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4',
  },
  {
    chainId: 59144,
    name: 'Linea',
    rpcUrls: ['https://rpc.linea.build'],
    usdcAddress: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff',
  },
];

// Minimal ERC-20 ABI for balance checks
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
];

// Uniswap V3 Factory ABI (just pool count check)
const FACTORY_ABI = [
  'function feeAmountTickSpacing(uint24) view returns (int24)',
];

// -------------------------------------------------------------------
// ChainEvaluator
// -------------------------------------------------------------------

export class ChainEvaluator {
  private timeout: number;

  constructor(timeoutMs: number = 10_000) {
    this.timeout = timeoutMs;
  }

  /**
   * Evaluate all candidate chains and return a ranked report.
   */
  async evaluateAll(excludeChainIds: number[] = []): Promise<ChainExpansionReport> {
    const candidates = CANDIDATE_CHAINS.filter(
      c => !excludeChainIds.includes(c.chainId),
    );

    const evaluations = await Promise.all(
      candidates.map(c => this.evaluateChain(c)),
    );

    // Sort by score (highest first)
    evaluations.sort((a, b) => b.score - a.score);
    evaluations.forEach((e, i) => { e.rank = i + 1; });

    return {
      generatedAt: Date.now(),
      candidates: evaluations,
      topCandidate: evaluations.length > 0 ? evaluations[0] : null,
      activeChains: excludeChainIds.length,
    };
  }

  /**
   * Evaluate a single candidate chain.
   */
  async evaluateChain(candidate: CandidateChain): Promise<ChainEvaluation> {
    const metrics = {
      rpcLatencyMs: Infinity,
      rpcReachable: false,
      gasPrice: '0',
      gasCostScore: 0,
      hasUniswapV3: false,
      usdcLiquidity: '0',
      liquidityScore: 0,
      blockTimeMs: 0,
      blockHeight: 0,
    };

    let provider: ethers.JsonRpcProvider | null = null;

    // Try each RPC URL until one works
    for (const rpcUrl of candidate.rpcUrls) {
      try {
        const testProvider = new ethers.JsonRpcProvider(rpcUrl, candidate.chainId, {
          staticNetwork: true,
        });

        const start = Date.now();
        const blockNumber = await Promise.race([
          testProvider.getBlockNumber(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), this.timeout)
          ),
        ]);

        metrics.rpcLatencyMs = Date.now() - start;
        metrics.rpcReachable = true;
        metrics.blockHeight = blockNumber;
        provider = testProvider;
        break;
      } catch {
        continue;
      }
    }

    if (!provider || !metrics.rpcReachable) {
      return this.buildEvaluation(candidate, metrics, 0, 'skip');
    }

    // Gas price check
    try {
      const feeData = await Promise.race([
        provider.getFeeData(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), this.timeout)
        ),
      ]);
      const gasGwei = Number(ethers.formatUnits(feeData.gasPrice ?? 0n, 'gwei'));
      metrics.gasPrice = gasGwei.toFixed(4);
      // Score: < 0.1 gwei = 100, < 1 gwei = 80, < 10 gwei = 60, < 50 gwei = 40, else 20
      if (gasGwei < 0.1) metrics.gasCostScore = 100;
      else if (gasGwei < 1) metrics.gasCostScore = 80;
      else if (gasGwei < 10) metrics.gasCostScore = 60;
      else if (gasGwei < 50) metrics.gasCostScore = 40;
      else metrics.gasCostScore = 20;
    } catch {
      metrics.gasCostScore = 0;
    }

    // Block time estimation (compare last 2 blocks)
    try {
      const [block1, block2] = await Promise.all([
        provider.getBlock(metrics.blockHeight),
        provider.getBlock(metrics.blockHeight - 1),
      ]);
      if (block1 && block2) {
        metrics.blockTimeMs = (block1.timestamp - block2.timestamp) * 1000;
      }
    } catch {
      // ignore
    }

    // Uniswap V3 factory check
    if (candidate.uniswapV3Factory) {
      try {
        const factory = new ethers.Contract(
          candidate.uniswapV3Factory, FACTORY_ABI, provider,
        );
        // Check if 3000 fee tier exists (standard Uni V3)
        const tickSpacing = await Promise.race([
          factory.feeAmountTickSpacing(3000),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), this.timeout)
          ),
        ]);
        metrics.hasUniswapV3 = tickSpacing !== 0;
      } catch {
        metrics.hasUniswapV3 = false;
      }
    }

    // USDC liquidity check
    if (candidate.usdcAddress) {
      try {
        const usdc = new ethers.Contract(candidate.usdcAddress, ERC20_ABI, provider);
        const [totalSupply, decimals] = await Promise.all([
          Promise.race([
            usdc.totalSupply(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('timeout')), this.timeout)
            ),
          ]),
          Promise.race([
            usdc.decimals(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('timeout')), this.timeout)
            ),
          ]),
        ]);
        const supplyFormatted = Number(ethers.formatUnits(totalSupply, decimals));
        metrics.usdcLiquidity = supplyFormatted > 1_000_000
          ? `${(supplyFormatted / 1_000_000).toFixed(1)}M`
          : `${supplyFormatted.toFixed(0)}`;

        // Score: > 100M = 100, > 10M = 80, > 1M = 60, > 100K = 40, else 20
        if (supplyFormatted > 100_000_000) metrics.liquidityScore = 100;
        else if (supplyFormatted > 10_000_000) metrics.liquidityScore = 80;
        else if (supplyFormatted > 1_000_000) metrics.liquidityScore = 60;
        else if (supplyFormatted > 100_000) metrics.liquidityScore = 40;
        else metrics.liquidityScore = 20;
      } catch {
        metrics.liquidityScore = 0;
      }
    }

    // Composite score: RPC 15%, gas 20%, DEX 25%, liquidity 30%, latency 10%
    const latencyScore = metrics.rpcLatencyMs < 200 ? 100 :
      metrics.rpcLatencyMs < 500 ? 80 :
      metrics.rpcLatencyMs < 1000 ? 60 :
      metrics.rpcLatencyMs < 3000 ? 40 : 20;

    const rpcScore = metrics.rpcReachable ? 100 : 0;
    const dexScore = metrics.hasUniswapV3 ? 100 : 20;

    const compositeScore = Math.round(
      rpcScore * 0.15 +
      metrics.gasCostScore * 0.20 +
      dexScore * 0.25 +
      metrics.liquidityScore * 0.30 +
      latencyScore * 0.10
    );

    const recommendation = compositeScore >= 70 ? 'expand' :
      compositeScore >= 40 ? 'monitor' : 'skip';

    return this.buildEvaluation(candidate, metrics, compositeScore, recommendation);
  }

  /**
   * Get the list of candidate chain IDs.
   */
  getCandidateChainIds(): number[] {
    return CANDIDATE_CHAINS.map(c => c.chainId);
  }

  private buildEvaluation(
    candidate: CandidateChain,
    metrics: ChainEvaluation['metrics'],
    score: number,
    recommendation: ChainEvaluation['recommendation'],
  ): ChainEvaluation {
    return {
      chainId: candidate.chainId,
      name: candidate.name,
      score,
      rank: 0,
      metrics,
      recommendation,
      evaluatedAt: Date.now(),
    };
  }
}
