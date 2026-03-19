/**
 * paper-engine.ts - Paper trading simulator
 *
 * Simulates trades using real price feeds from Uniswap V3 pools.
 * Tracks virtual portfolios per strategy, records entry/exit prices,
 * PnL, and timestamps. Mirrors on-chain conditions with slippage
 * simulation and gas estimation.
 */

import { PriceFeed, PriceData, TOKEN_UNIVERSE } from './price-feed';
import { UniswapClient } from './uniswap-client';

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export type TradeAction = 'buy' | 'sell';

export interface TradeResult {
  tradeId: string;
  strategyId: string;
  action: TradeAction;
  tokenSymbol: string;
  tokenAddress: string;
  /** Amount of input token */
  amountIn: string;
  /** Amount of output token received */
  amountOut: string;
  /** Execution price (USD per token) */
  executionPrice: number;
  /** Simulated slippage applied */
  slippageBps: number;
  /** Estimated gas cost in ETH */
  estimatedGasCostEth: string;
  /** PnL for this trade (only meaningful on sells) */
  realizedPnl: number;
  /** Unrealized PnL at time of trade */
  unrealizedPnl: number;
  timestamp: number;
  success: boolean;
  error?: string;
}

export interface Position {
  tokenSymbol: string;
  tokenAddress: string;
  /** Total amount held */
  amount: number;
  /** Volume-weighted average entry price (USD) */
  averageEntryPrice: number;
  /** Current market price (USD) */
  currentPrice: number;
  /** Unrealized PnL in USD */
  unrealizedPnl: number;
  /** Unrealized PnL as a percentage */
  unrealizedPnlPercent: number;
  /** When the position was first opened */
  openedAt: number;
  /** When the position was last modified */
  updatedAt: number;
}

export interface StrategyPortfolio {
  strategyId: string;
  /** Starting capital in USD */
  initialCapitalUsd: number;
  /** Current cash balance in USD (USDC equivalent) */
  cashBalanceUsd: number;
  /** Open positions */
  positions: Map<string, Position>;
  /** Total realized PnL across all closed trades */
  totalRealizedPnl: number;
  /** Total number of trades executed */
  tradeCount: number;
  /** Trade history */
  trades: TradeResult[];
}

export interface PaperEngineConfig {
  /** Default slippage simulation in basis points (default: 30 = 0.3%) */
  defaultSlippageBps?: number;
  /** Simulated gas cost per swap in ETH (default: 0.0001) */
  simulatedGasCostEth?: number;
  /** Maximum number of trades to keep in history per strategy */
  maxTradeHistory?: number;
}

// -------------------------------------------------------------------
// PaperEngine
// -------------------------------------------------------------------

export class PaperEngine {
  private priceFeed: PriceFeed;
  private uniswap: UniswapClient;
  private portfolios: Map<string, StrategyPortfolio> = new Map();
  private tradeCounter = 0;

  private defaultSlippageBps: number;
  private simulatedGasCostEth: number;
  private maxTradeHistory: number;

  constructor(config?: PaperEngineConfig, priceFeed?: PriceFeed, uniswap?: UniswapClient) {
    this.uniswap = uniswap ?? new UniswapClient();
    this.priceFeed = priceFeed ?? new PriceFeed(this.uniswap);
    this.defaultSlippageBps = config?.defaultSlippageBps ?? 30;
    this.simulatedGasCostEth = config?.simulatedGasCostEth ?? 0.0001;
    this.maxTradeHistory = config?.maxTradeHistory ?? 1000;
  }

  // ---------------------------------------------------------------
  // Portfolio management
  // ---------------------------------------------------------------

  /**
   * Initialize a virtual portfolio for a strategy.
   */
  initializePortfolio(strategyId: string, initialCapitalUsd: number): StrategyPortfolio {
    const portfolio: StrategyPortfolio = {
      strategyId,
      initialCapitalUsd,
      cashBalanceUsd: initialCapitalUsd,
      positions: new Map(),
      totalRealizedPnl: 0,
      tradeCount: 0,
      trades: [],
    };
    this.portfolios.set(strategyId, portfolio);
    return portfolio;
  }

  /**
   * Get or create a portfolio for a strategy.
   */
  getPortfolio(strategyId: string): StrategyPortfolio {
    const portfolio = this.portfolios.get(strategyId);
    if (!portfolio) {
      throw new Error(
        `No portfolio found for strategy '${strategyId}'. ` +
        `Call initializePortfolio() first.`
      );
    }
    return portfolio;
  }

  // ---------------------------------------------------------------
  // Trade execution
  // ---------------------------------------------------------------

  /**
   * Execute a simulated trade.
   *
   * @param strategyId - Strategy that is placing the trade
   * @param action - 'buy' or 'sell'
   * @param tokenSymbol - Token symbol (e.g., 'ETH', 'UNI')
   * @param amount - Amount in USD for buys, amount in tokens for sells
   */
  async executePaperTrade(
    strategyId: string,
    action: TradeAction,
    tokenSymbol: string,
    amount: number
  ): Promise<TradeResult> {
    const portfolio = this.getPortfolio(strategyId);
    const tokenDef = TOKEN_UNIVERSE[tokenSymbol];
    if (!tokenDef) {
      return this.failedTrade(strategyId, action, tokenSymbol, `Unknown token: ${tokenSymbol}`);
    }

    try {
      // Fetch current price
      const priceData = await this.priceFeed.getPrice(tokenSymbol);

      if (action === 'buy') {
        return await this.executeBuy(portfolio, tokenSymbol, tokenDef.address, amount, priceData);
      } else {
        return await this.executeSell(portfolio, tokenSymbol, tokenDef.address, amount, priceData);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return this.failedTrade(strategyId, action, tokenSymbol, msg);
    }
  }

  // ---------------------------------------------------------------
  // Position queries
  // ---------------------------------------------------------------

  /**
   * Get all open positions for a strategy, with updated unrealized PnL.
   */
  async getPositions(strategyId: string): Promise<Position[]> {
    const portfolio = this.getPortfolio(strategyId);
    const positions: Position[] = [];

    for (const [symbol, position] of portfolio.positions) {
      try {
        const price = await this.priceFeed.getPrice(symbol);
        position.currentPrice = price.priceUsd;
        position.unrealizedPnl =
          (price.priceUsd - position.averageEntryPrice) * position.amount;
        position.unrealizedPnlPercent =
          position.averageEntryPrice > 0
            ? ((price.priceUsd - position.averageEntryPrice) / position.averageEntryPrice) * 100
            : 0;
      } catch {
        // Keep stale price if feed fails
      }
      positions.push({ ...position });
    }

    return positions;
  }

  /**
   * Get portfolio summary with total value and performance.
   */
  async getPortfolioSummary(strategyId: string): Promise<{
    strategyId: string;
    initialCapital: number;
    cashBalance: number;
    positionsValue: number;
    totalValue: number;
    totalReturn: number;
    totalReturnPercent: number;
    realizedPnl: number;
    unrealizedPnl: number;
    tradeCount: number;
    openPositions: number;
  }> {
    const portfolio = this.getPortfolio(strategyId);
    const positions = await this.getPositions(strategyId);

    const positionsValue = positions.reduce(
      (sum, p) => sum + p.amount * p.currentPrice,
      0
    );
    const unrealizedPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
    const totalValue = portfolio.cashBalanceUsd + positionsValue;
    const totalReturn = totalValue - portfolio.initialCapitalUsd;

    return {
      strategyId,
      initialCapital: portfolio.initialCapitalUsd,
      cashBalance: portfolio.cashBalanceUsd,
      positionsValue,
      totalValue,
      totalReturn,
      totalReturnPercent:
        portfolio.initialCapitalUsd > 0
          ? (totalReturn / portfolio.initialCapitalUsd) * 100
          : 0,
      realizedPnl: portfolio.totalRealizedPnl,
      unrealizedPnl,
      tradeCount: portfolio.tradeCount,
      openPositions: portfolio.positions.size,
    };
  }

  /**
   * Get trade history for a strategy.
   */
  getTradeHistory(strategyId: string, limit?: number): TradeResult[] {
    const portfolio = this.getPortfolio(strategyId);
    const trades = portfolio.trades;
    if (limit) {
      return trades.slice(-limit);
    }
    return [...trades];
  }

  // ---------------------------------------------------------------
  // Internal: Buy execution
  // ---------------------------------------------------------------

  private async executeBuy(
    portfolio: StrategyPortfolio,
    tokenSymbol: string,
    tokenAddress: string,
    amountUsd: number,
    priceData: PriceData
  ): Promise<TradeResult> {
    // Validate cash balance
    if (amountUsd > portfolio.cashBalanceUsd) {
      return this.failedTrade(
        portfolio.strategyId,
        'buy',
        tokenSymbol,
        `Insufficient cash: have $${portfolio.cashBalanceUsd.toFixed(2)}, need $${amountUsd.toFixed(2)}`
      );
    }

    // Simulate slippage: effective price is worse by slippageBps
    const slippageMultiplier = 1 + this.defaultSlippageBps / 10000;
    const effectivePrice = priceData.priceUsd * slippageMultiplier;
    const tokensReceived = amountUsd / effectivePrice;

    // Simulate gas cost deduction
    const ethPrice = tokenSymbol === 'ETH' ? priceData.priceUsd : (await this.priceFeed.getPrice('ETH')).priceUsd;
    const gasCostUsd = this.simulatedGasCostEth * ethPrice;

    // Deduct from portfolio
    portfolio.cashBalanceUsd -= amountUsd + gasCostUsd;

    // Update or create position
    const existingPosition = portfolio.positions.get(tokenSymbol);
    if (existingPosition) {
      // Weighted average entry price
      const totalCost =
        existingPosition.averageEntryPrice * existingPosition.amount +
        effectivePrice * tokensReceived;
      const totalAmount = existingPosition.amount + tokensReceived;
      existingPosition.averageEntryPrice = totalCost / totalAmount;
      existingPosition.amount = totalAmount;
      existingPosition.currentPrice = priceData.priceUsd;
      existingPosition.updatedAt = Date.now();
    } else {
      portfolio.positions.set(tokenSymbol, {
        tokenSymbol,
        tokenAddress,
        amount: tokensReceived,
        averageEntryPrice: effectivePrice,
        currentPrice: priceData.priceUsd,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        openedAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    // Record trade
    const trade = this.buildTradeResult(
      portfolio.strategyId,
      'buy',
      tokenSymbol,
      tokenAddress,
      amountUsd.toString(),
      tokensReceived.toString(),
      effectivePrice,
      0, // No realized PnL on buy
      0
    );

    this.recordTrade(portfolio, trade);
    return trade;
  }

  // ---------------------------------------------------------------
  // Internal: Sell execution
  // ---------------------------------------------------------------

  private async executeSell(
    portfolio: StrategyPortfolio,
    tokenSymbol: string,
    tokenAddress: string,
    tokenAmount: number,
    priceData: PriceData
  ): Promise<TradeResult> {
    const position = portfolio.positions.get(tokenSymbol);
    if (!position) {
      return this.failedTrade(
        portfolio.strategyId,
        'sell',
        tokenSymbol,
        `No open position in ${tokenSymbol}`
      );
    }

    if (tokenAmount > position.amount) {
      return this.failedTrade(
        portfolio.strategyId,
        'sell',
        tokenSymbol,
        `Insufficient balance: have ${position.amount.toFixed(6)}, trying to sell ${tokenAmount.toFixed(6)}`
      );
    }

    // Simulate slippage: effective price is worse (lower) by slippageBps
    const slippageMultiplier = 1 - this.defaultSlippageBps / 10000;
    const effectivePrice = priceData.priceUsd * slippageMultiplier;
    const usdReceived = tokenAmount * effectivePrice;

    // Calculate realized PnL
    const costBasis = tokenAmount * position.averageEntryPrice;
    const realizedPnl = usdReceived - costBasis;

    // Simulate gas cost deduction
    const ethPrice = tokenSymbol === 'ETH' ? priceData.priceUsd : (await this.priceFeed.getPrice('ETH')).priceUsd;
    const gasCostUsd = this.simulatedGasCostEth * ethPrice;

    // Update portfolio
    portfolio.cashBalanceUsd += usdReceived - gasCostUsd;
    portfolio.totalRealizedPnl += realizedPnl;

    // Update or close position
    position.amount -= tokenAmount;
    position.updatedAt = Date.now();
    if (position.amount < 1e-12) {
      // Position effectively closed
      portfolio.positions.delete(tokenSymbol);
    }

    // Calculate remaining unrealized PnL
    const unrealizedPnl = position.amount > 0
      ? (priceData.priceUsd - position.averageEntryPrice) * position.amount
      : 0;

    // Record trade
    const trade = this.buildTradeResult(
      portfolio.strategyId,
      'sell',
      tokenSymbol,
      tokenAddress,
      tokenAmount.toString(),
      usdReceived.toString(),
      effectivePrice,
      realizedPnl,
      unrealizedPnl
    );

    this.recordTrade(portfolio, trade);
    return trade;
  }

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------

  private buildTradeResult(
    strategyId: string,
    action: TradeAction,
    tokenSymbol: string,
    tokenAddress: string,
    amountIn: string,
    amountOut: string,
    executionPrice: number,
    realizedPnl: number,
    unrealizedPnl: number
  ): TradeResult {
    this.tradeCounter++;
    return {
      tradeId: `paper-${this.tradeCounter}-${Date.now()}`,
      strategyId,
      action,
      tokenSymbol,
      tokenAddress,
      amountIn,
      amountOut,
      executionPrice,
      slippageBps: this.defaultSlippageBps,
      estimatedGasCostEth: this.simulatedGasCostEth.toFixed(6),
      realizedPnl,
      unrealizedPnl,
      timestamp: Date.now(),
      success: true,
    };
  }

  private failedTrade(
    strategyId: string,
    action: TradeAction,
    tokenSymbol: string,
    error: string
  ): TradeResult {
    this.tradeCounter++;
    return {
      tradeId: `paper-${this.tradeCounter}-${Date.now()}`,
      strategyId,
      action,
      tokenSymbol,
      tokenAddress: TOKEN_UNIVERSE[tokenSymbol]?.address ?? '0x0',
      amountIn: '0',
      amountOut: '0',
      executionPrice: 0,
      slippageBps: 0,
      estimatedGasCostEth: '0',
      realizedPnl: 0,
      unrealizedPnl: 0,
      timestamp: Date.now(),
      success: false,
      error,
    };
  }

  private recordTrade(portfolio: StrategyPortfolio, trade: TradeResult): void {
    portfolio.tradeCount++;
    portfolio.trades.push(trade);

    // Trim history if too large
    if (portfolio.trades.length > this.maxTradeHistory) {
      portfolio.trades = portfolio.trades.slice(-this.maxTradeHistory);
    }
  }
}
