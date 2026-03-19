import { NavLink } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import wordmarkSrc from "../assets/darwinfi-wordmark.png";

const navLinks = [
  { to: "/", label: "Home" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/tournament", label: "Tournament" },
  { to: "/instinct", label: "Instinct" },
  { to: "/frontier", label: "Frontier" },
];

export function Navbar() {
  return (
    <nav className="border-b border-darwin-border/50 bg-darwin-card/60 backdrop-blur-xl sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <NavLink to="/" className="flex items-center">
            <img src={wordmarkSrc} alt="DarwinFi" className="h-7 w-auto" />
          </NavLink>

          {/* Nav Links */}
          <div className="hidden sm:flex items-center gap-1">
            {navLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === "/"}
                className={({ isActive }) =>
                  `px-4 py-2 rounded-full text-sm font-mono transition-all duration-200 border ${
                    isActive
                      ? "text-darwin-accent bg-darwin-accent/10 border-darwin-accent/30 nav-pill-active"
                      : "text-darwin-text border-transparent hover:text-darwin-text-bright hover:bg-darwin-card-hover"
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
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

        {/* Mobile nav */}
        <div className="sm:hidden flex items-center gap-1 pb-3">
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.to === "/"}
              className={({ isActive }) =>
                `flex-1 text-center px-2 py-2 rounded-full text-xs font-mono transition-all duration-200 border ${
                  isActive
                    ? "text-darwin-accent bg-darwin-accent/10 border-darwin-accent/30 nav-pill-active"
                    : "text-darwin-text border-transparent hover:text-darwin-text-bright"
                }`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  );
}
