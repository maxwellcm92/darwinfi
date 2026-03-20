/**
 * DarwinFi AI Router
 *
 * Health-check routing with fallback chain: KS Ollama -> Venice API -> Claude CLI.
 * Pings KS every 60s to verify responsiveness. Auto-fallback if KS goes down,
 * auto-recover when it comes back.
 *
 * Routes fast tasks (signals, predictions) to Ollama for 2-5s latency.
 * Routes quality tasks (evolution synthesis) to Venice for better reasoning.
 */

import { OllamaEngine } from './ollama-engine';
import { StrategyGenome } from './strategy-manager';
import { MarketSnapshot, EntrySignal, ExitSignal } from './venice-engine';

type AIProvider = 'ollama' | 'venice' | 'claude';

interface ProviderStatus {
  healthy: boolean;
  lastCheck: number;
  consecutiveFailures: number;
  avgLatencyMs: number;
  totalCalls: number;
  totalErrors: number;
}

interface RouterStats {
  providers: Record<AIProvider, ProviderStatus>;
  currentPrimary: AIProvider;
  routingDecisions: number;
  fallbacksTriggered: number;
}

const HEALTH_CHECK_INTERVAL_MS = 60_000;
const MAX_CONSECUTIVE_FAILURES = 3;

export class AIRouter {
  private ollama: OllamaEngine;
  private providers: Record<AIProvider, ProviderStatus>;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private routingDecisions = 0;
  private fallbacksTriggered = 0;

  constructor() {
    this.ollama = new OllamaEngine();

    this.providers = {
      ollama: { healthy: false, lastCheck: 0, consecutiveFailures: 0, avgLatencyMs: 0, totalCalls: 0, totalErrors: 0 },
      venice: { healthy: true, lastCheck: Date.now(), consecutiveFailures: 0, avgLatencyMs: 0, totalCalls: 0, totalErrors: 0 },
      claude: { healthy: true, lastCheck: Date.now(), consecutiveFailures: 0, avgLatencyMs: 0, totalCalls: 0, totalErrors: 0 },
    };

    console.log('[AIRouter] Initialized with fallback chain: Ollama -> Venice -> Claude');
  }

  /**
   * Start periodic health checks on KS Ollama.
   */
  async start(): Promise<void> {
    // Initial health check
    await this.checkOllamaHealth();

    // Periodic health checks
    this.healthCheckTimer = setInterval(() => {
      this.checkOllamaHealth().catch(err =>
        console.error('[AIRouter] Health check error:', (err as Error).message)
      );
    }, HEALTH_CHECK_INTERVAL_MS);

    console.log(`[AIRouter] Health monitoring started (every ${HEALTH_CHECK_INTERVAL_MS / 1000}s)`);
  }

  /**
   * Stop health monitoring.
   */
  stop(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Get the best available provider for a task type.
   *
   * Fast tasks (signals, predictions): prefer Ollama for speed
   * Quality tasks (evolution synthesis): prefer Venice for reasoning
   * Fallback: Claude CLI always works (subscription-based)
   */
  getBestProvider(taskType: 'signal' | 'prediction' | 'evolution_experimental' | 'evolution_optimizer' | 'evolution_synthesizer'): AIProvider {
    this.routingDecisions++;

    switch (taskType) {
      case 'signal':
      case 'prediction':
      case 'evolution_experimental':
      case 'evolution_optimizer':
        // Fast tasks: Ollama -> Venice -> Claude
        if (this.providers.ollama.healthy) return 'ollama';
        if (this.providers.venice.healthy) return 'venice';
        this.fallbacksTriggered++;
        return 'claude';

      case 'evolution_synthesizer':
        // Quality task: Venice -> Ollama -> Claude
        if (this.providers.venice.healthy) return 'venice';
        if (this.providers.ollama.healthy) return 'ollama';
        this.fallbacksTriggered++;
        return 'claude';
    }
  }

  /**
   * Evaluate entry signals using the best available provider.
   */
  async evaluateEntry(
    strategy: StrategyGenome,
    snapshots: MarketSnapshot[],
  ): Promise<{ signals: EntrySignal[]; provider: AIProvider }> {
    const provider = this.getBestProvider('signal');
    const start = Date.now();

    try {
      let signals: EntrySignal[];
      if (provider === 'ollama') {
        signals = await this.ollama.evaluateEntry(strategy, snapshots);
      } else {
        // Fall through to caller's Claude/Venice handling
        throw new Error(`DELEGATE_TO_${provider.toUpperCase()}`);
      }

      this.recordSuccess(provider, Date.now() - start);
      return { signals, provider };
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith('DELEGATE_TO_')) {
        // Not an error -- delegate to the specified provider
        return { signals: [], provider };
      }
      this.recordFailure(provider);
      // Try next in chain
      if (provider === 'ollama') {
        console.warn('[AIRouter] Ollama failed, falling back to Venice/Claude');
        this.fallbacksTriggered++;
        return { signals: [], provider: this.providers.venice.healthy ? 'venice' : 'claude' };
      }
      return { signals: [], provider: 'claude' };
    }
  }

  /**
   * Evaluate exit signals using the best available provider.
   */
  async evaluateExit(
    strategy: StrategyGenome,
    positions: Array<{
      token: string;
      snapshot: MarketSnapshot;
      entryPrice: number;
      currentPnlPct: number;
      holdTimeMinutes: number;
    }>,
  ): Promise<{ signals: ExitSignal[]; provider: AIProvider }> {
    const provider = this.getBestProvider('signal');
    const start = Date.now();

    try {
      let signals: ExitSignal[];
      if (provider === 'ollama') {
        signals = await this.ollama.evaluateExit(strategy, positions);
      } else {
        throw new Error(`DELEGATE_TO_${provider.toUpperCase()}`);
      }

      this.recordSuccess(provider, Date.now() - start);
      return { signals, provider };
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith('DELEGATE_TO_')) {
        return { signals: [], provider };
      }
      this.recordFailure(provider);
      if (provider === 'ollama') {
        this.fallbacksTriggered++;
        return { signals: [], provider: this.providers.venice.healthy ? 'venice' : 'claude' };
      }
      return { signals: [], provider: 'claude' };
    }
  }

  /**
   * Generate evolution prompt using the best provider for the role.
   */
  async evolve(
    role: 'experimental' | 'optimizer' | 'synthesizer',
    systemPrompt: string,
    userPrompt: string,
  ): Promise<{ response: string; provider: AIProvider }> {
    const taskType = `evolution_${role}` as const;
    const provider = this.getBestProvider(taskType);
    const start = Date.now();

    try {
      let response: string;
      if (provider === 'ollama') {
        response = await this.ollama.evolve(systemPrompt, userPrompt);
      } else {
        throw new Error(`DELEGATE_TO_${provider.toUpperCase()}`);
      }

      this.recordSuccess(provider, Date.now() - start);
      return { response, provider };
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.startsWith('DELEGATE_TO_')) {
        return { response: '', provider };
      }
      this.recordFailure(provider);
      this.fallbacksTriggered++;
      return { response: '', provider: provider === 'ollama' ? 'venice' : 'claude' };
    }
  }

  /**
   * Get the Ollama engine directly (for prediction routing).
   */
  getOllamaEngine(): OllamaEngine | null {
    return this.providers.ollama.healthy ? this.ollama : null;
  }

  /**
   * Get router statistics.
   */
  getStats(): RouterStats {
    return {
      providers: { ...this.providers },
      currentPrimary: this.providers.ollama.healthy ? 'ollama' : this.providers.venice.healthy ? 'venice' : 'claude',
      routingDecisions: this.routingDecisions,
      fallbacksTriggered: this.fallbacksTriggered,
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async checkOllamaHealth(): Promise<void> {
    const wasHealthy = this.providers.ollama.healthy;
    const start = Date.now();

    try {
      const healthy = await this.ollama.isHealthy();
      this.providers.ollama.lastCheck = Date.now();

      if (healthy) {
        this.providers.ollama.healthy = true;
        this.providers.ollama.consecutiveFailures = 0;
        if (!wasHealthy) {
          console.log('[AIRouter] KS Ollama recovered -- routing fast tasks to local GPU');
        }
      } else {
        this.providers.ollama.consecutiveFailures++;
        if (this.providers.ollama.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          this.providers.ollama.healthy = false;
          if (wasHealthy) {
            console.warn('[AIRouter] KS Ollama DOWN -- falling back to Venice/Claude');
          }
        }
      }
    } catch {
      this.providers.ollama.consecutiveFailures++;
      this.providers.ollama.lastCheck = Date.now();
      if (this.providers.ollama.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this.providers.ollama.healthy = false;
        if (wasHealthy) {
          console.warn('[AIRouter] KS Ollama unreachable -- falling back to Venice/Claude');
        }
      }
    }
  }

  private recordSuccess(provider: AIProvider, latencyMs: number): void {
    const p = this.providers[provider];
    p.totalCalls++;
    p.consecutiveFailures = 0;
    // Exponential moving average for latency
    p.avgLatencyMs = p.avgLatencyMs === 0 ? latencyMs : p.avgLatencyMs * 0.8 + latencyMs * 0.2;
  }

  private recordFailure(provider: AIProvider): void {
    const p = this.providers[provider];
    p.totalCalls++;
    p.totalErrors++;
    p.consecutiveFailures++;
    if (p.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      p.healthy = false;
    }
  }
}
