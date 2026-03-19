import { useReadContract, useAccount } from "wagmi";
import { formatUnits } from "viem";
import { VAULT_ABI, USDC_ABI, VAULT_ADDRESS, USDC_ADDRESS } from "../lib/contracts";
import { USDC_DECIMALS, SHARE_PRICE_DECIMALS } from "../lib/constants";

export function useVaultStats() {
  const { address } = useAccount();

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
  const totalSharesFormatted = totalSupply != null ? formatUnits(totalSupply, USDC_DECIMALS) : null;
  const maxCapacity = maxTotalAssets != null ? formatUnits(maxTotalAssets, USDC_DECIMALS) : null;
  const borrowed = totalBorrowed != null ? formatUnits(totalBorrowed, USDC_DECIMALS) : null;
  const available = availableAssets != null ? formatUnits(availableAssets, USDC_DECIMALS) : null;
  const userShares = userShareBalance != null ? formatUnits(userShareBalance, USDC_DECIMALS) : null;
  const userUsdc = userUsdcBalance != null ? formatUnits(userUsdcBalance, USDC_DECIMALS) : null;
  const feeBps = performanceFeeBps != null ? Number(performanceFeeBps) : null;
  const lockSeconds = minLockTime != null ? Number(minLockTime) : null;

  // Compute user's share value in USDC
  const userShareValue =
    userShareBalance != null && sharePriceRaw != null
      ? formatUnits(
          (userShareBalance * sharePriceRaw) / BigInt(10 ** SHARE_PRICE_DECIMALS),
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
    lockSeconds,
  };
}
