/**
 * indicators.ts - Pure technical indicator computations
 *
 * All functions take a price history array (oldest first) and return
 * computed values. No side effects, no state.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PricePoint {
  price: number;
  timestamp: number;
}

export interface IndicatorSet {
  rsi?: number;
  ema9?: number;
  ema21?: number;
  macd?: number;
  macdSignal?: number;
  bollingerUpper?: number;
  bollingerLower?: number;
  bollingerMiddle?: number;
}

// ---------------------------------------------------------------------------
// EMA (Exponential Moving Average)
// ---------------------------------------------------------------------------

/**
 * Compute EMA for a given period. Returns the final EMA value, or undefined
 * if not enough data points.
 */
export function computeEMA(prices: number[], period: number): number | undefined {
  if (prices.length < period) return undefined;

  const k = 2 / (period + 1);

  // Seed with SMA of the first `period` values
  let ema = 0;
  for (let i = 0; i < period; i++) {
    ema += prices[i];
  }
  ema /= period;

  // Apply EMA formula for remaining values
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }

  return ema;
}

/**
 * Compute full EMA series (returns array of EMA values starting from index period-1).
 */
function computeEMASeries(prices: number[], period: number): number[] {
  if (prices.length < period) return [];

  const k = 2 / (period + 1);
  const result: number[] = [];

  // Seed with SMA
  let ema = 0;
  for (let i = 0; i < period; i++) {
    ema += prices[i];
  }
  ema /= period;
  result.push(ema);

  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
    result.push(ema);
  }

  return result;
}

// ---------------------------------------------------------------------------
// RSI (Relative Strength Index)
// ---------------------------------------------------------------------------

/**
 * Compute RSI-14 (or any period). Returns 0-100 or undefined if insufficient data.
 * Needs period+1 data points minimum (15 for RSI-14).
 */
export function computeRSI(prices: number[], period: number = 14): number | undefined {
  if (prices.length < period + 1) return undefined;

  let avgGain = 0;
  let avgLoss = 0;

  // Initial average gain/loss over first `period` changes
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  // Smoothed RSI for remaining data points
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ---------------------------------------------------------------------------
// MACD (Moving Average Convergence Divergence)
// ---------------------------------------------------------------------------

export interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
}

/**
 * Compute MACD(12,26,9). Returns undefined if insufficient data.
 * Needs at least 35 data points (26 for slow EMA + 9 for signal).
 */
export function computeMACD(
  prices: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9,
): MACDResult | undefined {
  if (prices.length < slowPeriod + signalPeriod) return undefined;

  const fastEMA = computeEMASeries(prices, fastPeriod);
  const slowEMA = computeEMASeries(prices, slowPeriod);

  if (fastEMA.length === 0 || slowEMA.length === 0) return undefined;

  // MACD line = fast EMA - slow EMA (aligned by index)
  // fastEMA starts at index fastPeriod-1, slowEMA at slowPeriod-1
  // We align them so the MACD line starts at slowPeriod-1
  const offset = slowPeriod - fastPeriod;
  const macdLine: number[] = [];
  for (let i = 0; i < slowEMA.length; i++) {
    macdLine.push(fastEMA[i + offset] - slowEMA[i]);
  }

  if (macdLine.length < signalPeriod) return undefined;

  // Signal line = EMA of MACD line
  const signalLine = computeEMASeries(macdLine, signalPeriod);
  if (signalLine.length === 0) return undefined;

  const macd = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];

  return {
    macd,
    signal,
    histogram: macd - signal,
  };
}

// ---------------------------------------------------------------------------
// Bollinger Bands
// ---------------------------------------------------------------------------

export interface BollingerResult {
  upper: number;
  middle: number;
  lower: number;
}

/**
 * Compute Bollinger Bands(20,2). Returns undefined if insufficient data.
 */
export function computeBollingerBands(
  prices: number[],
  period: number = 20,
  stdDevMultiplier: number = 2,
): BollingerResult | undefined {
  if (prices.length < period) return undefined;

  // SMA of last `period` prices
  const slice = prices.slice(-period);
  const sma = slice.reduce((a, b) => a + b, 0) / period;

  // Standard deviation
  const variance = slice.reduce((sum, p) => sum + (p - sma) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);

  return {
    upper: sma + stdDevMultiplier * stdDev,
    middle: sma,
    lower: sma - stdDevMultiplier * stdDev,
  };
}

// ---------------------------------------------------------------------------
// All-in-one computation
// ---------------------------------------------------------------------------

/**
 * Compute all available indicators from a price history buffer.
 * Returns whatever is computable given the data length.
 */
export function computeAllIndicators(history: PricePoint[]): IndicatorSet {
  if (history.length < 2) return {};

  const prices = history.map(h => h.price);
  const result: IndicatorSet = {};

  // RSI-14 (needs 15 points)
  const rsi = computeRSI(prices, 14);
  if (rsi !== undefined) result.rsi = rsi;

  // EMA-9 and EMA-21
  const ema9 = computeEMA(prices, 9);
  if (ema9 !== undefined) result.ema9 = ema9;

  const ema21 = computeEMA(prices, 21);
  if (ema21 !== undefined) result.ema21 = ema21;

  // MACD(12,26,9) (needs 35 points)
  const macdResult = computeMACD(prices, 12, 26, 9);
  if (macdResult) {
    result.macd = macdResult.macd;
    result.macdSignal = macdResult.signal;
  }

  // Bollinger Bands(20,2) (needs 20 points)
  const bb = computeBollingerBands(prices, 20, 2);
  if (bb) {
    result.bollingerUpper = bb.upper;
    result.bollingerLower = bb.lower;
    result.bollingerMiddle = bb.middle;
  }

  return result;
}
