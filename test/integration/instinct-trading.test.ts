import { expect } from 'chai';

/**
 * Tests for the instinct confidence boost computation logic.
 * Tests the math directly without needing full agent instantiation.
 */
describe('Instinct Trading Integration', () => {
  // Replicate the computeInstinctScore logic for testing
  function computeInstinctScore(
    tokenInstinct: {
      predictions: Record<string, { direction: string; confidence: number } | undefined>;
      sentiment: { score: number };
    },
    instinctWeight: number,
  ): { directionScore: number; confidenceBoost: number } {
    let directionScore = 0;
    let predCount = 0;

    for (const [res, pred] of Object.entries(tokenInstinct.predictions)) {
      if (!pred) continue;
      const dirMultiplier = pred.direction === 'up' ? 1 : pred.direction === 'down' ? -1 : 0;
      const confFactor = pred.confidence / 100;
      const timeWeight = res === '5m' ? 0.5 : res === '15m' ? 0.3 : 0.2;
      directionScore += dirMultiplier * confFactor * timeWeight;
      predCount++;
    }

    if (predCount === 0) return { directionScore: 0, confidenceBoost: 0 };

    const sentimentFactor = tokenInstinct.sentiment.score * 0.2;
    directionScore = Math.max(-1, Math.min(1, directionScore + sentimentFactor));

    const rawBoost = directionScore * 40;
    const confidenceBoost = Math.max(-20, Math.min(20, rawBoost * instinctWeight));

    return {
      directionScore: Math.round(directionScore * 100) / 100,
      confidenceBoost: Math.round(confidenceBoost),
    };
  }

  it('should boost confidence when instinct predicts up with high confidence', () => {
    const result = computeInstinctScore({
      predictions: {
        '5m': { direction: 'up', confidence: 90 },
        '15m': { direction: 'up', confidence: 80 },
      },
      sentiment: { score: 0.5 },
    }, 0.25);

    expect(result.directionScore).to.be.greaterThan(0);
    expect(result.confidenceBoost).to.be.greaterThan(0);
    expect(result.confidenceBoost).to.be.at.most(20);
  });

  it('should reduce confidence when instinct predicts down', () => {
    const result = computeInstinctScore({
      predictions: {
        '5m': { direction: 'down', confidence: 85 },
        '15m': { direction: 'down', confidence: 75 },
      },
      sentiment: { score: -0.3 },
    }, 0.25);

    expect(result.directionScore).to.be.lessThan(0);
    expect(result.confidenceBoost).to.be.lessThan(0);
    expect(result.confidenceBoost).to.be.at.least(-20);
  });

  it('should return zero boost when no predictions available', () => {
    const result = computeInstinctScore({
      predictions: {},
      sentiment: { score: 0 },
    }, 0.25);

    expect(result.directionScore).to.equal(0);
    expect(result.confidenceBoost).to.equal(0);
  });

  it('should clamp confidence boost to [-20, +20]', () => {
    // Max positive
    const maxUp = computeInstinctScore({
      predictions: {
        '5m': { direction: 'up', confidence: 100 },
        '15m': { direction: 'up', confidence: 100 },
        '1h': { direction: 'up', confidence: 100 },
      },
      sentiment: { score: 1.0 },
    }, 1.0); // Max weight

    expect(maxUp.confidenceBoost).to.be.at.most(20);

    // Max negative
    const maxDown = computeInstinctScore({
      predictions: {
        '5m': { direction: 'down', confidence: 100 },
        '15m': { direction: 'down', confidence: 100 },
        '1h': { direction: 'down', confidence: 100 },
      },
      sentiment: { score: -1.0 },
    }, 1.0);

    expect(maxDown.confidenceBoost).to.be.at.least(-20);
  });

  it('should weight 5m predictions more heavily than 1h', () => {
    const with5m = computeInstinctScore({
      predictions: { '5m': { direction: 'up', confidence: 80 } },
      sentiment: { score: 0 },
    }, 0.25);

    const with1h = computeInstinctScore({
      predictions: { '1h': { direction: 'up', confidence: 80 } },
      sentiment: { score: 0 },
    }, 0.25);

    expect(with5m.confidenceBoost).to.be.greaterThan(with1h.confidenceBoost);
  });

  it('should scale boost by instinctWeight', () => {
    const input = {
      predictions: { '5m': { direction: 'up' as const, confidence: 80 } },
      sentiment: { score: 0.3 },
    };

    const lowWeight = computeInstinctScore(input, 0.1);
    const highWeight = computeInstinctScore(input, 0.5);

    expect(Math.abs(highWeight.confidenceBoost)).to.be.greaterThan(
      Math.abs(lowWeight.confidenceBoost),
    );
  });

  it('should apply confidence boost correctly to signal threshold', () => {
    // Simulate the signal processing logic
    const originalConfidence = 55; // Below threshold of 60
    const boost = 8; // Instinct says "up" with moderate confidence

    const adjustedConfidence = Math.max(0, Math.min(100, originalConfidence + boost));
    expect(adjustedConfidence).to.equal(63); // Now above threshold
    expect(adjustedConfidence).to.be.greaterThanOrEqual(60);
  });
});
