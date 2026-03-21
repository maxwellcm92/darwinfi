/**
 * register-basename.ts - Register a Basename (.base.eth) for DarwinFi
 *
 * Registers darwinfi.base.eth on Base mainnet using the Basenames
 * UpgradeableRegistrarController. Falls back to alternate names if taken.
 *
 * Usage: npx ts-node scripts/register-basename.ts
 */

import * as dotenv from "dotenv";
import { ethers } from "ethers";
import { checkBasenameAvailable, registerBasename, getRegisterPrice } from "../src/integrations/ens";

dotenv.config();

const PREFERRED_NAMES = ["darwinfi", "darwin-fi", "darwinfi-vault"];

async function main() {
  console.log("=== DarwinFi Basename Registration ===\n");

  const rpcUrl = process.env.BASE_RPC_URL;
  if (!rpcUrl) throw new Error("BASE_RPC_URL not set in .env");

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY not set in .env");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);

  const address = await wallet.getAddress();
  const balance = await provider.getBalance(address);
  console.log(`Wallet: ${address}`);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH`);

  if (balance < ethers.parseEther("0.001")) {
    throw new Error("Insufficient ETH balance. Need at least 0.001 ETH for registration + gas.");
  }

  // Find an available name
  let selectedName: string | null = null;
  for (const name of PREFERRED_NAMES) {
    console.log(`\nChecking availability: ${name}.base.eth...`);
    const available = await checkBasenameAvailable(provider, name);
    if (available) {
      const price = await getRegisterPrice(provider, name, 365 * 24 * 60 * 60);
      console.log(`  ${name}.base.eth is AVAILABLE (price: ${ethers.formatEther(price)} ETH)`);
      selectedName = name;
      break;
    } else {
      console.log(`  ${name}.base.eth is taken`);
    }
  }

  if (!selectedName) {
    throw new Error("All preferred names are taken. Add more options to PREFERRED_NAMES.");
  }

  console.log(`\nRegistering ${selectedName}.base.eth for 1 year...`);
  const txHash = await registerBasename(wallet, selectedName, 1);

  console.log(`\n=== Registration Complete ===`);
  console.log(`Name: ${selectedName}.base.eth`);
  console.log(`TX Hash: ${txHash}`);
  console.log(`BaseScan: https://basescan.org/tx/${txHash}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
