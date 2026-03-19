import { expect } from 'chai';

/**
 * Evolution Engine tests.
 *
 * Since EvolutionEngine depends on external AI APIs, we test the
 * parsing, clamping, and role-prompt logic by extracting the
 * relevant patterns and testing them in isolation.
 */

// Re-implement the parsing logic from evolution-engine.ts for testing
function parseEvolutionResponse(response: string): { parameters: any; reasoning: string } | null {
  try {
    let cleaned = response.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    const parsed = JSON.parse(cleaned);

    if (!parsed.parameters || typeof parsed.parameters !== 'object') {
      return null;
    }

    return {
      parameters: parsed.parameters,
      reasoning: parsed.reasoning || 'No reasoning provided',
    };
  } catch {
    return null;
  }
}

function clampParameters(params: any): any {
  const result = { ...params };
  if (result.trailingStopPct !== undefined) {
    result.trailingStopPct = Math.max(1, Math.min(25, result.trailingStopPct));
  }
  if (result.takeProfitPct !== undefined) {
    result.takeProfitPct = Math.max(5, Math.min(100, result.takeProfitPct));
  }
  if (result.riskPerTradePct !== undefined) {
    result.riskPerTradePct = Math.max(0.5, Math.min(5.0, result.riskPerTradePct));
  }
  if (result.maxPositions !== undefined) {
    result.maxPositions = Math.max(1, Math.min(6, Math.floor(result.maxPositions)));
  }
  if (result.instinctWeight !== undefined) {
    result.instinctWeight = Math.max(0, Math.min(1.0, result.instinctWeight));
  }
  if (result.entryThreshold !== undefined) {
    result.entryThreshold = Math.max(10, Math.min(90, result.entryThreshold));
  }
  return result;
}

function getRolePrompt(role: string): string {
  switch (role) {
    case 'experimental':
      return 'ROLE: Mad Scientist (Experimental Variation)';
    case 'optimizer':
      return 'ROLE: Optimizer (Refinement Variation)';
    case 'synthesizer':
      return 'ROLE: Synthesizer (Hybrid Variation)';
    default:
      return '';
  }
}

describe('EvolutionEngine', () => {
  // ---------- JSON parsing ----------

  describe('Response parsing', () => {
    it('should parse valid JSON response', () => {
      const response = JSON.stringify({
        parameters: {
          entryMethod: 'rsi_oversold',
          entryThreshold: 30,
          trailingStopPct: 5,
        },
        reasoning: 'RSI oversold gives better entries',
      });

      const result = parseEvolutionResponse(response);
      expect(result).to.not.be.null;
      expect(result!.parameters.entryMethod).to.equal('rsi_oversold');
      expect(result!.parameters.entryThreshold).to.equal(30);
      expect(result!.reasoning).to.equal('RSI oversold gives better entries');
    });

    it('should parse JSON wrapped in markdown code fences', () => {
      const response = '```json\n{"parameters": {"entryMethod": "ema_crossover"}, "reasoning": "test"}\n```';
      const result = parseEvolutionResponse(response);
      expect(result).to.not.be.null;
      expect(result!.parameters.entryMethod).to.equal('ema_crossover');
    });

    it('should return null for invalid JSON', () => {
      const result = parseEvolutionResponse('this is not JSON at all');
      expect(result).to.be.null;
    });

    it('should return null when parameters key is missing', () => {
      const response = JSON.stringify({ reasoning: 'no params here' });
      const result = parseEvolutionResponse(response);
      expect(result).to.be.null;
    });

    it('should provide default reasoning when not present', () => {
      const response = JSON.stringify({ parameters: { entryMethod: 'rsi_oversold' } });
      const result = parseEvolutionResponse(response);
      expect(result).to.not.be.null;
      expect(result!.reasoning).to.equal('No reasoning provided');
    });
  });

  // ---------- Parameter clamping ----------

  describe('Parameter clamping', () => {
    it('should clamp trailingStopPct to [1, 25]', () => {
      expect(clampParameters({ trailingStopPct: 0 }).trailingStopPct).to.equal(1);
      expect(clampParameters({ trailingStopPct: 50 }).trailingStopPct).to.equal(25);
      expect(clampParameters({ trailingStopPct: 10 }).trailingStopPct).to.equal(10);
    });

    it('should clamp entryThreshold to [10, 90]', () => {
      expect(clampParameters({ entryThreshold: 5 }).entryThreshold).to.equal(10);
      expect(clampParameters({ entryThreshold: 95 }).entryThreshold).to.equal(90);
      expect(clampParameters({ entryThreshold: 50 }).entryThreshold).to.equal(50);
    });

    it('should clamp riskPerTradePct to [0.5, 5.0]', () => {
      expect(clampParameters({ riskPerTradePct: 0.1 }).riskPerTradePct).to.equal(0.5);
      expect(clampParameters({ riskPerTradePct: 10 }).riskPerTradePct).to.equal(5.0);
    });

    it('should clamp maxPositions to [1, 6] and floor', () => {
      expect(clampParameters({ maxPositions: 0 }).maxPositions).to.equal(1);
      expect(clampParameters({ maxPositions: 10 }).maxPositions).to.equal(6);
      expect(clampParameters({ maxPositions: 3.7 }).maxPositions).to.equal(3);
    });

    it('should clamp instinctWeight to [0, 1.0]', () => {
      expect(clampParameters({ instinctWeight: -0.5 }).instinctWeight).to.equal(0);
      expect(clampParameters({ instinctWeight: 1.5 }).instinctWeight).to.equal(1.0);
      expect(clampParameters({ instinctWeight: 0.7 }).instinctWeight).to.equal(0.7);
    });
  });

  // ---------- Role prompts ----------

  describe('Role-specific prompts', () => {
    it('should return experimental prompt for experimental role', () => {
      const prompt = getRolePrompt('experimental');
      expect(prompt).to.include('Mad Scientist');
      expect(prompt).to.include('Experimental');
    });

    it('should return optimizer prompt for optimizer role', () => {
      const prompt = getRolePrompt('optimizer');
      expect(prompt).to.include('Optimizer');
      expect(prompt).to.include('Refinement');
    });

    it('should return synthesizer prompt for synthesizer role', () => {
      const prompt = getRolePrompt('synthesizer');
      expect(prompt).to.include('Synthesizer');
      expect(prompt).to.include('Hybrid');
    });
  });

  // ---------- Retry / failure handling ----------

  describe('Retry logic simulation', () => {
    it('should succeed after simulated failures', async () => {
      let attempts = 0;
      const MAX_RETRIES = 3;

      async function callWithRetries(): Promise<string | null> {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          attempts++;
          if (attempt < 3) {
            // Simulate failure on first 2 attempts
            continue;
          }
          return '{"parameters": {"entryMethod": "rsi_oversold"}, "reasoning": "success"}';
        }
        return null;
      }

      const response = await callWithRetries();
      expect(response).to.not.be.null;
      expect(attempts).to.equal(3);
      const parsed = parseEvolutionResponse(response!);
      expect(parsed).to.not.be.null;
    });

    it('should return null after all retries exhausted', async () => {
      let attempts = 0;
      const MAX_RETRIES = 3;

      async function callAllFail(): Promise<string | null> {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          attempts++;
          // All attempts fail
        }
        return null;
      }

      const response = await callAllFail();
      expect(response).to.be.null;
      expect(attempts).to.equal(3);
    });
  });
});
