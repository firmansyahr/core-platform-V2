"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import AegisMap from "@/components/aegis/AegisMap";
import { CAD_COLOR } from "@/components/aegis/AegisMap";
import type { RegionMapData } from "@/components/aegis/AegisMap";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, API } from "@/lib/fetch";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  AlertCircleIcon,
  AlertDiamondIcon,
  MapPinIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@hugeicons/core-free-icons";

const toIcon = (i: unknown) => i as IconSvgElement;
const fmtNum = (n: number) => new Intl.NumberFormat("id-ID").format(Math.round(n));

const CAD_BG: Record<string, string> = {
  KRITIS: "#DC262615",
  MERAH:  "#EF444415",
  KUNING: "#F59E0B15",
  NORMAL: "#10B98115",
};

const POLA_DESC: Record<string, string> = {
  A: "Toko mulai beralih ke produk murah",
  B: "Tiga tanda bahaya aktif bersamaan",
  C: "Pola beli berubah — belum jelas penyebabnya",
  D: "Toko kembali normal",
  N: "Normal",
};

interface MapSummary {
  total_wilayah: number;
  kritis_count: number;
  merah_count: number;
  kuning_count: number;
  normal_count: number;
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({
  title, value, sub, icon, color,
}: {
  title: string; value: string; sub?: string; icon: unknown; color: string;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </p>
          <span style={{ color }} className="opacity-50 shrink-0">
            <HugeiconsIcon icon={toIcon(icon)} size={16} />
          </span>
        </div>
        <p className="text-2xl font-bold leading-none tabular-nums" style={{ color }}>
          {value}
        </p>
        {sub && (
          <p className="text-xs text-muted-foreground mt-1 truncate" title={sub}>{sub}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Region detail panel ───────────────────────────────────────────────────────

function RegionPanel({
  region,
  onClose,
}: {
  region: RegionMapData;
  onClose: () => void;
}) {
  const color = CAD_COLOR[region.cad_status] ?? "#6B7280";
  const bars = [
    { label: "Merah",  count: region.merah_count,  color: "#DC2626" },
    { label: "Oranye", count: region.oranye_count, color: "#EA580C" },
    { label: "Kuning", count: region.kuning_count, color: "#F59E0B" },
    { label: "Normal", count: region.normal_count, color: "#10B981" },
  ];
  const maxBar = Math.max(...bars.map((b) => b.count), 1);

  return (
    <Card className="shadow-lg border-border/80">
      <CardHeader className="border-b border-border pb-3">
        <CardTitle className="flex items-start justify-between gap-2">
          <div>
            <p className="text-base font-bold leading-tight">{region.nama}</p>
            <span
              className="mt-1 inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ color, backgroundColor: CAD_BG[region.cad_status] }}
            >
              {region.cad_status}
            </span>
          </div>
          <button
            onClick={onClose}
            className="mt-0.5 shrink-0 w-6 h-6 rounded flex items-center justify-center
              text-muted-foreground hover:bg-muted hover:text-foreground transition-colors text-sm"
          >
            ✕
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {/* Bar breakdown */}
        <div>
          <p className="text-xs font-semibold mb-2">Distribusi Level</p>
          <div className="space-y-1.5">
            {bars.map((b) => (
              <div key={b.label} className="flex items-center gap-2">
                <span className="text-[10px] w-12 text-muted-foreground">{b.label}</span>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${(b.count / maxBar) * 100}%`,
                      backgroundColor: b.color,
                    }}
                  />
                </div>
                <span className="text-[10px] tabular-nums w-6 text-right">{b.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-muted/50 px-3 py-2">
            <p className="text-muted-foreground text-[10px]">Total Toko</p>
            <p className="font-bold text-base tabular-nums">{fmtNum(region.total_toko)}</p>
          </div>
          <div className="rounded-lg bg-muted/50 px-3 py-2">
            <p className="text-muted-foreground text-[10px]">Warning</p>
            <p className="font-bold text-base tabular-nums" style={{ color }}>
              {fmtNum(region.warning_count)}{" "}
              <span className="text-xs text-muted-foreground font-normal">({region.warning_pct}%)</span>
            </p>
          </div>
          <div className="rounded-lg bg-muted/50 px-3 py-2">
            <p className="text-muted-foreground text-[10px]">Avg AEGIS Score</p>
            <p className="font-bold text-base tabular-nums">{region.avg_aegis_score.toFixed(1)}</p>
          </div>
          <div className="rounded-lg bg-muted/50 px-3 py-2">
            <p className="text-muted-foreground text-[10px]">Vol at Risk</p>
            <p className="font-bold text-base tabular-nums">{fmtNum(region.volume_at_risk)}</p>
            <p className="text-[9px] text-muted-foreground">TON</p>
          </div>
        </div>

        {region.dominant_pola !== "N" && (
          <div
            className="rounded-lg px-3 py-2 text-xs"
            style={{
              backgroundColor: CAD_BG[region.cad_status],
              borderLeft: `3px solid ${color}`,
            }}
          >
            <p className="font-semibold mb-0.5">Pola Dominan: {region.dominant_pola}</p>
            <p className="text-muted-foreground">
              {POLA_DESC[region.dominant_pola] ?? region.dominant_pola}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AegisMapPage() {
  const [data, setData] = useState<RegionMapData[]>([]);
  const [summary, setSummary] = useState<MapSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<RegionMapData | null>(null);

  useEffect(() => {
    setLoading(true);
    apiFetch(`${API}/api/aegis/map-data?level=kabupaten`)
      .then((r) => r.json())
      .then((r) => {
        setData(r.data ?? []);
        setSummary(r.summary ?? null);
      })
      .catch(() => {
        setData([]);
        setSummary(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const topWarning = useMemo(
    () =>
      [...data]
        .filter((r) => r.cad_status !== "NORMAL")
        .sort((a, b) => b.warning_count - a.warning_count)
        .slice(0, 5),
    [data],
  );

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="pt-16 max-w-7xl mx-auto px-6 py-8 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link
                href="/aegis"
                className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              >
                <HugeiconsIcon icon={toIcon(ChevronLeftIcon)} size={12} />
                AEGIS Monitor
              </Link>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Peta Sebaran AEGIS Warning</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Distribusi kondisi toko per kabupaten · klik wilayah untuk detail
            </p>
          </div>
        </div>

        {/* Summary cards */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <SummaryCard
              title="KRITIS"
              value={fmtNum(summary?.kritis_count ?? 0)}
              sub={`dari ${summary?.total_wilayah ?? 0} kabupaten`}
              icon={AlertDiamondIcon}
              color="#DC2626"
            />
            <SummaryCard
              title="MERAH"
              value={fmtNum(summary?.merah_count ?? 0)}
              sub="kabupaten level merah"
              icon={AlertCircleIcon}
              color="#EF4444"
            />
            <SummaryCard
              title="KUNING"
              value={fmtNum(summary?.kuning_count ?? 0)}
              sub="kabupaten perlu pantau"
              icon={AlertCircleIcon}
              color="#F59E0B"
            />
            <SummaryCard
              title="NORMAL"
              value={fmtNum(summary?.normal_count ?? 0)}
              sub="kabupaten kondisi baik"
              icon={MapPinIcon}
              color="#10B981"
            />
          </div>
        )}

        {/* Map + detail panel */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-5 items-start">

          <Card className="shadow-sm">
            <CardHeader className="border-b border-border pb-3">
              <CardTitle className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <span className="flex items-center gap-2">
                  <HugeiconsIcon icon={toIcon(MapPinIcon)} size={14} color="#3b82f6" />
                  Peta Choropleth — Level Kabupaten
                </span>
                {!loading && (
                  <span className="text-xs font-normal normal-case tracking-normal">
                    {data.filter((d) => d.cad_status !== "NORMAL").length} kabupaten bermasalah
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 px-3 pb-3">
              {loading ? (
                <Skeleton className="w-full rounded-xl" style={{ height: 580 }} />
              ) : (
                <AegisMap
                  data={data}
                  loading={false}
                  height={580}
                  onRegionClick={setSelected}
                />
              )}
            </CardContent>
          </Card>

          {/* Detail panel or top list */}
          <div className="space-y-4">
            {selected ? (
              <RegionPanel region={selected} onClose={() => setSelected(null)} />
            ) : (
              <Card className="shadow-sm">
                <CardHeader className="border-b border-border pb-3">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Top Kabupaten Warning
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-3 px-4 pb-4 space-y-2">
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 rounded-lg" />
                    ))
                  ) : topWarning.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">
                      Tidak ada kabupaten bermasalah
                    </p>
                  ) : (
                    topWarning.map((r) => {
                      const color = CAD_COLOR[r.cad_status];
                      return (
                        <button
                          key={r.nama}
                          onClick={() => setSelected(r)}
                          className="w-full flex items-center justify-between gap-2 px-3 py-2
                            rounded-lg border border-border hover:bg-muted/50 transition-colors text-left group"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate group-hover:text-foreground">
                              {r.nama}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {r.warning_count} warning · {r.warning_pct}%
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span
                              className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                              style={{ color, backgroundColor: CAD_BG[r.cad_status] }}
                            >
                              {r.cad_status}
                            </span>
                            <HugeiconsIcon
                              icon={toIcon(ChevronRightIcon)}
                              size={12}
                              className="text-muted-foreground group-hover:text-foreground"
                            />
                          </div>
                        </button>
                      );
                    })
                  )}
                  {!loading && topWarning.length > 0 && (
                    <p className="text-[10px] text-muted-foreground text-center pt-1">
                      Klik kabupaten di peta untuk detail
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        <p className="text-center text-[11px] text-muted-foreground pb-4">
          CORE Platform v2 · AEGIS Heatmap · Data berbasis transaksi, validasi lapangan diperlukan
        </p>
      </main>
    </div>
  );
}
