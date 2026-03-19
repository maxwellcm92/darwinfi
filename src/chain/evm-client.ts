/**
 * evm-client.ts - Chain-agnostic EVM client
 *
 * Generalizes base-client.ts for any EVM chain. Takes chainId, chainName,
 * and RPC endpoints as constructor params instead of hardcoding Base.
 * Managed by ChainRegistry (no singleton pattern).
 */

import { ethers, JsonRpcProvider, Wallet, TransactionRequest, TransactionResponse } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export interface EVMClientConfig {
  chainId: number;
  chainName: string;
  rpcUrls: string[];
  privateKey?: string;
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
// EVMClient
// -------------------------------------------------------------------

export class EVMClient {
  public provider: JsonRpcProvider;
  public signer: Wallet;
  public readonly chainId: number;
  public readonly chainName: string;
  public readonly maxGasPriceGwei: number;

  private nonceTracker: number | null = null;
  private nonceLock = false;
  private rpcEndpoints: string[];
  private currentRpcIndex: number = 0;
  private privateKey: string;

  constructor(config: EVMClientConfig) {
    this.chainId = config.chainId;
    this.chainName = config.chainName;
    this.maxGasPriceGwei = config.maxGasPriceGwei ?? 50;

    const privateKey = config.privateKey ?? process.env.TEAM4_PRIVATE_KEY ?? process.env.PRIVATE_KEY ?? '';
    if (!privateKey) {
      throw new Error(
        `Private key required for ${this.chainName} (chain ${this.chainId}). ` +
        `Set TEAM4_PRIVATE_KEY or PRIVATE_KEY in .env or pass via config.`
      );
    }
    this.privateKey = privateKey;

    if (!config.rpcUrls.length) {
      throw new Error(`At least one RPC URL is required for ${this.chainName}`);
    }
    this.rpcEndpoints = [...config.rpcUrls];

    this.provider = new JsonRpcProvider(this.rpcEndpoints[0], this.chainId, {
      staticNetwork: true,
    });
    this.signer = new Wallet(this.privateKey, this.provider);

    console.log(
      `[EVMClient:${this.chainName}] Initialized with RPC: ${this.rpcEndpoints[0]} ` +
      `(${this.rpcEndpoints.length} endpoints available)`
    );
  }

  /**
   * Rotate to the next RPC endpoint. Returns true if rotated, false if exhausted all options.
   */
  rotateRpc(): boolean {
    if (this.rpcEndpoints.length <= 1) return false;

    this.currentRpcIndex = (this.currentRpcIndex + 1) % this.rpcEndpoints.length;
    const newRpc = this.rpcEndpoints[this.currentRpcIndex];

    this.provider = new JsonRpcProvider(newRpc, this.chainId, {
      staticNetwork: true,
    });
    this.signer = new Wallet(this.privateKey, this.provider);
    this.nonceTracker = null; // Reset nonce on provider change

    console.log(`[EVMClient:${this.chainName}] Rotated to RPC: ${newRpc}`);
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
        console.warn(
          `[EVMClient:${this.chainName}] RPC health check failed ` +
          `(${this.rpcEndpoints[this.currentRpcIndex]}): ${msg}`
        );
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
    const actualChainId = Number(network.chainId);
    if (actualChainId !== this.chainId) {
      throw new Error(
        `Chain ID mismatch on ${this.chainName}: expected ${this.chainId}, got ${actualChainId}. ` +
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
        `Gas price ${gasPriceGwei.toFixed(2)} gwei exceeds max ${this.maxGasPriceGwei} gwei on ${this.chainName}. ` +
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
}
