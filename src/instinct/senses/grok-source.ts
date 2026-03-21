/**
 * grok-source.ts - Venice Grok X/Twitter social intelligence source
 *
 * Uses Venice API with grok-41-fast model and enable_x_search for
 * real-time crypto sentiment from X.com/Twitter.
 */

import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
import { randomUUID } from 'crypto';
import { WorldEvent, SourceConfig } from '../types';
import { ALL_TOKENS } from '../data/pool-registry';

const VENICE_BASE_URL = 'https://api.venice.ai/api/v1';
const GROK_MODEL = 'grok-41-fast';

/** Venice API extends OpenAI params with vendor-specific fields */
interface VeniceCreateParams extends ChatCompletionCreateParamsNonStreaming {
  venice_parameters?: {
    enable_web_search?: string;
  };
}

interface GrokSourceConfig {
  veniceApiKey: string;
  tokens?: string[];
  batchSize?: number;  // Tokens per query (default 3)
}

export class GrokSource {
  private client: OpenAI;
  private tokens: string[];
  private batchSize: number;

  constructor(config: GrokSourceConfig) {
    this.client = new OpenAI({
      apiKey: config.veniceApiKey,
      baseURL: VENICE_BASE_URL,
      timeout: 30_000,
    });
    this.tokens = config.tokens ?? ALL_TOKENS;
    this.batchSize = config.batchSize ?? 3;
  }

  /**
   * Collect events from X/Twitter via Grok.
   * Batches tokens to reduce API calls.
   */
  async collect(): Promise<WorldEvent[]> {
    const events: WorldEvent[] = [];

    // Process tokens in batches
    for (let i = 0; i < this.tokens.length; i += this.batchSize) {
      const batch = this.tokens.slice(i, i + this.batchSize);
      try {
        const batchEvents = await this.queryBatch(batch);
        events.push(...batchEvents);
      } catch (err) {
        console.error(`[Grok] Batch error for ${batch.join(',')}:`, (err as Error).message);
      }
    }

    console.log(`[Grok] Collected ${events.length} events from X/Twitter`);
    return events;
  }

  private async queryBatch(tokens: string[]): Promise<WorldEvent[]> {
    const tokenList = tokens.join(', ');
    const now = new Date().toISOString();

    const systemPrompt = `You are a crypto market intelligence analyst scanning X/Twitter for trading-relevant signals. Focus on: price-moving news, whale activity discussions, project announcements, regulatory news, exchange listings, and strong sentiment shifts. Only report events with genuine market impact potential.

Output JSON array. Each event:
{
  "tokens": ["TOKEN1"],
  "category": "sentiment|whale|news|social",
  "sentiment": -1.0 to 1.0,
  "magnitude": 0-100,
  "title": "short summary",
  "details": "key details with source context"
}

Rules:
- Only include events from the LAST 4 HOURS
- Magnitude 80+: exchange listing, major hack, regulatory action
- Magnitude 50-79: project milestone, partnership, whale move
- Magnitude 20-49: community sentiment shift, minor news
- Skip routine price discussion with no new information
- Sentiment: -1 = extremely bearish, 0 = neutral, +1 = extremely bullish`;

    const userPrompt = `Current time: ${now}

Scan X/Twitter for the latest trading-relevant events for these Base ecosystem tokens: ${tokenList}

Also check for general crypto macro events that could affect Base tokens (ETH moves, regulatory news, major DeFi events).

Return a JSON array of events. If nothing significant, return [].`;

    const params: VeniceCreateParams = {
      model: GROK_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 2048,
      temperature: 0.3,
      venice_parameters: {
        enable_web_search: 'always',
      },
    };

    const response = await this.client.chat.completions.create(params);

    const content = response.choices[0]?.message?.content ?? '[]';
    return this.parseEvents(content, tokens);
  }

  private parseEvents(raw: string, batchTokens: string[]): WorldEvent[] {
    try {
      // Strip code fences
      let cleaned = raw.trim();
      if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
      if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
      if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);

      const parsed = JSON.parse(cleaned.trim());
      if (!Array.isArray(parsed)) return [];

      return parsed.map((item: Record<string, unknown>) => ({
        id: randomUUID(),
        sourceId: 'grok_x',
        timestamp: Date.now(),
        category: this.validateCategory(item.category as string),
        tokens: Array.isArray(item.tokens) ? item.tokens as string[] : batchTokens,
        sentiment: Math.max(-1, Math.min(1, Number(item.sentiment) || 0)),
        magnitude: Math.max(0, Math.min(100, Number(item.magnitude) || 30)),
        title: String(item.title || 'Unknown event'),
        details: String(item.details || ''),
      }));
    } catch (err) {
      console.error('[Grok] Parse error:', (err as Error).message);
      return [];
    }
  }

  private validateCategory(cat: string): WorldEvent['category'] {
    const valid = ['sentiment', 'whale', 'volume', 'news', 'correlation', 'gas', 'social'];
    return valid.includes(cat) ? cat as WorldEvent['category'] : 'social';
  }

  /**
   * Create the default SourceConfig for registration.
   */
  static defaultConfig(): SourceConfig {
    return {
      id: 'grok_x',
      name: 'Venice Grok X/Twitter',
      type: 'grok_x',
      status: 'active',
      collectionIntervalMs: 15 * 60 * 1000,  // Every 15 min
      fitness: {
        predictiveScore: 0.5,
        signalToNoise: 0.5,
        timeliness: 0.7,
        uniqueValue: 0.9,    // Unique X access
        costEfficiency: 0.6,
        compositeScore: 0.5,
        lastEvaluatedAt: 0,
        evaluationCount: 0,
      },
      consecutiveLowScores: 0,
      lastCollectionAt: 0,
      eventsProduced: 0,
      config: { model: GROK_MODEL },
    };
  }
}
