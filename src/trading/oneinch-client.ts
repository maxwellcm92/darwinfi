/**
 * oneinch-client.ts - 1inch Aggregation Protocol v6 API client
 *
 * Uses fetch to call the 1inch swap API. Provides quote, swap building,
 * and execution. Falls back to Uniswap V3 direct swap if 1inch is unavailable.
 */

import { ethers, Contract } from 'ethers';
import { EVMClient } from '../chain/evm-client';
import { ChainRegistry } from '../chain/chain-registry';
import * as dotenv from 'dotenv';

dotenv.config();

// -------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------

const ONEINCH_API_BASE = 'https://api.1inch.dev/swap/v6.0';

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
];

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export interface OneInchQuoteParams {
  chainId: number;
  src: string;
  dst: string;
  amount: string;
  /** Include gas estimate in quote (default: true) */
  includeGas?: boolean;
}

export interface OneInchQuote {
  dstAmount: string;
  srcToken: { address: string; symbol: string; decimals: number };
  dstToken: { address: string; symbol: string; decimals: number };
  gas: number;
  protocols: unknown[];
}

export interface OneInchSwapParams {
  chainId: number;
  src: string;
  dst: string;
  amount: string;
  from: string;
  /** Slippage tolerance in percent (e.g. 0.5 for 0.5%) */
  slippage: number;
  /** Recipient address (defaults to from) */
  receiver?: string;
  /** Disable estimate to skip on-chain simulation */
  disableEstimate?: boolean;
}

export interface OneInchSwapResult {
  txHash: string;
  srcAmount: string;
  dstAmount: string;
  gasUsed: string;
  gasCostEth: string;
  routingSource: '1inch' | 'uniswap_direct';
  success: boolean;
  error?: string;
}

interface OneInchSwapResponse {
  tx: {
    from: string;
    to: string;
    data: string;
    value: string;
    gas: number;
    gasPrice: string;
  };
  dstAmount: string;
  srcAmount: string;
  protocols: unknown[];
}

// -------------------------------------------------------------------
// OneInchClient
// -------------------------------------------------------------------

export class OneInchClient {
  private apiKey: string;
  private registry: ChainRegistry;

  constructor(registry: ChainRegistry, apiKey?: string) {
    this.registry = registry;
    this.apiKey = apiKey ?? process.env.ONEINCH_API_KEY ?? '';

    if (!this.apiKey) {
      console.warn('[OneInchClient] No ONEINCH_API_KEY set. 1inch calls will fail; Uniswap fallback only.');
    }
  }

  // ---------------------------------------------------------------
  // API helpers
  // ---------------------------------------------------------------

  private async apiRequest<T>(chainId: number, endpoint: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${ONEINCH_API_BASE}/${chainId}/${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `1inch API error (${response.status}): ${body}`
      );
    }

    return response.json() as Promise<T>;
  }

  // ---------------------------------------------------------------
  // Quote
  // ---------------------------------------------------------------

  /**
   * Get a swap quote from 1inch (no transaction, just price).
   */
  async getQuote(params: OneInchQuoteParams): Promise<OneInchQuote> {
    const queryParams: Record<string, string> = {
      src: params.src,
      dst: params.dst,
      amount: params.amount,
    };
    if (params.includeGas !== false) {
      queryParams.includeGas = 'true';
    }

    return this.apiRequest<OneInchQuote>(params.chainId, 'quote', queryParams);
  }

  // ---------------------------------------------------------------
  // Build swap (returns unsigned tx data)
  // ---------------------------------------------------------------

  /**
   * Build a swap transaction via 1inch. Returns tx data ready to send.
   */
  async buildSwap(params: OneInchSwapParams): Promise<OneInchSwapResponse> {
    const queryParams: Record<string, string> = {
      src: params.src,
      dst: params.dst,
      amount: params.amount,
      from: params.from,
      slippage: params.slippage.toString(),
    };
    if (params.receiver) {
      queryParams.receiver = params.receiver;
    }
    if (params.disableEstimate) {
      queryParams.disableEstimate = 'true';
    }

    return this.apiRequest<OneInchSwapResponse>(params.chainId, 'swap', queryParams);
  }

  // ---------------------------------------------------------------
  // Execute swap
  // ---------------------------------------------------------------

  /**
   * Execute a swap via 1inch. Builds the tx, signs, and sends.
   * Falls back to logging the error if 1inch fails (caller handles fallback).
   */
  async executeSwap(params: OneInchSwapParams): Promise<OneInchSwapResult> {
    const client = this.registry.getClient(params.chainId);

    try {
      // Build the swap tx via 1inch API
      const swapData = await this.buildSwap(params);

      // Send the transaction
      const tx = await client.sendTransaction({
        to: swapData.tx.to,
        data: swapData.tx.data,
        value: BigInt(swapData.tx.value),
        gasLimit: BigInt(swapData.tx.gas),
      });

      const receipt = await tx.wait();
      if (!receipt) {
        throw new Error('Transaction not confirmed');
      }

      const gasUsed = receipt.gasUsed;
      const effectiveGasPrice = receipt.gasPrice ?? 0n;
      const gasCostWei = gasUsed * effectiveGasPrice;

      return {
        txHash: receipt.hash,
        srcAmount: swapData.srcAmount,
        dstAmount: swapData.dstAmount,
        gasUsed: gasUsed.toString(),
        gasCostEth: ethers.formatEther(gasCostWei),
        routingSource: '1inch',
        success: receipt.status === 1,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[OneInchClient] Swap failed on chain ${params.chainId}: ${msg}`);
      return {
        txHash: '',
        srcAmount: params.amount,
        dstAmount: '0',
        gasUsed: '0',
        gasCostEth: '0',
        routingSource: '1inch',
        success: false,
        error: msg,
      };
    }
  }

  // ---------------------------------------------------------------
  // Token approval
  // ---------------------------------------------------------------

  /**
   * Approve the 1inch router to spend tokens. Fetches the router address
   * from the 1inch API, then sends an ERC-20 approve tx.
   */
  async approveToken(tokenAddress: string, chainId: number): Promise<string | null> {
    const client = this.registry.getClient(chainId);

    // Get the 1inch router address for approval
    const approveData = await this.apiRequest<{ address: string }>(
      chainId, 'approve/spender', {}
    );
    const routerAddress = approveData.address;

    const token = new Contract(tokenAddress, ERC20_ABI, client.signer);
    const currentAllowance: bigint = await token.allowance(
      client.walletAddress,
      routerAddress
    );

    if (currentAllowance > 0n) {
      return null; // Already approved
    }

    const tx = await token.approve(routerAddress, ethers.MaxUint256);
    const receipt = await tx.wait();
    console.log(`[OneInchClient] Approved ${tokenAddress} on chain ${chainId}: ${receipt.hash}`);
    return receipt.hash;
  }

  /**
   * Check if 1inch API key is configured and usable.
   */
  isAvailable(): boolean {
    return this.apiKey.length > 0;
  }
}
