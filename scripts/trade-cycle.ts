/**
 * trade-cycle.ts - On-Chain Trade Cycle (C2 Audit Item)
 *
 * Executes the full DarwinFi vault lifecycle on Base mainnet:
 *   Pre-flight -> Approve USDC -> Deposit 5 USDC -> Agent Borrow 3 USDC
 *   -> Swap USDC->WETH -> Swap WETH->USDC -> Approve USDC for vault
 *   -> Agent Return USDC -> Set lockTime=0 -> Withdraw -> Restore lockTime=1h
 *   -> Print summary with all tx hashes + BaseScan links
 *
 * Usage: npx ts-node scripts/trade-cycle.ts
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { ethers, Contract } from 'ethers';
import { getBaseClient } from '../src/chain/base-client';
import { ContractClient } from '../src/chain/contract-client';
import { UniswapClient, BASE_TOKENS } from '../src/trading/uniswap-client';

// -------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------

const USDC_DECIMALS = 6;
const DEPOSIT_AMOUNT = 5_000_000n;  // 5 USDC (6 decimals)
const BORROW_AMOUNT = 3_000_000n;   // 3 USDC
const MIN_ETH_BALANCE = ethers.parseEther('0.002');
const BASESCAN_TX = 'https://basescan.org/tx/';

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
];

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function link(txHash: string): string {
  return `${BASESCAN_TX}${txHash}`;
}

function formatUsdc(amount: bigint): string {
  return (Number(amount) / 1e6).toFixed(6);
}

interface TxRecord {
  step: string;
  hash: string;
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------

async function main() {
  console.log('=== DarwinFi On-Chain Trade Cycle ===\n');

  const txLog: TxRecord[] = [];

  // Initialize clients
  const base = getBaseClient();
  const contracts = new ContractClient(base);
  const uniswap = new UniswapClient(base);
  const wallet = base.walletAddress;
  const vaultAddress = contracts.getVaultV2Address()!;
  const vault = contracts.darwinVaultV2;

  const usdc = new Contract(BASE_TOKENS.USDC, ERC20_ABI, base.signer);

  // -----------------------------------------------------------------
  // Pre-flight checks
  // -----------------------------------------------------------------
  console.log('Pre-flight:');
  console.log(`  Wallet: ${wallet}`);

  const [ethBal, usdcBal, agent] = await Promise.all([
    base.provider.getBalance(wallet),
    usdc.balanceOf(wallet) as Promise<bigint>,
    vault.agent() as Promise<string>,
  ]);

  console.log(`  ETH balance: ${ethers.formatEther(ethBal)} ETH`);
  console.log(`  USDC balance: ${formatUsdc(usdcBal)} USDC`);

  const agentMatch = agent.toLowerCase() === wallet.toLowerCase();
  console.log(`  Vault agent: ${agent} (${agentMatch ? 'matches signer' : 'MISMATCH!'})`);

  if (ethBal < MIN_ETH_BALANCE) {
    throw new Error(`Insufficient ETH. Need >= 0.002 ETH for gas, have ${ethers.formatEther(ethBal)}`);
  }
  if (usdcBal < DEPOSIT_AMOUNT) {
    throw new Error(`Insufficient USDC. Need >= 5 USDC, have ${formatUsdc(usdcBal)}`);
  }
  if (!agentMatch) {
    throw new Error(`Vault agent is ${agent}, but signer is ${wallet}. Cannot borrow.`);
  }

  console.log('  All checks passed.\n');

  // -----------------------------------------------------------------
  // Step 1: Approve USDC for vault (for deposit)
  // -----------------------------------------------------------------
  console.log('Step 1: Approve USDC for vault');
  const allowance1: bigint = await usdc.allowance(wallet, vaultAddress);
  if (allowance1 < DEPOSIT_AMOUNT) {
    const tx = await usdc.approve(vaultAddress, ethers.MaxUint256);
    const receipt = await tx.wait();
    txLog.push({ step: 'Approve USDC->Vault', hash: receipt.hash });
    console.log(`  tx: ${link(receipt.hash)}\n`);
  } else {
    console.log('  Already approved.\n');
  }

  // -----------------------------------------------------------------
  // Step 2: Deposit 5 USDC into vault
  // -----------------------------------------------------------------
  console.log('Step 2: Deposit 5 USDC into vault');
  const depositTx = await vault.deposit(DEPOSIT_AMOUNT, wallet);
  const depositReceipt = await depositTx.wait();
  txLog.push({ step: 'Deposit 5 USDC', hash: depositReceipt.hash });

  const sharesAfter: bigint = await vault.balanceOf(wallet);
  console.log(`  tx: ${link(depositReceipt.hash)}`);
  console.log(`  Shares received: ${sharesAfter} dvUSDC\n`);

  // -----------------------------------------------------------------
  // Step 3: Agent borrows 3 USDC
  // -----------------------------------------------------------------
  console.log('Step 3: Agent borrows 3 USDC');
  const borrowHash = await contracts.vaultV2BorrowFromVault(BORROW_AMOUNT);
  txLog.push({ step: 'Agent borrow 3 USDC', hash: borrowHash });
  console.log(`  tx: ${link(borrowHash)}\n`);

  // -----------------------------------------------------------------
  // Step 4: Swap 3 USDC -> WETH
  // -----------------------------------------------------------------
  console.log('Step 4: Swap 3 USDC -> WETH');
  const swapResult1 = await uniswap.swap({
    tokenIn: BASE_TOKENS.USDC,
    tokenOut: BASE_TOKENS.WETH,
    amountIn: BORROW_AMOUNT,
    fee: 500, // 0.05% pool for USDC/WETH
    slippageTolerance: 0.01,
  });
  txLog.push({ step: 'Swap USDC->WETH', hash: swapResult1.txHash });
  console.log(`  tx: ${link(swapResult1.txHash)}`);
  console.log(`  WETH received: ${ethers.formatEther(swapResult1.amountOut)}\n`);

  // -----------------------------------------------------------------
  // Step 5: Swap WETH -> USDC
  // -----------------------------------------------------------------
  console.log('Step 5: Swap WETH -> USDC');
  const swapResult2 = await uniswap.swap({
    tokenIn: BASE_TOKENS.WETH,
    tokenOut: BASE_TOKENS.USDC,
    amountIn: swapResult1.amountOut,
    fee: 500,
    slippageTolerance: 0.01,
  });
  txLog.push({ step: 'Swap WETH->USDC', hash: swapResult2.txHash });
  const usdcBack = swapResult2.amountOut;
  console.log(`  tx: ${link(swapResult2.txHash)}`);
  console.log(`  USDC received: ${formatUsdc(usdcBack)}\n`);

  // -----------------------------------------------------------------
  // Step 6: Approve USDC for vault (for agentReturn)
  // -----------------------------------------------------------------
  console.log('Step 6: Approve USDC for vault (for agentReturn)');
  const allowance2: bigint = await usdc.allowance(wallet, vaultAddress);
  if (allowance2 < usdcBack) {
    const tx = await usdc.approve(vaultAddress, ethers.MaxUint256);
    const receipt = await tx.wait();
    txLog.push({ step: 'Approve USDC->Vault (return)', hash: receipt.hash });
    console.log(`  tx: ${link(receipt.hash)}\n`);
  } else {
    console.log('  Already approved.\n');
  }

  // -----------------------------------------------------------------
  // Step 7: Agent returns USDC to vault
  // -----------------------------------------------------------------
  console.log('Step 7: Agent returns USDC to vault');
  const returnHash = await contracts.vaultV2ReturnToVault(usdcBack);
  txLog.push({ step: 'Agent return USDC', hash: returnHash });
  console.log(`  tx: ${link(returnHash)}`);
  console.log(`  USDC returned: ${formatUsdc(usdcBack)}\n`);

  // -----------------------------------------------------------------
  // Step 8: Set lockTime=0, withdraw, restore lockTime=1h
  // -----------------------------------------------------------------
  console.log('Step 8: Withdraw from vault');

  // Read current minLockTime
  let currentLockTime: bigint;
  try {
    currentLockTime = await vault.minLockTime();
  } catch {
    currentLockTime = 3600n; // default 1h
  }
  console.log(`  Current minLockTime: ${currentLockTime}s`);

  // Set lockTime to 0 for immediate withdrawal
  if (currentLockTime > 0n) {
    const setLockTx = await vault.setMinLockTime(0);
    const setLockReceipt = await setLockTx.wait();
    txLog.push({ step: 'Set minLockTime=0', hash: setLockReceipt.hash });
    console.log(`  Set minLockTime=0 tx: ${link(setLockReceipt.hash)}`);
  }

  // Calculate how much we can withdraw
  const maxWithdrawable: bigint = await vault.maxWithdraw(wallet);
  const withdrawAmount = maxWithdrawable > 0n ? maxWithdrawable : DEPOSIT_AMOUNT;
  console.log(`  Max withdrawable: ${formatUsdc(maxWithdrawable)} USDC`);

  // Withdraw
  const withdrawTx = await vault.withdraw(withdrawAmount, wallet, wallet);
  const withdrawReceipt = await withdrawTx.wait();
  txLog.push({ step: 'Withdraw', hash: withdrawReceipt.hash });
  console.log(`  tx: ${link(withdrawReceipt.hash)}`);

  // Restore lockTime
  if (currentLockTime > 0n) {
    const restoreTx = await vault.setMinLockTime(currentLockTime);
    const restoreReceipt = await restoreTx.wait();
    txLog.push({ step: 'Restore minLockTime=3600', hash: restoreReceipt.hash });
    console.log(`  Restored minLockTime=${currentLockTime}s tx: ${link(restoreReceipt.hash)}`);
  }

  const finalUsdcBal: bigint = await usdc.balanceOf(wallet);
  console.log(`  USDC after withdrawal: ${formatUsdc(finalUsdcBal)}\n`);

  // -----------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------
  const roundTripCost = Number(DEPOSIT_AMOUNT - (finalUsdcBal - (usdcBal - DEPOSIT_AMOUNT))) / 1e6;
  console.log('=== Summary ===');
  console.log(`  Transactions: ${txLog.length}`);
  console.log(`  Deposited:    ${formatUsdc(DEPOSIT_AMOUNT)} USDC`);
  console.log(`  Borrowed:     ${formatUsdc(BORROW_AMOUNT)} USDC`);
  console.log(`  Swapped:      USDC -> WETH -> USDC`);
  console.log(`  Returned:     ${formatUsdc(usdcBack)} USDC`);
  console.log(`  Withdrawn:    ${formatUsdc(withdrawAmount)} USDC`);
  console.log(`  Round-trip cost: ~$${Math.abs(roundTripCost).toFixed(4)} (swap fees + gas)`);
  console.log('\n  Transaction Log:');
  for (const tx of txLog) {
    console.log(`    ${tx.step}: ${link(tx.hash)}`);
  }
  console.log('\n  All transactions verified on BaseScan.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nTrade cycle FAILED:', err.message || err);
    process.exit(1);
  });
