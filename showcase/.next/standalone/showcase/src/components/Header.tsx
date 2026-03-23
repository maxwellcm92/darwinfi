"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { NAV_LINKS } from "@/lib/constants";

export function Header() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-darwin-bg/80 backdrop-blur-md border-b border-darwin-border/50"
          : "bg-transparent"
      }`}
    >
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between py-2">
        <Link href="/" className="flex items-center gap-2 group">
          <img src="/darwinfi-logo.png" alt="" className="w-auto h-8 rounded-lg transition-transform duration-200 group-hover:scale-105" />
          <span className="font-bold text-darwin-accent tracking-tight">
            DarwinFi
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-2">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                pathname === link.href
                  ? "text-darwin-accent bg-darwin-accent/10 glow-accent"
                  : "text-darwin-text-dim hover:text-darwin-text-bright hover:bg-darwin-card/50"
              }`}
            >
              {link.label}
            </Link>
          ))}
          <a
            href="https://corduroycloud.com/darwinfi/"
            target="_blank"
            rel="noopener noreferrer"
            className="ml-3 px-5 py-2 rounded-full text-sm font-semibold bg-gradient-to-r from-darwin-accent to-darwin-accent-dim text-darwin-bg hover:opacity-90 transition-opacity"
          >
            Launch DApp
          </a>
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="md:hidden p-2 text-darwin-text-dim hover:text-darwin-text-bright"
          aria-label="Toggle menu"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {menuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </nav>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden bg-darwin-bg/95 backdrop-blur-md border-t border-darwin-border/50 px-4 pb-4">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className={`block py-3 text-sm font-medium ${
                pathname === link.href ? "text-darwin-accent" : "text-darwin-text-dim"
              }`}
            >
              {link.label}
            </Link>
          ))}
          <a
            href="https://corduroycloud.com/darwinfi/"
            target="_blank"
            rel="noopener noreferrer"
            className="block mt-2 text-center px-5 py-2 rounded-full text-sm font-semibold bg-gradient-to-r from-darwin-accent to-darwin-accent-dim text-darwin-bg"
          >
            Launch DApp
          </a>
        </div>
      )}
    </header>
  );
}
