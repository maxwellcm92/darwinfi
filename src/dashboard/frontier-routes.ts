/**
 * DarwinFi Frontier Dashboard Routes
 *
 * Express API routes for Team 4 data. Runs on port 3503,
 * proxied by Caddy at /darwinfi/api/frontier/*.
 */

import express from 'express';
import type { FrontierAgent } from '../agent/frontier-agent';

export function startFrontierDashboard(port: number, agent: FrontierAgent): void {
  const app = express();

  // CORS for DApp requests
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
  });

  // ---------------------------------------------------------------
  // Strategy endpoints
  // ---------------------------------------------------------------

  app.get('/api/frontier/strategies', (_req, res) => {
    res.json(agent.getStrategies());
  });

  app.get('/api/frontier/trades', (req, res) => {
    const limit = parseInt(req.query.limit as string || '50', 10);
    res.json(agent.getRecentTrades(limit));
  });

  // ---------------------------------------------------------------
  // Chain endpoints
  // ---------------------------------------------------------------

  app.get('/api/frontier/chains', (_req, res) => {
    res.json(agent.getChainStates());
  });

  // ---------------------------------------------------------------
  // Bot-specific endpoints
  // ---------------------------------------------------------------

  // Abiogenesis: token discoveries
  app.get('/api/frontier/abiogenesis/discoveries', (_req, res) => {
    res.json(agent.getDiscoveries());
  });

  // Mitosis: spread opportunities
  app.get('/api/frontier/mitosis/spreads', (_req, res) => {
    res.json(agent.getSpreads());
  });

  // Cambrian: volatility events
  app.get('/api/frontier/cambrian/volatility', (_req, res) => {
    res.json(agent.getVolatility());
  });

  // Symbiont: whale registry and activity
  app.get('/api/frontier/symbiont/whales', (_req, res) => {
    res.json({
      topWhales: agent.getWhales(),
      recentActivity: agent.getWhaleActivity(),
    });
  });

  // ---------------------------------------------------------------
  // Competition endpoints
  // ---------------------------------------------------------------

  app.get('/api/frontier/competition', (_req, res) => {
    res.json({
      rankings: agent.getInternalCompetition(),
      teamWinner: agent.getTeamWinner(),
    });
  });

  app.get('/api/championship', (_req, res) => {
    // Championship data will be populated by the championship module
    res.json({
      teamWinner: agent.getTeamWinner(),
      frontierRankings: agent.getInternalCompetition(),
    });
  });

  // ---------------------------------------------------------------
  // System endpoints
  // ---------------------------------------------------------------

  app.get('/api/frontier/health', (_req, res) => {
    res.json({
      status: 'running',
      uptime: agent.getUptime(),
      dryRun: agent.isDryRun(),
      bots: agent.getStrategies().length,
      circuitBreakers: agent.getCircuitBreakerStates(),
    });
  });

  app.get('/api/frontier/log', (req, res) => {
    const limit = parseInt(req.query.limit as string || '100', 10);
    res.json(agent.getConversationLog(limit));
  });

  // ---------------------------------------------------------------
  // Aggregate state (full snapshot)
  // ---------------------------------------------------------------

  app.get('/api/frontier/state', (_req, res) => {
    res.json({
      strategies: agent.getStrategies(),
      chains: agent.getChainStates(),
      competition: {
        rankings: agent.getInternalCompetition(),
        teamWinner: agent.getTeamWinner(),
      },
      spreads: agent.getSpreads(),
      volatility: agent.getVolatility(),
      whales: {
        topWhales: agent.getWhales(),
        recentActivity: agent.getWhaleActivity(),
      },
      uptime: agent.getUptime(),
      dryRun: agent.isDryRun(),
    });
  });

  app.listen(port, () => {
    console.log(`[Frontier] Dashboard running at http://localhost:${port}`);
  });
}
