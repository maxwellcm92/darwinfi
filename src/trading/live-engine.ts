/**
 * live-engine.ts - On-chain trade execution engine
 *
 * Executes real swaps via Uniswap V3 SwapRouter on Base using ethers.js v6.
 * Handles token approval, swap execution, result tracking, gas estimation,
 * and slippage protection. Supports 'sell_only' mode to prevent new buys.
 */

import { ethers } from 'ethers';
import { UniswapClient, SwapResult, BASE_TOKENS } from './uniswap-client';
import { PriceFeed, TOKEN_UNIVERSE, TokenDefinition } from './price-feed';
import { BaseClient, getBaseClient } from '../chain/base-client';
import { WalletManager } from '../chain/wallet-manager';
import { ContractClient } from '../chain/contract-client';

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export type LiveTradeAction = 'buy' | 'sell';

export interface LiveTradeRequest {
  strategyId: string;
  action: LiveTradeAction;
  /** Token symbol from the TOKEN_UNIVERSE */
  tokenSymbol: string;
  /** For buys: amount in USD. For sells: amount in tokens (or 'max' to sell entire position). */
  amount: number | 'max';
  /** Fee tier override (default: auto-detect from TOKEN_UNIVERSE) */
  feeTier?: number;
  /** Slippage tolerance (default: 0.005 = 0.5%) */
  slippageTolerance?: number;
  /** Deadline in seconds from now (default: 300) */
  deadlineSeconds?: number;
}

export interface LiveTradeResult {
  tradeId: string;
  strategyId: string;
  action: LiveTradeAction;
  tokenSymbol: string;
  tokenAddress: string;
  /** Input amount (human-readable, in input token units) */
  amountIn: string;
  /** Output amount (human-readable, in output token units) */
  amountOut: string;
  /** Execution price in USD per token */
  executionPriceUsd: number;
  /** Transaction hash */
  txHash: string;
  /** Gas used */
  gasUsed: string;
  /** Gas cost in ETH */
  gasCostEth: string;
  /** Slippage tolerance used */
  slippageTolerance: number;
  /** Block number where the tx was mined */
  blockNumber: number;
  timestamp: number;
  success: boolean;
  error?: string;
}

export interface LiveEngineConfig {
  /** Default slippage tolerance (default: 0.005 = 0.5%) */
  defaultSlippage?: number;
  /** Default deadline in seconds (default: 300 = 5 min) */
  defaultDeadlineSeconds?: number;
  /** Minimum ETH balance to keep for gas (default: 0.002) */
  minGasReserveEth?: number;
  /** Maximum single trade size in USD (safety limit, default: 1000) */
  maxTradeSizeUsd?: number;
  /** Enable sell_only mode (no new buys, only exits) */
  sellOnly?: boolean;
  /** Use VaultV2 for fund management (agent borrows before trade, returns after) */
  useVaultV2?: boolean;
}

interface StrategyState {
  sellOnly: boolean;
  totalBuys: number;
  totalSells: number;
  totalGasSpentEth: number;
}

// -------------------------------------------------------------------
// LiveEngine
// -------------------------------------------------------------------

export class LiveEngine {
  private baseClient: BaseClient;
  private uniswap: UniswapClient;
  private priceFeed: PriceFeed;
  private walletManager: WalletManager;

  private defaultSlippage: number;
  private defaultDeadlineSeconds: number;
  private minGasReserveEth: number;
  private maxTradeSizeUsd: number;
  private globalSellOnly: boolean;
  private useVaultV2: boolean;
  private contractClient: ContractClient | null = null;

  private strategyStates: Map<string, StrategyState> = new Map();
  private tradeLog: LiveTradeResult[] = [];
  private tradeCounter = 0;

  constructor(config?: LiveEngineConfig, deps?: {
    baseClient?: BaseClient;
    uniswap?: UniswapClient;
    priceFeed?: PriceFeed;
    walletManager?: WalletManager;
  }) {
    this.baseClient = deps?.baseClient ?? getBaseClient();
    this.uniswap = deps?.uniswap ?? new UniswapClient(this.baseClient);
    this.priceFeed = deps?.priceFeed ?? new PriceFeed(this.uniswap);
    this.walletManager = deps?.walletManager ?? new WalletManager(this.baseClient);

    this.defaultSlippage = config?.defaultSlippage ?? 0.005;
    this.defaultDeadlineSeconds = config?.defaultDeadlineSeconds ?? 300;
    this.minGasReserveEth = config?.minGasReserveEth ?? 0.002;
    this.maxTradeSizeUsd = config?.maxTradeSizeUsd ?? 1000;
    this.globalSellOnly = config?.sellOnly ?? false;
    this.useVaultV2 = config?.useVaultV2 ?? false;

    // Initialize VaultV2 integration if enabled
    if (this.useVaultV2) {
      try {
        this.contractClient = new ContractClient(this.baseClient);
        if (this.contractClient.hasVaultV2()) {
          console.log('[LiveEngine] VaultV2 integration enabled');
        } else {
          console.warn('[LiveEngine] VaultV2 enabled but address not set, falling back to direct trading');
          this.useVaultV2 = false;
        }
      } catch (err) {
        console.warn('[LiveEngine] VaultV2 init failed, falling back to direct trading:', err);
        this.useVaultV2 = false;
      }
    }
  }

  // ---------------------------------------------------------------
  // Mode control
  // ---------------------------------------------------------------

  /**
   * Set global sell_only mode. When enabled, no new buys are allowed.
   */
  setSellOnly(enabled: boolean): void {
    this.globalSellOnly = enabled;
    console.log(`[LiveEngine] Global sell_only mode: ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  /**
   * Set sell_only mode for a specific strategy.
   */
  setStrategySellOnly(strategyId: string, enabled: boolean): void {
    const state = this.getOrCreateStrategyState(strategyId);
    state.sellOnly = enabled;
    console.log(`[LiveEngine] Strategy ${strategyId} sell_only: ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  isSellOnly(strategyId?: string): boolean {
    if (this.globalSellOnly) return true;
    if (strategyId) {
      return this.strategyStates.get(strategyId)?.sellOnly ?? false;
    }
    return false;
  }

  // ---------------------------------------------------------------
  // Trade execution
  // ---------------------------------------------------------------

  /**
   * Execute a live trade on-chain via Uniswap V3.
   */
  async executeLiveTrade(request: LiveTradeRequest): Promise<LiveTradeResult> {
    const {
      strategyId,
      action,
      tokenSymbol,
      amount,
      feeTier,
      slippageTolerance = this.defaultSlippage,
      deadlineSeconds = this.defaultDeadlineSeconds,
    } = request;

    // Validate token
    const tokenDef = TOKEN_UNIVERSE[tokenSymbol];
    if (!tokenDef) {
      return this.failedResult(strategyId, action, tokenSymbol, `Unknown token: ${tokenSymbol}`);
    }

    // Check sell_only mode
    if (action === 'buy' && this.isSellOnly(strategyId)) {
      return this.failedResult(
        strategyId, action, tokenSymbol,
        `Sell-only mode is active. New buys are blocked for strategy '${strategyId}'.`
      );
    }

    try {
      // Pre-flight checks
      await this.preflightChecks(strategyId, action, tokenSymbol, amount, tokenDef);

      if (action === 'buy') {
        return await this.executeBuy(
          strategyId, tokenSymbol, tokenDef, amount as number,
          feeTier, slippageTolerance, deadlineSeconds
        );
      } else {
        return await this.executeSell(
          strategyId, tokenSymbol, tokenDef, amount,
          feeTier, slippageTolerance, deadlineSeconds
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[LiveEngine] Trade failed: ${msg}`);
      return this.failedResult(strategyId, action, tokenSymbol, msg);
    }
  }

  // ---------------------------------------------------------------
  // Buy execution (USD amount -> token)
  // ---------------------------------------------------------------

  private async executeBuy(
    strategyId: string,
    tokenSymbol: string,
    tokenDef: TokenDefinition,
    amountUsd: number,
    feeTier: number | undefined,
    slippageTolerance: number,
    deadlineSeconds: number
  ): Promise<LiveTradeResult> {
    // For a buy: we swap USDC -> target token
    // Determine input amount in USDC (6 decimals)
    const usdcAmount = ethers.parseUnits(amountUsd.toFixed(6), 6);
    const fee = feeTier ?? tokenDef.usdcFeeTier ?? 3000;

    // If the token does not have a direct USDC pool, route through WETH
    // For simplicity, try direct USDC swap first
    const tokenIn = BASE_TOKENS.USDC;
    const tokenOut = tokenDef.address;
    const amountIn = usdcAmount;

    // Check if we need to go through WETH (no direct USDC pool)
    const effectiveFee = fee;

    // If using VaultV2, borrow USDC from vault before swap
    if (this.useVaultV2 && this.contractClient) {
      console.log(`[LiveEngine] Borrowing $${amountUsd} USDC from VaultV2 for trade`);
      await this.contractClient.vaultV2BorrowFromVault(usdcAmount);
    }

    console.log(
      `[LiveEngine] BUY ${tokenSymbol}: swapping $${amountUsd} USDC -> ${tokenSymbol} ` +
      `(fee tier: ${effectiveFee}, slippage: ${(slippageTolerance * 100).toFixed(1)}%)`
    );

    const swapResult = await this.uniswap.swap({
      tokenIn,
      tokenOut,
      amountIn,
      fee: effectiveFee,
      slippageTolerance,
      deadlineSeconds,
    });

    // Calculate execution price
    const tokensReceived = Number(ethers.formatUnits(swapResult.amountOut, tokenDef.decimals));
    const executionPriceUsd = tokensReceived > 0 ? amountUsd / tokensReceived : 0;

    const result = this.buildResult(
      strategyId,
      'buy',
      tokenSymbol,
      tokenDef.address,
      ethers.formatUnits(usdcAmount, 6),
      ethers.formatUnits(swapResult.amountOut, tokenDef.decimals),
      executionPriceUsd,
      swapResult,
      slippageTolerance
    );

    // Update strategy state
    const state = this.getOrCreateStrategyState(strategyId);
    state.totalBuys++;
    state.totalGasSpentEth += parseFloat(result.gasCostEth);

    this.tradeLog.push(result);
    return result;
  }

  // ---------------------------------------------------------------
  // Sell execution (token amount -> USDC)
  // ---------------------------------------------------------------

  private async executeSell(
    strategyId: string,
    tokenSymbol: string,
    tokenDef: TokenDefinition,
    amount: number | 'max',
    feeTier: number | undefined,
    slippageTolerance: number,
    deadlineSeconds: number
  ): Promise<LiveTradeResult> {
    // For a sell: we swap target token -> USDC
    let tokenAmount: bigint;

    if (amount === 'max') {
      // Sell entire balance
      tokenAmount = await this.uniswap.getTokenBalance(tokenDef.address);
      if (tokenAmount === 0n) {
        return this.failedResult(
          strategyId, 'sell', tokenSymbol,
          `No ${tokenSymbol} balance to sell`
        );
      }
    } else {
      tokenAmount = ethers.parseUnits(amount.toFixed(tokenDef.decimals), tokenDef.decimals);
    }

    const fee = feeTier ?? tokenDef.usdcFeeTier ?? 3000;

    console.log(
      `[LiveEngine] SELL ${tokenSymbol}: swapping ${ethers.formatUnits(tokenAmount, tokenDef.decimals)} ` +
      `${tokenSymbol} -> USDC (fee tier: ${fee}, slippage: ${(slippageTolerance * 100).toFixed(1)}%)`
    );

    const swapResult = await this.uniswap.swap({
      tokenIn: tokenDef.address,
      tokenOut: BASE_TOKENS.USDC,
      amountIn: tokenAmount,
      fee,
      slippageTolerance,
      deadlineSeconds,
    });

    // Calculate execution price
    const tokensSold = Number(ethers.formatUnits(tokenAmount, tokenDef.decimals));
    const usdcReceived = Number(ethers.formatUnits(swapResult.amountOut, 6));
    const executionPriceUsd = tokensSold > 0 ? usdcReceived / tokensSold : 0;

    // If using VaultV2, return USDC proceeds to vault after sell
    if (this.useVaultV2 && this.contractClient && swapResult.amountOut > 0n) {
      console.log(`[LiveEngine] Returning $${usdcReceived.toFixed(2)} USDC to VaultV2`);
      await this.contractClient.vaultV2ReturnToVault(swapResult.amountOut);
    }

    const result = this.buildResult(
      strategyId,
      'sell',
      tokenSymbol,
      tokenDef.address,
      ethers.formatUnits(tokenAmount, tokenDef.decimals),
      ethers.formatUnits(swapResult.amountOut, 6),
      executionPriceUsd,
      swapResult,
      slippageTolerance
    );

    // Update strategy state
    const state = this.getOrCreateStrategyState(strategyId);
    state.totalSells++;
    state.totalGasSpentEth += parseFloat(result.gasCostEth);

    this.tradeLog.push(result);
    return result;
  }

  // ---------------------------------------------------------------
  // Pre-flight validation
  // ---------------------------------------------------------------

  private async preflightChecks(
    strategyId: string,
    action: LiveTradeAction,
    tokenSymbol: string,
    amount: number | 'max',
    tokenDef: TokenDefinition
  ): Promise<void> {
    // 1. Validate chain connection
    await this.baseClient.validateChain();

    // 2. Check gas funds
    const ethBalance = parseFloat(await this.baseClient.getEthBalance());
    if (ethBalance < this.minGasReserveEth) {
      throw new Error(
        `Insufficient ETH for gas: ${ethBalance.toFixed(6)} ETH. ` +
        `Minimum reserve: ${this.minGasReserveEth} ETH.`
      );
    }

    // 3. Check trade size limit for buys
    if (action === 'buy' && typeof amount === 'number') {
      if (amount > this.maxTradeSizeUsd) {
        throw new Error(
          `Trade size $${amount.toFixed(2)} exceeds maximum $${this.maxTradeSizeUsd.toFixed(2)}. ` +
          `Increase maxTradeSizeUsd in config if intentional.`
        );
      }

      // Check USDC balance
      const usdcBalance = await this.uniswap.getTokenBalance(BASE_TOKENS.USDC);
      const usdcFormatted = Number(ethers.formatUnits(usdcBalance, 6));
      if (usdcFormatted < amount) {
        throw new Error(
          `Insufficient USDC balance: have $${usdcFormatted.toFixed(2)}, need $${amount.toFixed(2)}`
        );
      }
    }

    // 4. Check token balance for sells
    if (action === 'sell' && amount !== 'max' && typeof amount === 'number') {
      const tokenBalance = await this.uniswap.getTokenBalance(tokenDef.address);
      const formatted = Number(ethers.formatUnits(tokenBalance, tokenDef.decimals));
      if (formatted < amount) {
        throw new Error(
          `Insufficient ${tokenSymbol} balance: have ${formatted.toFixed(6)}, ` +
          `trying to sell ${amount.toFixed(6)}`
        );
      }
    }
  }

  // ---------------------------------------------------------------
  // Gas estimation
  // ---------------------------------------------------------------

  /**
   * Estimate gas cost for a trade without executing it.
   */
  async estimateGasCost(
    tokenSymbol: string,
    action: LiveTradeAction,
    amount: number
  ): Promise<{ gasEstimate: bigint; costEth: string; costUsd: number }> {
    const tokenDef = TOKEN_UNIVERSE[tokenSymbol];
    if (!tokenDef) throw new Error(`Unknown token: ${tokenSymbol}`);

    let tokenIn: string;
    let tokenOut: string;
    let amountIn: bigint;

    if (action === 'buy') {
      tokenIn = BASE_TOKENS.USDC;
      tokenOut = tokenDef.address;
      amountIn = ethers.parseUnits(amount.toFixed(6), 6);
    } else {
      tokenIn = tokenDef.address;
      tokenOut = BASE_TOKENS.USDC;
      amountIn = ethers.parseUnits(amount.toFixed(tokenDef.decimals), tokenDef.decimals);
    }

    const fee = tokenDef.usdcFeeTier ?? 3000;
    const quote = await this.uniswap.getQuote(tokenIn, tokenOut, amountIn, fee);

    const ethPrice = await this.priceFeed.getPrice('ETH');
    // Use the gas estimate from the quoter (in gas units), multiply by typical base fee
    const feeData = await this.baseClient.provider.getFeeData();
    const gasPrice = feeData.gasPrice ?? ethers.parseUnits('0.1', 'gwei');
    const costWei = quote.gasEstimate * gasPrice;
    const costEth = ethers.formatEther(costWei);
    const costUsd = parseFloat(costEth) * ethPrice.priceUsd;

    return { gasEstimate: quote.gasEstimate, costEth, costUsd };
  }

  // ---------------------------------------------------------------
  // Trade log
  // ---------------------------------------------------------------

  getTradeLog(strategyId?: string, limit?: number): LiveTradeResult[] {
    let log = this.tradeLog;
    if (strategyId) {
      log = log.filter((t) => t.strategyId === strategyId);
    }
    if (limit) {
      log = log.slice(-limit);
    }
    return log;
  }

  getStrategyStats(strategyId: string): StrategyState | null {
    return this.strategyStates.get(strategyId) ?? null;
  }

  // ---------------------------------------------------------------
  // VaultV2 helpers
  // ---------------------------------------------------------------

  /**
   * Get max trade size based on vault TVL (5% of TVL per trade).
   * Falls back to the configured maxTradeSizeUsd if VaultV2 is not active.
   */
  async getVaultScaledMaxTradeSize(): Promise<number> {
    if (!this.useVaultV2 || !this.contractClient) {
      return this.maxTradeSizeUsd;
    }
    try {
      const totalAssets = await this.contractClient.vaultV2TotalAssets();
      const tvlUsd = Number(ethers.formatUnits(totalAssets, 6));
      const vaultMaxTrade = tvlUsd * 0.05; // 5% of TVL
      return Math.min(vaultMaxTrade, this.maxTradeSizeUsd);
    } catch {
      return this.maxTradeSizeUsd;
    }
  }

  isVaultV2Active(): boolean {
    return this.useVaultV2 && !!this.contractClient;
  }

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------

  private getOrCreateStrategyState(strategyId: string): StrategyState {
    let state = this.strategyStates.get(strategyId);
    if (!state) {
      state = { sellOnly: false, totalBuys: 0, totalSells: 0, totalGasSpentEth: 0 };
      this.strategyStates.set(strategyId, state);
    }
    return state;
  }

  private buildResult(
    strategyId: string,
    action: LiveTradeAction,
    tokenSymbol: string,
    tokenAddress: string,
    amountIn: string,
    amountOut: string,
    executionPriceUsd: number,
    swapResult: SwapResult,
    slippageTolerance: number
  ): LiveTradeResult {
    this.tradeCounter++;
    const gasCostWei = swapResult.gasUsed * swapResult.effectiveGasPrice;

    return {
      tradeId: `live-${this.tradeCounter}-${Date.now()}`,
      strategyId,
      action,
      tokenSymbol,
      tokenAddress,
      amountIn,
      amountOut,
      executionPriceUsd,
      txHash: swapResult.txHash,
      gasUsed: swapResult.gasUsed.toString(),
      gasCostEth: ethers.formatEther(gasCostWei),
      slippageTolerance,
      blockNumber: 0, // Filled by receipt in production
      timestamp: Date.now(),
      success: true,
    };
  }

  private failedResult(
    strategyId: string,
    action: LiveTradeAction,
    tokenSymbol: string,
    error: string
  ): LiveTradeResult {
    this.tradeCounter++;
    return {
      tradeId: `live-${this.tradeCounter}-${Date.now()}`,
      strategyId,
      action,
      tokenSymbol,
      tokenAddress: TOKEN_UNIVERSE[tokenSymbol]?.address ?? '0x0',
      amountIn: '0',
      amountOut: '0',
      executionPriceUsd: 0,
      txHash: '',
      gasUsed: '0',
      gasCostEth: '0',
      slippageTolerance: 0,
      blockNumber: 0,
      timestamp: Date.now(),
      success: false,
      error,
    };
  }
}
