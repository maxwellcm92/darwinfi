import React from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RainbowKitProvider,
  darkTheme,
  type Theme,
} from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { config } from "./wagmi";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 10_000,
      staleTime: 5_000,
    },
  },
});

const darwinTheme: Theme = {
  ...darkTheme({
    accentColor: "#00F0C0",
    accentColorForeground: "#0B0B1A",
    borderRadius: "small",
    fontStack: "system",
  }),
  colors: {
    ...darkTheme().colors,
    accentColor: "#00F0C0",
    accentColorForeground: "#0B0B1A",
    modalBackground: "#10102A",
    modalBorder: "#1E1E4A",
    profileForeground: "#10102A",
    closeButton: "#C8C8E0",
    closeButtonBackground: "#1E1E4A",
    connectButtonBackground: "#10102A",
    connectButtonInnerBackground: "#0B0B1A",
    connectButtonText: "#00F0C0",
    generalBorder: "#1E1E4A",
    menuItemBackground: "#181840",
    modalText: "#C8C8E0",
    modalTextDim: "#6060A0",
    modalTextSecondary: "#C8C8E0",
    profileAction: "#0B0B1A",
    profileActionHover: "#181840",
    selectedOptionBorder: "#00F0C0",
    standby: "#FFB020",
    error: "#FF3050",
    downloadBottomCardBackground: "#10102A",
    downloadTopCardBackground: "#10102A",
    actionButtonBorder: "#1E1E4A",
    actionButtonBorderMobile: "#1E1E4A",
    actionButtonSecondaryBackground: "#0B0B1A",
    connectionIndicator: "#00F0C0",
    generalBorderDim: "#1E1E4A",
  },
  fonts: {
    body: '"JetBrains Mono", monospace',
  },
  shadows: {
    connectButton: "0 0 10px rgba(0, 240, 192, 0.15)",
    dialog: "0 0 30px rgba(0, 240, 192, 0.1)",
    profileDetailsAction: "0 0 10px rgba(0, 240, 192, 0.1)",
    selectedOption: "0 0 10px rgba(0, 240, 192, 0.2)",
    selectedWallet: "0 0 10px rgba(0, 240, 192, 0.15)",
    walletLogo: "0 0 10px rgba(0, 240, 192, 0.1)",
  },
};

interface ProvidersProps {
  children: React.ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={darwinTheme}>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
