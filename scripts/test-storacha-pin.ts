/**
 * test-storacha-pin.ts - Test IPFS genome pinning via Storacha
 *
 * Tries two approaches:
 *   1. Storacha CLI (`storacha up`) -- uses local agent with full space access
 *   2. FilecoinStore SDK -- uses UCAN delegation proof from .env
 *
 * Usage: npx ts-node scripts/test-storacha-pin.ts
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { FilecoinStore } from '../src/integrations/filecoin';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

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

async function tryCliUpload(): Promise<string | null> {
  console.log('[Test] Approach 1: storacha CLI upload...');

  const payload = JSON.stringify({
    strategyId: 'main-alpha',
    generation: 0,
    timestamp: new Date().toISOString(),
    genome,
  }, null, 2);

  const tmpFile = '/tmp/darwinfi-main-alpha-gen0.json';
  fs.writeFileSync(tmpFile, payload);

  try {
    const output = execSync(`storacha up ${tmpFile} --json 2>&1`, {
      encoding: 'utf-8',
      timeout: 30000,
    });
    // Parse CID from JSON output
    const parsed = JSON.parse(output);
    const cid = parsed.root?.toString() || parsed.toString();
    return cid;
  } catch (err: any) {
    const stderr = err.stderr || err.stdout || err.message || '';
    if (stderr.includes('no storage provider') || stderr.includes('InsufficientStorage')) {
      console.error('[Test] CLI upload failed: No billing plan active.');
      console.error('[Test] ACTION REQUIRED: Go to https://console.storacha.network');
      console.error('[Test]   1. Sign in as maxwell.morgan@creativesolarusa.com');
      console.error('[Test]   2. Select the free "Mild" plan ($0/mo, 5GB)');
      console.error('[Test]   3. Complete Stripe checkout (credit card required)');
      console.error('[Test]   4. Re-run this script');
    } else if (stderr.includes('Unauthorized') || stderr.includes('not authorized')) {
      console.error('[Test] CLI upload failed: Authorization error.');
      console.error('[Test] Detail:', stderr.substring(0, 300));
    } else {
      console.error('[Test] CLI upload failed:', stderr.substring(0, 500));
    }
    return null;
  }
}

async function trySdkUpload(): Promise<string | null> {
  console.log('[Test] Approach 2: FilecoinStore SDK upload...');

  const proof = process.env.STORACHA_PROOF;
  if (!proof) {
    console.error('[Test] STORACHA_PROOF is not set in .env -- skipping SDK approach');
    return null;
  }
  console.log(`[Test] STORACHA_PROOF loaded (${proof.length} chars)`);

  const store = new FilecoinStore(proof, './data');
  const cid = await store.pinGenome(genome, 'main-alpha', 0);

  if (cid.startsWith('local:')) {
    console.error(`[Test] SDK upload fell back to local storage: ${cid}`);
    return null;
  }

  return cid;
}

async function main() {
  console.log('[Test] Genome payload:', JSON.stringify(genome, null, 2));

  // Try CLI first (has full space access), then SDK
  let cid = await tryCliUpload();
  if (!cid) {
    cid = await trySdkUpload();
  }

  if (!cid) {
    console.error('\n[Test] BOTH APPROACHES FAILED.');
    console.error('[Test] Most likely cause: Storacha billing plan not activated.');
    console.error('[Test] The free Mild plan ($0/mo) works -- just needs a credit card on file.');
    console.error('[Test] URL: https://console.storacha.network');
    process.exit(1);
  }

  console.log(`\n[Test] SUCCESS! CID: ${cid}`);
  console.log(`[Test] Gateway URL: https://w3s.link/ipfs/${cid}`);

  // Verify ipfs-history.json
  const historyPath = path.join('./data', 'ipfs-history.json');
  if (fs.existsSync(historyPath)) {
    const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    console.log(`[Test] ipfs-history.json has ${history.length} entry(ies)`);
    console.log('[Test] Latest entry:', JSON.stringify(history[history.length - 1], null, 2));
  } else {
    console.log('[Test] Note: ipfs-history.json not created (CLI upload bypasses FilecoinStore history)');
  }
}

main().catch((err) => {
  console.error('[Test] Fatal error:', err);
  process.exit(1);
});
