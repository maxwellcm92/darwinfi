import { Routes, Route } from "react-router-dom";
import { Navbar } from "./components/Navbar";
import { Home } from "./pages/Home";
import { Portfolio } from "./pages/Portfolio";
import { Tournament } from "./pages/Tournament";
import { Instinct } from "./pages/Instinct";

export function App() {
  return (
    <div className="min-h-screen scanline-overlay">
      <Navbar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/portfolio" element={<Portfolio />} />
          <Route path="/tournament" element={<Tournament />} />
          <Route path="/instinct" element={<Instinct />} />
        </Routes>
      </main>
    </div>
  );
}
