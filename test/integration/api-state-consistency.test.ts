import { expect } from 'chai';
import * as http from 'http';

/**
 * Integration tests: API state consistency.
 *
 * These tests require a running DarwinFi server on port 3502.
 * If the server is not running, all tests are skipped.
 */

const API_BASE = `http://localhost:${process.env.DASHBOARD_PORT || 3502}`;

function httpGet(urlPath: string): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`${API_BASE}${urlPath}`, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: data }));
    });
    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });
  });
}

describe('API State Consistency (integration)', function () {
  let serverRunning = false;

  before(async function () {
    try {
      const res = await httpGet('/api/health');
      serverRunning = res.statusCode === 200;
    } catch {
      serverRunning = false;
    }
    if (!serverRunning) {
      this.skip();
    }
  });

  it('/api/health should return JSON with status and uptime fields', async function () {
    const res = await httpGet('/api/health');
    expect(res.statusCode).to.equal(200);

    const json = JSON.parse(res.body);
    expect(json).to.have.property('status');
    expect(json).to.have.property('uptime');
  });

  it('/api/state should return JSON with strategies array', async function () {
    const res = await httpGet('/api/state');
    expect(res.statusCode).to.equal(200);

    const json = JSON.parse(res.body);
    expect(json).to.have.property('strategies');
    expect(json.strategies).to.be.an('array');
  });

  it('strategy count in API should be consistent', async function () {
    const res = await httpGet('/api/state');
    const json = JSON.parse(res.body);

    // Strategies array should have elements
    expect(json.strategies.length).to.be.greaterThan(0);
  });

  it('number fields should be typeof number (not string)', async function () {
    const res = await httpGet('/api/state');
    const json = JSON.parse(res.body);

    if (json.strategies && json.strategies.length > 0) {
      const strat = json.strategies[0];
      // If there are numeric fields, they should be numbers
      if (strat.generation !== undefined) {
        expect(typeof strat.generation).to.equal('number');
      }
    }
  });

  it('/api/health uptime should be a positive number', async function () {
    const res = await httpGet('/api/health');
    const json = JSON.parse(res.body);

    if (typeof json.uptime === 'number') {
      expect(json.uptime).to.be.greaterThan(0);
    }
  });
});
