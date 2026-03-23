import { Routes, Route, Navigate } from "react-router-dom";
import { Navbar } from "./components/Navbar";
import { Home } from "./pages/Home";
import { Advanced } from "./pages/Advanced";
import { FAQ } from "./pages/FAQ";
import { Results } from "./pages/Results";

export function App() {
  return (
    <div className="min-h-screen flex flex-col scanline-overlay overflow-x-hidden">
      <Navbar />
      <main className="flex-1 w-full">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/advanced" element={<Advanced />} />
          <Route path="/faq" element={<FAQ />} />
          <Route path="/results" element={<Results />} />
          {/* Legacy redirects */}
          <Route path="/tournament" element={<Navigate to="/advanced?tab=tournament" replace />} />
          <Route path="/instinct" element={<Navigate to="/advanced?tab=instinct" replace />} />
          <Route path="/frontier" element={<Navigate to="/advanced?tab=frontier" replace />} />
        </Routes>
      </main>
      {/* Subtle unaudited badge */}
      <div className="fixed bottom-4 right-4 z-40 px-3 py-1.5 rounded-full text-xs font-mono text-yellow-400/60 bg-darwin-bg/80 backdrop-blur-sm border border-yellow-600/20">
        UNAUDITED
      </div>
      <footer className="border-t border-darwin-border/30 py-6 mt-auto">
        <div className="flex items-center justify-center gap-2">
          <img src="/darwinfi/darwinfi-logo.png" alt="" className="h-6 w-auto rounded" />
          <p className="text-sm font-mono text-darwin-text-dim">
            DarwinFi - Autonomous DeFi on Base L2
          </p>
        </div>
      </footer>
    </div>
  );
}
