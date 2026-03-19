/**
 * cross-chain-engine.ts - Cross-chain trade execution engine (Team 4 Frontier)
 *
 * Replaces live-engine.ts for cross-chain operations. Routes through 1inch
 * aggregator by default, with Uniswap V3 direct swap as fallback.
 * Extends LiveTradeRequest/Result with chain routing fields.
 */

import { ethers } from 'ethers';
import { ChainRegistry } from '../chain/chain-registry';
import { OneInchClient, OneInchSwapResult } from './oneinch-client';
import { UniswapClient, BASE_TOKENS } from './uniswap-client';
import { TOKEN_UNIVERSE, TokenDefinition } from './price-feed';
import { LiveTradeAction, LiveTradeRequest, LiveTradeResult } from './live-engine';

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export interface CrossChainTradeRequest extends LiveTradeRequest {
  /** Target chain for execution (defaults to Base 8453) */
  chainId?: number;
}

export interface CrossChainTradeResult extends LiveTradeResult {
  chainId: number;
  chainName: string;
  routingSource: '1inch' | 'uniswap_direct';
}

export interface CrossChainEngineConfig {
  /** Default slippage tolerance (default: 0.005 = 0.5%) */
  defaultSlippage?: number;
  /** Default deadline in seconds (default: 300 = 5 min) */
  defaultDeadlineSeconds?: number;
  /** Minimum ETH balance to keep for gas (default: 0.002) */
  minGasReserveEth?: number;
  /** Maximum single trade size in USD (safety limit, default: 1000) */
  maxTradeSizeUsd?: number;
}

// -------------------------------------------------------------------
// CrossChainEngine
// -------------------------------------------------------------------

export class CrossChainEngine {
  private registry: ChainRegistry;
  private oneInch: OneInchClient;
  private defaultSlippage: number;
  private defaultDeadlineSeconds: number;
  private minGasReserveEth: number;
  private maxTradeSizeUsd: number;

  private tradeLog: CrossChainTradeResult[] = [];
  private tradeCounter = 0;

  constructor(
    registry: ChainRegistry,
    oneInch: OneInchClient,
    config?: CrossChainEngineConfig
  ) {
    this.registry = registry;
    this.oneInch = oneInch;
    this.defaultSlippage = config?.defaultSlippage ?? 0.005;
    this.defaultDeadlineSeconds = config?.defaultDeadlineSeconds ?? 300;
    this.minGasReserveEth = config?.minGasReserveEth ?? 0.002;
    this.maxTradeSizeUsd = config?.maxTradeSizeUsd ?? 1000;

    console.log('[CrossChainEngine] Initialized');
  }

  // ---------------------------------------------------------------
  // Pre-flight checks
  // ---------------------------------------------------------------

  /**
   * Validate a trade request before execution. Checks chain health,
   * gas reserves, trade size, and token validity.
   */
  async preflightChecks(request: CrossChainTradeRequest): Promise<void> {
    const chainId = request.chainId ?? 8453;
    const client = this.registry.getClient(chainId);

    // 1. Validate chain connection
    await client.validateChain();

    // 2. Check gas funds
    const ethBalance = parseFloat(await client.getEthBalance());
    if (ethBalance < this.minGasReserveEth) {
      throw new Error(
        `Insufficient ETH for gas on ${client.chainName}: ${ethBalance.toFixed(6)} ETH. ` +
        `Minimum reserve: ${this.minGasReserveEth} ETH.`
      );
    }

    // 3. Validate token
    const tokenDef = TOKEN_UNIVERSE[request.tokenSymbol];
    if (!tokenDef) {
      throw new Error(`Unknown token: ${request.tokenSymbol}`);
    }

    // 4. Check trade size limit for buys
    if (request.action === 'buy' && typeof request.amount === 'number') {
      if (request.amount > this.maxTradeSizeUsd) {
        throw new Error(
          `Trade size $${request.amount.toFixed(2)} exceeds maximum $${this.maxTradeSizeUsd.toFixed(2)}. ` +
          `Increase maxTradeSizeUsd in config if intentional.`
        );
      }
    }
  }

  // ---------------------------------------------------------------
  // Trade execution
  // ---------------------------------------------------------------

  /**
   * Execute a cross-chain trade. Routes through 1inch first,
   * falls back to Uniswap V3 direct swap on the target chain.
   */
  async executeTrade(request: CrossChainTradeRequest): Promise<CrossChainTradeResult> {
    const chainId = request.chainId ?? 8453;
    const client = this.registry.getClient(chainId);

    const tokenDef = TOKEN_UNIVERSE[request.tokenSymbol];
    if (!tokenDef) {
      return this.failedResult(request, chainId, client.chainName, `Unknown token: ${request.tokenSymbol}`);
    }

    try {
      await this.preflightChecks(request);

      // Determine swap amounts
      const slippage = request.slippageTolerance ?? this.defaultSlippage;

      // Try 1inch first
      if (this.oneInch.isAvailable()) {
        console.log(`[CrossChainEngine] Routing via 1inch on ${client.chainName}`);
        const result = await this.executeVia1inch(request, chainId, client.chainName, tokenDef, slippage);
        if (result.success) {
          this.tradeLog.push(result);
          return result;
        }
        console.warn(`[CrossChainEngine] 1inch failed, falling back to Uniswap V3 direct`);
      }

      // Fallback: Uniswap V3 direct (only works on Base)
      if (chainId === 8453) {
        console.log(`[CrossChainEngine] Routing via Uniswap V3 direct on Base`);
        const result = await this.executeViaUniswap(request, chainId, client.chainName, tokenDef, slippage);
        this.tradeLog.push(result);
        return result;
      }

      return this.failedResult(
        request, chainId, client.chainName,
        `No available DEX router for chain ${client.chainName}. 1inch API key may be missing.`
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[CrossChainEngine] Trade failed: ${msg}`);
      return this.failedResult(request, chainId, client.chainName, msg);
    }
  }

  // ---------------------------------------------------------------
  // 1inch execution path
  // ---------------------------------------------------------------

  private async executeVia1inch(
    request: CrossChainTradeRequest,
    chainId: number,
    chainName: string,
    tokenDef: TokenDefinition,
    slippage: number
  ): Promise<CrossChainTradeResult> {
    const client = this.registry.getClient(chainId);
    let src: string;
    let dst: string;
    let amount: string;

    if (request.action === 'buy') {
      // Buy: USDC -> token
      src = BASE_TOKENS.USDC;
      dst = tokenDef.address;
      const usdcAmount = typeof request.amount === 'number' ? request.amount : 0;
      amount = ethers.parseUnits(usdcAmount.toFixed(6), 6).toString();
    } else {
      // Sell: token -> USDC
      src = tokenDef.address;
      dst = BASE_TOKENS.USDC;
      if (request.amount === 'max') {
        // Needs token balance lookup -- use the UniswapClient helper on Base
        // For cross-chain, do a direct balanceOf call
        const ERC20 = new ethers.Contract(
          tokenDef.address,
          ['function balanceOf(address) view returns (uint256)'],
          client.provider
        );
        const balance: bigint = await ERC20.balanceOf(client.walletAddress);
        if (balance === 0n) {
          return this.failedResult(request, chainId, chainName, `No ${request.tokenSymbol} balance to sell`);
        }
        amount = balance.toString();
      } else {
        amount = ethers.parseUnits(
          (request.amount as number).toFixed(tokenDef.decimals),
          tokenDef.decimals
        ).toString();
      }
    }

    // Approve token for 1inch router
    if (request.action === 'sell' || src !== BASE_TOKENS.USDC) {
      await this.oneInch.approveToken(src, chainId);
    }

    const swapResult: OneInchSwapResult = await this.oneInch.executeSwap({
      chainId,
      src,
      dst,
      amount,
      from: client.walletAddress,
      slippage: slippage * 100, // 1inch expects percent (0.5 not 0.005)
    });

    if (!swapResult.success) {
      return this.failedResult(request, chainId, chainName, swapResult.error ?? '1inch swap failed');
    }

    // Calculate execution price
    let executionPriceUsd = 0;
    if (request.action === 'buy') {
      const tokensReceived = Number(ethers.formatUnits(BigInt(swapResult.dstAmount), tokenDef.decimals));
      const usdSpent = typeof request.amount === 'number' ? request.amount : 0;
      executionPriceUsd = tokensReceived > 0 ? usdSpent / tokensReceived : 0;
    } else {
      const tokensSold = Number(ethers.formatUnits(BigInt(amount), tokenDef.decimals));
      const usdReceived = Number(ethers.formatUnits(BigInt(swapResult.dstAmount), 6));
      executionPriceUsd = tokensSold > 0 ? usdReceived / tokensSold : 0;
    }

    return this.buildResult(
      request,
      chainId,
      chainName,
      tokenDef.address,
      swapResult.srcAmount,
      swapResult.dstAmount,
      executionPriceUsd,
      swapResult.txHash,
      swapResult.gasUsed,
      swapResult.gasCostEth,
      slippage,
      '1inch'
    );
  }

  // ---------------------------------------------------------------
  // Uniswap V3 direct fallback (Base only)
  // ---------------------------------------------------------------

  private async executeViaUniswap(
    request: CrossChainTradeRequest,
    chainId: number,
    chainName: string,
    tokenDef: TokenDefinition,
    slippage: number
  ): Promise<CrossChainTradeResult> {
    // Import BaseClient for Uniswap (it's Base-specific)
    const { getBaseClient } = await import('../chain/base-client');
    const baseClient = getBaseClient();
    const uniswap = new UniswapClient(baseClient);

    const fee = tokenDef.usdcFeeTier ?? 3000;
    const deadlineSeconds = request.deadlineSeconds ?? this.defaultDeadlineSeconds;

    if (request.action === 'buy') {
      const usdcAmount = typeof request.amount === 'number' ? request.amount : 0;
      const amountIn = ethers.parseUnits(usdcAmount.toFixed(6), 6);

      const swapResult = await uniswap.swap({
        tokenIn: BASE_TOKENS.USDC,
        tokenOut: tokenDef.address,
        amountIn,
        fee,
        slippageTolerance: slippage,
        deadlineSeconds,
      });

      const tokensReceived = Number(ethers.formatUnits(swapResult.amountOut, tokenDef.decimals));
      const executionPriceUsd = tokensReceived > 0 ? usdcAmount / tokensReceived : 0;
      const gasCostWei = swapResult.gasUsed * swapResult.effectiveGasPrice;

      return this.buildResult(
        request,
        chainId,
        chainName,
        tokenDef.address,
        ethers.formatUnits(amountIn, 6),
        ethers.formatUnits(swapResult.amountOut, tokenDef.decimals),
        executionPriceUsd,
        swapResult.txHash,
        swapResult.gasUsed.toString(),
        ethers.formatEther(gasCostWei),
        slippage,
        'uniswap_direct'
      );
    } else {
      // Sell
      let tokenAmount: bigint;
      if (request.amount === 'max') {
        tokenAmount = await uniswap.getTokenBalance(tokenDef.address);
        if (tokenAmount === 0n) {
          return this.failedResult(request, chainId, chainName, `No ${request.tokenSymbol} balance to sell`);
        }
      } else {
        tokenAmount = ethers.parseUnits(
          (request.amount as number).toFixed(tokenDef.decimals),
          tokenDef.decimals
        );
      }

      const swapResult = await uniswap.swap({
        tokenIn: tokenDef.address,
        tokenOut: BASE_TOKENS.USDC,
        amountIn: tokenAmount,
        fee,
        slippageTolerance: slippage,
        deadlineSeconds,
      });

      const tokensSold = Number(ethers.formatUnits(tokenAmount, tokenDef.decimals));
      const usdcReceived = Number(ethers.formatUnits(swapResult.amountOut, 6));
      const executionPriceUsd = tokensSold > 0 ? usdcReceived / tokensSold : 0;
      const gasCostWei = swapResult.gasUsed * swapResult.effectiveGasPrice;

      return this.buildResult(
        request,
        chainId,
        chainName,
        tokenDef.address,
        ethers.formatUnits(tokenAmount, tokenDef.decimals),
        ethers.formatUnits(swapResult.amountOut, 6),
        executionPriceUsd,
        swapResult.txHash,
        swapResult.gasUsed.toString(),
        ethers.formatEther(gasCostWei),
        slippage,
        'uniswap_direct'
      );
    }
  }

  // ---------------------------------------------------------------
  // Chain selection
  // ---------------------------------------------------------------

  /**
   * Find the optimal chain for trading a given token.
   * Checks gas costs and liquidity across registered chains.
   */
  async findOptimalChain(tokenAddress?: string): Promise<{ chainId: number; chainName: string; reason: string }> {
    try {
      // Prefer cheapest gas for now; liquidity check is secondary
      const cheapest = await this.registry.getCheapestGasChain();
      return {
        chainId: cheapest.chainId,
        chainName: cheapest.chainName,
        reason: 'lowest gas cost',
      };
    } catch {
      // Default to Base
      return { chainId: 8453, chainName: 'Base', reason: 'default fallback' };
    }
  }

  // ---------------------------------------------------------------
  // Trade log
  // ---------------------------------------------------------------

  getTradeLog(limit?: number): CrossChainTradeResult[] {
    if (limit) {
      return this.tradeLog.slice(-limit);
    }
    return [...this.tradeLog];
  }

  // ---------------------------------------------------------------
  // Result builders
  // ---------------------------------------------------------------

  private buildResult(
    request: CrossChainTradeRequest,
    chainId: number,
    chainName: string,
    tokenAddress: string,
    amountIn: string,
    amountOut: string,
    executionPriceUsd: number,
    txHash: string,
    gasUsed: string,
    gasCostEth: string,
    slippageTolerance: number,
    routingSource: '1inch' | 'uniswap_direct'
  ): CrossChainTradeResult {
    this.tradeCounter++;
    return {
      tradeId: `xchain-${this.tradeCounter}-${Date.now()}`,
      strategyId: request.strategyId,
      action: request.action,
      tokenSymbol: request.tokenSymbol,
      tokenAddress,
      amountIn,
      amountOut,
      executionPriceUsd,
      txHash,
      gasUsed,
      gasCostEth,
      slippageTolerance,
      blockNumber: 0,
      timestamp: Date.now(),
      success: true,
      chainId,
      chainName,
      routingSource,
    };
  }

  private failedResult(
    request: CrossChainTradeRequest,
    chainId: number,
    chainName: string,
    error: string
  ): CrossChainTradeResult {
    this.tradeCounter++;
    return {
      tradeId: `xchain-${this.tradeCounter}-${Date.now()}`,
      strategyId: request.strategyId,
      action: request.action,
      tokenSymbol: request.tokenSymbol,
      tokenAddress: TOKEN_UNIVERSE[request.tokenSymbol]?.address ?? '0x0',
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
      chainId,
      chainName,
      routingSource: '1inch',
    };
  }
}
