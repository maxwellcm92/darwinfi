"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import type { ChatMessage, QuickReplyOption, FlowOption } from "@/lib/chat";
import {
  CHAT_FLOWS,
  PAGE_GREETINGS,
  QUICK_REPLY_FLOW_MAP,
  getStoredSessionId,
  streamChat,
} from "@/lib/chat";

interface ChatContextValue {
  messages: ChatMessage[];
  isOpen: boolean;
  isStreaming: boolean;
  quickReplies: QuickReplyOption[];
  flowOptions: FlowOption[];
  suggestedActions: Array<{ label: string; value: string }>;
  openChat: () => void;
  closeChat: () => void;
  sendMessage: (text: string) => void;
  selectQuickReply: (value: string) => void;
  selectFlowOption: (value: string) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChatContext must be used within ChatProvider");
  return ctx;
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const TYPING_DELAY = 600;

export function ChatProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [quickReplies, setQuickReplies] = useState<QuickReplyOption[]>([]);
  const [flowOptions, setFlowOptions] = useState<FlowOption[]>([]);
  const [suggestedActions, setSuggestedActions] = useState<
    Array<{ label: string; value: string }>
  >([]);
  const [currentFlowId, setCurrentFlowId] = useState<string | null>(null);
  const [flowStepIndex, setFlowStepIndex] = useState(0);

  const sessionIdRef = useRef<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const greetedRef = useRef(false);

  // Initialize session ID on mount
  useEffect(() => {
    sessionIdRef.current = getStoredSessionId();
  }, []);

  // Show greeting when chat opens
  const showGreeting = useCallback(() => {
    if (greetedRef.current) return;
    greetedRef.current = true;

    const greeting = PAGE_GREETINGS[pathname] || PAGE_GREETINGS["/"];
    if (!greeting) return;

    setMessages([
      {
        id: makeId(),
        role: "assistant",
        content: greeting.message,
        timestamp: Date.now(),
      },
    ]);
    setQuickReplies(greeting.quickReplies);
    setSuggestedActions([]);
    setFlowOptions([]);
  }, [pathname]);

  const openChat = useCallback(() => {
    setIsOpen(true);
    showGreeting();
  }, [showGreeting]);

  const closeChat = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Play a guided flow step by step with typing delays
  const playFlow = useCallback(
    (flowId: string, startIndex = 0) => {
      const steps = CHAT_FLOWS[flowId];
      if (!steps || startIndex >= steps.length) {
        setCurrentFlowId(null);
        setFlowStepIndex(0);
        return;
      }

      setCurrentFlowId(flowId);
      setFlowStepIndex(startIndex);
      setIsStreaming(true);
      setQuickReplies([]);
      setFlowOptions([]);
      setSuggestedActions([]);

      let idx = startIndex;

      const playNext = () => {
        if (idx >= steps.length) {
          setIsStreaming(false);
          setCurrentFlowId(null);
          setFlowStepIndex(0);
          return;
        }

        const step = steps[idx];
        idx++;

        if (step.type === "bot") {
          setMessages((prev) => [
            ...prev,
            {
              id: makeId(),
              role: "assistant",
              content: step.text,
              timestamp: Date.now(),
              cta: step.cta,
            },
          ]);

          if (idx < steps.length) {
            setTimeout(playNext, TYPING_DELAY);
          } else {
            setIsStreaming(false);
            setCurrentFlowId(null);
            setFlowStepIndex(0);
          }
        } else if (step.type === "options") {
          setIsStreaming(false);
          setFlowOptions(step.options);
          setCurrentFlowId(flowId);
          setFlowStepIndex(idx);
          // Wait for user to pick an option -- do not call playNext
        }
      };

      setTimeout(playNext, TYPING_DELAY);
    },
    []
  );

  const selectQuickReply = useCallback(
    (value: string) => {
      if (isStreaming) return;

      // Add user message
      setMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: "user",
          content: value,
          timestamp: Date.now(),
        },
      ]);
      setQuickReplies([]);
      setSuggestedActions([]);

      // Check if this maps to a guided flow
      const flowId = QUICK_REPLY_FLOW_MAP[value];
      if (flowId && CHAT_FLOWS[flowId]) {
        playFlow(flowId);
      } else {
        // Freeform AI
        sendFreeformMessage(value);
      }
    },
    [isStreaming, playFlow]
  );

  const selectFlowOption = useCallback(
    (value: string) => {
      if (isStreaming) return;

      // Add user selection as message
      const option = flowOptions.find((o) => o.value === value);
      setMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: "user",
          content: option?.label || value,
          timestamp: Date.now(),
        },
      ]);
      setFlowOptions([]);

      // Check if this maps to a sub-flow
      if (CHAT_FLOWS[value]) {
        playFlow(value);
      } else {
        // Freeform for unrecognized values
        sendFreeformMessage(value);
      }
    },
    [isStreaming, flowOptions, playFlow]
  );

  const sendFreeformMessage = useCallback(
    (text: string) => {
      setIsStreaming(true);
      setQuickReplies([]);
      setFlowOptions([]);
      setSuggestedActions([]);
      setCurrentFlowId(null);

      // Create a placeholder assistant message for streaming
      const assistantId = makeId();
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          timestamp: Date.now(),
        },
      ]);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      streamChat({
        message: text,
        sessionId: sessionIdRef.current,
        pathname,
        signal: controller.signal,
        onChunk: (chunk) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content + chunk }
                : m
            )
          );
        },
        onSuggestedActions: (actions) => {
          setSuggestedActions(actions);
        },
        onError: (error) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: m.content || "Sorry, I had trouble responding. Please try again.",
                  }
                : m
            )
          );
        },
        onDone: () => {
          setIsStreaming(false);
          // Clean [SUGGESTED_ACTIONS] block from displayed message
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id === assistantId) {
                const cleaned = m.content
                  .replace(
                    /\[SUGGESTED_ACTIONS\][\s\S]*?\[\/SUGGESTED_ACTIONS\]/g,
                    ""
                  )
                  .trim();
                return { ...m, content: cleaned };
              }
              return m;
            })
          );
        },
      });
    },
    [pathname]
  );

  const sendMessage = useCallback(
    (text: string) => {
      if (isStreaming || !text.trim()) return;

      const trimmed = text.trim();

      // Add user message
      setMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: "user",
          content: trimmed,
          timestamp: Date.now(),
        },
      ]);

      // Check if it maps to a flow
      const flowId = QUICK_REPLY_FLOW_MAP[trimmed];
      if (flowId && CHAT_FLOWS[flowId]) {
        playFlow(flowId);
      } else {
        sendFreeformMessage(trimmed);
      }
    },
    [isStreaming, playFlow, sendFreeformMessage]
  );

  return (
    <ChatContext.Provider
      value={{
        messages,
        isOpen,
        isStreaming,
        quickReplies,
        flowOptions,
        suggestedActions,
        openChat,
        closeChat,
        sendMessage,
        selectQuickReply,
        selectFlowOption,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
