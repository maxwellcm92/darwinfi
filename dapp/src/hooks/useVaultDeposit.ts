import { useState, useCallback } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { parseUnits } from "viem";
import { VAULT_ABI, USDC_ABI, VAULT_ADDRESS, USDC_ADDRESS } from "../lib/contracts";
import { USDC_DECIMALS } from "../lib/constants";

type DepositStep = "idle" | "approving" | "approved" | "depositing" | "success" | "error";

export function useVaultDeposit() {
  const { address } = useAccount();
  const [step, setStep] = useState<DepositStep>("idle");
  const [error, setError] = useState<string | null>(null);

  // Read current allowance
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: "allowance",
    args: address ? [address, VAULT_ADDRESS] : undefined,
    query: { enabled: !!address },
  });

  // Approve tx
  const {
    writeContract: writeApprove,
    data: approveTxHash,
    isPending: isApproving,
    reset: resetApprove,
  } = useWriteContract();

  const { isLoading: isApproveConfirming, isSuccess: isApproveConfirmed } =
    useWaitForTransactionReceipt({
      hash: approveTxHash,
      query: {
        enabled: !!approveTxHash,
      },
    });

  // Deposit tx
  const {
    writeContract: writeDeposit,
    data: depositTxHash,
    isPending: isDepositing,
    reset: resetDeposit,
  } = useWriteContract();

  const { isLoading: isDepositConfirming, isSuccess: isDepositConfirmed } =
    useWaitForTransactionReceipt({
      hash: depositTxHash,
      query: {
        enabled: !!depositTxHash,
      },
    });

  const needsApproval = useCallback(
    (amount: string): boolean => {
      if (!allowance || !amount) return true;
      try {
        const amountWei = parseUnits(amount, USDC_DECIMALS);
        return allowance < amountWei;
      } catch {
        return true;
      }
    },
    [allowance]
  );

  const approve = useCallback(
    async (amount: string) => {
      if (!address) return;
      setError(null);
      setStep("approving");
      try {
        const amountWei = parseUnits(amount, USDC_DECIMALS);
        writeApprove(
          {
            address: USDC_ADDRESS,
            abi: USDC_ABI,
            functionName: "approve",
            args: [VAULT_ADDRESS, amountWei],
          },
          {
            onSuccess: () => {
              setStep("approved");
            },
            onError: (err) => {
              setError(err.message);
              setStep("error");
            },
          }
        );
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Approve failed");
        setStep("error");
      }
    },
    [address, writeApprove]
  );

  const deposit = useCallback(
    async (amount: string) => {
      if (!address) return;
      setError(null);
      setStep("depositing");
      try {
        const amountWei = parseUnits(amount, USDC_DECIMALS);
        writeDeposit(
          {
            address: VAULT_ADDRESS,
            abi: VAULT_ABI,
            functionName: "deposit",
            args: [amountWei, address],
          },
          {
            onSuccess: () => {
              setStep("success");
            },
            onError: (err) => {
              setError(err.message);
              setStep("error");
            },
          }
        );
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Deposit failed");
        setStep("error");
      }
    },
    [address, writeDeposit]
  );

  const reset = useCallback(() => {
    setStep("idle");
    setError(null);
    resetApprove();
    resetDeposit();
    refetchAllowance();
  }, [resetApprove, resetDeposit, refetchAllowance]);

  return {
    step,
    error,
    needsApproval,
    approve,
    deposit,
    reset,
    isApproving: isApproving || isApproveConfirming,
    isApproveConfirmed,
    isDepositing: isDepositing || isDepositConfirming,
    isDepositConfirmed,
    approveTxHash,
    depositTxHash,
  };
}
