import { base } from "wagmi/chains";

export const CHAIN = base;
export const CHAIN_ID = 8453;

export const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const USDC_DECIMALS = 6;

export const VAULT_ADDRESS = (import.meta.env.VITE_VAULT_ADDRESS ?? "0x0000000000000000000000000000000000000000") as `0x${string}`;

export const AGENT_ADDRESS = "0xb2db53Db9a2349186F0214BC3e1bF08a195570e3" as const;
export const BASENAME = "darwinfi.base.eth" as const;

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export const SHARE_PRICE_DECIMALS = 6; // sharePrice returns value with 1e6 = 1.000000

export const COLORS = {
  bg: "#0B0B1A",
  card: "#10102A",
  accent: "#00F0C0",
  danger: "#FF3050",
  purple: "#8040DD",
  text: "#C8C8E0",
  bright: "#FFFFFF",
} as const;
