import { NavLink } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";

const navLinks = [
  { to: "/", label: "Home" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/tournament", label: "Tournament" },
];

export function Navbar() {
  return (
    <nav className="border-b border-darwin-border bg-darwin-card/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded bg-darwin-accent/20 border border-darwin-accent/40 flex items-center justify-center">
                <span className="font-arcade text-darwin-accent text-xs">D</span>
              </div>
              <span className="font-arcade text-darwin-accent text-sm tracking-wider text-glow-accent">
                DARWINFI
              </span>
            </div>
          </div>

          {/* Nav Links */}
          <div className="hidden sm:flex items-center gap-1">
            {navLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === "/"}
                className={({ isActive }) =>
                  `px-4 py-2 rounded text-sm font-mono transition-all duration-200 ${
                    isActive
                      ? "text-darwin-accent bg-darwin-accent/10 border border-darwin-accent/30"
                      : "text-darwin-text hover:text-darwin-text-bright hover:bg-darwin-card-hover"
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
                `flex-1 text-center px-2 py-2 rounded text-xs font-mono transition-all duration-200 ${
                  isActive
                    ? "text-darwin-accent bg-darwin-accent/10 border border-darwin-accent/30"
                    : "text-darwin-text hover:text-darwin-text-bright"
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
