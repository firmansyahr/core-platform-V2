"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle, Sparkles, X, Send } from "lucide-react";
import { getUser } from "@/lib/auth";
import { Skeleton } from "@/components/ui/skeleton";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const DEFAULT_SUGGESTIONS = [
  "Berapa toko warning hari ini?",
  "Wilayah mana yang paling kritis?",
  "Bagaimana efektivitas program loyalty?",
  "Toko mana yang perlu dikunjungi segera?",
  "Bagaimana tren volume bulan ini?",
];

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export default function ChatBubble() {
  const [mounted,            setMounted]            = useState(false);
  const [isLoggedIn,         setIsLoggedIn]         = useState(false);
  const [isOpen,             setIsOpen]             = useState(false);
  const [messages,           setMessages]           = useState<ChatMessage[]>([]);
  const [input,              setInput]              = useState("");
  const [isLoading,          setIsLoading]          = useState(false);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [unreadCount,        setUnreadCount]        = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    setIsLoggedIn(!!getUser());
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen) setUnreadCount(0);
  }, [isOpen]);

  if (!mounted || !isLoggedIn) return null;

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const userMsg: ChatMessage = { role: "user", content: trimmed, timestamp: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);
    setSuggestedQuestions([]);

    try {
      const { getToken } = await import("@/lib/auth");
      const token = getToken();
      const res = await fetch(`${API}/api/home/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          question: trimmed,
          conversation_history: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      const json = await res.json();
      const d = json.data ?? json;

      const answer =
        d.status === "disabled"
          ? "AI Chat tidak aktif. Set ANTHROPIC_API_KEY pada server untuk mengaktifkan."
          : d.answer ?? "Maaf, tidak ada jawaban tersedia.";

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: answer,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setSuggestedQuestions(d.suggested_questions ?? []);

      if (!isOpen) setUnreadCount((n) => n + 1);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Maaf, terjadi kesalahan. Coba lagi.", timestamp: new Date() },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  const fmtTime = (d: Date) =>
    d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

  return (
    <>
      {/* ── Chat Panel ─────────────────────────────────────────────────── */}
      {isOpen && (
        <div
          className="fixed bottom-6 right-6 z-50 w-96 flex flex-col overflow-hidden
            bg-background border border-border rounded-2xl shadow-2xl"
          style={{ height: 500 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b
            bg-primary text-primary-foreground rounded-t-2xl shrink-0">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              <span className="font-semibold text-sm">CORE Analytics AI</span>
              <span className="text-xs opacity-60">• Online</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="hover:opacity-70 transition-opacity"
              aria-label="Tutup chat"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
            {messages.length === 0 ? (
              <div className="text-center py-6">
                <Sparkles className="h-8 w-8 text-primary mx-auto mb-3 opacity-70" />
                <p className="text-sm font-medium">Tanya apa saja tentang data</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Saya bisa membantu analisis kondisi pasar,<br />
                  warning toko, dan program loyalty
                </p>
                <div className="flex flex-wrap gap-1.5 justify-center mt-4">
                  {DEFAULT_SUGGESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => sendMessage(q)}
                      className="text-xs px-3 py-1.5 bg-muted hover:bg-primary
                        hover:text-primary-foreground rounded-full transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-muted text-foreground rounded-bl-sm"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    <p
                      className={`text-[10px] mt-1 ${
                        msg.role === "user"
                          ? "text-primary-foreground/60 text-right"
                          : "text-muted-foreground"
                      }`}
                    >
                      {fmtTime(msg.timestamp)}
                    </p>
                  </div>
                </div>
              ))
            )}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1 items-center">
                  <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}
          </div>

          {/* Suggested follow-ups */}
          {suggestedQuestions.length > 0 && (
            <div className="px-4 pb-2 flex flex-wrap gap-1 shrink-0">
              {suggestedQuestions.map((q) => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="text-xs px-2.5 py-1 border border-border rounded-full
                    hover:bg-muted transition-colors truncate max-w-[180px]"
                  title={q}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="p-3 border-t shrink-0">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage(input)}
                placeholder="Tanya tentang data…"
                disabled={isLoading}
                className="flex-1 text-sm px-3 py-2 border border-border rounded-lg bg-background
                  placeholder:text-muted-foreground focus:outline-none focus:ring-2
                  focus:ring-primary/40 disabled:opacity-50"
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || isLoading}
                className="px-3 py-2 bg-primary text-primary-foreground rounded-lg
                  hover:bg-primary/90 disabled:opacity-40 transition-colors"
                aria-label="Kirim"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bubble toggle button ────────────────────────────────────────── */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          aria-label="Buka CORE Analytics AI"
          className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-primary text-primary-foreground
            rounded-full shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200
            flex items-center justify-center"
        >
          <MessageCircle className="h-6 w-6" />
          {unreadCount > 0 && (
            <span
              className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1
                bg-red-500 text-white text-[10px] font-bold rounded-full
                flex items-center justify-center leading-none"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      )}
    </>
  );
}
