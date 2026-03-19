/**
 * DarwinFi Immune System - Alert Manager
 *
 * Severity classification, deduplication (10min window), and cooldown.
 * Alerts are derived from CheckResults and persisted in the log.
 */

import { Alert, AlertSeverity, CheckResult, CheckSeverity } from '../types';
import { THRESHOLDS } from '../config';
import { LogAggregator } from './log-aggregator';

export class AlertManager {
  private activeAlerts: Map<string, Alert> = new Map();
  private logger: LogAggregator;
  private dedupWindowMs: number;

  constructor(logger: LogAggregator, dedupWindowMs = THRESHOLDS.alertDedupWindowMs) {
    this.logger = logger;
    this.dedupWindowMs = dedupWindowMs;
  }

  /**
   * Process a CheckResult and potentially create/update an alert.
   * Returns the alert if one was created/updated, null if deduped.
   */
  processCheck(result: CheckResult): Alert | null {
    const severity = this.mapSeverity(result.severity);

    // OK results resolve existing alerts
    if (result.severity === 'ok') {
      return this.resolveAlert(result.checkId);
    }

    // Check dedup window
    const existing = this.activeAlerts.get(result.checkId);
    if (existing && !existing.resolvedAt) {
      const elapsed = Date.now() - existing.createdAt;
      if (elapsed < this.dedupWindowMs) {
        // Within dedup window - skip but escalate if worse
        if (this.severityRank(severity) > this.severityRank(existing.severity)) {
          existing.severity = severity;
          existing.message = result.message;
          existing.details = result.details;
          this.logger.warn('AlertManager', `Escalated alert ${result.checkId} to ${severity}`, result.checkId);
        }
        return null;
      }
    }

    // Create new alert
    const alert: Alert = {
      id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      checkId: result.checkId,
      severity,
      message: result.message,
      details: result.details,
      createdAt: Date.now(),
      acknowledged: false,
      fixAttempted: false,
    };

    this.activeAlerts.set(result.checkId, alert);

    this.logger.log(
      severity === 'critical' ? 'critical' : severity === 'error' ? 'error' : 'warn',
      'AlertManager',
      `Alert: [${severity.toUpperCase()}] ${result.checkId} - ${result.message}`,
      result.checkId,
      result.details,
    );

    return alert;
  }

  /**
   * Resolve an alert (check returned to OK).
   */
  resolveAlert(checkId: string): Alert | null {
    const alert = this.activeAlerts.get(checkId);
    if (alert && !alert.resolvedAt) {
      alert.resolvedAt = Date.now();
      this.logger.info('AlertManager', `Resolved: ${checkId}`, checkId);
      return alert;
    }
    return null;
  }

  /**
   * Mark an alert as having a fix attempted.
   */
  markFixAttempted(checkId: string, success: boolean): void {
    const alert = this.activeAlerts.get(checkId);
    if (alert) {
      alert.fixAttempted = true;
      alert.fixSuccess = success;
    }
  }

  /**
   * Get all active (unresolved) alerts.
   */
  getActiveAlerts(): Alert[] {
    return Array.from(this.activeAlerts.values())
      .filter(a => !a.resolvedAt)
      .sort((a, b) => this.severityRank(b.severity) - this.severityRank(a.severity));
  }

  /**
   * Get alerts from the last N hours.
   */
  getRecentAlerts(hours = 24): Alert[] {
    const cutoff = Date.now() - hours * 60 * 60_000;
    return Array.from(this.activeAlerts.values())
      .filter(a => a.createdAt >= cutoff)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get the overall worst severity across active alerts.
   */
  getOverallSeverity(): CheckSeverity {
    const active = this.getActiveAlerts();
    if (active.length === 0) return 'ok';
    if (active.some(a => a.severity === 'critical')) return 'critical';
    if (active.some(a => a.severity === 'error')) return 'error';
    if (active.some(a => a.severity === 'warning')) return 'warning';
    return 'ok';
  }

  /**
   * Acknowledge an alert (prevents re-notification).
   */
  acknowledge(checkId: string): void {
    const alert = this.activeAlerts.get(checkId);
    if (alert) alert.acknowledged = true;
  }

  /**
   * Clean up old resolved alerts (older than 48h).
   */
  cleanup(maxAgeMs = 48 * 60 * 60_000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [key, alert] of this.activeAlerts) {
      if (alert.resolvedAt && alert.resolvedAt < cutoff) {
        this.activeAlerts.delete(key);
      }
    }
  }

  // Map CheckSeverity to AlertSeverity
  private mapSeverity(check: CheckSeverity): AlertSeverity {
    switch (check) {
      case 'critical': return 'critical';
      case 'error': return 'error';
      case 'warning': return 'warning';
      default: return 'info';
    }
  }

  private severityRank(s: AlertSeverity): number {
    switch (s) {
      case 'critical': return 4;
      case 'error': return 3;
      case 'warning': return 2;
      case 'info': return 1;
      default: return 0;
    }
  }
}
