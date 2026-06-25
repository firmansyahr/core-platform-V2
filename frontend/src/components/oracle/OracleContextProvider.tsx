"use client";

import { createContext, useCallback, useContext, useState, useMemo, useEffect, type ReactNode } from "react";

const STORAGE_KEY = "oracle-history-v1";

function loadStoredHistory(): OracleMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OracleMessage[]) : [];
  } catch {
    return [];
  }
}

export interface PageContextData {
  current_page: string;
  module: string | null;
  entity_type: string | null;
  entity_id: string | null;
  entity_name: string | null;
  entity_snapshot: Record<string, unknown> | null;
}

export interface RenderCommand {
  type: "bar_chart" | "line_chart" | "table" | "kpi_cards" | "comparison";
  [key: string]: unknown;
}

export interface OracleMessage {
  role: "user" | "assistant";
  content: string;
  render_commands?: RenderCommand[];
  suggested_followups?: string[];
  rca_mode?: boolean;
  rca_steps?: { step: number; label: string; status: string }[] | null;
  confidence_signals?: { finding: string; confidence: string; evidence: string }[] | null;
  model_used?: string | null;
  routing_reason?: string | null;
  timestamp: number;
}

interface OracleContextValue {
  pageContext: PageContextData;
  setOracleContext: (partial: Partial<Omit<PageContextData, "current_page" | "module">>) => void;
  setPageMeta: (current_page: string, module: string | null) => void;
  history: OracleMessage[];
  appendMessage: (m: OracleMessage) => void;
  clearHistory: () => void;
  replaceHistory: (messages: OracleMessage[]) => void;
  isWidgetOpen: boolean;
  setWidgetOpen: (v: boolean) => void;
  isWidgetExpanded: boolean;
  setWidgetExpanded: (v: boolean) => void;
}

const DEFAULT_CONTEXT: PageContextData = {
  current_page: "", module: null, entity_type: null, entity_id: null, entity_name: null, entity_snapshot: null,
};

const OracleContext = createContext<OracleContextValue | null>(null);

export function OracleContextProvider({ children }: { children: ReactNode }) {
  const [pageContext, setPageContext] = useState<PageContextData>(DEFAULT_CONTEXT);
  const [history, setHistory] = useState<OracleMessage[]>([]);
  const [isWidgetOpen, setWidgetOpen] = useState(false);
  const [isWidgetExpanded, setWidgetExpanded] = useState(false);

  // Hydrate dari sessionStorage sekali setelah mount (hindari SSR/client mismatch).
  useEffect(() => {
    const stored = loadStoredHistory();
    if (stored.length > 0) setHistory(stored);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {
      // quota exceeded atau private mode — abaikan, history tetap jalan in-memory
    }
  }, [history]);

  const setOracleContext = useCallback((partial: Partial<Omit<PageContextData, "current_page" | "module">>) => {
    setPageContext((prev) => ({ ...prev, ...partial }));
  }, []);

  const setPageMeta = useCallback((current_page: string, module: string | null) => {
    setPageContext((prev) => {
      // Pindah halaman → reset entity context lama (entity milik halaman sebelumnya).
      if (prev.current_page === current_page) return { ...prev, module };
      return { current_page, module, entity_type: null, entity_id: null, entity_name: null, entity_snapshot: null };
    });
  }, []);

  const appendMessage = useCallback((m: OracleMessage) => {
    setHistory((prev) => [...prev, m]);
  }, []);

  const clearHistory = useCallback(() => setHistory([]), []);
  const replaceHistory = useCallback((messages: OracleMessage[]) => setHistory(messages), []);

  const value = useMemo<OracleContextValue>(() => ({
    pageContext, setOracleContext, setPageMeta,
    history, appendMessage, clearHistory, replaceHistory,
    isWidgetOpen, setWidgetOpen,
    isWidgetExpanded, setWidgetExpanded,
  }), [pageContext, setOracleContext, setPageMeta, history, appendMessage, clearHistory, replaceHistory, isWidgetOpen, isWidgetExpanded]);

  return <OracleContext.Provider value={value}>{children}</OracleContext.Provider>;
}

export function useOracleContextValue(): OracleContextValue {
  const ctx = useContext(OracleContext);
  if (!ctx) throw new Error("useOracleContextValue harus dipakai di dalam OracleContextProvider");
  return ctx;
}
