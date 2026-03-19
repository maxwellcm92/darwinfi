/**
 * lit-wallet.ts - Lit Protocol PKP wallet wrapper
 *
 * Provides an ethers.js v6 compatible AbstractSigner backed by a
 * Lit Protocol Programmable Key Pair (PKP). Every transaction is
 * validated by the trade-policy Lit Action before signing, giving
 * cryptographic guardrails to the autonomous trading agent.
 *
 * The PKP public key and Lit Action IPFS CID are read from
 * environment variables (LIT_PKP_PUBLIC_KEY, LIT_ACTION_IPFS_CID).
 */

import {
  ethers,
  AbstractSigner,
  Provider,
  TransactionRequest,
  TransactionResponse,
  TypedDataDomain,
  TypedDataField,
  JsonRpcProvider,
} from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export interface LitWalletConfig {
  /** The PKP's compressed public key (hex, 0x-prefixed) */
  pkpPublicKey: string;
  /** IPFS CID of the trade-policy Lit Action */
  litActionIpfsCid: string;
  /** Lit network: 'datil-dev' | 'datil-test' | 'datil' (default: 'datil-test') */
  litNetwork?: string;
  /** RPC URL for the target chain */
  rpcUrl?: string;
  /** Target chain ID (default: 8453 for Base mainnet) */
  chainId?: number;
  /** DarwinVaultV2 contract address (passed to Lit Action for whitelist) */
  vaultAddress?: string;
  /** Authentication method for Lit (session sigs, auth sig, etc.) */
  authSig?: LitAuthSig;
}

export interface LitAuthSig {
  sig: string;
  derivedVia: string;
  signedMessage: string;
  address: string;
}

interface LitActionResponse {
  success: boolean;
  error?: string;
  violations?: string[];
  message?: string;
}

interface LitSignatureShare {
  r: string;
  s: string;
  recid: number;
}

// -------------------------------------------------------------------
// LitNodeClient interface (minimal typing for dynamic import)
//
// We define the shape we need rather than importing the full
// @lit-protocol/lit-node-client types, so the module can be
// resolved at runtime without hard-failing during type-check
// when the Lit SDK is not yet installed.
// -------------------------------------------------------------------

interface ILitNodeClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  executeJs(params: {
    ipfsId?: string;
    code?: string;
    authSig?: LitAuthSig;
    sessionSigs?: Record<string, unknown>;
    jsParams: Record<string, unknown>;
  }): Promise<{
    signatures?: Record<string, LitSignatureShare>;
    response?: string;
    logs?: string;
  }>;
}

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

/**
 * Derive the Ethereum address from an uncompressed or compressed
 * public key (hex, 0x-prefixed).
 */
function pkpPublicKeyToAddress(publicKey: string): string {
  // ethers.computeAddress handles both compressed and uncompressed keys
  return ethers.computeAddress(publicKey);
}

/**
 * Combine ECDSA signature components (r, s, v) into a serialized
 * 65-byte signature string.
 */
function combineSignature(r: string, s: string, recid: number): string {
  const rPadded = r.startsWith('0x') ? r.slice(2) : r;
  const sPadded = s.startsWith('0x') ? s.slice(2) : s;
  const v = recid + 27;
  return '0x' + rPadded.padStart(64, '0') + sPadded.padStart(64, '0') + v.toString(16).padStart(2, '0');
}

// -------------------------------------------------------------------
// LitPKPSigner
// -------------------------------------------------------------------

/**
 * An ethers.js v6 AbstractSigner that delegates all signing operations
 * to a Lit Protocol PKP. The trade-policy Lit Action validates every
 * transaction before the PKP signs it.
 *
 * Usage:
 *   const litWallet = new LitWallet(config);
 *   await litWallet.connect();
 *   const signer = litWallet.getSigner(provider);
 *   // signer is a drop-in replacement for ethers.Wallet
 */
export class LitPKPSigner extends AbstractSigner {
  private _address: string;
  private litClient: ILitNodeClient | null = null;
  private litActionIpfsCid: string;
  private pkpPublicKey: string;
  private litNetwork: string;
  private vaultAddress: string;
  private authSig: LitAuthSig | undefined;
  private _connected: boolean = false;

  constructor(
    provider: Provider,
    config: LitWalletConfig,
  ) {
    super(provider);
    this.pkpPublicKey = config.pkpPublicKey;
    this.litActionIpfsCid = config.litActionIpfsCid;
    this.litNetwork = config.litNetwork ?? 'datil-test';
    this.vaultAddress = config.vaultAddress ?? process.env.DARWIN_VAULT_ADDRESS ?? '';
    this.authSig = config.authSig;
    this._address = pkpPublicKeyToAddress(config.pkpPublicKey);
  }

  // ---------------------------------------------------------------
  // AbstractSigner required methods
  // ---------------------------------------------------------------

  async getAddress(): Promise<string> {
    return this._address;
  }

  /**
   * Synchronous address accessor for compatibility with code that
   * reads signer.address directly (like ethers.Wallet).
   */
  get address(): string {
    return this._address;
  }

  async signTransaction(tx: TransactionRequest): Promise<string> {
    await this.ensureConnected();

    // Resolve any ENS names or unresolved fields
    const resolvedTx = await this.resolveTransactionRequest(tx);

    // Serialize the transaction for signing
    const unsignedTx: ethers.TransactionLike = {
      to: resolvedTx.to as string,
      value: resolvedTx.value ?? 0n,
      data: resolvedTx.data?.toString() ?? '0x',
      nonce: resolvedTx.nonce != null ? Number(resolvedTx.nonce) : undefined,
      gasLimit: resolvedTx.gasLimit ?? undefined,
      chainId: resolvedTx.chainId ?? 8453n,
      type: resolvedTx.type ?? 2,
      maxFeePerGas: resolvedTx.maxFeePerGas ?? undefined,
      maxPriorityFeePerGas: resolvedTx.maxPriorityFeePerGas ?? undefined,
    };

    const serializedUnsigned = ethers.Transaction.from(unsignedTx).unsignedSerialized;
    const txHash = ethers.keccak256(serializedUnsigned);
    const toSign = ethers.getBytes(txHash);

    // Build jsParams for the Lit Action
    const txData = {
      to: resolvedTx.to as string,
      value: (resolvedTx.value ?? 0n).toString(),
      data: resolvedTx.data?.toString() ?? '0x',
      chainId: Number(resolvedTx.chainId ?? 8453n),
    };

    const result = await this.litClient!.executeJs({
      ipfsId: this.litActionIpfsCid,
      authSig: this.authSig,
      jsParams: {
        toSign: Array.from(toSign),
        publicKey: this.pkpPublicKey,
        sigName: 'darwinfi-trade',
        txData,
        vaultAddress: this.vaultAddress,
      },
    });

    // Check the Lit Action response
    if (result.response) {
      let parsedResponse: LitActionResponse;
      try {
        parsedResponse = JSON.parse(result.response);
      } catch {
        throw new Error(`[LitPKPSigner] Failed to parse Lit Action response: ${result.response}`);
      }

      if (!parsedResponse.success) {
        const violations = parsedResponse.violations?.join('; ') ?? parsedResponse.error ?? 'Unknown error';
        throw new Error(`[LitPKPSigner] Trade policy rejected transaction: ${violations}`);
      }
    }

    // Extract the signature
    const sig = result.signatures?.['darwinfi-trade'];
    if (!sig) {
      throw new Error(
        '[LitPKPSigner] No signature returned from Lit Action. ' +
        'Check that the Lit Action calls Lit.Actions.signEcdsa() on approval.'
      );
    }

    const combinedSig = combineSignature(sig.r, sig.s, sig.recid);

    // Attach signature to the transaction and serialize
    const signedTx = ethers.Transaction.from({
      ...unsignedTx,
      signature: combinedSig,
    });

    return signedTx.serialized;
  }

  async signMessage(message: string | Uint8Array): Promise<string> {
    await this.ensureConnected();

    const messageBytes = typeof message === 'string'
      ? ethers.toUtf8Bytes(message)
      : message;
    const messageHash = ethers.hashMessage(messageBytes);
    const toSign = ethers.getBytes(messageHash);

    const result = await this.litClient!.executeJs({
      ipfsId: this.litActionIpfsCid,
      authSig: this.authSig,
      jsParams: {
        toSign: Array.from(toSign),
        publicKey: this.pkpPublicKey,
        sigName: 'darwinfi-message',
        txData: null,
        vaultAddress: this.vaultAddress,
      },
    });

    const sig = result.signatures?.['darwinfi-message'];
    if (!sig) {
      throw new Error('[LitPKPSigner] No signature returned from Lit Action for message signing.');
    }

    return combineSignature(sig.r, sig.s, sig.recid);
  }

  async signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>,
  ): Promise<string> {
    await this.ensureConnected();

    const hash = ethers.TypedDataEncoder.hash(domain, types, value);
    const toSign = ethers.getBytes(hash);

    const result = await this.litClient!.executeJs({
      ipfsId: this.litActionIpfsCid,
      authSig: this.authSig,
      jsParams: {
        toSign: Array.from(toSign),
        publicKey: this.pkpPublicKey,
        sigName: 'darwinfi-typeddata',
        txData: null,
        vaultAddress: this.vaultAddress,
      },
    });

    const sig = result.signatures?.['darwinfi-typeddata'];
    if (!sig) {
      throw new Error('[LitPKPSigner] No signature returned from Lit Action for typed data signing.');
    }

    return combineSignature(sig.r, sig.s, sig.recid);
  }

  connect(provider: Provider): LitPKPSigner {
    // Return a new signer connected to the given provider
    const config: LitWalletConfig = {
      pkpPublicKey: this.pkpPublicKey,
      litActionIpfsCid: this.litActionIpfsCid,
      litNetwork: this.litNetwork,
      vaultAddress: this.vaultAddress,
      authSig: this.authSig,
    };
    const newSigner = new LitPKPSigner(provider, config);
    // Share the Lit client connection
    newSigner.litClient = this.litClient;
    newSigner._connected = this._connected;
    return newSigner;
  }

  // ---------------------------------------------------------------
  // Lit network connection
  // ---------------------------------------------------------------

  /**
   * Initialize and connect the underlying LitNodeClient.
   * Must be called before any signing operations.
   */
  async connectLitNetwork(): Promise<void> {
    if (this._connected && this.litClient) return;

    try {
      // Dynamic import so the module does not hard-fail at require time
      // if @lit-protocol/lit-node-client is not yet installed
      // @ts-ignore -- optional dependency, may not be installed
      const { LitNodeClient } = await import('@lit-protocol/lit-node-client');

      this.litClient = new LitNodeClient({
        litNetwork: this.litNetwork as any,
        debug: false,
      }) as unknown as ILitNodeClient;

      await this.litClient.connect();
      this._connected = true;

      console.log(
        `[LitPKPSigner] Connected to Lit network (${this.litNetwork}). ` +
        `PKP address: ${this._address}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`[LitPKPSigner] Failed to connect to Lit network: ${msg}`);
    }
  }

  /**
   * Disconnect from the Lit network and release resources.
   */
  async disconnectLitNetwork(): Promise<void> {
    if (this.litClient) {
      await this.litClient.disconnect();
      this._connected = false;
      this.litClient = null;
      console.log('[LitPKPSigner] Disconnected from Lit network.');
    }
  }

  get isConnected(): boolean {
    return this._connected;
  }

  // ---------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------

  private async ensureConnected(): Promise<void> {
    if (!this._connected || !this.litClient) {
      throw new Error(
        '[LitPKPSigner] Not connected to Lit network. Call connectLitNetwork() first.'
      );
    }
  }

  /**
   * Resolve a TransactionRequest, filling in missing fields from the provider.
   */
  private async resolveTransactionRequest(tx: TransactionRequest): Promise<TransactionRequest> {
    const resolved = { ...tx };

    if (resolved.from == null) {
      resolved.from = this._address;
    }

    // Let the provider fill in gas estimates if not provided
    if (this.provider) {
      if (resolved.nonce == null) {
        resolved.nonce = await this.provider.getTransactionCount(this._address, 'pending');
      }
      if (resolved.chainId == null) {
        const network = await this.provider.getNetwork();
        resolved.chainId = network.chainId;
      }
      if (resolved.gasLimit == null) {
        try {
          resolved.gasLimit = await this.provider.estimateGas(resolved);
        } catch {
          // Leave gasLimit unset; the caller should handle this
        }
      }
      if (resolved.maxFeePerGas == null || resolved.maxPriorityFeePerGas == null) {
        const feeData = await this.provider.getFeeData();
        if (resolved.maxFeePerGas == null) {
          resolved.maxFeePerGas = feeData.maxFeePerGas;
        }
        if (resolved.maxPriorityFeePerGas == null) {
          resolved.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
        }
      }
    }

    return resolved;
  }
}

// -------------------------------------------------------------------
// LitWallet - High-level wrapper
// -------------------------------------------------------------------

/**
 * High-level wrapper that manages the LitNodeClient lifecycle
 * and produces an ethers-compatible signer.
 *
 * Usage:
 *   const litWallet = new LitWallet();  // reads config from env
 *   await litWallet.connect();
 *   const signer = litWallet.getSigner(provider);
 *   // Use signer wherever you would use ethers.Wallet
 */
export class LitWallet {
  private config: LitWalletConfig;
  private _signer: LitPKPSigner | null = null;

  constructor(config?: Partial<LitWalletConfig>) {
    this.config = {
      pkpPublicKey: config?.pkpPublicKey ?? process.env.LIT_PKP_PUBLIC_KEY ?? '',
      litActionIpfsCid: config?.litActionIpfsCid ?? process.env.LIT_ACTION_IPFS_CID ?? '',
      litNetwork: config?.litNetwork ?? process.env.LIT_NETWORK ?? 'datil-test',
      rpcUrl: config?.rpcUrl ?? process.env.BASE_RPC_URL,
      chainId: config?.chainId ?? 8453,
      vaultAddress: config?.vaultAddress ?? process.env.DARWIN_VAULT_ADDRESS,
      authSig: config?.authSig,
    };

    if (!this.config.pkpPublicKey) {
      throw new Error(
        '[LitWallet] PKP public key is required. ' +
        'Set LIT_PKP_PUBLIC_KEY in .env or pass via config.'
      );
    }
    if (!this.config.litActionIpfsCid) {
      throw new Error(
        '[LitWallet] Lit Action IPFS CID is required. ' +
        'Set LIT_ACTION_IPFS_CID in .env or pass via config.'
      );
    }
  }

  /**
   * Get or create the PKP signer for a given provider.
   * The signer is lazy-initialized but the Lit network connection
   * must be established via connect() first.
   */
  getSigner(provider: Provider): LitPKPSigner {
    if (!this._signer) {
      this._signer = new LitPKPSigner(provider, this.config);
    }
    return this._signer;
  }

  /**
   * Connect to the Lit network. Must be called before signing.
   */
  async connect(provider?: Provider): Promise<LitPKPSigner> {
    const effectiveProvider = provider ?? new JsonRpcProvider(
      this.config.rpcUrl ?? 'https://mainnet.base.org',
      this.config.chainId ?? 8453,
      { staticNetwork: true },
    );

    const signer = this.getSigner(effectiveProvider);
    await signer.connectLitNetwork();
    return signer;
  }

  /**
   * Disconnect from the Lit network.
   */
  async disconnect(): Promise<void> {
    if (this._signer) {
      await this._signer.disconnectLitNetwork();
    }
  }

  /**
   * The PKP's Ethereum address.
   */
  get address(): string {
    return pkpPublicKeyToAddress(this.config.pkpPublicKey);
  }
}
