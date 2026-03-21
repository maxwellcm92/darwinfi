import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("DarwinVaultV4", function () {
  const USDC_DECIMALS = 6;
  const SHARE_DECIMALS = 12; // 6 USDC + 6 offset
  const parseUSDC = (amount: number) => ethers.parseUnits(amount.toString(), USDC_DECIMALS);
  const parseShares = (amount: number) => ethers.parseUnits(amount.toString(), SHARE_DECIMALS);
  const ONE_HOUR = 3600;
  const ONE_DAY = 86400;
  const TWO_DAYS = 2 * ONE_DAY;
  const SEVEN_DAYS = 7 * ONE_DAY;
  const ONE_YEAR = 365 * ONE_DAY;

  async function deployVaultFixture() {
    const [owner, agent, feeRecipient, user1, user2, unauthorized] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    await usdc.waitForDeployment();

    const VaultV4 = await ethers.getContractFactory("DarwinVaultV4");
    const vault = await VaultV4.deploy(
      await usdc.getAddress(),
      owner.address,
      agent.address,
      feeRecipient.address
    );
    await vault.waitForDeployment();

    const amount = parseUSDC(10000);
    await usdc.mint(user1.address, amount);
    await usdc.mint(user2.address, amount);
    await usdc.mint(agent.address, amount);

    const vaultAddr = await vault.getAddress();
    await usdc.connect(user1).approve(vaultAddr, ethers.MaxUint256);
    await usdc.connect(user2).approve(vaultAddr, ethers.MaxUint256);
    await usdc.connect(agent).approve(vaultAddr, ethers.MaxUint256);

    return { vault, usdc, owner, agent, feeRecipient, user1, user2, unauthorized };
  }

  // =================================================================
  // Deployment
  // =================================================================

  describe("Deployment", function () {
    it("should set correct name and symbol", async function () {
      const { vault } = await loadFixture(deployVaultFixture);
      expect(await vault.name()).to.equal("DarwinFi Vault USDC V4");
      expect(await vault.symbol()).to.equal("dvUSDC");
    });

    it("should set correct initial state", async function () {
      const { vault, agent, feeRecipient } = await loadFixture(deployVaultFixture);
      expect(await vault.agent()).to.equal(agent.address);
      expect(await vault.feeRecipient()).to.equal(feeRecipient.address);
      expect(await vault.performanceFeeBps()).to.equal(500); // 5%
      expect(await vault.managementFeeBps()).to.equal(100); // 1%
      expect(await vault.maxTotalAssets()).to.equal(parseUSDC(10000));
      expect(await vault.minLockTime()).to.equal(3600);
      expect(await vault.totalBorrowed()).to.equal(0);
      expect(await vault.maxBorrowRatioBps()).to.equal(8000); // 80%
      expect(await vault.maxBorrowDuration()).to.equal(SEVEN_DAYS);
    });

    it("should initialize lastFeeCollection to deployment timestamp", async function () {
      const { vault } = await loadFixture(deployVaultFixture);
      const lastFee = await vault.lastFeeCollection();
      expect(lastFee).to.be.greaterThan(0);
    });
  });

  // =================================================================
  // H-02: Decimals Offset
  // =================================================================

  describe("H-02: Decimals Offset", function () {
    it("should return 12 for vault decimals", async function () {
      const { vault } = await loadFixture(deployVaultFixture);
      expect(await vault.decimals()).to.equal(12);
    });

    it("should mint shares with higher precision (deposit 1 USDC -> ~1e12 shares)", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1), user1.address);
      const shares = await vault.balanceOf(user1.address);
      // With offset, 1 USDC = 1e12 shares (1:1 initial ratio at 12-decimal precision)
      expect(shares).to.equal(parseShares(1));
    });
  });

  // =================================================================
  // Deposit and Withdraw
  // =================================================================

  describe("Deposit and Withdraw", function () {
    it("should deposit USDC and receive shares", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);
      const depositAmount = parseUSDC(1000);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      expect(await vault.balanceOf(user1.address)).to.equal(parseShares(1000));
      expect(await vault.totalAssets()).to.equal(depositAmount);
    });

    it("should allow withdrawal after lock time", async function () {
      const { vault, usdc, user1 } = await loadFixture(deployVaultFixture);
      const depositAmount = parseUSDC(1000);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      await time.increase(ONE_HOUR + 1);

      const shares = await vault.balanceOf(user1.address);
      await vault.connect(user1).redeem(shares, user1.address, user1.address);

      expect(await vault.balanceOf(user1.address)).to.equal(0);
      expect(await usdc.balanceOf(user1.address)).to.equal(parseUSDC(10000));
    });

    it("should revert withdrawal before lock time", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      const shares = await vault.balanceOf(user1.address);
      await expect(
        vault.connect(user1).redeem(shares, user1.address, user1.address)
      ).to.be.revertedWithCustomError(vault, "LockTimeNotElapsed");
    });

    it("should enforce maxTotalAssets cap", async function () {
      const { vault, user1, user2 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(9000), user1.address);

      await expect(
        vault.connect(user2).deposit(parseUSDC(2000), user2.address)
      ).to.be.revertedWithCustomError(vault, "MaxAssetsExceeded");

      await vault.connect(user2).deposit(parseUSDC(1000), user2.address);
    });

    it("should give proportional shares to multiple depositors", async function () {
      const { vault, user1, user2 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
      await vault.connect(user2).deposit(parseUSDC(3000), user2.address);

      const shares1 = await vault.balanceOf(user1.address);
      const shares2 = await vault.balanceOf(user2.address);
      expect(shares2).to.equal(shares1 * 3n);
    });

    it("should use mint to deposit", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);
      const shares = parseShares(1000); // 12-decimal shares
      await vault.connect(user1).mint(shares, user1.address);

      expect(await vault.balanceOf(user1.address)).to.equal(shares);
    });
  });

  // =================================================================
  // Agent Borrow / Return
  // =================================================================

  describe("Agent Borrow/Return", function () {
    it("should allow agent to borrow and return USDC", async function () {
      const { vault, agent, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await vault.connect(agent).agentBorrow(parseUSDC(500));
      expect(await vault.totalBorrowed()).to.equal(parseUSDC(500));
      expect(await vault.totalAssets()).to.equal(parseUSDC(1000));

      await vault.connect(agent).agentReturn(parseUSDC(500));
      expect(await vault.totalBorrowed()).to.equal(0);
    });

    it("should handle profitable return correctly", async function () {
      const { vault, agent, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await vault.connect(agent).agentBorrow(parseUSDC(800)); // 80% ratio
      await vault.connect(agent).agentReturn(parseUSDC(900));

      expect(await vault.totalBorrowed()).to.equal(0);
      expect(await vault.totalAssets()).to.be.greaterThanOrEqual(parseUSDC(1090));
    });

    it("should handle partial return (loss scenario)", async function () {
      const { vault, agent, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await vault.connect(agent).agentBorrow(parseUSDC(800)); // 80%
      await vault.connect(agent).agentReturn(parseUSDC(700));

      expect(await vault.totalBorrowed()).to.equal(parseUSDC(100));
      expect(await vault.totalAssets()).to.equal(parseUSDC(1000));
    });

    it("should revert borrow from non-agent", async function () {
      const { vault, user1, unauthorized } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await expect(
        vault.connect(unauthorized).agentBorrow(parseUSDC(100))
      ).to.be.revertedWithCustomError(vault, "Unauthorized");
    });

    it("should revert borrow exceeding available balance", async function () {
      const { vault, agent, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(100), user1.address);

      await expect(
        vault.connect(agent).agentBorrow(parseUSDC(200))
      ).to.be.revertedWithCustomError(vault, "InsufficientVaultBalance");
    });

    it("should revert borrow of zero amount", async function () {
      const { vault, agent, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await expect(
        vault.connect(agent).agentBorrow(0)
      ).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });

    it("should revert return of zero amount", async function () {
      const { vault, agent } = await loadFixture(deployVaultFixture);

      await expect(
        vault.connect(agent).agentReturn(0)
      ).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });
  });

  // =================================================================
  // Performance Fee (5%)
  // =================================================================

  describe("Performance Fee", function () {
    it("should use 5% performance fee (not 10%)", async function () {
      const { vault } = await loadFixture(deployVaultFixture);
      expect(await vault.performanceFeeBps()).to.equal(500);
    });

    it("should collect fee on profits above high water mark", async function () {
      const { vault, agent, feeRecipient, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await vault.connect(agent).agentBorrow(parseUSDC(800));
      await vault.connect(agent).agentReturn(parseUSDC(1000));

      const feeShares = await vault.balanceOf(feeRecipient.address);
      expect(feeShares).to.be.greaterThan(0);
    });

    it("should not collect fee when below high water mark", async function () {
      const { vault, agent, feeRecipient, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      // First trade: profit (sets HWM)
      await vault.connect(agent).agentBorrow(parseUSDC(800));
      await vault.connect(agent).agentReturn(parseUSDC(1000));
      const feeSharesAfterProfit = await vault.balanceOf(feeRecipient.address);

      // Second trade: loss
      await vault.connect(agent).agentBorrow(parseUSDC(800));
      await vault.connect(agent).agentReturn(parseUSDC(600));

      // Third trade: small profit but still below HWM
      await vault.connect(agent).agentBorrow(parseUSDC(500));
      await vault.connect(agent).agentReturn(parseUSDC(550));

      const feeSharesNow = await vault.balanceOf(feeRecipient.address);
      const diff = feeSharesNow - feeSharesAfterProfit;
      // Management fee over a few seconds on ~1000 USDC is negligible
      expect(diff).to.be.lessThanOrEqual(parseShares(1) / 1000000n); // negligible
    });
  });

  // =================================================================
  // Management Fee
  // =================================================================

  describe("Management Fee", function () {
    it("should accrue management fee proportionally over time", async function () {
      const { vault, feeRecipient, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(10000), user1.address);

      await time.increase(ONE_YEAR);
      await vault.collectManagementFee();

      const feeShares = await vault.balanceOf(feeRecipient.address);
      expect(feeShares).to.be.greaterThan(0);

      // 1% of 10000 = 100 USDC worth of shares over 1 year
      const feeValue = await vault.convertToAssets(feeShares);
      expect(feeValue).to.be.closeTo(parseUSDC(100), parseUSDC(2));
    });

    it("should mint shares to feeRecipient", async function () {
      const { vault, feeRecipient, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      const feeSharesBefore = await vault.balanceOf(feeRecipient.address);

      await time.increase(ONE_YEAR);
      await vault.collectManagementFee();

      const feeSharesAfter = await vault.balanceOf(feeRecipient.address);
      expect(feeSharesAfter).to.be.greaterThan(feeSharesBefore);
    });

    it("should auto-collect management fee on agentReturn", async function () {
      const { vault, agent, feeRecipient, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await vault.connect(agent).agentBorrow(parseUSDC(500));

      await time.increase(30 * ONE_DAY);

      const feeSharesBefore = await vault.balanceOf(feeRecipient.address);
      await vault.connect(agent).agentReturn(parseUSDC(500));
      const feeSharesAfter = await vault.balanceOf(feeRecipient.address);

      expect(feeSharesAfter).to.be.greaterThan(feeSharesBefore);
    });

    it("should not mint fee when zero time has elapsed", async function () {
      const { vault, feeRecipient, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      const feeSharesBefore = await vault.balanceOf(feeRecipient.address);
      await vault.collectManagementFee();
      const feeSharesAfter = await vault.balanceOf(feeRecipient.address);

      const diff = feeSharesAfter - feeSharesBefore;
      expect(diff).to.be.lessThanOrEqual(parseShares(1) / 100000n); // negligible
    });

    it("should not mint fee when totalAssets is zero", async function () {
      const { vault, feeRecipient } = await loadFixture(deployVaultFixture);

      await time.increase(ONE_YEAR);
      await vault.collectManagementFee();

      expect(await vault.balanceOf(feeRecipient.address)).to.equal(0);
    });

    it("should accumulate correctly across multiple collections", async function () {
      const { vault, feeRecipient, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(10000), user1.address);

      await time.increase(ONE_YEAR / 2);
      await vault.collectManagementFee();
      const midYearShares = await vault.balanceOf(feeRecipient.address);

      await time.increase(ONE_YEAR / 2);
      await vault.collectManagementFee();
      const fullYearShares = await vault.balanceOf(feeRecipient.address);

      expect(fullYearShares).to.be.greaterThan(midYearShares);

      const totalFeeValue = await vault.convertToAssets(fullYearShares);
      expect(totalFeeValue).to.be.closeTo(parseUSDC(100), parseUSDC(3));
    });

    it("should calculate daily fee correctly (~0.00274% daily)", async function () {
      const { vault, feeRecipient, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(10000), user1.address);

      await time.increase(ONE_DAY);
      await vault.collectManagementFee();

      const feeShares = await vault.balanceOf(feeRecipient.address);
      const feeValue = await vault.convertToAssets(feeShares);

      // 1% annual / 365 days * 10000 USDC = ~0.2739 USDC per day = ~273972 (6 decimal)
      expect(feeValue).to.be.closeTo(273972n, 5000n);
    });

    it("should emit ManagementFeeCollected event", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(10000), user1.address);

      await time.increase(ONE_YEAR);

      await expect(vault.collectManagementFee())
        .to.emit(vault, "ManagementFeeCollected");
    });
  });

  // =================================================================
  // setManagementFeeBps
  // =================================================================

  describe("setManagementFeeBps (Timelock)", function () {
    it("should only allow owner to initiate", async function () {
      const { vault, unauthorized } = await loadFixture(deployVaultFixture);
      await expect(
        vault.connect(unauthorized).setManagementFeeBps(200)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("should revert if bps > 500", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await expect(
        vault.connect(owner).setManagementFeeBps(501)
      ).to.be.revertedWith("Management fee too high");
    });

    it("should allow setting to 500 (max) via timelock", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await vault.connect(owner).setManagementFeeBps(500);
      await time.increase(TWO_DAYS + 1);
      await vault.connect(owner).confirmManagementFeeBps();
      expect(await vault.managementFeeBps()).to.equal(500);
    });

    it("should allow setting to 0 via timelock", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await vault.connect(owner).setManagementFeeBps(0);
      await time.increase(TWO_DAYS + 1);
      await vault.connect(owner).confirmManagementFeeBps();
      expect(await vault.managementFeeBps()).to.equal(0);
    });

    it("should collect pending fee on confirm before updating rate", async function () {
      const { vault, owner, feeRecipient, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(10000), user1.address);

      await time.increase(ONE_YEAR / 2);

      await vault.connect(owner).setManagementFeeBps(200);

      await time.increase(TWO_DAYS + 1);

      const feeSharesBefore = await vault.balanceOf(feeRecipient.address);
      await vault.connect(owner).confirmManagementFeeBps();
      const feeSharesAfter = await vault.balanceOf(feeRecipient.address);

      expect(feeSharesAfter).to.be.greaterThan(feeSharesBefore);
    });

    it("should emit PendingManagementFeeBpsSet on initiate", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await expect(vault.connect(owner).setManagementFeeBps(200))
        .to.emit(vault, "PendingManagementFeeBpsSet");
    });

    it("should emit ManagementFeeBpsUpdated on confirm", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await vault.connect(owner).setManagementFeeBps(200);
      await time.increase(TWO_DAYS + 1);
      await expect(vault.connect(owner).confirmManagementFeeBps())
        .to.emit(vault, "ManagementFeeBpsUpdated")
        .withArgs(100, 200);
    });

    it("should revert confirm before 48 hours", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await vault.connect(owner).setManagementFeeBps(200);

      await time.increase(TWO_DAYS - 10);

      await expect(
        vault.connect(owner).confirmManagementFeeBps()
      ).to.be.revertedWithCustomError(vault, "TimelockNotElapsed");
    });

    it("should revert confirm when no pending change", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await expect(
        vault.connect(owner).confirmManagementFeeBps()
      ).to.be.revertedWithCustomError(vault, "NoPendingChange");
    });

    it("should cancel pending management fee change", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await vault.connect(owner).setManagementFeeBps(200);

      await expect(vault.connect(owner).cancelPendingManagementFeeBps())
        .to.emit(vault, "PendingManagementFeeBpsCancelled")
        .withArgs(200);

      expect(await vault.pendingManagementFeeBpsTimestamp()).to.equal(0);
      // Original value unchanged
      expect(await vault.managementFeeBps()).to.equal(100);
    });

    it("should revert cancel when no pending change", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await expect(
        vault.connect(owner).cancelPendingManagementFeeBps()
      ).to.be.revertedWithCustomError(vault, "NoPendingChange");
    });
  });

  // =================================================================
  // Combined Fee Scenario
  // =================================================================

  describe("Combined Fees", function () {
    it("should collect both management and performance fees on agentReturn", async function () {
      const { vault, agent, feeRecipient, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await vault.connect(agent).agentBorrow(parseUSDC(800));

      await time.increase(30 * ONE_DAY);

      // Return with profit
      await vault.connect(agent).agentReturn(parseUSDC(900));

      const feeShares = await vault.balanceOf(feeRecipient.address);
      const feeValue = await vault.convertToAssets(feeShares);

      // Management fee: 1% of 1000 * 30/365 = ~0.822 USDC
      // Performance fee: 5% of 100 = 5 USDC
      // Total should be ~5.8 USDC
      expect(feeValue).to.be.greaterThan(parseUSDC(4));
      expect(feeValue).to.be.lessThan(parseUSDC(8));
    });
  });

  // =================================================================
  // Pause and Emergency
  // =================================================================

  describe("Pause and Emergency", function () {
    it("should block deposits when paused", async function () {
      const { vault, owner, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(owner).pause();

      await expect(
        vault.connect(user1).deposit(parseUSDC(100), user1.address)
      ).to.be.revertedWithCustomError(vault, "EnforcedPause");
    });

    it("should allow withdrawal when paused (after lock time)", async function () {
      const { vault, owner, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
      await time.increase(ONE_HOUR + 1);

      await vault.connect(owner).pause();

      const shares = await vault.balanceOf(user1.address);
      await vault.connect(user1).redeem(shares, user1.address, user1.address);
      expect(await vault.balanceOf(user1.address)).to.equal(0);
    });

    it("should allow emergency withdraw even when paused", async function () {
      const { vault, owner, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await vault.connect(owner).pause();

      await vault.connect(user1).emergencyWithdraw();
      expect(await vault.balanceOf(user1.address)).to.equal(0);
    });

    it("should cap emergency withdrawal to available USDC when agent has borrowed (proportional)", async function () {
      const { vault, agent, usdc, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await vault.connect(agent).agentBorrow(parseUSDC(800));

      const sharesBefore = await vault.balanceOf(user1.address);
      await vault.connect(user1).emergencyWithdraw();

      const userBalance = await usdc.balanceOf(user1.address);
      // User started with 10000, deposited 1000, gets back 200 (available USDC)
      expect(userBalance).to.equal(parseUSDC(9200));

      // C-02: User retains shares proportional to borrowed amount
      const sharesAfter = await vault.balanceOf(user1.address);
      expect(sharesAfter).to.be.greaterThan(0);
      // Burned ~20% of shares (200/1000), retains ~80%
      expect(sharesAfter).to.be.closeTo((sharesBefore * 800n) / 1000n, parseShares(1));
    });

    it("should revert emergency withdraw with zero shares", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);
      await expect(
        vault.connect(user1).emergencyWithdraw()
      ).to.be.revertedWithCustomError(vault, "ZeroAmount");
    });
  });

  // =================================================================
  // Access Control
  // =================================================================

  describe("Access Control", function () {
    it("should only allow owner to initiate agent change", async function () {
      const { vault, unauthorized } = await loadFixture(deployVaultFixture);
      await expect(
        vault.connect(unauthorized).setAgent(unauthorized.address)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("should only allow owner to pause", async function () {
      const { vault, unauthorized } = await loadFixture(deployVaultFixture);
      await expect(
        vault.connect(unauthorized).pause()
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("should only allow owner to set max total assets", async function () {
      const { vault, unauthorized } = await loadFixture(deployVaultFixture);
      await expect(
        vault.connect(unauthorized).setMaxTotalAssets(parseUSDC(50000))
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("should allow owner to update agent via timelock", async function () {
      const { vault, owner, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(owner).setAgent(user1.address);
      await time.increase(TWO_DAYS);
      await vault.connect(owner).confirmAgent();
      expect(await vault.agent()).to.equal(user1.address);
    });

    it("should reject zero address for agent", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await expect(
        vault.connect(owner).setAgent(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });

    it("should reject zero address for fee recipient", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await expect(
        vault.connect(owner).setFeeRecipient(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });
  });

  // =================================================================
  // Share Price
  // =================================================================

  describe("Share Price", function () {
    it("should return 1:1 share price when vault is empty", async function () {
      const { vault } = await loadFixture(deployVaultFixture);
      expect(await vault.sharePrice()).to.equal(parseUSDC(1));
    });

    it("should increase share price after agent profit", async function () {
      const { vault, agent, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await vault.connect(agent).agentBorrow(parseUSDC(800));
      await vault.connect(agent).agentReturn(parseUSDC(900));

      const price = await vault.sharePrice();
      expect(price).to.be.greaterThan(parseUSDC(1));
    });
  });

  // =================================================================
  // maxWithdraw / maxRedeem Lock Compliance
  // =================================================================

  describe("maxWithdraw/maxRedeem lock compliance", function () {
    it("should return 0 for maxWithdraw during lock period", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      expect(await vault.maxWithdraw(user1.address)).to.equal(0);
    });

    it("should return 0 for maxRedeem during lock period", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      expect(await vault.maxRedeem(user1.address)).to.equal(0);
    });

    it("should return correct maxWithdraw after lock expires", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await time.increase(ONE_HOUR + 1);

      expect(await vault.maxWithdraw(user1.address)).to.equal(parseUSDC(1000));
    });

    it("should return correct maxRedeem after lock expires", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await time.increase(ONE_HOUR + 1);

      expect(await vault.maxRedeem(user1.address)).to.be.greaterThan(0);
    });
  });

  // =================================================================
  // C-01: Timelock -- Agent
  // =================================================================

  describe("C-01: Timelock - Agent", function () {
    it("should set pendingAgent and emit PendingAgentSet", async function () {
      const { vault, owner, user1 } = await loadFixture(deployVaultFixture);
      const tx = vault.connect(owner).setAgent(user1.address);
      await expect(tx).to.emit(vault, "PendingAgentSet");
      expect(await vault.pendingAgent()).to.equal(user1.address);
    });

    it("should revert confirmAgent before 48 hours", async function () {
      const { vault, owner, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(owner).setAgent(user1.address);

      await time.increase(TWO_DAYS - 10);

      await expect(
        vault.connect(owner).confirmAgent()
      ).to.be.revertedWithCustomError(vault, "TimelockNotElapsed");
    });

    it("should confirm agent after 48 hours", async function () {
      const { vault, owner, agent, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(owner).setAgent(user1.address);

      await time.increase(TWO_DAYS);

      await expect(vault.connect(owner).confirmAgent())
        .to.emit(vault, "AgentConfirmed")
        .withArgs(agent.address, user1.address);

      expect(await vault.agent()).to.equal(user1.address);
      expect(await vault.pendingAgent()).to.equal(ethers.ZeroAddress);
      expect(await vault.pendingAgentTimestamp()).to.equal(0);
    });

    it("should revert confirmAgent with NoPendingChange when nothing pending", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await expect(
        vault.connect(owner).confirmAgent()
      ).to.be.revertedWithCustomError(vault, "NoPendingChange");
    });

    it("should cancel pending agent and emit PendingAgentCancelled", async function () {
      const { vault, owner, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(owner).setAgent(user1.address);

      await expect(vault.connect(owner).cancelPendingAgent())
        .to.emit(vault, "PendingAgentCancelled")
        .withArgs(user1.address);

      expect(await vault.pendingAgent()).to.equal(ethers.ZeroAddress);
      expect(await vault.pendingAgentTimestamp()).to.equal(0);
    });

    it("should revert cancelPendingAgent with NoPendingChange when nothing pending", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await expect(
        vault.connect(owner).cancelPendingAgent()
      ).to.be.revertedWithCustomError(vault, "NoPendingChange");
    });

    it("should allow overwriting a pending agent (second call resets timestamp)", async function () {
      const { vault, owner, user1, user2 } = await loadFixture(deployVaultFixture);
      await vault.connect(owner).setAgent(user1.address);
      const ts1 = await vault.pendingAgentTimestamp();

      await time.increase(ONE_DAY);

      await vault.connect(owner).setAgent(user2.address);
      const ts2 = await vault.pendingAgentTimestamp();

      expect(await vault.pendingAgent()).to.equal(user2.address);
      expect(ts2).to.be.greaterThan(ts1);
    });
  });

  // =================================================================
  // C-01: Timelock -- Fee Recipient
  // =================================================================

  describe("C-01: Timelock - Fee Recipient", function () {
    it("should set + confirm fee recipient via timelock", async function () {
      const { vault, owner, feeRecipient, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(owner).setFeeRecipient(user1.address);
      expect(await vault.pendingFeeRecipient()).to.equal(user1.address);

      await time.increase(TWO_DAYS);

      await expect(vault.connect(owner).confirmFeeRecipient())
        .to.emit(vault, "FeeRecipientConfirmed")
        .withArgs(feeRecipient.address, user1.address);

      expect(await vault.feeRecipient()).to.equal(user1.address);
    });

    it("should revert confirmFeeRecipient before 48 hours", async function () {
      const { vault, owner, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(owner).setFeeRecipient(user1.address);

      await expect(
        vault.connect(owner).confirmFeeRecipient()
      ).to.be.revertedWithCustomError(vault, "TimelockNotElapsed");
    });

    it("should cancel pending fee recipient and emit event", async function () {
      const { vault, owner, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(owner).setFeeRecipient(user1.address);

      await expect(vault.connect(owner).cancelPendingFeeRecipient())
        .to.emit(vault, "PendingFeeRecipientCancelled")
        .withArgs(user1.address);

      expect(await vault.pendingFeeRecipient()).to.equal(ethers.ZeroAddress);
    });
  });

  // =================================================================
  // C-02: Proportional Emergency Withdraw
  // =================================================================

  describe("C-02: Proportional Emergency Withdraw", function () {
    it("should burn proportional shares when agent has borrowed", async function () {
      const { vault, agent, usdc, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
      const sharesBefore = await vault.balanceOf(user1.address);

      // 80% borrowed
      await vault.connect(agent).agentBorrow(parseUSDC(800));

      await vault.connect(user1).emergencyWithdraw();

      const sharesAfter = await vault.balanceOf(user1.address);
      const usdcReceived = await usdc.balanceOf(user1.address);

      // User gets 200 USDC (available), retains ~80% shares
      expect(usdcReceived).to.equal(parseUSDC(9200)); // 9000 kept + 200 withdrawn
      expect(sharesAfter).to.be.greaterThan(0);
      // Burned ~20%, retained ~80%
      const expectedRetained = (sharesBefore * 800n) / 1000n;
      expect(sharesAfter).to.be.closeTo(expectedRetained, parseShares(1));
    });

    it("should burn all shares when no funds borrowed (full withdrawal)", async function () {
      const { vault, usdc, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await vault.connect(user1).emergencyWithdraw();

      expect(await vault.balanceOf(user1.address)).to.equal(0);
      expect(await usdc.balanceOf(user1.address)).to.equal(parseUSDC(10000));
    });

    it("should burn zero shares when available USDC is zero", async function () {
      const { vault, agent, owner, usdc, user1, user2 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
      const sharesBefore = await vault.balanceOf(user1.address);

      // Raise borrow ratio to 90% so we can borrow more
      await vault.connect(owner).setMaxBorrowRatioBps(9000);
      // Borrow 900, then have user2 deposit to bring available up, then borrow that too
      await vault.connect(agent).agentBorrow(parseUSDC(900));

      // User2 deposits 1000 to add liquidity, then agent borrows remaining
      await vault.connect(user2).deposit(parseUSDC(1000), user2.address);
      // Now vault has 1100 USDC available, totalAssets = 2900 (1100 + 900 + 1000 borrowed... wait)
      // totalAssets = balance(1100) + totalBorrowed(900) = 2000. Max borrow = 90% of 2000 = 1800. Already at 900.
      await vault.connect(agent).agentBorrow(parseUSDC(900));
      // Now vault has 200 available, totalBorrowed = 1800

      // Borrow remaining 200 if possible: ratio = 2000/2000 = 100% > 90%, won't work
      // Let's take a different approach: manually transfer USDC out
      // Actually with 90% cap we can only borrow 1800 of 2000.
      // Let's just accept 200 available and test with that. OR:
      // Just verify the zero-USDC case by having user1 emergency withdraw first (takes the 200),
      // then user2 gets zero.

      // user1 takes the remaining 200
      await vault.connect(user1).emergencyWithdraw();

      // Now vault has 0 USDC available
      const available = await vault.availableAssets();
      expect(available).to.equal(0);

      const user2SharesBefore = await vault.balanceOf(user2.address);
      expect(user2SharesBefore).to.be.greaterThan(0);

      // User2 emergency withdraw with 0 available -- should keep all shares
      await vault.connect(user2).emergencyWithdraw();

      const user2SharesAfter = await vault.balanceOf(user2.address);
      expect(user2SharesAfter).to.equal(user2SharesBefore);
    });

    it("should handle multi-user proportional emergency withdraw", async function () {
      const { vault, agent, usdc, user1, user2 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
      await vault.connect(user2).deposit(parseUSDC(1000), user2.address);

      // Agent borrows 80% of 2000 = 1600, leaving 400 available
      await vault.connect(agent).agentBorrow(parseUSDC(1600));

      // User1 emergency withdraws first -- gets all 400 available (first-come-first-served)
      await vault.connect(user1).emergencyWithdraw();

      const user1Usdc = await usdc.balanceOf(user1.address);
      const user1Shares = await vault.balanceOf(user1.address);

      // User1 started with 9000 (10000-1000 deposited), gets 400 back = 9400
      expect(user1Usdc).to.equal(parseUSDC(9400));
      expect(user1Shares).to.be.greaterThan(0); // retains shares for borrowed portion

      // User2 withdraws -- 0 available, keeps all shares
      const user2SharesBefore = await vault.balanceOf(user2.address);
      await vault.connect(user2).emergencyWithdraw();

      const user2Usdc = await usdc.balanceOf(user2.address);
      const user2Shares = await vault.balanceOf(user2.address);
      expect(user2Usdc).to.equal(parseUSDC(9000)); // no USDC returned
      expect(user2Shares).to.equal(user2SharesBefore); // all shares retained
    });

    it("should work when vault is paused", async function () {
      const { vault, agent, owner, usdc, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
      await vault.connect(agent).agentBorrow(parseUSDC(500));
      await vault.connect(owner).pause();

      await vault.connect(user1).emergencyWithdraw();

      const balance = await usdc.balanceOf(user1.address);
      expect(balance).to.be.greaterThan(parseUSDC(9000));
    });
  });

  // =================================================================
  // H-01: Max Borrow Ratio
  // =================================================================

  describe("H-01: Max Borrow Ratio", function () {
    it("should enforce 80% default (borrow exactly 80% succeeds, 80%+1 fails)", async function () {
      const { vault, agent, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      // 80% = 800 USDC should succeed
      await vault.connect(agent).agentBorrow(parseUSDC(800));
      expect(await vault.totalBorrowed()).to.equal(parseUSDC(800));
    });

    it("should reject borrow exceeding 80% ratio", async function () {
      const { vault, agent, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await expect(
        vault.connect(agent).agentBorrow(parseUSDC(801))
      ).to.be.revertedWithCustomError(vault, "BorrowRatioExceeded");
    });

    it("should update and enforce new borrow ratio", async function () {
      const { vault, owner, agent, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      // Lower to 50%
      await vault.connect(owner).setMaxBorrowRatioBps(5000);

      await expect(
        vault.connect(agent).agentBorrow(parseUSDC(501))
      ).to.be.revertedWithCustomError(vault, "BorrowRatioExceeded");

      await vault.connect(agent).agentBorrow(parseUSDC(500));
      expect(await vault.totalBorrowed()).to.equal(parseUSDC(500));
    });

    it("should revert setMaxBorrowRatioBps above 9000", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await expect(
        vault.connect(owner).setMaxBorrowRatioBps(9001)
      ).to.be.revertedWithCustomError(vault, "BorrowRatioTooHigh");

      // 9000 should succeed
      await vault.connect(owner).setMaxBorrowRatioBps(9000);
      expect(await vault.maxBorrowRatioBps()).to.equal(9000);
    });

    it("should only allow owner to set borrow ratio", async function () {
      const { vault, unauthorized } = await loadFixture(deployVaultFixture);
      await expect(
        vault.connect(unauthorized).setMaxBorrowRatioBps(5000)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  // =================================================================
  // M-01: Borrow Timeout + Bad Debt Write-off
  // =================================================================

  describe("M-01: Borrow Timeout", function () {
    it("should write off bad debt after maxBorrowDuration", async function () {
      const { vault, agent, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await vault.connect(agent).agentBorrow(parseUSDC(800));
      expect(await vault.totalBorrowed()).to.equal(parseUSDC(800));

      await time.increase(SEVEN_DAYS + 1);

      await expect(vault.writeOffBadDebt())
        .to.emit(vault, "BadDebtWrittenOff")
        .withArgs(parseUSDC(800));

      expect(await vault.totalBorrowed()).to.equal(0);
      expect(await vault.lastBorrowTimestamp()).to.equal(0);
    });

    it("should revert writeOffBadDebt before timeout", async function () {
      const { vault, agent, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await vault.connect(agent).agentBorrow(parseUSDC(500));

      await time.increase(SEVEN_DAYS - 100);

      await expect(
        vault.writeOffBadDebt()
      ).to.be.revertedWithCustomError(vault, "BorrowNotTimedOut");
    });

    it("should revert writeOffBadDebt when no debt exists", async function () {
      const { vault } = await loadFixture(deployVaultFixture);
      await expect(
        vault.writeOffBadDebt()
      ).to.be.revertedWithCustomError(vault, "NoBadDebt");
    });

    it("should treat agentReturn after writeOff as pure profit", async function () {
      const { vault, agent, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await vault.connect(agent).agentBorrow(parseUSDC(800));

      // Write off bad debt
      await time.increase(SEVEN_DAYS + 1);
      await vault.writeOffBadDebt();

      // totalAssets is now 200 (only vault balance). totalBorrowed = 0
      expect(await vault.totalAssets()).to.equal(parseUSDC(200));

      // Agent returns some USDC -- treated as profit since totalBorrowed is 0
      await vault.connect(agent).agentReturn(parseUSDC(500));

      // totalAssets = 200 + 500 = 700 (all in vault)
      expect(await vault.totalAssets()).to.be.greaterThanOrEqual(parseUSDC(690)); // minus fee
      expect(await vault.totalBorrowed()).to.equal(0);
    });

    it("should allow owner to update maxBorrowDuration", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await expect(vault.connect(owner).setMaxBorrowDuration(14 * ONE_DAY))
        .to.emit(vault, "MaxBorrowDurationUpdated")
        .withArgs(SEVEN_DAYS, 14 * ONE_DAY);

      expect(await vault.maxBorrowDuration()).to.equal(14 * ONE_DAY);
    });
  });

  // =================================================================
  // M-02: Lock Time Cap
  // =================================================================

  describe("M-02: Lock Time Cap", function () {
    it("should revert setMinLockTime above 7 days", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await expect(
        vault.connect(owner).setMinLockTime(SEVEN_DAYS + 1)
      ).to.be.revertedWithCustomError(vault, "LockTimeTooLong");
    });

    it("should succeed at exactly 7 days", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await vault.connect(owner).setMinLockTime(SEVEN_DAYS);
      expect(await vault.minLockTime()).to.equal(SEVEN_DAYS);
    });
  });

  // =================================================================
  // setPerformanceFeeBps (Timelock)
  // =================================================================

  describe("setPerformanceFeeBps (Timelock)", function () {
    it("should initiate performance fee change and emit event", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await expect(vault.connect(owner).setPerformanceFeeBps(1000))
        .to.emit(vault, "PendingPerformanceFeeBpsSet");
      expect(await vault.pendingPerformanceFeeBps()).to.equal(1000);
    });

    it("should revert if bps > 2000", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await expect(
        vault.connect(owner).setPerformanceFeeBps(2001)
      ).to.be.revertedWith("Fee too high");
    });

    it("should not change performanceFeeBps immediately", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await vault.connect(owner).setPerformanceFeeBps(1000);
      // Still the original value
      expect(await vault.performanceFeeBps()).to.equal(500);
    });

    it("should confirm after 48 hours", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await vault.connect(owner).setPerformanceFeeBps(1000);
      await time.increase(TWO_DAYS + 1);
      await expect(vault.connect(owner).confirmPerformanceFeeBps())
        .to.emit(vault, "PerformanceFeeBpsConfirmed")
        .withArgs(500, 1000);
      expect(await vault.performanceFeeBps()).to.equal(1000);
      expect(await vault.pendingPerformanceFeeBpsTimestamp()).to.equal(0);
    });

    it("should revert confirm before 48 hours", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await vault.connect(owner).setPerformanceFeeBps(1000);

      await time.increase(TWO_DAYS - 10);

      await expect(
        vault.connect(owner).confirmPerformanceFeeBps()
      ).to.be.revertedWithCustomError(vault, "TimelockNotElapsed");
    });

    it("should revert confirm when no pending change", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await expect(
        vault.connect(owner).confirmPerformanceFeeBps()
      ).to.be.revertedWithCustomError(vault, "NoPendingChange");
    });

    it("should cancel pending performance fee change", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await vault.connect(owner).setPerformanceFeeBps(1000);

      await expect(vault.connect(owner).cancelPendingPerformanceFeeBps())
        .to.emit(vault, "PendingPerformanceFeeBpsCancelled")
        .withArgs(1000);

      expect(await vault.pendingPerformanceFeeBpsTimestamp()).to.equal(0);
      expect(await vault.performanceFeeBps()).to.equal(500);
    });

    it("should revert cancel when no pending change", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await expect(
        vault.connect(owner).cancelPendingPerformanceFeeBps()
      ).to.be.revertedWithCustomError(vault, "NoPendingChange");
    });

    it("should only allow owner to initiate", async function () {
      const { vault, unauthorized } = await loadFixture(deployVaultFixture);
      await expect(
        vault.connect(unauthorized).setPerformanceFeeBps(1000)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  // =================================================================
  // Emergency Withdraw Rounding Guard (WithdrawalTooSmall)
  // =================================================================

  describe("Emergency Withdraw Rounding Guard", function () {
    it("should define WithdrawalTooSmall error in contract ABI", async function () {
      const { vault } = await loadFixture(deployVaultFixture);
      const errorFragment = vault.interface.getError("WithdrawalTooSmall");
      expect(errorFragment).to.not.be.null;
      expect(errorFragment!.name).to.equal("WithdrawalTooSmall");
    });

    it("should revert WithdrawalTooSmall when sharesToBurn rounds to 0", async function () {
      const { vault, agent, usdc, owner, user1 } = await loadFixture(deployVaultFixture);

      // Deposit and set up a partial withdrawal scenario
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
      await vault.connect(agent).agentBorrow(parseUSDC(800));

      // Now: user1 has ~1000e12 shares, available = 200e6, totalAssets = 1000e6
      // In the partial branch: sharesToBurn = (shares * available) / assets
      //
      // With USDC's 6+6 offset, shares are always ~1e6x larger than asset values,
      // so sharesToBurn naturally stays > 0. We use hardhat_setStorageAt to directly
      // set totalBorrowed to an astronomically large value, making
      // user1's asset value >> shares * available so division rounds to 0.

      const vaultAddr = await vault.getAddress();

      // Scan storage slots to find totalBorrowed (value = 800e6 = 800000000)
      // Storage layout after inherited contracts (ERC20: ~5 slots, ERC4626: 0, Ownable: 1,
      // ReentrancyGuard: 1, Pausable: 1 = ~8 base slots). Check slots 0-30.
      const targetValue = ethers.zeroPadValue(ethers.toBeHex(parseUSDC(800)), 32);
      let totalBorrowedSlot: string | null = null;

      for (let i = 0; i < 40; i++) {
        const slot = ethers.toBeHex(i, 32);
        const value = await ethers.provider.getStorage(vaultAddr, slot);
        if (value === targetValue) {
          totalBorrowedSlot = slot;
          break;
        }
      }

      expect(totalBorrowedSlot).to.not.be.null;

      // Set totalBorrowed to a massive value so that:
      // totalAssets = available (200e6) + totalBorrowed (massive) ~ massive
      // user1 assets = convertToAssets(shares) ~ massive (proportional to total)
      // sharesToBurn = (shares * available) / assets
      // With shares ~ 1000e12 and available = 200e6:
      //   shares * available ~ 2e20
      // We need assets > 2e20, so totalBorrowed > 2e20.
      // Setting totalBorrowed = 1e30 makes assets ~ 1e30.
      // sharesToBurn = 2e20 / 1e30 = 0.
      const massiveValue = 10n ** 30n;
      await ethers.provider.send("hardhat_setStorageAt", [
        vaultAddr,
        totalBorrowedSlot!,
        ethers.zeroPadValue(ethers.toBeHex(massiveValue), 32)
      ]);

      // Verify totalBorrowed was set
      expect(await vault.totalBorrowed()).to.equal(massiveValue);

      // Now user1's emergency withdraw enters the partial branch (assets >> available)
      // and sharesToBurn rounds to 0, triggering WithdrawalTooSmall
      await expect(
        vault.connect(user1).emergencyWithdraw()
      ).to.be.revertedWithCustomError(vault, "WithdrawalTooSmall");
    });
  });
});
