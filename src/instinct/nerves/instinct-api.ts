/**
 * instinct-api.ts - Express routes for /api/instinct/*
 *
 * Endpoints:
 *   GET /api/instinct/state          - Full InstinctState
 *   GET /api/instinct/predictions/:token - Predictions for a token
 *   GET /api/instinct/sources        - Source configs + fitness
 *   GET /api/instinct/strategies     - Prediction strategy configs
 *   GET /api/instinct/history/:token/:resolution - Historical predictions
 *   GET /api/instinct/events         - Recent world events
 */

import { Router, Request, Response } from 'express';
import { StateWriter } from './state-writer';
import { SourceManager } from '../senses/source-manager';
import { PredictionEngine } from '../reflexes/prediction-engine';
import { EventStore } from '../data/event-store';
import { Scorer } from '../cortex/scorer';
import { WeightOptimizer } from '../cortex/weight-optimizer';
import { Resolution } from '../types';

export function createInstinctRouter(
  sourceManager: SourceManager,
  predictionEngine: PredictionEngine,
  eventStore: EventStore,
  scorer: Scorer,
  weightOptimizer: WeightOptimizer,
): Router {
  const router = Router();

  // GET /api/instinct/state - Full InstinctState (from predictions-live.json)
  router.get('/state', (_req: Request, res: Response) => {
    const state = StateWriter.readState();
    if (!state) {
      return res.json({ error: 'Instinct not yet initialized', generatedAt: 0, tokens: {}, health: null });
    }
    res.json(state);
  });

  // GET /api/instinct/predictions/:token - Latest predictions for a token
  router.get('/predictions/:token', (req: Request, res: Response) => {
    const token = String(req.params.token);
    const resolution = (String(req.query.resolution || '5m')) as Resolution;
    const limit = Math.min(100, parseInt(String(req.query.limit || '20')));

    const predictions = predictionEngine.getRecentPredictions(token, resolution, limit);
    res.json({
      token,
      resolution,
      count: predictions.length,
      predictions,
    });
  });

  // GET /api/instinct/sources - All source configs with fitness
  router.get('/sources', (_req: Request, res: Response) => {
    const sources = sourceManager.getAllSources();
    const ranked = scorer.rankSources(sources);
    res.json({
      count: sources.length,
      active: sources.filter(s => s.status === 'active').length,
      sources: ranked.map(r => ({
        ...r.source,
        compositeScore: r.score,
        rank: r.rank,
      })),
    });
  });

  // GET /api/instinct/strategies - All prediction strategy configs
  router.get('/strategies', (_req: Request, res: Response) => {
    const strategies = predictionEngine.getAllStrategies();
    const ranked = scorer.rankStrategies(strategies);
    res.json({
      count: strategies.length,
      active: strategies.filter(s => s.status === 'active').length,
      strategies: ranked.map(r => ({
        ...r.strategy,
        compositeScore: r.score,
        rank: r.rank,
      })),
    });
  });

  // GET /api/instinct/history/:token/:resolution - Historical predictions
  router.get('/history/:token/:resolution', (req: Request, res: Response) => {
    const token = String(req.params.token);
    const resolution = String(req.params.resolution);
    const limit = Math.min(200, parseInt(String(req.query.limit || '50')));

    const validResolutions = ['1m', '5m', '15m', '1h'];
    if (!validResolutions.includes(resolution)) {
      return res.status(400).json({ error: `Invalid resolution. Use: ${validResolutions.join(', ')}` });
    }

    const predictions = predictionEngine.getRecentPredictions(
      token, resolution as Resolution, limit,
    );

    // Compute accuracy stats
    const graded = predictions.filter(p => p.actual);
    const correct = graded.filter(p => p.actual!.directionCorrect).length;

    res.json({
      token,
      resolution,
      total: predictions.length,
      graded: graded.length,
      directionAccuracy: graded.length > 0 ? correct / graded.length : null,
      predictions,
    });
  });

  // GET /api/instinct/events - Recent world events
  router.get('/events', (req: Request, res: Response) => {
    const minutes = Math.min(1440, parseInt(String(req.query.minutes || '60')));
    const token = req.query.token ? String(req.query.token) : undefined;

    const events = eventStore.getRecentEvents(minutes, token);

    res.json({
      count: events.length,
      lookbackMinutes: minutes,
      token: token || 'all',
      events: events.slice(-100), // Cap at 100
    });
  });

  // GET /api/instinct/weights - Current scoring weights + history
  router.get('/weights', (_req: Request, res: Response) => {
    res.json({
      source: scorer.getSourceWeights(),
      prediction: scorer.getPredictionWeights(),
      history: weightOptimizer.getWeightHistory(10),
    });
  });

  return router;
}
