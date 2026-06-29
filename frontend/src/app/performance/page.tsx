"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, ComposedChart, Line,
  ReferenceLine,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, RefreshCw, Search, X, ExternalLink } from "lucide-react";
import { apiFetch, API } from "@/lib/fetch";
import StoreJourneyModal from "@/components/StoreJourneyModal";

const fmtNum = (n: number) => new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(n);

function deriveChurnRisk(s: { vol_delta_pct: number; verdict: string }): "high" | "medium" | "low" {
  if (s.vol_delta_pct < -15 && (s.verdict === "Perlu Perhatian" || s.verdict === "Dalam Pemantauan")) return "high";
  if (s.vol_delta_pct < -5 || s.verdict === "Perlu Perhatian") return "medium";
  return "low";
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface OverviewStore {
  id_toko: string;
  nama_toko: string;
  kabupaten: string;
  cluster: string;
  tso: string;
  aegis_score: number;
  aegis_level: string;
  loyalty_since: string;
  reward_type: string;
  vol_delta_pct: number;
  fbsi_delta: number;
  verdict: string;
  verdict_color: string;
}

interface Overview {
  total_dipantau: number;
  membaik: number;
  stabil: number;
  perlu_perhatian: number;
  dalam_pemantauan: number;
  stores: OverviewStore[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VERDICT_BADGE: Record<string, string> = {
  "Membaik":          "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  "Stabil":           "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "Perlu Perhatian":  "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  "Dalam Pemantauan": "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  "Belum di Program": "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
};

const AEGIS_BADGE: Record<string, string> = {
  Merah:  "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  Oranye: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  Kuning: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  Normal: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

function VolDelta({ v }: { v: number }) {
  const pos = v > 0;
  const zero = Math.abs(v) < 0.1;
  return (
    <span
      className={`font-mono tabular-nums font-medium flex items-center gap-0.5 ${
        zero ? "text-muted-foreground" : pos ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
      }`}
    >
      {zero ? <Minus size={12} /> : pos ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
      {pos && !zero ? "+" : ""}{fmtNum(v)}%
    </span>
  );
}

function FbsiDelta({ v }: { v: number }) {
  const neg = v < 0;
  const zero = Math.abs(v) < 0.1;
  return (
    <span
      className={`font-mono tabular-nums font-medium ${
        zero ? "text-muted-foreground" : neg ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
      }`}
    >
      {v > 0 ? "+" : ""}{fmtNum(v)}pp
    </span>
  );
}

const DONUT_COLORS = ["#16a34a", "#2563eb", "#dc2626", "#9ca3af"];

function DonutTooltip({ active, payload }: { active?: boolean; payload?: { name: string; value: number }[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md text-sm">
      <p className="font-medium">{payload[0].name}</p>
      <p className="text-muted-foreground">{payload[0].value} toko</p>
    </div>
  );
}

function BarTooltip({ active, payload }: { active?: boolean; payload?: { payload: OverviewStore; value: number }[] }) {
  if (!active || !payload?.length) return null;
  const s = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md text-xs space-y-0.5 max-w-xs">
      <p className="font-semibold text-sm truncate">{s.nama_toko}</p>
      <p className="text-muted-foreground">{s.kabupaten}</p>
      <p>Vol delta: <span className={`font-mono font-semibold ${payload[0].value >= 0 ? "text-green-600" : "text-red-600"}`}>
        {payload[0].value >= 0 ? "+" : ""}{payload[0].value.toFixed(1)}%
      </span></p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PerformancePage() {
  const [overview, setOverview]     = useState<Overview | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState("");
  const [search, setSearch]         = useState("");
  const [filterVerdict, setFilterVerdict] = useState("semua");
  const [filterCluster, setFilterCluster] = useState("semua");
  const [filterChurn,   setFilterChurn]   = useState<"high" | "medium" | null>(null);
  const [selectedToko, setSelectedToko]   = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`${API}/api/performance/overview`);
      const r = await res.json();
      setOverview(r.data as Overview);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);

  const clusters = useMemo(() => {
    if (!overview) return [];
    return Array.from(new Set(overview.stores.map((s) => s.cluster))).sort();
  }, [overview]);

  const filtered = useMemo(() => {
    if (!overview) return [];
    return overview.stores.filter((s) => {
      if (filterVerdict !== "semua" && s.verdict !== filterVerdict) return false;
      if (filterCluster !== "semua" && s.cluster !== filterCluster) return false;
      if (filterChurn) {
        const risk = deriveChurnRisk(s);
        if (filterChurn === "high" && risk !== "high") return false;
        if (filterChurn === "medium" && risk !== "medium" && risk !== "high") return false;
      }
      if (search) {
        const q = search.toLowerCase();
        return (
          s.nama_toko.toLowerCase().includes(q) ||
          s.id_toko.toLowerCase().includes(q) ||
          s.kabupaten.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [overview, filterVerdict, filterCluster, filterChurn, search]);

  // Top 15 by vol_delta for bar chart
  const barData = useMemo(() => {
    if (!overview) return [];
    return [...overview.stores]
      .sort((a, b) => b.vol_delta_pct - a.vol_delta_pct)
      .slice(0, 15);
  }, [overview]);

  const donutData = overview
    ? [
        { name: "Membaik",          value: overview.membaik },
        { name: "Stabil",           value: overview.stabil },
        { name: "Perlu Perhatian",  value: overview.perlu_perhatian },
        { name: "Dalam Pemantauan", value: overview.dalam_pemantauan },
      ].filter((d) => d.value > 0)
    : [];

  return (
    <>
      <Navbar />
      <main className="pt-16 min-h-screen bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">

          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Store Performance Tracker</h1>
              <p className="text-muted-foreground mt-1">
                Monitor outcome toko mitra — dari deteksi AEGIS hingga hasil program loyalty
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={fetchOverview} disabled={loading}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              Refresh
            </Button>
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Dipantau",        value: overview?.total_dipantau,   color: "text-foreground",                   bg: "" },
              { label: "Membaik",         value: overview?.membaik,          color: "text-green-600 dark:text-green-400", bg: "bg-green-50 dark:bg-green-900/20" },
              { label: "Stabil",          value: overview?.stabil,           color: "text-blue-600 dark:text-blue-400",   bg: "bg-blue-50 dark:bg-blue-900/20" },
              { label: "Perlu Perhatian", value: overview?.perlu_perhatian,  color: "text-red-600 dark:text-red-400",     bg: "bg-red-50 dark:bg-red-900/20" },
            ].map((k) => (
              <Card key={k.label} className={k.bg}>
                <CardContent className="p-5">
                  {loading ? (
                    <Skeleton className="h-8 w-16 mb-1" />
                  ) : (
                    <p className={`text-3xl font-black tabular-nums ${k.color}`}>{k.value ?? 0}</p>
                  )}
                  <p className="text-sm text-muted-foreground mt-1">{k.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Donut */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Distribusi Outcome</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="h-56 flex items-center justify-center">
                    <Skeleton className="h-48 w-48 rounded-full" />
                  </div>
                ) : (
                  <div className="relative h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={donutData}
                          cx="50%"
                          cy="50%"
                          innerRadius={68}
                          outerRadius={96}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {donutData.map((_, i) => (
                            <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip content={<DonutTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <p className="text-2xl font-black">{overview?.total_dipantau ?? 0}</p>
                      <p className="text-xs text-muted-foreground">toko</p>
                    </div>
                  </div>
                )}
                {/* Legend */}
                <div className="mt-3 space-y-1.5">
                  {[
                    { label: "Membaik",          color: DONUT_COLORS[0] },
                    { label: "Stabil",           color: DONUT_COLORS[1] },
                    { label: "Perlu Perhatian",  color: DONUT_COLORS[2] },
                    { label: "Dalam Pemantauan", color: DONUT_COLORS[3] },
                  ].map((l) => (
                    <div key={l.label} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
                      {l.label}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Volume Delta Bar */}
            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle className="text-base">Volume Delta — Top 15 Toko</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart
                      data={barData}
                      layout="vertical"
                      margin={{ top: 0, right: 48, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                      <XAxis
                        type="number"
                        tickFormatter={(v) => `${v > 0 ? "+" : ""}${v}%`}
                        tick={{ fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="nama_toko"
                        width={120}
                        tick={{ fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: string) => v.length > 18 ? v.slice(0, 17) + "…" : v}
                      />
                      <Tooltip content={<BarTooltip />} />
                      <ReferenceLine x={0} stroke="var(--border)" strokeWidth={1.5} />
                      <Bar dataKey="vol_delta_pct" radius={[0, 3, 3, 0]}>
                        {barData.map((s, i) => (
                          <Cell key={i} fill={s.vol_delta_pct >= 0 ? "#16a34a" : "#dc2626"} fillOpacity={0.85} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Table */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="text-base">Performa Toko Loyalty</CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Churn Risk filter chips */}
                  <div className="flex gap-1.5 items-center">
                    <span className="text-[10px] text-muted-foreground">Churn:</span>
                    <button
                      onClick={() => setFilterChurn(f => f === "high" ? null : "high")}
                      className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors font-medium ${filterChurn === "high" ? "bg-red-600 text-white border-red-600" : "border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400"}`}
                    >
                      ⚠ Risiko Keluar
                    </button>
                    <button
                      onClick={() => setFilterChurn(f => f === "medium" ? null : "medium")}
                      className={`px-2 py-0.5 text-[10px] rounded-full border transition-colors font-medium ${filterChurn === "medium" ? "bg-yellow-500 text-white border-yellow-500" : "border-yellow-400 text-yellow-600 hover:bg-yellow-50 dark:border-yellow-700 dark:text-yellow-400"}`}
                    >
                      Perlu Perhatian
                    </button>
                  </div>
                  {/* Search */}
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Cari toko…"
                      className="h-8 pl-8 pr-8 rounded-lg border border-input bg-background text-sm
                        focus:outline-none focus:ring-2 focus:ring-ring/60 w-44"
                    />
                    {search && (
                      <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  {/* Verdict filter */}
                  <Select value={filterVerdict} onValueChange={setFilterVerdict}>
                    <SelectTrigger className="h-8 w-44 text-sm">
                      <SelectValue placeholder="Verdict" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="semua">Semua Verdict</SelectItem>
                      <SelectItem value="Membaik">Membaik</SelectItem>
                      <SelectItem value="Stabil">Stabil</SelectItem>
                      <SelectItem value="Perlu Perhatian">Perlu Perhatian</SelectItem>
                      <SelectItem value="Dalam Pemantauan">Dalam Pemantauan</SelectItem>
                    </SelectContent>
                  </Select>
                  {/* Cluster filter */}
                  <Select value={filterCluster} onValueChange={setFilterCluster}>
                    <SelectTrigger className="h-8 w-40 text-sm">
                      <SelectValue placeholder="Cluster" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="semua">Semua Cluster</SelectItem>
                      {clusters.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-6 space-y-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <p className="text-center text-muted-foreground py-12 text-sm">
                  Tidak ada toko yang cocok dengan filter
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nama Toko</TableHead>
                        <TableHead>Kabupaten</TableHead>
                        <TableHead>Cluster</TableHead>
                        <TableHead>AEGIS Score</TableHead>
                        <TableHead>Loyalty Sejak</TableHead>
                        <TableHead>Reward Type</TableHead>
                        <TableHead className="text-right">Vol Delta</TableHead>
                        <TableHead className="text-right">FBSI Delta</TableHead>
                        <TableHead>Verdict</TableHead>
                        <TableHead>Churn Risk</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map((s) => (
                        <TableRow key={s.id_toko}>
                          <TableCell className="font-medium max-w-[200px]">
                            <p className="truncate">{s.nama_toko}</p>
                            <p className="text-[11px] text-muted-foreground font-mono">{s.id_toko}</p>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[160px] truncate">
                            {s.kabupaten}
                          </TableCell>
                          <TableCell>
                            <span className="text-xs font-medium text-muted-foreground">{s.cluster}</span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-semibold text-sm">{s.aegis_score.toFixed(1)}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${AEGIS_BADGE[s.aegis_level] ?? AEGIS_BADGE.Normal}`}>
                                {s.aegis_level}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {s.loyalty_since || "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {s.reward_type}
                          </TableCell>
                          <TableCell className="text-right">
                            <VolDelta v={s.vol_delta_pct} />
                          </TableCell>
                          <TableCell className="text-right">
                            <FbsiDelta v={s.fbsi_delta} />
                          </TableCell>
                          <TableCell>
                            <span className={`text-xs px-2 py-1 rounded-full font-semibold whitespace-nowrap ${VERDICT_BADGE[s.verdict] ?? ""}`}>
                              {s.verdict}
                            </span>
                          </TableCell>
                          <TableCell>
                            {(() => {
                              const risk = deriveChurnRisk(s);
                              return risk === "high"
                                ? <span className="text-[10px] font-semibold text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 px-1.5 py-0.5 rounded-full whitespace-nowrap">⚠ Tinggi</span>
                                : risk === "medium"
                                ? <span className="text-[10px] font-semibold text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/30 px-1.5 py-0.5 rounded-full whitespace-nowrap">Sedang</span>
                                : <span className="text-[10px] text-green-600 px-1.5 py-0.5">✓</span>;
                            })()}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-xs h-7"
                              onClick={() => setSelectedToko(s.id_toko)}
                            >
                              Detail
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              {!loading && filtered.length > 0 && (
                <p className="text-xs text-muted-foreground px-4 py-2 border-t border-border">
                  Menampilkan {filtered.length} dari {overview?.stores.length ?? 0} toko
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Journey Modal */}
      {selectedToko && (
        <StoreJourneyModal
          idToko={selectedToko}
          onClose={() => setSelectedToko(null)}
        />
      )}
    </>
  );
}
