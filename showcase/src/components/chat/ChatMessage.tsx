"use client";

import type { ChatMessage as ChatMessageType } from "@/lib/chat";

interface ChatMessageProps {
  message: ChatMessageType;
  isStreaming?: boolean;
}

function formatContent(content: string): React.ReactNode[] {
  // Split on bold markers and links, render inline
  const parts: React.ReactNode[] = [];
  // Process bold (**text**) and links ([text](url)) and line breaks
  const regex = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|\n)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(content)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }

    const token = match[0];

    if (token === "\n") {
      parts.push(<br key={key++} />);
    } else if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(
        <strong key={key++} className="text-darwin-text-bright font-semibold">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("[")) {
      const linkMatch = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        parts.push(
          <a
            key={key++}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-darwin-accent underline underline-offset-2 hover:text-darwin-accent-dim"
          >
            {linkMatch[1]}
          </a>
        );
      }
    }

    lastIndex = match.index + token.length;
  }

  // Remaining text
  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return parts;
}

export function ChatMessageBubble({ message, isStreaming }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div
        className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
          isUser
            ? "bg-darwin-accent/15 text-darwin-text-bright rounded-br-md"
            : "bg-darwin-card border border-darwin-border/50 text-darwin-text rounded-bl-md"
        }`}
      >
        <span className="whitespace-pre-wrap break-words">
          {formatContent(message.content)}
          {isStreaming && (
            <span className="inline-block w-0.5 h-4 ml-0.5 bg-darwin-accent align-middle animate-pulse" />
          )}
        </span>

        {message.cta && (
          <a
            href={message.cta.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-darwin-accent/10 text-darwin-accent border border-darwin-accent/20 hover:bg-darwin-accent/20 transition-colors"
          >
            {message.cta.label}
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
}
