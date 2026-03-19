/**
 * bridge-client.ts - Cross-chain USDC bridging via Across Protocol
 *
 * Enables Team 4 Frontier bots to concentrate capital on a specific chain
 * when a high-conviction opportunity arises. Only used for opportunistic
 * capital concentration -- not required for basic operation.
 */

import { ethers, Contract, JsonRpcProvider, Wallet } from 'ethers';

// -------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------

// Across Protocol SpokePool addresses per chain
const ACROSS_SPOKE_POOLS: Record<number, string> = {
  8453: '0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64',   // Base
  42161: '0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A',  // Arbitrum
  1: '0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5',       // Ethereum mainnet
};

// USDC addresses per chain
const USDC_ADDRESSES: Record<number, string> = {
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',   // Base USDC
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',  // Arbitrum USDC
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',       // Ethereum USDC
};

// -------------------------------------------------------------------
// ABIs (minimal, function-level)
// -------------------------------------------------------------------

const SPOKE_POOL_ABI = [
  'function depositV3(address depositor, address recipient, address inputToken, address outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, address exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes message) external payable',
];

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
];

const ACROSS_API_BASE = 'https://across.to/api';

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export interface BridgeRequest {
  fromChainId: number;
  toChainId: number;
  amount: bigint;           // USDC amount in 6 decimals
  recipient?: string;       // Defaults to signer address
  maxSlippageBps?: number;  // Default: 50 (0.5%)
}

export interface BridgeEstimate {
  fromChainId: number;
  toChainId: number;
  inputAmount: bigint;
  outputAmount: bigint;
  relayerFeePct: number;
  estimatedTimeSeconds: number;
}

export interface BridgeResult {
  txHash: string;
  fromChainId: number;
  toChainId: number;
  inputAmount: string;
  expectedOutputAmount: string;
  depositId?: number;
  timestamp: number;
  success: boolean;
  error?: string;
}

// -------------------------------------------------------------------
// BridgeClient
// -------------------------------------------------------------------

export class BridgeClient {
  private signers: Map<number, Wallet>;     // chainId -> Wallet
  private providers: Map<number, JsonRpcProvider>;

  constructor(providers: Map<number, JsonRpcProvider>, privateKey: string) {
    this.providers = providers;
    this.signers = new Map();
    for (const [chainId, provider] of providers) {
      this.signers.set(chainId, new Wallet(privateKey, provider));
    }
  }

  // ---------------------------------------------------------------
  // Fee estimation
  // ---------------------------------------------------------------

  /**
   * Get a fee estimate from the Across suggested-fees API.
   * Returns estimated output amount and relay fee percentage.
   */
  async estimateBridge(request: BridgeRequest): Promise<BridgeEstimate> {
    const { fromChainId, toChainId, amount } = request;

    this.validateChains(fromChainId, toChainId);

    const inputToken = USDC_ADDRESSES[fromChainId];
    const outputToken = USDC_ADDRESSES[toChainId];

    const url = `${ACROSS_API_BASE}/suggested-fees` +
      `?token=${inputToken}` +
      `&destinationChainId=${toChainId}` +
      `&amount=${amount.toString()}` +
      `&originChainId=${fromChainId}` +
      `&outputToken=${outputToken}`;

    const response = await fetch(url);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Across API error (${response.status}): ${body}`);
    }

    const data = await response.json() as {
      totalRelayFee?: { pct?: string };
      estimatedFillTimeSec?: number;
    };

    // totalRelayFee contains the combined LP + relayer fee
    const totalFeePct = Number(data.totalRelayFee?.pct ?? '0');
    const outputAmount = amount - (amount * BigInt(Math.ceil(totalFeePct))) / BigInt(1e18);

    return {
      fromChainId,
      toChainId,
      inputAmount: amount,
      outputAmount,
      relayerFeePct: totalFeePct / 1e16, // Convert from 1e18 basis to percentage
      estimatedTimeSeconds: data.estimatedFillTimeSec ?? 120,
    };
  }

  // ---------------------------------------------------------------
  // Bridge execution
  // ---------------------------------------------------------------

  /**
   * Execute a cross-chain USDC bridge via Across Protocol.
   *
   * Steps:
   *   1. Get fee estimate from Across API
   *   2. Approve USDC spend for the SpokePool
   *   3. Call depositV3 on the origin chain SpokePool
   */
  async bridge(request: BridgeRequest): Promise<BridgeResult> {
    const { fromChainId, toChainId, amount, maxSlippageBps = 50 } = request;

    this.validateChains(fromChainId, toChainId);

    const signer = this.signers.get(fromChainId);
    if (!signer) {
      throw new Error(`No signer configured for chain ${fromChainId}`);
    }

    const spokePoolAddr = ACROSS_SPOKE_POOLS[fromChainId];
    const inputToken = USDC_ADDRESSES[fromChainId];
    const outputToken = USDC_ADDRESSES[toChainId];
    const recipient = request.recipient ?? signer.address;

    try {
      // 1. Get fee estimate
      const estimate = await this.estimateBridge(request);

      // Apply slippage to minimum output
      const slippageAmount = (estimate.outputAmount * BigInt(maxSlippageBps)) / 10000n;
      const minOutputAmount = estimate.outputAmount - slippageAmount;

      console.log(
        `[BridgeClient] Bridging ${ethers.formatUnits(amount, 6)} USDC` +
        ` from chain ${fromChainId} -> ${toChainId}` +
        ` (fee: ${estimate.relayerFeePct.toFixed(4)}%,` +
        ` min output: ${ethers.formatUnits(minOutputAmount, 6)} USDC)`
      );

      // 2. Approve USDC for SpokePool
      await this.ensureApproval(fromChainId, spokePoolAddr, amount);

      // 3. Call depositV3 on SpokePool
      const spokePool = new Contract(spokePoolAddr, SPOKE_POOL_ABI, signer);

      const now = Math.floor(Date.now() / 1000);
      const fillDeadline = now + 21600;       // 6 hours to fill
      const exclusivityDeadline = 0;           // No exclusivity
      const exclusiveRelayer = ethers.ZeroAddress;

      const tx = await spokePool.depositV3(
        signer.address,         // depositor
        recipient,              // recipient on destination
        inputToken,             // input token (USDC on origin)
        outputToken,            // output token (USDC on destination)
        amount,                 // inputAmount
        minOutputAmount,        // outputAmount (minimum)
        toChainId,              // destinationChainId
        exclusiveRelayer,       // exclusiveRelayer
        now,                    // quoteTimestamp
        fillDeadline,           // fillDeadline
        exclusivityDeadline,    // exclusivityDeadline
        '0x',                   // message (empty)
      );

      const receipt = await tx.wait();

      console.log(`[BridgeClient] Bridge deposit tx: ${receipt.hash}`);

      return {
        txHash: receipt.hash,
        fromChainId,
        toChainId,
        inputAmount: ethers.formatUnits(amount, 6),
        expectedOutputAmount: ethers.formatUnits(minOutputAmount, 6),
        timestamp: now,
        success: true,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[BridgeClient] Bridge failed: ${msg}`);
      return {
        txHash: '',
        fromChainId,
        toChainId,
        inputAmount: ethers.formatUnits(amount, 6),
        expectedOutputAmount: '0',
        timestamp: Math.floor(Date.now() / 1000),
        success: false,
        error: msg,
      };
    }
  }

  // ---------------------------------------------------------------
  // Status check
  // ---------------------------------------------------------------

  /**
   * Check whether a bridge deposit has been filled on the destination chain.
   * Uses the Across status API.
   */
  async checkBridgeStatus(
    txHash: string,
    fromChainId: number
  ): Promise<'pending' | 'filled' | 'expired'> {
    const url = `${ACROSS_API_BASE}/deposit/status` +
      `?originChainId=${fromChainId}` +
      `&depositTxHash=${txHash}`;

    const response = await fetch(url);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Across status API error (${response.status}): ${body}`);
    }

    const data = await response.json() as { status?: string };
    const status = (data.status ?? '').toLowerCase();

    if (status === 'filled') return 'filled';
    if (status === 'expired') return 'expired';
    return 'pending';
  }

  // ---------------------------------------------------------------
  // Balance helpers
  // ---------------------------------------------------------------

  /**
   * Get USDC balance on a specific chain.
   */
  async getUsdcBalance(chainId: number): Promise<bigint> {
    const provider = this.providers.get(chainId);
    if (!provider) {
      throw new Error(`No provider configured for chain ${chainId}`);
    }

    const usdcAddr = USDC_ADDRESSES[chainId];
    if (!usdcAddr) {
      throw new Error(`No USDC address configured for chain ${chainId}`);
    }

    const signer = this.signers.get(chainId);
    if (!signer) {
      throw new Error(`No signer configured for chain ${chainId}`);
    }

    const token = new Contract(usdcAddr, ERC20_ABI, provider);
    return token.balanceOf(signer.address);
  }

  // ---------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------

  /**
   * Ensure the SpokePool has sufficient USDC approval. Only sends
   * an approval tx if the current allowance is less than the amount.
   */
  private async ensureApproval(
    chainId: number,
    spender: string,
    amount: bigint
  ): Promise<void> {
    const signer = this.signers.get(chainId)!;
    const usdcAddr = USDC_ADDRESSES[chainId];
    const token = new Contract(usdcAddr, ERC20_ABI, signer);

    const currentAllowance: bigint = await token.allowance(signer.address, spender);
    if (currentAllowance >= amount) {
      return; // Already approved
    }

    console.log(`[BridgeClient] Approving USDC for SpokePool on chain ${chainId}...`);
    const tx = await token.approve(spender, ethers.MaxUint256);
    await tx.wait();
  }

  /**
   * Validate that both chains are supported and different.
   */
  private validateChains(fromChainId: number, toChainId: number): void {
    if (fromChainId === toChainId) {
      throw new Error('Source and destination chains must be different');
    }
    if (!ACROSS_SPOKE_POOLS[fromChainId]) {
      throw new Error(`Unsupported origin chain: ${fromChainId}`);
    }
    if (!ACROSS_SPOKE_POOLS[toChainId]) {
      throw new Error(`Unsupported destination chain: ${toChainId}`);
    }
    if (!USDC_ADDRESSES[fromChainId]) {
      throw new Error(`No USDC address for chain: ${fromChainId}`);
    }
    if (!USDC_ADDRESSES[toChainId]) {
      throw new Error(`No USDC address for chain: ${toChainId}`);
    }
  }
}
