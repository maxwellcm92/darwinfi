import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Tournament } from "./Tournament";
import { Instinct } from "./Instinct";
import { Frontier } from "./Frontier";
import { EvolutionPanel } from "../components/EvolutionPanel";
import { EvolutionAudit } from "../components/EvolutionAudit";

const TABS = [
  { key: "tournament", label: "Tournament" },
  { key: "instinct", label: "Instinct" },
  { key: "frontier", label: "Frontier" },
  { key: "evolution", label: "Evolution" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function Advanced() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") as TabKey) || "tournament";
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  return (
    <div className="space-y-6">
      {/* Tab Bar */}
      <div className="flex items-center gap-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            className={`px-5 py-2 rounded-full text-base font-mono transition-all duration-200 border active:scale-[0.97] ${
              activeTab === tab.key
                ? "text-darwin-accent bg-darwin-accent/10 border-darwin-accent/30 nav-pill-active"
                : "text-darwin-text border-transparent hover:text-darwin-text-bright hover:bg-darwin-card-hover"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "tournament" && <Tournament />}
      {activeTab === "instinct" && <Instinct />}
      {activeTab === "frontier" && <Frontier />}
      {activeTab === "evolution" && (
        <div className="space-y-8">
          <EvolutionPanel />
          <EvolutionAudit />
        </div>
      )}
    </div>
  );
}
