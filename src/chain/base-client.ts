/**
 * base-client.ts - Base chain connection layer
 *
 * Manages ethers.js v6 provider + signer for Base L2.
 * Reads configuration from environment variables.
 */

import { ethers, JsonRpcProvider, Wallet, TransactionRequest, TransactionResponse } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

// -------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------

export const BASE_MAINNET_CHAIN_ID = 8453;
export const BASE_TESTNET_CHAIN_ID = 84532;

const MAINNET_RPC_ENDPOINTS = [
  'https://base.llamarpc.com',
  'https://mainnet.base.org',
  'https://1rpc.io/base',
];
const DEFAULT_TESTNET_RPC = 'https://sepolia.base.org';

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export interface BaseClientConfig {
  rpcUrl?: string;
  privateKey?: string;
  /** Use testnet (Base Sepolia) instead of mainnet */
  testnet?: boolean;
  /** Maximum gas price willing to pay (in gwei) */
  maxGasPriceGwei?: number;
}

export interface GasEstimate {
  gasLimit: bigint;
  gasPrice: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  estimatedCostWei: bigint;
  estimatedCostEth: string;
}

// -------------------------------------------------------------------
// BaseClient
// -------------------------------------------------------------------

export class BaseClient {
  public provider: JsonRpcProvider;
  public signer: Wallet;
  public readonly expectedChainId: number;
  public readonly maxGasPriceGwei: number;

  private nonceTracker: number | null = null;
  private nonceLock = false;
  private rpcEndpoints: string[];
  private currentRpcIndex: number = 0;
  private privateKey: string;

  constructor(config: BaseClientConfig = {}) {
    const testnet = config.testnet ?? false;
    this.expectedChainId = testnet ? BASE_TESTNET_CHAIN_ID : BASE_MAINNET_CHAIN_ID;
    this.maxGasPriceGwei = config.maxGasPriceGwei ?? 5; // Base L2 gas is cheap

    const privateKey = config.privateKey ?? process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('PRIVATE_KEY is required. Set it in .env or pass via config.');
    }
    this.privateKey = privateKey;

    // Build RPC endpoint list
    if (config.rpcUrl) {
      this.rpcEndpoints = [config.rpcUrl];
    } else if (testnet) {
      this.rpcEndpoints = [process.env.BASE_TESTNET_RPC_URL ?? DEFAULT_TESTNET_RPC];
    } else {
      const envRpc = process.env.BASE_RPC_URL;
      this.rpcEndpoints = envRpc ? [envRpc, ...MAINNET_RPC_ENDPOINTS] : [...MAINNET_RPC_ENDPOINTS];
    }

    this.provider = new JsonRpcProvider(this.rpcEndpoints[0], this.expectedChainId, {
      staticNetwork: true,
    });
    this.signer = new Wallet(privateKey, this.provider);

    console.log(`[BaseClient] Initialized with RPC: ${this.rpcEndpoints[0]} (${this.rpcEndpoints.length} endpoints available)`);
  }

  /**
   * Rotate to the next RPC endpoint. Returns true if rotated, false if exhausted all options.
   */
  rotateRpc(): boolean {
    if (this.rpcEndpoints.length <= 1) return false;

    this.currentRpcIndex = (this.currentRpcIndex + 1) % this.rpcEndpoints.length;
    const newRpc = this.rpcEndpoints[this.currentRpcIndex];

    this.provider = new JsonRpcProvider(newRpc, this.expectedChainId, {
      staticNetwork: true,
    });
    this.signer = new Wallet(this.privateKey, this.provider);
    this.nonceTracker = null; // Reset nonce on provider change

    console.log(`[BaseClient] Rotated to RPC: ${newRpc}`);
    return true;
  }

  /**
   * Health check: try getBlockNumber on current provider. If it fails, rotate.
   */
  async healthCheck(): Promise<boolean> {
    const startIdx = this.currentRpcIndex;
    do {
      try {
        await this.provider.getBlockNumber();
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[BaseClient] RPC health check failed (${this.rpcEndpoints[this.currentRpcIndex]}): ${msg}`);
        if (!this.rotateRpc()) return false;
      }
    } while (this.currentRpcIndex !== startIdx);
    return false;
  }

  // ---------------------------------------------------------------
  // Chain validation
  // ---------------------------------------------------------------

  async validateChain(): Promise<void> {
    const network = await this.provider.getNetwork();
    const chainId = Number(network.chainId);
    if (chainId !== this.expectedChainId) {
      throw new Error(
        `Chain ID mismatch: expected ${this.expectedChainId}, got ${chainId}. ` +
        `Are you connected to the correct network?`
      );
    }
  }

  // ---------------------------------------------------------------
  // Gas estimation
  // ---------------------------------------------------------------

  async estimateGas(tx: TransactionRequest): Promise<GasEstimate> {
    const [gasLimit, feeData] = await Promise.all([
      this.provider.estimateGas(tx),
      this.provider.getFeeData(),
    ]);

    const maxFeePerGas = feeData.maxFeePerGas ?? ethers.parseUnits('1', 'gwei');
    const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? ethers.parseUnits('0.1', 'gwei');
    const gasPrice = feeData.gasPrice ?? maxFeePerGas;

    // Check against our max gas price threshold
    const gasPriceGwei = Number(ethers.formatUnits(gasPrice, 'gwei'));
    if (gasPriceGwei > this.maxGasPriceGwei) {
      throw new Error(
        `Gas price ${gasPriceGwei.toFixed(2)} gwei exceeds max ${this.maxGasPriceGwei} gwei. ` +
        `Network may be congested.`
      );
    }

    const estimatedCostWei = gasLimit * gasPrice;

    return {
      gasLimit,
      gasPrice,
      maxFeePerGas,
      maxPriorityFeePerGas,
      estimatedCostWei,
      estimatedCostEth: ethers.formatEther(estimatedCostWei),
    };
  }

  // ---------------------------------------------------------------
  // Nonce management
  // ---------------------------------------------------------------

  /**
   * Get the next nonce, tracking locally to avoid conflicts
   * when sending multiple transactions in quick succession.
   */
  async getNextNonce(): Promise<number> {
    // Simple spin-wait if another call is getting a nonce
    while (this.nonceLock) {
      await new Promise((r) => setTimeout(r, 10));
    }

    this.nonceLock = true;
    try {
      if (this.nonceTracker === null) {
        this.nonceTracker = await this.provider.getTransactionCount(
          this.signer.address,
          'pending'
        );
      } else {
        this.nonceTracker++;
      }
      return this.nonceTracker;
    } finally {
      this.nonceLock = false;
    }
  }

  /**
   * Reset nonce tracker (e.g. after a failed tx or at start of new batch).
   */
  resetNonce(): void {
    this.nonceTracker = null;
  }

  // ---------------------------------------------------------------
  // Convenience helpers
  // ---------------------------------------------------------------

  async getEthBalance(address?: string): Promise<string> {
    const addr = address ?? this.signer.address;
    const balance = await this.provider.getBalance(addr);
    return ethers.formatEther(balance);
  }

  async getBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
    const nonce = await this.getNextNonce();
    return this.signer.sendTransaction({ ...tx, nonce });
  }

  get walletAddress(): string {
    return this.signer.address;
  }

  isMainnet(): boolean {
    return this.expectedChainId === BASE_MAINNET_CHAIN_ID;
  }
}

// -------------------------------------------------------------------
// Singleton helper (lazy init)
// -------------------------------------------------------------------

let _defaultClient: BaseClient | null = null;

export function getBaseClient(config?: BaseClientConfig): BaseClient {
  if (!_defaultClient) {
    _defaultClient = new BaseClient(config);
  }
  return _defaultClient;
}

/**
 * Reset the singleton (useful for tests or switching networks).
 */
export function resetBaseClient(): void {
  _defaultClient = null;
}
