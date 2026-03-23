"use client";

import { AnimatedSection } from "@/components/AnimatedSection";
import { SessionCard, type SessionData } from "@/components/SessionCard";

const dotColorMap: Record<SessionData["type"], string> = {
  architecture: "bg-[#8040DD] shadow-[0_0_8px_rgba(128,64,221,0.6)]",
  deployment: "bg-[#00F0C0] shadow-[0_0_8px_rgba(0,240,192,0.6)]",
  audit: "bg-[#E4C64B] shadow-[0_0_8px_rgba(228,198,75,0.6)]",
  fix: "bg-[#FFB020] shadow-[0_0_8px_rgba(255,176,32,0.6)]",
};

export function StoryTimeline({ sessions }: { sessions: SessionData[] }) {
  return (
    <div className="relative">
      {/* Vertical line - centered on desktop, left-aligned on mobile */}
      <div className="absolute left-4 md:left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-darwin-border via-darwin-accent/30 to-darwin-border md:-translate-x-px" />

      <div className="space-y-8 md:space-y-12">
        {sessions.map((session, i) => {
          const side = i % 2 === 0 ? "left" : "right";
          return (
            <AnimatedSection key={session.number} delay={i * 80}>
              <div className="relative flex items-start">
                {/* Timeline dot */}
                <div
                  className={`absolute left-4 md:left-1/2 w-4 h-4 rounded-full ${dotColorMap[session.type]} z-10 -translate-x-1/2 mt-5 md:mt-6`}
                />

                {/* Mobile: always right of the line */}
                {/* Desktop: alternating left/right */}
                <div className="md:hidden pl-10 w-full">
                  <SessionCard session={session} side="right" />
                </div>

                {/* Desktop layout */}
                <div className="hidden md:grid md:grid-cols-2 md:gap-8 w-full">
                  {side === "left" ? (
                    <>
                      <div className="pr-8">
                        <SessionCard session={session} side="left" />
                      </div>
                      <div />
                    </>
                  ) : (
                    <>
                      <div />
                      <div className="pl-8">
                        <SessionCard session={session} side="right" />
                      </div>
                    </>
                  )}
                </div>
              </div>
            </AnimatedSection>
          );
        })}
      </div>
    </div>
  );
}
