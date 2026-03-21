import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("StrategyExecutor", function () {
  const ONE_DAY = 86400;
  const TWO_DAYS = 2 * ONE_DAY;
  const parseUSDC = (amount: number) => ethers.parseUnits(amount.toString(), 6);

  async function deployExecutorFixture() {
    const [owner, agent, unauthorized, user1] = await ethers.getSigners();

    // Deploy mock vault
    const MockVault = await ethers.getContractFactory("MockVault");
    const mockVault = await MockVault.deploy();
    await mockVault.waitForDeployment();

    // Deploy StrategyExecutor
    const StrategyExecutor = await ethers.getContractFactory("StrategyExecutor");
    const executor = await StrategyExecutor.deploy(
      owner.address,
      await mockVault.getAddress(),
      agent.address
    );
    await executor.waitForDeployment();

    // Deploy mock tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const tokenIn = await MockERC20.deploy("Token In", "TIN", 6);
    const tokenOut = await MockERC20.deploy("Token Out", "TOUT", 6);

    return { executor, mockVault, tokenIn, tokenOut, owner, agent, unauthorized, user1 };
  }

  // ----------------------------------------------------------------
  // Deployment
  // ----------------------------------------------------------------

  describe("Deployment", function () {
    it("should set default maxSlippageBps to 500 (5%)", async function () {
      const { executor } = await loadFixture(deployExecutorFixture);
      expect(await executor.maxSlippageBps()).to.equal(500);
    });

    it("should have MAX_SLIPPAGE_CEILING of 1000 (10%)", async function () {
      const { executor } = await loadFixture(deployExecutorFixture);
      expect(await executor.MAX_SLIPPAGE_CEILING()).to.equal(1000);
    });

    it("should have TIMELOCK_DURATION of 48 hours", async function () {
      const { executor } = await loadFixture(deployExecutorFixture);
      expect(await executor.TIMELOCK_DURATION()).to.equal(TWO_DAYS);
    });

    it("should have no pending slippage change", async function () {
      const { executor } = await loadFixture(deployExecutorFixture);
      expect(await executor.pendingMaxSlippageBps()).to.equal(0);
      expect(await executor.pendingMaxSlippageBpsTimestamp()).to.equal(0);
    });
  });

  // ----------------------------------------------------------------
  // setMaxSlippage (initiate timelock)
  // ----------------------------------------------------------------

  describe("setMaxSlippage", function () {
    it("should initiate a pending slippage change", async function () {
      const { executor, owner } = await loadFixture(deployExecutorFixture);
      await executor.connect(owner).setMaxSlippage(300);
      expect(await executor.pendingMaxSlippageBps()).to.equal(300);
      expect(await executor.pendingMaxSlippageBpsTimestamp()).to.be.gt(0);
    });

    it("should emit PendingMaxSlippageSet event", async function () {
      const { executor, owner } = await loadFixture(deployExecutorFixture);
      const tx = executor.connect(owner).setMaxSlippage(300);
      await expect(tx).to.emit(executor, "PendingMaxSlippageSet");
    });

    it("should revert if bps exceeds MAX_SLIPPAGE_CEILING", async function () {
      const { executor, owner } = await loadFixture(deployExecutorFixture);
      await expect(
        executor.connect(owner).setMaxSlippage(1001)
      ).to.be.revertedWithCustomError(executor, "SlippageTooHigh");
    });

    it("should allow setting to MAX_SLIPPAGE_CEILING exactly", async function () {
      const { executor, owner } = await loadFixture(deployExecutorFixture);
      await expect(executor.connect(owner).setMaxSlippage(1000)).to.not.be.reverted;
      expect(await executor.pendingMaxSlippageBps()).to.equal(1000);
    });

    it("should allow setting to 0 (zero slippage tolerance)", async function () {
      const { executor, owner } = await loadFixture(deployExecutorFixture);
      await expect(executor.connect(owner).setMaxSlippage(0)).to.not.be.reverted;
      expect(await executor.pendingMaxSlippageBps()).to.equal(0);
    });

    it("should revert if called by non-owner", async function () {
      const { executor, unauthorized } = await loadFixture(deployExecutorFixture);
      await expect(
        executor.connect(unauthorized).setMaxSlippage(300)
      ).to.be.revertedWithCustomError(executor, "OwnableUnauthorizedAccount");
    });
  });

  // ----------------------------------------------------------------
  // confirmMaxSlippage (after timelock)
  // ----------------------------------------------------------------

  describe("confirmMaxSlippage", function () {
    it("should revert if no pending change", async function () {
      const { executor, owner } = await loadFixture(deployExecutorFixture);
      await expect(
        executor.connect(owner).confirmMaxSlippage()
      ).to.be.revertedWithCustomError(executor, "NoPendingChange");
    });

    it("should revert if timelock has not elapsed", async function () {
      const { executor, owner } = await loadFixture(deployExecutorFixture);
      await executor.connect(owner).setMaxSlippage(300);
      // Advance only 1 day (not enough)
      await time.increase(ONE_DAY);
      await expect(
        executor.connect(owner).confirmMaxSlippage()
      ).to.be.revertedWithCustomError(executor, "TimelockNotElapsed");
    });

    it("should confirm after 48h timelock elapses", async function () {
      const { executor, owner } = await loadFixture(deployExecutorFixture);
      await executor.connect(owner).setMaxSlippage(300);
      await time.increase(TWO_DAYS + 1);
      await executor.connect(owner).confirmMaxSlippage();
      expect(await executor.maxSlippageBps()).to.equal(300);
      expect(await executor.pendingMaxSlippageBps()).to.equal(0);
      expect(await executor.pendingMaxSlippageBpsTimestamp()).to.equal(0);
    });

    it("should emit MaxSlippageConfirmed event with old and new values", async function () {
      const { executor, owner } = await loadFixture(deployExecutorFixture);
      await executor.connect(owner).setMaxSlippage(300);
      await time.increase(TWO_DAYS + 1);
      await expect(executor.connect(owner).confirmMaxSlippage())
        .to.emit(executor, "MaxSlippageConfirmed")
        .withArgs(500, 300); // old=500 (default), new=300
    });

    it("should revert if called by non-owner", async function () {
      const { executor, owner, unauthorized } = await loadFixture(deployExecutorFixture);
      await executor.connect(owner).setMaxSlippage(300);
      await time.increase(TWO_DAYS + 1);
      await expect(
        executor.connect(unauthorized).confirmMaxSlippage()
      ).to.be.revertedWithCustomError(executor, "OwnableUnauthorizedAccount");
    });
  });

  // ----------------------------------------------------------------
  // cancelPendingMaxSlippage
  // ----------------------------------------------------------------

  describe("cancelPendingMaxSlippage", function () {
    it("should revert if no pending change", async function () {
      const { executor, owner } = await loadFixture(deployExecutorFixture);
      await expect(
        executor.connect(owner).cancelPendingMaxSlippage()
      ).to.be.revertedWithCustomError(executor, "NoPendingChange");
    });

    it("should cancel a pending slippage change", async function () {
      const { executor, owner } = await loadFixture(deployExecutorFixture);
      await executor.connect(owner).setMaxSlippage(300);
      await executor.connect(owner).cancelPendingMaxSlippage();
      expect(await executor.pendingMaxSlippageBps()).to.equal(0);
      expect(await executor.pendingMaxSlippageBpsTimestamp()).to.equal(0);
      // Original value unchanged
      expect(await executor.maxSlippageBps()).to.equal(500);
    });

    it("should emit PendingMaxSlippageCancelled event", async function () {
      const { executor, owner } = await loadFixture(deployExecutorFixture);
      await executor.connect(owner).setMaxSlippage(300);
      await expect(executor.connect(owner).cancelPendingMaxSlippage())
        .to.emit(executor, "PendingMaxSlippageCancelled")
        .withArgs(300);
    });

    it("should revert if called by non-owner", async function () {
      const { executor, owner, unauthorized } = await loadFixture(deployExecutorFixture);
      await executor.connect(owner).setMaxSlippage(300);
      await expect(
        executor.connect(unauthorized).cancelPendingMaxSlippage()
      ).to.be.revertedWithCustomError(executor, "OwnableUnauthorizedAccount");
    });
  });

  // ----------------------------------------------------------------
  // Slippage floor enforcement in executeTrade
  // ----------------------------------------------------------------

  describe("Slippage floor enforcement", function () {
    it("should revert if amountOutMin is below the slippage floor", async function () {
      const { executor, agent, tokenIn, tokenOut } = await loadFixture(deployExecutorFixture);

      const amountIn = parseUSDC(1000);
      // Default maxSlippageBps = 500 (5%), so requiredMin = 1000 * 9500 / 10000 = 950
      // amountOutMin = 900 (below 950) should revert
      const badAmountOutMin = parseUSDC(900);

      await expect(
        executor.connect(agent).executeTrade(
          1,                                    // strategyId
          await tokenIn.getAddress(),           // tokenIn
          await tokenOut.getAddress(),          // tokenOut
          amountIn,                             // amountIn
          3000,                                 // fee
          badAmountOutMin,                      // amountOutMin (too low)
          0                                     // sqrtPriceLimitX96
        )
      ).to.be.revertedWithCustomError(executor, "SlippageFloorViolation");
    });

    it("should revert with amountOutMin = 0 (zero slippage protection)", async function () {
      const { executor, agent, tokenIn, tokenOut } = await loadFixture(deployExecutorFixture);

      await expect(
        executor.connect(agent).executeTrade(
          1,
          await tokenIn.getAddress(),
          await tokenOut.getAddress(),
          parseUSDC(1000),
          3000,
          0,   // amountOutMin = 0
          0
        )
      ).to.be.revertedWithCustomError(executor, "SlippageFloorViolation");
    });

    it("should accept amountOutMin at exactly the floor", async function () {
      const { executor, agent, tokenIn, tokenOut, mockVault } = await loadFixture(deployExecutorFixture);

      const amountIn = parseUSDC(1000);
      // requiredMin = 1000 * 9500 / 10000 = 950 USDC
      const exactFloor = parseUSDC(950);

      // Fund the mock vault so spendToken works
      await tokenIn.mint(await mockVault.getAddress(), amountIn);

      // This will pass the slippage check but revert at the swap router call
      // (since SWAP_ROUTER constant is a real address with no code on Hardhat).
      // We just need to confirm it does NOT revert with SlippageFloorViolation.
      await expect(
        executor.connect(agent).executeTrade(
          1,
          await tokenIn.getAddress(),
          await tokenOut.getAddress(),
          amountIn,
          3000,
          exactFloor,
          0
        )
      ).to.not.be.revertedWithCustomError(executor, "SlippageFloorViolation");
    });

    it("should accept amountOutMin above the floor", async function () {
      const { executor, agent, tokenIn, tokenOut, mockVault } = await loadFixture(deployExecutorFixture);

      const amountIn = parseUSDC(1000);
      const aboveFloor = parseUSDC(980); // well above 950

      await tokenIn.mint(await mockVault.getAddress(), amountIn);

      await expect(
        executor.connect(agent).executeTrade(
          1,
          await tokenIn.getAddress(),
          await tokenOut.getAddress(),
          amountIn,
          3000,
          aboveFloor,
          0
        )
      ).to.not.be.revertedWithCustomError(executor, "SlippageFloorViolation");
    });

    it("should enforce updated slippage after timelock confirmation", async function () {
      const { executor, owner, agent, tokenIn, tokenOut } = await loadFixture(deployExecutorFixture);

      // Change max slippage to 200 bps (2%)
      await executor.connect(owner).setMaxSlippage(200);
      await time.increase(TWO_DAYS + 1);
      await executor.connect(owner).confirmMaxSlippage();
      expect(await executor.maxSlippageBps()).to.equal(200);

      const amountIn = parseUSDC(1000);
      // New requiredMin = 1000 * 9800 / 10000 = 980 USDC
      // 970 is below the new floor of 980
      const belowNewFloor = parseUSDC(970);

      await expect(
        executor.connect(agent).executeTrade(
          1,
          await tokenIn.getAddress(),
          await tokenOut.getAddress(),
          amountIn,
          3000,
          belowNewFloor,
          0
        )
      ).to.be.revertedWithCustomError(executor, "SlippageFloorViolation");
    });
  });

  // ----------------------------------------------------------------
  // Access control
  // ----------------------------------------------------------------

  describe("Access control", function () {
    it("should reject executeTrade from non-agent", async function () {
      const { executor, unauthorized, tokenIn, tokenOut } = await loadFixture(deployExecutorFixture);

      await expect(
        executor.connect(unauthorized).executeTrade(
          1,
          await tokenIn.getAddress(),
          await tokenOut.getAddress(),
          parseUSDC(1000),
          3000,
          parseUSDC(950),
          0
        )
      ).to.be.revertedWithCustomError(executor, "Unauthorized");
    });
  });
});
