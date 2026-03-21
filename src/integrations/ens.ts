import { ethers } from "ethers";

// Basenames UpgradeableRegistrarController (proxy) on Base mainnet
const BASENAMES_REGISTRAR = "0xa7d2607c6BD39Ae9521e514026CBB078405Ab322";
// L2 Resolver for Base
export const L2_RESOLVER = "0xC6d566A56A1aFf6508b41f6c90ff131615583BCD";

const BASE_REGISTRAR_ABI = [
  "function register(tuple(string name, address owner, uint256 duration, address resolver, bytes[] data, bool reverseRecord, uint256[] coinTypes, uint256 signatureExpiry, bytes signature) request) payable",
  "function available(string name) view returns (bool)",
  "function rentPrice(string name, uint256 duration) view returns (uint256 base, uint256 premium)",
  "function registerPrice(string name, uint256 duration) view returns (uint256)"
];

export async function checkBasenameAvailable(
  provider: ethers.Provider,
  name: string
): Promise<boolean> {
  const registrar = new ethers.Contract(BASENAMES_REGISTRAR, BASE_REGISTRAR_ABI, provider);
  try {
    return await registrar.available(name);
  } catch (error) {
    console.log(`[DarwinFi] ENS availability check failed for ${name}:`, error);
    return false;
  }
}

export async function getRegisterPrice(
  provider: ethers.Provider,
  name: string,
  durationSeconds: number
): Promise<bigint> {
  const registrar = new ethers.Contract(BASENAMES_REGISTRAR, BASE_REGISTRAR_ABI, provider);
  return await registrar.registerPrice(name, durationSeconds);
}

export async function registerBasename(
  signer: ethers.Signer,
  name: string,
  durationYears: number = 1
): Promise<string> {
  const registrar = new ethers.Contract(BASENAMES_REGISTRAR, BASE_REGISTRAR_ABI, signer);
  const duration = durationYears * 365 * 24 * 60 * 60; // seconds

  console.log(`[DarwinFi] Checking availability for ${name}.base.eth...`);
  const available = await registrar.available(name);
  if (!available) {
    throw new Error(`${name}.base.eth is not available`);
  }

  console.log(`[DarwinFi] Getting rent price...`);
  const price = await registrar.registerPrice(name, duration);
  const priceWithBuffer = (price * 110n) / 100n; // 10% buffer for price fluctuation
  console.log(`[DarwinFi] Price: ${ethers.formatEther(price)} ETH (with buffer: ${ethers.formatEther(priceWithBuffer)} ETH)`);

  const ownerAddr = await signer.getAddress();
  console.log(`[DarwinFi] Registering ${name}.base.eth for ${ownerAddr}...`);

  const tx = await registrar.register(
    {
      name: name,
      owner: ownerAddr,
      duration: duration,
      resolver: L2_RESOLVER,
      data: [],
      reverseRecord: true,
      coinTypes: [],
      signatureExpiry: 0n,
      signature: "0x",
    },
    { value: priceWithBuffer }
  );

  const receipt = await tx.wait();
  console.log(`[DarwinFi] Basename registered! TX: ${receipt.hash}`);
  return receipt.hash;
}
