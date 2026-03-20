/**
 * DarwinFi Signal Calibration
 *
 * Tracks signal_id -> outcome mapping for every signal source.
 * After each trade closes, scores the signal that triggered it.
 * Per-source, per-token confidence calibration:
 *   "On DEGEN, 80% confidence signals from Ollama only hit 50% -- treat as 50%"
 *
 * This is the feedback loop that makes AI signal evaluation self-correcting.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SignalSource = 'ollama' | 'claude' | 'venice' | 'rule_based';

interface SignalOutcome {
  signalId: string;
  source: SignalSource;
  token: string;
  predictedConfidence: number;
  predictedAction: 'buy' | 'sell' | 'skip';
  actualPnlPct: number;
  wasCorrect: boolean;
  timestamp: number;
}

interface CalibrationProfile {
  source: SignalSource;
  token: string;
  totalSignals: number;
  correctSignals: number;
  accuracy: number;
  avgPredictedConfidence: number;
  avgActualWinRate: number;
  calibrationBias: number; // positive = overconfident, negative = underconfident
  calibrationFactor: number; // multiply predicted confidence by this
}

// ---------------------------------------------------------------------------
// SignalCalibration
// ---------------------------------------------------------------------------

export class SignalCalibration {
  private outcomes: SignalOutcome[] = [];
  private readonly MAX_OUTCOMES = 2000;

  /**
   * Record a signal outcome after a trade closes.
   */
  recordOutcome(
    source: SignalSource,
    token: string,
    predictedConfidence: number,
    predictedAction: 'buy' | 'sell' | 'skip',
    actualPnlPct: number,
  ): void {
    const wasCorrect =
      (predictedAction === 'buy' && actualPnlPct > 0) ||
      (predictedAction === 'sell' && actualPnlPct < 0) ||
      (predictedAction === 'skip' && Math.abs(actualPnlPct) < 1);

    this.outcomes.push({
      signalId: `${source}-${token}-${Date.now()}`,
      source,
      token,
      predictedConfidence,
      predictedAction,
      actualPnlPct,
      wasCorrect,
      timestamp: Date.now(),
    });

    if (this.outcomes.length > this.MAX_OUTCOMES) {
      this.outcomes.shift();
    }
  }

  /**
   * Get calibrated confidence for a signal.
   * Adjusts the raw AI confidence based on historical accuracy for this source+token.
   */
  calibrate(source: SignalSource, token: string, rawConfidence: number): number {
    const profile = this.getProfile(source, token);
    if (profile.totalSignals < 5) {
      // Not enough data to calibrate -- return raw
      return rawConfidence;
    }
    return Math.max(0, Math.min(100, rawConfidence * profile.calibrationFactor));
  }

  /**
   * Get calibration profile for a source+token pair.
   */
  getProfile(source: SignalSource, token: string): CalibrationProfile {
    const relevant = this.outcomes.filter(
      o => o.source === source && o.token === token
    );

    if (relevant.length === 0) {
      return {
        source, token,
        totalSignals: 0, correctSignals: 0, accuracy: 0.5,
        avgPredictedConfidence: 50, avgActualWinRate: 0.5,
        calibrationBias: 0, calibrationFactor: 1.0,
      };
    }

    const correct = relevant.filter(o => o.wasCorrect).length;
    const accuracy = correct / relevant.length;
    const avgPredicted = relevant.reduce((s, o) => s + o.predictedConfidence, 0) / relevant.length;
    const avgActualWinRate = accuracy;

    // Calibration: predicted 80% but actual 50% = bias +30, factor 0.625
    const calibrationBias = (avgPredicted / 100) - avgActualWinRate;
    const calibrationFactor = avgActualWinRate / Math.max(0.1, avgPredicted / 100);

    return {
      source, token,
      totalSignals: relevant.length,
      correctSignals: correct,
      accuracy,
      avgPredictedConfidence: avgPredicted,
      avgActualWinRate,
      calibrationBias,
      calibrationFactor: Math.max(0.2, Math.min(2.0, calibrationFactor)),
    };
  }

  /**
   * Get summary for all source+token pairs (for dashboard/evolution context).
   */
  getSummary(): CalibrationProfile[] {
    const keys = new Set(this.outcomes.map(o => `${o.source}|${o.token}`));
    return [...keys].map(key => {
      const [source, token] = key.split('|');
      return this.getProfile(source as SignalSource, token);
    }).sort((a, b) => b.totalSignals - a.totalSignals);
  }

  /**
   * Generate evolution context string for the AI.
   */
  getEvolutionContext(): string {
    const profiles = this.getSummary().filter(p => p.totalSignals >= 5);
    if (profiles.length === 0) return '';

    const lines = ['## Signal Calibration Data'];
    for (const p of profiles) {
      const biasLabel = p.calibrationBias > 0.1 ? 'OVERCONFIDENT'
        : p.calibrationBias < -0.1 ? 'UNDERCONFIDENT'
        : 'well-calibrated';
      lines.push(
        `  ${p.source}/${p.token}: ${p.totalSignals} signals, ` +
        `accuracy=${(p.accuracy * 100).toFixed(0)}%, ` +
        `avg_conf=${p.avgPredictedConfidence.toFixed(0)}%, ` +
        `${biasLabel} (factor: ${p.calibrationFactor.toFixed(2)})`
      );
    }
    return lines.join('\n');
  }

  /**
   * Serialize for persistence.
   */
  serialize(): SignalOutcome[] {
    return [...this.outcomes];
  }

  /**
   * Load from persisted state.
   */
  load(data: SignalOutcome[]): void {
    this.outcomes = data.slice(-this.MAX_OUTCOMES);
  }
}
