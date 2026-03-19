/**
 * rss-source.ts - RSS/News feed source for crypto news
 *
 * Monitors CoinDesk, CoinTelegraph, Decrypt, and Base blog feeds.
 * Extracts trading-relevant events with sentiment analysis.
 */

import { randomUUID } from 'crypto';
import { WorldEvent, SourceConfig } from '../types';
import { ALL_TOKENS } from '../data/pool-registry';

const RSS_FEEDS = [
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'CoinTelegraph', url: 'https://cointelegraph.com/rss' },
  { name: 'Decrypt', url: 'https://decrypt.co/feed' },
];

// Simple XML extraction without external dependency
function extractItems(xml: string): Array<{ title: string; description: string; pubDate: string }> {
  const items: Array<{ title: string; description: string; pubDate: string }> = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const content = match[1];
    const title = content.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/)?.[1] || content.match(/<title>(.*?)<\/title>/)?.[1] || '';
    const desc = content.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>|<description>(.*?)<\/description>/)?.[1] || '';
    const pubDate = content.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
    items.push({ title: title.trim(), description: desc.trim(), pubDate });
  }

  return items;
}

// Token mention detection
const TOKEN_PATTERNS: Record<string, RegExp> = {};
for (const token of ALL_TOKENS) {
  const lower = token.toLowerCase();
  // Match token symbol or common names
  const patterns: string[] = [token, lower];
  if (token === 'ETH') patterns.push('ethereum', 'ether');
  if (token === 'UNI') patterns.push('uniswap');
  if (token === 'wstETH') patterns.push('lido', 'wrapped staked eth');
  if (token === 'AERO') patterns.push('aerodrome');
  if (token === 'VIRTUAL') patterns.push('virtuals protocol');
  TOKEN_PATTERNS[token] = new RegExp(`\\b(${patterns.join('|')})\\b`, 'i');
}

// Simple sentiment keywords
const BULLISH_WORDS = ['surge', 'soar', 'rally', 'bullish', 'breakout', 'partnership', 'launch', 'upgrade', 'milestone', 'adoption', 'listing', 'approval', 'positive'];
const BEARISH_WORDS = ['crash', 'dump', 'hack', 'exploit', 'bearish', 'ban', 'lawsuit', 'investigation', 'delisting', 'vulnerability', 'breach', 'negative', 'decline'];

function analyzeSentiment(text: string): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const word of BULLISH_WORDS) {
    if (lower.includes(word)) score += 0.15;
  }
  for (const word of BEARISH_WORDS) {
    if (lower.includes(word)) score -= 0.15;
  }
  return Math.max(-1, Math.min(1, score));
}

function detectTokens(text: string): string[] {
  const found: string[] = [];
  for (const [token, pattern] of Object.entries(TOKEN_PATTERNS)) {
    if (pattern.test(text)) found.push(token);
  }
  // If no specific token found but crypto-related, tag as ETH (general market)
  if (found.length === 0 && /\b(crypto|bitcoin|defi|base chain|layer 2)\b/i.test(text)) {
    found.push('ETH');
  }
  return found;
}

function estimateMagnitude(text: string): number {
  const lower = text.toLowerCase();
  if (/hack|exploit|breach|\$\d+[bB]/.test(lower)) return 80;
  if (/listing|partnership|regulatory|sec |cftc /.test(lower)) return 60;
  if (/upgrade|launch|milestone/.test(lower)) return 50;
  if (/whale|volume spike/.test(lower)) return 40;
  return 30;
}

export class RssSource {
  private maxAge: number; // Max article age in ms

  constructor(maxAgeMinutes: number = 60) {
    this.maxAge = maxAgeMinutes * 60 * 1000;
  }

  async collect(): Promise<WorldEvent[]> {
    const events: WorldEvent[] = [];
    const now = Date.now();

    for (const feed of RSS_FEEDS) {
      try {
        const response = await fetch(feed.url, {
          headers: { 'Accept': 'application/xml, text/xml, application/rss+xml' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) continue;

        const xml = await response.text();
        const items = extractItems(xml);

        for (const item of items.slice(0, 10)) { // Top 10 per feed
          // Skip old articles
          if (item.pubDate) {
            const pubTime = new Date(item.pubDate).getTime();
            if (now - pubTime > this.maxAge) continue;
          }

          const fullText = `${item.title} ${item.description}`;
          const tokens = detectTokens(fullText);
          if (tokens.length === 0) continue; // Skip non-crypto-token news

          const sentiment = analyzeSentiment(fullText);
          if (Math.abs(sentiment) < 0.05) continue; // Skip neutral

          events.push({
            id: randomUUID(),
            sourceId: 'rss_news',
            timestamp: item.pubDate ? new Date(item.pubDate).getTime() : now,
            category: 'news',
            tokens,
            sentiment,
            magnitude: estimateMagnitude(fullText),
            title: item.title.slice(0, 200),
            details: `[${feed.name}] ${item.description.slice(0, 500)}`,
          });
        }
      } catch (err) {
        console.error(`[RSS] Error fetching ${feed.name}:`, (err as Error).message);
      }
    }

    console.log(`[RSS] Collected ${events.length} events from ${RSS_FEEDS.length} feeds`);
    return events;
  }

  static defaultConfig(): SourceConfig {
    return {
      id: 'rss_news',
      name: 'RSS News Feeds',
      type: 'rss',
      status: 'active',
      collectionIntervalMs: 10 * 60 * 1000,  // Every 10 min
      fitness: {
        predictiveScore: 0.5,
        signalToNoise: 0.4,
        timeliness: 0.5,
        uniqueValue: 0.4,
        costEfficiency: 1.0,    // Free
        compositeScore: 0.5,
        lastEvaluatedAt: 0,
        evaluationCount: 0,
      },
      consecutiveLowScores: 0,
      lastCollectionAt: 0,
      eventsProduced: 0,
    };
  }
}
