/**
 * uniswap-client.ts - Direct Uniswap V3 interaction via ethers.js + ABI
 *
 * No Uniswap SDK dependency. Uses raw contract ABIs for:
 *   - SwapRouter: exactInputSingle swaps
 *   - Quoter V2: price quotes
 *   - ERC-20: token approval
 *   - Pool: slot0 reads for current price
 */

import { ethers, Contract, Wallet } from 'ethers';
import { BaseClient, getBaseClient } from '../chain/base-client';

// -------------------------------------------------------------------
// Base mainnet addresses
// -------------------------------------------------------------------

export const UNISWAP_ADDRESSES = {
  SWAP_ROUTER: '0x2626664c2603336E57B271c5C0b26F421741e481',
  QUOTER_V2: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
  FACTORY: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
} as const;

export const BASE_TOKENS = {
  WETH: '0x4200000000000000000000000000000000000006',
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  UNI: '0xc3De830EA07524a0761646a6a4e4be0e114a3C83',
  wstETH: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452',
  ENS: '0x2a2764E1472e0a09D70e10B1bfA4AFBE144F72a3',
  AERO: '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
} as const;

// -------------------------------------------------------------------
// ABIs (minimal, function-level)
// -------------------------------------------------------------------

const SWAP_ROUTER_ABI = [
  `function exactInputSingle(
    tuple(
      address tokenIn,
      address tokenOut,
      uint24 fee,
      address recipient,
      uint256 amountIn,
      uint256 amountOutMinimum,
      uint160 sqrtPriceLimitX96
    ) params
  ) external payable returns (uint256 amountOut)`,
  `function multicall(uint256 deadline, bytes[] data) external payable returns (bytes[] results)`,
];

const QUOTER_V2_ABI = [
  `function quoteExactInputSingle(
    tuple(
      address tokenIn,
      address tokenOut,
      uint256 amountIn,
      uint24 fee,
      uint160 sqrtPriceLimitX96
    ) params
  ) external returns (
    uint256 amountOut,
    uint160 sqrtPriceX96After,
    uint32 initializedTicksCrossed,
    uint256 gasEstimate
  )`,
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

const POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function token0() external view returns (address)',
  'function token1() external view returns (address)',
  'function fee() external view returns (uint24)',
  'function liquidity() external view returns (uint128)',
];

const FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)',
];

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export interface SwapParams {
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  /** Fee tier: 100 (0.01%), 500 (0.05%), 3000 (0.3%), 10000 (1%) */
  fee?: number;
  /** Slippage tolerance as a fraction, e.g. 0.005 for 0.5% */
  slippageTolerance?: number;
  /** Recipient address (defaults to signer) */
  recipient?: string;
  /** Deadline in seconds from now (default: 300 = 5 min) */
  deadlineSeconds?: number;
}

export interface SwapResult {
  txHash: string;
  amountIn: bigint;
  amountOut: bigint;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
}

export interface QuoteResult {
  amountOut: bigint;
  sqrtPriceX96After: bigint;
  gasEstimate: bigint;
}

export interface PoolInfo {
  address: string;
  token0: string;
  token1: string;
  fee: number;
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
}

// -------------------------------------------------------------------
// UniswapClient
// -------------------------------------------------------------------

export class UniswapClient {
  private baseClient: BaseClient;
  private router: Contract;
  private quoter: Contract;
  private factory: Contract;

  constructor(baseClient?: BaseClient) {
    this.baseClient = baseClient ?? getBaseClient();

    const routerAddress = process.env.UNISWAP_V3_ROUTER ?? UNISWAP_ADDRESSES.SWAP_ROUTER;
    const quoterAddress = process.env.UNISWAP_V3_QUOTER ?? UNISWAP_ADDRESSES.QUOTER_V2;

    this.router = new Contract(routerAddress, SWAP_ROUTER_ABI, this.baseClient.signer);
    this.quoter = new Contract(quoterAddress, QUOTER_V2_ABI, this.baseClient.provider);
    this.factory = new Contract(
      UNISWAP_ADDRESSES.FACTORY,
      FACTORY_ABI,
      this.baseClient.provider
    );
  }

  // ---------------------------------------------------------------
  // Price quotes
  // ---------------------------------------------------------------

  /**
   * Get a quote for an exact input swap (does not execute a transaction).
   * Uses Quoter V2 staticCall to simulate the swap.
   */
  async getQuote(
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    fee: number = 3000
  ): Promise<QuoteResult> {
    const params = {
      tokenIn,
      tokenOut,
      amountIn,
      fee,
      sqrtPriceLimitX96: 0n,
    };

    // Quoter V2 is a non-view function that reverts with the result.
    // We use staticCall to get the return value without sending a tx.
    const result = await this.quoter.quoteExactInputSingle.staticCall(params);

    return {
      amountOut: result[0],
      sqrtPriceX96After: result[1],
      gasEstimate: result[3],
    };
  }

  // ---------------------------------------------------------------
  // Token approval
  // ---------------------------------------------------------------

  /**
   * Approve the SwapRouter to spend tokens on behalf of the signer.
   * Uses max approval (type(uint256).max) for convenience. In production
   * you may want exact approval amounts.
   */
  async approveToken(
    tokenAddress: string,
    amount?: bigint,
    signer?: Wallet
  ): Promise<string | null> {
    const effectiveSigner = signer ?? this.baseClient.signer;
    const token = new Contract(tokenAddress, ERC20_ABI, effectiveSigner);
    const routerAddress = process.env.UNISWAP_V3_ROUTER ?? UNISWAP_ADDRESSES.SWAP_ROUTER;

    // Check existing allowance
    const currentAllowance: bigint = await token.allowance(
      effectiveSigner.address,
      routerAddress
    );

    const approvalAmount = amount ?? ethers.MaxUint256;

    if (currentAllowance >= approvalAmount) {
      return null; // Already approved
    }

    const tx = await token.approve(routerAddress, approvalAmount);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  // ---------------------------------------------------------------
  // Swap execution
  // ---------------------------------------------------------------

  /**
   * Execute an exactInputSingle swap on Uniswap V3.
   */
  async swap(params: SwapParams, signer?: Wallet): Promise<SwapResult> {
    const {
      tokenIn,
      tokenOut,
      amountIn,
      fee = 3000,
      slippageTolerance = 0.005,
      recipient,
      deadlineSeconds = 300,
    } = params;

    const effectiveSigner = signer ?? this.baseClient.signer;
    const routerWithSigner = this.router.connect(effectiveSigner) as Contract;

    // 1. Get quote to calculate minimum output
    const quote = await this.getQuote(tokenIn, tokenOut, amountIn, fee);
    const slippageBps = BigInt(Math.floor(slippageTolerance * 10000));
    const amountOutMinimum = quote.amountOut - (quote.amountOut * slippageBps) / 10000n;

    // 2. Ensure token approval
    const isNativeEth = tokenIn.toLowerCase() === BASE_TOKENS.WETH.toLowerCase();
    if (!isNativeEth) {
      await this.approveToken(tokenIn, amountIn, effectiveSigner);
    }

    // 3. Build swap params
    const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds);
    const swapParams = {
      tokenIn,
      tokenOut,
      fee,
      recipient: recipient ?? effectiveSigner.address,
      amountIn,
      amountOutMinimum,
      sqrtPriceLimitX96: 0n,
    };

    // 4. Encode the swap call for multicall (includes deadline)
    const swapCalldata = routerWithSigner.interface.encodeFunctionData(
      'exactInputSingle',
      [swapParams]
    );

    // 5. Execute via multicall for deadline enforcement
    const tx = await routerWithSigner.multicall(
      deadline,
      [swapCalldata],
      {
        value: isNativeEth ? amountIn : 0n,
      }
    );

    const receipt = await tx.wait();

    // 6. Parse amountOut from return data
    // multicall returns bytes[], decode the inner result
    let amountOut = amountOutMinimum; // fallback
    try {
      const multicallResult = routerWithSigner.interface.decodeFunctionResult(
        'multicall',
        receipt.logs[receipt.logs.length - 1]?.data ?? '0x'
      );
      if (multicallResult?.results?.[0]) {
        const innerResult = ethers.AbiCoder.defaultAbiCoder().decode(
          ['uint256'],
          multicallResult.results[0]
        );
        amountOut = innerResult[0];
      }
    } catch {
      // If decoding fails, use the quote minus slippage as estimate
    }

    return {
      txHash: receipt.hash,
      amountIn,
      amountOut,
      gasUsed: receipt.gasUsed,
      effectiveGasPrice: receipt.gasPrice ?? 0n,
    };
  }

  // ---------------------------------------------------------------
  // Pool reads
  // ---------------------------------------------------------------

  /**
   * Get pool address for a token pair and fee tier.
   */
  async getPoolAddress(
    tokenA: string,
    tokenB: string,
    fee: number = 3000
  ): Promise<string> {
    const poolAddress: string = await this.factory.getPool(tokenA, tokenB, fee);
    if (poolAddress === ethers.ZeroAddress) {
      throw new Error(
        `No Uniswap V3 pool found for ${tokenA}/${tokenB} at fee tier ${fee}`
      );
    }
    return poolAddress;
  }

  /**
   * Read pool state (price, tick, liquidity).
   */
  async getPoolInfo(
    tokenA: string,
    tokenB: string,
    fee: number = 3000
  ): Promise<PoolInfo> {
    const poolAddress = await this.getPoolAddress(tokenA, tokenB, fee);
    const pool = new Contract(poolAddress, POOL_ABI, this.baseClient.provider);

    const [slot0, token0, token1, poolFee, liquidity] = await Promise.all([
      pool.slot0(),
      pool.token0() as Promise<string>,
      pool.token1() as Promise<string>,
      pool.fee() as Promise<number>,
      pool.liquidity() as Promise<bigint>,
    ]);

    return {
      address: poolAddress,
      token0,
      token1,
      fee: Number(poolFee),
      sqrtPriceX96: slot0[0],
      tick: Number(slot0[1]),
      liquidity,
    };
  }

  /**
   * Calculate human-readable price from sqrtPriceX96.
   * Returns price of token0 in terms of token1.
   */
  sqrtPriceX96ToPrice(
    sqrtPriceX96: bigint,
    decimals0: number,
    decimals1: number
  ): number {
    // price = (sqrtPriceX96 / 2^96)^2 * 10^(decimals0 - decimals1)
    const Q96 = 2n ** 96n;
    const numerator = sqrtPriceX96 * sqrtPriceX96;
    const denominator = Q96 * Q96;
    const decimalAdjustment = 10 ** (decimals0 - decimals1);

    // Use floating point for the final calculation to avoid overflow
    const rawPrice = Number(numerator) / Number(denominator);
    return rawPrice * decimalAdjustment;
  }

  // ---------------------------------------------------------------
  // Token helpers
  // ---------------------------------------------------------------

  /**
   * Get token info (symbol, decimals).
   */
  async getTokenInfo(
    tokenAddress: string
  ): Promise<{ symbol: string; decimals: number }> {
    const token = new Contract(tokenAddress, ERC20_ABI, this.baseClient.provider);
    const [symbol, decimals] = await Promise.all([
      token.symbol() as Promise<string>,
      token.decimals() as Promise<number>,
    ]);
    return { symbol, decimals: Number(decimals) };
  }

  /**
   * Get token balance for an address.
   */
  async getTokenBalance(
    tokenAddress: string,
    walletAddress?: string
  ): Promise<bigint> {
    const token = new Contract(tokenAddress, ERC20_ABI, this.baseClient.provider);
    const addr = walletAddress ?? this.baseClient.signer.address;
    return token.balanceOf(addr);
  }
}
