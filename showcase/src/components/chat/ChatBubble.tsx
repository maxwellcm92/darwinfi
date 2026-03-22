"use client";

import { useState, useEffect } from "react";
import { useChatContext } from "./ChatProvider";
import { ChatPanel } from "./ChatPanel";

export function ChatBubble() {
  const { isOpen, openChat, closeChat } = useChatContext();
  const [showTeaser, setShowTeaser] = useState(false);
  const [teaserDismissed, setTeaserDismissed] = useState(false);

  // Show teaser tooltip after 8 seconds
  useEffect(() => {
    if (isOpen || teaserDismissed) return;
    const timer = setTimeout(() => setShowTeaser(true), 8000);
    return () => clearTimeout(timer);
  }, [isOpen, teaserDismissed]);

  // Hide teaser when chat opens
  useEffect(() => {
    if (isOpen) {
      setShowTeaser(false);
      setTeaserDismissed(true);
    }
  }, [isOpen]);

  return (
    <>
      {/* Floating bubble button */}
      <div className="fixed bottom-6 right-6 z-[60]">
        {/* Teaser tooltip */}
        {showTeaser && !isOpen && (
          <div className="absolute bottom-full right-0 mb-3 w-56 animate-fade-in">
            <div className="relative bg-darwin-card border border-darwin-border/60 rounded-xl px-3.5 py-2.5 text-sm text-darwin-text shadow-lg">
              <button
                onClick={() => {
                  setShowTeaser(false);
                  setTeaserDismissed(true);
                }}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-darwin-card border border-darwin-border flex items-center justify-center text-darwin-text-dim hover:text-darwin-text-bright transition-colors"
                aria-label="Dismiss"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              Ask Darwin about strategies, safety, or how DarwinFi evolves.
              {/* Arrow */}
              <div className="absolute -bottom-1.5 right-6 w-3 h-3 bg-darwin-card border-r border-b border-darwin-border/60 transform rotate-45" />
            </div>
          </div>
        )}

        <button
          onClick={isOpen ? closeChat : openChat}
          className="group relative w-14 h-14 rounded-full bg-gradient-to-br from-darwin-accent to-darwin-accent-dim shadow-lg shadow-darwin-accent/20 hover:shadow-darwin-accent/40 transition-all duration-300 hover:scale-105 active:scale-95 flex items-center justify-center"
          aria-label={isOpen ? "Close chat" : "Open chat"}
        >
          {isOpen ? (
            <svg className="w-6 h-6 text-darwin-bg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <img src="/darwinfi-logo-bg-chat.webp" alt="DarwinFi" className="w-8 h-8 rounded-lg object-cover" />
          )}

          {/* Pulse ring animation when closed */}
          {!isOpen && (
            <span className="absolute inset-0 rounded-full bg-darwin-accent/30 animate-ping opacity-20 pointer-events-none" />
          )}
        </button>
      </div>

      {/* Chat panel */}
      {isOpen && <ChatPanel />}
    </>
  );
}
