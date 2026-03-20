import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("DarwinVaultV3", function () {
  const USDC_DECIMALS = 6;
  const parseUSDC = (amount: number) => ethers.parseUnits(amount.toString(), USDC_DECIMALS);
  const ONE_HOUR = 3600;
  const ONE_DAY = 86400;
  const ONE_YEAR = 365 * ONE_DAY;

  async function deployVaultFixture() {
    const [owner, agent, feeRecipient, user1, user2, unauthorized] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    await usdc.waitForDeployment();

    const VaultV3 = await ethers.getContractFactory("DarwinVaultV3");
    const vault = await VaultV3.deploy(
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
      expect(await vault.name()).to.equal("DarwinFi Vault USDC V3");
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
    });

    it("should initialize lastFeeCollection to deployment timestamp", async function () {
      const { vault } = await loadFixture(deployVaultFixture);
      const lastFee = await vault.lastFeeCollection();
      expect(lastFee).to.be.greaterThan(0);
    });
  });

  // =================================================================
  // Deposit and Withdraw (V2 functionality preserved)
  // =================================================================

  describe("Deposit and Withdraw", function () {
    it("should deposit USDC and receive shares", async function () {
      const { vault, user1 } = await loadFixture(deployVaultFixture);
      const depositAmount = parseUSDC(1000);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      expect(await vault.balanceOf(user1.address)).to.equal(depositAmount);
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
      const shares = parseUSDC(1000); // 1:1 initially
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

      await vault.connect(agent).agentBorrow(parseUSDC(1000));
      await vault.connect(agent).agentReturn(parseUSDC(1100));

      expect(await vault.totalBorrowed()).to.equal(0);
      expect(await vault.totalAssets()).to.be.greaterThanOrEqual(parseUSDC(1090));
    });

    it("should handle partial return (loss scenario)", async function () {
      const { vault, agent, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await vault.connect(agent).agentBorrow(parseUSDC(1000));
      await vault.connect(agent).agentReturn(parseUSDC(900));

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
  // Performance Fee (5%, not 10%)
  // =================================================================

  describe("Performance Fee", function () {
    it("should use 5% performance fee (not 10%)", async function () {
      const { vault } = await loadFixture(deployVaultFixture);
      expect(await vault.performanceFeeBps()).to.equal(500);
    });

    it("should collect fee on profits above high water mark", async function () {
      const { vault, agent, feeRecipient, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await vault.connect(agent).agentBorrow(parseUSDC(1000));
      await vault.connect(agent).agentReturn(parseUSDC(1200));

      const feeShares = await vault.balanceOf(feeRecipient.address);
      expect(feeShares).to.be.greaterThan(0);
    });

    it("should not collect fee when below high water mark", async function () {
      const { vault, agent, feeRecipient, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      // First trade: profit (sets HWM)
      await vault.connect(agent).agentBorrow(parseUSDC(1000));
      await vault.connect(agent).agentReturn(parseUSDC(1200));
      const feeSharesAfterProfit = await vault.balanceOf(feeRecipient.address);

      // Second trade: loss
      await vault.connect(agent).agentBorrow(parseUSDC(1100));
      await vault.connect(agent).agentReturn(parseUSDC(900));

      // Third trade: small profit but still below HWM
      await vault.connect(agent).agentBorrow(parseUSDC(900));
      await vault.connect(agent).agentReturn(parseUSDC(950));

      // Fee shares should not increase from performance fee
      // (management fee may add a tiny bit from time elapsed between txs)
      const feeSharesNow = await vault.balanceOf(feeRecipient.address);
      // The difference should be negligible (only management fee from seconds elapsed)
      const diff = feeSharesNow - feeSharesAfterProfit;
      // Management fee over a few seconds on ~1000 USDC is < 1 unit
      expect(diff).to.be.lessThanOrEqual(1n);
    });
  });

  // =================================================================
  // Management Fee
  // =================================================================

  describe("Management Fee", function () {
    it("should accrue management fee proportionally over time", async function () {
      const { vault, feeRecipient, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(10000), user1.address);

      // Advance 1 year
      await time.increase(ONE_YEAR);

      await vault.collectManagementFee();

      const feeShares = await vault.balanceOf(feeRecipient.address);
      expect(feeShares).to.be.greaterThan(0);

      // 1% of 10000 = 100 USDC worth of shares over 1 year
      const feeValue = await vault.convertToAssets(feeShares);
      // Allow tolerance for rounding
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

      // Advance 30 days
      await time.increase(30 * ONE_DAY);

      const feeSharesBefore = await vault.balanceOf(feeRecipient.address);
      await vault.connect(agent).agentReturn(parseUSDC(500));
      const feeSharesAfter = await vault.balanceOf(feeRecipient.address);

      // Management fee should have been collected
      expect(feeSharesAfter).to.be.greaterThan(feeSharesBefore);
    });

    it("should not mint fee when zero time has elapsed", async function () {
      const { vault, feeRecipient, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      // Collect immediately (same block as deposit, minimal time elapsed)
      const feeSharesBefore = await vault.balanceOf(feeRecipient.address);
      await vault.collectManagementFee();
      const feeSharesAfter = await vault.balanceOf(feeRecipient.address);

      // Minimal fee for a few seconds elapsed on 1000 USDC at 1% annual
      // ~0.0000317 USDC per second = well under 1 USDC
      const diff = feeSharesAfter - feeSharesBefore;
      expect(diff).to.be.lessThanOrEqual(10n);
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

      // Collect after 6 months
      await time.increase(ONE_YEAR / 2);
      await vault.collectManagementFee();
      const midYearShares = await vault.balanceOf(feeRecipient.address);

      // Collect after another 6 months
      await time.increase(ONE_YEAR / 2);
      await vault.collectManagementFee();
      const fullYearShares = await vault.balanceOf(feeRecipient.address);

      // Full year should be roughly 2x mid-year
      expect(fullYearShares).to.be.greaterThan(midYearShares);

      // Total fee should be ~100 USDC (1% of 10000)
      const totalFeeValue = await vault.convertToAssets(fullYearShares);
      expect(totalFeeValue).to.be.closeTo(parseUSDC(100), parseUSDC(3));
    });

    it("should calculate daily fee correctly (~0.00274% daily)", async function () {
      const { vault, feeRecipient, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(10000), user1.address);

      // Advance exactly 1 day
      await time.increase(ONE_DAY);
      await vault.collectManagementFee();

      const feeShares = await vault.balanceOf(feeRecipient.address);
      const feeValue = await vault.convertToAssets(feeShares);

      // 1% annual / 365 days * 10000 USDC = ~0.2739 USDC per day
      // In 6-decimal USDC: ~273972
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

  describe("setManagementFeeBps", function () {
    it("should only allow owner to set", async function () {
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

    it("should allow setting to 500 (max)", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await vault.connect(owner).setManagementFeeBps(500);
      expect(await vault.managementFeeBps()).to.equal(500);
    });

    it("should allow setting to 0", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await vault.connect(owner).setManagementFeeBps(0);
      expect(await vault.managementFeeBps()).to.equal(0);
    });

    it("should collect pending fee before updating rate", async function () {
      const { vault, owner, feeRecipient, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(10000), user1.address);

      // Advance 6 months
      await time.increase(ONE_YEAR / 2);

      const feeSharesBefore = await vault.balanceOf(feeRecipient.address);
      await vault.connect(owner).setManagementFeeBps(200);
      const feeSharesAfter = await vault.balanceOf(feeRecipient.address);

      // Pending fee should have been collected
      expect(feeSharesAfter).to.be.greaterThan(feeSharesBefore);
    });

    it("should emit ManagementFeeBpsUpdated event", async function () {
      const { vault, owner } = await loadFixture(deployVaultFixture);
      await expect(vault.connect(owner).setManagementFeeBps(200))
        .to.emit(vault, "ManagementFeeBpsUpdated")
        .withArgs(100, 200);
    });
  });

  // =================================================================
  // Combined Fee Scenario
  // =================================================================

  describe("Combined Fees", function () {
    it("should collect both management and performance fees on agentReturn", async function () {
      const { vault, agent, feeRecipient, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await vault.connect(agent).agentBorrow(parseUSDC(1000));

      // Advance 30 days
      await time.increase(30 * ONE_DAY);

      // Return with 10% profit
      await vault.connect(agent).agentReturn(parseUSDC(1100));

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
  // Pause and Emergency (V2 functionality)
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

    it("should cap emergency withdrawal to available USDC when agent has borrowed", async function () {
      const { vault, agent, usdc, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await vault.connect(agent).agentBorrow(parseUSDC(800));

      await vault.connect(user1).emergencyWithdraw();

      const userBalance = await usdc.balanceOf(user1.address);
      expect(userBalance).to.equal(parseUSDC(9200));
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
    it("should only allow owner to set agent", async function () {
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

    it("should allow owner to update agent", async function () {
      const { vault, owner, user1 } = await loadFixture(deployVaultFixture);
      await vault.connect(owner).setAgent(user1.address);
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

      await vault.connect(agent).agentBorrow(parseUSDC(1000));
      await vault.connect(agent).agentReturn(parseUSDC(1100));

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
});
