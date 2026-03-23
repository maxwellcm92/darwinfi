/**
 * DarwinFi Immune System - Vault Consistency Check (Membrane)
 *
 * Verifies: totalAssets() ~= USDC.balanceOf(vault) + totalBorrowed()
 * Uses direct ERC20 balanceOf call against USDC on Base mainnet.
 */

import { ethers, Contract } from 'ethers';
import { CheckResult } from '../types';
import { ContractClient } from '../../chain/contract-client';
import { getBaseClient } from '../../chain/base-client';
import { withRpcRetry } from './rpc-retry';

const USDC_BASE_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ERC20_BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'];

export async function checkVaultConsistency(): Promise<CheckResult> {
  const start = Date.now();

  try {
    return await withRpcRetry(async (client) => {
      if (!client.hasVaultV4()) {
        return {
          checkId: 'membrane.vault_consistency',
          category: 'membrane',
          severity: 'warning' as const,
          message: 'VaultV4 address not configured -- skipping vault consistency check',
          timestamp: Date.now(),
          durationMs: Date.now() - start,
        };
      }

      const vaultAddress = client.getVaultV4Address()!;
      const baseClient = getBaseClient();

      // Get USDC balance of the vault
      const usdcContract = new Contract(
        USDC_BASE_ADDRESS,
        ERC20_BALANCE_ABI,
        baseClient.provider,
      );

      const [totalAssets, totalBorrowed, vaultUsdcBalance] = await Promise.all([
        client.vaultV4TotalAssets(),
        client.vaultV4TotalBorrowed(),
        usdcContract.balanceOf(vaultAddress) as Promise<bigint>,
      ]);

      // totalAssets should equal vaultUsdcBalance + totalBorrowed
      const expectedTotalAssets = vaultUsdcBalance + totalBorrowed;
      const mismatch = totalAssets > expectedTotalAssets
        ? totalAssets - expectedTotalAssets
        : expectedTotalAssets - totalAssets;

      // Allow small rounding tolerance (1 USDC unit = 1e-6 USDC)
      // Use 1 as tolerance since USDC has 6 decimals
      const tolerance = 1n;

      if (mismatch > tolerance) {
        return {
          checkId: 'membrane.vault_consistency',
          category: 'membrane',
          severity: 'error' as const,
          message: `Vault accounting mismatch: totalAssets=${totalAssets}, but USDC.balance(${vaultUsdcBalance}) + borrowed(${totalBorrowed}) = ${expectedTotalAssets}`,
          details: {
            totalAssets: totalAssets.toString(),
            totalBorrowed: totalBorrowed.toString(),
            vaultUsdcBalance: vaultUsdcBalance.toString(),
            expectedTotalAssets: expectedTotalAssets.toString(),
            mismatch: mismatch.toString(),
          },
          timestamp: Date.now(),
          durationMs: Date.now() - start,
        };
      }

      return {
        checkId: 'membrane.vault_consistency',
        category: 'membrane',
        severity: 'ok' as const,
        message: `Vault accounting consistent: totalAssets=${totalAssets} == balance(${vaultUsdcBalance}) + borrowed(${totalBorrowed})`,
        details: {
          totalAssets: totalAssets.toString(),
          totalBorrowed: totalBorrowed.toString(),
          vaultUsdcBalance: vaultUsdcBalance.toString(),
          expectedTotalAssets: expectedTotalAssets.toString(),
          mismatch: mismatch.toString(),
        },
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      };
    });
  } catch (err: any) {
    return {
      checkId: 'membrane.vault_consistency',
      category: 'membrane',
      severity: 'error',
      message: `Vault consistency check failed after retries: ${err.message}`,
      details: { error: err.message, stack: err.stack },
      timestamp: Date.now(),
      durationMs: Date.now() - start,
    };
  }
}
