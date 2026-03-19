/**
 * DarwinFi Wallet Setup
 *
 * Generates a fresh wallet for trading on Base mainnet.
 * Prints the address and private key, then appends to .env.
 */

import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const wallet = ethers.Wallet.createRandom();

  console.log("========================================");
  console.log("[DarwinFi] New Trading Wallet Generated");
  console.log("========================================");
  console.log(`Address:     ${wallet.address}`);
  console.log(`Private Key: ${wallet.privateKey}`);
  console.log("========================================");

  // Update .env with the real private key
  const envPath = path.join(__dirname, "..", ".env");
  let envContent = fs.readFileSync(envPath, "utf-8");

  // Replace the dummy private key
  envContent = envContent.replace(
    /^PRIVATE_KEY=.*$/m,
    `PRIVATE_KEY=${wallet.privateKey}`
  );

  fs.writeFileSync(envPath, envContent);
  console.log("\n[DarwinFi] .env updated with PRIVATE_KEY");

  console.log("\n--- NEXT STEPS ---");
  console.log(`1. Send ~0.01 ETH to ${wallet.address} on Base mainnet (for gas)`);
  console.log(`2. Send $75 USDC to ${wallet.address} on Base mainnet`);
  console.log(`   USDC on Base: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`);
  console.log("3. Run: npm run deploy:base");
  console.log("4. Fund the vault and set DRY_RUN=false");
}

main().catch(console.error);
