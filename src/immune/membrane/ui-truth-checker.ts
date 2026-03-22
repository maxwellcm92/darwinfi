/**
 * DarwinFi Immune System - UI Truth Checker (Membrane)
 *
 * Fetches /api/vault from the dashboard and compares each DApp-visible
 * value (tvl, totalShares, sharePrice, totalBorrowed) against direct
 * contract reads. Any mismatch = error.
 */

import { ethers } from 'ethers';
import { CheckResult } from '../types';
import { DASHBOARD_PORT } from '../config';
import { ContractClient } from '../../chain/contract-client';

interface VaultApiResponse {
  tvl: string;
  totalShares: string;
  sharePrice: string;
  totalBorrowed: string;
  [key: string]: unknown;
}

interface FieldMismatch {
  field: string;
  apiValue: string;
  chainValue: string;
  apiParsed: string;
  chainParsed: string;
}

function parseToBigInt(value: string, decimals: number = 6): bigint {
  try {
    return ethers.parseUnits(value, decimals);
  } catch {
    // If parseUnits fails, try direct BigInt parse (already in raw units)
    try {
      return BigInt(value);
    } catch {
      return 0n;
    }
  }
}

export async function checkUiTruth(): Promise<CheckResult> {
  const start = Date.now();
  const mismatches: FieldMismatch[] = [];

  try {
    const client = new ContractClient();

    if (!client.hasVaultV4()) {
      return {
        checkId: 'membrane.ui_truth_checker',
        category: 'membrane',
        severity: 'warning',
        message: 'VaultV4 address not configured -- skipping UI truth check',
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      };
    }

    // Fetch API response
    const url = `http://localhost:${DASHBOARD_PORT}/api/vault`;
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });

    if (!response.ok) {
      return {
        checkId: 'membrane.ui_truth_checker',
        category: 'membrane',
        severity: 'error',
        message: `Dashboard /api/vault returned HTTP ${response.status}`,
        details: { statusCode: response.status },
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      };
    }

    const apiData = await response.json() as VaultApiResponse;

    // Get on-chain values (V4 vault)
    const [totalAssets, totalSupply, sharePrice, totalBorrowed] = await Promise.all([
      client.vaultV4TotalAssets(),
      client.vaultV4TotalSupply(),
      client.vaultV4SharePrice(),
      client.vaultV4TotalBorrowed(),
    ]);

    // Compare tvl (totalAssets)
    if (apiData.tvl !== undefined) {
      const apiTvl = parseToBigInt(apiData.tvl);
      // Allow 1 wei tolerance for rounding
      const tvlDiff = apiTvl > totalAssets ? apiTvl - totalAssets : totalAssets - apiTvl;
      if (tvlDiff > 1n) {
        mismatches.push({
          field: 'tvl',
          apiValue: apiData.tvl,
          chainValue: totalAssets.toString(),
          apiParsed: apiTvl.toString(),
          chainParsed: totalAssets.toString(),
        });
      }
    }

    // Compare totalShares (totalSupply)
    if (apiData.totalShares !== undefined) {
      const apiShares = parseToBigInt(apiData.totalShares);
      const sharesDiff = apiShares > totalSupply ? apiShares - totalSupply : totalSupply - apiShares;
      if (sharesDiff > 1n) {
        mismatches.push({
          field: 'totalShares',
          apiValue: apiData.totalShares,
          chainValue: totalSupply.toString(),
          apiParsed: apiShares.toString(),
          chainParsed: totalSupply.toString(),
        });
      }
    }

    // Compare sharePrice
    if (apiData.sharePrice !== undefined) {
      const apiPrice = parseToBigInt(apiData.sharePrice);
      const priceDiff = apiPrice > sharePrice ? apiPrice - sharePrice : sharePrice - apiPrice;
      if (priceDiff > 1n) {
        mismatches.push({
          field: 'sharePrice',
          apiValue: apiData.sharePrice,
          chainValue: sharePrice.toString(),
          apiParsed: apiPrice.toString(),
          chainParsed: sharePrice.toString(),
        });
      }
    }

    // Compare totalBorrowed
    if (apiData.totalBorrowed !== undefined) {
      const apiBorrowed = parseToBigInt(apiData.totalBorrowed);
      const borrowDiff = apiBorrowed > totalBorrowed ? apiBorrowed - totalBorrowed : totalBorrowed - apiBorrowed;
      if (borrowDiff > 1n) {
        mismatches.push({
          field: 'totalBorrowed',
          apiValue: apiData.totalBorrowed,
          chainValue: totalBorrowed.toString(),
          apiParsed: apiBorrowed.toString(),
          chainParsed: totalBorrowed.toString(),
        });
      }
    }

    if (mismatches.length > 0) {
      return {
        checkId: 'membrane.ui_truth_checker',
        category: 'membrane',
        severity: 'error',
        message: `${mismatches.length} UI-to-chain mismatch(es) detected`,
        details: { mismatches },
        timestamp: Date.now(),
        durationMs: Date.now() - start,
      };
    }

    return {
      checkId: 'membrane.ui_truth_checker',
      category: 'membrane',
      severity: 'ok',
      message: 'All DApp-visible values match on-chain state',
      details: {
        tvl: totalAssets.toString(),
        totalShares: totalSupply.toString(),
        sharePrice: sharePrice.toString(),
        totalBorrowed: totalBorrowed.toString(),
      },
      timestamp: Date.now(),
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      checkId: 'membrane.ui_truth_checker',
      category: 'membrane',
      severity: 'error',
      message: `UI truth check failed: ${err.message}`,
      details: { error: err.message, stack: err.stack },
      timestamp: Date.now(),
      durationMs: Date.now() - start,
    };
  }
}
