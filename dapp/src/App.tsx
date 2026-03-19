import { Routes, Route } from "react-router-dom";
import { Navbar } from "./components/Navbar";
import { Home } from "./pages/Home";
import { Portfolio } from "./pages/Portfolio";
import { Tournament } from "./pages/Tournament";
import { Instinct } from "./pages/Instinct";
import { Frontier } from "./pages/Frontier";

export function App() {
  return (
    <div className="min-h-screen flex flex-col scanline-overlay">
      <Navbar />
      <main className="max-w-7xl mx-auto px-6 sm:px-8 lg:px-12 py-8 flex-1 w-full">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/tournament" element={<Tournament />} />
          <Route path="/instinct" element={<Instinct />} />
          <Route path="/frontier" element={<Frontier />} />
        </Routes>
      </main>
      <footer className="border-t border-darwin-border/30 py-6 mt-auto">
        <p className="text-center text-xs font-mono text-darwin-text-dim">
          DarwinFi -- Autonomous DeFi on Base L2
        </p>
      </footer>
    </div>
  );
}
