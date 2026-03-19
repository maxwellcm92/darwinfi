/**
 * mint-pkp.ts - Mint a Lit Protocol PKP for DarwinFi
 *
 * Mints a new Programmable Key Pair (PKP) on the Lit Chronicle Yellowstone
 * testnet. The PKP will be used by the trading agent to sign transactions
 * through the trade-policy Lit Action.
 *
 * Usage: npx ts-node scripts/mint-pkp.ts
 */

import * as dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config();

async function main() {
  console.log("=== DarwinFi PKP Minting ===\n");

  // Dynamic import for Lit SDK (ESM modules)
  const { LitContracts } = await import("@lit-protocol/contracts-sdk");
  const { LitNodeClient } = await import("@lit-protocol/lit-node-client");

  const LIT_NETWORK = process.env.LIT_NETWORK || "datil-test";
  console.log(`Lit Network: ${LIT_NETWORK}`);

  // Connect to Lit node first to verify connectivity
  console.log("Connecting to Lit network...");
  const litNodeClient = new LitNodeClient({
    litNetwork: LIT_NETWORK as any,
    debug: false,
  });
  await litNodeClient.connect();
  console.log("Lit node connected.\n");

  // Initialize contracts SDK with the deployer wallet
  // Chronicle Yellowstone uses the Lit testnet chain
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY not set in .env");
  }

  console.log("Initializing Lit Contracts SDK...");
  const litContracts = new LitContracts({
    signer: new ethers.Wallet(privateKey),
    network: LIT_NETWORK as any,
    debug: false,
  });
  await litContracts.connect();
  console.log("Contracts SDK connected.\n");

  // Mint a new PKP
  console.log("Minting PKP...");
  const mintResult = await litContracts.pkpNftContractUtils.write.mint();

  console.log("\n=== PKP Minted Successfully ===");
  console.log(`Token ID: ${mintResult.pkp.tokenId}`);
  console.log(`Public Key: ${mintResult.pkp.publicKey}`);
  console.log(`ETH Address: ${mintResult.pkp.ethAddress}`);

  // Derive the ETH address for verification
  const derivedAddress = ethers.computeAddress(`0x${mintResult.pkp.publicKey}`);
  console.log(`Derived Address: ${derivedAddress}`);

  console.log("\n=== Add to .env ===");
  console.log(`LIT_PKP_PUBLIC_KEY=${mintResult.pkp.publicKey}`);
  console.log(`LIT_PKP_TOKEN_ID=${mintResult.pkp.tokenId}`);
  console.log(`LIT_PKP_ADDRESS=${mintResult.pkp.ethAddress}`);
  console.log(`LIT_NETWORK=${LIT_NETWORK}`);

  // Disconnect
  await litNodeClient.disconnect();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
