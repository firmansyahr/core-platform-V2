"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import Navbar from "@/components/Navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, Download, RefreshCw, FileText } from "lucide-react";
import { getToken } from "@/lib/auth";
import { MiniDonutChart } from "@/components/report/MiniDonutChart";
import { MiniBarChart } from "@/components/report/MiniBarChart";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ─── Types ─────────────────────────────────────────────────────────────────

interface ReportSections {
  executive_summary: string;
  analisis_aegis: string;
  analisis_competitor: string;
  analisis_loyalty: string;
  breakdown_program_promo: string;
  performance_outcome: string;
  rekomendasi: string;
}

interface KpiSnapshot {
  volume_bulan_ini: number;
  growth_mom_pct: number;
  growth_yoy_pct: number | null;
  toko_aktif: number;
  warning_merah: number;
  warning_oranye: number;
  warning_kuning: number;
  fighting_brand_share_pct: number;
  volume_at_risk_pct: number;
}

interface AegisSnapshot {
  total_warning: number;
  merah: number;
  oranye: number;
  kuning: number;
  top_kabupaten: { kabupaten: string; jumlah: number }[];
  distribusi_pola: Record<string, number>;
}

interface CompetitorSnapshot {
  triangulation_summary: {
    konfirmasi_kompetitor: number;
    waspada_awal: number;
    internal_seasonal: number;
    tidak_cukup_data: number;
    total_provinsi: number;
  };
  top_3_threats: {
    provinsi: string;
    verdict: string;
    top_kompetitor: string;
    ms_change_pp: number;
    aegis_warning_pct: number;
  }[];
  top_5_kompetitor_asperssi: {
    brand: string;
    avg_ms_pct: number;
    avg_trend_pp: number;
    trend_label: string;
  }[];
  aggregate_others: {
    avg_ms_pct: number;
    trend_label: string;
    avg_trend_pp: number;
  } | null;
}

interface LoyaltySnapshot {
  total_aktif?: number;
  est_budget_bulan?: number;
  efektivitas_bulan_ini?: {
    efektivitas_pct: number;
    volume_achievement_pct: number;
    peserta_aktif_pct: number;
    interpretasi: string;
  } | null;
}

interface PromoTypeData {
  jumlah_aktif: number;
  total_peserta: number;
  total_rupiah: number;
  nama_program: string[];
  distribusi_tier?: Record<string, number>;
  top_3_overall?: { nama_promo: string; nama_toko: string }[];
}

interface ProgramPromoSnapshot {
  total_program: number;
  total_aktif: number;
  total_selesai: number;
  flat_multiplier: PromoTypeData;
  multi_tier: PromoTypeData;
  leaderboard: PromoTypeData;
}

interface PerformanceSnapshot {
  total_dipantau: number;
  verdict_distribution: {
    membaik: number;
    stabil: number;
    perlu_perhatian: number;
    dalam_pemantauan: number;
  };
  success_rate_pct: number;
  top_5_success_stories: {
    nama_toko: string;
    kabupaten: string;
    vol_delta_pct: number;
    verdict: string;
  }[];
  watch_list: {
    nama_toko: string;
    kabupaten: string;
    vol_delta_pct: number;
    verdict: string;
  }[];
}

interface RawData {
  periode: string;
  summary: KpiSnapshot;
  aegis: AegisSnapshot;
  competitor: CompetitorSnapshot;
  loyalty: LoyaltySnapshot;
  program_promo: ProgramPromoSnapshot;
  performance_tracker: PerformanceSnapshot;
}

interface ReportResult {
  status: string;
  sections: ReportSections | null;
  raw_data: RawData | null;
  periode: string;
  generated_at: string;
}

interface FullReport {
  result: ReportResult;
}

interface RekomendasiItem {
  num: number;
  text: string;
  urgensi: "Tinggi" | "Sedang" | "Rendah" | null;
  pic: string | null;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STEPS = [
  { label: "Menganalisis kondisi pasar…", pct: 15 },
  { label: "Menganalisis kondisi AEGIS…", pct: 30 },
  { label: "Menganalisis tekanan kompetitor…", pct: 45 },
  { label: "Menganalisis program loyalty…", pct: 60 },
  { label: "Menganalisis breakdown program promo…", pct: 75 },
  { label: "Menganalisis outcome performance…", pct: 85 },
  { label: "Menyusun rekomendasi…", pct: 100 },
];

const POLA_COLORS: Record<string, string> = {
  A: "#DC2626",
  B: "#EA580C",
  C: "#CA8A04",
  D: "#6b7280",
};

const TIER_COLORS = [
  "#2563eb", "#16a34a", "#CA8A04", "#DC2626", "#6b7280", "#9333ea",
];

const VERDICT_DIST_COLORS: Record<string, string> = {
  membaik: "#16a34a",
  stabil: "#2563eb",
  perlu_perhatian: "#DC2626",
  dalam_pemantauan: "#6b7280",
};

const VERDICT_DIST_LABELS: Record<string, string> = {
  membaik: "Membaik",
  stabil: "Stabil",
  perlu_perhatian: "Perlu Perhatian",
  dalam_pemantauan: "Dalam Pemantauan",
};

const URGENCY_STYLES: Record<string, string> = {
  Tinggi:
    "bg-red-100 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-400 dark:border-red-700",
  Sedang:
    "bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-950/30 dark:text-yellow-500 dark:border-yellow-700",
  Rendah:
    "bg-green-100 text-green-700 border-green-300 dark:bg-green-950/30 dark:text-green-400 dark:border-green-700",
};

const RANK_STYLES = [
  "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-950/30 dark:text-yellow-400 dark:border-yellow-700",
  "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600",
  "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-700",
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtRp(n: number): string {
  if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(1)} M`;
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(0)} jt`;
  return `Rp ${new Intl.NumberFormat("id-ID").format(Math.round(n))}`;
}

function fmtNum(n: number): string {
  return new Intl.NumberFormat("id-ID").format(Math.round(n));
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function parseRekomendasi(raw: string): RekomendasiItem[] {
  if (!raw?.trim()) return [];
  const items: RekomendasiItem[] = [];
  const segments = raw.split(/\n(?=\d+[.)]\s)/);

  for (const seg of segments) {
    const m = seg.match(/^(\d+)[.)]\s*([\s\S]+)/);
    if (!m) continue;
    const num = parseInt(m[1]);
    const body = m[2].replace(/\n/g, " ").trim();

    const urgensiRaw = body.match(/\b(Tinggi|Sedang|Rendah)\b/i)?.[1];
    const urgensi = urgensiRaw
      ? ((urgensiRaw.charAt(0).toUpperCase() +
          urgensiRaw.slice(1).toLowerCase()) as "Tinggi" | "Sedang" | "Rendah")
      : null;
    const pic = body.match(/\b(TSO|ASM|Manajemen)\b/)?.[1] ?? null;

    items.push({ num, text: body, urgensi, pic });
  }

  return items.length
    ? items
    : [{ num: 0, text: raw.trim(), urgensi: null, pic: null }];
}

// ─── Shared UI components ────────────────────────────────────────────────────

function SectionHeader({ num, title }: { num: number; title: string }) {
  return (
    <h2 className="text-base font-bold mb-4 flex items-center gap-2">
      <span className="w-6 h-6 bg-primary text-primary-foreground rounded text-xs flex items-center justify-center shrink-0 font-bold">
        {num}
      </span>
      {title}
    </h2>
  );
}

function SectionError() {
  return (
    <div className="text-xs text-muted-foreground bg-muted/40 border border-dashed border-border rounded-lg p-3 italic">
      Section ini tidak dapat di-generate. Coba regenerate laporan.
    </div>
  );
}

function SectionText({ text }: { text: string | undefined | null }) {
  if (!text) return <SectionError />;
  return (
    <div className="text-sm leading-relaxed space-y-3">
      {text
        .split("\n\n")
        .filter((p) => p.trim())
        .map((p, i) => (
          <p key={i}>{p.trim()}</p>
        ))}
    </div>
  );
}

// ─── Section components ──────────────────────────────────────────────────────

function KpiSection({ summary }: { summary: KpiSnapshot }) {
  const volLalu = summary.volume_bulan_ini / (1 + (summary.growth_mom_pct ?? 0) / 100);
  const barData = [
    { name: "Bln Lalu", value: Math.round(volLalu), fill: "#93c5fd" },
    { name: "Bln Ini", value: Math.round(summary.volume_bulan_ini), fill: "#2563eb" },
  ];

  const tableRows: [string, string, string?][] = [
    ["Volume Bulan Ini", `${fmtNum(summary.volume_bulan_ini)} TON`],
    [
      "Growth MoM",
      fmtPct(summary.growth_mom_pct),
      summary.growth_mom_pct >= 0 ? "positive" : "negative",
    ],
    [
      "Growth YoY",
      summary.growth_yoy_pct !== null
        ? fmtPct(summary.growth_yoy_pct ?? 0)
        : "N/A",
      (summary.growth_yoy_pct ?? 0) >= 0 ? "positive" : "negative",
    ],
    ["Toko Aktif", fmtNum(summary.toko_aktif)],
    ["Porsi Produk Murah", `${summary.fighting_brand_share_pct.toFixed(1)}%`],
    ["Volume Berisiko", `${summary.volume_at_risk_pct.toFixed(1)}%`],
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted">
              <th className="text-left px-3 py-2 font-semibold text-xs uppercase tracking-wider">
                Metrik
              </th>
              <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-wider">
                Nilai
              </th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map(([label, val, color], i) => (
              <tr
                key={label}
                className={i % 2 === 0 ? "bg-background" : "bg-muted/30"}
              >
                <td className="px-3 py-1.5 text-xs">{label}</td>
                <td
                  className={`px-3 py-1.5 text-xs text-right font-mono tabular-nums ${
                    color === "positive"
                      ? "text-green-600 dark:text-green-400"
                      : color === "negative"
                      ? "text-red-600 dark:text-red-400"
                      : ""
                  }`}
                >
                  {val}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
          Perbandingan Volume (TON)
        </p>
        <MiniBarChart data={barData} height={110} layout="horizontal" />
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="bg-red-50 dark:bg-red-950/20 rounded-lg p-2 text-center border border-red-200 dark:border-red-800">
            <div className="text-lg font-bold text-red-600 dark:text-red-400">
              {summary.warning_merah}
            </div>
            <div className="text-xs text-red-600 dark:text-red-400 font-medium">
              Merah
            </div>
          </div>
          <div className="bg-orange-50 dark:bg-orange-950/20 rounded-lg p-2 text-center border border-orange-200 dark:border-orange-800">
            <div className="text-lg font-bold text-orange-600 dark:text-orange-400">
              {summary.warning_oranye}
            </div>
            <div className="text-xs text-orange-600 dark:text-orange-400 font-medium">
              Oranye
            </div>
          </div>
          <div className="bg-yellow-50 dark:bg-yellow-950/20 rounded-lg p-2 text-center border border-yellow-200 dark:border-yellow-800">
            <div className="text-lg font-bold text-yellow-600 dark:text-yellow-400">
              {summary.warning_kuning}
            </div>
            <div className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">
              Kuning
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AegisSection({
  text,
  aegis,
}: {
  text: string | undefined | null;
  aegis: AegisSnapshot | undefined;
}) {
  const donutData = Object.entries(aegis?.distribusi_pola ?? {}).map(
    ([pola, count]) => ({
      name: `Pola ${pola}`,
      value: count as number,
      fill: POLA_COLORS[pola] ?? "#94a3b8",
    })
  );

  return (
    <div className="space-y-4">
      <SectionText text={text} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-2">
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
            Distribusi Pola Toko
          </p>
          <MiniDonutChart data={donutData} height={180} />
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
            Top 5 Kabupaten Warning
          </p>
          {aegis?.top_kabupaten?.length ? (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted">
                  <th className="text-left px-3 py-1.5 font-semibold text-xs">
                    Kabupaten
                  </th>
                  <th className="text-right px-3 py-1.5 font-semibold text-xs">
                    Toko
                  </th>
                </tr>
              </thead>
              <tbody>
                {aegis.top_kabupaten.map((k, i) => (
                  <tr
                    key={k.kabupaten}
                    className={i % 2 === 0 ? "bg-background" : "bg-muted/30"}
                  >
                    <td className="px-3 py-1.5 text-xs">
                      {k.kabupaten.replace(/^KABUPATEN /, "KAB. ")}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-right tabular-nums font-semibold">
                      {k.jumlah}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              Tidak ada data.
            </p>
          )}

          <div className="mt-3 flex gap-2">
            {[
              { label: "Merah", val: aegis?.merah ?? 0, cls: "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400" },
              { label: "Oranye", val: aegis?.oranye ?? 0, cls: "bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800 text-orange-600 dark:text-orange-400" },
              { label: "Kuning", val: aegis?.kuning ?? 0, cls: "bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800 text-yellow-600 dark:text-yellow-400" },
            ].map(({ label, val, cls }) => (
              <div
                key={label}
                className={`flex-1 border rounded p-2 text-center ${cls}`}
              >
                <div className="text-base font-bold">{val}</div>
                <div className="text-xs font-medium">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CompetitorSection({
  text,
  competitor,
}: {
  text: string | undefined | null;
  competitor: CompetitorSnapshot | undefined;
}) {
  const tri = competitor?.triangulation_summary;
  const barData = tri
    ? [
        {
          name: "Konfirmasi",
          value: tri.konfirmasi_kompetitor,
          fill: "#DC2626",
        },
        { name: "Waspada Awal", value: tri.waspada_awal, fill: "#CA8A04" },
        {
          name: "Internal/Seasonal",
          value: tri.internal_seasonal,
          fill: "#2563eb",
        },
        {
          name: "Kurang Data",
          value: tri.tidak_cukup_data,
          fill: "#6b7280",
        },
      ].filter((d) => d.value > 0)
    : [];

  return (
    <div className="space-y-4">
      <SectionText text={text} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-2">
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
            Triangulasi AEGIS + ASPERSSI
            {tri ? ` (${tri.total_provinsi} Provinsi)` : ""}
          </p>
          <MiniBarChart data={barData} height={160} yWidth={100} />
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
            Top 5 Kompetitor (ASPERSSI)
          </p>
          {competitor?.top_5_kompetitor_asperssi?.length ? (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted">
                  <th className="text-left px-3 py-1.5 font-semibold text-xs">
                    Brand
                  </th>
                  <th className="text-right px-3 py-1.5 font-semibold text-xs">
                    MS%
                  </th>
                  <th className="text-right px-3 py-1.5 font-semibold text-xs">
                    Trend
                  </th>
                </tr>
              </thead>
              <tbody>
                {competitor.top_5_kompetitor_asperssi.map((k, i) => (
                  <tr
                    key={k.brand}
                    className={i % 2 === 0 ? "bg-background" : "bg-muted/30"}
                  >
                    <td className="px-3 py-1.5 text-xs font-medium">
                      {k.brand}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-right tabular-nums">
                      {k.avg_ms_pct.toFixed(1)}%
                    </td>
                    <td
                      className={`px-3 py-1.5 text-xs text-right tabular-nums ${
                        k.avg_trend_pp > 0
                          ? "text-red-600 dark:text-red-400"
                          : k.avg_trend_pp < 0
                          ? "text-green-600 dark:text-green-400"
                          : "text-muted-foreground"
                      }`}
                    >
                      {k.avg_trend_pp > 0 ? "+" : ""}
                      {k.avg_trend_pp.toFixed(1)} pp
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              Tidak ada data ASPERSSI.
            </p>
          )}

          {competitor?.aggregate_others && (
            <div className="mt-3 bg-muted/40 border border-dashed border-border rounded-lg p-3">
              <p className="text-xs text-muted-foreground">
                <span className="font-semibold">Brand Lainnya (Aggregat):</span>{" "}
                MS rata-rata {competitor.aggregate_others.avg_ms_pct.toFixed(1)}%
                {" "}(
                {competitor.aggregate_others.avg_trend_pp > 0 ? "+" : ""}
                {competitor.aggregate_others.avg_trend_pp.toFixed(1)} pp,{" "}
                {competitor.aggregate_others.trend_label})
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LoyaltySection({
  text,
  loyalty,
}: {
  text: string | undefined | null;
  loyalty: LoyaltySnapshot | undefined;
}) {
  const eff = loyalty?.efektivitas_bulan_ini;

  return (
    <div className="space-y-4">
      <SectionText text={text} />
      {loyalty && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
            {[
              {
                val: String(loyalty.total_aktif ?? "–"),
                label: "Peserta Aktif",
              },
              {
                val: eff ? `${eff.efektivitas_pct.toFixed(1)}%` : "–",
                label: "Efektivitas",
              },
              {
                val: eff
                  ? `${eff.volume_achievement_pct.toFixed(1)}%`
                  : "–",
                label: "Vol. Achievement",
              },
              {
                val: loyalty.est_budget_bulan
                  ? fmtRp(loyalty.est_budget_bulan)
                  : "–",
                label: "Est. Budget",
              },
            ].map(({ val, label }) => (
              <div
                key={label}
                className="bg-muted/30 rounded-lg p-3 text-center"
              >
                <div className="text-xl font-bold text-primary truncate">
                  {val}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {label}
                </div>
              </div>
            ))}
          </div>
          {eff?.interpretasi && (
            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
              <p className="text-xs text-blue-700 dark:text-blue-300">
                {eff.interpretasi}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PromoTypeCard({
  title,
  color,
  data,
  showTierChart,
  showLeaderboard,
}: {
  title: string;
  color: "blue" | "green" | "purple";
  data: PromoTypeData | undefined;
  showTierChart?: boolean;
  showLeaderboard?: boolean;
}) {
  const colorMap = {
    blue: "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800",
    green: "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800",
    purple: "bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800",
  };
  const titleColorMap = {
    blue: "text-blue-700 dark:text-blue-300",
    green: "text-green-700 dark:text-green-300",
    purple: "text-purple-700 dark:text-purple-300",
  };
  const numColorMap = {
    blue: "text-blue-600 dark:text-blue-400",
    green: "text-green-600 dark:text-green-400",
    purple: "text-purple-600 dark:text-purple-400",
  };

  if (!data) return null;

  const tierDonut =
    showTierChart && data.distribusi_tier
      ? Object.entries(data.distribusi_tier).map(([t, v], i) => ({
          name: t,
          value: v as number,
          fill: TIER_COLORS[i % TIER_COLORS.length],
        }))
      : [];

  return (
    <div className={`border rounded-lg p-4 ${colorMap[color]}`}>
      <div
        className={`text-xs font-bold uppercase tracking-wider mb-3 ${titleColorMap[color]}`}
      >
        {title}
      </div>
      <div className={`text-2xl font-bold ${numColorMap[color]}`}>
        {data.jumlah_aktif}
      </div>
      <div className="text-xs text-muted-foreground mb-3">Program Aktif</div>

      <div className="space-y-1.5 mb-3">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Peserta</span>
          <span className="font-semibold tabular-nums">{data.total_peserta}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Est. Budget</span>
          <span className="font-semibold tabular-nums">
            {fmtRp(data.total_rupiah)}
          </span>
        </div>
      </div>

      {showTierChart && tierDonut.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground mb-1">
            Distribusi Tier:
          </p>
          <MiniDonutChart
            data={tierDonut}
            height={140}
            innerRadius={28}
            outerRadius={48}
          />
        </>
      )}

      {showLeaderboard && data.top_3_overall?.length ? (
        <div className="mt-2 space-y-1">
          <p className="text-xs text-muted-foreground mb-1">Top Peserta:</p>
          {data.top_3_overall.slice(0, 3).map((item, idx) => (
            <div
              key={idx}
              className={`flex items-center gap-2 text-xs px-2 py-1 rounded border ${
                RANK_STYLES[idx] ?? RANK_STYLES[2]
              }`}
            >
              <span className="font-bold shrink-0">#{idx + 1}</span>
              <span className="truncate">{item.nama_toko}</span>
            </div>
          ))}
        </div>
      ) : null}

      {data.nama_program?.length > 0 && !showLeaderboard && (
        <div className="mt-2">
          <p className="text-xs text-muted-foreground mb-1">Program:</p>
          {data.nama_program.slice(0, 2).map((n, i) => (
            <p key={i} className="text-xs truncate text-muted-foreground">
              • {n}
            </p>
          ))}
          {data.nama_program.length > 2 && (
            <p className="text-xs text-muted-foreground">
              +{data.nama_program.length - 2} lainnya
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ProgramPromoSection({
  text,
  program_promo,
}: {
  text: string | undefined | null;
  program_promo: ProgramPromoSnapshot | undefined;
}) {
  return (
    <div className="space-y-4">
      <SectionText text={text} />
      {program_promo && (
        <>
          <div className="flex gap-4">
            {[
              { val: program_promo.total_program, label: "Total Program" },
              {
                val: program_promo.total_aktif,
                label: "Aktif",
                cls: "text-green-600 dark:text-green-400",
              },
              {
                val: program_promo.total_selesai,
                label: "Selesai",
                cls: "text-muted-foreground",
              },
            ].map(({ val, label, cls }) => (
              <div key={label} className="bg-muted/30 rounded-lg px-4 py-2 text-center">
                <div className={`text-lg font-bold ${cls ?? ""}`}>{val}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <PromoTypeCard
              title="Flat Multiplier"
              color="blue"
              data={program_promo.flat_multiplier}
            />
            <PromoTypeCard
              title="Multi-Tier"
              color="green"
              data={program_promo.multi_tier}
              showTierChart
            />
            <PromoTypeCard
              title="Leaderboard"
              color="purple"
              data={program_promo.leaderboard}
              showLeaderboard
            />
          </div>
        </>
      )}
    </div>
  );
}

function PerformanceSection({
  text,
  perf,
}: {
  text: string | undefined | null;
  perf: PerformanceSnapshot | undefined;
}) {
  const donutData = perf
    ? Object.entries(perf.verdict_distribution).map(([k, v]) => ({
        name: VERDICT_DIST_LABELS[k] ?? k,
        value: v as number,
        fill: VERDICT_DIST_COLORS[k] ?? "#6b7280",
      }))
    : [];

  return (
    <div className="space-y-4">
      <SectionText text={text} />
      {perf && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-2">
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
              Distribusi Verdict ({perf.total_dipantau} Toko Dipantau)
            </p>
            <MiniDonutChart data={donutData} height={180} />
            <div className="mt-3 text-center">
              <div className="text-3xl font-bold text-green-600 dark:text-green-400">
                {perf.success_rate_pct.toFixed(1)}%
              </div>
              <div className="text-xs text-muted-foreground">
                Success Rate (Membaik)
              </div>
            </div>
          </div>
          <div>
            {perf.top_5_success_stories?.length > 0 && (
              <>
                <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
                  Top 5 Success Stories
                </p>
                <div className="space-y-1.5">
                  {perf.top_5_success_stories.map((s, i) => (
                    <div
                      key={i}
                      className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded p-2"
                    >
                      <div className="text-xs font-semibold truncate">
                        {s.nama_toko}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {s.kabupaten} —{" "}
                        <span className="text-green-600 dark:text-green-400 font-semibold">
                          +{s.vol_delta_pct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {perf.watch_list?.length > 0 && (
              <>
                <p className="text-xs font-semibold text-muted-foreground mt-4 mb-2 uppercase tracking-wider">
                  Watch List
                </p>
                <div className="space-y-1.5">
                  {perf.watch_list.map((s, i) => (
                    <div
                      key={i}
                      className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded p-2"
                    >
                      <div className="text-xs font-semibold truncate">
                        {s.nama_toko}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {s.kabupaten} —{" "}
                        <span className="text-red-600 dark:text-red-400 font-semibold">
                          {s.vol_delta_pct.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {!perf.top_5_success_stories?.length && !perf.watch_list?.length && (
              <p className="text-xs text-muted-foreground italic">
                Tidak ada data toko dipantau.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RekomendasiSection({ text }: { text: string | undefined | null }) {
  if (!text) return <SectionError />;

  const items = parseRekomendasi(text);

  if (items.length === 1 && items[0].num === 0) {
    return (
      <div className="text-sm whitespace-pre-line leading-relaxed">{text}</div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.num} className="border border-border rounded-lg p-4">
          <div className="flex items-start gap-3">
            {item.num > 0 && (
              <span className="w-6 h-6 bg-primary text-primary-foreground rounded text-xs flex items-center justify-center shrink-0 font-bold mt-0.5">
                {item.num}
              </span>
            )}
            <div className="flex-1">
              <p className="text-sm leading-relaxed">{item.text}</p>
              {(item.urgensi || item.pic) && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {item.urgensi && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded border ${
                        URGENCY_STYLES[item.urgensi]
                      }`}
                    >
                      Urgensi: {item.urgensi}
                    </span>
                  )}
                  {item.pic && (
                    <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-700">
                      PIC: {item.pic}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function ReportPage() {
  const [report, setReport] = useState<FullReport | null>(null);
  const [generating, setGenerating] = useState(false);
  const [step, setStep] = useState(0);
  const [downloading, setDownloading] = useState(false);

  async function generate() {
    setGenerating(true);
    setReport(null);
    setStep(0);

    const timer = setInterval(() => {
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    }, 5000);

    try {
      const token = getToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      const res = await fetch(`${API}/api/home/report/generate`, {
        method: "POST",
        headers,
      });
      const json = await res.json();
      const d = (json.data ?? json) as ReportResult;

      setReport({ result: d });
    } catch {
      // silent — user can retry
    } finally {
      clearInterval(timer);
      setStep(STEPS.length - 1);
      setGenerating(false);
    }
  }

  async function downloadPdf() {
    setDownloading(true);
    try {
      const token = getToken();
      const periode = report?.result?.periode ?? "";
      const res = await fetch(
        `${API}/api/home/report/pdf?periode=${encodeURIComponent(periode)}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Laporan_Bulanan_${periode.replace("-", "_")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silent
    } finally {
      setDownloading(false);
    }
  }

  const sections = report?.result?.sections;
  const raw = report?.result?.raw_data;
  const periode = report?.result?.periode;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16 max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FileText className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            <h1 className="text-2xl font-bold tracking-tight">
              AI Report Generator
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Generate laporan bulanan otomatis — mencakup AEGIS, Competitor
            Intelligence, Loyalty, Program Promo, dan Performance Tracker.
          </p>
        </div>

        {/* Generate card */}
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="flex-1">
                <p className="text-sm font-semibold mb-1">
                  Generate Laporan Bulan Ini
                </p>
                <p className="text-xs text-muted-foreground">
                  AI akan menganalisis semua modul platform secara sequential.
                  Proses membutuhkan ~30–45 detik (7 analisis AI).
                </p>
              </div>
              <Button
                onClick={generate}
                disabled={generating}
                className="shrink-0 gap-2"
                size="lg"
              >
                <Sparkles
                  className={`h-4 w-4 ${generating ? "animate-pulse" : ""}`}
                />
                {generating ? "Generating…" : "Generate Laporan"}
              </Button>
            </div>

            {generating && (
              <div className="mt-6 space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span className="animate-pulse">{STEPS[step].label}</span>
                  <span>{STEPS[step].pct}%</span>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-1000"
                    style={{ width: `${STEPS[step].pct}%` }}
                  />
                </div>
                <div className="flex gap-1.5 justify-center pt-1">
                  {STEPS.map((_, i) => (
                    <div
                      key={i}
                      className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
                        i <= step ? "bg-primary" : "bg-muted-foreground/30"
                      }`}
                    />
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Action buttons (only when done) */}
        {sections && (
          <div className="flex items-center gap-3">
            <Button onClick={downloadPdf} disabled={downloading} className="gap-2">
              <Download className="h-4 w-4" />
              {downloading ? "Menyiapkan PDF…" : "Download PDF"}
            </Button>
            <Button
              variant="outline"
              onClick={generate}
              disabled={generating}
              className="gap-2"
            >
              <RefreshCw
                className={`h-4 w-4 ${generating ? "animate-spin" : ""}`}
              />
              Regenerate
            </Button>
            {report?.result?.generated_at && (
              <span className="text-xs text-muted-foreground ml-auto">
                Generated:{" "}
                {new Date(report.result.generated_at).toLocaleString("id-ID")}
              </span>
            )}
          </div>
        )}

        {/* Skeleton while generating */}
        {generating && !sections && (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-56 w-full rounded-xl" />
          </div>
        )}

        {/* Report preview */}
        {sections && (
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg p-8 space-y-10 border">

            {/* Cover */}
            <div className="text-center border-b border-border pb-6">
              <div className="text-2xl font-bold tracking-tight">
                LAPORAN BULANAN
              </div>
              <div className="text-base text-muted-foreground mt-1">
                Ringkasan Kinerja Distribusi — {periode}
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                Generated by CORE Platform AI •{" "}
                {report?.result?.generated_at
                  ? new Date(report.result.generated_at).toLocaleString("id-ID")
                  : ""}
              </div>
            </div>

            {/* 1. Executive Summary */}
            <section>
              <SectionHeader num={1} title="Executive Summary" />
              <SectionText text={sections.executive_summary} />
            </section>

            {/* 2. KPI Utama */}
            <section>
              <SectionHeader num={2} title="KPI Utama Bulan Ini" />
              {raw?.summary ? (
                <KpiSection summary={raw.summary} />
              ) : (
                <Skeleton className="h-40 w-full rounded" />
              )}
            </section>

            {/* 3. AEGIS */}
            <section>
              <SectionHeader num={3} title="Kondisi Pasar & AEGIS Warning" />
              <AegisSection
                text={sections.analisis_aegis}
                aegis={raw?.aegis}
              />
            </section>

            {/* 4. Competitor Intelligence */}
            <section>
              <SectionHeader num={4} title="Competitor Intelligence" />
              <CompetitorSection
                text={sections.analisis_competitor}
                competitor={raw?.competitor}
              />
            </section>

            {/* 5. Loyalty */}
            <section>
              <SectionHeader num={5} title="Program Loyalty" />
              <LoyaltySection
                text={sections.analisis_loyalty}
                loyalty={raw?.loyalty}
              />
            </section>

            {/* 6. Program Promo */}
            <section>
              <SectionHeader num={6} title="Breakdown Program Promo" />
              <ProgramPromoSection
                text={sections.breakdown_program_promo}
                program_promo={raw?.program_promo}
              />
            </section>

            {/* 7. Performance Tracker */}
            <section>
              <SectionHeader num={7} title="Performance Tracker Outcome" />
              <PerformanceSection
                text={sections.performance_outcome}
                perf={raw?.performance_tracker}
              />
            </section>

            {/* 8. Rekomendasi */}
            <section>
              <SectionHeader num={8} title="Rekomendasi Tindakan" />
              <RekomendasiSection text={sections.rekomendasi} />
            </section>

            {/* Footer */}
            <div className="border-t border-border pt-4 text-center">
              <p className="text-xs text-muted-foreground">
                Generated by CORE Platform AI • Data berbasis transaksi
                internal • Untuk keperluan internal
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
