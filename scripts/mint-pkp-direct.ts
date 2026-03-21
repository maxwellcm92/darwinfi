/**
 * mint-pkp-direct.ts - Mint a Lit Protocol PKP using raw ethers.js
 *
 * Bypasses the Lit SDK (which uses ethers v5 internally) by calling
 * the PKPNFT contract directly on Chronicle Yellowstone via HTTPS RPC.
 *
 * Usage: npx ts-node scripts/mint-pkp-direct.ts
 */

import * as dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config();

// Chronicle Yellowstone (Lit testnet) configuration
const YELLOWSTONE_RPC = "https://yellowstone-rpc.litprotocol.com";
const YELLOWSTONE_CHAIN_ID = 175188;

// PKP NFT contract on Yellowstone
const PKPNFT_ADDRESS = "0x6a0f439f064B7167A8Ea6B22AcC07ae5360ee0d1";

// Minimal ABI for minting
const PKPNFT_ABI = [
  "function mintNext(uint256 keyType, bytes[] calldata permittedAuthMethodTypes, bytes[] calldata permittedAuthMethodIds, bytes[] calldata permittedAuthMethodPubkeys, bytes[] calldata permittedAuthMethodScopes, bool addPkpEthAddressAsPermittedAddress, bool sendPkpToItself) external payable returns (uint256)",
  "function mintCost() external view returns (uint256)",
  "event PKPMinted(uint256 indexed tokenId, bytes pubkey)",
];

async function main() {
  console.log("=== DarwinFi PKP Minting (Direct) ===\n");

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY not set in .env");
  }

  // Connect to Yellowstone RPC
  const provider = new ethers.JsonRpcProvider(YELLOWSTONE_RPC, YELLOWSTONE_CHAIN_ID);
  const wallet = new ethers.Wallet(privateKey, provider);

  console.log(`Wallet: ${wallet.address}`);
  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance: ${ethers.formatEther(balance)} tstLPX`);

  if (balance === 0n) {
    console.log("\nYou need testnet LPX tokens to mint a PKP.");
    console.log("Get them from the Lit faucet: https://chronicle-yellowstone-faucet.getlit.dev/");
    process.exit(1);
  }

  // Get mint cost
  const pkpNft = new ethers.Contract(PKPNFT_ADDRESS, PKPNFT_ABI, wallet);
  const mintCost = await pkpNft.mintCost();
  console.log(`Mint cost: ${ethers.formatEther(mintCost)} tstLPX\n`);

  if (balance < mintCost) {
    console.log(`Insufficient balance. Need ${ethers.formatEther(mintCost)} tstLPX.`);
    console.log("Get tokens from: https://chronicle-yellowstone-faucet.getlit.dev/");
    process.exit(1);
  }

  // Mint PKP
  console.log("Minting PKP...");
  const tx = await pkpNft.mintNext(
    2,   // keyType: ECDSA
    [],  // no auth methods
    [],
    [],
    [],
    true,  // add PKP eth address as permitted
    false, // don't send to itself
    { value: mintCost }
  );

  console.log(`TX hash: ${tx.hash}`);
  const receipt = await tx.wait();

  // Parse PKPMinted event
  const mintedEvent = receipt.logs
    .map((log: any) => {
      try {
        return pkpNft.interface.parseLog({ topics: log.topics as string[], data: log.data });
      } catch {
        return null;
      }
    })
    .find((e: any) => e?.name === "PKPMinted");

  if (!mintedEvent) {
    console.error("PKPMinted event not found in receipt. TX:", tx.hash);
    process.exit(1);
  }

  const tokenId = mintedEvent.args.tokenId.toString();
  const publicKey = mintedEvent.args.pubkey;
  const ethAddress = ethers.computeAddress(publicKey);

  console.log("\n=== PKP Minted Successfully ===");
  console.log(`Token ID: ${tokenId}`);
  console.log(`Public Key: ${publicKey}`);
  console.log(`ETH Address: ${ethAddress}`);

  console.log("\n=== Add to .env ===");
  console.log(`LIT_PKP_PUBLIC_KEY=${publicKey}`);
  console.log(`LIT_PKP_TOKEN_ID=${tokenId}`);
  console.log(`LIT_PKP_ADDRESS=${ethAddress}`);
  console.log(`LIT_NETWORK=datil-test`);

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
