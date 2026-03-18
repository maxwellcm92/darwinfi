import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log(`[DarwinFi] Deploying contracts on chain ${network.chainId}...`);
  console.log(`[DarwinFi] Deployer: ${deployer.address}`);
  console.log(`[DarwinFi] Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

  // Deploy PerformanceLog first (no dependencies)
  console.log("\n[DarwinFi] Deploying PerformanceLog...");
  const PerformanceLog = await ethers.getContractFactory("PerformanceLog");
  const performanceLog = await PerformanceLog.deploy();
  await performanceLog.waitForDeployment();
  const perfLogAddr = await performanceLog.getAddress();
  console.log(`[DarwinFi] PerformanceLog deployed at: ${perfLogAddr}`);

  // Deploy DarwinVault
  console.log("\n[DarwinFi] Deploying DarwinVault...");
  const DarwinVault = await ethers.getContractFactory("DarwinVault");
  const vault = await DarwinVault.deploy();
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log(`[DarwinFi] DarwinVault deployed at: ${vaultAddr}`);

  // Deploy StrategyExecutor with references to vault and performance log
  // Uniswap V3 SwapRouter addresses by chain
  const SWAP_ROUTERS: Record<string, string> = {
    "8453": "0x2626664c2603336E57B271c5C0b26F421741e481",  // Base mainnet
    "84532": "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4", // Base Sepolia
    "42220": "0x5615CDAb10dc425a742d643d949a7F474C01abc4", // Celo
  };

  const chainId = network.chainId.toString();
  const swapRouter = SWAP_ROUTERS[chainId];
  if (!swapRouter) {
    throw new Error(`No SwapRouter address for chain ${chainId}`);
  }

  console.log(`\n[DarwinFi] Deploying StrategyExecutor (router: ${swapRouter})...`);
  const StrategyExecutor = await ethers.getContractFactory("StrategyExecutor");
  const executor = await StrategyExecutor.deploy(vaultAddr, swapRouter, perfLogAddr);
  await executor.waitForDeployment();
  const executorAddr = await executor.getAddress();
  console.log(`[DarwinFi] StrategyExecutor deployed at: ${executorAddr}`);

  // Authorize executor on vault
  console.log("\n[DarwinFi] Authorizing StrategyExecutor on DarwinVault...");
  const authTx = await vault.setExecutor(executorAddr);
  await authTx.wait();
  console.log("[DarwinFi] Executor authorized.");

  // Summary
  console.log("\n========================================");
  console.log("[DarwinFi] Deployment Complete!");
  console.log("========================================");
  console.log(`Chain:            ${chainId}`);
  console.log(`DarwinVault:      ${vaultAddr}`);
  console.log(`StrategyExecutor: ${executorAddr}`);
  console.log(`PerformanceLog:   ${perfLogAddr}`);
  console.log(`SwapRouter:       ${swapRouter}`);
  console.log("========================================");
  console.log("\nAdd these to your .env:");
  console.log(`DARWIN_VAULT_ADDRESS=${vaultAddr}`);
  console.log(`STRATEGY_EXECUTOR_ADDRESS=${executorAddr}`);
  console.log(`PERFORMANCE_LOG_ADDRESS=${perfLogAddr}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[DarwinFi] Deployment failed:", error);
    process.exit(1);
  });
