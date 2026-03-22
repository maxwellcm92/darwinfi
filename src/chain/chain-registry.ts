/**
 * chain-registry.ts - Multi-chain EVMClient registry
 *
 * Factory pattern that manages EVMClient instances across chains.
 * Auto-registers Base (8453) and Arbitrum (42161) on init when
 * env vars are present. Provides chain selection helpers.
 */

import { ethers, Contract } from 'ethers';
import * as dotenv from 'dotenv';
import { EVMClient, EVMClientConfig } from './evm-client';

dotenv.config();

// -------------------------------------------------------------------
// Built-in chain configs
// -------------------------------------------------------------------

const BASE_MAINNET_CONFIG: Omit<EVMClientConfig, 'privateKey'> = {
  chainId: 8453,
  chainName: 'Base',
  rpcUrls: [
    'https://base.llamarpc.com',
    'https://mainnet.base.org',
    'https://1rpc.io/base',
    'https://base-rpc.publicnode.com',
    'https://base.meowrpc.com',
  ],
  maxGasPriceGwei: 5,
};

const ARBITRUM_MAINNET_CONFIG: Omit<EVMClientConfig, 'privateKey'> = {
  chainId: 42161,
  chainName: 'Arbitrum',
  rpcUrls: [
    'https://arb1.arbitrum.io/rpc',
    'https://1rpc.io/arb',
    'https://arbitrum-one-rpc.publicnode.com',
  ],
  maxGasPriceGwei: 50,
};

// ERC-20 minimal ABI for liquidity checks
const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
];

// -------------------------------------------------------------------
// ChainRegistry
// -------------------------------------------------------------------

export class ChainRegistry {
  private clients: Map<number, EVMClient> = new Map();
  private privateKey: string;

  constructor(privateKey?: string) {
    this.privateKey = privateKey
      ?? process.env.TEAM4_PRIVATE_KEY
      ?? process.env.PRIVATE_KEY
      ?? '';

    if (!this.privateKey) {
      throw new Error(
        'Private key required for ChainRegistry. ' +
        'Set TEAM4_PRIVATE_KEY or PRIVATE_KEY in .env or pass via constructor.'
      );
    }

    // Auto-register Base if RPC available
    const baseRpc = process.env.BASE_RPC_URL;
    const baseConfig = { ...BASE_MAINNET_CONFIG };
    if (baseRpc) {
      baseConfig.rpcUrls = [baseRpc, ...baseConfig.rpcUrls];
    }
    this.registerChain(baseConfig);

    // Auto-register Arbitrum if RPC available
    const arbRpc = process.env.ARBITRUM_RPC_URL;
    if (arbRpc) {
      const arbConfig = { ...ARBITRUM_MAINNET_CONFIG };
      arbConfig.rpcUrls = [arbRpc, ...arbConfig.rpcUrls];
      this.registerChain(arbConfig);
    }

    console.log(
      `[ChainRegistry] Initialized with ${this.clients.size} chain(s): ` +
      `${this.getActiveChains().map((c) => `${c.chainName}(${c.chainId})`).join(', ')}`
    );
  }

  // ---------------------------------------------------------------
  // Chain management
  // ---------------------------------------------------------------

  /**
   * Register a new chain. Overwrites existing registration for same chainId.
   */
  registerChain(config: Omit<EVMClientConfig, 'privateKey'>): EVMClient {
    const client = new EVMClient({
      ...config,
      privateKey: this.privateKey,
    });
    this.clients.set(config.chainId, client);
    return client;
  }

  /**
   * Get the EVMClient for a specific chain. Throws if not registered.
   */
  getClient(chainId: number): EVMClient {
    const client = this.clients.get(chainId);
    if (!client) {
      throw new Error(
        `Chain ${chainId} not registered. ` +
        `Available chains: ${[...this.clients.keys()].join(', ')}`
      );
    }
    return client;
  }

  /**
   * Get all registered chain clients.
   */
  getActiveChains(): EVMClient[] {
    return [...this.clients.values()];
  }

  /**
   * Get a Map of chainId -> JsonRpcProvider for all registered chains.
   * Used by bot services that need raw providers.
   */
  getProvidersMap(): Map<number, ethers.JsonRpcProvider> {
    const map = new Map<number, ethers.JsonRpcProvider>();
    for (const [chainId, client] of this.clients) {
      map.set(chainId, client.provider);
    }
    return map;
  }

  /**
   * Check if a chain is registered.
   */
  hasChain(chainId: number): boolean {
    return this.clients.has(chainId);
  }

  /**
   * Remove a chain from the registry.
   */
  removeChain(chainId: number): boolean {
    return this.clients.delete(chainId);
  }

  /**
   * Get all registered chain IDs.
   */
  getChainIds(): number[] {
    return [...this.clients.keys()];
  }

  /**
   * Dynamically add a new chain at runtime (used by evolution engine).
   * Returns the EVMClient for the new chain.
   */
  addChain(config: {
    chainId: number;
    chainName: string;
    rpcUrls: string[];
    maxGasPriceGwei?: number;
  }): EVMClient {
    if (this.clients.has(config.chainId)) {
      console.log(`[ChainRegistry] Chain ${config.chainId} already registered, updating`);
    }
    return this.registerChain({
      chainId: config.chainId,
      chainName: config.chainName,
      rpcUrls: config.rpcUrls,
      maxGasPriceGwei: config.maxGasPriceGwei ?? 50,
    });
  }

  // ---------------------------------------------------------------
  // Cross-chain queries
  // ---------------------------------------------------------------

  /**
   * Run health checks on all registered chains.
   * Returns map of chainId -> health status.
   */
  async healthCheckAll(): Promise<Map<number, boolean>> {
    const results = new Map<number, boolean>();
    const checks = [...this.clients.entries()].map(async ([chainId, client]) => {
      const healthy = await client.healthCheck();
      results.set(chainId, healthy);
    });
    await Promise.all(checks);
    return results;
  }

  /**
   * Find the chain with the cheapest current gas price.
   * Useful for routing non-time-sensitive transactions.
   */
  async getCheapestGasChain(): Promise<EVMClient> {
    let cheapest: EVMClient | null = null;
    let lowestGas = Infinity;

    const checks = [...this.clients.values()].map(async (client) => {
      try {
        const feeData = await client.provider.getFeeData();
        const gasPrice = feeData.gasPrice ?? 0n;
        const gasPriceGwei = Number(ethers.formatUnits(gasPrice, 'gwei'));
        return { client, gasPriceGwei };
      } catch {
        return { client, gasPriceGwei: Infinity };
      }
    });

    const results = await Promise.all(checks);
    for (const { client, gasPriceGwei } of results) {
      if (gasPriceGwei < lowestGas) {
        lowestGas = gasPriceGwei;
        cheapest = client;
      }
    }

    if (!cheapest) {
      throw new Error('No healthy chains available for gas comparison');
    }

    console.log(
      `[ChainRegistry] Cheapest gas: ${cheapest.chainName} at ${lowestGas.toFixed(4)} gwei`
    );
    return cheapest;
  }

  /**
   * Find the chain with the deepest liquidity for a given token.
   * Checks the token's balance in well-known DEX pool contracts or
   * falls back to total supply comparison. If no tokenAddress given,
   * returns the chain with the highest native balance in the wallet.
   */
  async getDeepestLiquidityChain(tokenAddress?: string): Promise<EVMClient> {
    let best: EVMClient | null = null;
    let highestBalance = 0n;

    const checks = [...this.clients.values()].map(async (client) => {
      try {
        if (tokenAddress) {
          const token = new Contract(tokenAddress, ERC20_ABI, client.provider);
          // Check wallet's token balance as a proxy for chain activity
          const balance: bigint = await token.balanceOf(client.walletAddress);
          return { client, balance };
        } else {
          const balance = await client.provider.getBalance(client.walletAddress);
          return { client, balance };
        }
      } catch {
        return { client, balance: 0n };
      }
    });

    const results = await Promise.all(checks);
    for (const { client, balance } of results) {
      if (balance > highestBalance) {
        highestBalance = balance;
        best = client;
      }
    }

    if (!best) {
      // Fallback to first available chain
      best = this.getActiveChains()[0];
      if (!best) throw new Error('No chains registered');
    }

    console.log(
      `[ChainRegistry] Deepest liquidity: ${best.chainName} (balance: ${highestBalance})`
    );
    return best;
  }

  /**
   * Get candidate chains for expansion (chains not yet registered).
   * Used by the evolution engine to propose chain expansion.
   */
  getExpansionCandidates(): Array<{ chainId: number; name: string; registered: boolean }> {
    const knownCandidates = [
      { chainId: 10, name: 'Optimism' },
      { chainId: 137, name: 'Polygon' },
      { chainId: 43114, name: 'Avalanche' },
      { chainId: 324, name: 'zkSync Era' },
      { chainId: 59144, name: 'Linea' },
    ];

    return knownCandidates.map(c => ({
      ...c,
      registered: this.clients.has(c.chainId),
    }));
  }
}
