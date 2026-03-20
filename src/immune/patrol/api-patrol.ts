/**
 * DarwinFi Immune System - API Patrol
 *
 * HTTP probes against local API endpoints. Checks status code,
 * JSON validity, and response latency.
 */

import * as http from 'http';
import { CheckResult } from '../types';
import { API_ENDPOINTS, DASHBOARD_PORT, THRESHOLDS } from '../config';

interface ProbeResult {
  name: string;
  path: string;
  ok: boolean;
  statusCode?: number;
  responseMs: number;
  error?: string;
}

function probeEndpoint(ep: { path: string; name: string }): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), THRESHOLDS.apiTimeoutMs);

    const req = http.get(
      { hostname: '127.0.0.1', port: DASHBOARD_PORT, path: ep.path, signal: ac.signal },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          clearTimeout(timer);
          const responseMs = Date.now() - start;
          // Verify JSON parseable
          try {
            JSON.parse(body);
          } catch {
            resolve({ name: ep.name, path: ep.path, ok: false, statusCode: res.statusCode, responseMs, error: 'invalid JSON response' });
            return;
          }
          const ok = res.statusCode === 200 && responseMs < THRESHOLDS.apiTimeoutMs;
          resolve({
            name: ep.name,
            path: ep.path,
            ok,
            statusCode: res.statusCode,
            responseMs,
            ...(res.statusCode !== 200 && { error: `status=${res.statusCode}` }),
          });
        });
      }
    );

    req.on('error', (err: Error) => {
      clearTimeout(timer);
      const responseMs = Date.now() - start;
      const error = err.name === 'AbortError' ? 'timeout' : err.message;
      resolve({ name: ep.name, path: ep.path, ok: false, responseMs, error });
    });
  });
}

export async function checkApiEndpoints(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const results = await Promise.all(API_ENDPOINTS.map(probeEndpoint));
    const failures = results.filter((r) => !r.ok);

    if (failures.length === 0) {
      const avgMs = results.reduce((s, r) => s + r.responseMs, 0) / results.length;
      return {
        checkId: 'api_probe',
        category: 'api',
        severity: 'ok',
        message: `All ${results.length} endpoints healthy, avg ${avgMs.toFixed(0)}ms`,
        timestamp: Date.now(),
        durationMs: Date.now() - start,
        details: { endpoints: results },
      };
    }

    const severity = failures.length === results.length ? 'critical' : 'error';
    const failNames = failures.map((f) => `${f.name}(${f.error})`).join(', ');
    return {
      checkId: 'api_probe',
      category: 'api',
      severity,
      message: `${failures.length}/${results.length} endpoints failed: ${failNames}`,
      timestamp: Date.now(),
      durationMs: Date.now() - start,
      details: { endpoints: results },
    };
  } catch (err) {
    return {
      checkId: 'api_probe',
      category: 'api',
      severity: 'critical',
      message: `API probe failed: ${err instanceof Error ? err.message : err}`,
      timestamp: Date.now(),
      durationMs: Date.now() - start,
    };
  }
}
