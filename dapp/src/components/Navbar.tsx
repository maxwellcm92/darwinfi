import { useState, useEffect } from "react";
import { NavLink } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";

const navPillClass = ({ isActive }: { isActive: boolean }) =>
  `px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
    isActive
      ? "text-darwin-accent bg-darwin-accent/10 glow-accent"
      : "text-darwin-text-dim hover:text-darwin-text-bright hover:bg-darwin-card/50"
  }`;

const mobileNavClass = ({ isActive }: { isActive: boolean }) =>
  `block w-full px-4 py-3 text-sm font-medium transition-all duration-200 border-b border-darwin-border/30 ${
    isActive
      ? "text-darwin-accent bg-darwin-accent/10"
      : "text-darwin-text-dim hover:text-darwin-text-bright hover:bg-darwin-card/50"
  }`;

function GradientWalletButton() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        if (!mounted) {
          return null;
        }

        const connected = account && chain;

        if (!connected) {
          return (
            <button
              onClick={openConnectModal}
              type="button"
              className="px-5 py-2 rounded-full text-sm font-semibold bg-gradient-to-r from-darwin-accent to-darwin-accent-dim text-darwin-bg hover:opacity-90 transition-opacity"
            >
              Connect Wallet
            </button>
          );
        }

        if (chain.unsupported) {
          return (
            <button
              onClick={openChainModal}
              type="button"
              className="px-5 py-2 rounded-full text-sm font-semibold bg-darwin-danger text-white hover:opacity-90 transition-opacity"
            >
              Wrong Network
            </button>
          );
        }

        return (
          <button
            onClick={openAccountModal}
            type="button"
            className="px-5 py-2 rounded-full text-sm font-semibold bg-gradient-to-r from-darwin-accent to-darwin-accent-dim text-darwin-bg hover:opacity-90 transition-opacity"
          >
            {account.displayName}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-darwin-bg/80 backdrop-blur-md border-b border-darwin-border/50"
          : "bg-transparent border-b border-transparent"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <NavLink to="/" className="flex items-center gap-2.5 group">
            <img src="/darwinfi/darwinfi-logo.png" alt="DarwinFi" className="h-9 w-auto rounded-lg transition-transform duration-200 group-hover:scale-105" />
            <span className="text-lg font-bold tracking-tight text-darwin-accent">
              DarwinFi
            </span>
          </NavLink>

          {/* Desktop Nav Links */}
          <div className="hidden md:flex items-center gap-2">
            <NavLink to="/" end className={navPillClass}>
              Dashboard
            </NavLink>
            <NavLink to="/results" className={navPillClass}>
              Results
            </NavLink>
            <NavLink to="/faq" className={navPillClass}>
              FAQ
            </NavLink>
          </div>

          {/* Desktop Connect Button */}
          <div className="hidden md:flex items-center">
            <GradientWalletButton />
          </div>

          {/* Mobile hamburger button */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="md:hidden flex flex-col justify-center items-center w-10 h-10 gap-1.5"
            aria-label="Toggle menu"
          >
            <div
              className={`w-6 h-0.5 bg-darwin-text-bright transition-all duration-200 ${
                mobileOpen ? "rotate-45 translate-y-2" : ""
              }`}
            />
            <div
              className={`w-6 h-0.5 bg-darwin-text-bright transition-all duration-200 ${
                mobileOpen ? "opacity-0" : ""
              }`}
            />
            <div
              className={`w-6 h-0.5 bg-darwin-text-bright transition-all duration-200 ${
                mobileOpen ? "-rotate-45 -translate-y-2" : ""
              }`}
            />
          </button>
        </div>
      </div>

      {/* Mobile dropdown menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-darwin-border/50 bg-darwin-card/90 backdrop-blur-xl">
          <NavLink to="/" end className={mobileNavClass} onClick={() => setMobileOpen(false)}>
            Dashboard
          </NavLink>
          <NavLink to="/results" className={mobileNavClass} onClick={() => setMobileOpen(false)}>
            Results
          </NavLink>
          <NavLink to="/faq" className={mobileNavClass} onClick={() => setMobileOpen(false)}>
            FAQ
          </NavLink>
          <div className="px-4 py-3">
            <GradientWalletButton />
          </div>
        </div>
      )}
    </nav>
  );
}
