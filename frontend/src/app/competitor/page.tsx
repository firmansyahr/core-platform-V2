"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback, useRef } from "react";
import Navbar from "@/components/Navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, RefreshCw } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getToken } from "@/lib/auth";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend,
} from "recharts";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TriRow {
  provinsi:                 string;
  aegis_warning_pct:        number;
  aegis_merah_count:        number;
  avg_fbsi_pct:             number;
  share_provinsi_trend:     number | null;
  share_provinsi_trend_label: string | null;
  share_provinsi_periode:   string | null;
  share_provinsi_pct_latest: number | null;
  own_brand_ms_pct:         number | null;
  top_competitor: {
    brand:          string;
    ms_current_pct: number;
    ms_change_pp:   number;
    trend:          string;
  } | null;
  brand_changes: { brand: string; ms_current_pct: number; ms_change_pp: number; trend: string }[];
  ms_brand_periode: string | null;
  verdict:          string;
  insight:          string;
  data_completeness: string;
  catatan_data:      string;
}

interface RankRow {
  brand:          string;
  avg_ms_pct:     number;
  avg_trend_pp:   number;
  trend_label:    string;
  provinsi_hadir: string[];
  provinsi_count: number;
  data_points:    number;
  catatan:        string;
}

interface CADRow {
  brand:               string;
  kejadian_cad:        number;
  provinsi_list:       string[];
  kabupaten_count:     number;
  toko_terdampak:      number;
  avg_gap_harga_per_zak: number | null;
  metode_dominan:      string | null;
}

interface Overview {
  coverage: {
    share_provinsi:    { periode_tersedia: string[]; provinsi_count: number; last_updated: string | null };
    marketshare_brand: { periode_tersedia: string[]; brands_tracked: string[]; provinsi_count: number; last_updated: string | null };
    catatan:           string[];
  };
  triangulation_summary: {
    konfirmasi_kompetitor: number;
    waspada_awal:          number;
    internal_seasonal:     number;
    tidak_cukup_data:      number;
    normal:                number;
  };
  top_threats:               TriRow[];
  competitor_ranking_asperssi: RankRow[];
  competitor_ranking_cad:      CADRow[];
  data_disclaimer:             string[];
}

// ─── Style helpers ────────────────────────────────────────────────────────────

const VERDICT_CFG: Record<string, { label: string; cls: string; dot: string }> = {
  KONFIRMASI_KOMPETITOR: {
    label: "Terkonfirmasi",
    cls:   "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-400 dark:border-red-700/40",
    dot:   "bg-red-500",
  },
  WASPADA_AWAL: {
    label: "Pantau",
    cls:   "bg-yellow-50 text-yellow-700 border-yellow-300 dark:bg-yellow-950/30 dark:text-yellow-500 dark:border-yellow-600/40",
    dot:   "bg-yellow-400",
  },
  INTERNAL_ATAU_SEASONAL: {
    label: "Bukan Kompetitor",
    cls:   "bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-700/40",
    dot:   "bg-blue-400",
  },
  TIDAK_CUKUP_DATA: {
    label: "Data Kurang",
    cls:   "bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600",
    dot:   "bg-gray-400",
  },
  NORMAL: {
    label: "Normal",
    cls:   "bg-green-50 text-green-700 border-green-300 dark:bg-green-950/30 dark:text-green-400 dark:border-green-700/40",
    dot:   "bg-green-500",
  },
};

const COMPLETENESS_CLS: Record<string, string> = {
  "Lengkap":    "bg-green-50 text-green-700 border-green-300 dark:bg-green-950/30 dark:text-green-400",
  "Parsial":    "bg-yellow-50 text-yellow-700 border-yellow-300 dark:bg-yellow-950/30 dark:text-yellow-500",
  "Tidak Ada":  "bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400",
};

const TREND_CLS: Record<string, string> = {
  "Naik":   "text-red-600 dark:text-red-400",
  "Turun":  "text-green-600 dark:text-green-400",
  "Stabil": "text-muted-foreground",
};

const BAR_COLORS = ["#DC2626", "#EA580C", "#CA8A04", "#6b7280", "#3b82f6"];

// ─── Small components ─────────────────────────────────────────────────────────

function VerdictBadge({ v }: { v: string }) {
  const cfg = VERDICT_CFG[v] ?? VERDICT_CFG.TIDAK_CUKUP_DATA;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded border ${cfg.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function KpiCard({
  label, value, sub, color,
}: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
        <p className="text-3xl font-bold leading-none mt-1" style={{ color }}>{value}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ─── Expanded row ─────────────────────────────────────────────────────────────

function ExpandedRow({ row }: { row: TriRow }) {
  const brandData = row.brand_changes.map((b, i) => ({
    name:     b.brand.replace("Brand Kompetitor ", "Komp. "),
    ms:       b.ms_current_pct,
    trend_pp: b.ms_change_pp,
    fill:     BAR_COLORS[i % BAR_COLORS.length],
  }));

  return (
    <div className="bg-muted/20 border-t border-border px-4 py-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* MS Brand chart */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Market Share per Brand — ASPERSSI {row.ms_brand_periode ?? "—"}
        </p>
        {brandData.length > 0 ? (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={brandData} layout="vertical" margin={{ left: 4, right: 4, top: 2, bottom: 2 }}>
              <XAxis type="number" domain={[0, 50]} tick={{ fontSize: 9 }} tickLine={false} unit="%" />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} tickLine={false} width={90} />
              <Tooltip
                formatter={(val) => [`${Number(val).toFixed(1)}%`, "Market Share"]}
                contentStyle={{ fontSize: 11, borderRadius: 8 }}
              />
              <Bar dataKey="ms" radius={[0, 3, 3, 0]}>
                {brandData.map((d, i) => <Cell key={i} fill={d.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-xs text-muted-foreground italic py-4">Data ASPERSSI tidak tersedia untuk provinsi ini</p>
        )}
        <p className="text-[9px] text-muted-foreground italic">Data dalam % — tidak merepresentasikan volume absolut</p>
      </div>

      {/* Tren kompetitor */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Perubahan Market Share (pp)</p>
        {brandData.length > 0 ? (
          <div className="space-y-1.5">
            {row.brand_changes.map((b) => (
              <div key={b.brand} className="flex items-center justify-between text-xs py-1 border-b border-border/50">
                <span className="truncate max-w-[140px]" title={b.brand}>{b.brand}</span>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums font-medium text-muted-foreground">{b.ms_current_pct.toFixed(1)}%</span>
                  <span className={`font-semibold tabular-nums ${TREND_CLS[b.trend]}`}>
                    {b.ms_change_pp > 0 ? "+" : ""}{b.ms_change_pp.toFixed(1)}pp
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic py-4">Tidak ada data perubahan MS untuk periode ini</p>
        )}
      </div>

      {/* Insight */}
      <div className="space-y-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Analisis Triangulasi</p>
        <div className="rounded-lg bg-background border border-border p-3 text-xs leading-relaxed text-muted-foreground">
          {row.insight}
        </div>
        {row.catatan_data && (
          <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200/70 dark:border-yellow-800/40 p-2.5">
            <p className="text-[10px] text-yellow-700 dark:text-yellow-400 leading-snug">
              ⚠ {row.catatan_data}
            </p>
          </div>
        )}
        <div className="rounded-lg bg-muted/40 p-2.5 space-y-1">
          <div className="flex justify-between text-[10px]">
            <span className="text-muted-foreground">AEGIS Warning</span>
            <span className="font-semibold">{row.aegis_warning_pct}%</span>
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-muted-foreground">Toko Merah</span>
            <span className="font-semibold text-red-600 dark:text-red-400">{row.aegis_merah_count}</span>
          </div>
          {row.own_brand_ms_pct !== null && (
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground">MS Semen Elang</span>
              <span className="font-semibold">{row.own_brand_ms_pct.toFixed(1)}%</span>
            </div>
          )}
          {row.share_provinsi_pct_latest !== null && (
            <div className="flex justify-between text-[10px]">
              <span className="text-muted-foreground">Share Provinsi</span>
              <span className="font-semibold">{row.share_provinsi_pct_latest.toFixed(1)}%</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Upload section ───────────────────────────────────────────────────────────

function UploadSection({
  title,
  endpoint,
  templateEndpoint,
  columns,
  periode,
}: {
  title: string;
  endpoint: string;
  templateEndpoint: string;
  columns: string[];
  periode: string;
}) {
  const fileRef                     = useRef<HTMLInputElement>(null);
  const [uploading, setUploading]   = useState(false);
  const [result,    setResult]      = useState<{ success: boolean; msg: string } | null>(null);
  const [dragging,  setDragging]    = useState(false);

  const doUpload = async (file: File) => {
    if (!file.name.match(/\.(xlsx|xls)$/)) {
      setResult({ success: false, msg: "File harus berformat .xlsx atau .xls" });
      return;
    }
    setUploading(true);
    setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const token = getToken();
      const res = await fetch(`${API}${endpoint}`, {
        method:  "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body:    fd,
      });
      const data = await res.json();
      if (res.ok) {
        const d = data.data;
        setResult({ success: true, msg: `✓ ${d.baris_diproses} baris diproses, ${d.periode_baru?.length ?? 0} periode baru ditambahkan.` });
      } else {
        setResult({ success: false, msg: data.detail ?? "Upload gagal" });
      }
    } catch {
      setResult({ success: false, msg: "Koneksi gagal" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="border-b border-border pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm">{title}</CardTitle>
            <p className="text-[11px] text-muted-foreground mt-0.5">Periode tersedia: {periode}</p>
          </div>
          <a
            href={`${API}${templateEndpoint}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors"
          >
            ↓ Template
          </a>
        </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-3">
        {/* Column preview */}
        <div className="rounded-lg bg-muted/40 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Kolom yang diharapkan</p>
          <div className="flex flex-wrap gap-1.5">
            {columns.map((c) => (
              <span key={c} className="px-2 py-0.5 text-[10px] font-mono bg-background border border-border rounded">
                {c}
              </span>
            ))}
          </div>
        </div>

        {/* Validation rules */}
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <p>• Nilai persen: angka 0–100, tidak perlu simbol %</p>
          <p>• Nama provinsi harus konsisten: <span className="font-mono">JAWA TIMUR</span> (huruf kapital)</p>
          <p>• Format periode: <span className="font-mono">YYYY-MM</span> misal <span className="font-mono">2026-03</span></p>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) doUpload(file);
          }}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
            dragging ? "border-foreground bg-muted/60" : "border-border hover:border-foreground/40 hover:bg-muted/30"
          }`}
        >
          <p className="text-sm font-medium text-muted-foreground">
            {uploading ? "Mengupload…" : "Klik atau drag & drop file Excel di sini"}
          </p>
          <p className="text-[11px] text-muted-foreground/60 mt-1">.xlsx / .xls</p>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) doUpload(f); }}
          />
        </div>

        {result && (
          <p className={`text-xs ${result.success ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
            {result.msg}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CompetitorPage() {
  const { isAdmin } = useAuth();

  const [overview,  setOverview]  = useState<Overview | null>(null);
  const [triList,   setTriList]   = useState<TriRow[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [triLoading,setTL]        = useState(false);
  const [activeTab, setActiveTab] = useState<"tri" | "rank" | "upload">("tri");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [insight, setInsight] = useState<{ status: string; narasi: string | null; generated_at?: string; cached?: boolean } | null>(null);
  const [insightLoading, setInsightLoading] = useState(true);

  const fetchOverview = useCallback(() => {
    setLoading(true);
    fetch(`${API}/api/competitor/overview`)
      .then((r) => r.json())
      .then((r) => setOverview(r.data ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const fetchTriangulation = useCallback(() => {
    setTL(true);
    fetch(`${API}/api/competitor/triangulation`)
      .then((r) => r.json())
      .then((r) => setTriList(r.data ?? []))
      .catch(() => {})
      .finally(() => setTL(false));
  }, []);

  const fetchInsight = useCallback(() => {
    setInsightLoading(true);
    fetch(`${API}/api/competitor/insight`)
      .then((r) => r.json())
      .then((r) => setInsight(r.data ?? null))
      .catch(() => {})
      .finally(() => setInsightLoading(false));
  }, []);

  useEffect(() => {
    fetchOverview();
    fetchTriangulation();
    fetchInsight();
  }, [fetchOverview, fetchTriangulation, fetchInsight]);

  const summary = overview?.triangulation_summary;
  const cov     = overview?.coverage;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16 max-w-7xl mx-auto px-6 py-8 space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs text-muted-foreground mb-1">
              <a href="/" className="hover:text-foreground transition-colors">Home</a>
              <span className="mx-1">/</span>
              <span>Competitor Intelligence</span>
            </p>
            <h1 className="text-2xl font-bold tracking-tight">Competitor Intelligence</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Triangulasi sinyal AEGIS internal dengan data pasar ASPERSSI
            </p>
          </div>
        </div>

        {/* Data Coverage Banner */}
        <div className="rounded-xl border border-yellow-300/70 dark:border-yellow-700/40 bg-yellow-50/60 dark:bg-yellow-950/20 p-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-2 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-yellow-600 dark:text-yellow-400 text-sm">ⓘ</span>
                <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-300">Data ASPERSSI tersedia:</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-5">
                <div className="text-xs text-yellow-700 dark:text-yellow-400">
                  <span className="font-medium">Share Provinsi:</span>{" "}
                  {cov?.share_provinsi.periode_tersedia.join(", ") ?? "Mar–Apr 2026"}{" "}
                  <span className="font-bold">(dalam %)</span>
                </div>
                <div className="text-xs text-yellow-700 dark:text-yellow-400">
                  <span className="font-medium">Market Share Brand:</span>{" "}
                  {cov?.marketshare_brand.periode_tersedia.join(", ") ?? "Des 2025–Jan 2026"}{" "}
                  <span className="font-bold">(dalam %)</span>
                </div>
              </div>
              <p className="text-[11px] text-yellow-600 dark:text-yellow-500 pl-5">
                Catatan: kedua dataset dari periode berbeda.
                Interpretasi <strong>tren arah</strong>, bukan nilai absolut.
              </p>
            </div>
            {isAdmin && (
              <button
                onClick={() => setActiveTab("upload")}
                className="shrink-0 px-3 py-1.5 text-xs font-medium border border-yellow-400 dark:border-yellow-600 text-yellow-700 dark:text-yellow-400 rounded-lg hover:bg-yellow-100 dark:hover:bg-yellow-950/40 transition-colors"
              >
                Upload Data Baru
              </button>
            )}
          </div>
        </div>

        {/* AI Insight */}
        {insightLoading ? (
          <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-3">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 w-56 rounded" />
              </div>
              <Skeleton className="h-4 w-full rounded mb-2" />
              <Skeleton className="h-4 w-4/5 rounded mb-2" />
              <Skeleton className="h-4 w-3/4 rounded" />
            </CardContent>
          </Card>
        ) : insight && insight.status !== "disabled" ? (
          <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
                  <Sparkles className="h-4 w-4 shrink-0" />
                  <span className="text-xs font-semibold uppercase tracking-wider">
                    AI Insight — Competitor Intelligence
                  </span>
                  {insight.cached && (
                    <span className="text-[10px] text-blue-500 dark:text-blue-500 font-normal">(cached)</span>
                  )}
                </div>
                <button
                  onClick={fetchInsight}
                  className="shrink-0 p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                  title="Refresh insight"
                >
                  <RefreshCw className="h-3.5 w-3.5 text-blue-500" />
                </button>
              </div>
              {insight.status === "ok" ? (
                <p className="text-sm text-blue-900 dark:text-blue-200 leading-relaxed mt-3">
                  {insight.narasi}
                </p>
              ) : (
                <p className="text-sm text-blue-700 dark:text-blue-400 mt-3 italic">
                  Gagal menghasilkan insight. Coba refresh kembali.
                </p>
              )}
              {insight.generated_at && (
                <p className="text-[10px] text-blue-500 dark:text-blue-500 mt-2">
                  Dibuat: {new Date(insight.generated_at).toLocaleString("id-ID")}
                </p>
              )}
            </CardContent>
          </Card>
        ) : null}

        {/* KPI cards */}
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Konfirmasi Kompetitor"
              value={summary?.konfirmasi_kompetitor ?? 0}
              sub="provinsi terkonfirmasi"
              color="#DC2626"
            />
            <KpiCard
              label="Waspada Awal"
              value={summary?.waspada_awal ?? 0}
              sub="perlu pemantauan"
              color="#CA8A04"
            />
            <KpiCard
              label="Internal / Seasonal"
              value={summary?.internal_seasonal ?? 0}
              sub="bukan tekanan kompetitor"
              color="#3b82f6"
            />
            <KpiCard
              label="Data Tidak Cukup"
              value={summary?.tidak_cukup_data ?? 0}
              sub="butuh validasi lapangan"
              color="#6b7280"
            />
          </div>
        )}

        {/* Disclaimer */}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {(overview?.data_disclaimer ?? []).map((d, i) => (
            <p key={i} className="text-[10px] text-muted-foreground/70 flex items-center gap-1">
              <span>•</span> {d}
            </p>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-border pb-0">
          {[
            { id: "tri",    label: "Triangulasi per Wilayah" },
            { id: "rank",   label: "Ranking Kompetitor" },
            ...(isAdmin ? [{ id: "upload", label: "Upload & Kelola Data" }] : []),
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as typeof activeTab)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors -mb-px ${
                activeTab === id
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── TAB 1: Triangulasi ────────────────────────────────────────────── */}
        {activeTab === "tri" && (
          <Card>
            <CardHeader className="border-b border-border pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                Triangulasi per Provinsi
                {!triLoading && (
                  <span className="ml-auto text-xs font-normal text-muted-foreground">
                    {triList.length} provinsi
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 px-0">
              {triLoading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 rounded" />)}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-3 text-left font-semibold">Provinsi</th>
                        <th className="px-4 py-3 text-right font-semibold">AEGIS Warning%</th>
                        <th className="px-4 py-3 text-left font-semibold">Top Kompetitor</th>
                        <th className="px-4 py-3 text-right font-semibold">MS Change (pp)</th>
                        <th className="px-4 py-3 text-left font-semibold">Verdict</th>
                        <th className="px-4 py-3 text-left font-semibold">Data</th>
                        <th className="px-4 py-3 text-right font-semibold pr-4">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {triList.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground text-sm">
                            Data tidak tersedia — pastikan backend AEGIS aktif.
                          </td>
                        </tr>
                      ) : triList.map((row) => (
                        <>
                          <tr
                            key={row.provinsi}
                            className="border-b border-muted/50 hover:bg-muted/20 transition-colors"
                          >
                            <td className="px-4 py-3 font-medium">
                              {row.provinsi.replace(/^PROVINSI /, "")}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              <span className={`font-semibold ${
                                row.aegis_warning_pct >= 25 ? "text-red-600 dark:text-red-400" :
                                row.aegis_warning_pct >= 15 ? "text-amber-600 dark:text-amber-400" :
                                "text-muted-foreground"
                              }`}>
                                {row.aegis_warning_pct.toFixed(1)}%
                              </span>
                            </td>
                            <td className="px-4 py-3 max-w-[180px]">
                              {row.top_competitor ? (
                                <span className="text-xs truncate block" title={row.top_competitor.brand}>
                                  {row.top_competitor.brand}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/50 text-xs">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              {row.top_competitor ? (
                                <span className={`text-xs font-semibold ${TREND_CLS[row.top_competitor.trend]}`}>
                                  {row.top_competitor.ms_change_pp > 0 ? "+" : ""}
                                  {row.top_competitor.ms_change_pp.toFixed(1)}pp
                                </span>
                              ) : (
                                <span className="text-muted-foreground/50 text-xs">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <VerdictBadge v={row.verdict} />
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${
                                COMPLETENESS_CLS[row.data_completeness] ?? ""
                              }`}>
                                {row.data_completeness}
                              </span>
                            </td>
                            <td className="px-4 py-3 pr-4 text-right">
                              <button
                                onClick={() => setExpandedRow(expandedRow === row.provinsi ? null : row.provinsi)}
                                className="text-xs px-2.5 py-1 rounded border border-border hover:bg-muted transition-colors"
                              >
                                {expandedRow === row.provinsi ? "Tutup" : "Detail"}
                              </button>
                            </td>
                          </tr>
                          {expandedRow === row.provinsi && (
                            <tr key={`${row.provinsi}-expanded`}>
                              <td colSpan={7} className="p-0">
                                <ExpandedRow row={row} />
                              </td>
                            </tr>
                          )}
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── TAB 2: Ranking ───────────────────────────────────────────────── */}
        {activeTab === "rank" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* ASPERSSI ranking */}
            <Card>
              <CardHeader className="border-b border-border pb-3">
                <CardTitle className="text-sm">Berdasarkan Data ASPERSSI (Resmi)</CardTitle>
                <p className="text-[11px] text-muted-foreground">
                  Data {cov?.marketshare_brand.periode_tersedia.join(" – ") ?? "Des 2025 – Jan 2026"} ({cov?.marketshare_brand.periode_tersedia.length ?? 2} periode)
                </p>
              </CardHeader>
              <CardContent className="pt-3 space-y-2">
                <div className="rounded-lg border border-yellow-300/60 dark:border-yellow-700/30 bg-yellow-50/50 dark:bg-yellow-950/20 px-3 py-2">
                  <p className="text-[10px] text-yellow-700 dark:text-yellow-400">
                    ⚠ Tren dihitung dari 2 titik saja — interpretasi hati-hati
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="py-2 text-left font-semibold">Brand</th>
                        <th className="py-2 text-right font-semibold">Avg MS%</th>
                        <th className="py-2 text-right font-semibold">Tren (pp)</th>
                        <th className="py-2 text-right font-semibold">Provinsi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {(overview?.competitor_ranking_asperssi ?? []).map((r, i) => (
                        <tr key={r.brand} className="hover:bg-muted/20">
                          <td className="py-2 font-medium flex items-center gap-1.5">
                            <span className="text-muted-foreground/50 text-[9px] w-4">{i + 1}</span>
                            {r.brand}
                          </td>
                          <td className="py-2 text-right tabular-nums font-semibold">{r.avg_ms_pct.toFixed(1)}%</td>
                          <td className="py-2 text-right">
                            <span className={`font-semibold tabular-nums ${TREND_CLS[r.trend_label]}`}>
                              {r.avg_trend_pp > 0 ? "+" : ""}{r.avg_trend_pp.toFixed(2)}pp
                            </span>
                          </td>
                          <td className="py-2 text-right text-muted-foreground">{r.provinsi_count}</td>
                        </tr>
                      ))}
                      {!overview?.competitor_ranking_asperssi?.length && (
                        <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">Tidak ada data</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* CAD / TSO ranking */}
            <Card>
              <CardHeader className="border-b border-border pb-3">
                <CardTitle className="text-sm">Berdasarkan Laporan TSO (Lapangan)</CardTitle>
                <p className="text-[11px] text-muted-foreground">Dari hasil validasi CAD Alert oleh TSO</p>
              </CardHeader>
              <CardContent className="pt-3 space-y-3">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="py-2 text-left font-semibold">Brand</th>
                        <th className="py-2 text-right font-semibold">Frekuensi</th>
                        <th className="py-2 text-right font-semibold">Toko</th>
                        <th className="py-2 text-right font-semibold">Gap Harga</th>
                        <th className="py-2 text-left font-semibold">Metode</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {(overview?.competitor_ranking_cad ?? []).map((r, i) => (
                        <tr key={r.brand} className="hover:bg-muted/20">
                          <td className="py-2 font-medium flex items-center gap-1.5">
                            <span className="text-muted-foreground/50 text-[9px] w-4">{i + 1}</span>
                            <span className="truncate max-w-[120px]" title={r.brand}>{r.brand}</span>
                          </td>
                          <td className="py-2 text-right tabular-nums font-semibold">{r.kejadian_cad}x</td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">{r.toko_terdampak}</td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">
                            {r.avg_gap_harga_per_zak != null
                              ? `Rp ${new Intl.NumberFormat("id-ID").format(r.avg_gap_harga_per_zak)}`
                              : "—"}
                          </td>
                          <td className="py-2 text-muted-foreground max-w-[100px] truncate" title={r.metode_dominan ?? ""}>
                            {r.metode_dominan ?? "—"}
                          </td>
                        </tr>
                      ))}
                      {!overview?.competitor_ranking_cad?.length && (
                        <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">Belum ada data CAD kompetitor</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-muted-foreground/70 italic leading-relaxed">
                  Data subjektif dari laporan TSO — bukan data resmi pasar.
                  Brand yang muncul di sini belum tentu ada di data ASPERSSI
                  (bisa distributor tidak resmi atau brand lokal).
                </p>
              </CardContent>
            </Card>

            {/* Discrepancy insight */}
            {(overview?.competitor_ranking_cad?.length ?? 0) > 0 &&
             (overview?.competitor_ranking_asperssi?.length ?? 0) > 0 && (() => {
              const asperssiNames = new Set(
                (overview?.competitor_ranking_asperssi ?? []).map((r) => r.brand.toLowerCase())
              );
              const cadOnly = (overview?.competitor_ranking_cad ?? []).filter(
                (r) => !asperssiNames.has(r.brand.toLowerCase())
              );
              if (!cadOnly.length) return null;
              return (
                <Card className="border-amber-300/60 dark:border-amber-700/40 bg-amber-50/50 dark:bg-amber-950/20 col-span-full">
                  <CardContent className="pt-3 pb-3">
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-2">
                      Brand muncul di laporan TSO tapi tidak ada di ASPERSSI
                    </p>
                    {cadOnly.map((r) => (
                      <p key={r.brand} className="text-[11px] text-amber-700 dark:text-amber-400">
                        <span className="font-semibold">{r.brand}</span> muncul {r.kejadian_cad}x di laporan TSO →
                        Kemungkinan distributor tidak resmi atau brand regional yang belum terdata ASPERSSI
                      </p>
                    ))}
                  </CardContent>
                </Card>
              );
            })()}
          </div>
        )}

        {/* ── TAB 3: Upload (admin only) ────────────────────────────────────── */}
        {activeTab === "upload" && isAdmin && (
          <div className="space-y-5">
            <UploadSection
              title="Upload Share Provinsi"
              endpoint="/api/competitor/asperssi/upload-share-provinsi"
              templateEndpoint="/api/competitor/asperssi/template/share-provinsi"
              periode={cov?.share_provinsi.periode_tersedia.join(", ") ?? "—"}
              columns={["Provinsi", "Periode (YYYY-MM)", "Share Nasional (%)"]}
            />
            <UploadSection
              title="Upload Market Share Brand"
              endpoint="/api/competitor/asperssi/upload-marketshare"
              templateEndpoint="/api/competitor/asperssi/template/marketshare"
              periode={cov?.marketshare_brand.periode_tersedia.join(", ") ?? "—"}
              columns={["Provinsi", "Periode (YYYY-MM)", "Nama Brand", "Market Share (%)", "Brand Sendiri (Y/N)"]}
            />
          </div>
        )}

        <p className="text-center text-[11px] text-muted-foreground pb-4">
          CORE Platform v2 · Competitor Intelligence · Data ASPERSSI dalam persentase
        </p>
      </main>
    </div>
  );
}
