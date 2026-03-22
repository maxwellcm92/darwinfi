import Link from "next/link";
import { VAULT_ADDRESS } from "@/lib/constants";

export function Footer() {
  return (
    <footer className="border-t border-darwin-border/30 bg-darwin-bg/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center gap-2 mb-3">
              <img src="/darwinfi-logo.png" alt="" className="w-auto h-8 rounded-lg" />
              <span className="font-bold text-darwin-accent tracking-tight">
                DarwinFi
              </span>
            </div>
            <p className="text-darwin-text-dim text-base max-w-md">
              Autonomous, self-evolving DeFi vault. AI strategies compete via
              Darwinian selection on Base L2. Built for the Synthesis Hackathon.
            </p>
          </div>

          <div>
            <h4 className="section-header text-darwin-text-dim mb-3">
              Navigate
            </h4>
            <div className="flex flex-col gap-2">
              <Link href="/results" className="text-base text-darwin-text hover:text-darwin-accent transition-colors">
                Live Results
              </Link>
              <Link href="/story" className="text-base text-darwin-text hover:text-darwin-accent transition-colors">
                Build Story
              </Link>
              <Link href="/product" className="text-base text-darwin-text hover:text-darwin-accent transition-colors">
                Product
              </Link>
            </div>
          </div>

          <div>
            <h4 className="section-header text-darwin-text-dim mb-3">
              On-Chain
            </h4>
            <div className="flex flex-col gap-2">
              <a
                href={`https://basescan.org/address/${VAULT_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-base text-darwin-text hover:text-darwin-accent transition-colors"
              >
                Vault Contract
              </a>
              <a
                href="https://corduroycloud.com/darwinfi/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-base text-darwin-text hover:text-darwin-accent transition-colors"
              >
                Launch DApp
              </a>
              <a
                href="https://github.com/maxwellcm92/darwinfi"
                target="_blank"
                rel="noopener noreferrer"
                className="text-base text-darwin-text hover:text-darwin-accent transition-colors"
              >
                GitHub
              </a>
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-darwin-border/20 flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-darwin-text-dim text-sm">
            Built by Maxwell Morgan for the Synthesis Hackathon 2026. Agent
            harness: Claude Code.
          </p>
          <p className="text-darwin-text-dim text-sm font-mono">
            darwinfi.base.eth
          </p>
        </div>
      </div>
    </footer>
  );
}
