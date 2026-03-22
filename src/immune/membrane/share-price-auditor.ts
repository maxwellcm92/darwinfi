/**
 * DarwinFi Immune System - Share Price Auditor (Membrane)
 *
 * Compares the on-chain sharePrice() return value against an independent
 * calculation: totalAssets * 1e6 / totalSupply. Mismatch > 1 wei = error.
 */

import { CheckResult } from '../types';
import { THRESHOLDS } from '../config';
import { ContractClient } from '../../chain/contract-client';

export async function auditSharePrice(): Promise<CheckResult> {
  const start = Date.now();

  try {
    const client = new ContractClient();

    if (!client.hasVaultV4()) {
      return {
        checkId: 'membrane.share_price_auditor',
        category: 'membrane',
        severity: 'warning',
        message: 'VaultV4 address not configured -- skipping share price audit',
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      };
    }

    const [totalAssets, totalSupply, sharePrice] = await Promise.all([
      client.vaultV4TotalAssets(),
      client.vaultV4TotalSupply(),
      client.vaultV4SharePrice(),
    ]);

    // V4 uses 12-decimal shares (6 USDC + 6 offset), so sharePrice base is 1e12
    // If totalSupply is 0, sharePrice should be 1e12 (1:1 ratio)
    let expectedSharePrice: bigint;
    if (totalSupply === 0n) {
      expectedSharePrice = 1_000_000_000_000n;
    } else {
      // sharePrice = totalAssets * 1e12 / totalSupply
      expectedSharePrice = (totalAssets * 1_000_000_000_000n) / totalSupply;
    }

    const mismatch = sharePrice > expectedSharePrice
      ? sharePrice - expectedSharePrice
      : expectedSharePrice - sharePrice;

    if (mismatch > THRESHOLDS.sharePriceMismatchWei) {
      return {
        checkId: 'membrane.share_price_auditor',
        category: 'membrane',
        severity: 'error',
        message: `Share price mismatch: on-chain=${sharePrice}, expected=${expectedSharePrice}, delta=${mismatch} wei`,
        details: {
          totalAssets: totalAssets.toString(),
          totalSupply: totalSupply.toString(),
          sharePrice: sharePrice.toString(),
          expectedSharePrice: expectedSharePrice.toString(),
          mismatchWei: mismatch.toString(),
        },
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      };
    }

    return {
      checkId: 'membrane.share_price_auditor',
      category: 'membrane',
      severity: 'ok',
      message: `Share price verified: ${sharePrice} (assets=${totalAssets}, supply=${totalSupply})`,
      details: {
        totalAssets: totalAssets.toString(),
        totalSupply: totalSupply.toString(),
        sharePrice: sharePrice.toString(),
        expectedSharePrice: expectedSharePrice.toString(),
        mismatchWei: mismatch.toString(),
      },
      timestamp: Date.now(),
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      checkId: 'membrane.share_price_auditor',
      category: 'membrane',
      severity: 'error',
      message: `Share price audit failed: ${err.message}`,
      details: { error: err.message, stack: err.stack },
      timestamp: Date.now(),
      durationMs: Date.now() - start,
    };
  }
}
