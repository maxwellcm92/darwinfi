/**
 * ai-baseline-test.ts - AI vs Baseline Comparison (C3 Audit Item)
 *
 * Loads agent-state.json, extracts closed trades across 12 strategies,
 * and compares DarwinFi AI performance against:
 *   1. Random baseline (1000 Monte Carlo simulations)
 *   2. Buy-and-hold ETH baseline
 *
 * Usage: npx ts-node scripts/ai-baseline-test.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

interface Trade {
  tradeId: string;
  strategy: string;
  token: string;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  pnlPct: number;
  entryTime: string;
  exitTime: string;
}

interface StrategyPerf {
  totalPnL: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  tradesCompleted: number;
}

interface AgentState {
  version: number;
  savedAt: string;
  agent: { startTime: string; tradeIdCounter: number };
  strategies: Array<{ id: string; name: string }>;
  performance: Record<string, StrategyPerf>;
  conversationLog: Array<{
    timestamp: string;
    type: string;
    summary: string;
    details?: any;
  }>;
}

interface BaselineResult {
  totalPnL: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  tradeCount: number;
}

// -------------------------------------------------------------------
// Extract trades from conversation log
// -------------------------------------------------------------------

function extractTrades(state: AgentState): Trade[] {
  const trades: Trade[] = [];
  const openTrades = new Map<string, any>();

  for (const entry of state.conversationLog) {
    if (entry.type !== 'trade') continue;
    const d = entry.details;
    if (!d) continue;

    if (d.exitPrice !== undefined && d.entryPrice !== undefined) {
      // This is a close/sell entry
      trades.push({
        tradeId: d.tradeId || 'unknown',
        strategy: d.strategy || 'unknown',
        token: d.token || 'ETH',
        entryPrice: d.entryPrice,
        exitPrice: d.exitPrice,
        pnl: d.pnl || 0,
        pnlPct: d.pnlPct || 0,
        entryTime: openTrades.get(d.tradeId)?.timestamp || entry.timestamp,
        exitTime: entry.timestamp,
      });
    } else if (d.price !== undefined && !d.exitPrice) {
      // This is an open/buy entry
      openTrades.set(d.tradeId, {
        ...d,
        timestamp: entry.timestamp,
      });
    }
  }

  return trades;
}

// -------------------------------------------------------------------
// Calculate metrics
// -------------------------------------------------------------------

function calcSharpe(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (mean / std) * Math.sqrt(252); // Annualized
}

function calcMaxDrawdown(returns: number[]): number {
  if (returns.length === 0) return 0;
  let peak = 0;
  let cumulative = 0;
  let maxDD = 0;

  for (const r of returns) {
    cumulative += r;
    if (cumulative > peak) peak = cumulative;
    const dd = peak - cumulative;
    if (dd > maxDD) maxDD = dd;
  }

  return peak > 0 ? (maxDD / peak) * 100 : 0;
}

function analyzeAI(trades: Trade[]): BaselineResult {
  const returns = trades.map(t => t.pnlPct);
  const wins = trades.filter(t => t.pnl > 0).length;

  return {
    totalPnL: trades.reduce((a, t) => a + t.pnl, 0),
    winRate: trades.length > 0 ? (wins / trades.length) * 100 : 0,
    sharpeRatio: calcSharpe(returns),
    maxDrawdown: calcMaxDrawdown(returns),
    tradeCount: trades.length,
  };
}

// -------------------------------------------------------------------
// Random baseline (Monte Carlo)
// -------------------------------------------------------------------

function randomBaseline(trades: Trade[], simulations: number = 1000): BaselineResult {
  if (trades.length === 0) {
    return { totalPnL: 0, winRate: 50, sharpeRatio: 0, maxDrawdown: 0, tradeCount: 0 };
  }

  // For each real trade, simulate a random direction trade with same magnitude
  const allSimPnLs: number[] = [];
  const allSimWinRates: number[] = [];
  const allSimSharpes: number[] = [];
  const allSimMaxDDs: number[] = [];

  for (let sim = 0; sim < simulations; sim++) {
    const simReturns: number[] = [];
    let simPnL = 0;
    let simWins = 0;

    for (const trade of trades) {
      // Random direction: 50% chance of getting the actual return, 50% inverted
      const direction = Math.random() > 0.5 ? 1 : -1;
      const simReturn = Math.abs(trade.pnlPct) * direction;
      const simTradePnL = Math.abs(trade.pnl) * direction;

      simReturns.push(simReturn);
      simPnL += simTradePnL;
      if (simTradePnL > 0) simWins++;
    }

    allSimPnLs.push(simPnL);
    allSimWinRates.push((simWins / trades.length) * 100);
    allSimSharpes.push(calcSharpe(simReturns));
    allSimMaxDDs.push(calcMaxDrawdown(simReturns));
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  return {
    totalPnL: avg(allSimPnLs),
    winRate: avg(allSimWinRates),
    sharpeRatio: avg(allSimSharpes),
    maxDrawdown: avg(allSimMaxDDs),
    tradeCount: trades.length,
  };
}

// -------------------------------------------------------------------
// Buy-and-hold baseline
// -------------------------------------------------------------------

function buyAndHoldBaseline(trades: Trade[]): BaselineResult {
  if (trades.length === 0) {
    return { totalPnL: 0, winRate: 0, sharpeRatio: 0, maxDrawdown: 0, tradeCount: 0 };
  }

  // Find earliest entry and latest exit among ETH trades
  const ethTrades = trades.filter(t => t.token === 'ETH' || t.token === 'WETH');
  if (ethTrades.length === 0) {
    // Use all trades if no ETH-specific ones
    const firstPrice = trades[0].entryPrice;
    const lastPrice = trades[trades.length - 1].exitPrice;
    const pnlPct = ((lastPrice - firstPrice) / firstPrice) * 100;
    return {
      totalPnL: lastPrice - firstPrice,
      winRate: pnlPct > 0 ? 100 : 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      tradeCount: 1,
    };
  }

  const sortedByEntry = [...ethTrades].sort(
    (a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime()
  );
  const firstPrice = sortedByEntry[0].entryPrice;

  const sortedByExit = [...ethTrades].sort(
    (a, b) => new Date(b.exitTime).getTime() - new Date(a.exitTime).getTime()
  );
  const lastPrice = sortedByExit[0].exitPrice;

  const pnlPct = ((lastPrice - firstPrice) / firstPrice) * 100;
  // Scale to same capital as average trade size
  const avgTradeSize = ethTrades.reduce((a, t) => a + Math.abs(t.pnl / (t.pnlPct / 100)), 0) / ethTrades.length;
  const holdPnL = avgTradeSize * (pnlPct / 100);

  return {
    totalPnL: holdPnL,
    winRate: pnlPct > 0 ? 100 : 0,
    sharpeRatio: 0, // Single position, no series to compute
    maxDrawdown: pnlPct < 0 ? Math.abs(pnlPct) : 0,
    tradeCount: 1,
  };
}

// -------------------------------------------------------------------
// Output formatting
// -------------------------------------------------------------------

function fmt(n: number, decimals: number = 2): string {
  return n.toFixed(decimals);
}

function printTable(ai: BaselineResult, random: BaselineResult, hold: BaselineResult) {
  const pad = (s: string, w: number) => s.padStart(w);
  const w = 14;

  console.log('');
  console.log('| Metric         | DarwinFi AI    | Random (avg)   | Buy-and-Hold   |');
  console.log('|----------------|----------------|----------------|----------------|');
  console.log(`| Total PnL      | $${pad(fmt(ai.totalPnL), w-1)} | $${pad(fmt(random.totalPnL), w-1)} | $${pad(fmt(hold.totalPnL), w-1)} |`);
  console.log(`| Win Rate       | ${pad(fmt(ai.winRate) + '%', w)} | ${pad(fmt(random.winRate) + '%', w)} | ${pad('N/A', w)} |`);
  console.log(`| Sharpe Ratio   | ${pad(fmt(ai.sharpeRatio), w)} | ${pad(fmt(random.sharpeRatio), w)} | ${pad('N/A', w)} |`);
  console.log(`| Max Drawdown   | ${pad(fmt(ai.maxDrawdown) + '%', w)} | ${pad(fmt(random.maxDrawdown) + '%', w)} | ${pad(fmt(hold.maxDrawdown) + '%', w)} |`);
  console.log(`| Trade Count    | ${pad(String(ai.tradeCount), w)} | ${pad(String(random.tradeCount), w)} | ${pad(String(hold.tradeCount), w)} |`);
  console.log('');
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------

function main() {
  console.log('=== DarwinFi AI vs Baseline Comparison ===\n');

  // Load agent state
  const stateFile = path.join(__dirname, '..', 'data', 'agent-state.json');
  if (!fs.existsSync(stateFile)) {
    console.error('ERROR: data/agent-state.json not found.');
    process.exit(1);
  }

  const state: AgentState = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
  console.log(`Agent state saved: ${state.savedAt}`);
  console.log(`Strategies: ${state.strategies.length}`);
  console.log(`Loop count: ${state.agent.tradeIdCounter} trade IDs issued\n`);

  // Extract completed trades
  const trades = extractTrades(state);
  console.log(`Closed trades found: ${trades.length}`);

  if (trades.length === 0) {
    console.log('\nNo closed trades found in conversation log.');
    console.log('The agent has been running in paper/dry-run mode with signals');
    console.log('but limited completed round-trip trades.\n');

    // Still show aggregate performance from the performance object
    console.log('Strategy Performance Summary (from agent state):');
    console.log('| Strategy         | PnL        | Win Rate | Trades |');
    console.log('|------------------|------------|----------|--------|');
    for (const [id, perf] of Object.entries(state.performance)) {
      const name = state.strategies.find(s => s.id === id)?.name || id;
      console.log(`| ${name.padEnd(16)} | $${fmt(perf.totalPnL).padStart(8)} | ${fmt(perf.winRate).padStart(6)}% | ${String(perf.tradesCompleted).padStart(6)} |`);
    }

    const totalTrades = Object.values(state.performance).reduce((a, p) => a + p.tradesCompleted, 0);
    const totalPnL = Object.values(state.performance).reduce((a, p) => a + p.totalPnL, 0);
    console.log(`\nAggregate: ${totalTrades} trades, $${fmt(totalPnL)} total PnL`);
    console.log('\nNote: Data is sparse (early-stage agent). This framework is designed');
    console.log('for statistical comparison once the agent accumulates more trade data.');
    console.log('Results should be interpreted as preliminary.\n');
    return;
  }

  // Print trade details
  console.log('\nTrade Details:');
  for (const t of trades) {
    console.log(`  ${t.strategy}: ${t.token} entry=$${fmt(t.entryPrice)} exit=$${fmt(t.exitPrice)} pnl=$${fmt(t.pnl)} (${fmt(t.pnlPct)}%)`);
  }

  // Run analyses
  const aiResult = analyzeAI(trades);
  const randomResult = randomBaseline(trades, 1000);
  const holdResult = buyAndHoldBaseline(trades);

  // Print comparison table
  printTable(aiResult, randomResult, holdResult);

  // Interpretation
  console.log('Interpretation:');
  if (trades.length < 10) {
    console.log('  CAVEAT: Sample size is very small (< 10 trades). Results are preliminary');
    console.log('  and should not be treated as statistically significant. This framework');
    console.log('  demonstrates the comparison methodology; statistical power will improve');
    console.log('  as the agent accumulates more trade history.\n');
  }

  if (aiResult.totalPnL > randomResult.totalPnL) {
    console.log('  -> DarwinFi AI outperformed random trading baseline.');
  } else {
    console.log('  -> DarwinFi AI underperformed random baseline (expected in early stage).');
    console.log('  -> The evolutionary tournament is designed to improve over time as');
    console.log('     underperforming strategies are replaced by mutated top performers.');
  }

  if (aiResult.totalPnL > holdResult.totalPnL) {
    console.log('  -> DarwinFi AI outperformed buy-and-hold.');
  } else {
    console.log('  -> Buy-and-hold outperformed active trading (common in trending markets).');
  }

  console.log('');
}

main();
