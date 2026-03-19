#!/usr/bin/env node
/**
 * DarwinFi - Fund Wallet via Kraken API
 *
 * Withdraws ETH + USDC from Kraken to the DarwinFi wallet on Base.
 * Reuses KrakenClient from the Money Model bot.
 *
 * Usage: node scripts/fund-wallet.js
 */

const path = require('path');
const { KrakenClient } = require(path.resolve(__dirname, '../../_system/apps/build-a-bot-api/live/kraken-client.js'));

const DARWIN_WALLET = '0xb2db53Db9a2349186F0214BC3e1bF08a195570e3';
const ETH_AMOUNT = '0.01';
const USDC_AMOUNT = '75';

async function main() {
  const kraken = new KrakenClient({
    apiKey: 'UFwCYKymm0TyF4rh9k5jGYSkEBGX0S8qkKvXHogWqspBQoiwPboEWd55',
    apiSecret: 'C6XEmpJuoArLTPO0sSXPFVcacPE7j8XI9H4a26YU/MrHvk/4It7NAI95MggXBP4OfN7Uh2NMuhf9ceApRqFMOw==',
  });

  console.log('=== DarwinFi Wallet Funder ===');
  console.log(`Target wallet: ${DARWIN_WALLET}`);
  console.log();

  // Step 1: Check balances
  console.log('--- Step 1: Checking Kraken balances ---');
  try {
    const balances = await kraken.getBalance();
    const ethBalance = parseFloat(balances['XETH'] || balances['ETH'] || '0');
    const usdcBalance = parseFloat(balances['USDC'] || '0');
    console.log(`  ETH:  ${ethBalance}`);
    console.log(`  USDC: ${usdcBalance}`);

    if (ethBalance < parseFloat(ETH_AMOUNT)) {
      console.error(`  ERROR: Insufficient ETH. Need ${ETH_AMOUNT}, have ${ethBalance}`);
      process.exit(1);
    }
    if (usdcBalance < parseFloat(USDC_AMOUNT)) {
      console.error(`  ERROR: Insufficient USDC. Need ${USDC_AMOUNT}, have ${usdcBalance}`);
      process.exit(1);
    }
    console.log('  Sufficient balances confirmed.');
    console.log();
  } catch (err) {
    console.error('  Failed to get balances:', err.message);
    process.exit(1);
  }

  // Step 2: Query withdrawal methods
  console.log('--- Step 2: Querying withdrawal methods ---');
  try {
    // Check ETH withdrawal methods
    const ethMethods = await kraken.rest('POST', '/0/private/WithdrawMethods', { asset: 'ETH' });
    console.log('  ETH withdrawal methods:');
    for (const m of ethMethods) {
      console.log(`    - ${m.method} (network: ${m.network || 'default'}, fee: ${m.fee || 'N/A'})`);
    }

    const usdcMethods = await kraken.rest('POST', '/0/private/WithdrawMethods', { asset: 'USDC' });
    console.log('  USDC withdrawal methods:');
    for (const m of usdcMethods) {
      console.log(`    - ${m.method} (network: ${m.network || 'default'}, fee: ${m.fee || 'N/A'})`);
    }
    console.log();
  } catch (err) {
    console.error('  Failed to get withdrawal methods:', err.message);
    console.log('  Continuing to attempt withdrawal...');
    console.log();
  }

  // Step 3: Check existing withdrawal addresses
  console.log('--- Step 3: Checking withdrawal addresses ---');
  try {
    const ethAddresses = await kraken.rest('POST', '/0/private/WithdrawAddresses', { asset: 'ETH' });
    console.log('  ETH withdrawal addresses:');
    if (ethAddresses && ethAddresses.length > 0) {
      for (const a of ethAddresses) {
        console.log(`    - "${a.method}" -> ${a.address} (verified: ${a.verified})`);
      }
    } else {
      console.log('    (none configured)');
    }

    const usdcAddresses = await kraken.rest('POST', '/0/private/WithdrawAddresses', { asset: 'USDC' });
    console.log('  USDC withdrawal addresses:');
    if (usdcAddresses && usdcAddresses.length > 0) {
      for (const a of usdcAddresses) {
        console.log(`    - "${a.method}" -> ${a.address} (verified: ${a.verified})`);
      }
    } else {
      console.log('    (none configured)');
    }
    console.log();
  } catch (err) {
    console.error('  Failed to get withdrawal addresses:', err.message);
    console.log();
  }

  // Step 4: Attempt ETH withdrawal (Base network)
  console.log('--- Step 4: Withdrawing ETH ---');
  try {
    // Try Base network withdrawal
    // Kraken uses "key" (pre-configured address name) for withdrawals
    // If no pre-configured key exists, we need to use WithdrawAddresses to find one
    // or tell the user to add one in the Kraken UI
    const result = await kraken.rest('POST', '/0/private/Withdraw', {
      asset: 'ETH',
      key: 'DarwinFi Base',  // This needs to be pre-configured in Kraken
      amount: ETH_AMOUNT,
    });
    console.log('  ETH withdrawal submitted:', JSON.stringify(result));
  } catch (err) {
    if (err.message.includes('Unknown withdraw key')) {
      console.log('  ETH withdrawal address not configured in Kraken.');
      console.log();
      console.log('  === MANUAL SETUP REQUIRED ===');
      console.log('  Go to https://www.kraken.com/u/funding/withdraw');
      console.log('  1. Select "Ether (ETH)"');
      console.log('  2. Click "Add address"');
      console.log('  3. Set description: "DarwinFi Base"');
      console.log(`  4. Enter address: ${DARWIN_WALLET}`);
      console.log('  5. Select network: "Base" (or "Arbitrum One" as fallback)');
      console.log(`  6. Amount: ${ETH_AMOUNT} ETH`);
      console.log('  7. After adding + confirming via email, re-run this script');
      console.log();
    } else {
      console.error('  ETH withdrawal failed:', err.message);
    }
  }

  // Step 5: Attempt USDC withdrawal (Base network)
  console.log('--- Step 5: Withdrawing USDC ---');
  try {
    const result = await kraken.rest('POST', '/0/private/Withdraw', {
      asset: 'USDC',
      key: 'DarwinFi Base USDC',  // Pre-configured address name
      amount: USDC_AMOUNT,
    });
    console.log('  USDC withdrawal submitted:', JSON.stringify(result));
  } catch (err) {
    if (err.message.includes('Unknown withdraw key')) {
      console.log('  USDC withdrawal address not configured in Kraken.');
      console.log();
      console.log('  === MANUAL SETUP REQUIRED ===');
      console.log('  Go to https://www.kraken.com/u/funding/withdraw');
      console.log('  1. Select "USD Coin (USDC)"');
      console.log('  2. Click "Add address"');
      console.log('  3. Set description: "DarwinFi Base USDC"');
      console.log(`  4. Enter address: ${DARWIN_WALLET}`);
      console.log('  5. Select network: "Base"');
      console.log(`  6. Amount: ${USDC_AMOUNT} USDC`);
      console.log('  7. After adding + confirming via email, re-run this script');
      console.log();
    } else {
      console.error('  USDC withdrawal failed:', err.message);
    }
  }

  console.log('=== Done ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
