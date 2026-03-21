/**
 * deposit-usdc-v4.ts - Deposit USDC into DarwinVaultV4
 *
 * Approves the vault to spend USDC, then deposits via ERC-4626 deposit().
 *
 * Usage: npx hardhat run scripts/deposit-usdc-v4.ts --network base
 */

import { ethers } from "hardhat";

const USDC_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
];

const VAULT_ABI = [
  "function deposit(uint256 assets, address receiver) external returns (uint256)",
  "function totalAssets() external view returns (uint256)",
  "function sharePrice() external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Depositing USDC with account:", deployer.address);

  const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const V4_ADDRESS = process.env.DARWIN_VAULT_V4_ADDRESS;

  if (!V4_ADDRESS) {
    throw new Error("DARWIN_VAULT_V4_ADDRESS not set in .env");
  }

  console.log("USDC:", USDC_ADDRESS);
  console.log("Vault V4:", V4_ADDRESS);

  const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, deployer);
  const vault = new ethers.Contract(V4_ADDRESS, VAULT_ABI, deployer);

  // 50 USDC (6 decimals)
  const depositAmount = 50_000_000n;
  console.log(`\nDeposit amount: ${ethers.formatUnits(depositAmount, 6)} USDC`);

  // Check USDC balance
  const balance = await usdc.balanceOf(deployer.address);
  console.log(`USDC balance: ${ethers.formatUnits(balance, 6)} USDC`);

  if (balance < depositAmount) {
    throw new Error(`Insufficient USDC: have ${ethers.formatUnits(balance, 6)}, need ${ethers.formatUnits(depositAmount, 6)}`);
  }

  // Approve vault to spend USDC
  const allowance = await usdc.allowance(deployer.address, V4_ADDRESS);
  if (allowance < depositAmount) {
    console.log("\nApproving vault to spend USDC...");
    const approveTx = await usdc.approve(V4_ADDRESS, depositAmount);
    await approveTx.wait();
    console.log("Approved. TX:", approveTx.hash);
  } else {
    console.log("Sufficient allowance already set.");
  }

  // Deposit
  console.log("\nDepositing into VaultV4...");
  const depositTx = await vault.deposit(depositAmount, deployer.address);
  const receipt = await depositTx.wait();
  console.log("Deposited. TX:", depositTx.hash);
  console.log("Gas used:", receipt.gasUsed.toString());

  // Show vault state
  const totalAssets = await vault.totalAssets();
  const sharePrice = await vault.sharePrice();
  const shares = await vault.balanceOf(deployer.address);
  const totalSupply = await vault.totalSupply();

  console.log("\n=== Vault State ===");
  console.log(`Total assets: ${ethers.formatUnits(totalAssets, 6)} USDC`);
  console.log(`Share price: ${ethers.formatUnits(sharePrice, 12)}`);
  console.log(`Your shares: ${ethers.formatUnits(shares, 12)}`);
  console.log(`Total supply: ${ethers.formatUnits(totalSupply, 12)}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
