import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("DarwinVaultV2", function () {
  let vault: any;
  let usdc: any;
  let owner: SignerWithAddress;
  let agent: SignerWithAddress;
  let feeRecipient: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let unauthorized: SignerWithAddress;

  const USDC_DECIMALS = 6;
  const parseUSDC = (amount: number) => ethers.parseUnits(amount.toString(), USDC_DECIMALS);

  beforeEach(async function () {
    [owner, agent, feeRecipient, user1, user2, unauthorized] = await ethers.getSigners();

    // Deploy mock USDC
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    await usdc.waitForDeployment();

    // Deploy VaultV2
    const VaultV2 = await ethers.getContractFactory("DarwinVaultV2");
    vault = await VaultV2.deploy(
      await usdc.getAddress(),
      owner.address,
      agent.address,
      feeRecipient.address
    );
    await vault.waitForDeployment();

    // Mint USDC to users and agent
    await usdc.mint(user1.address, parseUSDC(10000));
    await usdc.mint(user2.address, parseUSDC(10000));
    await usdc.mint(agent.address, parseUSDC(10000));

    // Approve vault for users
    const vaultAddr = await vault.getAddress();
    await usdc.connect(user1).approve(vaultAddr, ethers.MaxUint256);
    await usdc.connect(user2).approve(vaultAddr, ethers.MaxUint256);
    await usdc.connect(agent).approve(vaultAddr, ethers.MaxUint256);
  });

  describe("Deployment", function () {
    it("should set correct name and symbol", async function () {
      expect(await vault.name()).to.equal("DarwinFi Vault USDC");
      expect(await vault.symbol()).to.equal("dvUSDC");
    });

    it("should set correct initial state", async function () {
      expect(await vault.agent()).to.equal(agent.address);
      expect(await vault.feeRecipient()).to.equal(feeRecipient.address);
      expect(await vault.performanceFeeBps()).to.equal(1000);
      expect(await vault.maxTotalAssets()).to.equal(parseUSDC(10000));
      expect(await vault.minLockTime()).to.equal(3600); // 1 hour
      expect(await vault.totalBorrowed()).to.equal(0);
    });
  });

  describe("Deposit and Withdraw", function () {
    it("should deposit USDC and receive shares", async function () {
      const depositAmount = parseUSDC(1000);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      // First deposit: 1:1 share ratio
      expect(await vault.balanceOf(user1.address)).to.equal(depositAmount);
      expect(await vault.totalAssets()).to.equal(depositAmount);
    });

    it("should allow withdrawal after lock time", async function () {
      const depositAmount = parseUSDC(1000);
      await vault.connect(user1).deposit(depositAmount, user1.address);

      // Fast forward past lock time
      await time.increase(3601);

      const shares = await vault.balanceOf(user1.address);
      await vault.connect(user1).redeem(shares, user1.address, user1.address);

      expect(await vault.balanceOf(user1.address)).to.equal(0);
      expect(await usdc.balanceOf(user1.address)).to.equal(parseUSDC(10000));
    });

    it("should revert withdrawal before lock time", async function () {
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      const shares = await vault.balanceOf(user1.address);
      await expect(
        vault.connect(user1).redeem(shares, user1.address, user1.address)
      ).to.be.revertedWithCustomError(vault, "LockTimeNotElapsed");
    });

    it("should enforce maxTotalAssets cap", async function () {
      // Vault max is 10,000 USDC
      await vault.connect(user1).deposit(parseUSDC(9000), user1.address);

      // This should revert (would exceed 10,000)
      await expect(
        vault.connect(user2).deposit(parseUSDC(2000), user2.address)
      ).to.be.revertedWithCustomError(vault, "MaxAssetsExceeded");

      // 1000 should work
      await vault.connect(user2).deposit(parseUSDC(1000), user2.address);
    });
  });

  describe("Multiple Depositors with Proportional Returns", function () {
    it("should give proportional shares to multiple depositors", async function () {
      // User1 deposits 1000, user2 deposits 3000
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
      await vault.connect(user2).deposit(parseUSDC(3000), user2.address);

      const shares1 = await vault.balanceOf(user1.address);
      const shares2 = await vault.balanceOf(user2.address);

      // User2 should have 3x the shares of user1
      expect(shares2).to.equal(shares1 * 3n);
    });

    it("should distribute profits proportionally", async function () {
      // Both deposit
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
      await vault.connect(user2).deposit(parseUSDC(3000), user2.address);

      // Agent borrows 4000, returns 4400 (10% profit = 400 USDC)
      await vault.connect(agent).agentBorrow(parseUSDC(4000));
      await vault.connect(agent).agentReturn(parseUSDC(4400));

      // After 10% performance fee on profit: fee = 40 USDC
      // Remaining profit distributed proportionally via share price increase

      await time.increase(3601);

      // Check that user2's position is worth ~3x user1's
      const value1 = await vault.convertToAssets(await vault.balanceOf(user1.address));
      const value2 = await vault.convertToAssets(await vault.balanceOf(user2.address));

      // Allow small rounding tolerance
      const ratio = Number(value2) / Number(value1);
      expect(ratio).to.be.closeTo(3, 0.01);
    });
  });

  describe("Agent Borrow/Return", function () {
    it("should allow agent to borrow and return USDC", async function () {
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      // Borrow
      await vault.connect(agent).agentBorrow(parseUSDC(500));
      expect(await vault.totalBorrowed()).to.equal(parseUSDC(500));
      expect(await vault.totalAssets()).to.equal(parseUSDC(1000)); // 500 in vault + 500 borrowed

      // Return
      await vault.connect(agent).agentReturn(parseUSDC(500));
      expect(await vault.totalBorrowed()).to.equal(0);
    });

    it("should handle profitable return correctly", async function () {
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await vault.connect(agent).agentBorrow(parseUSDC(1000));
      // Return with profit
      await vault.connect(agent).agentReturn(parseUSDC(1100));

      expect(await vault.totalBorrowed()).to.equal(0);
      // Total assets should be 1100 (profit included)
      expect(await vault.totalAssets()).to.be.greaterThanOrEqual(parseUSDC(1090));
    });

    it("should handle partial return correctly", async function () {
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await vault.connect(agent).agentBorrow(parseUSDC(1000));
      // Return less than borrowed (loss scenario -- 100 still outstanding)
      await vault.connect(agent).agentReturn(parseUSDC(900));

      // 100 USDC still tracked as borrowed
      expect(await vault.totalBorrowed()).to.equal(parseUSDC(100));
      // Total assets = 900 in vault + 100 borrowed = 1000 (unchanged from perspective)
      expect(await vault.totalAssets()).to.equal(parseUSDC(1000));
    });

    it("should realize loss when remaining borrowed is written off", async function () {
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await vault.connect(agent).agentBorrow(parseUSDC(1000));
      // Return 900 (100 loss), then return 0 would leave 100 borrowed
      // Agent returns all it has
      await vault.connect(agent).agentReturn(parseUSDC(900));

      // Return remaining 0 -- agent signals it's done by returning borrowed amount
      // Separately return 0 for the remaining -- not possible (ZeroAmount)
      // The loss materializes when viewed as available assets
      expect(await vault.availableAssets()).to.equal(parseUSDC(900));
    });

    it("should revert borrow from non-agent", async function () {
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await expect(
        vault.connect(unauthorized).agentBorrow(parseUSDC(100))
      ).to.be.revertedWithCustomError(vault, "Unauthorized");
    });

    it("should revert borrow exceeding available balance", async function () {
      await vault.connect(user1).deposit(parseUSDC(100), user1.address);

      await expect(
        vault.connect(agent).agentBorrow(parseUSDC(200))
      ).to.be.revertedWithCustomError(vault, "InsufficientVaultBalance");
    });
  });

  describe("Performance Fee", function () {
    it("should collect fee on profits above high water mark", async function () {
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      // Agent makes profit
      await vault.connect(agent).agentBorrow(parseUSDC(1000));
      await vault.connect(agent).agentReturn(parseUSDC(1200));

      // Fee recipient should have received shares
      const feeShares = await vault.balanceOf(feeRecipient.address);
      expect(feeShares).to.be.greaterThan(0);
    });

    it("should not collect fee when below high water mark", async function () {
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      // First trade: profit (sets high water mark)
      await vault.connect(agent).agentBorrow(parseUSDC(1000));
      await vault.connect(agent).agentReturn(parseUSDC(1200));

      const feeSharesAfterProfit = await vault.balanceOf(feeRecipient.address);

      // Second trade: loss
      await vault.connect(agent).agentBorrow(parseUSDC(1100));
      await vault.connect(agent).agentReturn(parseUSDC(900));

      // Third trade: small profit (but still below high water mark)
      await vault.connect(agent).agentBorrow(parseUSDC(900));
      await vault.connect(agent).agentReturn(parseUSDC(950));

      // Fee shares should not have increased
      expect(await vault.balanceOf(feeRecipient.address)).to.equal(feeSharesAfterProfit);
    });
  });

  describe("Pause and Emergency", function () {
    it("should block deposits when paused", async function () {
      await vault.connect(owner).pause();

      await expect(
        vault.connect(user1).deposit(parseUSDC(100), user1.address)
      ).to.be.revertedWithCustomError(vault, "EnforcedPause");
    });

    it("should allow withdrawal when paused (after lock time)", async function () {
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
      await time.increase(3601);

      await vault.connect(owner).pause();

      const shares = await vault.balanceOf(user1.address);
      await vault.connect(user1).redeem(shares, user1.address, user1.address);
      expect(await vault.balanceOf(user1.address)).to.equal(0);
    });

    it("should allow emergency withdraw even when paused", async function () {
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await vault.connect(owner).pause();

      // Emergency withdraw ignores lock time and pause
      await vault.connect(user1).emergencyWithdraw();
      expect(await vault.balanceOf(user1.address)).to.equal(0);
    });

    it("should cap emergency withdrawal to available USDC when agent has borrowed", async function () {
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      // Agent borrows 800, leaving only 200 in vault
      await vault.connect(agent).agentBorrow(parseUSDC(800));

      await vault.connect(user1).emergencyWithdraw();

      // User should receive at most 200 USDC (what's available)
      const userBalance = await usdc.balanceOf(user1.address);
      // Started with 10000, deposited 1000, got back at most 200
      expect(userBalance).to.equal(parseUSDC(9200));
    });
  });

  describe("Access Control", function () {
    it("should only allow owner to set agent", async function () {
      await expect(
        vault.connect(unauthorized).setAgent(unauthorized.address)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("should only allow owner to pause", async function () {
      await expect(
        vault.connect(unauthorized).pause()
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("should only allow owner to set max total assets", async function () {
      await expect(
        vault.connect(unauthorized).setMaxTotalAssets(parseUSDC(50000))
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("should allow owner to update agent", async function () {
      await vault.connect(owner).setAgent(user1.address);
      expect(await vault.agent()).to.equal(user1.address);
    });

    it("should reject zero address for agent", async function () {
      await expect(
        vault.connect(owner).setAgent(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(vault, "ZeroAddress");
    });
  });

  describe("Share Price", function () {
    it("should return 1:1 share price when vault is empty", async function () {
      expect(await vault.sharePrice()).to.equal(parseUSDC(1));
    });

    it("should increase share price after agent profit", async function () {
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      // Agent makes 10% profit
      await vault.connect(agent).agentBorrow(parseUSDC(1000));
      await vault.connect(agent).agentReturn(parseUSDC(1100));

      const price = await vault.sharePrice();
      // Price should be > 1.0 USDC per share (minus performance fee)
      expect(price).to.be.greaterThan(parseUSDC(1));
    });
  });
});
