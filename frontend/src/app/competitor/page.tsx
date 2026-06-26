"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
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

interface GmmCrossCheck {
  category_distribution:  Record<string, number>;
  kanibalisasi_pct:        number;
  eksternal_pct:           number;
  total_toko_dianalisis:   number;
  catatan:                 string | null;
  gmm_tersedia:            boolean;
}

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
  aggregate_others_pct:   number | null;
  aggregate_others_trend: string | null;
  ms_brand_periode: string | null;
  verdict:          string;
  insight:          string;
  data_completeness: string;
  catatan_data:      string;
  gmm_cross_check?: GmmCrossCheck;
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

interface AggregateOthers {
  label:          string;
  avg_ms_pct:     number;
  avg_trend_pp:   number;
  trend_label:    string;
  provinsi_count: number;
  is_aggregate:   boolean;
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
  competitor_ranking_cad: CADRow[];
  data_disclaimer:        string[];
}

interface MsRow {
  row_id:               string;
  provinsi:             string;
  periode:              string;
  nama_brand:           string;
  market_share_pct:     number;
  is_own_brand:         boolean;
  is_aggregate_others:  boolean;
}

interface SpRow {
  row_id:             string;
  provinsi:           string;
  periode:            string;
  share_nasional_pct: number;
}

interface CpiRow {
  id_toko: string; nama_toko: string | null; kabupaten: string | null; provinsi: string | null;
  cpi_score: number; cpi_label: string;
  score_fbsi: number; score_volume_trend: number; score_he: number; score_crs: number;
  fbsi_latest: number | null; delta_fbsi: number | null; elang_vol_pct: number | null;
  alert_level: string | null; periode: string;
}
interface CpiSummary {
  periode: string; total_stores: number; avg_cpi: number;
  by_label: Record<string, number>; critical_stores: CpiRow[]; high_stores: CpiRow[];
}
interface WlRow {
  id_toko: string; nama_toko: string | null; kabupaten: string | null;
  outcome: string; outcome_detail: string | null; primary_factor: string | null;
  elang_vol_pct: number | null; banteng_fbsi_delta: number | null; periode: string;
}
interface WlSummary {
  periode: string; total: number; by_outcome: Record<string, number>; win_rate_pct: number;
  top_wins: WlRow[]; top_losses: WlRow[];
}
interface EwaAlert {
  id: string; scope: string; scope_id: string; scope_name: string | null; provinsi: string | null;
  alert_type: string; severity: string; title: string; description: string | null;
  metric_value: number | null; metric_threshold: number | null; metric_label: string | null;
  is_active: number; triggered_at: string;
}
interface EwaSummary { total_active: number; by_severity: Record<string, number>; alerts: EwaAlert[]; }
interface CsrResult {
  id: string; scope_id: string; provinsi: string | null;
  strategy_type: string; priority: string; trigger_cpi_avg: number | null;
  trigger_primary_threat: string | null; n_stores_critical: number; n_stores_loss: number;
  recommended_actions: string[] | null; ilp_suggestion: string | null; periode: string;
}
interface CsrSummary {
  periode: string | null; total_areas: number;
  by_strategy: Record<string, number>; by_priority: Record<string, number>;
  urgent_areas: CsrResult[];
}
interface ForecastSummary {
  available: boolean;
  meta: { generated_at: string | null; model: string | null; horizon_months: number; areas_forecast: number; };
  total_kabupaten?: number; total_provinsi?: number;
  by_trend_label?: Record<string, number>;
  threat_count?: number; at_risk_count?: number; expansion_count?: number;
}
interface ForecastAtRisk { area: string; provinsi: string | null; scope: string; trend_elang: string; current_elang_pct: number; forecast_end_elang_pct: number; }
interface ForecastExpansion { area: string; provinsi: string | null; scope: string; current_elang_pct: number; forecast_end_elang_pct: number; }

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
        {(row.aggregate_others_pct ?? 0) > 5 && (
          <div className="rounded-lg bg-gray-50 dark:bg-gray-900/30 border border-gray-200 dark:border-gray-700/40 p-2.5">
            <p className="text-[10px] text-gray-600 dark:text-gray-400 leading-snug">
              ℹ Selain kompetitor teridentifikasi, terdapat{" "}
              <strong>{row.aggregate_others_pct?.toFixed(1)}%</strong> market share dari brand
              kecil/lokal yang tidak teridentifikasi secara individual
              {row.aggregate_others_trend ? ` (${row.aggregate_others_trend})` : ""}.
            </p>
          </div>
        )}
        {row.gmm_cross_check?.gmm_tersedia && (
          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Cross-Check Analisis Brand-Shift (GMM)
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs mb-2">
              <div>
                Kanibalisasi internal:{" "}
                <strong className="text-blue-600 dark:text-blue-400">
                  {row.gmm_cross_check.kanibalisasi_pct}%
                </strong>
              </div>
              <div>
                Tekanan eksternal:{" "}
                <strong className="text-red-600 dark:text-red-400">
                  {row.gmm_cross_check.eksternal_pct}%
                </strong>
              </div>
            </div>
            {row.gmm_cross_check.catatan && (
              <div className={`p-2 rounded text-[10px] leading-snug ${
                row.gmm_cross_check.catatan.startsWith("PERHATIAN")
                  ? "bg-yellow-50 dark:bg-yellow-950/20 text-yellow-700 dark:text-yellow-400 border border-yellow-200/60 dark:border-yellow-800/50"
                  : "bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 border border-green-200/60 dark:border-green-800/50"
              }`}>
                {row.gmm_cross_check.catatan}
              </div>
            )}
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

// ─── CRUD table constants ─────────────────────────────────────────────────────

const PAGE_SIZE = 15;

// ─── MsDataTable ─────────────────────────────────────────────────────────────

function MsDataTable({ onDataChanged }: { onDataChanged: () => void }) {
  const [rows,         setRows]         = useState<MsRow[]>([]);
  const [loadingTable, setLoadingTable] = useState(true);
  const [search,       setSearch]       = useState("");
  const [filterPeriode,setFilterPeriode]= useState("");
  const [page,         setPage]         = useState(1);
  const [editId,       setEditId]       = useState<string | null>(null);
  const [editVals,     setEditVals]     = useState({ market_share_pct: 0, is_own_brand: false });
  const [saving,       setSaving]       = useState(false);
  const [togglingId,   setTogglingId]   = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MsRow | null>(null);
  const [showAdd,      setShowAdd]      = useState(false);
  const [addForm,      setAddForm]      = useState({ provinsi: "", periode: "", nama_brand: "", market_share_pct: 0, is_own_brand: false, is_aggregate_others: false as boolean | null });
  const [addError,     setAddError]     = useState("");

  const fetchRows = useCallback(() => {
    setLoadingTable(true);
    fetch(`${API}/api/competitor/asperssi/marketshare/list`)
      .then(r => r.json()).then(r => { setRows(r.data ?? []); setPage(1); })
      .catch(() => {}).finally(() => setLoadingTable(false));
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const allPeriodes  = useMemo(() => Array.from(new Set(rows.map(r => r.periode))).sort(), [rows]);
  const allProvinsis = useMemo(() => Array.from(new Set(rows.map(r => r.provinsi))).sort(), [rows]);
  const allBrands    = useMemo(() => Array.from(new Set(rows.map(r => r.nama_brand))).sort(), [rows]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter(r =>
      (!search || r.provinsi.toLowerCase().includes(q) || r.nama_brand.toLowerCase().includes(q)) &&
      (!filterPeriode || r.periode === filterPeriode)
    );
  }, [rows, search, filterPeriode]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged      = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const hdrs = (tok: string | null) =>
    tok ? { "Authorization": `Bearer ${tok}`, "Content-Type": "application/json" } as HeadersInit
        : { "Content-Type": "application/json" } as HeadersInit;

  const saveEdit = async () => {
    if (!editId) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/competitor/asperssi/marketshare/${editId}`, {
        method: "PUT", headers: hdrs(getToken()), body: JSON.stringify(editVals),
      });
      if (res.ok) { setEditId(null); fetchRows(); onDataChanged(); }
    } finally { setSaving(false); }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const tok = getToken();
      const res = await fetch(`${API}/api/competitor/asperssi/marketshare/${deleteTarget.row_id}`, {
        method: "DELETE", headers: tok ? { "Authorization": `Bearer ${tok}` } as HeadersInit : {},
      });
      if (res.ok) { setDeleteTarget(null); fetchRows(); onDataChanged(); }
    } finally { setSaving(false); }
  };

  const toggleAggregate = async (rowId: string, val: boolean) => {
    setTogglingId(rowId);
    try {
      const res = await fetch(`${API}/api/competitor/asperssi/marketshare/${rowId}/toggle-aggregate`, {
        method: "PUT", headers: hdrs(getToken()),
        body: JSON.stringify({ is_aggregate_others: val }),
      });
      if (res.ok) { fetchRows(); onDataChanged(); }
    } finally { setTogglingId(null); }
  };

  const doAdd = async () => {
    setAddError("");
    const prov = addForm.provinsi.trim().toUpperCase();
    if (!prov || !addForm.periode || !addForm.nama_brand.trim()) {
      setAddError("Provinsi, Periode, dan Nama Brand wajib diisi"); return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/competitor/asperssi/marketshare/add-row`, {
        method: "POST", headers: hdrs(getToken()),
        body: JSON.stringify({ ...addForm, provinsi: prov, nama_brand: addForm.nama_brand.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowAdd(false);
        setAddForm({ provinsi: "", periode: "", nama_brand: "", market_share_pct: 0, is_own_brand: false, is_aggregate_others: null });
        fetchRows(); onDataChanged();
      } else { setAddError(data.detail ?? "Gagal menyimpan"); }
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          className="flex-1 min-w-44 px-3 py-1.5 text-sm border border-border rounded-lg bg-background"
          placeholder="Cari provinsi atau brand…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
        />
        <select
          className="px-3 py-1.5 text-sm border border-border rounded-lg bg-background"
          value={filterPeriode}
          onChange={e => { setFilterPeriode(e.target.value); setPage(1); }}
        >
          <option value="">Semua Periode</option>
          {allPeriodes.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button
          onClick={() => { setShowAdd(true); setAddError(""); }}
          className="px-3 py-1.5 text-xs font-medium bg-foreground text-background rounded-lg hover:opacity-80 transition-opacity shrink-0"
        >
          + Tambah Baris
        </button>
      </div>

      {/* Table */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2.5 text-left font-semibold">Provinsi</th>
                <th className="px-3 py-2.5 text-left font-semibold">Periode</th>
                <th className="px-3 py-2.5 text-left font-semibold">Brand</th>
                <th className="px-3 py-2.5 text-left font-semibold">Tipe</th>
                <th className="px-3 py-2.5 text-right font-semibold">Market Share %</th>
                <th className="px-3 py-2.5 text-center font-semibold">Sendiri</th>
                <th className="px-3 py-2.5 text-right font-semibold pr-3">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loadingTable ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-muted/50">
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-3 py-2.5"><Skeleton className="h-3.5 w-full rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : paged.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Tidak ada data{search || filterPeriode ? " sesuai filter" : ""}
                </td></tr>
              ) : paged.map(row => (
                <tr
                  key={row.row_id}
                  className={`border-b border-muted/50 transition-colors ${editId === row.row_id ? "bg-blue-50/30 dark:bg-blue-950/10" : "hover:bg-muted/20"}`}
                >
                  <td className="px-3 py-2.5 text-xs">{row.provinsi}</td>
                  <td className="px-3 py-2.5 text-xs font-mono">{row.periode}</td>
                  <td className="px-3 py-2.5 text-xs font-medium">
                    {row.nama_brand}
                    {row.is_own_brand && editId !== row.row_id && (
                      <span className="ml-1.5 text-[9px] bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded">Sendiri</span>
                    )}
                  </td>
                  {/* Tipe badge + toggle */}
                  <td className="px-3 py-2.5">
                    {row.is_own_brand ? (
                      <span className="text-[9px] px-1.5 py-0.5 rounded border border-blue-300/60 dark:border-blue-700/40 text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/20">
                        Brand Sendiri
                      </span>
                    ) : row.is_aggregate_others ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/30">
                          Agregat/Lainnya
                        </span>
                        <button
                          onClick={() => toggleAggregate(row.row_id, false)}
                          disabled={togglingId === row.row_id}
                          title="Ubah ke Brand Spesifik"
                          className="text-[9px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                        >
                          ↺
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] px-1.5 py-0.5 rounded border border-border text-muted-foreground bg-background">
                          Brand Spesifik
                        </span>
                        <button
                          onClick={() => toggleAggregate(row.row_id, true)}
                          disabled={togglingId === row.row_id}
                          title="Tandai sebagai Agregat"
                          className="text-[9px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                        >
                          ↺
                        </button>
                      </div>
                    )}
                  </td>
                  {editId === row.row_id ? (
                    <>
                      <td className="px-3 py-2">
                        <input
                          type="number" min={0} max={100} step={0.1}
                          className="w-24 px-2 py-1 text-xs border border-border rounded bg-background text-right ml-auto block"
                          value={editVals.market_share_pct}
                          onChange={e => setEditVals(v => ({ ...v, market_share_pct: parseFloat(e.target.value) || 0 }))}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox" checked={editVals.is_own_brand}
                          onChange={e => setEditVals(v => ({ ...v, is_own_brand: e.target.checked }))}
                          className="h-4 w-4 accent-blue-600"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={saveEdit} disabled={saving}
                            className="px-2.5 py-1 text-[11px] font-medium bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">
                            ✓ Simpan
                          </button>
                          <button onClick={() => setEditId(null)}
                            className="px-2.5 py-1 text-[11px] border border-border rounded hover:bg-muted">
                            ✕
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2.5 text-right tabular-nums text-xs font-semibold">
                        {row.market_share_pct.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2.5 text-center text-xs">
                        {row.is_own_brand
                          ? <span className="text-green-600 dark:text-green-400">✓</span>
                          : <span className="text-muted-foreground/30">—</span>}
                      </td>
                      <td className="px-3 py-2.5 pr-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => { setEditId(row.row_id); setEditVals({ market_share_pct: row.market_share_pct, is_own_brand: row.is_own_brand }); }}
                            className="px-2 py-1 text-[11px] border border-border rounded hover:bg-muted transition-colors" title="Edit">
                            ✎
                          </button>
                          <button
                            onClick={() => setDeleteTarget(row)}
                            className="px-2 py-1 text-[11px] border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors" title="Hapus">
                            ✕
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-muted/20">
            <p className="text-[11px] text-muted-foreground">{filtered.length} baris · hal {page} / {totalPages}</p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-2 py-1 text-xs border border-border rounded hover:bg-muted disabled:opacity-40">← Prev</button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-2 py-1 text-xs border border-border rounded hover:bg-muted disabled:opacity-40">Next →</button>
            </div>
          </div>
        )}
      </div>

      {/* Delete dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-background border border-border rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <p className="text-sm font-semibold">Hapus data ini?</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span className="font-medium text-foreground">{deleteTarget.nama_brand}</span>
              {" — "}{deleteTarget.provinsi} — {deleteTarget.periode}
            </p>
            <p className="text-xs text-red-600 dark:text-red-400">Tindakan ini tidak bisa dibatalkan.</p>
            <div className="flex gap-2">
              <button onClick={doDelete} disabled={saving}
                className="flex-1 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                Hapus
              </button>
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2 text-sm border border-border rounded-lg hover:bg-muted">
                Batal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-background border border-border rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <p className="text-sm font-semibold">Tambah Baris Market Share</p>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Provinsi</label>
                <input
                  list="ms-prov-list"
                  className="mt-1 w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background"
                  placeholder="Contoh: JAWA TIMUR"
                  value={addForm.provinsi}
                  onChange={e => setAddForm(f => ({ ...f, provinsi: e.target.value.toUpperCase() }))}
                />
                <datalist id="ms-prov-list">{allProvinsis.map(p => <option key={p} value={p} />)}</datalist>
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Periode (YYYY-MM)</label>
                <input
                  type="month"
                  className="mt-1 w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background"
                  value={addForm.periode}
                  onChange={e => setAddForm(f => ({ ...f, periode: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Nama Brand</label>
                <input
                  list="ms-brand-list"
                  className="mt-1 w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background"
                  placeholder="Nama brand"
                  value={addForm.nama_brand}
                  onChange={e => setAddForm(f => ({ ...f, nama_brand: e.target.value }))}
                />
                <datalist id="ms-brand-list">{allBrands.map(b => <option key={b} value={b} />)}</datalist>
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Market Share (%)</label>
                <input
                  type="number" min={0} max={100} step={0.1}
                  className="mt-1 w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background"
                  value={addForm.market_share_pct}
                  onChange={e => setAddForm(f => ({ ...f, market_share_pct: parseFloat(e.target.value) || 0 }))}
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox" checked={addForm.is_own_brand}
                  onChange={e => setAddForm(f => ({ ...f, is_own_brand: e.target.checked }))}
                  className="h-4 w-4 accent-blue-600"
                />
                <span className="text-sm">Brand Sendiri (Semen Elang / Badak)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={
                    addForm.is_aggregate_others !== null
                      ? addForm.is_aggregate_others
                      : false
                  }
                  onChange={e => setAddForm(f => ({ ...f, is_aggregate_others: e.target.checked }))}
                  className="h-4 w-4 accent-gray-600"
                />
                <span className="text-sm">Tandai sebagai Agregat/Lainnya</span>
              </label>
              <p className="text-[10px] text-muted-foreground -mt-1">
                Dideteksi otomatis dari nama brand jika tidak dicentang secara manual
              </p>
              {addError && <p className="text-xs text-red-600 dark:text-red-400">{addError}</p>}
            </div>
            <div className="flex gap-2">
              <button onClick={doAdd} disabled={saving}
                className="flex-1 py-2 text-sm font-medium bg-foreground text-background rounded-lg hover:opacity-80 disabled:opacity-50">
                Simpan
              </button>
              <button onClick={() => { setShowAdd(false); setAddError(""); }}
                className="flex-1 py-2 text-sm border border-border rounded-lg hover:bg-muted">
                Batal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SpDataTable ─────────────────────────────────────────────────────────────

function SpDataTable({ onDataChanged }: { onDataChanged: () => void }) {
  const [rows,         setRows]         = useState<SpRow[]>([]);
  const [loadingTable, setLoadingTable] = useState(true);
  const [search,       setSearch]       = useState("");
  const [filterPeriode,setFilterPeriode]= useState("");
  const [page,         setPage]         = useState(1);
  const [editId,       setEditId]       = useState<string | null>(null);
  const [editVal,      setEditVal]      = useState(0);
  const [saving,       setSaving]       = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SpRow | null>(null);
  const [showAdd,      setShowAdd]      = useState(false);
  const [addForm,      setAddForm]      = useState({ provinsi: "", periode: "", share_nasional_pct: 0 });
  const [addError,     setAddError]     = useState("");

  const fetchRows = useCallback(() => {
    setLoadingTable(true);
    fetch(`${API}/api/competitor/asperssi/share-provinsi/list`)
      .then(r => r.json()).then(r => { setRows(r.data ?? []); setPage(1); })
      .catch(() => {}).finally(() => setLoadingTable(false));
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const allPeriodes  = useMemo(() => Array.from(new Set(rows.map(r => r.periode))).sort(), [rows]);
  const allProvinsis = useMemo(() => Array.from(new Set(rows.map(r => r.provinsi))).sort(), [rows]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter(r =>
      (!search || r.provinsi.toLowerCase().includes(q)) &&
      (!filterPeriode || r.periode === filterPeriode)
    );
  }, [rows, search, filterPeriode]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged      = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const hdrs = (tok: string | null) =>
    tok ? { "Authorization": `Bearer ${tok}`, "Content-Type": "application/json" } as HeadersInit
        : { "Content-Type": "application/json" } as HeadersInit;

  const saveEdit = async () => {
    if (!editId) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/competitor/asperssi/share-provinsi/${editId}`, {
        method: "PUT", headers: hdrs(getToken()), body: JSON.stringify({ share_nasional_pct: editVal }),
      });
      if (res.ok) { setEditId(null); fetchRows(); onDataChanged(); }
    } finally { setSaving(false); }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const tok = getToken();
      const res = await fetch(`${API}/api/competitor/asperssi/share-provinsi/${deleteTarget.row_id}`, {
        method: "DELETE", headers: tok ? { "Authorization": `Bearer ${tok}` } as HeadersInit : {},
      });
      if (res.ok) { setDeleteTarget(null); fetchRows(); onDataChanged(); }
    } finally { setSaving(false); }
  };

  const doAdd = async () => {
    setAddError("");
    const prov = addForm.provinsi.trim().toUpperCase();
    if (!prov || !addForm.periode) { setAddError("Provinsi dan Periode wajib diisi"); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/competitor/asperssi/share-provinsi/add-row`, {
        method: "POST", headers: hdrs(getToken()),
        body: JSON.stringify({ ...addForm, provinsi: prov }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowAdd(false);
        setAddForm({ provinsi: "", periode: "", share_nasional_pct: 0 });
        fetchRows(); onDataChanged();
      } else { setAddError(data.detail ?? "Gagal menyimpan"); }
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          className="flex-1 min-w-44 px-3 py-1.5 text-sm border border-border rounded-lg bg-background"
          placeholder="Cari provinsi…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
        />
        <select
          className="px-3 py-1.5 text-sm border border-border rounded-lg bg-background"
          value={filterPeriode}
          onChange={e => { setFilterPeriode(e.target.value); setPage(1); }}
        >
          <option value="">Semua Periode</option>
          {allPeriodes.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button
          onClick={() => { setShowAdd(true); setAddError(""); }}
          className="px-3 py-1.5 text-xs font-medium bg-foreground text-background rounded-lg hover:opacity-80 transition-opacity shrink-0"
        >
          + Tambah Baris
        </button>
      </div>

      {/* Table */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2.5 text-left font-semibold">Provinsi</th>
                <th className="px-3 py-2.5 text-left font-semibold">Periode</th>
                <th className="px-3 py-2.5 text-right font-semibold">Share Nasional (%)</th>
                <th className="px-3 py-2.5 text-right font-semibold pr-3">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loadingTable ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-muted/50">
                    {Array.from({ length: 4 }).map((_, j) => (
                      <td key={j} className="px-3 py-2.5"><Skeleton className="h-3.5 w-full rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : paged.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Tidak ada data{search || filterPeriode ? " sesuai filter" : ""}
                </td></tr>
              ) : paged.map(row => (
                <tr
                  key={row.row_id}
                  className={`border-b border-muted/50 transition-colors ${editId === row.row_id ? "bg-blue-50/30 dark:bg-blue-950/10" : "hover:bg-muted/20"}`}
                >
                  <td className="px-3 py-2.5 text-xs">{row.provinsi}</td>
                  <td className="px-3 py-2.5 text-xs font-mono">{row.periode}</td>
                  {editId === row.row_id ? (
                    <>
                      <td className="px-3 py-2">
                        <input
                          type="number" min={0} max={100} step={0.1}
                          className="w-28 px-2 py-1 text-xs border border-border rounded bg-background text-right ml-auto block"
                          value={editVal}
                          onChange={e => setEditVal(parseFloat(e.target.value) || 0)}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={saveEdit} disabled={saving}
                            className="px-2.5 py-1 text-[11px] font-medium bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">
                            ✓ Simpan
                          </button>
                          <button onClick={() => setEditId(null)}
                            className="px-2.5 py-1 text-[11px] border border-border rounded hover:bg-muted">
                            ✕
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2.5 text-right tabular-nums text-xs font-semibold">
                        {row.share_nasional_pct.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2.5 pr-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => { setEditId(row.row_id); setEditVal(row.share_nasional_pct); }}
                            className="px-2 py-1 text-[11px] border border-border rounded hover:bg-muted transition-colors" title="Edit">
                            ✎
                          </button>
                          <button
                            onClick={() => setDeleteTarget(row)}
                            className="px-2 py-1 text-[11px] border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors" title="Hapus">
                            ✕
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-muted/20">
            <p className="text-[11px] text-muted-foreground">{filtered.length} baris · hal {page} / {totalPages}</p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-2 py-1 text-xs border border-border rounded hover:bg-muted disabled:opacity-40">← Prev</button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-2 py-1 text-xs border border-border rounded hover:bg-muted disabled:opacity-40">Next →</button>
            </div>
          </div>
        )}
      </div>

      {/* Delete dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-background border border-border rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <p className="text-sm font-semibold">Hapus data ini?</p>
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{deleteTarget.provinsi}</span> — {deleteTarget.periode}
            </p>
            <p className="text-xs text-red-600 dark:text-red-400">Tindakan ini tidak bisa dibatalkan.</p>
            <div className="flex gap-2">
              <button onClick={doDelete} disabled={saving}
                className="flex-1 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">Hapus</button>
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2 text-sm border border-border rounded-lg hover:bg-muted">Batal</button>
            </div>
          </div>
        </div>
      )}

      {/* Add modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-background border border-border rounded-xl shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <p className="text-sm font-semibold">Tambah Baris Share Provinsi</p>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Provinsi</label>
                <input
                  list="sp-prov-list"
                  className="mt-1 w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background"
                  placeholder="Contoh: JAWA TIMUR"
                  value={addForm.provinsi}
                  onChange={e => setAddForm(f => ({ ...f, provinsi: e.target.value.toUpperCase() }))}
                />
                <datalist id="sp-prov-list">{allProvinsis.map(p => <option key={p} value={p} />)}</datalist>
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Periode (YYYY-MM)</label>
                <input
                  type="month"
                  className="mt-1 w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background"
                  value={addForm.periode}
                  onChange={e => setAddForm(f => ({ ...f, periode: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Share Nasional (%)</label>
                <input
                  type="number" min={0} max={100} step={0.1}
                  className="mt-1 w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-background"
                  value={addForm.share_nasional_pct}
                  onChange={e => setAddForm(f => ({ ...f, share_nasional_pct: parseFloat(e.target.value) || 0 }))}
                />
              </div>
              {addError && <p className="text-xs text-red-600 dark:text-red-400">{addError}</p>}
            </div>
            <div className="flex gap-2">
              <button onClick={doAdd} disabled={saving}
                className="flex-1 py-2 text-sm font-medium bg-foreground text-background rounded-lg hover:opacity-80 disabled:opacity-50">Simpan</button>
              <button onClick={() => { setShowAdd(false); setAddError(""); }}
                className="flex-1 py-2 text-sm border border-border rounded-lg hover:bg-muted">Batal</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Shared small components (Threat Map) ─────────────────────────────────────

const CPI_CFG: Record<string, { cls: string; dot: string; label: string }> = {
  critical: { cls: "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-400 dark:border-red-700/40", dot: "bg-red-500", label: "Kritis" },
  high:     { cls: "bg-orange-50 text-orange-700 border-orange-300 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-700/40", dot: "bg-orange-500", label: "Tinggi" },
  medium:   { cls: "bg-yellow-50 text-yellow-700 border-yellow-300 dark:bg-yellow-950/30 dark:text-yellow-500 dark:border-yellow-600/40", dot: "bg-yellow-400", label: "Sedang" },
  low:      { cls: "bg-green-50 text-green-700 border-green-300 dark:bg-green-950/30 dark:text-green-400 dark:border-green-700/40", dot: "bg-green-400", label: "Rendah" },
};

function ThreatScoreBadge({ label }: { label: string }) {
  const cfg = CPI_CFG[label] ?? CPI_CFG.low;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded border ${cfg.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

const MOMENTUM_CFG: Record<string, { arrow: string; cls: string }> = {
  accelerating_loss: { arrow: "↓↓", cls: "text-red-600 dark:text-red-400 font-bold" },
  slow_erosion:      { arrow: "↓",  cls: "text-orange-500 dark:text-orange-400" },
  stable:            { arrow: "→",  cls: "text-muted-foreground" },
  gaining:           { arrow: "↑",  cls: "text-green-600 dark:text-green-400 font-bold" },
};

function MomentumIndicator({ label }: { label: string | null }) {
  const cfg = MOMENTUM_CFG[label ?? "stable"] ?? MOMENTUM_CFG.stable;
  return <span className={`text-xs ${cfg.cls}`}>{cfg.arrow} {label?.replace(/_/g, " ") ?? "stable"}</span>;
}

const SEVERITY_CFG: Record<string, { cls: string; dot: string }> = {
  critical: { cls: "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-400 dark:border-red-700/40", dot: "bg-red-500" },
  high:     { cls: "bg-orange-50 text-orange-700 border-orange-300 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-700/40", dot: "bg-orange-500" },
  medium:   { cls: "bg-yellow-50 text-yellow-700 border-yellow-300 dark:bg-yellow-950/30 dark:text-yellow-500 dark:border-yellow-600/40", dot: "bg-yellow-400" },
  low:      { cls: "bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-700/40", dot: "bg-blue-400" },
};

function SeverityBadge({ severity }: { severity: string }) {
  const cfg = SEVERITY_CFG[severity] ?? SEVERITY_CFG.low;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded border ${cfg.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {severity}
    </span>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type TabId = "overview" | "threat" | "winloss" | "warning" | "strategi" | "prediksi" | "ekspansi" | "data";

export default function CompetitorPage() {
  const { isAdmin } = useAuth();

  // ── Existing state ──────────────────────────────────────────────────────
  const [overview,        setOverview]        = useState<Overview | null>(null);
  const [triList,         setTriList]         = useState<TriRow[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [triLoading,      setTL]              = useState(true);
  const [activeTab,       setActiveTab]       = useState<TabId>("overview");
  const [expandedRow,     setExpandedRow]     = useState<string | null>(null);
  const [insight,         setInsight]         = useState<{ status: string; narasi: string | null; generated_at?: string; cached?: boolean } | null>(null);
  const [insightLoading,  setInsightLoading]  = useState(true);
  const [rankingData,     setRankingData]     = useState<RankRow[]>([]);
  const [aggregateOthers, setAggregateOthers] = useState<AggregateOthers | null>(null);

  // ── New state (lazy loaded per tab) ────────────────────────────────────
  const [cpiSummary,      setCpiSummary]      = useState<CpiSummary | null>(null);
  const [cpiLoading,      setCpiLoading]      = useState(false);
  const [wlSummary,       setWlSummary]       = useState<WlSummary | null>(null);
  const [wlLoading,       setWlLoading]       = useState(false);
  const [ewaSummary,      setEwaSummary]      = useState<EwaSummary | null>(null);
  const [ewaLoading,      setEwaLoading]      = useState(false);
  const [csrSummary,      setCsrSummary]      = useState<CsrSummary | null>(null);
  const [csrLoading,      setCsrLoading]      = useState(false);
  const [forecastSummary, setForecastSummary] = useState<ForecastSummary | null>(null);
  const [forecastThreats, setForecastThreats] = useState<unknown[]>([]);
  const [forecastAtRisk,  setForecastAtRisk]  = useState<ForecastAtRisk[]>([]);
  const [forecastExp,     setForecastExp]     = useState<ForecastExpansion[]>([]);
  const [forecastLoading, setForecastLoading] = useState(false);

  const fetchOverview = useCallback(() => {
    setLoading(true);
    fetch(`${API}/api/competitor/overview`)
      .then((r) => r.json()).then((r) => setOverview(r.data ?? null))
      .catch(() => {}).finally(() => setLoading(false));
  }, []);

  const fetchTriangulation = useCallback(() => {
    setTL(true);
    fetch(`${API}/api/competitor/triangulation`)
      .then((r) => r.json()).then((r) => setTriList(r.data ?? []))
      .catch(() => {}).finally(() => setTL(false));
  }, []);

  const fetchInsight = useCallback(() => {
    setInsightLoading(true);
    fetch(`${API}/api/competitor/insight`)
      .then((r) => r.json()).then((r) => setInsight(r.data ?? null))
      .catch(() => {}).finally(() => setInsightLoading(false));
  }, []);

  const fetchRanking = useCallback(() => {
    fetch(`${API}/api/competitor/ranking`).then((r) => r.json()).then((r) => {
      setRankingData(r.data?.rankings ?? []);
      setAggregateOthers(r.data?.aggregate_others ?? null);
    }).catch(() => {});
  }, []);

  const fetchCpi = useCallback(() => {
    if (cpiSummary) return;
    setCpiLoading(true);
    fetch(`${API}/api/competitor/cpi/summary`).then(r => r.json())
      .then(r => setCpiSummary(r.data ?? null)).catch(() => {}).finally(() => setCpiLoading(false));
  }, [cpiSummary]);

  const fetchWl = useCallback(() => {
    if (wlSummary) return;
    setWlLoading(true);
    fetch(`${API}/api/competitor/win-loss/summary`).then(r => r.json())
      .then(r => setWlSummary(r.data ?? null)).catch(() => {}).finally(() => setWlLoading(false));
  }, [wlSummary]);

  const fetchEwa = useCallback(() => {
    if (ewaSummary) return;
    setEwaLoading(true);
    fetch(`${API}/api/competitor/early-warning/active`).then(r => r.json())
      .then(r => setEwaSummary(r.data ?? null)).catch(() => {}).finally(() => setEwaLoading(false));
  }, [ewaSummary]);

  const fetchCsr = useCallback(() => {
    if (csrSummary) return;
    setCsrLoading(true);
    fetch(`${API}/api/competitor/counter-strategy/summary`).then(r => r.json())
      .then(r => setCsrSummary(r.data ?? null)).catch(() => {}).finally(() => setCsrLoading(false));
  }, [csrSummary]);

  const fetchForecast = useCallback(() => {
    if (forecastSummary) return;
    setForecastLoading(true);
    Promise.all([
      fetch(`${API}/api/competitor/forecast/threat/summary`).then(r => r.json()),
      fetch(`${API}/api/competitor/forecast/threat`).then(r => r.json()),
      fetch(`${API}/api/competitor/forecast/at-risk`).then(r => r.json()),
      fetch(`${API}/api/competitor/forecast/expansion`).then(r => r.json()),
    ]).then(([sum, thr, risk, exp]) => {
      setForecastSummary(sum.data ?? null);
      setForecastThreats(thr.data?.threats ?? []);
      setForecastAtRisk(risk.data?.areas ?? []);
      setForecastExp(exp.data?.candidates ?? []);
    }).catch(() => {}).finally(() => setForecastLoading(false));
  }, [forecastSummary]);

  useEffect(() => {
    fetchOverview(); fetchTriangulation(); fetchInsight(); fetchRanking();
  }, [fetchOverview, fetchTriangulation, fetchInsight, fetchRanking]);

  useEffect(() => {
    if (activeTab === "threat") fetchCpi();
    if (activeTab === "winloss") fetchWl();
    if (activeTab === "warning") fetchEwa();
    if (activeTab === "strategi") fetchCsr();
    if (activeTab === "prediksi" || activeTab === "ekspansi") fetchForecast();
  }, [activeTab, fetchCpi, fetchWl, fetchEwa, fetchCsr, fetchForecast]);

  const refreshAll = useCallback(() => {
    fetchOverview(); fetchTriangulation(); fetchInsight(); fetchRanking();
    setCpiSummary(null); setWlSummary(null); setEwaSummary(null); setCsrSummary(null); setForecastSummary(null);
  }, [fetchOverview, fetchTriangulation, fetchInsight, fetchRanking]);

  const summary = useMemo(() => ({
    konfirmasi_kompetitor: triList.filter(r => r.verdict === "KONFIRMASI_KOMPETITOR").length,
    waspada_awal:          triList.filter(r => r.verdict === "WASPADA_AWAL").length,
    internal_seasonal:     triList.filter(r => r.verdict === "INTERNAL_ATAU_SEASONAL").length,
    tidak_cukup_data:      triList.filter(r => r.verdict === "TIDAK_CUKUP_DATA").length,
    normal:                triList.filter(r => r.verdict === "NORMAL").length,
  }), [triList]);

  const cov = overview?.coverage;

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
        {triLoading ? (
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
        <div className="flex items-center gap-1 border-b border-border pb-0 overflow-x-auto">
          {([
            { id: "overview",  label: "Overview" },
            { id: "threat",    label: "Threat Map" },
            { id: "winloss",   label: "Win/Loss" },
            { id: "warning",   label: `Early Warning${ewaSummary?.total_active ? ` (${ewaSummary.total_active})` : ""}` },
            { id: "strategi",  label: "Counter-Strategy" },
            { id: "prediksi",  label: "Prediksi" },
            { id: "ekspansi",  label: "Ekspansi" },
            ...(isAdmin ? [{ id: "data", label: "Data ASPERSSI" }] : []),
          ] as { id: TabId; label: string }[]).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`shrink-0 px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors -mb-px ${
                activeTab === id
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── TAB 1: Overview ─────────────────────────────────────────────── */}
        {activeTab === "overview" && (
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

        {/* ── TAB 2: Threat Map ────────────────────────────────────────────── */}
        {activeTab === "threat" && (
          <div className="space-y-5">
            {/* CPI Summary */}
            {cpiLoading ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
              </div>
            ) : cpiSummary ? (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {(["critical", "high", "medium", "low"] as const).map(lbl => (
                    <Card key={lbl}>
                      <CardContent className="pt-4 pb-4">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">CPI {CPI_CFG[lbl].label}</p>
                        <p className="text-3xl font-bold leading-none mt-1" style={{ color: lbl === "critical" ? "#DC2626" : lbl === "high" ? "#EA580C" : lbl === "medium" ? "#CA8A04" : "#16a34a" }}>
                          {cpiSummary.by_label[lbl] ?? 0}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-1">dari {cpiSummary.total_stores} toko</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <Card>
                    <CardHeader className="border-b border-border pb-3">
                      <CardTitle className="text-sm">Toko CPI Kritis ({cpiSummary.critical_stores.length})</CardTitle>
                      <p className="text-[11px] text-muted-foreground">Tekanan kompetitif tertinggi — prioritas utama</p>
                    </CardHeader>
                    <CardContent className="pt-0 px-0">
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-muted/50 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                              <th className="px-4 py-2 text-left">Toko</th>
                              <th className="px-4 py-2 text-right">CPI</th>
                              <th className="px-4 py-2 text-right">FBSI</th>
                              <th className="px-4 py-2 text-right">Vol Elang</th>
                              <th className="px-4 py-2 text-left">Alert</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/50">
                            {(cpiSummary?.critical_stores ?? []).slice(0, 8).map(r => (
                              <tr key={r.id_toko} className="hover:bg-muted/20">
                                <td className="px-4 py-2 font-medium max-w-[140px] truncate" title={r.nama_toko ?? r.id_toko}>
                                  {r.nama_toko ?? r.id_toko}
                                  {r.kabupaten && <span className="block text-[10px] text-muted-foreground">{r.kabupaten}</span>}
                                </td>
                                <td className="px-4 py-2 text-right"><ThreatScoreBadge label="critical" /></td>
                                <td className="px-4 py-2 text-right tabular-nums">{r.fbsi_latest?.toFixed(1) ?? "—"}%</td>
                                <td className="px-4 py-2 text-right tabular-nums">
                                  <span className={`font-semibold ${(r.elang_vol_pct ?? 0) < 0 ? "text-red-600 dark:text-red-400" : "text-green-600"}`}>
                                    {r.elang_vol_pct != null ? `${r.elang_vol_pct > 0 ? "+" : ""}${r.elang_vol_pct.toFixed(1)}%` : "—"}
                                  </span>
                                </td>
                                <td className="px-4 py-2 text-[10px] text-muted-foreground">{r.alert_level ?? "—"}</td>
                              </tr>
                            ))}
                            {!(cpiSummary?.critical_stores?.length) && (
                              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Tidak ada toko CPI critical</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="border-b border-border pb-3">
                      <CardTitle className="text-sm">Ranking Kompetitor (ASPERSSI)</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-3 space-y-1.5">
                      {rankingData.slice(0, 8).map((r, i) => (
                        <div key={r.brand} className="flex items-center justify-between px-3 py-2 bg-muted/30 rounded-lg">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground/50 w-4">{i + 1}</span>
                            <span className="text-xs font-medium truncate max-w-[160px]">{r.brand}</span>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="text-xs font-bold">{r.avg_ms_pct.toFixed(1)}%</span>
                            <span className={`ml-2 text-[10px] ${TREND_CLS[r.trend_label]}`}>
                              {r.avg_trend_pp > 0 ? "+" : ""}{r.avg_trend_pp.toFixed(2)}pp
                            </span>
                          </div>
                        </div>
                      ))}
                      {!rankingData.length && <p className="text-xs text-muted-foreground text-center py-4">Tidak ada data ASPERSSI</p>}
                    </CardContent>
                  </Card>
                </div>
              </>
            ) : (
              <Card>
                <CardContent className="pt-6 pb-6 text-center">
                  <p className="text-sm text-muted-foreground">Data CPI belum tersedia.</p>
                  <p className="text-xs text-muted-foreground mt-1">Jalankan analisis via POST /api/competitor/refresh (admin) atau tunggu jadwal harian 06:30.</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ── TAB 5: Win/Loss ──────────────────────────────────────────────── */}
        {activeTab === "winloss" && (
          <div className="space-y-5">
            {wlLoading ? (
              <Skeleton className="h-48 rounded-xl" />
            ) : wlSummary ? (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { label: "Total Toko", value: wlSummary?.total ?? 0, color: "#6b7280", sub: "dianalisis" },
                    { label: "Win", value: wlSummary?.by_outcome?.win ?? 0, color: "#16a34a", sub: "Elang naik / Banteng turun" },
                    { label: "Loss", value: wlSummary?.by_outcome?.loss ?? 0, color: "#DC2626", sub: "Elang turun / Banteng naik" },
                    { label: "Win Rate", value: `${(wlSummary?.win_rate_pct ?? 0).toFixed(1)}%`, color: (wlSummary?.win_rate_pct ?? 0) >= 50 ? "#16a34a" : "#DC2626", sub: `periode ${wlSummary?.periode ?? "—"}` },
                  ].map(k => (
                    <Card key={k.label}>
                      <CardContent className="pt-4 pb-4">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{k.label}</p>
                        <p className="text-3xl font-bold leading-none mt-1" style={{ color: k.color }}>{k.value}</p>
                        <p className="text-[11px] text-muted-foreground mt-1">{k.sub}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <Card>
                    <CardHeader className="border-b border-border pb-3">
                      <CardTitle className="text-sm text-green-700 dark:text-green-400">Top Win — Volume Elang Naik</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0 px-0">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-muted/50 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                            <th className="px-4 py-2 text-left">Toko</th>
                            <th className="px-4 py-2 text-right">Vol Elang MoM</th>
                            <th className="px-4 py-2 text-right">FBSI Delta</th>
                            <th className="px-4 py-2 text-left">Detail</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                          {(wlSummary?.top_wins ?? []).slice(0, 6).map(r => (
                            <tr key={r.id_toko} className="hover:bg-muted/20">
                              <td className="px-4 py-2 font-medium max-w-[140px] truncate" title={r.nama_toko ?? r.id_toko}>
                                {r.nama_toko ?? r.id_toko}
                                {r.kabupaten && <span className="block text-[10px] text-muted-foreground">{r.kabupaten}</span>}
                              </td>
                              <td className="px-4 py-2 text-right font-bold text-green-600 dark:text-green-400 tabular-nums">
                                +{r.elang_vol_pct?.toFixed(1) ?? "—"}%
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                                {r.banteng_fbsi_delta != null ? `${r.banteng_fbsi_delta > 0 ? "+" : ""}${r.banteng_fbsi_delta.toFixed(1)}pp` : "—"}
                              </td>
                              <td className="px-4 py-2 text-[10px] text-muted-foreground">{r.outcome_detail?.replace(/_/g, " ") ?? "—"}</td>
                            </tr>
                          ))}
                          {!(wlSummary?.top_wins?.length) && (
                            <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">Tidak ada data win</td></tr>
                          )}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="border-b border-border pb-3">
                      <CardTitle className="text-sm text-red-700 dark:text-red-400">Top Loss — Volume Elang Turun</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0 px-0">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-muted/50 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                            <th className="px-4 py-2 text-left">Toko</th>
                            <th className="px-4 py-2 text-right">Vol Elang MoM</th>
                            <th className="px-4 py-2 text-right">FBSI Delta</th>
                            <th className="px-4 py-2 text-left">Faktor</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                          {(wlSummary?.top_losses ?? []).slice(0, 6).map(r => (
                            <tr key={r.id_toko} className="hover:bg-muted/20">
                              <td className="px-4 py-2 font-medium max-w-[140px] truncate" title={r.nama_toko ?? r.id_toko}>
                                {r.nama_toko ?? r.id_toko}
                                {r.kabupaten && <span className="block text-[10px] text-muted-foreground">{r.kabupaten}</span>}
                              </td>
                              <td className="px-4 py-2 text-right font-bold text-red-600 dark:text-red-400 tabular-nums">
                                {r.elang_vol_pct?.toFixed(1) ?? "—"}%
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                                {r.banteng_fbsi_delta != null ? `${r.banteng_fbsi_delta > 0 ? "+" : ""}${r.banteng_fbsi_delta.toFixed(1)}pp` : "—"}
                              </td>
                              <td className="px-4 py-2 text-[10px] text-muted-foreground">{r.primary_factor?.replace(/_/g, " ") ?? "—"}</td>
                            </tr>
                          ))}
                          {!(wlSummary?.top_losses?.length) && (
                            <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">Tidak ada data loss</td></tr>
                          )}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                </div>
              </>
            ) : (
              <Card>
                <CardContent className="pt-6 pb-6 text-center">
                  <p className="text-sm text-muted-foreground">Data Win/Loss belum tersedia. Jalankan analisis via POST /api/competitor/refresh.</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ── TAB 6: Early Warning ─────────────────────────────────────────── */}
        {activeTab === "warning" && (
          <div className="space-y-4">
            {ewaLoading ? (
              <Skeleton className="h-48 rounded-xl" />
            ) : ewaSummary ? (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {(["critical","high","medium","low"] as const).map(sev => (
                    <Card key={sev}>
                      <CardContent className="pt-4 pb-4">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{sev}</p>
                        <p className="text-3xl font-bold leading-none mt-1" style={{ color: sev==="critical"?"#DC2626":sev==="high"?"#EA580C":sev==="medium"?"#CA8A04":"#3b82f6" }}>
                          {ewaSummary?.by_severity?.[sev] ?? 0}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-1">alerts aktif</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <Card>
                  <CardHeader className="border-b border-border pb-3">
                    <CardTitle className="text-sm">Alert Aktif ({ewaSummary.total_active})</CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 px-0">
                    {!(ewaSummary?.alerts?.length) ? (
                      <p className="px-4 py-8 text-center text-sm text-green-600 dark:text-green-400">Tidak ada alert aktif saat ini</p>
                    ) : (
                      <div className="divide-y divide-border/50">
                        {(ewaSummary?.alerts ?? []).map(a => (
                          <div key={a.id} className="px-4 py-3 hover:bg-muted/20">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <SeverityBadge severity={a.severity} />
                                  <span className="text-[10px] text-muted-foreground">{a.scope} · {a.scope_name ?? a.scope_id}</span>
                                  {a.provinsi && <span className="text-[10px] text-muted-foreground">· {a.provinsi}</span>}
                                </div>
                                <p className="text-sm font-medium">{a.title}</p>
                                {a.description && <p className="text-xs text-muted-foreground mt-0.5">{a.description}</p>}
                                {a.metric_value != null && (
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    {a.metric_label}: <span className="font-medium text-foreground">{a.metric_value.toFixed(1)}</span>
                                    {a.metric_threshold != null && ` (threshold: ${a.metric_threshold})`}
                                  </p>
                                )}
                              </div>
                              <p className="text-[10px] text-muted-foreground shrink-0">
                                {new Date(a.triggered_at).toLocaleDateString("id-ID")}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="pt-6 pb-6 text-center">
                  <p className="text-sm text-muted-foreground">Data Early Warning belum tersedia. Jalankan analisis via POST /api/competitor/refresh.</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ── TAB 7: Counter-Strategy ──────────────────────────────────────── */}
        {activeTab === "strategi" && (
          <div className="space-y-4">
            {csrLoading ? (
              <Skeleton className="h-48 rounded-xl" />
            ) : csrSummary ? (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {(["urgent","high","medium","low"] as const).map(pri => (
                    <Card key={pri}>
                      <CardContent className="pt-4 pb-4">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Prioritas {pri}</p>
                        <p className="text-3xl font-bold leading-none mt-1" style={{ color: pri==="urgent"?"#DC2626":pri==="high"?"#EA580C":pri==="medium"?"#CA8A04":"#6b7280" }}>
                          {csrSummary?.by_priority?.[pri] ?? 0}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-1">kabupaten</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <Card>
                  <CardHeader className="border-b border-border pb-3">
                    <CardTitle className="text-sm">Area Prioritas Tertinggi</CardTitle>
                    <p className="text-[11px] text-muted-foreground">Rekomendasi action per kabupaten berdasarkan CPI + MSM + Win/Loss</p>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {!(csrSummary?.urgent_areas?.length) ? (
                      <p className="py-8 text-center text-sm text-muted-foreground">Belum ada rekomendasi strategy tersedia</p>
                    ) : (
                      <div className="space-y-3 pt-3">
                        {(csrSummary?.urgent_areas ?? []).map(r => (
                          <div key={r.id} className="border border-border rounded-xl p-4 space-y-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="flex items-center gap-2 mb-0.5">
                                  <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-semibold ${r.priority==="urgent"?"bg-red-100 text-red-700":r.priority==="high"?"bg-orange-100 text-orange-700":"bg-yellow-100 text-yellow-700"}`}>
                                    {r.priority.toUpperCase()}
                                  </span>
                                  <span className="text-xs font-semibold text-muted-foreground">{r.strategy_type.replace(/_/g, " ")}</span>
                                </div>
                                <p className="text-sm font-semibold">{r.scope_id}</p>
                                {r.provinsi && <p className="text-[11px] text-muted-foreground">{r.provinsi}</p>}
                              </div>
                              <div className="text-right shrink-0">
                                {r.trigger_cpi_avg != null && (
                                  <p className="text-xs text-muted-foreground">Avg CPI: <span className="font-bold text-foreground">{r.trigger_cpi_avg.toFixed(1)}</span></p>
                                )}
                                <p className="text-xs text-muted-foreground">
                                  {r.n_stores_critical} kritis · {r.n_stores_loss} loss
                                </p>
                              </div>
                            </div>
                            {r.recommended_actions && r.recommended_actions.length > 0 && (
                              <ul className="space-y-1">
                                {r.recommended_actions.map((act, i) => (
                                  <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                                    <span className="shrink-0 text-foreground/40 mt-0.5">•</span>
                                    {act}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {r.ilp_suggestion && (
                              <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2">
                                <p className="text-[10px] font-semibold text-blue-700 dark:text-blue-400 mb-0.5">ILP Hint</p>
                                <p className="text-xs text-blue-700 dark:text-blue-300">{r.ilp_suggestion}</p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="pt-6 pb-6 text-center">
                  <p className="text-sm text-muted-foreground">Data Counter-Strategy belum tersedia. Jalankan analisis via POST /api/competitor/refresh.</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ── TAB 8: Prediksi ──────────────────────────────────────────────── */}
        {activeTab === "prediksi" && (
          <div className="space-y-4">
            {forecastLoading ? (
              <Skeleton className="h-48 rounded-xl" />
            ) : forecastSummary?.available ? (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { label: "Area Forecast", value: forecastSummary.meta.areas_forecast, color: "#6b7280", sub: `model: ${forecastSummary.meta.model ?? "—"}` },
                    { label: "Threat Provinsi", value: forecastSummary.threat_count ?? 0, color: "#DC2626", sub: "tren turun signifikan" },
                    { label: "At Risk Kabupaten", value: forecastSummary.at_risk_count ?? 0, color: "#EA580C", sub: "perlu perhatian" },
                    { label: "Horizon", value: `${forecastSummary.meta.horizon_months} bln`, color: "#3b82f6", sub: forecastSummary.meta.generated_at ? new Date(forecastSummary.meta.generated_at).toLocaleDateString("id-ID") : "—" },
                  ].map(k => (
                    <Card key={k.label}>
                      <CardContent className="pt-4 pb-4">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{k.label}</p>
                        <p className="text-3xl font-bold leading-none mt-1" style={{ color: k.color }}>{k.value}</p>
                        <p className="text-[11px] text-muted-foreground mt-1">{k.sub}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {(forecastThreats as { provinsi: string; threat_level: string; current_elang_pct: number; forecast_end_elang_pct: number }[]).length > 0 && (
                  <Card>
                    <CardHeader className="border-b border-border pb-3">
                      <CardTitle className="text-sm">Ancaman Tren Provinsi</CardTitle>
                      <p className="text-[11px] text-muted-foreground">Provinsi dengan prediksi penurunan share Elang paling signifikan</p>
                    </CardHeader>
                    <CardContent className="pt-3 space-y-2">
                      {(forecastThreats as { provinsi: string; threat_level: string; current_elang_pct: number; forecast_end_elang_pct: number }[]).map(t => (
                        <div key={t.provinsi} className="flex items-center justify-between px-3 py-2 bg-red-50/60 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
                          <div>
                            <span className="text-xs font-semibold">{t.provinsi}</span>
                            <SeverityBadge severity={t.threat_level} />
                          </div>
                          <div className="text-right text-xs">
                            <span className="text-muted-foreground">Saat ini: </span>
                            <span className="font-bold">{t.current_elang_pct.toFixed(1)}%</span>
                            <span className="text-muted-foreground"> → </span>
                            <span className="font-bold text-red-600 dark:text-red-400">{t.forecast_end_elang_pct.toFixed(1)}%</span>
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </>
            ) : (
              <Card>
                <CardContent className="pt-6 pb-6 text-center space-y-2">
                  <p className="text-sm font-medium">Cache Forecast Belum Tersedia</p>
                  <p className="text-xs text-muted-foreground">Jalankan <code className="bg-muted px-1 rounded text-xs">scripts/competitor_forecast.py</code> di lokal atau Google Colab, lalu upload hasilnya ke <code className="bg-muted px-1 rounded text-xs">api/data/competitor_forecast_cache.json</code>.</p>
                  <p className="text-xs text-muted-foreground">Script tersedia di: <span className="font-mono">scripts/competitor_forecast.py</span></p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ── TAB 9: Ekspansi ──────────────────────────────────────────────── */}
        {activeTab === "ekspansi" && (
          <div className="space-y-4">
            {forecastLoading ? (
              <Skeleton className="h-48 rounded-xl" />
            ) : forecastSummary?.available ? (
              <>
                <Card>
                  <CardHeader className="border-b border-border pb-3">
                    <CardTitle className="text-sm">Area At-Risk ({forecastAtRisk.length})</CardTitle>
                    <p className="text-[11px] text-muted-foreground">Kabupaten yang diprediksi mengalami penurunan share Elang</p>
                  </CardHeader>
                  <CardContent className="pt-0 px-0">
                    {!forecastAtRisk.length ? (
                      <p className="px-4 py-6 text-center text-sm text-muted-foreground">Tidak ada area at-risk ditemukan</p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-muted/50 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                            <th className="px-4 py-2 text-left">Area</th>
                            <th className="px-4 py-2 text-left">Provinsi</th>
                            <th className="px-4 py-2 text-right">Elang% Sekarang</th>
                            <th className="px-4 py-2 text-right">Prediksi Akhir</th>
                            <th className="px-4 py-2 text-left">Tren</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                          {forecastAtRisk.map(r => (
                            <tr key={r.area} className="hover:bg-muted/20">
                              <td className="px-4 py-2 font-medium">{r.area}</td>
                              <td className="px-4 py-2 text-muted-foreground">{r.provinsi ?? "—"}</td>
                              <td className="px-4 py-2 text-right font-semibold tabular-nums">{r.current_elang_pct.toFixed(1)}%</td>
                              <td className="px-4 py-2 text-right font-bold tabular-nums text-red-600 dark:text-red-400">{r.forecast_end_elang_pct.toFixed(1)}%</td>
                              <td className="px-4 py-2"><MomentumIndicator label={r.trend_elang} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="border-b border-border pb-3">
                    <CardTitle className="text-sm">Peluang Ekspansi ({forecastExp.length})</CardTitle>
                    <p className="text-[11px] text-muted-foreground">Area dengan potensi pertumbuhan Elang terbesar</p>
                  </CardHeader>
                  <CardContent className="pt-0 px-0">
                    {!forecastExp.length ? (
                      <p className="px-4 py-6 text-center text-sm text-muted-foreground">Tidak ada kandidat ekspansi ditemukan</p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-muted/50 border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                            <th className="px-4 py-2 text-left">Area</th>
                            <th className="px-4 py-2 text-left">Provinsi</th>
                            <th className="px-4 py-2 text-right">Elang% Sekarang</th>
                            <th className="px-4 py-2 text-right">Prediksi Akhir</th>
                            <th className="px-4 py-2 text-right">Potensi Naik</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                          {forecastExp.map(r => (
                            <tr key={r.area} className="hover:bg-muted/20">
                              <td className="px-4 py-2 font-medium">{r.area}</td>
                              <td className="px-4 py-2 text-muted-foreground">{r.provinsi ?? "—"}</td>
                              <td className="px-4 py-2 text-right tabular-nums">{r.current_elang_pct.toFixed(1)}%</td>
                              <td className="px-4 py-2 text-right font-bold tabular-nums text-green-600 dark:text-green-400">{r.forecast_end_elang_pct.toFixed(1)}%</td>
                              <td className="px-4 py-2 text-right font-bold tabular-nums text-green-600 dark:text-green-400">
                                +{(r.forecast_end_elang_pct - r.current_elang_pct).toFixed(1)}pp
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="pt-6 pb-6 text-center">
                  <p className="text-sm text-muted-foreground">Cache forecast belum tersedia. Jalankan <code className="bg-muted px-1 rounded">scripts/competitor_forecast.py</code> dulu.</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ── TAB 10: Data ASPERSSI (admin only) ───────────────────────────── */}
        {activeTab === "data" && isAdmin && (
          <div className="space-y-8">
            {/* Excel upload sections */}
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

            {/* Manual CRUD — Market Share Brand */}
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Data Market Share Brand (Edit Manual)</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Edit, hapus, atau tambah baris langsung tanpa upload Excel.
                  Perubahan langsung memperbarui Tab Triangulasi dan Ranking.
                </p>
              </div>
              <MsDataTable onDataChanged={refreshAll} />
            </div>

            {/* Manual CRUD — Share Provinsi */}
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Data Share Provinsi (Edit Manual)</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Edit, hapus, atau tambah baris langsung tanpa upload Excel.
                </p>
              </div>
              <SpDataTable onDataChanged={refreshAll} />
            </div>
          </div>
        )}

        <p className="text-center text-[11px] text-muted-foreground pb-4">
          CORE Platform v2 · Competitor Intelligence · Data ASPERSSI dalam persentase
        </p>
      </main>
    </div>
  );
}
