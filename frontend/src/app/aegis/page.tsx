"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Download } from "lucide-react";
import { downloadFile } from "@/lib/download";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  AlertCircleIcon,
  FilterIcon,
  SearchIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  BarChartHorizontalIcon,
  AlertDiamondIcon,
  MapPinIcon,
  ActivityIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "@hugeicons/core-free-icons";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import AegisMap from "@/components/aegis/AegisMap";
import type { RegionMapData } from "@/components/aegis/AegisMap";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const PAGE_SIZE = 20;
const CLUSTERS = ["Super Platinum", "Platinum", "Gold", "Silver", "Bronze"] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoreWarning {
  id_toko: string;
  nama_toko: string;
  kabupaten: string;
  cluster_pareto: string;
  tso: string;
  aegis_score: number;
  crs: number;
  if_score: number;
  if_label: number;
  churn_prob: number;
  level: string;
  pola: string;
  pola_kode: string;
  delta_fbsi: number;
  delta_he_pct: number;
  delta_cv: number;
  volume_at_risk: number;
}

interface WarningsMeta {
  volume_at_risk_total: number;
  volume_at_risk_pct: number;
}

interface PolaStats {
  count: number;
  avgChurn: number;
  avgIf: number;
}

interface CadAlert {
  kabupaten: string;
  status: "KRITIS" | "MERAH" | "KUNING";
  jumlah_toko: number;
}

interface BatchPredictItem {
  id_toko: string;
  status?: string;
  predicted_score_4w?: number;
  predicted_level_4w?: string;
  trend?: string;
  trend_delta?: number;
  trend_color?: string;
  level_change?: boolean;
  level_worse?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const toIcon = (i: unknown) => i as IconSvgElement;
const fmtNum = (n: number) => new Intl.NumberFormat("id-ID").format(Math.round(n));

const LEVEL_COLOR: Record<string, string> = {
  Merah:  "#DC2626",
  Oranye: "#EA580C",
  Kuning: "#CA8A04",
};

const STATUS_COLOR: Record<string, string> = {
  KRITIS: "#DC2626",
  MERAH:  "#EA580C",
  KUNING: "#CA8A04",
};

const POLA_META: Record<string, { label: string; desc: string; color: string }> = {
  "A": { label: "Pola A", desc: "Toko mulai beralih ke produk murah — order masih rutin",                                     color: "#EA580C" },
  "B": { label: "Pola B", desc: "Toko bermasalah — tiga tanda bahaya aktif bersamaan · Prioritas kunjungan segera",           color: "#DC2626" },
  "C": { label: "Pola C", desc: "Pola beli berubah — belum jelas penyebabnya · Pantau sebelum memburuk",                     color: "#6b7280" },
  "D": { label: "Pola D", desc: "Toko sudah kembali normal — peluang perkuat hubungan",                                      color: "#16a34a" },
};

const LEVEL_DESC: Record<string, string> = {
  Merah:  "Anomali kritis — 3 sinyal aktif bersamaan. Validasi TSO dalam 24 jam.",
  Oranye: "Anomali signifikan — 2 sinyal aktif. Kunjungan TSO dalam 72 jam.",
  Kuning: "Anomali awal — 1 sinyal terdeteksi. Pantau dan kunjungi dalam 7 hari.",
  KRITIS: "Anomali kritis — 3 sinyal aktif bersamaan. Validasi TSO dalam 24 jam.",
};

const LEVEL_BUTTON_CLS: Record<string, string> = {
  Merah:  "border-red-500/60 text-red-600 hover:bg-red-50 dark:text-red-400 dark:border-red-500/40 dark:hover:bg-red-950/30",
  Oranye: "border-orange-500/60 text-orange-600 hover:bg-orange-50 dark:text-orange-400 dark:border-orange-500/40 dark:hover:bg-orange-950/30",
  Kuning: "border-yellow-500/60 text-yellow-600 hover:bg-yellow-50 dark:text-yellow-400 dark:border-yellow-500/40 dark:hover:bg-yellow-950/30",
};
const LEVEL_BUTTON_CLS_DEFAULT = "border-border text-muted-foreground hover:bg-muted";

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function KabTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; payload: { status: string } }[];
  label?: string;
}) {
  if (!active || !payload?.length || !label) return null;
  const status = payload[0].payload.status;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold mb-0.5 max-w-[180px]">{label}</p>
      <p className="text-muted-foreground flex items-center gap-1.5">
        <span
          className="inline-block w-2 h-2 rounded-sm"
          style={{ backgroundColor: STATUS_COLOR[status] }}
        />
        {status} · {fmtNum(payload[0].value)} toko
      </p>
    </div>
  );
}

// ─── Insight Card ─────────────────────────────────────────────────────────────

function InsightCard({
  title, value, sub, icon, color,
}: {
  title: string; value: string; sub?: string; icon: unknown; color: string;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </p>
          <span style={{ color }} className="opacity-50 shrink-0">
            <HugeiconsIcon icon={toIcon(icon)} size={18} />
          </span>
        </div>
        <p className="text-3xl font-bold leading-none tabular-nums" style={{ color }}>
          {value}
        </p>
        {sub && (
          <p className="text-xs text-muted-foreground mt-1.5 truncate" title={sub}>
            {sub}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Score Slider ─────────────────────────────────────────────────────────────

function ScoreSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const thresholds = [
    { pos: 40, label: "40", color: "#CA8A04" },
    { pos: 65, label: "65", color: "#EA580C" },
    { pos: 85, label: "85", color: "#DC2626" },
  ];
  const trackColor =
    value >= 85 ? "#DC2626" : value >= 65 ? "#EA580C" : value >= 40 ? "#CA8A04" : "#6b7280";

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-medium">Min AEGIS Score (CRS)</label>
        <span
          className="text-sm font-bold tabular-nums px-2 py-0.5 rounded"
          style={{ color: trackColor, backgroundColor: `${trackColor}14` }}
        >
          {value}
        </span>
      </div>
      <div className="relative">
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full h-1.5 appearance-none rounded-full bg-muted cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary
            [&::-webkit-slider-thumb]:shadow
            [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4
            [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary
            [&::-moz-range-thumb]:border-0"
        />
        {/* Threshold markers */}
        <div className="relative mt-1 h-6">
          {thresholds.map(({ pos, label, color }) => (
            <button
              key={pos}
              onClick={() => onChange(pos)}
              className="absolute -translate-x-1/2 flex flex-col items-center gap-0.5 group"
              style={{ left: `${pos}%` }}
              title={`Set ke ${pos}`}
            >
              <div className="w-0.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
              <span
                className="text-[9px] font-bold group-hover:opacity-100 transition-opacity"
                style={{ color, opacity: value === pos ? 1 : 0.55 }}
              >
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Mini Map Section ─────────────────────────────────────────────────────────

const _CAD_BG: Record<string, string> = {
  KRITIS: "#DC262615",
  MERAH:  "#EF444415",
  KUNING: "#F59E0B15",
  NORMAL: "#10B98115",
};

const _CAD_COLOR: Record<string, string> = {
  KRITIS: "#DC2626",
  MERAH:  "#EF4444",
  KUNING: "#F59E0B",
  NORMAL: "#10B981",
};

function MiniMapSection() {
  const [mapData, setMapData] = useState<RegionMapData[]>([]);
  const [mapLoading, setMapLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/aegis/map-data?level=kabupaten`)
      .then((r) => r.json())
      .then((r) => setMapData(r.data ?? []))
      .catch(() => setMapData([]))
      .finally(() => setMapLoading(false));
  }, []);

  const topKabupaten = useMemo(
    () =>
      [...mapData]
        .filter((d) => d.cad_status !== "NORMAL")
        .sort((a, b) => b.warning_count - a.warning_count)
        .slice(0, 5),
    [mapData],
  );

  return (
    <Card>
      <CardHeader className="border-b border-border pb-3">
        <CardTitle className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="flex items-center gap-2">
            <HugeiconsIcon icon={toIcon(MapPinIcon)} size={14} color="#3b82f6" />
            Distribusi AEGIS per Kabupaten
          </span>
          <Link
            href="/aegis/map"
            className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded border text-xs font-medium transition-colors
              border-blue-500/50 text-blue-600 hover:bg-blue-50
              dark:text-blue-400 dark:border-blue-500/40 dark:hover:bg-blue-950/30 normal-case tracking-normal"
          >
            Lihat Peta Lengkap
            <HugeiconsIcon icon={toIcon(ChevronRightIcon)} size={11} />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 pb-3 px-3">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-4 items-start">
          <div>
            {mapLoading ? (
              <div className="h-[200px] rounded-xl bg-muted/30 animate-pulse flex items-center justify-center">
                <span className="text-xs text-muted-foreground">Memuat peta…</span>
              </div>
            ) : (
              <AegisMap data={mapData} loading={false} mini height={350} />
            )}
          </div>
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Kabupaten Bermasalah</p>
            {mapLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 rounded-lg" />
              ))
            ) : topKabupaten.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">Semua kabupaten kondisi normal</p>
            ) : (
              topKabupaten.map((r) => (
                <Link
                  key={r.nama}
                  href="/aegis/map"
                  className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-[10px] font-medium truncate">{r.nama}</p>
                    <p className="text-[9px] text-muted-foreground">{r.warning_count} warning</p>
                  </div>
                  <span
                    className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{
                      color: _CAD_COLOR[r.cad_status],
                      backgroundColor: _CAD_BG[r.cad_status],
                    }}
                  >
                    {r.cad_status}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AegisPage() {
  const router = useRouter();
  const [exportingPdf, setExportingPdf] = useState(false);
  const [stores, setStores]           = useState<StoreWarning[]>([]);
  const [warningMeta, setWarningMeta] = useState<WarningsMeta>({ volume_at_risk_total: 0, volume_at_risk_pct: 0 });
  const [cadAlerts, setCadAlerts]     = useState<CadAlert[]>([]);
  const [loading, setLoading]         = useState(true);
  const [cadLoading, setCadLoading]   = useState(true);
  const [filterOpen, setFilterOpen]   = useState(false);

  // Draft (uncommitted) filter state
  const [draftScore, setDraftScore]       = useState(40);
  const [draftClusters, setDraftClusters] = useState<string[]>([]);
  const [draftSearch, setDraftSearch]     = useState("");

  // Applied filter state (triggers re-filter)
  const [appliedScore, setAppliedScore]       = useState(40);
  const [appliedClusters, setAppliedClusters] = useState<string[]>([]);
  const [appliedSearch, setAppliedSearch]     = useState("");

  const [page, setPage] = useState(0);

  const [batchPredict, setBatchPredict] = useState<Record<string, BatchPredictItem>>({});
  const [batchPredictLoading, setBatchPredictLoading] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/aegis/warnings?min_score=0&limit=6000`)
      .then((r) => r.json())
      .then((r) => {
        setStores(r.data ?? []);
        setWarningMeta({
          volume_at_risk_total: Number(r.meta?.volume_at_risk_total ?? 0),
          volume_at_risk_pct: Number(r.meta?.volume_at_risk_pct ?? 0),
        });
      })
      .catch((err: unknown) => {
        console.error("warnings fetch failed:", err);
        setStores([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetch(`${API}/api/aegis/cad-alert`)
      .then((r) => r.json())
      .then((r) => setCadAlerts(r.data ?? []))
      .finally(() => setCadLoading(false));
  }, []);

  const applyFilter = useCallback(() => {
    setAppliedScore(draftScore);
    setAppliedClusters([...draftClusters]);
    setAppliedSearch(draftSearch);
    setPage(0);
  }, [draftScore, draftClusters, draftSearch]);

  const resetFilter = () => {
    setDraftScore(40);
    setDraftClusters([]);
    setDraftSearch("");
    setAppliedScore(40);
    setAppliedClusters([]);
    setAppliedSearch("");
    setPage(0);
  };

  const toggleCluster = (c: string) =>
    setDraftClusters((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));

  const isDirty =
    draftScore !== appliedScore ||
    draftClusters.join(",") !== appliedClusters.join(",") ||
    draftSearch !== appliedSearch;

  // Client-side filtering
  const filtered = useMemo(() => {
    const q = appliedSearch.trim().toLowerCase();
    return stores.filter((s) => {
      if (s.aegis_score < appliedScore) return false;
      if (appliedClusters.length > 0 && !appliedClusters.includes(s.cluster_pareto)) return false;
      if (q && !s.nama_toko.toLowerCase().includes(q) && !s.kabupaten.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [stores, appliedScore, appliedClusters, appliedSearch]);

  // Insight computations
  const insights = useMemo(() => {
    const warning = filtered.filter((s) => s.level !== "Normal");
    const merahCount = warning.filter((s) => s.level === "Merah").length;
    const merahPct =
      warning.length > 0 ? ((merahCount / warning.length) * 100).toFixed(1) : "0";

    const kabCounts: Record<string, number> = {};
    warning.forEach((s) => {
      kabCounts[s.kabupaten] = (kabCounts[s.kabupaten] ?? 0) + 1;
    });
    const topKab = Object.entries(kabCounts).sort((a, b) => b[1] - a[1])[0];

    const polaCounts: Record<string, number> = {};
    warning.forEach((s) => {
      const k = s.pola_kode ?? s.pola?.[0];
      if (k && POLA_META[k]) polaCounts[k] = (polaCounts[k] ?? 0) + 1;
    });
    const topPola = Object.entries(polaCounts).sort((a, b) => b[1] - a[1])[0];

    return { total: warning.length, merahPct, topKab, topPola };
  }, [filtered]);

  const polaDist = useMemo(() => {
    const counts: Record<string, number> = {};
    const churnSum: Record<string, number> = {};
    const ifSum: Record<string, number> = {};
    filtered.forEach((s) => {
      const k = s.pola_kode ?? s.pola[0];
      counts[k]    = (counts[k]    ?? 0) + 1;
      churnSum[k]  = (churnSum[k]  ?? 0) + (s.churn_prob ?? 0);
      ifSum[k]     = (ifSum[k]     ?? 0) + (s.if_score   ?? 0);
    });
    const result: Record<string, PolaStats> = {};
    Object.keys(counts).forEach((k) => {
      result[k] = {
        count:    counts[k],
        avgChurn: churnSum[k] / counts[k],
        avgIf:    ifSum[k]    / counts[k],
      };
    });
    return result;
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages - 1);
  const paginated  = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  // Fetch batch predictions for the current page whenever it changes
  useEffect(() => {
    if (paginated.length === 0) return;
    const ids = paginated.map((s) => s.id_toko);
    setBatchPredictLoading(true);
    fetch(`${API}/api/aegis/predict/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_toko_list: ids, limit: ids.length }),
    })
      .then((r) => r.json())
      .then((j) => {
        const map: Record<string, BatchPredictItem> = {};
        ((j.data ?? []) as BatchPredictItem[]).forEach((item) => {
          map[item.id_toko] = item;
        });
        setBatchPredict((prev) => ({ ...prev, ...map }));
      })
      .catch((err: unknown) => console.error("batch predict error:", err))
      .finally(() => setBatchPredictLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safePage, filtered]);

  const chartData = cadAlerts.slice(0, 10).map((a) => ({
    name:   a.kabupaten.replace(/^KABUPATEN /, "KAB. ").replace(/^KOTA /, "KOTA "),
    value:  a.jumlah_toko,
    status: a.status,
  }));

  // Page number buttons for pagination
  const pageButtons = useMemo(() => {
    const total = totalPages;
    const cur = safePage;
    if (total <= 7) return Array.from({ length: total }, (_, i) => i);
    if (cur < 4) return [0, 1, 2, 3, 4, 5, 6];
    if (cur > total - 5) return Array.from({ length: 7 }, (_, i) => total - 7 + i);
    return [cur - 3, cur - 2, cur - 1, cur, cur + 1, cur + 2, cur + 3];
  }, [totalPages, safePage]);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="pt-16 max-w-7xl mx-auto px-6 py-8 space-y-5">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">AEGIS Monitor</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full
                               bg-blue-100 text-blue-700 dark:bg-blue-900/30
                               dark:text-blue-400 border border-blue-200">
                AI-Powered Early Warning System
              </span>
              <span className="text-sm text-muted-foreground">
                Pantau toko yang mulai bermasalah · Bantu tim sales tentukan prioritas kunjungan
              </span>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={exportingPdf}
            onClick={async () => {
              setExportingPdf(true);
              try {
                const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
                await downloadFile(
                  `${API}/api/export/aegis-report`,
                  "GET",
                  undefined,
                  `AEGIS_Report_${today}.pdf`,
                );
              } catch (e) {
                console.error("Export PDF failed:", e);
              } finally {
                setExportingPdf(false);
              }
            }}
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {exportingPdf ? "Generating…" : "Export PDF"}
          </Button>
        </div>

        {/* ── Filter card (collapsible) ─────────────────────────────────── */}
        <Card>
          <button className="w-full text-left" onClick={() => setFilterOpen((o) => !o)}>
            <CardHeader className={filterOpen ? "border-b border-border pb-3" : "pb-3"}>
              <CardTitle className="flex items-center gap-2 text-sm">
                <HugeiconsIcon icon={toIcon(FilterIcon)} size={15} />
                Filter
                {!filterOpen && (
                  <span className="ml-1 text-xs font-normal text-muted-foreground normal-case tracking-normal">
                    {appliedScore > 40 || appliedClusters.length > 0 || appliedSearch !== ""
                      ? `Min Score: ${appliedScore} · Cluster: ${appliedClusters.length > 0 ? appliedClusters.join(", ") : "Semua"}${appliedSearch ? ` · "${appliedSearch}"` : ""}`
                      : "Semua toko warning"}{" "}
                    · ↕ Buka Filter
                  </span>
                )}
                <span className="ml-auto text-muted-foreground">
                  <HugeiconsIcon
                    icon={toIcon(filterOpen ? ChevronUpIcon : ChevronDownIcon)}
                    size={14}
                  />
                </span>
              </CardTitle>
            </CardHeader>
          </button>

          <div
            className={`grid transition-all duration-200 ${filterOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
          >
          <div className="overflow-hidden">
            <CardContent className="pt-5 space-y-5">
              <ScoreSlider value={draftScore} onChange={setDraftScore} />

              <div>
                <p className="text-xs font-medium mb-2">Cluster Pareto</p>
                <div className="flex flex-wrap gap-2">
                  {CLUSTERS.map((c) => {
                    const active = draftClusters.includes(c);
                    return (
                      <button
                        key={c}
                        onClick={() => toggleCluster(c)}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                          active
                            ? "bg-foreground text-background border-foreground"
                            : "bg-transparent text-muted-foreground border-border hover:border-foreground/50 hover:text-foreground"
                        }`}
                      >
                        {c}
                      </button>
                    );
                  })}
                  {draftClusters.length > 0 && (
                    <button
                      onClick={() => setDraftClusters([])}
                      className="px-3 py-1 rounded-full text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Hapus semua
                    </button>
                  )}
                </div>
              </div>

              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
                  <HugeiconsIcon icon={toIcon(SearchIcon)} size={14} />
                </span>
                <input
                  type="text"
                  placeholder="Cari nama toko atau kabupaten…"
                  value={draftSearch}
                  onChange={(e) => setDraftSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilter()}
                  className="w-full pl-9 pr-4 py-2 text-sm rounded-md border border-border bg-background
                    placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
                />
              </div>

              <div className="flex items-center gap-3 pt-1">
                <button
                  onClick={applyFilter}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-foreground text-background
                    hover:bg-foreground/90 transition-colors"
                >
                  Terapkan Filter
                </button>
                <button
                  onClick={resetFilter}
                  className="px-4 py-2 rounded-lg text-sm font-medium border border-border
                    hover:bg-muted transition-colors text-muted-foreground"
                >
                  Reset
                </button>
                {isDirty && (
                  <span className="text-xs text-amber-600 dark:text-amber-400 italic">
                    Ada perubahan belum diterapkan
                  </span>
                )}
              </div>
            </CardContent>
          </div>
          </div>
        </Card>

        {/* ── Insight summary ────────────────────────────────────────────── */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <InsightCard
              title="Total Warning"
              value={fmtNum(insights.total)}
              sub="toko dengan AEGIS alert"
              icon={AlertCircleIcon}
              color="#DC2626"
            />
            <InsightCard
              title="% Level Merah"
              value={`${insights.merahPct}%`}
              sub="dari total warning aktif"
              icon={AlertDiamondIcon}
              color="#DC2626"
            />
            <InsightCard
              title="Volume at Risk"
              value={`${fmtNum(warningMeta.volume_at_risk_total)} TON`}
              sub={`${warningMeta.volume_at_risk_pct.toFixed(1)}% dari total volume`}
              icon={AlertCircleIcon}
              color="#DC2626"
            />
            <InsightCard
              title="Kabupaten Paling Terdampak"
              value={insights.topKab ? fmtNum(insights.topKab[1]) + " toko" : "—"}
              sub={insights.topKab
                ? insights.topKab[0].replace(/^KABUPATEN /, "KAB. ")
                : "Tidak ada data"}
              icon={MapPinIcon}
              color="#EA580C"
            />
            <InsightCard
              title="Pola Dominan"
              value={
                insights.topPola
                  ? (POLA_META[insights.topPola[0]]?.label ?? insights.topPola[0])
                  : "—"
              }
              sub={
                insights.topPola
                  ? `${fmtNum(insights.topPola[1])} toko · ${POLA_META[insights.topPola[0]]?.desc ?? insights.topPola[0]}`
                  : ""
              }
              icon={ActivityIcon}
              color="#CA8A04"
            />
          </div>
        )}

        {/* ── Peta Choropleth ──────────────────────────────────────────────── */}
        <MiniMapSection />

        {/* ── CAD Alert bar chart ───────────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <HugeiconsIcon icon={toIcon(BarChartHorizontalIcon)} size={14} color="#3b82f6" />
              Top 10 Kabupaten — Jumlah Toko Warning
              <span className="text-xs font-normal text-muted-foreground normal-case tracking-normal">
                Banyak toko bermasalah di wilayah yang sama — kemungkinan ada faktor eksternal
              </span>
              <Link
                href="/aegis/cad-history"
                className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded border text-xs font-medium transition-colors
                  border-blue-500/50 text-blue-600 hover:bg-blue-50
                  dark:text-blue-400 dark:border-blue-500/40 dark:hover:bg-blue-950/30"
              >
                Lihat History
                <HugeiconsIcon icon={toIcon(ChevronRightIcon)} size={11} />
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-5">
            {cadLoading ? (
              <Skeleton className="h-64 w-full rounded-xl" />
            ) : (
              <>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={chartData}
                    layout="vertical"
                    margin={{ top: 0, right: 48, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid
                      horizontal={false}
                      strokeDasharray="3 3"
                      stroke="currentColor"
                      strokeOpacity={0.07}
                    />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={162}
                      tick={{ fontSize: 10.5 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      content={<KabTooltip />}
                      cursor={{ fill: "currentColor", fillOpacity: 0.04 }}
                    />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={22}>
                      {chartData.map((e, i) => (
                        <Cell key={i} fill={STATUS_COLOR[e.status] ?? "#6b7280"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex items-center gap-5 justify-center mt-3">
                  {(["KRITIS", "MERAH", "KUNING"] as const).map((s) => (
                    <div key={s} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-sm"
                        style={{ backgroundColor: STATUS_COLOR[s] }}
                      />
                      {s}
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* ── Distribusi Pola ───────────────────────────────────────────── */}
        <div>
          <h2 className="text-sm font-semibold mb-3">Tipe Masalah yang Terdeteksi</h2>
          {loading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {Object.entries(POLA_META).map(([key, meta]) => {
                const stats = polaDist[key];
                return (
                  <Card key={key}>
                    <CardContent className="pt-3 pb-3">
                      <div className="flex items-start justify-between mb-1">
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor: `${meta.color}18`,
                            color: meta.color,
                            border: `1px solid ${meta.color}30`,
                          }}
                        >
                          {meta.label}
                        </span>
                        <span
                          className="text-xl font-bold tabular-nums"
                          style={{ color: meta.color }}
                        >
                          {fmtNum(stats?.count ?? 0)}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-tight">{meta.desc}</p>
                      <p className="text-[9px] text-muted-foreground/50 font-mono mt-0.5">{key}</p>
                      {stats && stats.count > 0 && (
                        <p className="text-[9px] text-muted-foreground/60 mt-1.5 flex items-center gap-1">
                          <span>Risiko {(stats.avgChurn * 100).toFixed(0)}%</span>
                          <span className="opacity-40">·</span>
                          <span>Anomali {stats.avgIf.toFixed(0)}</span>
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Detail table ──────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <HugeiconsIcon icon={toIcon(AlertCircleIcon)} size={14} color="#DC2626" />
              Detail Toko Warning
              {!loading && (
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  {fmtNum(filtered.length)} toko · halaman {safePage + 1} / {totalPages}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 px-0">
            {loading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 rounded" />
                ))}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur-sm">
                    <TableRow className="border-b border-muted/50 hover:bg-transparent">
                      <TableHead className="pl-4 text-xs uppercase tracking-wider">Nama Toko</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">Kabupaten</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">Cluster</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">TSO</TableHead>
                      <TableHead className="text-right text-xs uppercase tracking-wider">
                        <span className="inline-flex items-center gap-1 justify-end">
                          Score
                          <span
                            className="text-muted-foreground/50 text-[10px] cursor-help"
                            title="AEGIS Score = CRS×50% + Isolation Forest×20% + XGBoost×30%"
                          >
                            ⓘ
                          </span>
                        </span>
                      </TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">
                        <span className="inline-flex items-center gap-1">
                          Prediksi 4W
                          <span
                            className="text-muted-foreground/50 text-[10px] cursor-help"
                            title="Prediksi AEGIS Score 4 minggu ke depan (Prophet forecasting)"
                          >
                            ⓘ
                          </span>
                        </span>
                      </TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">Level</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">Pola</TableHead>
                      <TableHead className="text-right text-xs uppercase tracking-wider">Risiko</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">Anomali</TableHead>
                      <TableHead className="w-28"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginated.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={11} className="text-center py-14 text-muted-foreground">
                          <div className="flex flex-col items-center gap-2">
                            <HugeiconsIcon icon={toIcon(AlertCircleIcon)} size={28} />
                            <p className="text-sm font-medium">
                              Tidak ada toko yang sesuai filter
                            </p>
                            <button
                              onClick={resetFilter}
                              className="text-xs text-foreground underline underline-offset-2 mt-0.5"
                            >
                              Reset filter
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginated.map((s) => {
                        const lc = LEVEL_COLOR[s.level] ?? "#6b7280";
                        const pk = s.pola_kode ?? s.pola[0];
                        const pc = POLA_META[pk]?.color ?? "#6b7280";
                        return (
                          <TableRow
                            key={s.id_toko}
                            className="cursor-pointer hover:bg-muted/30 border-b border-muted/50"
                            onClick={() => router.push(`/aegis/store/${s.id_toko}`)}
                          >
                            <TableCell
                              className="pl-4 font-medium max-w-[180px] truncate"
                              title={s.nama_toko}
                            >
                              <Link
                                href={`/aegis/store/${s.id_toko}`}
                                onClick={(e) => e.stopPropagation()}
                                className="hover:underline underline-offset-2 hover:text-primary transition-colors"
                              >
                                {s.nama_toko}
                              </Link>
                            </TableCell>
                            <TableCell className="text-muted-foreground max-w-[140px] truncate">
                              {s.kabupaten.replace(/^KABUPATEN /, "KAB. ")}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {s.cluster_pareto}
                            </TableCell>
                            <TableCell
                              className="text-muted-foreground max-w-[120px] truncate"
                              title={s.tso}
                            >
                              {s.tso.replace(/^TSO-\d+ /, "")}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">
                              {s.aegis_score.toFixed(1)}
                            </TableCell>
                            <TableCell>
                              {(() => {
                                const bp = batchPredict[s.id_toko];
                                if (batchPredictLoading && !bp) {
                                  return <Skeleton className="h-4 w-14 rounded" />;
                                }
                                if (!bp || bp.status === "insufficient_data" || bp.status === "error") {
                                  return <span className="text-muted-foreground/40 text-[10px]">—</span>;
                                }
                                const delta = bp.trend_delta ?? 0;
                                const arrow = delta > 3 ? "↑" : delta < -3 ? "↓" : "→";
                                const color = bp.trend_color === "red" ? "#DC2626"
                                  : bp.trend_color === "orange" ? "#EA580C"
                                  : bp.trend_color === "green" ? "#16a34a"
                                  : bp.trend_color === "blue" ? "#3b82f6"
                                  : "#6b7280";
                                const tooltip = `Prediksi 4 minggu: ${bp.predicted_score_4w?.toFixed(1)} (Level: ${bp.predicted_level_4w})${bp.level_change ? " — Level berubah!" : ""}`;
                                return (
                                  <span
                                    className="inline-flex items-center gap-1 text-xs font-semibold cursor-help"
                                    style={{ color }}
                                    title={tooltip}
                                  >
                                    <span className="text-base leading-none">{arrow}</span>
                                    <span className="tabular-nums text-[11px]">
                                      {bp.predicted_score_4w?.toFixed(1)}
                                    </span>
                                  </span>
                                );
                              })()}
                            </TableCell>
                            <TableCell>
                              <span
                                className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold cursor-help"
                                style={{
                                  backgroundColor: `${lc}18`,
                                  color: lc,
                                  border: `1px solid ${lc}30`,
                                }}
                                title={LEVEL_DESC[s.level]}
                              >
                                {s.level}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span
                                className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                                style={{
                                  color: pc,
                                  backgroundColor: `${pc}12`,
                                }}
                              >
                                {POLA_META[pk]?.label ?? pk}
                              </span>
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs">
                              <span
                                style={{
                                  color: s.churn_prob >= 0.8
                                    ? "#DC2626"
                                    : s.churn_prob >= 0.5
                                    ? "#CA8A04"
                                    : "#6b7280",
                                  fontWeight: s.churn_prob >= 0.5 ? 600 : 400,
                                }}
                              >
                                {Math.round(s.churn_prob * 100)}%
                              </span>
                            </TableCell>
                            <TableCell>
                              {s.if_label === -1 ? (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#DC2626]/10 text-[#DC2626] border border-[#DC2626]/25">
                                  Anomali
                                </span>
                              ) : (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                  Normal
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="pr-3">
                              <Link
                                href={`/aegis/store/${s.id_toko}`}
                                onClick={(e) => e.stopPropagation()}
                                title="Lihat detail toko + penjelasan SHAP kenapa toko ini berisiko"
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded border text-xs font-medium transition-colors ${LEVEL_BUTTON_CLS[s.level] ?? LEVEL_BUTTON_CLS_DEFAULT}`}
                              >
                                Lihat Detail
                                <HugeiconsIcon icon={toIcon(ChevronRightIcon)} size={11} />
                              </Link>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={safePage === 0}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
                        border border-border hover:bg-muted transition-colors
                        disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <HugeiconsIcon icon={toIcon(ChevronLeftIcon)} size={13} />
                      Sebelumnya
                    </button>
                    <div className="flex items-center gap-1">
                      {pageButtons.map((p) => (
                        <button
                          key={p}
                          onClick={() => setPage(p)}
                          className={`w-7 h-7 rounded text-xs font-medium transition-colors ${
                            p === safePage
                              ? "bg-foreground text-background"
                              : "hover:bg-muted text-muted-foreground"
                          }`}
                        >
                          {p + 1}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={safePage >= totalPages - 1}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
                        border border-border hover:bg-muted transition-colors
                        disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Berikutnya
                      <HugeiconsIcon icon={toIcon(ChevronRightIcon)} size={13} />
                    </button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground pb-1">
          CORE Platform v2 · AEGIS Monitor
        </p>
        <p className="text-center text-[10px] text-muted-foreground/60 pb-4">
          Data berbasis transaksi. Validasi lapangan oleh TSO diperlukan untuk konfirmasi kondisi aktual.
        </p>
      </main>
    </div>
  );
}
