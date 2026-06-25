"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, X, Send, Maximize2, Search, Loader2 } from "lucide-react";
import { getUser } from "@/lib/auth";
import { API } from "@/lib/fetch";
import { useOracleContextValue, type OracleMessage } from "@/components/oracle/OracleContextProvider";
import { streamOracleChat } from "@/lib/oracleStream";
import { OracleMarkdown } from "@/components/oracle/OracleMarkdown";
import { OracleModelBadge } from "@/components/oracle/OracleModelBadge";

const DEFAULT_SUGGESTIONS = [
  "Berapa toko warning Merah saat ini?",
  "Kabupaten mana yang paling kritis?",
  "Bagaimana efektivitas program loyalty bulan ini?",
];

function getSessionId(): string {
  if (typeof window === "undefined") return "server";
  let id = sessionStorage.getItem("oracle-session-id");
  if (!id) {
    id = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem("oracle-session-id", id);
  }
  return id;
}

export default function OracleWidget() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const {
    pageContext, history, appendMessage,
    isWidgetOpen, setWidgetOpen,
  } = useOracleContextValue();

  useEffect(() => {
    setMounted(true);
    setIsLoggedIn(!!getUser());
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history, isStreaming, draftText]);

  // Cmd+K / Ctrl+K — toggle ORACLE dari halaman mana pun.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setWidgetOpen(!isWidgetOpen);
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setWidgetOpen, isWidgetOpen]);

  if (!mounted || !isLoggedIn) return null;

  const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    appendMessage({ role: "user", content: trimmed, timestamp: Date.now() });
    setInput("");
    setIsStreaming(true);
    setDraftText("");
    setActiveTools([]);

    const draft: Omit<OracleMessage, "timestamp"> = {
      role: "assistant", content: "", render_commands: [], suggested_followups: [],
      rca_mode: false, rca_steps: null, confidence_signals: null,
    };

    try {
      await streamOracleChat(
        API,
        {
          message: trimmed,
          conversation_history: history.map((m) => ({ role: m.role, content: m.content })),
          page_context: pageContext,
          session_id: getSessionId(),
        },
        (event) => {
          if (event.type === "text_delta") {
            draft.content += String(event.text ?? "");
            setDraftText(draft.content);
          } else if (event.type === "tool_start") {
            setActiveTools((prev) => [...prev, String(event.tool)]);
          } else if (event.type === "tool_done") {
            setActiveTools((prev) => prev.filter((t) => t !== event.tool));
          } else if (event.type === "render_command") {
            draft.render_commands = [...(draft.render_commands ?? []), event.command as never];
          } else if (event.type === "confidence") {
            draft.confidence_signals = event.findings as never;
          } else if (event.type === "blocked") {
            draft.content = String(event.text ?? draft.content);
            setDraftText(draft.content);
          } else if (event.type === "done") {
            draft.content = String(event.reply ?? draft.content);
            draft.render_commands = (event.render_commands as never) ?? draft.render_commands;
            draft.suggested_followups = (event.suggested_followups as never) ?? [];
            draft.rca_mode = Boolean(event.rca_mode);
            draft.rca_steps = (event.rca_steps as never) ?? null;
            draft.confidence_signals = (event.confidence_signals as never) ?? draft.confidence_signals;
            draft.model_used = (event.model_used as string | null) ?? null;
            draft.routing_reason = (event.routing_reason as string | null) ?? null;
          }
        },
      );
    } catch {
      draft.content = draft.content || "Maaf, terjadi kesalahan menghubungi ORACLE. Coba lagi.";
    } finally {
      appendMessage({ ...draft, timestamp: Date.now() });
      setDraftText("");
      setActiveTools([]);
      setIsStreaming(false);
    }
  }

  function openWorkspace() {
    setWidgetOpen(false);
    router.push("/analytics/oracle");
  }

  const contextLabel = pageContext.entity_name
    ? `${pageContext.entity_name}${pageContext.module ? ` · ${pageContext.module}` : ""}`
    : pageContext.module
      ? `Module ${pageContext.module}`
      : "Halaman umum";

  return (
    <>
      {isWidgetOpen && (
        <div
          className="fixed bottom-6 right-6 z-50 flex flex-col overflow-hidden
            bg-background border border-border rounded-2xl shadow-2xl"
          style={{ width: 420, height: 580 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b
            bg-primary text-primary-foreground shrink-0">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              <span className="font-semibold text-sm">ORACLE Intelligence</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary-foreground/20">AI</span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={openWorkspace} className="hover:opacity-70 transition-opacity p-1" aria-label="Buka Workspace">
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setWidgetOpen(false)} className="hover:opacity-70 transition-opacity p-1" aria-label="Tutup">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Context bar */}
          <div className="px-4 py-1.5 border-b bg-muted/40 shrink-0">
            <p className="text-[10px] text-muted-foreground truncate">
              Konteks: <span className="font-medium text-foreground">{contextLabel}</span>
            </p>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
            {history.length === 0 && !isStreaming ? (
              <div className="text-center py-6">
                <Sparkles className="h-8 w-8 text-primary mx-auto mb-3 opacity-70" />
                <p className="text-sm font-medium">Tanya apa saja ke ORACLE</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Deep analysis, root cause, dan rekomendasi berbasis data real platform
                </p>
                <div className="flex flex-wrap gap-1.5 justify-center mt-4">
                  {DEFAULT_SUGGESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => sendMessage(q)}
                      className="text-xs px-3 py-1.5 bg-muted hover:bg-primary hover:text-primary-foreground rounded-full transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              history.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    msg.role === "user" ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted text-foreground rounded-bl-sm"
                  }`}>
                    {msg.role === "assistant" && msg.rca_mode && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400 mb-1">
                        <Search className="h-3 w-3" /> RCA Mode
                      </span>
                    )}
                    {msg.role === "assistant" ? (
                      <OracleMarkdown content={msg.content} />
                    ) : (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    )}
                    {msg.role === "assistant" && (
                      <OracleModelBadge modelUsed={msg.model_used} routingReason={msg.routing_reason} />
                    )}
                    {msg.role === "assistant" && (msg.render_commands?.length ?? 0) > 0 && (
                      <button
                        onClick={openWorkspace}
                        className="mt-2 text-[11px] font-medium text-primary hover:underline"
                      >
                        📊 Ada visualisasi tersedia — buka di Workspace →
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}

            {isStreaming && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-3 py-2 text-sm leading-relaxed bg-muted text-foreground">
                  {activeTools.length > 0 && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Mengambil data: {activeTools.join(", ")}…</span>
                    </div>
                  )}
                  {draftText ? (
                    <OracleMarkdown content={draftText} />
                  ) : activeTools.length === 0 ? (
                    <div className="flex gap-1 items-center py-1">
                      <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:300ms]" />
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          {/* Suggested follow-ups */}
          {!isStreaming && lastAssistant && (lastAssistant.suggested_followups?.length ?? 0) > 0 && (
            <div className="px-4 pb-2 flex flex-wrap gap-1 shrink-0">
              {lastAssistant.suggested_followups!.map((q) => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="text-xs px-2.5 py-1 border border-border rounded-full hover:bg-muted transition-colors truncate max-w-[180px]"
                  title={q}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="p-3 border-t shrink-0 space-y-2">
            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
                placeholder="Tanya ORACLE…"
                disabled={isStreaming}
                rows={1}
                className="flex-1 text-sm px-3 py-2 border border-border rounded-lg bg-background resize-none
                  placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || isStreaming}
                className="px-3 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors shrink-0"
                aria-label="Kirim"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <button
              onClick={openWorkspace}
              className="w-full text-xs py-1.5 rounded-lg border border-border hover:bg-muted transition-colors flex items-center justify-center gap-1.5 text-muted-foreground"
            >
              <Maximize2 className="h-3 w-3" /> Open Workspace
            </button>
          </div>
        </div>
      )}

      {!isWidgetOpen && (
        <button
          onClick={() => setWidgetOpen(true)}
          aria-label="Buka ORACLE"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 pl-4 pr-5 h-14 bg-primary text-primary-foreground
            rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200"
        >
          <span className="relative flex items-center justify-center">
            <span className="absolute inline-flex h-full w-full rounded-full bg-primary-foreground/30 animate-ping" style={{ animationDuration: "2.5s" }} />
            <Sparkles className="h-5 w-5 relative" />
          </span>
          <span className="font-semibold text-sm">ORACLE</span>
        </button>
      )}
    </>
  );
}
