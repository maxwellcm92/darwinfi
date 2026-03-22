/**
 * DarwinFi Grading Department
 *
 * Centralized system that grades all departments on a unified 0-100 scale
 * with letter grades (A-F). Reads state files from each subsystem.
 *
 * Departments graded:
 *   - Strategies: PnL, win rate, Sharpe ratio from agent-state.json
 *   - Instinct: prediction accuracy from predictions-live.json
 *   - Immune: division health from immune-state.json
 *   - Evolution: proposal success rate from memory.json
 *   - Frontier: bot performance from agent-state.json (frontier section)
 */

import * as fs from 'fs';
import * as path from 'path';

// Resolve project root (works from src/ and dist/)
function resolveProjectRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const PROJECT_ROOT = resolveProjectRoot();

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export interface DepartmentGrade {
  name: string;
  score: number;          // 0-100
  letter: string;         // A, B, C, D, F
  metrics: Record<string, number | string>;
  lastUpdated: number;    // Unix ms
}

export interface SystemGradeReport {
  generatedAt: number;
  departments: DepartmentGrade[];
  overallGPA: number;     // 0-4.0 scale
  overallScore: number;   // 0-100
  overallLetter: string;
}

// -------------------------------------------------------------------
// GradingDepartment
// -------------------------------------------------------------------

export class GradingDepartment {

  /**
   * Generate a full system grade report.
   */
  generateReport(): SystemGradeReport {
    const departments: DepartmentGrade[] = [
      this.gradeStrategies(),
      this.gradeInstinct(),
      this.gradeImmune(),
      this.gradeEvolution(),
      this.gradeFrontier(),
    ];

    const validScores = departments.filter(d => d.score >= 0);
    const overallScore = validScores.length > 0
      ? Math.round(validScores.reduce((s, d) => s + d.score, 0) / validScores.length)
      : 0;

    return {
      generatedAt: Date.now(),
      departments,
      overallGPA: this.scoreToGPA(overallScore),
      overallScore,
      overallLetter: this.scoreToLetter(overallScore),
    };
  }

  /**
   * Get evolution context string for AI prompts.
   * Used by the evolution engine to target weakest areas.
   */
  getEvolutionContext(): string {
    const report = this.generateReport();
    const lines = [
      '## System Grade Report',
      `Overall: ${report.overallLetter} (${report.overallScore}/100, GPA: ${report.overallGPA.toFixed(1)})`,
      '',
    ];

    // Sort departments by score (worst first) so evolution targets weakest
    const sorted = [...report.departments].sort((a, b) => a.score - b.score);
    for (const dept of sorted) {
      lines.push(`### ${dept.name}: ${dept.letter} (${dept.score}/100)`);
      for (const [key, val] of Object.entries(dept.metrics)) {
        lines.push(`  - ${key}: ${val}`);
      }
      lines.push('');
    }

    lines.push('PRIORITY: Focus improvements on the lowest-graded departments first.');
    return lines.join('\n');
  }

  // -------------------------------------------------------------------
  // Per-department grading
  // -------------------------------------------------------------------

  private gradeStrategies(): DepartmentGrade {
    try {
      const statePath = path.join(PROJECT_ROOT, 'data', 'agent-state.json');
      if (!fs.existsSync(statePath)) {
        return this.noDataGrade('Strategies');
      }
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      const perf = state.performance || {};
      const entries = Object.values(perf) as Array<{
        totalPnL?: number;
        winRate?: number;
        sharpeRatio?: number;
        trades?: number;
      }>;

      if (entries.length === 0) return this.noDataGrade('Strategies');

      // Aggregate metrics
      let totalPnl = 0;
      let avgWinRate = 0;
      let avgSharpe = 0;
      let totalTrades = 0;
      for (const e of entries) {
        totalPnl += e.totalPnL || 0;
        avgWinRate += e.winRate || 0;
        avgSharpe += e.sharpeRatio || 0;
        totalTrades += e.trades || 0;
      }
      avgWinRate /= entries.length;
      avgSharpe /= entries.length;

      // Score: win rate contributes 40%, Sharpe 30%, PnL direction 30%
      const winRateScore = Math.min(100, avgWinRate * 100 * 1.5); // 66% WR = 100
      const sharpeScore = Math.min(100, Math.max(0, (avgSharpe + 1) * 50)); // -1 to 1 -> 0 to 100
      const pnlScore = totalPnl > 0 ? 80 : totalPnl === 0 ? 50 : Math.max(0, 50 + totalPnl * 10);
      const score = Math.round(winRateScore * 0.4 + sharpeScore * 0.3 + pnlScore * 0.3);

      return {
        name: 'Strategies',
        score: Math.min(100, Math.max(0, score)),
        letter: this.scoreToLetter(score),
        metrics: {
          totalPnL: `$${totalPnl.toFixed(2)}`,
          avgWinRate: `${(avgWinRate * 100).toFixed(1)}%`,
          avgSharpe: avgSharpe.toFixed(3),
          activeStrategies: entries.length,
          totalTrades,
        },
        lastUpdated: Date.now(),
      };
    } catch {
      return this.noDataGrade('Strategies');
    }
  }

  private gradeInstinct(): DepartmentGrade {
    try {
      const statePath = path.join(PROJECT_ROOT, 'data', 'instinct', 'nerves', 'predictions-live.json');
      if (!fs.existsSync(statePath)) return this.noDataGrade('Instinct');

      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      const accuracy = state.accuracy;
      const health = state.health;

      if (!accuracy || !health) return this.noDataGrade('Instinct');

      // Score: accuracy 60%, health 40%
      const accuracyScore = accuracy.overall * 100; // 0-100
      const healthScore = Math.min(100,
        (health.sensesActive > 0 ? 30 : 0) +
        (health.reflexesActive > 0 ? 30 : 0) +
        (health.overallConfidence * 0.4)
      );
      const score = Math.round(accuracyScore * 0.6 + healthScore * 0.4);

      return {
        name: 'Instinct',
        score: Math.min(100, Math.max(0, score)),
        letter: this.scoreToLetter(score),
        metrics: {
          accuracy: `${(accuracy.overall * 100).toFixed(1)}%`,
          totalPredictions: accuracy.totalPredictions,
          sensesActive: health.sensesActive,
          reflexesActive: health.reflexesActive,
          overallConfidence: `${health.overallConfidence}%`,
        },
        lastUpdated: state.generatedAt || Date.now(),
      };
    } catch {
      return this.noDataGrade('Instinct');
    }
  }

  private gradeImmune(): DepartmentGrade {
    try {
      const statePath = path.join(PROJECT_ROOT, 'data', 'immune', 'immune-state.json');
      if (!fs.existsSync(statePath)) return this.noDataGrade('Immune');

      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      const divisions = state.divisions || {};
      const divEntries = Object.values(divisions) as Array<{
        name: string;
        status: string;
        checksRun: number;
        checksFailed: number;
      }>;

      if (divEntries.length === 0) return this.noDataGrade('Immune');

      // Score: based on division health
      let totalChecks = 0;
      let failedChecks = 0;
      let okDivisions = 0;
      for (const div of divEntries) {
        totalChecks += div.checksRun || 0;
        failedChecks += div.checksFailed || 0;
        if (div.status === 'ok') okDivisions++;
      }

      const passRate = totalChecks > 0 ? (totalChecks - failedChecks) / totalChecks : 1;
      const divisionHealth = divEntries.length > 0 ? okDivisions / divEntries.length : 0;

      // Pass rate 60%, division health 40%
      const score = Math.round(passRate * 100 * 0.6 + divisionHealth * 100 * 0.4);

      return {
        name: 'Immune',
        score: Math.min(100, Math.max(0, score)),
        letter: this.scoreToLetter(score),
        metrics: {
          passRate: `${(passRate * 100).toFixed(1)}%`,
          divisions: `${okDivisions}/${divEntries.length} healthy`,
          totalChecks,
          failedChecks,
          overallSeverity: state.overall || 'unknown',
        },
        lastUpdated: state.updatedAt || Date.now(),
      };
    } catch {
      return this.noDataGrade('Immune');
    }
  }

  private gradeEvolution(): DepartmentGrade {
    try {
      const memoryPath = path.join(PROJECT_ROOT, 'data', 'evolution', 'memory.json');
      if (!fs.existsSync(memoryPath)) return this.noDataGrade('Evolution');

      const memory = JSON.parse(fs.readFileSync(memoryPath, 'utf-8'));
      const entries = memory.entries || [];

      if (entries.length === 0) return this.noDataGrade('Evolution');

      let promoted = 0;
      let rejected = 0;
      let rolledBack = 0;
      for (const e of entries) {
        if (e.outcome === 'promoted') promoted++;
        else if (e.outcome === 'rejected') rejected++;
        else if (e.outcome === 'rolled_back') rolledBack++;
      }

      const total = promoted + rejected + rolledBack;
      const successRate = total > 0 ? promoted / total : 0;

      // Score: success rate is primary metric
      // 0% success = 20 (it's trying), higher success = higher score
      const score = Math.round(20 + successRate * 80);

      return {
        name: 'Evolution',
        score: Math.min(100, Math.max(0, score)),
        letter: this.scoreToLetter(score),
        metrics: {
          successRate: `${(successRate * 100).toFixed(1)}%`,
          promoted,
          rejected,
          rolledBack,
          totalProposals: total,
        },
        lastUpdated: Date.now(),
      };
    } catch {
      return this.noDataGrade('Evolution');
    }
  }

  private gradeFrontier(): DepartmentGrade {
    try {
      const statePath = path.join(PROJECT_ROOT, 'data', 'frontier', 'agent-state.json');
      if (!fs.existsSync(statePath)) return this.noDataGrade('Frontier');

      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      const frontier = state.frontier?.bots || state.frontierStrategies;

      if (!frontier || (Array.isArray(frontier) && frontier.length === 0)) {
        return this.noDataGrade('Frontier');
      }

      const bots = Array.isArray(frontier) ? frontier : Object.values(frontier);
      let totalScore = 0;
      let activeBots = 0;

      for (const bot of bots as Array<{ score?: number; status?: string; pnl?: number }>) {
        if (bot.status === 'active' || bot.score) {
          activeBots++;
          totalScore += bot.score || 50;
        }
      }

      const avgScore = activeBots > 0 ? totalScore / activeBots : 50;
      const score = Math.round(avgScore);

      return {
        name: 'Frontier',
        score: Math.min(100, Math.max(0, score)),
        letter: this.scoreToLetter(score),
        metrics: {
          activeBots,
          avgScore: avgScore.toFixed(1),
        },
        lastUpdated: Date.now(),
      };
    } catch {
      return this.noDataGrade('Frontier');
    }
  }

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  private noDataGrade(name: string): DepartmentGrade {
    return {
      name,
      score: 50,
      letter: 'C',
      metrics: { status: 'No data available' },
      lastUpdated: Date.now(),
    };
  }

  private scoreToLetter(score: number): string {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  private scoreToGPA(score: number): number {
    if (score >= 90) return 4.0;
    if (score >= 80) return 3.0;
    if (score >= 70) return 2.0;
    if (score >= 60) return 1.0;
    return 0.0;
  }
}
