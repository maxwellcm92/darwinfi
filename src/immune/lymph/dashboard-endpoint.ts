/**
 * DarwinFi Immune System - Dashboard Endpoint (Lymph Division)
 *
 * Registers Express routes for immune system monitoring.
 * All routes are read-only, serving data from disk files.
 */

import express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { IMMUNE_FILES } from '../config';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const PREFIX = '[Immune:Lymph]';

function readJsonFile(relativePath: string): any {
  const fullPath = path.join(PROJECT_ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
  } catch (err) {
    console.warn(`${PREFIX} Failed to read ${relativePath}:`, err);
    return null;
  }
}

export function registerImmuneRoutes(app: express.Express): void {
  // Health summary from immune-state.json
  app.get('/api/immune/status', (_req, res) => {
    const state = readJsonFile(IMMUNE_FILES.state);
    res.json(state || { status: 'not initialized' });
  });

  // Active alerts (severity >= warning, last 24h)
  app.get('/api/immune/alerts', (_req, res) => {
    const state = readJsonFile(IMMUNE_FILES.state);
    if (!state) return res.json([]);

    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const allAlerts: any[] = state.activeAlerts || [];
    const filtered = allAlerts.filter(
      (a: any) =>
        a.severity !== 'info' &&
        a.createdAt >= cutoff,
    );
    res.json(filtered);
  });

  // Fix history (last 100 entries)
  app.get('/api/immune/fixes', (_req, res) => {
    const history = readJsonFile(IMMUNE_FILES.fixHistory);
    const fixes = Array.isArray(history) ? history.slice(-100) : [];
    res.json(fixes);
  });

  // Latest antibody test results
  app.get('/api/immune/test-results', (_req, res) => {
    const dir = path.join(PROJECT_ROOT, IMMUNE_FILES.antibodyResults);
    if (!fs.existsSync(dir)) {
      return res.json({ message: 'No test results yet' });
    }

    const files = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort();

    if (files.length === 0) {
      return res.json({ message: 'No test results yet' });
    }

    try {
      const latestPath = path.join(dir, files[files.length - 1]);
      const latest = JSON.parse(fs.readFileSync(latestPath, 'utf-8'));
      res.json(latest);
    } catch (err) {
      console.warn(`${PREFIX} Failed to read test results:`, err);
      res.json({ message: 'Failed to read test results' });
    }
  });

  // Genome state (self-evolution data)
  app.get('/api/immune/genome', (_req, res) => {
    const genome = readJsonFile(IMMUNE_FILES.genome);
    res.json(genome || { status: 'not initialized' });
  });

  console.log(`${PREFIX} Dashboard routes registered: /api/immune/{status,alerts,fixes,test-results,genome}`);
}
