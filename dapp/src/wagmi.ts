import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { base } from "wagmi/chains";

export const config = getDefaultConfig({
  appName: "DarwinFi",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "PLACEHOLDER_PROJECT_ID",
  chains: [base],
  ssr: false,
});
