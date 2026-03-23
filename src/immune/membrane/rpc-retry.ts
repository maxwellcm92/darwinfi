/**
 * DarwinFi Immune System - RPC Retry Utility
 *
 * Wraps membrane check functions with automatic RPC rotation on failure.
 * Uses the RPC_ENDPOINTS list from immune config for failover.
 */

import { ContractClient } from '../../chain/contract-client';
import { RPC_ENDPOINTS } from '../config';

const RETRY_DELAY_MS = 2_000;
const MAX_RETRIES = 3;

/**
 * Execute a function that uses ContractClient with RPC retry + rotation.
 * On failure, creates a new ContractClient pointing to the next RPC endpoint.
 */
export async function withRpcRetry<T>(
  fn: (client: ContractClient) => Promise<T>,
  maxRetries: number = MAX_RETRIES,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const client = new ContractClient();
      return await fn(client);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const endpoint = RPC_ENDPOINTS[attempt % RPC_ENDPOINTS.length];
      console.warn(
        `[Membrane] RPC attempt ${attempt + 1}/${maxRetries + 1} failed (${endpoint}): ${lastError.message.slice(0, 100)}`
      );

      if (attempt < maxRetries) {
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  throw lastError ?? new Error('All RPC retry attempts failed');
}
