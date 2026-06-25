"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, Send, Settings, RotateCcw, Search, CheckCircle2, Circle, Loader2, Save, FolderOpen } from "lucide-react";
import Navbar from "@/components/Navbar";
import { getUser } from "@/lib/auth";
import { apiFetch, API } from "@/lib/fetch";
import {
  useOracleContextValue, type OracleMessage, type RenderCommand,
} from "@/components/oracle/OracleContextProvider";
import { streamOracleChat } from "@/lib/oracleStream";
import { OracleMarkdown } from "@/components/oracle/OracleMarkdown";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface SavedSessionSummary {
  id: string;
  title: string;
  summary: string | null;
  updated_at: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const fmtNum = (n: unknown) => typeof n === "number" ? new Intl.NumberFormat("id-ID").format(n) : String(n ?? "");

function getSessionId(): string {
  if (typeof window === "undefined") return "server";
  let id = sessionStorage.getItem("oracle-session-id");
  if (!id) {
    id = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem("oracle-session-id", id);
  }
  return id;
}

// ── Render command renderers ─────────────────────────────────────────────────

function ChartCard({ cmd }: { cmd: RenderCommand }) {
  const data = (cmd.data as Record<string, unknown>[]) ?? [];
  const xKey = String(cmd.x_key ?? "name");
  const yKey = String(cmd.y_key ?? "value");
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-sm font-semibold mb-3">{String(cmd.title ?? "Chart")}</p>
      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          {cmd.type === "line_chart" ? (
            <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey={xKey} tick={{ fontSize: 10 }} angle={-25} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey={yKey} stroke="#7c3aed" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          ) : (
            <BarChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey={xKey} tick={{ fontSize: 10 }} angle={-25} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey={yKey} fill="#7c3aed" radius={[3, 3, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function TableCard({ cmd }: { cmd: RenderCommand }) {
  const columns = (cmd.columns as string[]) ?? [];
  const rows = (cmd.rows as Record<string, unknown>[]) ?? [];
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <p className="text-sm font-semibold px-4 pt-4 pb-2">{String(cmd.title ?? "Tabel")}</p>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => <TableHead key={c} className="text-xs whitespace-nowrap">{c}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow key={i}>
                {columns.map((c) => (
                  <TableCell key={c} className="text-xs whitespace-nowrap">{fmtNum(row[c])}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function KpiCardsCard({ cmd }: { cmd: RenderCommand }) {
  const cards = (cmd.cards as { label: string; value: string; sub?: string }[]) ?? [];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {cards.map((c, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{c.label}</p>
          <p className="text-xl font-bold mt-1">{c.value}</p>
          {c.sub && <p className="text-[10px] text-muted-foreground mt-1">{c.sub}</p>}
        </div>
      ))}
    </div>
  );
}

function ComparisonCard({ cmd }: { cmd: RenderCommand }) {
  const items = (cmd.items as Record<string, unknown>[]) ?? [];
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-sm font-semibold mb-3">{String(cmd.title ?? "Perbandingan")}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map((item, i) => (
          <div key={i} className="rounded-lg bg-muted/40 p-3 space-y-1">
            {Object.entries(item).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-medium">{fmtNum(v)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function RenderCommandView({ cmd }: { cmd: RenderCommand }) {
  if (cmd.type === "bar_chart" || cmd.type === "line_chart") return <ChartCard cmd={cmd} />;
  if (cmd.type === "table") return <TableCard cmd={cmd} />;
  if (cmd.type === "kpi_cards") return <KpiCardsCard cmd={cmd} />;
  if (cmd.type === "comparison") return <ComparisonCard cmd={cmd} />;
  return null;
}

// ── RCA progress tracker ──────────────────────────────────────────────────────

function RcaTracker({ steps }: { steps: { step: number; label: string; status: string }[] }) {
  return (
    <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 mb-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400 mb-2 flex items-center gap-1.5">
        <Search className="h-3 w-3" /> RCA Progress
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {steps.map((s, i) => (
          <div key={s.step} className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-white dark:bg-background border border-amber-200 dark:border-amber-800">
              {s.status === "done" ? <CheckCircle2 className="h-3 w-3 text-green-600" /> : <Circle className="h-3 w-3 text-muted-foreground" />}
              {s.label}
            </span>
            {i < steps.length - 1 && <span className="text-amber-400">→</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function OracleWorkspacePage() {
  const [mounted, setMounted] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const [draftRenderCommands, setDraftRenderCommands] = useState<RenderCommand[]>([]);
  const [dataTab, setDataTab] = useState<"charts" | "tables" | "summary">("summary");
  const [savedSessions, setSavedSessions] = useState<SavedSessionSummary[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { pageContext, history, appendMessage, clearHistory, replaceHistory } = useOracleContextValue();

  useEffect(() => {
    setMounted(true);
    setIsLoggedIn(!!getUser());
  }, []);

  async function refreshSavedSessions() {
    try {
      const res = await apiFetch(`${API}/api/oracle/agent/sessions`);
      const json = await res.json();
      setSavedSessions(json.data ?? []);
    } catch {
      // sesi tersimpan bukan fitur kritikal — gagal diam-diam
    }
  }

  useEffect(() => {
    refreshSavedSessions();
  }, []);

  function startNewSession() {
    clearHistory();
  }

  async function saveCurrentSession() {
    if (history.length === 0) return;
    const defaultTitle = history.find((m) => m.role === "user")?.content.slice(0, 60) ?? "Sesi ORACLE";
    const title = window.prompt("Nama sesi:", defaultTitle);
    if (!title) return;
    try {
      await apiFetch(`${API}/api/oracle/agent/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, history, page_context: pageContext }),
      });
      await refreshSavedSessions();
    } catch {
      window.alert("Gagal menyimpan sesi. Coba lagi.");
    }
  }

  async function loadSession(sessionId: string) {
    try {
      const res = await apiFetch(`${API}/api/oracle/agent/sessions/${sessionId}`);
      const json = await res.json();
      replaceHistory(json.data?.history ?? []);
    } catch {
      window.alert("Gagal memuat sesi.");
    }
  }

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history, isStreaming, draftText]);

  if (!mounted) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
      </div>
    );
  }
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="pt-24 max-w-md mx-auto text-center px-6">
          <Sparkles className="h-10 w-10 text-primary mx-auto mb-4 opacity-70" />
          <p className="text-sm text-muted-foreground">Login untuk mengakses ORACLE Workspace.</p>
        </main>
      </div>
    );
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    appendMessage({ role: "user", content: trimmed, timestamp: Date.now() });
    setInput("");
    setIsStreaming(true);
    setDraftText("");
    setActiveTools([]);
    setDraftRenderCommands([]);

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
            const cmd = event.command as RenderCommand;
            draft.render_commands = [...(draft.render_commands ?? []), cmd];
            setDraftRenderCommands((prev) => [...prev, cmd]);
            if (cmd.type === "bar_chart" || cmd.type === "line_chart") setDataTab("charts");
            else if (cmd.type === "table") setDataTab("tables");
            else setDataTab("summary");
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
          }
        },
      );
    } catch {
      draft.content = draft.content || "Maaf, terjadi kesalahan menghubungi ORACLE. Coba lagi.";
    } finally {
      appendMessage({ ...draft, timestamp: Date.now() });
      setDraftText("");
      setActiveTools([]);
      setDraftRenderCommands([]);
      setIsStreaming(false);
    }
  }

  const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");

  // Akumulasi semua render_commands dari seluruh percakapan + draft yang sedang
  // streaming (supaya chart/tabel muncul live di data panel, bukan menunggu "done").
  const allCommands = [...history.flatMap((m) => m.render_commands ?? []), ...draftRenderCommands];
  const chartsCmds = allCommands.filter((c) => c.type === "bar_chart" || c.type === "line_chart");
  const tablesCmds = allCommands.filter((c) => c.type === "table");
  const summaryCmds = allCommands.filter((c) => c.type === "kpi_cards" || c.type === "comparison");

  const activeCommands = dataTab === "charts" ? chartsCmds : dataTab === "tables" ? tablesCmds : summaryCmds;

  const headerSubtitle = pageContext.entity_name
    ? `Menganalisis: ${pageContext.entity_name}${pageContext.module ? ` · ${pageContext.module}` : ""}`
    : "Siap menganalisis seluruh data platform";

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16 h-screen flex flex-col">
        {/* Header */}
        <div className="px-6 py-3 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h1 className="text-base font-bold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> ORACLE Intelligence
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">{headerSubtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={startNewSession}
              className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors flex items-center gap-1.5"
            >
              <RotateCcw className="h-3 w-3" /> Sesi Baru
            </button>
            <button
              onClick={saveCurrentSession}
              disabled={history.length === 0}
              className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors flex items-center gap-1.5 disabled:opacity-40"
            >
              <Save className="h-3 w-3" /> Simpan
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-muted transition-colors flex items-center gap-1.5">
                  <FolderOpen className="h-3 w-3" /> Sesi Tersimpan
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Sesi Tersimpan</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {savedSessions.length === 0 ? (
                  <div className="px-2 py-3 text-xs text-muted-foreground text-center">Belum ada sesi tersimpan</div>
                ) : (
                  savedSessions.map((s) => (
                    <DropdownMenuItem key={s.id} onClick={() => loadSession(s.id)} className="flex flex-col items-start gap-0.5">
                      <p className="text-sm truncate w-full">{s.title}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(s.updated_at)}</p>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <button className="p-1.5 rounded-lg border border-border hover:bg-muted transition-colors" aria-label="Settings">
              <Settings className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Two-panel layout */}
        <div className="flex-1 flex min-h-0">
          {/* Chat panel — 40% */}
          <div className="w-2/5 flex flex-col border-r border-border min-h-0">
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
              {history.length === 0 ? (
                <div className="text-center py-10">
                  <Sparkles className="h-10 w-10 text-primary mx-auto mb-3 opacity-70" />
                  <p className="text-sm font-medium">Mulai analisis dengan ORACLE</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Tanya tentang ROI program, root cause penurunan toko,<br />perbandingan kompetitor, atau simulasi skenario.
                  </p>
                </div>
              ) : (
                history.map((msg, i) => (
                  <div key={i}>
                    {msg.role === "assistant" && msg.rca_mode && msg.rca_steps && (
                      <RcaTracker steps={msg.rca_steps} />
                    )}
                    <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                        msg.role === "user" ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted text-foreground rounded-bl-sm"
                      }`}>
                        {msg.role === "assistant" ? (
                          <OracleMarkdown content={msg.content} />
                        ) : (
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        )}
                      </div>
                    </div>
                    {msg.role === "assistant" && msg.confidence_signals && msg.confidence_signals.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        {msg.confidence_signals.map((f, j) => (
                          <div key={j} className="text-[11px] rounded-lg border border-border bg-card p-2">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="font-medium">{f.finding}</span>
                              <span className={`shrink-0 ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                f.confidence === "tinggi" ? "bg-green-100 text-green-700" :
                                f.confidence === "sedang" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"
                              }`}>{f.confidence}</span>
                            </div>
                            <p className="text-muted-foreground">{f.evidence}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
              {isStreaming && (
                <div className="flex justify-start">
                  <div className="max-w-[90%] rounded-2xl rounded-bl-sm px-3 py-2 text-sm leading-relaxed bg-muted text-foreground">
                    {activeTools.length > 0 && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1.5">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>Mengambil data: {activeTools.join(", ")}…</span>
                      </div>
                    )}
                    {draftText ? (
                      <OracleMarkdown content={draftText} />
                    ) : activeTools.length === 0 ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span className="text-xs text-muted-foreground">ORACLE sedang menganalisis…</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>

            {!isStreaming && lastAssistant && (lastAssistant.suggested_followups?.length ?? 0) > 0 && (
              <div className="px-4 pb-2 flex flex-wrap gap-1 shrink-0">
                {lastAssistant.suggested_followups!.map((q) => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="text-xs px-2.5 py-1 border border-border rounded-full hover:bg-muted transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            <div className="p-3 border-t border-border shrink-0">
              <div className="flex gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
                  placeholder="Tanya ORACLE…"
                  disabled={isStreaming}
                  rows={2}
                  className="flex-1 text-sm px-3 py-2 border border-border rounded-lg bg-background resize-none
                    placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
                />
                <button
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim() || isStreaming}
                  className="px-3 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors shrink-0 self-end"
                  aria-label="Kirim"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Data panel — 60% */}
          <div className="w-3/5 flex flex-col min-h-0">
            <div className="flex items-center gap-1 px-4 pt-3 shrink-0">
              {(["summary", "charts", "tables"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setDataTab(tab)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    dataTab === tab ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"
                  }`}
                >
                  {tab === "summary" ? "Summary" : tab === "charts" ? "Charts" : "Tables"}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
              {activeCommands.length === 0 ? (
                <div className="h-full flex items-center justify-center text-center">
                  <div>
                    <Sparkles className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Belum ada visualisasi di kategori ini.</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">Visualisasi muncul otomatis saat ORACLE merender chart/tabel/KPI.</p>
                  </div>
                </div>
              ) : (
                [...activeCommands].reverse().map((cmd, i) => <RenderCommandView key={i} cmd={cmd} />)
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
