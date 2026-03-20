import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying DarwinVaultV4 with account:", deployer.address);

  // Base USDC address
  const USDC_ADDRESS = process.env.USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

  // Agent address (Lit PKP or current wallet as fallback)
  const agentAddress = process.env.LIT_PKP_ADDRESS || deployer.address;

  // Fee recipient
  const feeRecipient = process.env.FEE_RECIPIENT || deployer.address;

  console.log("USDC:", USDC_ADDRESS);
  console.log("Agent:", agentAddress);
  console.log("Fee recipient:", feeRecipient);

  const VaultV4 = await ethers.getContractFactory("DarwinVaultV4");
  const vault = await VaultV4.deploy(
    USDC_ADDRESS,
    deployer.address, // owner
    agentAddress,
    feeRecipient
  );

  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log("DarwinVaultV4 deployed to:", vaultAddress);

  console.log("\nAdd to .env:");
  console.log(`DARWIN_VAULT_V4_ADDRESS=${vaultAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
