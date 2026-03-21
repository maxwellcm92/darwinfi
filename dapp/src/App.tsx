import { Routes, Route, Navigate } from "react-router-dom";
import { Navbar } from "./components/Navbar";
import { Home } from "./pages/Home";
import { Portfolio } from "./pages/Portfolio";
import { Advanced } from "./pages/Advanced";
import { FAQ } from "./pages/FAQ";

export function App() {
  return (
    <div className="min-h-screen flex flex-col scanline-overlay">
      <Navbar />
      {/* Unaudited transparency banner */}
      <div className="bg-yellow-900/30 border-b border-yellow-600/30 py-1.5 px-4 text-center">
        <p className="text-xs font-mono text-yellow-400">
          UNAUDITED SOFTWARE -- This vault has not undergone a formal security audit. Use at your own risk.
        </p>
      </div>
      <main className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12 py-8 flex-1 w-full">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/advanced" element={<Advanced />} />
          <Route path="/faq" element={<FAQ />} />
          {/* Legacy redirects */}
          <Route path="/tournament" element={<Navigate to="/advanced?tab=tournament" replace />} />
          <Route path="/instinct" element={<Navigate to="/advanced?tab=instinct" replace />} />
          <Route path="/frontier" element={<Navigate to="/advanced?tab=frontier" replace />} />
        </Routes>
      </main>
      <footer className="border-t border-darwin-border/30 py-6 mt-auto">
        <p className="text-center text-xs font-mono text-darwin-text-dim">
          DarwinFi - Autonomous DeFi on Base L2
        </p>
      </footer>
    </div>
  );
}
