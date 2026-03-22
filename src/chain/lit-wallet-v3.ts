/**
 * lit-wallet-v3.ts - Lit Protocol Chipotle (v3) PKP wallet wrapper
 *
 * Replaces the SDK-based lit-wallet.ts with Chipotle's REST API.
 * Chipotle eliminates LitNodeClient, threshold cryptography, and
 * AuthSig -- instead using simple HTTP requests with API key auth.
 *
 * The trade-policy Lit Action still validates every transaction
 * before signing, but now runs inside a single TEE with direct
 * private key access instead of distributed threshold signing.
 *
 * Key differences from v2 (lit-wallet.ts):
 *   - No @lit-protocol/lit-node-client dependency
 *   - REST API at api.dev.litprotocol.com/core/v1/
 *   - API key auth via X-Api-Key header (no AuthSig/SessionSigs)
 *   - Lit Actions return ethers-format signatures directly
 *   - PKPs identified by wallet address, not public key
 *
 * Environment variables:
 *   LIT_API_KEY          - Chipotle usage API key (scoped to execute)
 *   LIT_CHIPOTLE_WALLET  - PKP wallet address from Chipotle
 *   LIT_ACTION_IPFS_CID  - IPFS CID of the trade-policy-v3 Lit Action
 *   LIT_API_BASE_URL     - Optional: override API base (default: https://api.dev.litprotocol.com)
 */

import {
  ethers,
  AbstractSigner,
  Provider,
  TransactionRequest,
  TypedDataDomain,
  TypedDataField,
  JsonRpcProvider,
} from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export interface LitWalletV3Config {
  /** Chipotle usage API key (scoped to execute on the DarwinFi group) */
  apiKey: string;
  /** PKP wallet address from Chipotle */
  walletAddress: string;
  /** IPFS CID of the trade-policy-v3 Lit Action */
  litActionIpfsCid: string;
  /** Chipotle API base URL (default: https://api.dev.litprotocol.com) */
  apiBaseUrl?: string;
  /** RPC URL for the target chain */
  rpcUrl?: string;
  /** Target chain ID (default: 8453 for Base mainnet) */
  chainId?: number;
  /** DarwinVault contract address (passed to Lit Action for whitelist) */
  vaultAddress?: string;
}

interface LitActionResult {
  success: boolean;
  error?: string;
  violations?: string[];
  message?: string;
  signature?: string;
  txHash?: string;
}

interface ChipotleResponse {
  response?: LitActionResult;
  signatures?: Record<string, string>;
  logs?: string;
  error?: string;
}

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

/**
 * Execute a Lit Action via the Chipotle REST API.
 */
async function executeChipotleLitAction(
  apiBaseUrl: string,
  apiKey: string,
  code: string,
  jsParams: Record<string, unknown>,
): Promise<ChipotleResponse> {
  const url = `${apiBaseUrl}/core/v1/lit_action`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
    body: JSON.stringify({
      code,
      js_params: jsParams,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `[LitChipotle] API request failed (${res.status}): ${body}`
    );
  }

  return res.json() as Promise<ChipotleResponse>;
}

// -------------------------------------------------------------------
// Trade Policy Lit Action (Chipotle v3 format)
// -------------------------------------------------------------------

/**
 * Inline trade-policy code for Chipotle v3.
 * This is the same validation logic as trade-policy.js but rewritten
 * as an async function main() with getPrivateKey() signing.
 *
 * In production, this would be pinned to IPFS and registered in a
 * Chipotle group. For dev, we can pass code inline.
 */
const TRADE_POLICY_V3_CODE = `
async function main({ pkpId, txData, vaultAddress }) {
  const UNISWAP_V3_SWAP_ROUTER = "0x2626664c2603336E57B271c5C0b26F421741e481";
  const MAX_TRADE_USDC = 1000000000n; // 1000 USDC
  const USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  const ALLOWED_TOKENS = {
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC",
    "0x4200000000000000000000000000000000000006": "WETH",
    "0xc3de830ea07524a0761646a6a4e4be0e114a3c83": "UNI",
    "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452": "wstETH",
    "0x2a2764e1472e0a09d70e10b1bfa4afbe144f72a3": "ENS",
    "0x940181a94a35a4569e4529a3cdfb74e38fd98631": "AERO",
    "0x4ed4e862860bed51a9570b96d89af5e1b0efefed": "DEGEN",
    "0x532f27101965dd16442e59d40670faf5ebb142e4": "BRETT",
    "0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b": "VIRTUAL",
    "0x0578d8a44db98b23bf096a382e016e29a5ce0ffe": "HIGHER",
  };
  const BASE_CHAIN_ID = 8453;
  const ALLOWED_SWAP_SELECTORS = ["0x414bf389", "0x5ae401dc"];
  const ERC20_APPROVE_SELECTOR = "0x095ea7b3";

  function norm(addr) { return (addr || "").toLowerCase().trim(); }
  function selector(data) { return (data && data.length >= 10) ? data.slice(0, 10).toLowerCase() : ""; }

  if (!txData) return { success: false, error: "Missing txData" };

  const to = norm(txData.to);
  const chainId = Number(txData.chainId);
  const data = txData.data || "0x";
  const value = txData.value || "0";
  const errors = [];

  if (chainId !== BASE_CHAIN_ID) errors.push("Chain ID: expected " + BASE_CHAIN_ID + ", got " + chainId);

  const contractWhitelist = [norm(UNISWAP_V3_SWAP_ROUTER)];
  if (vaultAddress) contractWhitelist.push(norm(vaultAddress));
  const tokenAddresses = Object.keys(ALLOWED_TOKENS);
  const allAllowed = [...contractWhitelist, ...tokenAddresses];

  if (!to) errors.push("No 'to' address (contract creation not allowed)");
  else if (!allAllowed.includes(to)) errors.push("Target not whitelisted: " + to);

  if (to && tokenAddresses.includes(to)) {
    const sel = selector(data);
    if (sel !== ERC20_APPROVE_SELECTOR) {
      errors.push("Only approve() on tokens. Got: " + sel);
    } else {
      const spender = "0x" + data.slice(34, 74).toLowerCase();
      if (!contractWhitelist.includes(spender)) errors.push("approve() spender not whitelisted: " + spender);
    }
  }

  if (to === norm(UNISWAP_V3_SWAP_ROUTER)) {
    const sel = selector(data);
    if (!ALLOWED_SWAP_SELECTORS.includes(sel)) errors.push("SwapRouter selector not allowed: " + sel);
  }

  if (BigInt(value) > 0n && to !== norm(UNISWAP_V3_SWAP_ROUTER)) {
    errors.push("ETH transfers only to SwapRouter");
  }

  if (errors.length > 0) {
    return { success: false, error: errors.join("; "), violations: errors };
  }

  // All checks passed -- sign the transaction hash
  const wallet = new ethers.Wallet(await Lit.Actions.getPrivateKey({ pkpId }));
  // txData.toSign is the raw transaction hash bytes
  if (txData.toSign) {
    const sig = await wallet.signMessage(ethers.utils.arrayify(txData.toSign));
    return { success: true, message: "Transaction approved by trade policy", signature: sig };
  }

  // If full transaction is provided, sign and broadcast
  if (txData.serializedUnsigned) {
    const provider = new ethers.providers.JsonRpcProvider(txData.rpcUrl || "https://mainnet.base.org");
    const connectedWallet = wallet.connect(provider);
    const signedTx = await connectedWallet.signTransaction(JSON.parse(txData.serializedUnsigned));
    return { success: true, message: "Transaction signed", signature: signedTx };
  }

  return { success: true, message: "Trade policy approved (no signing requested)" };
}
`;

// -------------------------------------------------------------------
// LitPKPSignerV3
// -------------------------------------------------------------------

/**
 * ethers.js v6 AbstractSigner backed by Lit Protocol Chipotle REST API.
 * Drop-in replacement for LitPKPSigner from lit-wallet.ts.
 */
export class LitPKPSignerV3 extends AbstractSigner {
  private _address: string;
  private apiKey: string;
  private apiBaseUrl: string;
  private litActionIpfsCid: string;
  private vaultAddress: string;
  private _ready: boolean = false;

  constructor(
    provider: Provider,
    config: LitWalletV3Config,
  ) {
    super(provider);
    this._address = config.walletAddress;
    this.apiKey = config.apiKey;
    this.apiBaseUrl = (config.apiBaseUrl ?? 'https://api.dev.litprotocol.com').replace(/\/$/, '');
    this.litActionIpfsCid = config.litActionIpfsCid;
    this.vaultAddress = config.vaultAddress ?? process.env.DARWIN_VAULT_V4_ADDRESS ?? '';
  }

  // ---------------------------------------------------------------
  // AbstractSigner required methods
  // ---------------------------------------------------------------

  async getAddress(): Promise<string> {
    return this._address;
  }

  get address(): string {
    return this._address;
  }

  async signTransaction(tx: TransactionRequest): Promise<string> {
    this.ensureReady();

    const resolvedTx = await this.resolveTransactionRequest(tx);

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

    // Build the transaction data for the Lit Action's validation
    const txData = {
      to: resolvedTx.to as string,
      value: (resolvedTx.value ?? 0n).toString(),
      data: resolvedTx.data?.toString() ?? '0x',
      chainId: Number(resolvedTx.chainId ?? 8453n),
      serializedUnsigned: JSON.stringify({
        to: unsignedTx.to,
        value: unsignedTx.value?.toString(),
        data: unsignedTx.data,
        nonce: unsignedTx.nonce,
        gasLimit: unsignedTx.gasLimit?.toString(),
        chainId: Number(unsignedTx.chainId),
        type: unsignedTx.type,
        maxFeePerGas: unsignedTx.maxFeePerGas?.toString(),
        maxPriorityFeePerGas: unsignedTx.maxPriorityFeePerGas?.toString(),
      }),
      rpcUrl: (this.provider as any)?._getConnection?.()?.url ?? 'https://mainnet.base.org',
    };

    const result = await executeChipotleLitAction(
      this.apiBaseUrl,
      this.apiKey,
      TRADE_POLICY_V3_CODE,
      {
        pkpId: this._address,
        txData,
        vaultAddress: this.vaultAddress,
      },
    );

    if (result.error) {
      throw new Error(`[LitPKPSignerV3] Chipotle API error: ${result.error}`);
    }

    const actionResult = result.response;
    if (!actionResult) {
      throw new Error('[LitPKPSignerV3] No response from Lit Action');
    }

    if (!actionResult.success) {
      const violations = actionResult.violations?.join('; ') ?? actionResult.error ?? 'Unknown error';
      throw new Error(`[LitPKPSignerV3] Trade policy rejected: ${violations}`);
    }

    if (!actionResult.signature) {
      throw new Error('[LitPKPSignerV3] No signed transaction returned from Lit Action');
    }

    return actionResult.signature;
  }

  async signMessage(message: string | Uint8Array): Promise<string> {
    this.ensureReady();

    const messageStr = typeof message === 'string' ? message : ethers.hexlify(message);

    const code = `
async function main({ pkpId, message }) {
  const wallet = new ethers.Wallet(await Lit.Actions.getPrivateKey({ pkpId }));
  const signature = await wallet.signMessage(message);
  return { signature };
}
`;

    const result = await executeChipotleLitAction(
      this.apiBaseUrl,
      this.apiKey,
      code,
      { pkpId: this._address, message: messageStr },
    );

    if (result.error) {
      throw new Error(`[LitPKPSignerV3] Chipotle API error: ${result.error}`);
    }

    const sig = result.response?.signature;
    if (!sig) {
      throw new Error('[LitPKPSignerV3] No signature returned from message signing');
    }

    return sig as string;
  }

  async signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>,
  ): Promise<string> {
    this.ensureReady();

    const code = `
async function main({ pkpId, domain, types, value }) {
  const wallet = new ethers.Wallet(await Lit.Actions.getPrivateKey({ pkpId }));
  const signature = await wallet._signTypedData(domain, types, value);
  return { signature };
}
`;

    const result = await executeChipotleLitAction(
      this.apiBaseUrl,
      this.apiKey,
      code,
      { pkpId: this._address, domain, types, value },
    );

    if (result.error) {
      throw new Error(`[LitPKPSignerV3] Chipotle API error: ${result.error}`);
    }

    const sig = result.response?.signature;
    if (!sig) {
      throw new Error('[LitPKPSignerV3] No signature returned from typed data signing');
    }

    return sig as string;
  }

  connect(provider: Provider): LitPKPSignerV3 {
    const config: LitWalletV3Config = {
      apiKey: this.apiKey,
      walletAddress: this._address,
      litActionIpfsCid: this.litActionIpfsCid,
      apiBaseUrl: this.apiBaseUrl,
      vaultAddress: this.vaultAddress,
    };
    const newSigner = new LitPKPSignerV3(provider, config);
    newSigner._ready = this._ready;
    return newSigner;
  }

  // ---------------------------------------------------------------
  // Connection (simplified -- no LitNodeClient to manage)
  // ---------------------------------------------------------------

  /**
   * Verify the API key is valid by calling account_exists.
   * In Chipotle, there is no persistent connection to manage --
   * each request is a standalone HTTP call.
   */
  async verifyConnection(): Promise<void> {
    const url = `${this.apiBaseUrl}/core/v1/account_exists`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'X-Api-Key': this.apiKey },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `[LitPKPSignerV3] API key verification failed (${res.status}): ${body}`
      );
    }

    this._ready = true;
    console.log(
      `[LitPKPSignerV3] Chipotle API key verified. Wallet: ${this._address}`
    );
  }

  get isReady(): boolean {
    return this._ready;
  }

  // ---------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------

  private ensureReady(): void {
    if (!this._ready) {
      throw new Error(
        '[LitPKPSignerV3] Not verified. Call verifyConnection() first.'
      );
    }
  }

  private async resolveTransactionRequest(tx: TransactionRequest): Promise<TransactionRequest> {
    const resolved = { ...tx };

    if (resolved.from == null) {
      resolved.from = this._address;
    }

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
          // Leave gasLimit unset
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
// LitWalletV3 - High-level wrapper
// -------------------------------------------------------------------

/**
 * High-level wrapper for Chipotle v3. Same interface as LitWallet
 * from lit-wallet.ts but uses REST API instead of SDK.
 *
 * Usage:
 *   const litWallet = new LitWalletV3();  // reads config from env
 *   const signer = await litWallet.connect(provider);
 *   // signer is a drop-in replacement for ethers.Wallet
 */
export class LitWalletV3 {
  private config: LitWalletV3Config;
  private _signer: LitPKPSignerV3 | null = null;

  constructor(config?: Partial<LitWalletV3Config>) {
    this.config = {
      apiKey: config?.apiKey ?? process.env.LIT_API_KEY ?? '',
      walletAddress: config?.walletAddress ?? process.env.LIT_CHIPOTLE_WALLET ?? '',
      litActionIpfsCid: config?.litActionIpfsCid ?? process.env.LIT_ACTION_IPFS_CID ?? '',
      apiBaseUrl: config?.apiBaseUrl ?? process.env.LIT_API_BASE_URL ?? 'https://api.dev.litprotocol.com',
      rpcUrl: config?.rpcUrl ?? process.env.BASE_RPC_URL,
      chainId: config?.chainId ?? 8453,
      vaultAddress: config?.vaultAddress ?? process.env.DARWIN_VAULT_V4_ADDRESS,
    };

    if (!this.config.apiKey) {
      throw new Error(
        '[LitWalletV3] API key required. Set LIT_API_KEY in .env or pass via config.'
      );
    }
    if (!this.config.walletAddress) {
      throw new Error(
        '[LitWalletV3] Wallet address required. Set LIT_CHIPOTLE_WALLET in .env or pass via config.'
      );
    }
  }

  getSigner(provider: Provider): LitPKPSignerV3 {
    if (!this._signer) {
      this._signer = new LitPKPSignerV3(provider, this.config);
    }
    return this._signer;
  }

  async connect(provider?: Provider): Promise<LitPKPSignerV3> {
    const effectiveProvider = provider ?? new JsonRpcProvider(
      this.config.rpcUrl ?? 'https://mainnet.base.org',
      this.config.chainId ?? 8453,
      { staticNetwork: true },
    );

    const signer = this.getSigner(effectiveProvider);
    await signer.verifyConnection();
    return signer;
  }

  async disconnect(): Promise<void> {
    // No persistent connection in Chipotle -- this is a no-op
    // Kept for interface compatibility with LitWallet
    this._signer = null;
  }

  get address(): string {
    return this.config.walletAddress;
  }
}
