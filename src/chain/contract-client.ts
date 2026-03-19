/**
 * contract-client.ts - Smart contract interaction layer
 *
 * Creates typed ethers.js v6 Contract instances for the DarwinFi
 * deployed contracts: DarwinVault, StrategyExecutor, PerformanceLog.
 * Loads ABIs from the Hardhat artifacts directory at runtime.
 */

import { Contract, InterfaceAbi } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import { BaseClient, getBaseClient } from './base-client';

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

export interface ContractAddresses {
  darwinVault?: string;
  strategyExecutor?: string;
  performanceLog?: string;
}

export interface StrategyRecord {
  id: string;
  name: string;
  allocation: bigint;
  isActive: boolean;
  totalTrades: bigint;
  totalPnl: bigint;
}

export interface PerformanceEntry {
  tradeCount: bigint;
  winCount: bigint;
  cumulativePnL: bigint;
  winRate: bigint;
  active: boolean;
}

// -------------------------------------------------------------------
// ABI loader
// -------------------------------------------------------------------

const ARTIFACTS_DIR = path.resolve(__dirname, '../../artifacts/contracts');

/**
 * Load ABI from Hardhat artifacts. Falls back to a minimal ABI
 * if artifacts have not been compiled yet.
 */
function loadAbi(contractName: string): InterfaceAbi {
  const artifactPath = path.join(
    ARTIFACTS_DIR,
    `${contractName}.sol`,
    `${contractName}.json`
  );

  if (fs.existsSync(artifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
    return artifact.abi;
  }

  // Return a stub ABI so the client can be instantiated before compilation.
  // Real contract calls will fail but type wrappers remain usable.
  console.warn(
    `[ContractClient] Artifact not found for ${contractName} at ${artifactPath}. ` +
    `Using stub ABI. Run 'hardhat compile' to generate artifacts.`
  );
  return [];
}

// -------------------------------------------------------------------
// Minimal fallback ABIs (used if artifacts are not built yet)
// -------------------------------------------------------------------

const DARWIN_VAULT_ABI: InterfaceAbi = [
  'function deposit(address token, uint256 amount) external',
  'function withdraw(address token, uint256 amount, address to) external',
  'function allocate(bytes32 strategyId, uint256 amount) external',
  'function getBalance(address token) external view returns (uint256)',
  'function getStrategyAllocation(bytes32 strategyId) external view returns (uint256)',
  'function owner() external view returns (address)',
  'event Deposited(address indexed token, uint256 amount)',
  'event Withdrawn(address indexed token, uint256 amount, address indexed to)',
  'event Allocated(bytes32 indexed strategyId, uint256 amount)',
];

const STRATEGY_EXECUTOR_ABI: InterfaceAbi = [
  'function executeSwap(bytes32 strategyId, address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, uint24 fee) external returns (uint256 amountOut)',
  'function registerStrategy(bytes32 id, string name) external',
  'function deactivateStrategy(bytes32 id) external',
  'function getStrategy(bytes32 id) external view returns (tuple(bytes32 id, string name, uint256 allocation, bool isActive, uint256 totalTrades, int256 totalPnl))',
  'function getActiveStrategies() external view returns (bytes32[])',
  'function setSellOnly(bytes32 strategyId, bool sellOnly) external',
  'event SwapExecuted(bytes32 indexed strategyId, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)',
  'event StrategyRegistered(bytes32 indexed id, string name)',
];

const PERFORMANCE_LOG_ABI: InterfaceAbi = [
  'function logTradeResult(uint256 strategyId, int256 pnl, bool win) external',
  'function logPromotion(uint256 strategyId, string reason) external',
  'function logDemotion(uint256 strategyId, string reason) external',
  'function advanceGeneration() external',
  'function recordGenomeHash(uint256 strategyId, bytes32 genomeHash, string ipfsCid) external',
  'function getStrategyStats(uint256 strategyId) external view returns (uint256 tradeCount, uint256 winCount, int256 cumulativePnL, uint256 winRate, bool active)',
  'function currentGeneration() external view returns (uint256)',
  'function setLogger(address logger, bool authorized) external',
  'event TradeResultLogged(uint256 indexed strategyId, int256 pnl, bool win, uint256 indexed generation, uint256 timestamp)',
  'event StrategyPromoted(uint256 indexed strategyId, uint256 indexed generation, string reason, uint256 timestamp)',
  'event StrategyDemoted(uint256 indexed strategyId, uint256 indexed generation, string reason, uint256 timestamp)',
  'event GenerationAdvanced(uint256 indexed oldGeneration, uint256 indexed newGeneration, uint256 timestamp)',
  'event GenomeHashRecorded(uint256 indexed strategyId, bytes32 indexed genomeHash, string ipfsCid, uint256 indexed generation, uint256 timestamp)',
];

// -------------------------------------------------------------------
// ContractClient
// -------------------------------------------------------------------

export class ContractClient {
  private baseClient: BaseClient;
  private addresses: ContractAddresses;

  private _darwinVault: Contract | null = null;
  private _strategyExecutor: Contract | null = null;
  private _performanceLog: Contract | null = null;

  constructor(baseClient?: BaseClient, addresses?: ContractAddresses) {
    this.baseClient = baseClient ?? getBaseClient();
    this.addresses = {
      darwinVault: addresses?.darwinVault ?? process.env.DARWIN_VAULT_ADDRESS,
      strategyExecutor: addresses?.strategyExecutor ?? process.env.STRATEGY_EXECUTOR_ADDRESS,
      performanceLog: addresses?.performanceLog ?? process.env.PERFORMANCE_LOG_ADDRESS,
    };
  }

  // ---------------------------------------------------------------
  // Contract accessors (lazy initialization)
  // ---------------------------------------------------------------

  get darwinVault(): Contract {
    if (!this._darwinVault) {
      const address = this.requireAddress('darwinVault');
      const abi = this.resolveAbi('DarwinVault', DARWIN_VAULT_ABI);
      this._darwinVault = new Contract(address, abi, this.baseClient.signer);
    }
    return this._darwinVault;
  }

  get strategyExecutor(): Contract {
    if (!this._strategyExecutor) {
      const address = this.requireAddress('strategyExecutor');
      const abi = this.resolveAbi('StrategyExecutor', STRATEGY_EXECUTOR_ABI);
      this._strategyExecutor = new Contract(address, abi, this.baseClient.signer);
    }
    return this._strategyExecutor;
  }

  get performanceLog(): Contract {
    if (!this._performanceLog) {
      const address = this.requireAddress('performanceLog');
      const abi = this.resolveAbi('PerformanceLog', PERFORMANCE_LOG_ABI);
      this._performanceLog = new Contract(address, abi, this.baseClient.signer);
    }
    return this._performanceLog;
  }

  // ---------------------------------------------------------------
  // Type-safe wrappers: DarwinVault
  // ---------------------------------------------------------------

  async vaultDeposit(token: string, amount: bigint): Promise<string> {
    const tx = await this.darwinVault.deposit(token, amount);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async vaultWithdraw(token: string, amount: bigint, to: string): Promise<string> {
    const tx = await this.darwinVault.withdraw(token, amount, to);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async vaultAllocate(strategyId: string, amount: bigint): Promise<string> {
    const tx = await this.darwinVault.allocate(strategyId, amount);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async vaultGetBalance(token: string): Promise<bigint> {
    return this.darwinVault.getBalance(token);
  }

  async vaultGetStrategyAllocation(strategyId: string): Promise<bigint> {
    return this.darwinVault.getStrategyAllocation(strategyId);
  }

  // ---------------------------------------------------------------
  // Type-safe wrappers: StrategyExecutor
  // ---------------------------------------------------------------

  async executeSwap(
    strategyId: string,
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    minAmountOut: bigint,
    fee: number = 3000
  ): Promise<{ txHash: string; amountOut: bigint }> {
    const tx = await this.strategyExecutor.executeSwap(
      strategyId, tokenIn, tokenOut, amountIn, minAmountOut, fee
    );
    const receipt = await tx.wait();

    // Parse the SwapExecuted event to get amountOut
    const event = receipt.logs
      .map((log: any) => {
        try {
          return this.strategyExecutor.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((e: any) => e?.name === 'SwapExecuted');

    const amountOut = event?.args?.amountOut ?? 0n;
    return { txHash: receipt.hash, amountOut };
  }

  async registerStrategy(id: string, name: string): Promise<string> {
    const tx = await this.strategyExecutor.registerStrategy(id, name);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async getStrategy(id: string): Promise<StrategyRecord> {
    const raw = await this.strategyExecutor.getStrategy(id);
    return {
      id: raw.id,
      name: raw.name,
      allocation: raw.allocation,
      isActive: raw.isActive,
      totalTrades: raw.totalTrades,
      totalPnl: raw.totalPnl,
    };
  }

  async getActiveStrategies(): Promise<string[]> {
    return this.strategyExecutor.getActiveStrategies();
  }

  async setSellOnly(strategyId: string, sellOnly: boolean): Promise<string> {
    const tx = await this.strategyExecutor.setSellOnly(strategyId, sellOnly);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  // ---------------------------------------------------------------
  // Type-safe wrappers: PerformanceLog
  // ---------------------------------------------------------------

  async logTradeResult(
    strategyId: bigint,
    pnl: bigint,
    win: boolean,
  ): Promise<string> {
    const tx = await this.performanceLog.logTradeResult(strategyId, pnl, win);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async logPromotion(strategyId: bigint, reason: string): Promise<string> {
    const tx = await this.performanceLog.logPromotion(strategyId, reason);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async logDemotion(strategyId: bigint, reason: string): Promise<string> {
    const tx = await this.performanceLog.logDemotion(strategyId, reason);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async advanceGeneration(): Promise<string> {
    const tx = await this.performanceLog.advanceGeneration();
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async recordGenomeHash(
    strategyId: bigint,
    genomeHash: string,
    ipfsCid: string,
  ): Promise<string> {
    const tx = await this.performanceLog.recordGenomeHash(strategyId, genomeHash, ipfsCid);
    const receipt = await tx.wait();
    return receipt.hash;
  }

  async getStrategyStats(strategyId: bigint): Promise<PerformanceEntry> {
    const raw = await this.performanceLog.getStrategyStats(strategyId);
    return {
      tradeCount: raw[0],
      winCount: raw[1],
      cumulativePnL: raw[2],
      winRate: raw[3],
      active: raw[4],
    };
  }

  // ---------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------

  private requireAddress(name: keyof ContractAddresses): string {
    const address = this.addresses[name];
    if (!address) {
      throw new Error(
        `Contract address for '${name}' is not set. ` +
        `Deploy contracts and set ${name.toUpperCase().replace(/([A-Z])/g, '_$1')}_ADDRESS in .env.`
      );
    }
    return address;
  }

  private resolveAbi(contractName: string, fallback: InterfaceAbi): InterfaceAbi {
    const fromArtifacts = loadAbi(contractName);
    if (Array.isArray(fromArtifacts) && fromArtifacts.length > 0) {
      return fromArtifacts;
    }
    return fallback;
  }
}
