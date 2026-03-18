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
  const performanceLog = await PerformanceLog.deploy(deployer.address);
  await performanceLog.waitForDeployment();
  const perfLogAddr = await performanceLog.getAddress();
  console.log(`[DarwinFi] PerformanceLog deployed at: ${perfLogAddr}`);

  // Deploy DarwinVault
  console.log("\n[DarwinFi] Deploying DarwinVault...");
  const DarwinVault = await ethers.getContractFactory("DarwinVault");
  const vault = await DarwinVault.deploy(deployer.address);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log(`[DarwinFi] DarwinVault deployed at: ${vaultAddr}`);

  // Deploy StrategyExecutor
  console.log(`\n[DarwinFi] Deploying StrategyExecutor...`);
  const StrategyExecutor = await ethers.getContractFactory("StrategyExecutor");
  const executor = await StrategyExecutor.deploy(deployer.address, vaultAddr, deployer.address);
  await executor.waitForDeployment();
  const executorAddr = await executor.getAddress();
  console.log(`[DarwinFi] StrategyExecutor deployed at: ${executorAddr}`);

  // Authorize executor on vault
  console.log("\n[DarwinFi] Authorizing StrategyExecutor on DarwinVault...");
  const authTx = await vault.setStrategyExecutor(executorAddr);
  await authTx.wait();
  console.log("[DarwinFi] Executor authorized.");

  // Authorize executor and deployer as loggers on PerformanceLog
  console.log("[DarwinFi] Setting up PerformanceLog loggers...");
  const logTx1 = await performanceLog.setLogger(executorAddr, true);
  await logTx1.wait();
  const logTx2 = await performanceLog.setLogger(deployer.address, true);
  await logTx2.wait();
  console.log("[DarwinFi] Loggers authorized.");

  // Summary
  console.log("\n========================================");
  console.log("[DarwinFi] Deployment Complete!");
  console.log("========================================");
  console.log(`Chain:            ${network.chainId}`);
  console.log(`Deployer:         ${deployer.address}`);
  console.log(`DarwinVault:      ${vaultAddr}`);
  console.log(`StrategyExecutor: ${executorAddr}`);
  console.log(`PerformanceLog:   ${perfLogAddr}`);
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
