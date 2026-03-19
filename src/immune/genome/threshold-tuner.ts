/**
 * DarwinFi Immune System - Threshold Tuner
 *
 * EMA-based threshold adjustment using incident analysis.
 * - High false positive rate (>30%): relax threshold 10% toward maxBound
 * - Missed incidents: tighten threshold 10% toward minBound
 * - All adjustments use EMA smoothing (alpha=0.3)
 * - Hard bounds: 0.5x to 2.0x of default value
 */

import { GenomeStateManager } from './genome-state';
import { IncidentSummary } from '../types';
import { THRESHOLDS } from '../config';

const PREFIX = '[Immune:Genome]';

/**
 * Tune thresholds based on incident summaries.
 */
export function tuneThresholds(
  genome: GenomeStateManager,
  incidents: IncidentSummary[],
): void {
  const state = genome.getState();
  const alpha = THRESHOLDS.emaAlpha;
  let adjustments = 0;

  for (const incident of incidents) {
    const config = state.thresholds[incident.checkId];
    if (!config) continue;

    const falsePositiveRate = incident.count > 0
      ? incident.falsePositives / incident.count
      : 0;

    let adjustment = config.currentValue;

    if (falsePositiveRate > 0.3) {
      // Relax: move 10% toward maxBound
      const relaxTarget = config.currentValue + (config.maxBound - config.currentValue) * THRESHOLDS.falsePositiveRelaxRate;
      adjustment = alpha * relaxTarget + (1 - alpha) * config.currentValue;
      console.log(
        `${PREFIX} Relaxing ${incident.checkId}: falsePositiveRate=${falsePositiveRate.toFixed(2)}, ` +
        `${config.currentValue.toFixed(3)} -> ${adjustment.toFixed(3)}`
      );
    } else if (incident.fixSuccessRate < 1 && incident.count > 0) {
      // Missed incidents (fixes that failed suggest we caught it too late or threshold is too loose)
      const tightenTarget = config.currentValue - (config.currentValue - config.minBound) * THRESHOLDS.missedIncidentTightenRate;
      adjustment = alpha * tightenTarget + (1 - alpha) * config.currentValue;
      console.log(
        `${PREFIX} Tightening ${incident.checkId}: fixSuccessRate=${incident.fixSuccessRate.toFixed(2)}, ` +
        `${config.currentValue.toFixed(3)} -> ${adjustment.toFixed(3)}`
      );
    } else {
      continue; // No adjustment needed
    }

    // Clamp to bounds
    adjustment = Math.max(config.minBound, Math.min(config.maxBound, adjustment));

    genome.updateThreshold(incident.checkId, {
      currentValue: adjustment,
      falsePositiveRate,
      missedIncidentRate: incident.count > 0 ? 1 - incident.fixSuccessRate : 0,
    });
    adjustments++;
  }

  console.log(`${PREFIX} Threshold tuning complete: ${adjustments} adjustments made`);
}
