/**
 * event-store.ts - Day-partitioned JSONL storage for WorldEvent records
 *
 * Storage: data/instinct/senses/events/YYYY-MM-DD.jsonl
 */

import * as fs from 'fs';
import * as path from 'path';
import { WorldEvent } from '../types';

const EVENTS_DIR = path.resolve(__dirname, '../../../data/instinct/senses/events');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function dateKey(timestampMs: number): string {
  return new Date(timestampMs).toISOString().split('T')[0];
}

function getFilePath(date: string): string {
  return path.join(EVENTS_DIR, `${date}.jsonl`);
}

export class EventStore {
  constructor() {
    ensureDir(EVENTS_DIR);
  }

  /**
   * Append a single event to the day-partitioned store.
   */
  appendEvent(event: WorldEvent): void {
    const date = dateKey(event.timestamp);
    const filePath = getFilePath(date);
    fs.appendFileSync(filePath, JSON.stringify(event) + '\n', 'utf-8');
  }

  /**
   * Append multiple events.
   */
  appendEvents(events: WorldEvent[]): void {
    // Group by date for efficient writes
    const byDate = new Map<string, WorldEvent[]>();
    for (const event of events) {
      const date = dateKey(event.timestamp);
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date)!.push(event);
    }

    for (const [date, dateEvents] of byDate) {
      const filePath = getFilePath(date);
      const lines = dateEvents.map(e => JSON.stringify(e)).join('\n') + '\n';
      fs.appendFileSync(filePath, lines, 'utf-8');
    }
  }

  /**
   * Get events within a date range (inclusive, YYYY-MM-DD strings).
   * Optionally filter by token symbol.
   */
  getEvents(fromDate: string, toDate: string, token?: string): WorldEvent[] {
    const events: WorldEvent[] = [];
    const from = new Date(fromDate);
    const to = new Date(toDate);

    const current = new Date(from);
    while (current <= to) {
      const date = current.toISOString().split('T')[0];
      const filePath = getFilePath(date);

      if (fs.existsSync(filePath)) {
        const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
        for (const line of lines) {
          if (!line) continue;
          try {
            const event: WorldEvent = JSON.parse(line);
            if (token && !event.tokens.includes(token)) continue;
            events.push(event);
          } catch {
            // Skip malformed
          }
        }
      }

      current.setDate(current.getDate() + 1);
    }

    return events.sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get events from the last N minutes.
   */
  getRecentEvents(lookbackMinutes: number, token?: string): WorldEvent[] {
    const now = Date.now();
    const cutoff = now - lookbackMinutes * 60_000;
    const today = dateKey(now);
    const yesterday = dateKey(now - 86_400_000);

    // Check today and yesterday (events near midnight might span days)
    const allEvents = [
      ...this.loadDayEvents(yesterday),
      ...this.loadDayEvents(today),
    ];

    return allEvents
      .filter(e => e.timestamp >= cutoff)
      .filter(e => !token || e.tokens.includes(token))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Get event by ID.
   */
  getEventById(id: string, searchDate?: string): WorldEvent | null {
    // If date hint provided, search that day first
    if (searchDate) {
      const events = this.loadDayEvents(searchDate);
      const found = events.find(e => e.id === id);
      if (found) return found;
    }

    // Otherwise search recent days
    const now = Date.now();
    for (let i = 0; i < 7; i++) {
      const date = dateKey(now - i * 86_400_000);
      if (date === searchDate) continue; // Already searched
      const events = this.loadDayEvents(date);
      const found = events.find(e => e.id === id);
      if (found) return found;
    }

    return null;
  }

  /**
   * Count events for a given day.
   */
  countDay(date: string): number {
    const filePath = getFilePath(date);
    if (!fs.existsSync(filePath)) return 0;
    return fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(l => l.length > 0).length;
  }

  /**
   * Load all events for a single day.
   */
  private loadDayEvents(date: string): WorldEvent[] {
    const filePath = getFilePath(date);
    if (!fs.existsSync(filePath)) return [];

    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    const events: WorldEvent[] = [];

    for (const line of lines) {
      if (!line) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        // Skip
      }
    }

    return events;
  }
}
