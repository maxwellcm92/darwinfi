import { useState, useEffect } from "react";
import { NavLink } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";

const navPillClass = ({ isActive }: { isActive: boolean }) =>
  `px-4 py-2 rounded-full text-sm font-mono transition-all duration-200 border ${
    isActive
      ? "text-darwin-accent bg-darwin-accent/10 border-darwin-accent/30 nav-pill-active"
      : "text-darwin-text border-transparent hover:text-darwin-text-bright hover:bg-darwin-card-hover"
  }`;

const mobileNavClass = ({ isActive }: { isActive: boolean }) =>
  `block w-full px-4 py-3 text-sm font-mono transition-all duration-200 border-b border-darwin-border/30 ${
    isActive
      ? "text-darwin-accent bg-darwin-accent/10"
      : "text-darwin-text hover:text-darwin-text-bright hover:bg-darwin-card-hover"
  }`;

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
          <div className="hidden md:flex items-center gap-1">
            <NavLink to="/" end className={navPillClass}>
              Dashboard
            </NavLink>
            <NavLink to="/results" className={navPillClass}>
              Results
            </NavLink>
            <NavLink to="/faq" className={navPillClass}>
              FAQ
            </NavLink>
            <NavLink to="/advanced" className={navPillClass}>
              Advanced
            </NavLink>
          </div>

          {/* Desktop Connect Button */}
          <div className="hidden md:flex items-center">
            <ConnectButton
              showBalance={false}
              chainStatus="icon"
              accountStatus="address"
            />
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
          <NavLink to="/advanced" className={mobileNavClass} onClick={() => setMobileOpen(false)}>
            Advanced
          </NavLink>
          <div className="px-4 py-3">
            <ConnectButton
              showBalance={false}
              chainStatus="icon"
              accountStatus="address"
            />
          </div>
        </div>
      )}
    </nav>
  );
}
