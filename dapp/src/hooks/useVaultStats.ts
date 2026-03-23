import { useState, useEffect } from "react";
import { useReadContract, useAccount, usePublicClient } from "wagmi";
import { formatUnits, parseAbiItem } from "viem";
import { VAULT_ABI, USDC_ABI, VAULT_ADDRESS, USDC_ADDRESS } from "../lib/contracts";
import { USDC_DECIMALS, SHARE_DECIMALS, SHARE_PRICE_DECIMALS } from "../lib/constants";

const DEPOSIT_EVENT = parseAbiItem(
  "event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)"
);
const WITHDRAW_EVENT = parseAbiItem(
  "event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)"
);

export function useVaultStats() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const [userNetDeposited, setUserNetDeposited] = useState<string | null>(null);

  useEffect(() => {
    if (!address || !publicClient) return;

    async function fetchDepositHistory() {
      const depositLogs = await publicClient!.getLogs({
        address: VAULT_ADDRESS,
        event: DEPOSIT_EVENT,
        args: { owner: address },
        fromBlock: 0n,
      });
      const totalDeposited = depositLogs.reduce(
        (sum, log) => sum + (log.args.assets ?? 0n),
        0n
      );

      const withdrawLogs = await publicClient!.getLogs({
        address: VAULT_ADDRESS,
        event: WITHDRAW_EVENT,
        args: { owner: address },
        fromBlock: 0n,
      });
      const totalWithdrawn = withdrawLogs.reduce(
        (sum, log) => sum + (log.args.assets ?? 0n),
        0n
      );

      setUserNetDeposited(formatUnits(totalDeposited - totalWithdrawn, USDC_DECIMALS));
    }

    fetchDepositHistory().catch(() => {});
  }, [address, publicClient]);

  const { data: totalAssets } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "totalAssets",
    query: { refetchInterval: 10_000 },
  });

  const { data: totalSupply } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "totalSupply",
    query: { refetchInterval: 10_000 },
  });

  const { data: sharePriceRaw } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "sharePrice",
    query: { refetchInterval: 10_000 },
  });

  const { data: maxTotalAssets } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "maxTotalAssets",
    query: { refetchInterval: 30_000 },
  });

  const { data: totalBorrowed } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "totalBorrowed",
    query: { refetchInterval: 10_000 },
  });

  const { data: availableAssets } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "availableAssets",
    query: { refetchInterval: 10_000 },
  });

  const { data: paused } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "paused",
    query: { refetchInterval: 30_000 },
  });

  const { data: performanceFeeBps } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "performanceFeeBps",
    query: { refetchInterval: 60_000 },
  });

  const { data: managementFeeBps } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "managementFeeBps",
    query: { refetchInterval: 60_000 },
  });

  const { data: minLockTime } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "minLockTime",
    query: { refetchInterval: 60_000 },
  });

  // User-specific reads
  const { data: userShareBalance } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
      refetchInterval: 10_000,
    },
  });

  const { data: userUsdcBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
      refetchInterval: 10_000,
    },
  });

  const { data: userDepositTimestamp } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
    functionName: "depositTimestamp",
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
      refetchInterval: 30_000,
    },
  });

  // Format values
  const tvl = totalAssets != null ? formatUnits(totalAssets, USDC_DECIMALS) : null;
  const sharePrice = sharePriceRaw != null ? formatUnits(sharePriceRaw, SHARE_PRICE_DECIMALS) : null;
  const totalSharesFormatted = totalSupply != null ? formatUnits(totalSupply, SHARE_DECIMALS) : null;
  const maxCapacity = maxTotalAssets != null ? formatUnits(maxTotalAssets, USDC_DECIMALS) : null;
  const borrowed = totalBorrowed != null ? formatUnits(totalBorrowed, USDC_DECIMALS) : null;
  const available = availableAssets != null ? formatUnits(availableAssets, USDC_DECIMALS) : null;
  const userShares = userShareBalance != null ? formatUnits(userShareBalance, SHARE_DECIMALS) : null;
  const userUsdc = userUsdcBalance != null ? formatUnits(userUsdcBalance, USDC_DECIMALS) : null;
  const feeBps = performanceFeeBps != null ? Number(performanceFeeBps) : null;
  const mgmtFeeBps = managementFeeBps != null ? Number(managementFeeBps) : null;
  const lockSeconds = minLockTime != null ? Number(minLockTime) : null;

  // Compute user's share value in USDC
  // shares have 12 decimals, sharePrice has 6 decimals
  // (shares * sharePrice) / 10^12 gives raw USDC with 6 decimals
  const userShareValue =
    userShareBalance != null && sharePriceRaw != null
      ? formatUnits(
          (userShareBalance * sharePriceRaw) / BigInt(10 ** SHARE_DECIMALS),
          USDC_DECIMALS
        )
      : null;

  return {
    // Raw values (bigint)
    totalAssetsRaw: totalAssets ?? null,
    totalSupplyRaw: totalSupply ?? null,
    sharePriceRaw: sharePriceRaw ?? null,
    maxTotalAssetsRaw: maxTotalAssets ?? null,
    totalBorrowedRaw: totalBorrowed ?? null,
    availableAssetsRaw: availableAssets ?? null,
    userShareBalanceRaw: userShareBalance ?? null,
    userUsdcBalanceRaw: userUsdcBalance ?? null,
    userDepositTimestamp: userDepositTimestamp != null ? Number(userDepositTimestamp) : null,

    // Formatted strings
    tvl,
    sharePrice,
    totalShares: totalSharesFormatted,
    maxCapacity,
    borrowed,
    available,
    userShares,
    userUsdc,
    userShareValue,

    // Config
    paused: paused ?? false,
    feeBps,
    mgmtFeeBps,
    lockSeconds,

    // On-chain PnL
    userNetDeposited,
  };
}
