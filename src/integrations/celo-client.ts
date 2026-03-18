import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

// Celo is EVM-compatible, same contracts work
// Uniswap V3 on Celo uses different router address
const CELO_SWAP_ROUTER = "0x5615CDAb10dc425a742d643d949a7F474C01abc4";
const CELO_QUOTER_V2 = "0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8";

// Key Celo token addresses
export const CELO_TOKENS = {
  CELO: "0x471EcE3750Da237f93B8E339c536989b8978a438", // native CELO (wrapped)
  cUSD: "0x765DE816845861e75A25fCA122bb6898B8B1282a", // Celo Dollar
  USDC: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", // USDC on Celo
  WETH: "0x66803FB87aBd4aaC3cbB3fAd7C3aa01f6F3FB207", // Wrapped ETH on Celo
};

export class CeloClient {
  private provider: ethers.JsonRpcProvider;
  private signer: ethers.Wallet | null = null;

  constructor() {
    const rpcUrl = process.env.CELO_RPC_URL || "https://forno.celo.org";
    this.provider = new ethers.JsonRpcProvider(rpcUrl);

    if (process.env.PRIVATE_KEY) {
      this.signer = new ethers.Wallet(process.env.PRIVATE_KEY, this.provider);
    }
  }

  async getChainId(): Promise<bigint> {
    const network = await this.provider.getNetwork();
    return network.chainId;
  }

  async getBalance(address?: string): Promise<string> {
    const addr = address || (this.signer ? await this.signer.getAddress() : null);
    if (!addr) throw new Error("No address provided and no signer configured");
    const balance = await this.provider.getBalance(addr);
    return ethers.formatEther(balance);
  }

  getProvider(): ethers.JsonRpcProvider {
    return this.provider;
  }

  getSigner(): ethers.Wallet {
    if (!this.signer) throw new Error("No signer configured. Set PRIVATE_KEY in .env");
    return this.signer;
  }

  getSwapRouterAddress(): string {
    return CELO_SWAP_ROUTER;
  }

  getQuoterAddress(): string {
    return CELO_QUOTER_V2;
  }

  async verifyConnection(): Promise<boolean> {
    try {
      const chainId = await this.getChainId();
      if (chainId !== 42220n) {
        console.log(`[DarwinFi] Warning: Expected Celo chainId 42220, got ${chainId}`);
        return false;
      }
      const blockNum = await this.provider.getBlockNumber();
      console.log(`[DarwinFi] Celo connected. Chain: ${chainId}, Block: ${blockNum}`);
      return true;
    } catch (error) {
      console.log("[DarwinFi] Celo connection failed:", error);
      return false;
    }
  }
}
