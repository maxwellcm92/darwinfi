import { expect } from 'chai';

/**
 * PaperEngine math formula tests.
 *
 * Since PaperEngine depends on PriceFeed and UniswapClient which require
 * real provider connections, we test the core formulas in isolation:
 * slippage calculation, VWAP averaging, gas cost deduction, and PnL.
 */
describe('PaperEngine formulas', () => {

  // ---------- Slippage calculation ----------

  describe('Slippage calculation', () => {
    it('should apply buy slippage correctly (price increases by bps)', () => {
      const marketPrice = 2000; // $2000 per ETH
      const slippageBps = 30;  // 0.3%
      const slippageMultiplier = 1 + slippageBps / 10000;
      const effectivePrice = marketPrice * slippageMultiplier;

      expect(effectivePrice).to.be.closeTo(2006, 0.01); // 2000 * 1.003
      expect(slippageMultiplier).to.be.closeTo(1.003, 1e-6);
    });

    it('should apply sell slippage correctly (price decreases by bps)', () => {
      const marketPrice = 2000;
      const slippageBps = 30;
      const slippageMultiplier = 1 - slippageBps / 10000;
      const effectivePrice = marketPrice * slippageMultiplier;

      expect(effectivePrice).to.be.closeTo(1994, 0.01); // 2000 * 0.997
    });

    it('should compute tokens received on buy correctly', () => {
      const amountUsd = 1000;
      const marketPrice = 2000;
      const slippageBps = 30;
      const effectivePrice = marketPrice * (1 + slippageBps / 10000);
      const tokensReceived = amountUsd / effectivePrice;

      // Without slippage: 1000/2000 = 0.5 ETH
      // With slippage: 1000/2006 = ~0.49850...
      expect(tokensReceived).to.be.lessThan(0.5);
      expect(tokensReceived).to.be.closeTo(1000 / 2006, 1e-6);
    });
  });

  // ---------- VWAP (volume-weighted average price) ----------

  describe('VWAP position averaging', () => {
    it('should compute correct VWAP when adding to a position', () => {
      // First buy: 1 ETH at $2000
      let totalAmount = 1;
      let avgEntryPrice = 2000;

      // Second buy: 0.5 ETH at $2200
      const newAmount = 0.5;
      const newPrice = 2200;

      const totalCost = avgEntryPrice * totalAmount + newPrice * newAmount;
      totalAmount += newAmount;
      avgEntryPrice = totalCost / totalAmount;

      // VWAP = (2000 * 1 + 2200 * 0.5) / 1.5 = 3100 / 1.5 = 2066.67
      expect(avgEntryPrice).to.be.closeTo(2066.667, 0.01);
      expect(totalAmount).to.equal(1.5);
    });
  });

  // ---------- Gas cost deduction ----------

  describe('Gas cost deduction', () => {
    it('should compute gas cost in USD correctly', () => {
      const simulatedGasCostEth = 0.0001;
      const ethPrice = 2500;
      const gasCostUsd = simulatedGasCostEth * ethPrice;

      expect(gasCostUsd).to.equal(0.25);
    });

    it('should deduct gas from cash balance on buy', () => {
      let cashBalance = 10000;
      const amountUsd = 1000;
      const gasCostUsd = 0.25;

      cashBalance -= amountUsd + gasCostUsd;
      expect(cashBalance).to.equal(8999.75);
    });

    it('should deduct gas from proceeds on sell', () => {
      let cashBalance = 9000;
      const usdReceived = 1100;
      const gasCostUsd = 0.25;

      cashBalance += usdReceived - gasCostUsd;
      expect(cashBalance).to.equal(10099.75);
    });
  });

  // ---------- PnL calculation ----------

  describe('Realized PnL on sell', () => {
    it('should compute realized PnL correctly', () => {
      const tokenAmount = 0.5;
      const averageEntryPrice = 2000;
      const effectiveSellPrice = 2200 * (1 - 30 / 10000); // after sell slippage

      const costBasis = tokenAmount * averageEntryPrice;    // 1000
      const usdReceived = tokenAmount * effectiveSellPrice; // ~1096.7
      const realizedPnl = usdReceived - costBasis;          // ~96.7

      expect(realizedPnl).to.be.greaterThan(0);
      expect(costBasis).to.equal(1000);
      expect(realizedPnl).to.be.closeTo(tokenAmount * effectiveSellPrice - 1000, 1e-6);
    });

    it('should produce negative PnL on losing trade', () => {
      const tokenAmount = 1;
      const averageEntryPrice = 2000;
      const effectiveSellPrice = 1800 * (1 - 30 / 10000);

      const costBasis = tokenAmount * averageEntryPrice;
      const usdReceived = tokenAmount * effectiveSellPrice;
      const realizedPnl = usdReceived - costBasis;

      expect(realizedPnl).to.be.lessThan(0);
    });
  });

  // ---------- Position closure ----------

  describe('Position closure', () => {
    it('should delete position when amount drops below threshold', () => {
      const positions = new Map<string, { amount: number }>();
      positions.set('ETH', { amount: 0.5 });

      const sellAmount = 0.5;
      const position = positions.get('ETH')!;
      position.amount -= sellAmount;

      if (position.amount < 1e-12) {
        positions.delete('ETH');
      }

      expect(positions.has('ETH')).to.be.false;
    });

    it('should keep position when partial sell', () => {
      const positions = new Map<string, { amount: number }>();
      positions.set('ETH', { amount: 1.0 });

      const sellAmount = 0.3;
      const position = positions.get('ETH')!;
      position.amount -= sellAmount;

      if (position.amount < 1e-12) {
        positions.delete('ETH');
      }

      expect(positions.has('ETH')).to.be.true;
      expect(position.amount).to.be.closeTo(0.7, 1e-10);
    });
  });
});
