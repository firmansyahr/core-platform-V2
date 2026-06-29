"use client";

import { useEffect, useState, useCallback } from "react";
import { AlertTriangle, Info, Zap, RefreshCw, X, ArrowRight, Loader2 } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface ActionItem {
  id: string;
  source: string;
  severity: "kritis" | "penting" | "info";
  title: string;
  description: string;
  action_label: string;
  action_url: string;
  meta: Record<string, unknown>;
  created_at: string;
}

interface ActionMeta {
  total: number;
  kritis: number;
  penting: number;
  info: number;
  generated_at: string;
}

const SEV_CONFIG = {
  kritis: {
    label: "Kritis",
    border: "border-l-red-500",
    badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    icon: AlertTriangle,
    iconCls: "text-red-500",
    header: "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/40",
    headerText: "text-red-800 dark:text-red-300",
  },
  penting: {
    label: "Penting",
    border: "border-l-amber-500",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    icon: Zap,
    iconCls: "text-amber-500",
    header: "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/40",
    headerText: "text-amber-800 dark:text-amber-300",
  },
  info: {
    label: "Info",
    border: "border-l-blue-400",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    icon: Info,
    iconCls: "text-blue-400",
    header: "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/40",
    headerText: "text-blue-800 dark:text-blue-300",
  },
};

const SOURCE_EMOJI: Record<string, string> = {
  "AEGIS": "⚠️",
  "Loyalty": "🏆",
  "Competitor Intelligence": "🎯",
  "Cannibalization Detector": "🔬",
};

export default function ActionCenterPage() {
  const [items, setItems]     = useState<ActionItem[]>([]);
  const [meta, setMeta]       = useState<ActionMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dismissing, setDismissing] = useState<Set<string>>(new Set());

  const fetchItems = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const url = refresh
        ? `${API}/api/action-center/refresh`
        : `${API}/api/action-center/items`;
      const method = refresh ? "POST" : "GET";
      const r = await fetch(url, { method, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setItems(d.data ?? []);
      setMeta(d.meta ?? null);
      // Invalidate navbar badge cache
      sessionStorage.removeItem("ac-kritis-count");
      sessionStorage.removeItem("ac-kritis-ts");
    } catch {
      // keep existing state
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const handleDismiss = async (id: string) => {
    setDismissing(prev => new Set(prev).add(id));
    try {
      await fetch(`${API}/api/action-center/dismiss/${encodeURIComponent(id)}`, {
        method: "POST",
      });
      setItems(prev => prev.filter(i => i.id !== id));
      setMeta(prev => prev ? { ...prev, total: prev.total - 1 } : prev);
      sessionStorage.removeItem("ac-kritis-count");
    } catch {
      // ignore
    } finally {
      setDismissing(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  };

  const grouped = (["kritis", "penting", "info"] as const).map(sev => ({
    sev,
    items: items.filter(i => i.severity === sev),
  })).filter(g => g.items.length > 0);

  return (
    <main className="min-h-screen bg-background pt-20 pb-16">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground tracking-tight">Action Center</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Rekomendasi aksi terpusat dari seluruh modul CORE Platform
            </p>
          </div>
          <button
            onClick={() => fetchItems(true)}
            disabled={refreshing || loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-border
              text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors duration-150
              disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {/* Summary counts */}
        {meta && !loading && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            {(["kritis", "penting", "info"] as const).map(sev => {
              const cfg = SEV_CONFIG[sev];
              const count = meta[sev];
              return (
                <div
                  key={sev}
                  className={`rounded-xl border px-4 py-3 ${cfg.header}`}
                >
                  <p className={`text-2xl font-bold ${cfg.headerText}`}>{count}</p>
                  <p className={`text-xs font-medium mt-0.5 ${cfg.headerText} opacity-80`}>{cfg.label}</p>
                </div>
              );
            })}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
            <Loader2 size={28} className="animate-spin" />
            <p className="text-sm">Mengumpulkan data dari semua modul…</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && items.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-green-100 dark:bg-green-900/20 flex items-center justify-center text-3xl">
              ✅
            </div>
            <div>
              <p className="font-semibold text-foreground">Tidak ada aksi yang perlu dilakukan</p>
              <p className="text-sm text-muted-foreground mt-1">
                Semua modul CORE dalam kondisi normal. Cek kembali secara berkala.
              </p>
            </div>
          </div>
        )}

        {/* Action groups */}
        {!loading && grouped.map(({ sev, items: sevItems }) => {
          const cfg = SEV_CONFIG[sev];
          const Icon = cfg.icon;
          return (
            <div key={sev} className="mb-6">
              {/* Group header */}
              <div className={`flex items-center gap-2 px-3 py-2 rounded-t-lg border-x border-t ${cfg.header} mb-0`}>
                <Icon size={14} className={cfg.iconCls} />
                <span className={`text-xs font-semibold uppercase tracking-wider ${cfg.headerText}`}>
                  {cfg.label}
                </span>
                <span className={`ml-auto text-xs font-bold px-1.5 py-0.5 rounded-full ${cfg.badge}`}>
                  {sevItems.length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex flex-col divide-y divide-border border border-t-0 rounded-b-lg overflow-hidden">
                {sevItems.map(item => (
                  <div
                    key={item.id}
                    className={`relative flex items-start gap-3 px-4 py-3.5 bg-card border-l-4 ${cfg.border}
                      hover:bg-muted/30 transition-colors duration-100 group`}
                  >
                    {/* Source + content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="text-[11px] text-muted-foreground font-medium">
                          {SOURCE_EMOJI[item.source] ?? "📌"} {item.source}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-foreground leading-snug">{item.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">
                        {item.description}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                      <a
                        href={item.action_url}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium
                          transition-colors duration-100 ${cfg.badge} hover:opacity-80`}
                      >
                        {item.action_label}
                        <ArrowRight size={11} />
                      </a>
                      <button
                        onClick={() => handleDismiss(item.id)}
                        disabled={dismissing.has(item.id)}
                        title="Tutup"
                        className="w-6 h-6 rounded-md flex items-center justify-center
                          text-muted-foreground hover:text-foreground hover:bg-muted
                          transition-colors duration-100 disabled:opacity-50"
                      >
                        {dismissing.has(item.id)
                          ? <Loader2 size={12} className="animate-spin" />
                          : <X size={12} />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* Footer note */}
        {meta && !loading && (
          <p className="text-center text-xs text-muted-foreground mt-2">
            {meta.total} item · Data dikumpulkan pada{" "}
            {new Date(meta.generated_at).toLocaleString("id-ID", {
              day: "numeric", month: "short", year: "numeric",
              hour: "2-digit", minute: "2-digit",
            })}
          </p>
        )}
      </div>
    </main>
  );
}
