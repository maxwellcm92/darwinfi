/**
 * pool-registry.ts - Maps DarwinFi tokens to GeckoTerminal pool addresses on Base
 *
 * GeckoTerminal OHLCV endpoint:
 *   GET /api/v2/networks/base/pools/{pool}/ohlcv/minute?aggregate={1|5|15}&limit=1000
 *   GET /api/v2/networks/base/pools/{pool}/ohlcv/hour?aggregate=1&limit=1000
 *
 * Rate limit: 30 req/min (free, no key required)
 */

export interface PoolInfo {
  symbol: string;
  poolAddress: string;          // Most liquid pool on Base
  pairName: string;             // e.g. "WETH/USDC"
  tokenAddress: string;         // Token contract address
  decimals: number;
}

export const GECKO_BASE_URL = 'https://api.geckoterminal.com/api/v2';
export const NETWORK = 'base';

export const POOL_REGISTRY: Record<string, PoolInfo> = {
  ETH: {
    symbol: 'ETH',
    poolAddress: '0x6c561b446416e1a00e8e93e221854d6ea4171372',
    pairName: 'WETH/USDC',
    tokenAddress: '0x4200000000000000000000000000000000000006',
    decimals: 18,
  },
  UNI: {
    symbol: 'UNI',
    poolAddress: '0xab365f161dd501473a1ff0d2ef0dce94e7398839',
    pairName: 'UNI/WETH',
    tokenAddress: '0xc3De830EA07524a0761646a6a4e4be0e114a3C83',
    decimals: 18,
  },
  wstETH: {
    symbol: 'wstETH',
    poolAddress: '0x861a2922be165a5bd41b1e482b49216b465e1b5f',
    pairName: 'wstETH/WETH',
    tokenAddress: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452',
    decimals: 18,
  },
  AERO: {
    symbol: 'AERO',
    poolAddress: '0x6cdcb1c4a4d1c3c6d054b27ac5b77e89eafb971d',
    pairName: 'AERO/WETH',
    tokenAddress: '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
    decimals: 18,
  },
  DEGEN: {
    symbol: 'DEGEN',
    poolAddress: '0xc9034c3e7f58003e6ae0c8438e7c8f4598d5acaa',
    pairName: 'DEGEN/WETH',
    tokenAddress: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed',
    decimals: 18,
  },
  BRETT: {
    symbol: 'BRETT',
    poolAddress: '0x4e829f8a5213c42535ab84aa40bd4adcce9cba02',
    pairName: 'BRETT/WETH',
    tokenAddress: '0x532f27101965dd16442E59d40670FaF5eBB142E4',
    decimals: 18,
  },
  VIRTUAL: {
    symbol: 'VIRTUAL',
    poolAddress: '0x3f0296bf652e19bca772ec3df08b32732f93014a',
    pairName: 'VIRTUAL/WETH',
    tokenAddress: '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b',
    decimals: 18,
  },
  HIGHER: {
    symbol: 'HIGHER',
    poolAddress: '0x87cadde19468283af8d610474ecbd19ed285f698',
    pairName: 'HIGHER/WETH',
    tokenAddress: '0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe',
    decimals: 18,
  },
};

export const ALL_TOKENS = Object.keys(POOL_REGISTRY);

/**
 * Build the OHLCV URL for a given token and resolution.
 *
 * GeckoTerminal uses:
 *   - /ohlcv/minute?aggregate=1   for 1m candles
 *   - /ohlcv/minute?aggregate=5   for 5m candles
 *   - /ohlcv/minute?aggregate=15  for 15m candles
 *   - /ohlcv/hour?aggregate=1     for 1h candles
 */
export function buildOhlcvUrl(
  token: string,
  resolution: '1m' | '5m' | '15m' | '1h',
  limit: number = 1000,
  beforeTimestamp?: number,
): string {
  const pool = POOL_REGISTRY[token];
  if (!pool) throw new Error(`Unknown token: ${token}`);

  let timeframe: string;
  let aggregate: number;

  switch (resolution) {
    case '1m':
      timeframe = 'minute';
      aggregate = 1;
      break;
    case '5m':
      timeframe = 'minute';
      aggregate = 5;
      break;
    case '15m':
      timeframe = 'minute';
      aggregate = 15;
      break;
    case '1h':
      timeframe = 'hour';
      aggregate = 1;
      break;
  }

  let url = `${GECKO_BASE_URL}/networks/${NETWORK}/pools/${pool.poolAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}`;
  if (beforeTimestamp) {
    url += `&before_timestamp=${beforeTimestamp}`;
  }
  return url;
}
