import { useState } from "react";
import { NavLink } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import wordmarkSrc from "../assets/darwinfi-wordmark.png";

export function Navbar() {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <nav className="border-b border-darwin-border/50 bg-darwin-card/60 backdrop-blur-xl sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <NavLink to="/" className="flex items-center">
            <img src={wordmarkSrc} alt="DarwinFi" className="h-7 w-auto" />
          </NavLink>

          {/* Nav Links */}
          <div className="flex items-center gap-1">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `px-4 py-2 rounded-full text-sm font-mono transition-all duration-200 border ${
                  isActive
                    ? "text-darwin-accent bg-darwin-accent/10 border-darwin-accent/30 nav-pill-active"
                    : "text-darwin-text border-transparent hover:text-darwin-text-bright hover:bg-darwin-card-hover"
                }`
              }
            >
              Dashboard
            </NavLink>

            {showAdvanced && (
              <NavLink
                to="/advanced"
                className={({ isActive }) =>
                  `px-4 py-2 rounded-full text-sm font-mono transition-all duration-200 border ${
                    isActive
                      ? "text-darwin-accent bg-darwin-accent/10 border-darwin-accent/30 nav-pill-active"
                      : "text-darwin-text border-transparent hover:text-darwin-text-bright hover:bg-darwin-card-hover"
                  }`
                }
              >
                Explorer
              </NavLink>
            )}

            {/* Gear toggle for advanced tabs */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-mono transition-all duration-200 border ${
                showAdvanced
                  ? "text-darwin-accent border-darwin-accent/30 bg-darwin-accent/10"
                  : "text-darwin-text-dim border-transparent hover:text-darwin-text hover:bg-darwin-card-hover"
              }`}
              title={showAdvanced ? "Hide advanced tabs" : "Show advanced explorer"}
            >
              *
            </button>
          </div>

          {/* Connect Button */}
          <div className="flex items-center">
            <ConnectButton
              showBalance={false}
              chainStatus="icon"
              accountStatus="address"
            />
          </div>
        </div>
      </div>
    </nav>
  );
}
