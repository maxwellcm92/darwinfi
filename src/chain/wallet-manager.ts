/**
 * wallet-manager.ts - Multi-wallet and transaction management
 *
 * Supports one wallet per strategy bucket. Handles balance checking,
 * transaction sending with retry logic, and nonce management.
 */

import {
  ethers,
  Wallet,
  Contract,
  TransactionRequest,
  TransactionResponse,
  TransactionReceipt,
} from 'ethers';
import { BaseClient, getBaseClient } from './base-client';
import type { LitPKPSigner } from './lit-wallet';

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export interface WalletInfo {
  address: string;
  label: string;
  strategyBucket: string;
}

export interface TokenBalance {
  token: string;
  symbol: string;
  balance: string;
  rawBalance: bigint;
  decimals: number;
}

export interface TxSendOptions {
  /** Max retries on transient failure (default: 3) */
  maxRetries?: number;
  /** Base delay between retries in ms (exponential backoff applied) */
  retryDelayMs?: number;
  /** Timeout for waiting for receipt in ms (default: 60000) */
  receiptTimeoutMs?: number;
  /** Gas limit override */
  gasLimit?: bigint;
}

export interface TxResult {
  hash: string;
  receipt: TransactionReceipt;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  costWei: bigint;
  costEth: string;
  success: boolean;
}

// ERC-20 minimal ABI for balance checks
const ERC20_BALANCE_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

// -------------------------------------------------------------------
// WalletManager
// -------------------------------------------------------------------

export class WalletManager {
  private wallets: Map<string, Wallet | LitPKPSigner> = new Map();
  private labels: Map<string, string> = new Map();
  private baseClient: BaseClient;

  constructor(baseClient?: BaseClient) {
    this.baseClient = baseClient ?? getBaseClient();
  }

  // ---------------------------------------------------------------
  // Wallet registration
  // ---------------------------------------------------------------

  /**
   * Register the primary wallet (from BaseClient signer).
   */
  registerPrimaryWallet(label: string, strategyBucket: string): WalletInfo {
    const wallet = this.baseClient.signer;
    this.wallets.set(strategyBucket, wallet);
    this.labels.set(strategyBucket, label);
    return {
      address: wallet.address,
      label,
      strategyBucket,
    };
  }

  /**
   * Register an additional wallet from a private key.
   * Each strategy bucket can have its own wallet for isolation.
   */
  registerWallet(
    privateKey: string,
    label: string,
    strategyBucket: string
  ): WalletInfo {
    const wallet = new Wallet(privateKey, this.baseClient.provider);
    this.wallets.set(strategyBucket, wallet);
    this.labels.set(strategyBucket, label);
    return {
      address: wallet.address,
      label,
      strategyBucket,
    };
  }

  /**
   * Get wallet for a strategy bucket. Falls back to primary signer.
   */
  getWallet(strategyBucket: string): Wallet | LitPKPSigner {
    return this.wallets.get(strategyBucket) ?? this.baseClient.signer;
  }

  /**
   * List all registered wallets.
   */
  listWallets(): WalletInfo[] {
    const result: WalletInfo[] = [];
    for (const [bucket, wallet] of this.wallets.entries()) {
      result.push({
        address: wallet.address,
        label: this.labels.get(bucket) ?? 'unknown',
        strategyBucket: bucket,
      });
    }
    return result;
  }

  // ---------------------------------------------------------------
  // Balance checking
  // ---------------------------------------------------------------

  /**
   * Get ETH balance for a strategy bucket's wallet.
   */
  async getEthBalance(strategyBucket: string): Promise<string> {
    const wallet = this.getWallet(strategyBucket);
    const balance = await this.baseClient.provider.getBalance(wallet.address);
    return ethers.formatEther(balance);
  }

  /**
   * Get ERC-20 token balance for a strategy bucket's wallet.
   */
  async getTokenBalance(
    strategyBucket: string,
    tokenAddress: string
  ): Promise<TokenBalance> {
    const wallet = this.getWallet(strategyBucket);
    const contract = new Contract(
      tokenAddress,
      ERC20_BALANCE_ABI,
      this.baseClient.provider
    );

    const [rawBalance, decimals, symbol] = await Promise.all([
      contract.balanceOf(wallet.address) as Promise<bigint>,
      contract.decimals() as Promise<number>,
      contract.symbol() as Promise<string>,
    ]);

    return {
      token: tokenAddress,
      symbol,
      balance: ethers.formatUnits(rawBalance, decimals),
      rawBalance,
      decimals,
    };
  }

  /**
   * Get all balances (ETH + a list of tokens) for a strategy bucket.
   */
  async getAllBalances(
    strategyBucket: string,
    tokenAddresses: string[]
  ): Promise<{ eth: string; tokens: TokenBalance[] }> {
    const [eth, ...tokens] = await Promise.all([
      this.getEthBalance(strategyBucket),
      ...tokenAddresses.map((addr) => this.getTokenBalance(strategyBucket, addr)),
    ]);
    return { eth, tokens };
  }

  // ---------------------------------------------------------------
  // Transaction sending with retry
  // ---------------------------------------------------------------

  /**
   * Send a transaction with retry logic and receipt waiting.
   */
  async sendTransaction(
    strategyBucket: string,
    tx: TransactionRequest,
    options: TxSendOptions = {}
  ): Promise<TxResult> {
    const {
      maxRetries = 3,
      retryDelayMs = 1000,
      receiptTimeoutMs = 60_000,
      gasLimit,
    } = options;

    const wallet = this.getWallet(strategyBucket);

    // Apply gas limit override if provided
    if (gasLimit) {
      tx.gasLimit = gasLimit;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Get fresh nonce for each attempt
        const nonce = await this.baseClient.provider.getTransactionCount(
          wallet.address,
          'pending'
        );

        const txResponse: TransactionResponse = await wallet.sendTransaction({
          ...tx,
          nonce,
        });

        // Wait for confirmation
        const receipt = await txResponse.wait(1, receiptTimeoutMs);

        if (!receipt) {
          throw new Error(`Transaction ${txResponse.hash} not confirmed within timeout`);
        }

        const gasUsed = receipt.gasUsed;
        const effectiveGasPrice = receipt.gasPrice ?? 0n;
        const costWei = gasUsed * effectiveGasPrice;

        return {
          hash: txResponse.hash,
          receipt,
          gasUsed,
          effectiveGasPrice,
          costWei,
          costEth: ethers.formatEther(costWei),
          success: receipt.status === 1,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Do not retry on revert or user errors
        const msg = lastError.message.toLowerCase();
        if (
          msg.includes('revert') ||
          msg.includes('insufficient funds') ||
          msg.includes('nonce too low')
        ) {
          throw lastError;
        }

        // Exponential backoff for transient errors
        if (attempt < maxRetries - 1) {
          const delay = retryDelayMs * Math.pow(2, attempt);
          console.warn(
            `[WalletManager] Tx attempt ${attempt + 1} failed: ${lastError.message}. ` +
            `Retrying in ${delay}ms...`
          );
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw new Error(
      `Transaction failed after ${maxRetries} attempts. Last error: ${lastError?.message}`
    );
  }

  // ---------------------------------------------------------------
  // Safety checks
  // ---------------------------------------------------------------

  /**
   * Check if a wallet has enough ETH for gas.
   * Returns false if balance is below threshold.
   */
  async hasGasFunds(
    strategyBucket: string,
    minEthThreshold: string = '0.001'
  ): Promise<boolean> {
    const balance = await this.getEthBalance(strategyBucket);
    return parseFloat(balance) >= parseFloat(minEthThreshold);
  }
}
