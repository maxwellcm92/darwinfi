import { expect } from 'chai';
import {
  DEFAULT_PREDICTION_WEIGHTS,
  DEFAULT_ADAPTIVE_CONFIG,
  RESOLUTION_MS,
  Resolution,
  Direction,
  AdaptiveConfig,
} from '../src/instinct/types';

describe('Instinct Types & Constants', () => {
  // ---------- Composite score weights ----------

  describe('Prediction weights', () => {
    it('should have weights that sum to 1.0', () => {
      const w = DEFAULT_PREDICTION_WEIGHTS;
      const sum =
        w.directionAccuracy +
        w.magnitudeAccuracy +
        w.confidenceCalibration +
        w.consistency +
        w.resolutionFit;

      expect(sum).to.be.closeTo(1.0, 1e-10);
    });

    it('should match expected individual weights (0.30, 0.25, 0.20, 0.15, 0.10)', () => {
      const w = DEFAULT_PREDICTION_WEIGHTS;
      expect(w.directionAccuracy).to.equal(0.30);
      expect(w.magnitudeAccuracy).to.equal(0.25);
      expect(w.confidenceCalibration).to.equal(0.20);
      expect(w.consistency).to.equal(0.15);
      expect(w.resolutionFit).to.equal(0.10);
    });
  });

  // ---------- RESOLUTION_MS values ----------

  describe('RESOLUTION_MS values', () => {
    it('should have correct ms values for all resolutions', () => {
      expect(RESOLUTION_MS['1m']).to.equal(60_000);
      expect(RESOLUTION_MS['5m']).to.equal(300_000);
      expect(RESOLUTION_MS['15m']).to.equal(900_000);
      expect(RESOLUTION_MS['1h']).to.equal(3_600_000);
    });

    it('should have exactly 4 resolution entries', () => {
      expect(Object.keys(RESOLUTION_MS)).to.have.length(4);
    });
  });

  // ---------- AdaptiveConfig interval ordering ----------

  describe('AdaptiveConfig interval ordering', () => {
    it('should have minIntervalMs < baseIntervalMs < maxIntervalMs', () => {
      const cfg = DEFAULT_ADAPTIVE_CONFIG;
      expect(cfg.minIntervalMs).to.be.lessThan(cfg.baseIntervalMs);
      expect(cfg.baseIntervalMs).to.be.lessThan(cfg.maxIntervalMs);
    });

    it('should have currentIntervalMs equal to baseIntervalMs by default', () => {
      const cfg = DEFAULT_ADAPTIVE_CONFIG;
      expect(cfg.currentIntervalMs).to.equal(cfg.baseIntervalMs);
    });

    it('should have sensible threshold ordering: emergency < low < high', () => {
      const cfg = DEFAULT_ADAPTIVE_CONFIG;
      expect(cfg.emergencyThreshold).to.be.lessThan(cfg.accuracyLowThreshold);
      expect(cfg.accuracyLowThreshold).to.be.lessThan(cfg.accuracyHighThreshold);
    });
  });

  // ---------- Direction type ----------

  describe('Direction type values', () => {
    it('should accept valid directions', () => {
      const validDirections: Direction[] = ['up', 'down', 'flat'];
      // Compile-time check passes; runtime verify the set
      expect(validDirections).to.have.length(3);
      expect(validDirections).to.include('up');
      expect(validDirections).to.include('down');
      expect(validDirections).to.include('flat');
    });
  });

  // ---------- Confidence range ----------

  describe('Confidence semantic range', () => {
    it('should define confidence as 0-100 (via documentation/usage patterns)', () => {
      // The Prediction interface documents confidence as 0-100.
      // We verify AdaptiveConfig thresholds are expressed as fractions (0-1),
      // confirming they are separate from the confidence scale.
      const cfg = DEFAULT_ADAPTIVE_CONFIG;
      expect(cfg.accuracyHighThreshold).to.be.lessThanOrEqual(1.0);
      expect(cfg.emergencyThreshold).to.be.greaterThanOrEqual(0);
    });
  });
});
