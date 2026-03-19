/**
 * workflow-generator.ts - Generates n8n workflow suggestions from detected patterns
 *
 * When the pattern detector finds repeatable operations, this module
 * generates workflow templates that could automate them.
 * Actual workflow creation is flagged for human review.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DetectedPattern } from '../types';

const SUGGESTIONS_PATH = path.resolve(process.cwd(), 'data/instinct/marrow-suggestions.json');

export interface WorkflowSuggestion {
  patternId: string;
  type: 'batch' | 'template' | 'workflow';
  description: string;
  estimatedSavings: string;
  suggestedImplementation: string;
  createdAt: number;
  approved: boolean;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export class WorkflowGenerator {
  private suggestions: WorkflowSuggestion[] = [];

  constructor() {
    this.loadSuggestions();
  }

  /**
   * Generate workflow suggestions from detected patterns.
   */
  generateSuggestions(patterns: DetectedPattern[]): WorkflowSuggestion[] {
    const newSuggestions: WorkflowSuggestion[] = [];

    for (const pattern of patterns) {
      if (pattern.automated) continue;
      if (this.suggestions.some(s => s.patternId === pattern.id)) continue;

      const suggestion = this.buildSuggestion(pattern);
      if (suggestion) {
        newSuggestions.push(suggestion);
        this.suggestions.push(suggestion);
      }
    }

    if (newSuggestions.length > 0) {
      this.saveSuggestions();
      console.log(`[Marrow] Generated ${newSuggestions.length} new workflow suggestions`);
    }

    return newSuggestions;
  }

  private buildSuggestion(pattern: DetectedPattern): WorkflowSuggestion | null {
    switch (pattern.type) {
      case 'repeated_prompt':
        return {
          patternId: pattern.id,
          type: 'template',
          description: `Template the repeated operation: ${pattern.description}`,
          estimatedSavings: pattern.estimatedSavings,
          suggestedImplementation: [
            '1. Extract the common prompt structure',
            '2. Create a template with {{token}}, {{price}}, etc. variables',
            '3. Cache results for identical inputs within N candles',
          ].join('\n'),
          createdAt: Date.now(),
          approved: false,
        };

      case 'batch_opportunity':
        return {
          patternId: pattern.id,
          type: 'batch',
          description: `Batch the sequential calls: ${pattern.description}`,
          estimatedSavings: pattern.estimatedSavings,
          suggestedImplementation: [
            '1. Collect all targets into an array',
            '2. Make a single API call with all targets',
            '3. Distribute results to consumers',
          ].join('\n'),
          createdAt: Date.now(),
          approved: false,
        };

      case 'sequential_steps':
        return {
          patternId: pattern.id,
          type: 'workflow',
          description: `n8n workflow for: ${pattern.description}`,
          estimatedSavings: pattern.estimatedSavings,
          suggestedImplementation: [
            '1. Create n8n workflow with webhook trigger',
            '2. Chain the sequential steps as n8n nodes',
            '3. Add error handling and retry logic',
            '4. Schedule via cron or event trigger',
          ].join('\n'),
          createdAt: Date.now(),
          approved: false,
        };

      default:
        return null;
    }
  }

  getSuggestions(): WorkflowSuggestion[] {
    return [...this.suggestions];
  }

  getPendingSuggestions(): WorkflowSuggestion[] {
    return this.suggestions.filter(s => !s.approved);
  }

  approveSuggestion(patternId: string): void {
    const suggestion = this.suggestions.find(s => s.patternId === patternId);
    if (suggestion) {
      suggestion.approved = true;
      this.saveSuggestions();
    }
  }

  private loadSuggestions(): void {
    try {
      if (fs.existsSync(SUGGESTIONS_PATH)) {
        this.suggestions = JSON.parse(fs.readFileSync(SUGGESTIONS_PATH, 'utf-8'));
      }
    } catch { /* ignore */ }
  }

  private saveSuggestions(): void {
    ensureDir(path.dirname(SUGGESTIONS_PATH));
    const tmpPath = SUGGESTIONS_PATH + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(this.suggestions, null, 2), 'utf-8');
    fs.renameSync(tmpPath, SUGGESTIONS_PATH);
  }
}
