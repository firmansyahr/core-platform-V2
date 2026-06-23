"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { ChevronRight, Sparkles, RefreshCw, FileText, Gift, AlertTriangle, Swords, TrendingUp, GitBranch, Scale, CheckCircle, AlertCircle } from "lucide-react";
import AegisMap from "@/components/aegis/AegisMap";
import type { RegionMapData } from "@/components/aegis/AegisMap";
import { apiFetch } from "@/lib/fetch";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  AnalyticsIcon,
  AnalyticsUpIcon,
  AnalyticsDownIcon,
  BuildingIcon,
  AlertCircleIcon,
  AlertDiamondIcon,
  ChartAreaIcon,
  AwardIcon,
  PackageIcon,
  PieChartIcon,
  BarChartIcon,
  Globe02Icon,
} from "@hugeicons/core-free-icons";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  Treemap,
  Label,
  BarChart,
  Bar,
} from "recharts";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ─── Types ────────────────────────────────────────────────────────────────────

interface HomeSummary {
  volume_bulan_ini: number;
  growth_mom_pct: number;
  growth_yoy_pct: number | null;
  toko_aktif: number;
  fighting_brand_share_pct: number;
  warning_merah: number;
  warning_oranye: number;
  warning_kuning: number;
  cad_alert_count: number;
  volume_at_risk: number;
  volume_at_risk_pct: number;
}

interface CadAlert {
  kabupaten: string;
  status: "KRITIS" | "MERAH" | "KUNING";
  jumlah_toko: number;
}

interface TopStore {
  id_toko: string;
  nama_toko: string;
  kabupaten: string;
  cluster_pareto: string;
  tso: string;
  aegis_score: number;
  level: string;
  pola: string;
  top_risk_factor?: string | null;
}

interface TrendPoint {
  bulan: string;
  volume: number;
}

interface WeeklyTrend {
  minggu: string;
  merah: number;
  oranye: number;
  kuning: number;
  total: number;
}

interface BrandMix {
  main_brand_ton: number;
  companion_ton: number;
  fighting_ton: number;
  total_ton: number;
  main_pct: number;
  companion_pct: number;
  fighting_pct: number;
}

interface HeatmapItem {
  provinsi: string;
  total_warning: number;
  merah: number;
  oranye: number;
  kuning: number;
  pct_merah: number;
  total_ton: number;
}

interface LoyaltyAchievement {
  total: number;
  avg_achievement_pct: number;
  on_track: number;
  at_risk: number;
  below_target: number;
  triggers: number;
  lowest_achievers: { id_toko: string; nama_toko: string; cluster_pareto: string; achievement_pct: number; status: string }[];
  bulan_target: string | null;
  efektivitas_bulan_ini?: {
    volume_achievement_pct: number;
    peserta_aktif_pct: number;
    efektivitas_pct: number;
    interpretasi: string;
  } | null;
}

interface CadSummary {
  pending_validasi: number;
  in_progress: number;
}

interface TriItem {
  provinsi: string;
  verdict: string;
  top_competitor?: { brand: string } | null;
}

interface ActivePromo {
  id: string;
  nama_promo: string;
  tipe_program?: string;
}

interface PerfOverview {
  total_dipantau: number;
  membaik: number;
  stabil: number;
  perlu_perhatian: number;
  dalam_pemantauan: number;
}

interface GmmSummary {
  total_toko: number;              // cross-checked terhadap data production yang live, BUKAN skala training
  total_toko_model_training: number; // skala dataset training penuh — transparansi teknis, tidak dirender
  validation_summary: {
    kanibalisasi_total_toko: number;
    de_kanibalisasi_total_toko: number;
    fighting_brand_total_toko: number;
    tekanan_eksternal_total_toko: number;
  };
}

interface CausalSummary {
  status: string;
  ate_pct: number;
  att_naive_pct: number;
  refutation_passed: boolean;
  n_treated: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtNum = (n: number) =>
  new Intl.NumberFormat("id-ID").format(Math.round(n));

const fmtTon = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}Jt`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
};

const fmtPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

const fmtBulan = (b: string) => {
  const [y, m] = b.split("-");
  const names = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  return `${names[+m - 1]} '${y.slice(2)}`;
};

const LEVEL_COLOR: Record<string, string> = {
  Merah:  "#DC2626",
  Oranye: "#EA580C",
  Kuning: "#CA8A04",
};

const toIcon = (i: unknown) => i as IconSvgElement;

function heatColor(pctMerah: number): string {
  if (pctMerah >= 70) return "#7f1d1d";
  if (pctMerah >= 50) return "#DC2626";
  if (pctMerah >= 30) return "#EA580C";
  if (pctMerah >= 10) return "#D97706";
  return "#CA8A04";
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  title: string;
  value: string;
  delta?: string;
  deltaUp?: boolean;
  sub?: string;
  icon: unknown;
  accentColor: string;
}

function KpiCard({ title, value, delta, deltaUp, sub, icon, accentColor }: KpiCardProps) {
  return (
    <Card
      className="overflow-hidden"
      style={{ borderBottom: `3px solid ${accentColor}` }}
    >
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4">
          <p className="text-xs font-semibold tracking-wider uppercase text-muted-foreground leading-tight">
            {title}
          </p>
          <span className="text-muted-foreground/50 shrink-0 ml-2">
            <HugeiconsIcon icon={toIcon(icon)} size={20} />
          </span>
        </div>
        <p className="text-4xl font-bold tabular-nums leading-none tracking-tight">
          {value}
        </p>
        {delta !== undefined && (
          <div className="mt-3">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                deltaUp === true
                  ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                  : deltaUp === false
                  ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {deltaUp !== undefined && (
                <HugeiconsIcon
                  icon={toIcon(deltaUp ? AnalyticsUpIcon : AnalyticsDownIcon)}
                  size={10}
                />
              )}
              {delta}
            </span>
          </div>
        )}
        {sub && (
          <p className="text-xs text-muted-foreground mt-1.5">{sub}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Custom Tooltips ──────────────────────────────────────────────────────────

function VolumeTip({
  active, payload, label,
}: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-xl text-xs">
      <p className="font-semibold text-foreground mb-0.5">{fmtBulan(label)}</p>
      <p className="text-muted-foreground">
        Volume:{" "}
        <span className="font-bold text-foreground">{fmtNum(payload[0].value)} ton</span>
      </p>
    </div>
  );
}

function WeeklyTip({
  active, payload, label,
}: { active?: boolean; payload?: { name: string; value: number; fill: string }[]; label?: string }) {
  if (!active || !payload?.length || !label) return null;
  const total = payload.reduce((s, p) => s + p.value, 0);
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-xl text-xs space-y-0.5 min-w-[130px]">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {[...payload].reverse().map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.fill }} />
            <span className="text-muted-foreground capitalize">{p.name}</span>
          </span>
          <span className="font-semibold tabular-nums">{p.value}</span>
        </div>
      ))}
      <div className="border-t border-border mt-1 pt-1 flex justify-between font-semibold">
        <span className="text-muted-foreground">Total</span>
        <span>{total}</span>
      </div>
    </div>
  );
}

// ─── Treemap Custom Cell ──────────────────────────────────────────────────────

interface TreeCellProps {
  x?: number; y?: number; width?: number; height?: number;
  depth?: number; name?: string; value?: number;
  pct_merah?: number; merah?: number; total_warning?: number;
}

function TreeCell({ x = 0, y = 0, width = 0, height = 0, depth = 0, name = "", pct_merah = 0, total_warning = 0 }: TreeCellProps) {
  if (depth !== 1 || width < 10 || height < 10) return null;
  const fill = heatColor(pct_merah);
  const short = name.replace(/^(PROVINSI |DAERAH ISTIMEWA |DAERAH KHUSUS IBUKOTA )/, "");
  return (
    <g>
      <rect x={x} y={y} width={width} height={height}
        style={{ fill, stroke: "white", strokeWidth: 1.5, opacity: 0.92 }} rx={2} />
      {width > 55 && height > 36 && (
        <>
          <text x={x + width / 2} y={y + height / 2 - (height > 50 ? 6 : 0)}
            textAnchor="middle" fill="white" fontSize={Math.min(11, width / 8)}
            fontWeight="700" style={{ textShadow: "0 1px 2px rgba(0,0,0,.4)" }}>
            {short}
          </text>
          {height > 50 && (
            <text x={x + width / 2} y={y + height / 2 + 10}
              textAnchor="middle" fill="rgba(255,255,255,.8)" fontSize={9}>
              {total_warning}
            </text>
          )}
        </>
      )}
    </g>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const router = useRouter();
  const [summary,      setSummary]      = useState<HomeSummary | null>(null);
  const [cadAlerts,    setCadAlerts]    = useState<CadAlert[]>([]);
  const [topStores,    setTopStores]    = useState<TopStore[]>([]);
  const [trend,        setTrend]        = useState<TrendPoint[]>([]);
  const [weeklyTrend,  setWeeklyTrend]  = useState<WeeklyTrend[]>([]);
  const [brandMix,     setBrandMix]     = useState<BrandMix | null>(null);
  const [heatmap,      setHeatmap]      = useState<HeatmapItem[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [insightLoad,  setInsightLoad]  = useState(true);
  const [loyaltyLoad,  setLoyaltyLoad]  = useState(true);
  const [loyaltyData,  setLoyaltyData]  = useState<LoyaltyAchievement | null>(null);
  const [error,        setError]        = useState<string | null>(null);
  const [topWilayah,   setTopWilayah]   = useState<RegionMapData[]>([]);
  const [mapLoading,   setMapLoading]   = useState(true);

  interface AiInsight {
    status: string;
    narasi: string | null;
    generated_at?: string;
    tokens_used?: number;
    cached?: boolean;
  }
  const [aiInsight,      setAiInsight]      = useState<AiInsight | null>(null);
  const [aiInsightLoad,  setAiInsightLoad]  = useState(true);
  const [cadSummary,     setCadSummary]     = useState<CadSummary | null>(null);
  const [triData,        setTriData]        = useState<TriItem[]>([]);
  const [triLoad,        setTriLoad]        = useState(true);
  const [activePromos,   setActivePromos]   = useState<ActivePromo[]>([]);
  const [promosLoad,     setPromosLoad]     = useState(true);
  const [perfData,       setPerfData]       = useState<PerfOverview | null>(null);
  const [perfLoad,       setPerfLoad]       = useState(true);
  const [gmmData,        setGmmData]        = useState<GmmSummary | null>(null);
  const [gmmLoad,        setGmmLoad]        = useState(true);
  const [causalData,     setCausalData]     = useState<CausalSummary | null>(null);
  const [causalLoad,     setCausalLoad]     = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/home/summary`).then((r) => r.json()),
      fetch(`${API}/api/aegis/cad-alert`).then((r) => r.json()),
      fetch(`${API}/api/aegis/top-stores?n=5`).then((r) => r.json()),
      fetch(`${API}/api/home/trend`).then((r) => r.json()),
    ])
      .then(([sum, cad, top, tr]) => {
        setSummary(sum.data);
        setCadAlerts(cad.data.slice(0, 8));
        setTopStores(top.data);
        setTrend(tr.data);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));

    // Insight data (secondary, non-blocking)
    Promise.all([
      fetch(`${API}/api/home/warning-trend`).then((r) => r.json()),
      fetch(`${API}/api/home/brand-mix`).then((r) => r.json()),
      fetch(`${API}/api/home/warning-heatmap`).then((r) => r.json()),
    ])
      .then(([wt, bm, hm]) => {
        setWeeklyTrend(wt.data);
        setBrandMix(bm.data);
        setHeatmap(hm.data);
      })
      .catch(() => {})
      .finally(() => setInsightLoad(false));

    // Loyalty achievement (tertiary, non-blocking)
    fetch(`${API}/api/loyalty/targets/summary`)
      .then((r) => r.json())
      .then((j) => setLoyaltyData(j.data ?? null))
      .catch(() => {})
      .finally(() => setLoyaltyLoad(false));

    // New sections — non-blocking, parallel
    Promise.all([
      fetch(`${API}/api/aegis/cad-history/summary`).then((r) => r.json()),
      fetch(`${API}/api/competitor/triangulation`).then((r) => r.json()),
      fetch(`${API}/api/promo?status=Aktif`).then((r) => r.json()),
      fetch(`${API}/api/cannibalization/summary`).then((r) => r.json()),
      fetch(`${API}/api/causal/summary`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([cad, tri, promo, gmm, causal]) => {
        setCadSummary(cad.data ?? null);
        setTriData(Array.isArray(tri.data) ? tri.data : []);
        setActivePromos(Array.isArray(promo.data) ? promo.data : []);
        setGmmData(gmm.data ?? null);
        setCausalData(causal?.data ?? null);
      })
      .catch(() => {})
      .finally(() => { setTriLoad(false); setPromosLoad(false); setGmmLoad(false); setCausalLoad(false); });

    // Performance overview — requires auth, hide gracefully on 401
    apiFetch(`${API}/api/performance/overview`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => setPerfData(j.data ?? null))
      .catch(() => setPerfData(null))
      .finally(() => setPerfLoad(false));
  }, []);

  const fetchAiInsight = useCallback(() => {
    setAiInsightLoad(true);
    fetch(`${API}/api/home/insight`)
      .then((r) => r.json())
      .then((j) => setAiInsight(j.data ?? null))
      .catch(() => {})
      .finally(() => setAiInsightLoad(false));
  }, []);

  useEffect(() => { fetchAiInsight(); }, [fetchAiInsight]);

  useEffect(() => {
    apiFetch(`${API}/api/aegis/map-data?level=kabupaten`)
      .then((r) => r.json())
      .then((j) => {
        const sorted = ((j.data ?? []) as RegionMapData[])
          .filter((d) => d.cad_status !== "NORMAL")
          .sort((a, b) => b.warning_count - a.warning_count)
          .slice(0, 5);
        setTopWilayah(sorted);
      })
      .catch((e: unknown) => console.error("map data error:", e))
      .finally(() => setMapLoading(false));
  }, []);

  // Donut chart data
  const brandData = brandMix
    ? [
        { name: "Semen Elang",  value: brandMix.main_brand_ton,  pct: brandMix.main_pct,      color: "#3b82f6" },
        { name: "Semen Badak",  value: brandMix.companion_ton,   pct: brandMix.companion_pct, color: "#10b981" },
        { name: "Semen Banteng",value: brandMix.fighting_ton,    pct: brandMix.fighting_pct,  color: "#DC2626" },
      ]
    : [];

  const treeData = heatmap.map((d) => ({
    name:          d.provinsi,
    size:          d.total_warning,
    pct_merah:     d.pct_merah,
    merah:         d.merah,
    total_warning: d.total_warning,
  }));

  const maxCadToko = cadAlerts[0]?.jumlah_toko ?? 1;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="pt-16">
        <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">

          {/* ── Page title ──────────────────────────────────────────────── */}
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Dashboard Analitik</h1>
          </div>

          {/* API error */}
          {error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
              Gagal terhubung ke API — pastikan FastAPI berjalan di{" "}
              <code className="font-mono text-xs">{API}</code>. Detail: {error}
            </div>
          )}

          {/* ── CAD Alert Pending Banner ─────────────────────────────────── */}
          {cadSummary && cadSummary.pending_validasi > 0 && (
            <Card className="border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/20">
              <CardContent className="p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400 shrink-0" />
                  <span className="text-sm text-orange-900 dark:text-orange-200">
                    <strong>{cadSummary.pending_validasi}</strong> CAD Alert menunggu validasi
                    {cadSummary.in_progress > 0 && (
                      <span className="text-orange-600 dark:text-orange-400 ml-1">
                        ({cadSummary.in_progress} sedang diproses)
                      </span>
                    )}
                  </span>
                </div>
                <Link href="/aegis/cad-history">
                  <Button size="sm" variant="outline" className="shrink-0 text-xs border-orange-300 hover:bg-orange-100 dark:hover:bg-orange-950">
                    Validasi Sekarang
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {/* ── KPI Cards ───────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <Card key={i}>
                    <CardContent className="p-6 space-y-3">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-9 w-28" />
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </CardContent>
                  </Card>
                ))
              : summary && (
                  <>
                    <KpiCard
                      title="Volume Bulan Ini"
                      value={`${fmtTon(summary.volume_bulan_ini)} ton`}
                      delta={`${fmtPct(summary.growth_mom_pct)} MoM`}
                      deltaUp={summary.growth_mom_pct >= 0}
                      sub={fmtNum(summary.volume_bulan_ini) + " ton total"}
                      icon={AnalyticsIcon}
                      accentColor="#3b82f6"
                    />
                    <KpiCard
                      title="Growth YoY"
                      value={summary.growth_yoy_pct !== null ? fmtPct(summary.growth_yoy_pct) : "N/A"}
                      delta="vs. bulan sama tahun lalu"
                      deltaUp={summary.growth_yoy_pct !== null ? summary.growth_yoy_pct >= 0 : undefined}
                      icon={summary.growth_yoy_pct !== null && summary.growth_yoy_pct >= 0 ? AnalyticsUpIcon : AnalyticsDownIcon}
                      accentColor={summary.growth_yoy_pct !== null && summary.growth_yoy_pct >= 0 ? "#22c55e" : "#DC2626"}
                    />
                    <KpiCard
                      title="Toko Aktif"
                      value={fmtNum(summary.toko_aktif)}
                      sub="Bulan terakhir"
                      icon={BuildingIcon}
                      accentColor="#22c55e"
                    />
                    <KpiCard
                      title="Porsi Produk Murah (Semen Banteng)"
                      value={`${summary.fighting_brand_share_pct.toFixed(1)}%`}
                      delta={summary.fighting_brand_share_pct <= 15 ? "Masih terkendali" : "Perlu perhatian"}
                      deltaUp={summary.fighting_brand_share_pct <= 15}
                      sub="Makin tinggi = makin banyak toko beralih ke produk murah"
                      icon={AlertDiamondIcon}
                      accentColor="#DC2626"
                    />
                    {(() => {
                      const pct = summary.volume_at_risk_pct;
                      const col = pct > 20 ? "#DC2626" : pct >= 10 ? "#EA580C" : "#22c55e";
                      return (
                        <KpiCard
                          title="Volume Berisiko"
                          value={`${fmtTon(summary.volume_at_risk)} ton`}
                          delta={`${pct.toFixed(1)}% volume dari toko bermasalah`}
                          deltaUp={pct <= 10}
                          sub="Total volume dari toko yang sedang bermasalah"
                          icon={AlertCircleIcon}
                          accentColor={col}
                        />
                      );
                    })()}
                  </>
                )}
          </div>

          {/* ── AI Insight Card ────────────────────────────────────────── */}
          {(aiInsightLoad || (aiInsight && aiInsight.status !== "disabled")) && (
            <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="p-1.5 bg-blue-100 dark:bg-blue-900/50 rounded-lg mt-0.5 shrink-0">
                    <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1 gap-2">
                      <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                        AI Insight
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        {aiInsight?.generated_at && !aiInsightLoad && (
                          <span className="text-xs text-muted-foreground">
                            {new Date(aiInsight.generated_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                            {aiInsight.cached && " · cache"}
                          </span>
                        )}
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={fetchAiInsight} disabled={aiInsightLoad}>
                          <RefreshCw className={`h-3 w-3 ${aiInsightLoad ? "animate-spin" : ""}`} />
                        </Button>
                      </div>
                    </div>
                    {aiInsightLoad ? (
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-5/6" />
                        <Skeleton className="h-4 w-4/6" />
                      </div>
                    ) : aiInsight?.status === "error" ? (
                      <p className="text-sm text-muted-foreground">Gagal memuat insight. Coba refresh.</p>
                    ) : aiInsight?.narasi ? (
                      <p className="text-sm text-foreground leading-relaxed">{aiInsight.narasi}</p>
                    ) : null}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Competitor Intelligence + Program Promo + Brand-Shift ────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

            {/* Competitor Intelligence */}
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Swords className="h-4 w-4 text-red-500" />
                  Competitor Intelligence
                </CardTitle>
                <Link href="/competitor" className="text-xs text-primary hover:underline">
                  Lihat Detail →
                </Link>
              </CardHeader>
              <CardContent>
                {triLoad ? (
                  <div className="grid grid-cols-3 gap-3">
                    {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
                  </div>
                ) : (() => {
                  const konfirmasi = triData.filter((t) => t.verdict === "KONFIRMASI_KOMPETITOR").length;
                  const waspada    = triData.filter((t) => t.verdict === "WASPADA_AWAL").length;
                  const kurang     = triData.filter((t) => t.verdict === "TIDAK_CUKUP_DATA").length;
                  const topThreat  = triData.find((t) => t.verdict === "KONFIRMASI_KOMPETITOR");
                  return (
                    <>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="text-center p-2 rounded-lg bg-red-50 dark:bg-red-950/20">
                          <div className="text-xl font-bold text-red-600 dark:text-red-400">{konfirmasi}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">Terkonfirmasi</div>
                        </div>
                        <div className="text-center p-2 rounded-lg bg-yellow-50 dark:bg-yellow-950/20">
                          <div className="text-xl font-bold text-yellow-600 dark:text-yellow-400">{waspada}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">Waspada</div>
                        </div>
                        <div className="text-center p-2 rounded-lg bg-muted">
                          <div className="text-xl font-bold text-muted-foreground">{kurang}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">Data Kurang</div>
                        </div>
                      </div>
                      {topThreat && (
                        <div className="mt-3 pt-3 border-t border-border">
                          <div className="text-xs text-muted-foreground mb-1">Wilayah Paling Kritis</div>
                          <div className="text-sm font-medium">
                            {topThreat.provinsi}
                            {topThreat.top_competitor?.brand && (
                              <span className="text-xs text-red-600 dark:text-red-400 ml-2">— {topThreat.top_competitor.brand}</span>
                            )}
                          </div>
                        </div>
                      )}
                      {triData.length === 0 && (
                        <p className="text-sm text-muted-foreground text-center py-3">Belum ada data triangulasi</p>
                      )}
                    </>
                  );
                })()}
              </CardContent>
            </Card>

            {/* Program Promo Aktif */}
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Gift className="h-4 w-4 text-purple-500" />
                  Program Promo Aktif
                </CardTitle>
                <Link href="/loyalty/promo" className="text-xs text-primary hover:underline">
                  Kelola →
                </Link>
              </CardHeader>
              <CardContent>
                {promosLoad ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
                  </div>
                ) : activePromos.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-6">
                    Belum ada program promo aktif
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activePromos.slice(0, 3).map((promo) => {
                      const tipeLabel =
                        promo.tipe_program === "flat_multiplier" ? "Flat Multiplier" :
                        promo.tipe_program === "multi_tier" ? "Multi-Tier" :
                        promo.tipe_program === "leaderboard" ? "Leaderboard" :
                        promo.tipe_program ?? "–";
                      return (
                        <Link key={promo.id} href={`/loyalty/promo/${promo.id}`}>
                          <div className="flex items-center justify-between p-2.5 rounded-lg border border-border hover:bg-muted/30 transition-colors cursor-pointer">
                            <div>
                              <div className="text-sm font-medium leading-snug">{promo.nama_promo}</div>
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 mt-1">
                                {tipeLabel}
                              </span>
                            </div>
                            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 ml-2" />
                          </div>
                        </Link>
                      );
                    })}
                    {activePromos.length > 3 && (
                      <p className="text-xs text-muted-foreground text-center pt-1">
                        +{activePromos.length - 3} program lainnya
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Analisis Brand-Shift (GMM) */}
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-purple-500" />
                  Analisis Brand-Shift
                </CardTitle>
                <Link href="/ilp" className="text-xs text-primary hover:underline">
                  Lihat ILP →
                </Link>
              </CardHeader>
              <CardContent>
                {gmmLoad ? (
                  <div className="grid grid-cols-2 gap-3">
                    <Skeleton className="h-16 rounded-lg" />
                    <Skeleton className="h-16 rounded-lg" />
                  </div>
                ) : gmmData ? (
                  <>
                    {(() => {
                      const v = gmmData.validation_summary;
                      const kanibalisasi    = v?.kanibalisasi_total_toko ?? 0;
                      const deKanibalisasi  = v?.de_kanibalisasi_total_toko ?? 0;
                      const fightingBrand   = v?.fighting_brand_total_toko ?? 0;
                      const tekananEksternal = v?.tekanan_eksternal_total_toko ?? 0;
                      const total   = gmmData.total_toko ?? 0;
                      const stabil  = Math.max(total - (kanibalisasi + deKanibalisasi + fightingBrand + tekananEksternal), 0);
                      const stabilPct = total > 0 ? ((stabil / total) * 100).toFixed(0) : "0";

                      return (
                        <>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="text-center p-2 rounded-lg bg-blue-50 dark:bg-blue-950/20">
                              <div className="text-lg font-bold text-blue-600 dark:text-blue-400">
                                {kanibalisasi.toLocaleString("id-ID")}
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">Kanibalisasi Internal</div>
                            </div>
                            <div className="text-center p-2 rounded-lg bg-green-50 dark:bg-green-950/20">
                              <div className="text-lg font-bold text-green-600 dark:text-green-400">
                                {deKanibalisasi.toLocaleString("id-ID")}
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">De-Kanibalisasi</div>
                            </div>
                            <div className="text-center p-2 rounded-lg bg-orange-50 dark:bg-orange-950/20">
                              <div className="text-lg font-bold text-orange-600 dark:text-orange-400">
                                {fightingBrand.toLocaleString("id-ID")}
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">Fighting Brand</div>
                            </div>
                            <div className="text-center p-2 rounded-lg bg-red-50 dark:bg-red-950/20">
                              <div className="text-lg font-bold text-red-600 dark:text-red-400">
                                {tekananEksternal.toLocaleString("id-ID")}
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">Tekanan Eksternal</div>
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground mt-3 pt-3 border-t">
                            Dari {total.toLocaleString("id-ID")} toko dianalisis ({stabil.toLocaleString("id-ID")} toko /{" "}
                            {stabilPct}% berstatus stabil/normal, tidak ditampilkan di atas).
                          </p>
                        </>
                      );
                    })()}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    Model GMM belum tersedia
                  </p>
                )}
              </CardContent>
            </Card>

          </div>

          {/* ── Dampak Kausal + Outcome Program Loyalty (berdampingan) ───── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Dampak Kausal Program Loyalty (DoWhy + EconML) */}
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Scale className="h-4 w-4 text-indigo-500" />
                  Dampak Kausal Program Loyalty
                </CardTitle>
              </CardHeader>
              <CardContent>
                {causalLoad ? (
                  <div className="space-y-2">
                    <Skeleton className="h-8 w-32 rounded-lg" />
                    <Skeleton className="h-12 w-full rounded-lg" />
                  </div>
                ) : causalData && causalData.status === "ok" ? (
                  <>
                    <div className="flex items-baseline gap-2 mb-2">
                      <span className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
                        {causalData.ate_pct > 0 ? "+" : ""}{causalData.ate_pct}%
                      </span>
                      <span className="text-xs text-muted-foreground">
                        efek rata-rata (Conditional DiD)
                      </span>
                    </div>

                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Setelah mengontrol baseline volume, cluster, dan aktivitas toko, program
                      loyalty diestimasi {causalData.ate_pct >= 0 ? "meningkatkan" : "menurunkan"}{" "}
                      volume SEMEN ELANG sebesar {Math.abs(causalData.ate_pct)}% dibanding kondisi
                      toko sebelum masuk program.
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 pt-3 border-t text-xs">
                      <div>
                        <span className="text-muted-foreground">Naive DiD (tanpa adjustment)</span>
                        <div className="font-semibold">
                          {causalData.att_naive_pct > 0 ? "+" : ""}{causalData.att_naive_pct}%
                        </div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Refutation Test</span>
                        <div className="font-semibold flex items-center gap-1">
                          {causalData.refutation_passed ? (
                            <><CheckCircle className="h-3 w-3 text-green-600" /> Passed</>
                          ) : (
                            <><AlertCircle className="h-3 w-3 text-yellow-600" /> Perlu Review</>
                          )}
                        </div>
                      </div>
                    </div>

                    <details className="mt-3">
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none">
                        Apa bedanya Naive vs Conditional?
                      </summary>
                      <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                        Naive DiD ({causalData.att_naive_pct > 0 ? "+" : ""}{causalData.att_naive_pct}%) hanya
                        membandingkan volume sebelum/sesudah tanpa mengontrol faktor lain — sering menyesatkan
                        karena toko bermasalah cenderung lebih dulu masuk program. Conditional DiD ({causalData.ate_pct > 0 ? "+" : ""}{causalData.ate_pct}%)
                        mengontrol cluster, baseline volume, dan aktivitas toko, memberikan estimasi dampak
                        yang lebih akurat.
                      </p>
                    </details>

                    <p className="text-xs text-muted-foreground mt-2 italic">
                      Estimasi berbasis {causalData.n_treated.toLocaleString("id-ID")} toko peserta dengan
                      variasi waktu masuk program yang representatif.
                    </p>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    Data dampak kausal belum tersedia
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Performance Tracker Summary */}
            {(perfLoad || perfData) && (
              <Card className="shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-green-500" />
                    Outcome Program Loyalty
                  </CardTitle>
                  <Link href="/performance" className="text-xs text-primary hover:underline">
                    Lihat detail tracker →
                  </Link>
                </CardHeader>
                <CardContent>
                  {perfLoad ? (
                    <div className="flex items-center gap-4">
                      <Skeleton className="h-[100px] w-[100px] rounded-full shrink-0" />
                      <div className="space-y-2 flex-1">
                        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-4 w-32 rounded" />)}
                      </div>
                    </div>
                  ) : perfData && perfData.total_dipantau > 0 ? (() => {
                    const total = perfData.total_dipantau;
                    const verdictData = [
                      { verdict: "Membaik",          count: perfData.membaik,          color: "#22c55e" },
                      { verdict: "Stabil",            count: perfData.stabil,           color: "#3b82f6" },
                      { verdict: "Perlu Perhatian",   count: perfData.perlu_perhatian,  color: "#ef4444" },
                      { verdict: "Dalam Pemantauan",  count: perfData.dalam_pemantauan, color: "#9ca3af" },
                    ].filter((d) => d.count > 0);
                    return (
                      <div className="flex items-center gap-4">
                        <div className="shrink-0">
                          <PieChart width={84} height={84}>
                            <Pie data={verdictData} dataKey="count" innerRadius={24} outerRadius={38} strokeWidth={0}>
                              {verdictData.map((d, i) => <Cell key={i} fill={d.color} />)}
                            </Pie>
                          </PieChart>
                        </div>
                        <div className="space-y-1.5 min-w-0">
                          {verdictData.map((d) => (
                            <div key={d.verdict} className="flex items-center gap-1.5 text-xs">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} />
                              <span className="text-muted-foreground truncate">{d.verdict}:</span>
                              <span className="font-semibold shrink-0">{d.count}</span>
                              <span className="text-muted-foreground shrink-0">({((d.count / total) * 100).toFixed(0)}%)</span>
                            </div>
                          ))}
                          <p className="text-[10px] text-muted-foreground pt-1">{total} toko dipantau</p>
                        </div>
                      </div>
                    );
                  })() : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Belum ada data performance. Login untuk melihat tracker.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* ── Section: Insight Pasar ──────────────────────────────────── */}
          <div>
            <h2 className="text-lg font-semibold mb-4">Insight Pasar</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

              {/* Card A — Heatmap Intensitas Warning per Provinsi */}
              <Card className="shadow-sm">
                <CardHeader className="border-b border-border pb-3">
                  <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <HugeiconsIcon icon={toIcon(Globe02Icon)} size={14} />
                    Heatmap Warning · Provinsi
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  {insightLoad ? (
                    <Skeleton className="h-48 w-full rounded-xl" />
                  ) : treeData.length > 0 ? (
                    <>
                      <ResponsiveContainer width="100%" height={192}>
                        <Treemap
                          data={treeData}
                          dataKey="size"
                          aspectRatio={4 / 3}
                          stroke="transparent"
                          content={<TreeCell />}
                        />
                      </ResponsiveContainer>
                      {/* Color legend */}
                      <div className="flex items-center gap-3 mt-3 flex-wrap">
                        {[
                          { label: "Rendah", color: "#CA8A04" },
                          { label: "Sedang", color: "#D97706" },
                          { label: "Tinggi", color: "#EA580C" },
                          { label: "Kritis", color: "#DC2626" },
                        ].map(({ label, color }) => (
                          <span key={label} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: color }} />
                            {label}
                          </span>
                        ))}
                        <span className="text-[10px] text-muted-foreground ml-auto">% Merah</span>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-10">Memuat data…</p>
                  )}
                </CardContent>
              </Card>

              {/* Card B — Trend 4 Minggu */}
              <Card className="shadow-sm">
                <CardHeader className="border-b border-border pb-3">
                  <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <HugeiconsIcon icon={toIcon(BarChartIcon)} size={14} />
                    Tren Warning · 4 Minggu
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  {insightLoad ? (
                    <Skeleton className="h-48 w-full rounded-xl" />
                  ) : weeklyTrend.length > 0 ? (
                    <>
                      <ResponsiveContainer width="100%" height={192}>
                        <AreaChart data={weeklyTrend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="gKuning" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#CA8A04" stopOpacity={0.6} />
                              <stop offset="95%" stopColor="#CA8A04" stopOpacity={0.1} />
                            </linearGradient>
                            <linearGradient id="gOranye" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#EA580C" stopOpacity={0.7} />
                              <stop offset="95%" stopColor="#EA580C" stopOpacity={0.15} />
                            </linearGradient>
                            <linearGradient id="gMerah" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#DC2626" stopOpacity={0.8} />
                              <stop offset="95%" stopColor="#DC2626" stopOpacity={0.2} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06} />
                          <XAxis dataKey="minggu" tick={{ fontSize: 10, fill: "currentColor" }} tickLine={false} axisLine={false} />
                          <YAxis tick={{ fontSize: 10, fill: "currentColor" }} tickLine={false} axisLine={false} width={32} />
                          <Tooltip content={<WeeklyTip />} />
                          <Area type="monotone" dataKey="kuning" stackId="1" stroke="#CA8A04" strokeWidth={1.5} fill="url(#gKuning)" name="kuning" />
                          <Area type="monotone" dataKey="oranye" stackId="1" stroke="#EA580C" strokeWidth={1.5} fill="url(#gOranye)" name="oranye" />
                          <Area type="monotone" dataKey="merah"  stackId="1" stroke="#DC2626" strokeWidth={1.5} fill="url(#gMerah)"  name="merah"  />
                        </AreaChart>
                      </ResponsiveContainer>
                      <div className="flex items-center justify-center gap-4 mt-2">
                        {[["#CA8A04","Kuning"],["#EA580C","Oranye"],["#DC2626","Merah"]].map(([c,l]) => (
                          <span key={l} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <span className="w-2.5 h-2 rounded-sm inline-block" style={{ background: c }} />
                            {l}
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-10">Memuat data…</p>
                  )}
                </CardContent>
              </Card>

              {/* Card C — Donut Brand Mix */}
              <Card className="shadow-sm">
                <CardHeader className="border-b border-border pb-3">
                  <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <HugeiconsIcon icon={toIcon(PieChartIcon)} size={14} />
                    Mix Brand · Bulan Ini
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  {insightLoad || !brandMix ? (
                    <Skeleton className="h-48 w-full rounded-xl" />
                  ) : (
                    <div className="flex items-center gap-4">
                      <div className="relative shrink-0">
                        <PieChart width={130} height={130}>
                          <Pie
                            data={brandData}
                            cx={60}
                            cy={60}
                            innerRadius={38}
                            outerRadius={58}
                            dataKey="value"
                            strokeWidth={2}
                            stroke="transparent"
                          >
                            {brandData.map((d) => (
                              <Cell key={d.name} fill={d.color} />
                            ))}
                            <Label
                              value={fmtTon(brandMix.total_ton)}
                              position="center"
                              style={{ fontSize: 12, fontWeight: 700, fill: "currentColor" }}
                            />
                          </Pie>
                        </PieChart>
                        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] text-muted-foreground whitespace-nowrap">
                          ton total
                        </span>
                      </div>
                      <div className="flex-1 space-y-2.5">
                        {brandData.map((d) => (
                          <div key={d.name}>
                            <div className="flex items-center justify-between text-xs mb-0.5">
                              <span className="flex items-center gap-1.5">
                                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: d.color, display: "inline-block" }} />
                                <span className="font-medium">{d.name}</span>
                              </span>
                              <span className="tabular-nums font-semibold">{d.pct}%</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${d.pct}%`, background: d.color }} />
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
                              {fmtTon(d.value)} ton
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* ── AEGIS Warning Monitor + Top 5 TSO ──────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* AEGIS Warning Monitor */}
            <Card className="flex flex-col shadow-sm">
              <CardHeader className="border-b border-border pb-3">
                <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <HugeiconsIcon icon={toIcon(AlertCircleIcon)} size={14} color="#DC2626" />
                  AEGIS Warning Monitor
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 flex flex-col gap-4 flex-1">
                {loading ? (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
                    </div>
                    <Skeleton className="h-10 rounded-xl" />
                    <div className="space-y-2.5">
                      {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
                    </div>
                  </>
                ) : summary && (
                  <>
                    {/* Warning level blocks */}
                    <div className="grid grid-cols-3 gap-3">
                      {(
                        [
                          { label: "Merah",  count: summary.warning_merah,  color: "#DC2626" },
                          { label: "Oranye", count: summary.warning_oranye, color: "#EA580C" },
                          { label: "Kuning", count: summary.warning_kuning, color: "#CA8A04" },
                        ] as const
                      ).map(({ label, count, color }) => (
                        <div
                          key={label}
                          className="rounded-xl flex flex-col items-center justify-center py-5 gap-1.5"
                          style={{ backgroundColor: `${color}12`, border: `1px solid ${color}30` }}
                        >
                          <span className="text-5xl font-black tabular-nums leading-none" style={{ color }}>
                            {fmtNum(count)}
                          </span>
                          <span
                            className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full shadow-sm"
                            style={{ backgroundColor: `${color}22`, color }}
                          >
                            {label}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* CAD Alert strip */}
                    <div
                      className="rounded-xl px-4 py-3 flex items-center justify-between"
                      style={{ backgroundColor: "#DC262610", border: "1px solid #DC262628" }}
                    >
                      <div className="flex items-center gap-2">
                        <HugeiconsIcon icon={toIcon(AlertDiamondIcon)} size={14} color="#DC2626" />
                        <span className="text-xs font-semibold text-[#DC2626]">Wilayah yang Perlu Dikunjungi Segera</span>
                      </div>
                      <span className="text-sm font-bold tabular-nums text-[#DC2626]">
                        {fmtNum(summary.cad_alert_count)} toko
                      </span>
                    </div>

                    {/* Kabupaten list with progress bars */}
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        Kabupaten Prioritas
                      </p>
                      {cadAlerts.map((alert) => {
                        const barPct = Math.round(alert.jumlah_toko / maxCadToko * 100);
                        const statusColor = alert.status === "KRITIS" ? "#DC2626" : alert.status === "MERAH" ? "#EA580C" : "#CA8A04";
                        return (
                          <div key={alert.kabupaten} className="space-y-0.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className="shrink-0 rounded text-[9px] font-bold px-1.5 py-0.5"
                                  style={{ background: `${statusColor}22`, color: statusColor, border: `1px solid ${statusColor}40` }}
                                >
                                  {alert.status}
                                </span>
                                <span className="text-xs truncate">
                                  {alert.kabupaten.replace(/^KABUPATEN /, "KAB. ")}
                                </span>
                              </div>
                              <span className="text-xs tabular-nums text-muted-foreground shrink-0 ml-2">
                                {fmtNum(alert.jumlah_toko)}
                              </span>
                            </div>
                            <div className="h-1 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{ width: `${barPct}%`, background: statusColor, opacity: 0.7 }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Top 5 TSO */}
            <Card className="flex flex-col shadow-sm">
              <CardHeader className="border-b border-border pb-3">
                <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <HugeiconsIcon icon={toIcon(AwardIcon)} size={14} color="#8b5cf6" />
                  Top 5 Prioritas TSO
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 flex flex-col gap-3 flex-1">
                {loading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-[76px] rounded-xl" />
                    ))
                  : topStores.map((store, idx) => {
                      const levelColor = LEVEL_COLOR[store.level] ?? "#6b7280";
                      const rankColors = [
                        "from-amber-400 to-yellow-500",
                        "from-slate-400 to-slate-500",
                        "from-amber-700 to-amber-800",
                      ];
                      const scorePct = Math.min(100, store.aegis_score);
                      return (
                        <div
                          key={store.id_toko}
                          className="rounded-xl border border-border/60 px-3 py-3 flex items-start gap-3 hover:bg-muted/30 hover:shadow-sm transition-all"
                        >
                          {/* Rank circle */}
                          <div
                            className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0 text-white ${
                              idx < 3 ? `bg-gradient-to-br ${rankColors[idx]}` : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {idx + 1}
                          </div>

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-xs font-semibold truncate leading-tight">{store.nama_toko}</p>
                              <span
                                className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded"
                                style={{ backgroundColor: `${levelColor}18`, color: levelColor, border: `1px solid ${levelColor}30` }}
                              >
                                {store.level}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                              {store.tso.replace(/^TSO-\d+ /, "")} · {store.kabupaten.replace(/^KABUPATEN /, "KAB. ")}
                            </p>
                            {store.top_risk_factor && (
                              <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5 truncate" title={`Faktor risiko utama: ${store.top_risk_factor}`}>
                                ⚡ {store.top_risk_factor}
                              </p>
                            )}

                            {/* Score progress bar */}
                            <div className="mt-2">
                              <div className="flex items-center justify-between text-[10px] mb-0.5">
                                <span className="text-muted-foreground">{store.cluster_pareto}</span>
                                <span className="font-semibold tabular-nums" style={{ color: levelColor }}>
                                  {store.aegis_score.toFixed(1)}
                                </span>
                              </div>
                              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                <div
                                  className="h-full rounded-full"
                                  style={{ width: `${scorePct}%`, background: levelColor, opacity: 0.8 }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
              </CardContent>
            </Card>
          </div>

          {/* ── Sebaran Warning per Wilayah ────────────────────────────── */}
          <Card className="w-full shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-border">
              <div>
                <CardTitle className="text-sm font-semibold uppercase tracking-wider">
                  Sebaran Warning per Wilayah
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Klik wilayah untuk detail · Data per Apr 2026
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 text-xs"
                onClick={() => router.push("/aegis/map")}
              >
                Buka Peta Penuh
                <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

                {/* Choropleth map — 2/3 width on desktop */}
                <div className="lg:col-span-2">
                  {mapLoading ? (
                    <div className="h-[320px] rounded-xl bg-muted/30 animate-pulse flex items-center justify-center">
                      <span className="text-xs text-muted-foreground">Memuat peta…</span>
                    </div>
                  ) : (
                    <AegisMap
                      data={topWilayah}
                      loading={false}
                      height={320}
                      onRegionClick={(region) =>
                        router.push(`/aegis?search=${encodeURIComponent(region.nama)}`)
                      }
                    />
                  )}
                </div>

                {/* Top warning list — 1/3 width on desktop */}
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    Top Warning
                  </p>
                  {mapLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 rounded-lg" />
                    ))
                  ) : topWilayah.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">
                      Tidak ada wilayah bermasalah
                    </p>
                  ) : (
                    topWilayah.map((w) => (
                      <div
                        key={w.nama}
                        className="flex items-center justify-between p-2 rounded-lg bg-muted/50 hover:bg-muted cursor-pointer transition-colors"
                        onClick={() => router.push(`/aegis?search=${encodeURIComponent(w.nama)}`)}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{w.nama}</p>
                          <p className="text-xs text-muted-foreground">
                            {w.warning_count} warning · {w.warning_pct.toFixed(1)}%
                          </p>
                        </div>
                        <div className="flex items-center gap-1 ml-2 shrink-0">
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0.5 ${
                              w.cad_status === "KRITIS"
                                ? "border-red-500 text-red-600 dark:text-red-400"
                                : w.cad_status === "MERAH"
                                ? "border-orange-500 text-orange-600 dark:text-orange-400"
                                : "border-yellow-500 text-yellow-600 dark:text-yellow-400"
                            }`}
                          >
                            {w.cad_status}
                          </Badge>
                          <ChevronRight className="h-3 w-3 text-muted-foreground" />
                        </div>
                      </div>
                    ))
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full text-xs mt-2"
                    onClick={() => router.push("/aegis/map")}
                  >
                    Lihat semua wilayah
                    <ChevronRight className="h-3 w-3 ml-1" />
                  </Button>
                </div>

              </div>
            </CardContent>
          </Card>

          {/* ── Trend Volume 12 Bulan ───────────────────────────────────── */}
          <Card className="shadow-sm">
            <CardHeader className="border-b border-border pb-3">
              <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <HugeiconsIcon icon={toIcon(ChartAreaIcon)} size={14} color="#3b82f6" />
                Tren Volume 12 Bulan
                <span className="ml-auto text-xs font-normal text-muted-foreground normal-case tracking-normal">
                  Semua brand · TON
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-5">
              {loading ? (
                <Skeleton className="h-56 w-full rounded-xl" />
              ) : (
                <ResponsiveContainer width="100%" height={224}>
                  <LineChart data={trend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06} />
                    <XAxis
                      dataKey="bulan"
                      tickFormatter={fmtBulan}
                      tick={{ fontSize: 11, fill: "currentColor" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tickFormatter={(v: number) => fmtTon(v)}
                      tick={{ fontSize: 11, fill: "currentColor" }}
                      tickLine={false}
                      axisLine={false}
                      width={46}
                    />
                    <Tooltip content={<VolumeTip />} />
                    <Line
                      type="monotone"
                      dataKey="volume"
                      stroke="#3b82f6"
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 5, fill: "#3b82f6", strokeWidth: 0 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* ── Bottom metric cards ─────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {loading
              ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
              : summary && (
                  <>
                    <Card className="shadow-sm">
                      <CardContent className="p-6">
                        <div className="flex items-center gap-2 text-muted-foreground mb-3">
                          <HugeiconsIcon icon={toIcon(AlertCircleIcon)} size={14} color="#DC2626" />
                          <span className="text-xs font-semibold uppercase tracking-wider">ILP Priority</span>
                        </div>
                        <p className="text-3xl font-bold tabular-nums text-[#DC2626]">
                          {fmtNum(summary.warning_merah)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1.5">
                          Toko level Merah · perlu tindakan segera
                        </p>
                      </CardContent>
                    </Card>

                    <Card className="shadow-sm">
                      <CardContent className="p-6">
                        <div className="flex items-center gap-2 text-muted-foreground mb-3">
                          <HugeiconsIcon icon={toIcon(PackageIcon)} size={14} color="#EA580C" />
                          <span className="text-xs font-semibold uppercase tracking-wider">Platinum Risk</span>
                        </div>
                        <p className="text-3xl font-bold tabular-nums text-[#EA580C]">
                          {fmtNum(summary.cad_alert_count)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1.5">
                          CAD Alert aktif · indikasi potensi tekanan eksternal
                        </p>
                      </CardContent>
                    </Card>

                    <Card className="shadow-sm">
                      <CardContent className="p-6">
                        <div className="flex items-center gap-2 text-muted-foreground mb-3">
                          <HugeiconsIcon icon={toIcon(BuildingIcon)} size={14} />
                          <span className="text-xs font-semibold uppercase tracking-wider">Area Terberat</span>
                        </div>
                        <p className="text-lg font-bold leading-snug">
                          {cadAlerts[0]?.kabupaten.replace(/^KABUPATEN /, "KAB. ") ?? "–"}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1.5">
                          {cadAlerts[0]
                            ? `${fmtNum(cadAlerts[0].jumlah_toko)} toko · Status ${cadAlerts[0].status}`
                            : "–"}
                        </p>
                      </CardContent>
                    </Card>
                  </>
                )}
          </div>

          {/* ── Section: Loyalty Achievement ────────────────────────────── */}
          {(loyaltyLoad || loyaltyData) && (
            <div>
              <h2 className="text-lg font-semibold mb-4">Loyalty Achievement</h2>
              {loyaltyLoad ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
                </div>
              ) : loyaltyData && loyaltyData.total > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Summary stats */}
                  <Card className="shadow-sm" style={{ borderBottom: "3px solid #8b5cf6" }}>
                    <CardContent className="p-6">
                      <div className="flex items-center gap-2 text-muted-foreground mb-3">
                        <HugeiconsIcon icon={toIcon(AwardIcon)} size={14} color="#8b5cf6" />
                        <span className="text-xs font-semibold uppercase tracking-wider">Avg Achievement</span>
                      </div>
                      <p className="text-3xl font-bold tabular-nums" style={{ color: loyaltyData.avg_achievement_pct >= 90 ? "#16a34a" : loyaltyData.avg_achievement_pct >= 70 ? "#D97706" : "#DC2626" }}>
                        {loyaltyData.avg_achievement_pct.toFixed(1)}%
                      </p>
                      <div className="mt-2 flex gap-3 text-xs text-muted-foreground flex-wrap">
                        <span className="text-green-600 font-medium">{loyaltyData.on_track} On Track</span>
                        <span className="text-amber-600 font-medium">{loyaltyData.at_risk} At Risk</span>
                        <span className="text-red-600 font-medium">{loyaltyData.below_target} Below</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {loyaltyData.total} peserta · {loyaltyData.bulan_target ?? "–"}
                      </p>

                      {/* Efektivitas gauge */}
                      {loyaltyData.efektivitas_bulan_ini && (() => {
                        const eff = loyaltyData.efektivitas_bulan_ini!;
                        const col = eff.efektivitas_pct >= 80 ? "#16a34a" : eff.efektivitas_pct >= 60 ? "#D97706" : "#DC2626";
                        return (
                          <a href="/loyalty" className="block mt-4 rounded-lg border p-3 hover:bg-muted/30 transition-colors cursor-pointer"
                            style={{ borderColor: `${col}40`, backgroundColor: `${col}08` }}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Efektivitas Program</span>
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                                style={{ backgroundColor: `${col}20`, color: col }}>
                                {eff.interpretasi}
                              </span>
                            </div>
                            <p className="text-2xl font-black tabular-nums leading-none" style={{ color: col }}>
                              {eff.efektivitas_pct.toFixed(1)}%
                            </p>
                            <p className="text-[9px] text-muted-foreground mt-1">
                              Vol {eff.volume_achievement_pct.toFixed(0)}% · Aktif {eff.peserta_aktif_pct.toFixed(0)}%
                            </p>
                            <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                              <div className="h-full rounded-full transition-all"
                                style={{ width: `${Math.min(eff.efektivitas_pct, 100)}%`, background: col }} />
                            </div>
                          </a>
                        );
                      })()}
                    </CardContent>
                  </Card>

                  {/* 5 lowest achievers bar chart */}
                  <Card className="shadow-sm md:col-span-2">
                    <CardHeader className="border-b border-border pb-3">
                      <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        <HugeiconsIcon icon={toIcon(BarChartIcon)} size={14} />
                        5 Achievement Terendah
                        <a href="/loyalty?tab=target" className="ml-auto text-[10px] font-normal normal-case tracking-normal text-primary hover:underline">
                          Lihat semua →
                        </a>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4">
                      <ResponsiveContainer width="100%" height={140}>
                        <BarChart
                          layout="vertical"
                          data={loyaltyData.lowest_achievers.map((a) => ({
                            nama: a.nama_toko.length > 20 ? a.nama_toko.slice(0, 20) + "…" : a.nama_toko,
                            achievement_pct: a.achievement_pct,
                            fill: a.achievement_pct >= 90 ? "#16a34a" : a.achievement_pct >= 70 ? "#D97706" : "#DC2626",
                          }))}
                          margin={{ top: 0, right: 40, left: 0, bottom: 0 }}
                        >
                          <XAxis
                            type="number" domain={[0, 100]}
                            tick={{ fontSize: 10, fill: "currentColor" }}
                            tickLine={false} axisLine={false}
                            tickFormatter={(v) => `${v}%`}
                          />
                          <YAxis
                            type="category" dataKey="nama" width={130}
                            tick={{ fontSize: 10, fill: "currentColor" }}
                            tickLine={false} axisLine={false}
                          />
                          <Tooltip
                            formatter={(v) => [`${(v as number).toFixed(1)}%`, "Achievement"]}
                            contentStyle={{ fontSize: 11 }}
                          />
                          <Bar dataKey="achievement_pct" radius={[0, 3, 3, 0]}>
                            {loyaltyData.lowest_achievers.map((a, i) => (
                              <Cell
                                key={i}
                                fill={a.achievement_pct >= 90 ? "#16a34a" : a.achievement_pct >= 70 ? "#D97706" : "#DC2626"}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                </div>
              ) : null}
            </div>
          )}

          {/* ── Shortcut Cards Row ──────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => router.push("/report")}
            >
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg shrink-0">
                  <FileText className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">AI Report Generator</p>
                  <p className="text-xs text-muted-foreground">
                    Generate laporan bulanan otomatis dengan analisis AI
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </CardContent>
            </Card>

            <Card
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => router.push("/competitor")}
            >
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg shrink-0">
                  <Swords className="h-5 w-5 text-red-600 dark:text-red-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">Competitor Intelligence</p>
                  <p className="text-xs text-muted-foreground">
                    Pantau ancaman kompetitor per wilayah secara real-time
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </CardContent>
            </Card>
          </div>

          {/* Footer */}
          <p className="text-center text-[11px] text-muted-foreground pb-4">
            CORE Platform v2 · Analitik Pasar Semen Kantong · Data sintetis untuk keperluan portofolio
          </p>
        </div>
      </main>
    </div>
  );
}
