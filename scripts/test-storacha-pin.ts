/**
 * test-storacha-pin.ts - Test IPFS genome pinning via Storacha
 *
 * Pins a realistic strategy genome to IPFS using FilecoinStore,
 * verifies the CID, and prints a gateway URL for confirmation.
 *
 * Usage: npx ts-node scripts/test-storacha-pin.ts
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { FilecoinStore } from '../src/integrations/filecoin';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const proof = process.env.STORACHA_PROOF;
  if (!proof) {
    console.error('STORACHA_PROOF is not set in .env');
    process.exit(1);
  }
  console.log(`[Test] STORACHA_PROOF loaded (${proof.length} chars)`);

  // Realistic genome matching StrategyGenome.parameters shape
  const genome = {
    entryMethod: 'rsi_oversold',
    entryThreshold: 30,
    exitMethod: 'trailing_stop',
    trailingStopPct: 8,
    takeProfitPct: 25,
    timeframe: '5m',
    indicators: ['rsi_14', 'ema_20', 'volume_sma_20'],
    riskPerTradePct: 2,
    maxPositions: 3,
    tokenPreferences: ['ETH', 'wstETH', 'DEGEN', 'BRETT'],
    instinctWeight: 0.6,
  };

  console.log('[Test] Genome payload:', JSON.stringify(genome, null, 2));

  const store = new FilecoinStore(proof, './data');

  console.log('[Test] Pinning genome to IPFS...');
  const cid = await store.pinGenome(genome, 'main-alpha', 0);

  if (cid.startsWith('local:')) {
    console.error(`[Test] FAILED: Got local fallback instead of IPFS CID: ${cid}`);
    process.exit(1);
  }

  console.log(`[Test] SUCCESS! CID: ${cid}`);
  console.log(`[Test] Gateway URL: https://w3s.link/ipfs/${cid}`);

  // Verify ipfs-history.json
  const historyPath = path.join('./data', 'ipfs-history.json');
  if (fs.existsSync(historyPath)) {
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    console.log(`[Test] ipfs-history.json has ${history.length} entry(ies)`);
    console.log('[Test] Latest entry:', JSON.stringify(history[history.length - 1], null, 2));
  } else {
    console.error('[Test] WARNING: ipfs-history.json was not created');
  }
}

main().catch((err) => {
  console.error('[Test] Fatal error:', err);
  process.exit(1);
});
