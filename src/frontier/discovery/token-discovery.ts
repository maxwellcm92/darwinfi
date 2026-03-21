/**
 * token-discovery.ts - New token pair discovery service
 *
 * For the Abiogenesis bot. Monitors PairCreated / PoolCreated events on
 * DEX factory contracts, plus polls DexScreener and GeckoTerminal APIs
 * for newly listed tokens. Emits 'new_token' events via EventEmitter.
 */

import { EventEmitter } from 'events';
import { ethers, Contract, JsonRpcProvider } from 'ethers';
import { FrontierError, FrontierErrorCodes, wrapError } from '../../types/errors';

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export interface NewTokenEvent {
  chainId: number;
  chainName: string;
  pairAddress: string;
  token0: string;
  token1: string;
  factoryAddress: string;
  timestamp: number;
  source: 'on_chain' | 'dexscreener' | 'geckoterminal';
}

// -------------------------------------------------------------------
// Factory addresses for PairCreated monitoring
// -------------------------------------------------------------------

const DEX_FACTORIES: Record<number, Array<{ name: string; address: string; abi: string[] }>> = {
  8453: [
    {
      name: 'Uniswap V3',
      address: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
      abi: [
        'event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)',
      ],
    },
  ],
  42161: [
    {
      name: 'Uniswap V3',
      address: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
      abi: [
        'event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)',
      ],
    },
    {
      name: 'Camelot V3',
      address: '0xd8E2F8b6Db204c405543955A6E2E6e708e0a5b67',
      abi: [
        'event Pool(address indexed token0, address indexed token1, address pool)',
      ],
    },
  ],
};

const CHAIN_NAMES: Record<number, string> = {
  8453: 'Base',
  42161: 'Arbitrum',
};

const GECKO_NETWORK_MAP: Record<number, string> = {
  8453: 'base',
  42161: 'arbitrum',
};

// -------------------------------------------------------------------
// TokenDiscovery
// -------------------------------------------------------------------

export class TokenDiscovery extends EventEmitter {
  private providers: Map<number, JsonRpcProvider>;
  private contractListeners: Array<Contract> = [];
  private running = false;
  private pollIntervalMs: number;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private seenPairs: Set<string> = new Set(); // deduplicate across sources

  constructor(providers: Map<number, JsonRpcProvider>, pollIntervalMs = 30_000) {
    super();
    this.providers = providers;
    this.pollIntervalMs = pollIntervalMs;
  }

  // ---------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;

    this.setupOnChainListeners();

    // Start API polling loop
    this.pollTimer = setInterval(async () => {
      try {
        await Promise.all([
          this.pollDexScreener(),
          this.pollGeckoTerminal(),
        ]);
      } catch (err) {
        const wrapped = wrapError(err, FrontierError, FrontierErrorCodes.DISCOVERY_FAILED, 'Poll cycle failed');
        console.error('[TokenDiscovery] Poll error:', wrapped.code, wrapped.message);
      }
    }, this.pollIntervalMs);

    console.log(
      `[TokenDiscovery] Started. On-chain listeners: ${this.contractListeners.length}, ` +
      `API poll interval: ${this.pollIntervalMs}ms`
    );
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    // Remove all on-chain listeners
    for (const contract of this.contractListeners) {
      contract.removeAllListeners();
    }
    this.contractListeners = [];

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    console.log('[TokenDiscovery] Stopped.');
  }

  // ---------------------------------------------------------------
  // On-chain event listeners
  // ---------------------------------------------------------------

  private setupOnChainListeners(): void {
    for (const [chainId, factories] of Object.entries(DEX_FACTORIES)) {
      const cid = Number(chainId);
      const provider = this.providers.get(cid);
      if (!provider) continue;

      for (const factory of factories) {
        const contract = new Contract(factory.address, factory.abi, provider);

        // Uniswap V3 style: PoolCreated
        if (factory.abi[0].includes('PoolCreated')) {
          contract.on('PoolCreated', (token0: string, token1: string, _fee: number, _tickSpacing: number, pool: string) => {
            this.handleNewPair({
              chainId: cid,
              chainName: CHAIN_NAMES[cid] ?? `Chain ${cid}`,
              pairAddress: pool,
              token0,
              token1,
              factoryAddress: factory.address,
              timestamp: Date.now(),
              source: 'on_chain',
            });
          });
        }

        // Camelot style: Pool(token0, token1, pool)
        if (factory.abi[0].includes('event Pool(')) {
          contract.on('Pool', (token0: string, token1: string, pool: string) => {
            this.handleNewPair({
              chainId: cid,
              chainName: CHAIN_NAMES[cid] ?? `Chain ${cid}`,
              pairAddress: pool,
              token0,
              token1,
              factoryAddress: factory.address,
              timestamp: Date.now(),
              source: 'on_chain',
            });
          });
        }

        this.contractListeners.push(contract);
      }
    }
  }

  // ---------------------------------------------------------------
  // API polling
  // ---------------------------------------------------------------

  private async pollDexScreener(): Promise<void> {
    try {
      const resp = await fetch('https://api.dexscreener.com/token-profiles/latest/v1');
      if (!resp.ok) return;

      const data = await resp.json() as Array<{
        chainId: string;
        tokenAddress: string;
        description?: string;
        links?: Array<{ type: string; label?: string; url: string }>;
      }>;

      if (!Array.isArray(data)) return;

      for (const profile of data) {
        // Map DexScreener chainId strings to our numeric IDs
        const chainId = profile.chainId === 'base' ? 8453
          : profile.chainId === 'arbitrum' ? 42161
          : null;
        if (!chainId) continue;

        this.handleNewPair({
          chainId,
          chainName: CHAIN_NAMES[chainId] ?? `Chain ${chainId}`,
          pairAddress: profile.tokenAddress, // token address as identifier
          token0: profile.tokenAddress,
          token1: '', // unknown from this API
          factoryAddress: '',
          timestamp: Date.now(),
          source: 'dexscreener',
        });
      }
    } catch (err) {
      const wrapped = wrapError(err, FrontierError, FrontierErrorCodes.API_ERROR, 'DexScreener poll failed');
      console.error('[TokenDiscovery] DexScreener poll error:', wrapped.code, wrapped.message);
    }
  }

  private async pollGeckoTerminal(): Promise<void> {
    const chainIds = [...this.providers.keys()];

    for (const chainId of chainIds) {
      const network = GECKO_NETWORK_MAP[chainId];
      if (!network) continue;

      try {
        const url = `https://api.geckoterminal.com/api/v2/networks/${network}/new_pools?page=1`;
        const resp = await fetch(url, {
          headers: { Accept: 'application/json' },
        });
        if (!resp.ok) continue;

        const json = await resp.json() as {
          data?: Array<{
            id: string;
            attributes: {
              address: string;
              name: string;
              pool_created_at?: string;
            };
            relationships?: {
              base_token?: { data?: { id: string } };
              quote_token?: { data?: { id: string } };
            };
          }>;
        };

        if (!json.data) continue;

        for (const pool of json.data) {
          const baseTokenId = pool.relationships?.base_token?.data?.id ?? '';
          const quoteTokenId = pool.relationships?.quote_token?.data?.id ?? '';
          // GeckoTerminal token IDs are formatted as "network_address"
          const token0 = baseTokenId.includes('_') ? baseTokenId.split('_')[1] : baseTokenId;
          const token1 = quoteTokenId.includes('_') ? quoteTokenId.split('_')[1] : quoteTokenId;

          this.handleNewPair({
            chainId,
            chainName: CHAIN_NAMES[chainId] ?? `Chain ${chainId}`,
            pairAddress: pool.attributes.address,
            token0: token0 ?? '',
            token1: token1 ?? '',
            factoryAddress: '',
            timestamp: pool.attributes.pool_created_at
              ? new Date(pool.attributes.pool_created_at).getTime()
              : Date.now(),
            source: 'geckoterminal',
          });
        }
      } catch (err) {
        const wrapped = wrapError(err, FrontierError, FrontierErrorCodes.API_ERROR, `GeckoTerminal poll failed (chain ${chainId})`);
        console.error('[TokenDiscovery] GeckoTerminal poll error:', wrapped.code, wrapped.message);
      }
    }
  }

  // ---------------------------------------------------------------
  // Deduplicate & emit
  // ---------------------------------------------------------------

  private handleNewPair(event: NewTokenEvent): void {
    const key = `${event.chainId}:${event.pairAddress.toLowerCase()}`;
    if (this.seenPairs.has(key)) return;
    this.seenPairs.add(key);

    // Cap seen set size to prevent unbounded growth
    if (this.seenPairs.size > 50_000) {
      const entries = [...this.seenPairs];
      this.seenPairs = new Set(entries.slice(entries.length - 25_000));
    }

    this.emit('new_token', event);
  }
}
