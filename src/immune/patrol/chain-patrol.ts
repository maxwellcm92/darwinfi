/**
 * DarwinFi Immune System - Chain Patrol
 *
 * Verifies RPC reachability, block staleness, and contract read calls
 * against the Base mainnet.
 */

import { ethers } from 'ethers';
import { CheckResult } from '../types';
import { THRESHOLDS } from '../config';
import { ContractClient } from '../../chain/contract-client';

export async function checkChainHealth(): Promise<CheckResult> {
  const start = Date.now();
  const rpcUrl = process.env.BASE_RPC_URL;

  if (!rpcUrl) {
    return {
      checkId: 'chain_health',
      category: 'chain',
      severity: 'critical',
      message: 'BASE_RPC_URL not set',
      timestamp: Date.now(),
      durationMs: Date.now() - start,
    };
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const issues: string[] = [];
    const details: Record<string, unknown> = { rpcUrl };

    // Check block number reachability
    const blockNumber = await provider.getBlockNumber();
    details.blockNumber = blockNumber;

    // Check block staleness
    const block = await provider.getBlock('latest');
    if (block) {
      const ageSec = Math.floor(Date.now() / 1000) - block.timestamp;
      details.blockAgeSec = ageSec;
      if (ageSec > THRESHOLDS.maxBlockStalenessS) {
        issues.push(`block stale ${ageSec}s>${THRESHOLDS.maxBlockStalenessS}s`);
      }
    } else {
      issues.push('could not fetch latest block');
    }

    // Contract view call check (totalAssets on VaultV2)
    try {
      const client = new ContractClient();
      const totalAssets = await client.vaultV2TotalAssets();
      details.vaultV2TotalAssets = totalAssets.toString();
    } catch (contractErr) {
      const msg = contractErr instanceof Error ? contractErr.message : String(contractErr);
      issues.push(`vaultV2 read failed: ${msg.slice(0, 100)}`);
    }

    if (issues.length === 0) {
      return {
        checkId: 'chain_health',
        category: 'chain',
        severity: 'ok',
        message: `RPC ok, block #${blockNumber}`,
        timestamp: Date.now(),
        durationMs: Date.now() - start,
        details,
      };
    }

    return {
      checkId: 'chain_health',
      category: 'chain',
      severity: 'error',
      message: issues.join('; '),
      timestamp: Date.now(),
      durationMs: Date.now() - start,
      details,
    };
  } catch (err) {
    return {
      checkId: 'chain_health',
      category: 'chain',
      severity: 'critical',
      message: `RPC unreachable: ${err instanceof Error ? err.message : err}`,
      timestamp: Date.now(),
      durationMs: Date.now() - start,
      details: { rpcUrl },
    };
  }
}
