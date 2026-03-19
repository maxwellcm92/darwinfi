import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { ChatProvider } from "@/components/chat/ChatProvider";

export const metadata: Metadata = {
  title: "DarwinFi -- Autonomous Self-Evolving DeFi Vault",
  description:
    "12 strategies compete. AI mutates the winners. Natural selection picks your yield. Built on Base L2 with ERC-4626, Lit Protocol guardrails, and multi-AI evolution.",
  openGraph: {
    title: "DarwinFi -- Your Capital. Evolving.",
    description:
      "Autonomous DeFi vault where trading strategies evolve through Darwinian competition on Base L2.",
    type: "website",
    url: "https://darwinfi.corduroycloud.com",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="scanline-overlay">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Playfair+Display:wght@700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans">
        <ChatProvider>
          <Header />
          <main className="min-h-screen">{children}</main>
          <Footer />
          <ChatBubble />
        </ChatProvider>
      </body>
    </html>
  );
}
