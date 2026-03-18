import { ethers } from "ethers";

// Basenames Registrar on Base
// L2 Resolver for Base
const BASENAMES_REGISTRAR = "0x4cCb0720c37aC24166f391eDBe1a717C4714a5Db";
const BASE_REGISTRAR_ABI = [
  "function register(tuple(string name, address owner, uint256 duration, address resolver, bytes[] data, bool reverseRecord) request) payable",
  "function available(string name) view returns (bool)",
  "function rentPrice(string name, uint256 duration) view returns (uint256)"
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
  const price = await registrar.rentPrice(name, duration);
  console.log(`[DarwinFi] Rent price: ${ethers.formatEther(price)} ETH`);

  const ownerAddr = await signer.getAddress();
  console.log(`[DarwinFi] Registering ${name}.base.eth for ${ownerAddr}...`);

  const tx = await registrar.register(
    {
      name: name,
      owner: ownerAddr,
      duration: duration,
      resolver: ethers.ZeroAddress, // use default resolver
      data: [],
      reverseRecord: true,
    },
    { value: price }
  );

  const receipt = await tx.wait();
  console.log(`[DarwinFi] Basename registered! TX: ${receipt.hash}`);
  return receipt.hash;
}
