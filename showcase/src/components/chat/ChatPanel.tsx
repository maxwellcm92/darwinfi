"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useChatContext } from "./ChatProvider";
import { ChatMessageBubble } from "./ChatMessage";
import { QuickReply } from "./QuickReply";

export function ChatPanel() {
  const {
    messages,
    isOpen,
    isStreaming,
    quickReplies,
    flowOptions,
    suggestedActions,
    closeChat,
    sendMessage,
    selectQuickReply,
    selectFlowOption,
  } = useChatContext();

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, quickReplies, flowOptions, suggestedActions]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Escape to close
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) closeChat();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, closeChat]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!input.trim() || isStreaming) return;
      sendMessage(input);
      setInput("");
    },
    [input, isStreaming, sendMessage]
  );

  const handleSuggestedAction = useCallback(
    (value: string) => {
      selectQuickReply(value);
    },
    [selectQuickReply]
  );

  if (!isOpen) return null;

  return (
    <>
      {/* Mobile overlay backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50 md:hidden"
        onClick={closeChat}
      />

      {/* Panel */}
      <div className="fixed z-50 md:bottom-6 md:right-6 md:w-[400px] md:h-[550px] md:rounded-2xl inset-0 md:inset-auto flex flex-col bg-darwin-bg border border-darwin-border/50 shadow-2xl shadow-black/50 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-darwin-border/50 bg-darwin-card/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-darwin-accent to-darwin-purple flex items-center justify-center">
              <svg
                className="w-3.5 h-3.5 text-darwin-bg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-2.47 2.47a2.25 2.25 0 00-.659 1.59v.27a2.25 2.25 0 01-2.25 2.25h-3.24a2.25 2.25 0 01-2.25-2.25v-.27a2.25 2.25 0 00-.659-1.59L5 14.5m14 0V17a2 2 0 01-2 2H7a2 2 0 01-2-2v-2.5"
                />
              </svg>
            </div>
            <div>
              <span className="text-base font-semibold text-darwin-text-bright">
                Darwin
              </span>
              <span className="ml-2 text-xs font-mono text-darwin-accent/70">
                AI Guide
              </span>
            </div>
          </div>
          <button
            onClick={closeChat}
            className="p-1.5 rounded-lg text-darwin-text-dim hover:text-darwin-text-bright hover:bg-darwin-card transition-colors"
            aria-label="Close chat"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1 scroll-smooth">
          {messages.map((msg, i) => (
            <ChatMessageBubble
              key={msg.id}
              message={msg}
              isStreaming={
                isStreaming &&
                i === messages.length - 1 &&
                msg.role === "assistant"
              }
            />
          ))}

          {/* Flow options */}
          {flowOptions.length > 0 && !isStreaming && (
            <QuickReply
              options={flowOptions}
              onSelect={selectFlowOption}
              disabled={isStreaming}
            />
          )}

          {/* Quick replies */}
          {quickReplies.length > 0 && !isStreaming && flowOptions.length === 0 && (
            <QuickReply
              options={quickReplies}
              onSelect={selectQuickReply}
              disabled={isStreaming}
            />
          )}

          {/* Suggested actions from AI */}
          {suggestedActions.length > 0 &&
            !isStreaming &&
            quickReplies.length === 0 &&
            flowOptions.length === 0 && (
              <QuickReply
                options={suggestedActions}
                onSelect={handleSuggestedAction}
                disabled={isStreaming}
              />
            )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <form
          onSubmit={handleSubmit}
          className="shrink-0 px-3 py-3 border-t border-darwin-border/50 bg-darwin-card/30"
        >
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isStreaming ? "Darwin is typing..." : "Ask Darwin anything..."}
              disabled={isStreaming}
              className="flex-1 px-3 py-2 text-base bg-darwin-bg border border-darwin-border/50 rounded-lg text-darwin-text-bright placeholder:text-darwin-text-dim/50 focus:outline-none focus:border-darwin-accent/50 disabled:opacity-50 transition-colors"
            />
            <button
              type="submit"
              disabled={isStreaming || !input.trim()}
              className="p-2 rounded-lg bg-darwin-accent/10 text-darwin-accent hover:bg-darwin-accent/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Send message"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 19V5m0 0l-7 7m7-7l7 7"
                />
              </svg>
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
