/**
 * DarwinFi Immune System - Thymus: API Exposure Scanner
 *
 * Checks Express API endpoints for:
 * - Private key patterns leaking in responses
 * - .env variable values exposed in API output
 * - Overly permissive CORS (Access-Control-Allow-Origin: *)
 * Scheduled at CHECK_INTERVALS.apiExposure (12h).
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { CheckResult } from '../types';
import { API_ENDPOINTS, DASHBOARD_PORT } from '../config';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const PRIVATE_KEY_HEX = /0x[a-fA-F0-9]{64}/;

interface ExposureFinding {
  endpoint: string;
  issue: string;
  detail: string;
}

function httpGet(urlPath: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { hostname: '127.0.0.1', port: DASHBOARD_PORT, path: urlPath, timeout: 5000 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function loadEnvValues(): string[] {
  const envPath = path.join(PROJECT_ROOT, '.env');
  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    const values: string[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      // Only check values that are non-trivial (skip short/generic ones)
      if (val.length >= 8) {
        values.push(val);
      }
    }
    return values;
  } catch {
    return [];
  }
}

export async function scanApiExposure(): Promise<CheckResult> {
  const start = Date.now();
  const findings: ExposureFinding[] = [];
  const envValues = loadEnvValues();
  let endpointsChecked = 0;

  for (const ep of API_ENDPOINTS) {
    try {
      const resp = await httpGet(ep.path);
      endpointsChecked++;

      // Check for private key patterns in response body
      if (PRIVATE_KEY_HEX.test(resp.body)) {
        findings.push({
          endpoint: ep.path,
          issue: 'private_key_leak',
          detail: 'Response contains potential private key (0x + 64 hex chars)',
        });
      }

      // Check for .env values in response body
      for (const val of envValues) {
        if (resp.body.includes(val)) {
          findings.push({
            endpoint: ep.path,
            issue: 'env_value_leak',
            detail: `Response contains .env value (length ${val.length})`,
          });
          break; // One finding per endpoint is enough
        }
      }

      // Check CORS wildcard
      const origin = resp.headers['access-control-allow-origin'];
      if (origin === '*') {
        findings.push({
          endpoint: ep.path,
          issue: 'cors_wildcard',
          detail: 'Access-Control-Allow-Origin is set to wildcard *',
        });
      }
    } catch {
      // Endpoint unreachable -- not a security issue, skip
    }
  }

  let severity: 'ok' | 'warning' | 'error' | 'critical' = 'ok';
  const hasKeyLeak = findings.some(f => f.issue === 'private_key_leak');
  const hasEnvLeak = findings.some(f => f.issue === 'env_value_leak');
  const hasCorsWildcard = findings.some(f => f.issue === 'cors_wildcard');

  if (hasKeyLeak) severity = 'critical';
  else if (hasEnvLeak) severity = 'error';
  else if (hasCorsWildcard) severity = 'warning';

  const message = findings.length === 0
    ? `${endpointsChecked} endpoints checked, no exposures found`
    : `${findings.length} exposure(s) found across ${endpointsChecked} endpoints`;

  return {
    checkId: 'api_exposure',
    category: 'security',
    severity,
    message,
    details: { findings, endpointsChecked, envValuesLoaded: envValues.length },
    timestamp: Date.now(),
    durationMs: Date.now() - start,
  };
}
