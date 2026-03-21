import type { ReactNode } from "react";

interface FeatureCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  accentColor?: "accent" | "purple" | "warning" | "gold";
}

const accentMap = {
  accent: {
    border: "hover:border-darwin-accent/30",
    glow: "group-hover:text-darwin-accent",
    shadow: "group-hover:shadow-[0_0_20px_rgba(0,240,192,0.1)]",
  },
  purple: {
    border: "hover:border-darwin-purple/30",
    glow: "group-hover:text-darwin-purple",
    shadow: "group-hover:shadow-[0_0_20px_rgba(128,64,221,0.1)]",
  },
  warning: {
    border: "hover:border-darwin-warning/30",
    glow: "group-hover:text-darwin-warning",
    shadow: "group-hover:shadow-[0_0_20px_rgba(255,176,32,0.1)]",
  },
  gold: {
    border: "hover:border-darwin-gold/30",
    glow: "group-hover:text-darwin-gold",
    shadow: "group-hover:shadow-[0_0_20px_rgba(228,198,75,0.1)]",
  },
};

export function FeatureCard({
  icon,
  title,
  description,
  accentColor = "accent",
}: FeatureCardProps) {
  const colors = accentMap[accentColor];

  return (
    <div
      className={`group darwin-card ${colors.border} ${colors.shadow} transition-all duration-300`}
    >
      <div
        className={`text-darwin-text-dim ${colors.glow} transition-colors duration-300 mb-4`}
      >
        {icon}
      </div>
      <h3 className="font-semibold text-darwin-text-bright text-lg mb-2">
        {title}
      </h3>
      <p className="text-darwin-text-dim text-base leading-relaxed">
        {description}
      </p>
    </div>
  );
}
