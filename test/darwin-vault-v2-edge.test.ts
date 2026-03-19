import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("DarwinVaultV2 Edge Cases", function () {
  let vault: any;
  let usdc: any;
  let owner: SignerWithAddress;
  let agent: SignerWithAddress;
  let feeRecipient: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;

  const USDC_DECIMALS = 6;
  const parseUSDC = (amount: number) => ethers.parseUnits(amount.toString(), USDC_DECIMALS);

  beforeEach(async function () {
    [owner, agent, feeRecipient, user1, user2, user3] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
    await usdc.waitForDeployment();

    const VaultV2 = await ethers.getContractFactory("DarwinVaultV2");
    vault = await VaultV2.deploy(
      await usdc.getAddress(),
      owner.address,
      agent.address,
      feeRecipient.address
    );
    await vault.waitForDeployment();

    // Mint USDC to all participants
    await usdc.mint(user1.address, parseUSDC(100000));
    await usdc.mint(user2.address, parseUSDC(100000));
    await usdc.mint(user3.address, parseUSDC(100000));
    await usdc.mint(agent.address, parseUSDC(100000));

    const vaultAddr = await vault.getAddress();
    await usdc.connect(user1).approve(vaultAddr, ethers.MaxUint256);
    await usdc.connect(user2).approve(vaultAddr, ethers.MaxUint256);
    await usdc.connect(user3).approve(vaultAddr, ethers.MaxUint256);
    await usdc.connect(agent).approve(vaultAddr, ethers.MaxUint256);
  });

  // ---------- Share price precision ----------

  describe("Share price precision under stress", function () {
    it("should maintain share price precision after 100 tiny deposits + 100 tiny withdrawals", async function () {
      // Increase max total assets to allow many deposits
      await vault.connect(owner).setMaxTotalAssets(parseUSDC(1000000));

      const tinyAmount = parseUSDC(1); // 1 USDC each

      // 100 tiny deposits
      for (let i = 0; i < 100; i++) {
        await vault.connect(user1).deposit(tinyAmount, user1.address);
      }

      const sharePriceAfterDeposits = await vault.sharePrice();
      // Share price should still be ~1.0 USDC (1e6)
      expect(sharePriceAfterDeposits).to.equal(parseUSDC(1));

      await time.increase(3601);

      // Withdraw in 100 tiny batches
      const sharesPerWithdraw = (await vault.balanceOf(user1.address)) / 100n;
      for (let i = 0; i < 99; i++) {
        await vault.connect(user1).redeem(sharesPerWithdraw, user1.address, user1.address);
      }

      // Withdraw remaining
      const remainingShares = await vault.balanceOf(user1.address);
      if (remainingShares > 0n) {
        await vault.connect(user1).redeem(remainingShares, user1.address, user1.address);
      }

      // After all withdrawals, user should have approximately their original USDC back
      const finalBalance = await usdc.balanceOf(user1.address);
      // Allow 1 USDC rounding tolerance over 200 ops
      expect(finalBalance).to.be.closeTo(parseUSDC(100000), parseUSDC(1));
    });
  });

  // ---------- HWM tracking ----------

  describe("High water mark tracking", function () {
    it("should update HWM through borrow-profit-borrow cycle", async function () {
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      // First cycle: borrow 1000, return 1200 (200 profit)
      await vault.connect(agent).agentBorrow(parseUSDC(1000));
      await vault.connect(agent).agentReturn(parseUSDC(1200));

      const hwm1 = await vault.highWaterMark();
      expect(hwm1).to.be.greaterThan(0);

      // Second cycle: borrow again, return with more profit
      await vault.connect(agent).agentBorrow(parseUSDC(1000));
      await vault.connect(agent).agentReturn(parseUSDC(1300));

      const hwm2 = await vault.highWaterMark();
      // HWM should have increased after new all-time high
      expect(hwm2).to.be.greaterThan(hwm1);
    });
  });

  // ---------- Fee calculation ----------

  describe("Fee share calculation", function () {
    it("should mint fee shares = profit * feeBps / 10000 worth", async function () {
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      const feeSharesBefore = await vault.balanceOf(feeRecipient.address);
      expect(feeSharesBefore).to.equal(0);

      // Agent makes 100 USDC profit
      await vault.connect(agent).agentBorrow(parseUSDC(1000));
      await vault.connect(agent).agentReturn(parseUSDC(1100));

      // Fee = 100 * 1000/10000 = 10 USDC worth of shares
      const feeSharesAfter = await vault.balanceOf(feeRecipient.address);
      expect(feeSharesAfter).to.be.greaterThan(0);

      // The fee shares should represent roughly 10 USDC at current share price
      const feeValue = await vault.convertToAssets(feeSharesAfter);
      // Allow some rounding tolerance
      expect(feeValue).to.be.closeTo(parseUSDC(10), parseUSDC(1));
    });
  });

  // ---------- Emergency withdraw with 100% borrowed ----------

  describe("Emergency withdraw with 100% borrowed", function () {
    it("should return 0 USDC when all assets are borrowed by agent", async function () {
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      // Agent borrows everything
      await vault.connect(agent).agentBorrow(parseUSDC(1000));

      const availableBefore = await vault.availableAssets();
      expect(availableBefore).to.equal(0);

      const balanceBefore = await usdc.balanceOf(user1.address);
      await vault.connect(user1).emergencyWithdraw();
      const balanceAfter = await usdc.balanceOf(user1.address);

      // Should receive 0 since nothing is in the vault
      expect(balanceAfter - balanceBefore).to.equal(0);
      // Shares should be burned
      expect(await vault.balanceOf(user1.address)).to.equal(0);
    });
  });

  // ---------- Multi-user concurrent deposits ----------

  describe("Multi-user concurrent deposits", function () {
    it("should give proportional shares: user1 deposits X, user2 deposits 2X", async function () {
      await vault.connect(owner).setMaxTotalAssets(parseUSDC(100000));

      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);
      await vault.connect(user2).deposit(parseUSDC(2000), user2.address);

      const shares1 = await vault.balanceOf(user1.address);
      const shares2 = await vault.balanceOf(user2.address);

      expect(shares2).to.equal(shares1 * 2n);
    });

    it("should give proportional shares when depositing at different share prices", async function () {
      await vault.connect(owner).setMaxTotalAssets(parseUSDC(100000));

      // User1 deposits first
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      // Agent makes profit, increasing share price
      await vault.connect(agent).agentBorrow(parseUSDC(1000));
      await vault.connect(agent).agentReturn(parseUSDC(1100));

      // User2 deposits at higher share price -- gets fewer shares
      await vault.connect(user2).deposit(parseUSDC(1000), user2.address);

      const shares1 = await vault.balanceOf(user1.address);
      const shares2 = await vault.balanceOf(user2.address);

      // User2 should have fewer shares since share price increased
      expect(shares2).to.be.lessThan(shares1);
    });
  });

  // ---------- maxTotalAssets boundary ----------

  describe("maxTotalAssets boundary", function () {
    it("should deposit to exact cap and revert on 1 additional wei", async function () {
      const cap = parseUSDC(10000);
      // Fill vault to exactly the cap
      await vault.connect(user1).deposit(cap, user1.address);

      expect(await vault.totalAssets()).to.equal(cap);

      // 1 wei more should revert
      await expect(
        vault.connect(user2).deposit(1n, user2.address)
      ).to.be.revertedWithCustomError(vault, "MaxAssetsExceeded");
    });
  });

  // ---------- Lock time edge ----------

  describe("Lock time enforcement", function () {
    it("should revert withdraw immediately after deposit (well before lock)", async function () {
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      // Do NOT advance time at all -- should revert since lock is 3600s
      const shares = await vault.balanceOf(user1.address);
      await expect(
        vault.connect(user1).redeem(shares, user1.address, user1.address)
      ).to.be.revertedWithCustomError(vault, "LockTimeNotElapsed");
    });

    it("should allow withdraw at exactly lockTime + 1", async function () {
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await time.increase(3601);

      const shares = await vault.balanceOf(user1.address);
      await vault.connect(user1).redeem(shares, user1.address, user1.address);
      expect(await vault.balanceOf(user1.address)).to.equal(0);
    });
  });

  // ---------- Zero supply: full withdrawal then new deposit ----------

  describe("Zero supply recovery", function () {
    it("should give 1:1 shares after full withdrawal by last user", async function () {
      await vault.connect(user1).deposit(parseUSDC(1000), user1.address);

      await time.increase(3601);

      // Full withdrawal
      const shares = await vault.balanceOf(user1.address);
      await vault.connect(user1).redeem(shares, user1.address, user1.address);

      expect(await vault.totalSupply()).to.equal(0);

      // New deposit should get 1:1 shares
      const newDeposit = parseUSDC(500);
      await vault.connect(user2).deposit(newDeposit, user2.address);

      const newShares = await vault.balanceOf(user2.address);
      expect(newShares).to.equal(newDeposit);
    });
  });

  // ---------- Share price after profit returns to 1:1 on empty vault ----------

  describe("Share price view on empty vault", function () {
    it("should return 1e6 share price when vault is empty", async function () {
      expect(await vault.sharePrice()).to.equal(parseUSDC(1));
    });
  });
});
