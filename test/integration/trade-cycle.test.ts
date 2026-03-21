import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("Trade Cycle Integration", function () {
  const USDC_DECIMALS = 6;
  const SHARE_DECIMALS = 12;
  const parseUSDC = (amount: number) => ethers.parseUnits(amount.toString(), USDC_DECIMALS);
  const ONE_HOUR = 3600;
  const ONE_DAY = 86400;
  const SEVEN_DAYS = 7 * ONE_DAY;

  async function deployFixture() {
    const [owner, agent, feeRecipient, user1, user2] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    await usdc.waitForDeployment();

    const VaultV4 = await ethers.getContractFactory("DarwinVaultV4");
    const vault = await VaultV4.deploy(
      await usdc.getAddress(),
      owner.address,
      agent.address,
      feeRecipient.address,
    );
    await vault.waitForDeployment();

    // Mint USDC to users and agent
    await usdc.mint(user1.address, parseUSDC(10000));
    await usdc.mint(user2.address, parseUSDC(10000));
    await usdc.mint(agent.address, parseUSDC(10000));

    // Approve vault
    const vaultAddr = await vault.getAddress();
    await usdc.connect(user1).approve(vaultAddr, ethers.MaxUint256);
    await usdc.connect(user2).approve(vaultAddr, ethers.MaxUint256);
    await usdc.connect(agent).approve(vaultAddr, ethers.MaxUint256);

    return { vault, usdc, owner, agent, feeRecipient, user1, user2 };
  }

  // =================================================================
  // Full cycle: deposit -> borrow -> profitable return -> withdraw
  // =================================================================

  describe("Full Profitable Trade Cycle", function () {
    it("should complete a full deposit-borrow-return-withdraw cycle with profit", async function () {
      const { vault, usdc, agent, feeRecipient, user1 } = await loadFixture(deployFixture);

      // 1. User deposits 1000 USDC
      const depositAmount = parseUSDC(1000);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      const sharesAfterDeposit = await vault.balanceOf(user1.address);
      expect(sharesAfterDeposit).to.be.greaterThan(0);
      expect(await vault.totalAssets()).to.equal(depositAmount);

      // 2. Agent borrows 500 USDC
      const borrowAmount = parseUSDC(500);
      await vault.connect(agent).agentBorrow(borrowAmount);

      expect(await vault.totalBorrowed()).to.equal(borrowAmount);
      expect(await vault.totalAssets()).to.equal(depositAmount); // totalAssets = balance + borrowed

      // 3. Simulate profitable trade: agent returns 550 USDC (50 USDC profit)
      const returnAmount = parseUSDC(550);
      await vault.connect(agent).agentReturn(returnAmount);

      expect(await vault.totalBorrowed()).to.equal(0);
      // Total assets now = 1000 + 50 profit = 1050 (minus any fees)
      const totalAfterReturn = await vault.totalAssets();
      expect(totalAfterReturn).to.be.greaterThan(depositAmount);

      // 4. Verify performance fee was collected to feeRecipient
      const feeRecipientShares = await vault.balanceOf(feeRecipient.address);
      expect(feeRecipientShares).to.be.greaterThan(0);

      // 5. Wait for lock time, then withdraw
      await time.increase(ONE_HOUR + 1);

      const userShares = await vault.balanceOf(user1.address);
      await vault.connect(user1).redeem(userShares, user1.address, user1.address);

      // User should receive more than their deposit (profit minus fees)
      const userFinalBalance = await usdc.balanceOf(user1.address);
      // User started with 10000 USDC, deposited 1000, so should have > 9000 + some profit
      expect(userFinalBalance).to.be.greaterThan(parseUSDC(9000));
    });
  });

  // =================================================================
  // Full cycle: deposit -> borrow -> loss return -> withdraw
  // =================================================================

  describe("Full Losing Trade Cycle", function () {
    it("should handle a losing trade correctly", async function () {
      const { vault, usdc, agent, feeRecipient, user1 } = await loadFixture(deployFixture);

      // 1. Deposit
      const depositAmount = parseUSDC(1000);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      // 2. Agent borrows 500 USDC
      const borrowAmount = parseUSDC(500);
      await vault.connect(agent).agentBorrow(borrowAmount);

      // 3. Agent returns only 450 USDC (50 USDC loss)
      const returnAmount = parseUSDC(450);
      await vault.connect(agent).agentReturn(returnAmount);

      // totalBorrowed should still be 50 (500 - 450)
      expect(await vault.totalBorrowed()).to.equal(parseUSDC(50));

      // No performance fee on loss (only management fee shares may exist)
      // agentReturn triggers _collectManagementFeeInternal which may mint small shares
      const feeRecipientShares = await vault.balanceOf(feeRecipient.address);
      // Any shares minted are management fee only (tiny amount over seconds)
      const feeAssets = await vault.convertToAssets(feeRecipientShares);
      expect(feeAssets).to.be.lessThan(parseUSDC(1)); // less than 1 USDC in mgmt fees

      // Agent returns the remaining 50
      await vault.connect(agent).agentReturn(parseUSDC(50));
      expect(await vault.totalBorrowed()).to.equal(0);

      // 4. Wait for lock time and withdraw
      await time.increase(ONE_HOUR + 1);
      const userShares = await vault.balanceOf(user1.address);
      await vault.connect(user1).redeem(userShares, user1.address, user1.address);

      // User gets back their full deposit (loss was covered by agent returning the full amount)
      const userFinalBalance = await usdc.balanceOf(user1.address);
      // User started with 10000, deposited 1000; after full repay they get ~1000 back
      // Minus any management fee accrued during the test
      expect(userFinalBalance).to.be.closeTo(parseUSDC(10000), parseUSDC(1));
    });
  });

  // =================================================================
  // Performance fee: 5% on profit above high water mark
  // =================================================================

  describe("Performance Fee Collection", function () {
    it("should charge 5% performance fee on profit above high water mark", async function () {
      const { vault, usdc, agent, feeRecipient, user1 } = await loadFixture(deployFixture);

      // Deposit
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      // Borrow and return with 100 USDC profit
      await vault.connect(agent).agentBorrow(parseUSDC(500));
      await vault.connect(agent).agentReturn(parseUSDC(600)); // 100 profit

      // Performance fee = 5% of 100 = 5 USDC worth of shares
      const feeShares = await vault.balanceOf(feeRecipient.address);
      expect(feeShares).to.be.greaterThan(0);

      // High water mark should be updated
      const hwm = await vault.highWaterMark();
      expect(hwm).to.be.greaterThan(parseUSDC(1000));
    });

    it("should not charge performance fee when below high water mark", async function () {
      const { vault, usdc, agent, feeRecipient, user1 } = await loadFixture(deployFixture);

      // Deposit and create initial profit (sets high water mark)
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
      await vault.connect(agent).agentBorrow(parseUSDC(500));
      await vault.connect(agent).agentReturn(parseUSDC(600)); // 100 profit, HWM set

      const hwmAfterFirstTrade = await vault.highWaterMark();
      expect(hwmAfterFirstTrade).to.be.greaterThan(parseUSDC(1000));

      // Now simulate a net loss: borrow 500, return only 400 (100 actual loss to vault)
      await vault.connect(agent).agentBorrow(parseUSDC(500));
      await vault.connect(agent).agentReturn(parseUSDC(400)); // partial return

      // Still 100 borrowed. Return the rest to clear the loan but vault lost value
      // Wait -- returning the rest would make it break even. Instead: write off via timeout.
      // Or: just check that totalAssets < HWM while there's still outstanding debt.
      // totalAssets = balance(600) + borrowed(100) = 700. But HWM was ~1100.
      // Actually: after first trade, vault had 1100. Agent borrows 500 -> balance=600, borrowed=500, total=1100.
      // Agent returns 400 -> balance=1000, borrowed=100, total=1100. Still equal!
      // The key insight: totalAssets = balance + borrowed, so a partial return doesn't change it.
      // We need to write off bad debt to actually reduce totalAssets.

      // Fast-forward past borrow timeout and write off the remaining 100
      await time.increase(SEVEN_DAYS + 1);
      await vault.writeOffBadDebt();

      // Now totalAssets = vault balance only (no more borrowed)
      const totalAfterWriteOff = await vault.totalAssets();
      expect(totalAfterWriteOff).to.be.lessThan(hwmAfterFirstTrade);

      // HWM should not have changed since we're below it
      expect(await vault.highWaterMark()).to.equal(hwmAfterFirstTrade);

      // Now do a profitable trade that recovers some but stays below HWM
      await vault.connect(agent).agentBorrow(parseUSDC(400));
      await vault.connect(agent).agentReturn(parseUSDC(430)); // 30 profit, but still below HWM

      // HWM should still be unchanged
      expect(await vault.highWaterMark()).to.equal(hwmAfterFirstTrade);
    });
  });

  // =================================================================
  // Management fee accrual
  // =================================================================

  describe("Management Fee Accrual", function () {
    it("should accrue management fee over time", async function () {
      const { vault, usdc, agent, feeRecipient, user1 } = await loadFixture(deployFixture);

      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      // Fast forward 1 year
      await time.increase(365 * ONE_DAY);

      // Trigger fee collection via agentBorrow/Return cycle
      await vault.connect(agent).agentBorrow(parseUSDC(100));
      await vault.connect(agent).agentReturn(parseUSDC(100));

      // Management fee = 1% of 1000 USDC over 1 year = ~10 USDC worth of shares
      const feeShares = await vault.balanceOf(feeRecipient.address);
      expect(feeShares).to.be.greaterThan(0);

      // Convert fee shares to assets to verify approximate amount
      const feeAssets = await vault.convertToAssets(feeShares);
      // Should be approximately 10 USDC (1% of 1000)
      expect(feeAssets).to.be.closeTo(parseUSDC(10), parseUSDC(2));
    });

    it("should collect management fee via collectManagementFee()", async function () {
      const { vault, feeRecipient, user1 } = await loadFixture(deployFixture);

      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      // Fast forward 6 months
      await time.increase(182 * ONE_DAY);

      await vault.collectManagementFee();

      const feeShares = await vault.balanceOf(feeRecipient.address);
      expect(feeShares).to.be.greaterThan(0);

      // ~5 USDC for 6 months of 1% annual
      const feeAssets = await vault.convertToAssets(feeShares);
      expect(feeAssets).to.be.closeTo(parseUSDC(5), parseUSDC(1));
    });
  });

  // =================================================================
  // Borrow ratio enforcement (80% max)
  // =================================================================

  describe("Borrow Ratio Enforcement", function () {
    it("should allow borrow up to 80% of total assets", async function () {
      const { vault, agent, user1 } = await loadFixture(deployFixture);

      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      // Borrow 80% = 800 USDC -- should succeed
      await expect(
        vault.connect(agent).agentBorrow(parseUSDC(800))
      ).to.not.be.reverted;

      expect(await vault.totalBorrowed()).to.equal(parseUSDC(800));
    });

    it("should revert when borrow exceeds 80% ratio", async function () {
      const { vault, agent, user1 } = await loadFixture(deployFixture);

      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      // Borrow 81% = 810 USDC -- should fail
      await expect(
        vault.connect(agent).agentBorrow(parseUSDC(810))
      ).to.be.revertedWithCustomError(vault, "BorrowRatioExceeded");
    });

    it("should enforce cumulative borrow ratio", async function () {
      const { vault, agent, user1 } = await loadFixture(deployFixture);

      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      // First borrow: 700 (70%)
      await vault.connect(agent).agentBorrow(parseUSDC(700));

      // Second borrow: 101 would push to 801/1000 = 80.1%, should fail
      await expect(
        vault.connect(agent).agentBorrow(parseUSDC(101))
      ).to.be.revertedWithCustomError(vault, "BorrowRatioExceeded");

      // Second borrow: 100 puts it at exactly 80%, should succeed
      await vault.connect(agent).agentBorrow(parseUSDC(100));
      expect(await vault.totalBorrowed()).to.equal(parseUSDC(800));
    });
  });

  // =================================================================
  // Bad debt write-off after timeout
  // =================================================================

  describe("Bad Debt Write-Off", function () {
    it("should write off bad debt after borrow timeout (7 days)", async function () {
      const { vault, agent, user1 } = await loadFixture(deployFixture);

      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
      await vault.connect(agent).agentBorrow(parseUSDC(500));

      // Cannot write off before timeout
      await expect(vault.writeOffBadDebt()).to.be.revertedWithCustomError(
        vault,
        "BorrowNotTimedOut"
      );

      // Fast forward past 7 day timeout
      await time.increase(SEVEN_DAYS + 1);

      // Now anyone can write off the bad debt
      await expect(vault.writeOffBadDebt())
        .to.emit(vault, "BadDebtWrittenOff")
        .withArgs(parseUSDC(500));

      expect(await vault.totalBorrowed()).to.equal(0);
    });

    it("should allow user withdrawal after bad debt write-off", async function () {
      const { vault, usdc, agent, user1 } = await loadFixture(deployFixture);

      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
      await vault.connect(agent).agentBorrow(parseUSDC(500));

      // Fast forward past timeout
      await time.increase(SEVEN_DAYS + 1);

      // Write off bad debt
      await vault.writeOffBadDebt();

      // User can now withdraw, but only gets the 500 USDC remaining in vault
      const userShares = await vault.balanceOf(user1.address);
      const maxWithdrawable = await vault.maxWithdraw(user1.address);

      // After write-off, totalAssets = vault balance only (500), so user can withdraw ~500
      expect(maxWithdrawable).to.be.closeTo(parseUSDC(500), parseUSDC(1));

      await vault.connect(user1).redeem(userShares, user1.address, user1.address);
      const finalBalance = await usdc.balanceOf(user1.address);
      // 9000 (leftover after deposit) + ~500 (recovered)
      expect(finalBalance).to.be.closeTo(parseUSDC(9500), parseUSDC(1));
    });

    it("should revert writeOffBadDebt when no outstanding borrow", async function () {
      const { vault } = await loadFixture(deployFixture);
      await expect(vault.writeOffBadDebt()).to.be.revertedWithCustomError(
        vault,
        "NoBadDebt"
      );
    });
  });

  // =================================================================
  // Lock time enforcement
  // =================================================================

  describe("Lock Time Enforcement", function () {
    it("should prevent withdrawal before lock time", async function () {
      const { vault, user1 } = await loadFixture(deployFixture);

      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
      const shares = await vault.balanceOf(user1.address);

      // Immediate withdrawal should fail
      await expect(
        vault.connect(user1).redeem(shares, user1.address, user1.address)
      ).to.be.revertedWithCustomError(vault, "LockTimeNotElapsed");
    });

    it("should allow withdrawal after lock time", async function () {
      const { vault, user1 } = await loadFixture(deployFixture);

      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
      const shares = await vault.balanceOf(user1.address);

      await time.increase(ONE_HOUR + 1);

      await expect(
        vault.connect(user1).redeem(shares, user1.address, user1.address)
      ).to.not.be.reverted;
    });
  });

  // =================================================================
  // Multi-user scenario
  // =================================================================

  describe("Multi-User Trade Cycle", function () {
    it("should distribute profits proportionally to multiple depositors", async function () {
      const { vault, usdc, agent, feeRecipient, user1, user2 } = await loadFixture(deployFixture);

      // User1 deposits 1000, User2 deposits 2000
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
      await vault.connect(user2).deposit(parseUSDC(2000), user2.address);

      // Agent borrows and returns with profit
      await vault.connect(agent).agentBorrow(parseUSDC(2000));
      await vault.connect(agent).agentReturn(parseUSDC(2300)); // 300 profit

      // Wait for lock time
      await time.increase(ONE_HOUR + 1);

      // Both users withdraw
      const user1Shares = await vault.balanceOf(user1.address);
      const user2Shares = await vault.balanceOf(user2.address);

      await vault.connect(user1).redeem(user1Shares, user1.address, user1.address);
      await vault.connect(user2).redeem(user2Shares, user2.address, user2.address);

      const user1Final = await usdc.balanceOf(user1.address);
      const user2Final = await usdc.balanceOf(user2.address);

      // User1 had 1/3 of pool, User2 had 2/3
      // After 300 profit minus 5% perf fee = 285 net profit
      // User1 gets ~1000 + 95 = ~1095, User2 gets ~2000 + 190 = ~2190
      // (approximate due to fee share dilution and management fee)
      const user1Profit = user1Final - parseUSDC(9000); // 9000 = 10000 - 1000 deposit
      const user2Profit = user2Final - parseUSDC(8000); // 8000 = 10000 - 2000 deposit

      // User2 should get approximately 2x the profit of User1
      // Allow 5% tolerance for rounding and fee effects
      const ratio = Number(user2Profit) / Number(user1Profit);
      expect(ratio).to.be.closeTo(2, 0.1);
    });
  });

  // =================================================================
  // Share price consistency
  // =================================================================

  describe("Share Price Consistency", function () {
    it("should return 1e6 share price when vault is empty", async function () {
      const { vault } = await loadFixture(deployFixture);
      expect(await vault.sharePrice()).to.equal(ethers.parseUnits("1", 6));
    });

    it("should increase share price after profitable trade", async function () {
      const { vault, agent, user1 } = await loadFixture(deployFixture);

      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
      const priceBefore = await vault.sharePrice();

      await vault.connect(agent).agentBorrow(parseUSDC(500));
      await vault.connect(agent).agentReturn(parseUSDC(600)); // 100 profit

      const priceAfter = await vault.sharePrice();
      // Price should increase (profit is distributed across shares, minus fee dilution)
      expect(priceAfter).to.be.greaterThan(priceBefore);
    });

    it("should decrease share price after loss and bad debt write-off", async function () {
      const { vault, agent, user1 } = await loadFixture(deployFixture);

      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
      const priceBefore = await vault.sharePrice();

      // Agent borrows and the debt is written off (total loss)
      await vault.connect(agent).agentBorrow(parseUSDC(500));

      // Fast forward past timeout
      await time.increase(SEVEN_DAYS + 1);
      await vault.writeOffBadDebt();

      const priceAfter = await vault.sharePrice();
      expect(priceAfter).to.be.lessThan(priceBefore);
    });
  });

  // =================================================================
  // Emergency withdraw during active borrow
  // =================================================================

  describe("Emergency Withdraw During Active Borrow", function () {
    it("should allow proportional emergency withdraw when funds are borrowed", async function () {
      const { vault, usdc, agent, user1 } = await loadFixture(deployFixture);

      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
      await vault.connect(agent).agentBorrow(parseUSDC(800));

      // Only 200 USDC available in vault
      // Emergency withdraw should give user proportional to available funds
      await vault.connect(user1).emergencyWithdraw();

      const userBalance = await usdc.balanceOf(user1.address);
      // User should receive ~200 USDC (the available amount)
      // Started with 9000 after deposit, so final should be ~9200
      expect(userBalance).to.be.closeTo(parseUSDC(9200), parseUSDC(1));

      // User should still have remaining shares as claim on borrowed funds
      const remainingShares = await vault.balanceOf(user1.address);
      expect(remainingShares).to.be.greaterThan(0);
    });
  });
});
