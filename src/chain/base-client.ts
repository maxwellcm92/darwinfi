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

const DEFAULT_MAINNET_RPC = 'https://mainnet.base.org';
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
  public readonly provider: JsonRpcProvider;
  public readonly signer: Wallet;
  public readonly expectedChainId: number;
  public readonly maxGasPriceGwei: number;

  private nonceTracker: number | null = null;
  private nonceLock = false;

  constructor(config: BaseClientConfig = {}) {
    const testnet = config.testnet ?? false;
    this.expectedChainId = testnet ? BASE_TESTNET_CHAIN_ID : BASE_MAINNET_CHAIN_ID;
    this.maxGasPriceGwei = config.maxGasPriceGwei ?? 5; // Base L2 gas is cheap

    const rpcUrl = config.rpcUrl
      ?? (testnet ? process.env.BASE_TESTNET_RPC_URL : process.env.BASE_RPC_URL)
      ?? (testnet ? DEFAULT_TESTNET_RPC : DEFAULT_MAINNET_RPC);

    const privateKey = config.privateKey ?? process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('PRIVATE_KEY is required. Set it in .env or pass via config.');
    }

    this.provider = new JsonRpcProvider(rpcUrl, this.expectedChainId, {
      staticNetwork: true,
    });

    this.signer = new Wallet(privateKey, this.provider);
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
