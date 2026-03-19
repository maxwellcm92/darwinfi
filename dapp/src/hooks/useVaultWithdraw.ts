import { useState, useCallback } from "react";
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { parseUnits } from "viem";
import { VAULT_ABI, VAULT_ADDRESS } from "../lib/contracts";
import { USDC_DECIMALS } from "../lib/constants";

type WithdrawStep = "idle" | "redeeming" | "success" | "error";

export function useVaultWithdraw() {
  const { address } = useAccount();
  const [step, setStep] = useState<WithdrawStep>("idle");
  const [error, setError] = useState<string | null>(null);

  const {
    writeContract: writeRedeem,
    data: redeemTxHash,
    isPending: isRedeeming,
    reset: resetRedeem,
  } = useWriteContract();

  const { isLoading: isRedeemConfirming, isSuccess: isRedeemConfirmed } =
    useWaitForTransactionReceipt({
      hash: redeemTxHash,
      query: {
        enabled: !!redeemTxHash,
      },
    });

  const redeem = useCallback(
    async (sharesAmount: string) => {
      if (!address) return;
      setError(null);
      setStep("redeeming");
      try {
        const sharesWei = parseUnits(sharesAmount, USDC_DECIMALS);
        writeRedeem(
          {
            address: VAULT_ADDRESS,
            abi: VAULT_ABI,
            functionName: "redeem",
            args: [sharesWei, address, address],
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
        setError(err instanceof Error ? err.message : "Withdraw failed");
        setStep("error");
      }
    },
    [address, writeRedeem]
  );

  const reset = useCallback(() => {
    setStep("idle");
    setError(null);
    resetRedeem();
  }, [resetRedeem]);

  return {
    step,
    error,
    redeem,
    reset,
    isRedeeming: isRedeeming || isRedeemConfirming,
    isRedeemConfirmed,
    redeemTxHash,
  };
}
