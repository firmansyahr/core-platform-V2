"use client";

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import TokoValidasiModal from "@/components/TokoValidasiModal";
import { useAuth } from "@/hooks/useAuth";
import { getUser } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, RefreshCw } from "lucide-react";
import StoreJourneyModal from "@/components/StoreJourneyModal";
import {
  ComposedChart,
  BarChart,
  Bar,
  Line,
  Area,
  Cell,
  LabelList,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
  ReferenceArea,
} from "recharts";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ─── Performance Types ────────────────────────────────────────────────────────

interface StorePerf {
  info: { id_toko: string; nama_toko: string; kabupaten: string; cluster_pareto: string; tso: string };
  current_aegis: { score: number; level: string; pola: string };
  loyalty: { status: string; tgl_masuk: string | null; tgl_keluar: string | null; reward_type: string; enrollment_count: number } | null;
  outcome: { vol_before_avg: number; vol_after_avg: number; vol_delta_pct: number; fbsi_before_avg: number; fbsi_after_avg: number; fbsi_delta_pp: number; verdict: string; verdict_detail: string; verdict_color: string };
  monthly_trend: { periode: string; ton_total: number; ton_main: number; ton_fighting: number; fbsi: number; trx_count: number }[];
}

// ─── Predict Types ────────────────────────────────────────────────────────────

interface ForecastPoint {
  ds: string;
  yhat: number;
  yhat_lower: number;
  yhat_upper: number;
}

interface PredictResult {
  status: "ok" | "insufficient_data" | "error";
  message?: string;
  id_toko?: string;
  current_score?: number;
  current_level?: string;
  predicted_score_4w?: number;
  predicted_level_4w?: string;
  trend?: string;
  trend_delta?: number;
  trend_color?: string;
  level_change?: boolean;
  level_worse?: boolean;
  historical?: ForecastPoint[];
  forecast?: ForecastPoint[];
  horizon_weeks?: number;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface InfoToko {
  id_toko: string;
  nama_toko: string;
  kabupaten: string;
  provinsi: string;
  cluster_pareto: string;
  tso: string;
  asm: string;
  ssm: string;
}

interface CurrentWarning {
  aegis_score: number;
  crs: number;
  level: string;
  pola: string;
  pola_kode: string;
  churn_prob: number;
  if_label: number;
  if_score: number;
}

interface MetricsCurrent {
  fbsi_latest: number;
  fbsi_baseline: number;
  he_latest: number;
  ors_cv_latest: number;
  delta_fbsi: number;
  delta_he_pct: number;
  delta_cv: number;
  fbsi_threshold: number;
  he_threshold: number;
}

interface TrenBulanan {
  bulan: string;
  ton_total: number;
  ton_main: number;
  ton_fighting: number;
  fbsi_pct: number;
}

interface TrenFbsiPeriod {
  periode: string;
  fbsi_pct: number;
  he_value: number;
  delta_fbsi: number;
}

interface StoreDetail {
  info_toko: InfoToko;
  current_warning: CurrentWarning;
  metrics_current: MetricsCurrent;
  tren_bulanan: TrenBulanan[];
  tren_fbsi: TrenFbsiPeriod[];
  avg_ton_bulanan: number;
  total_transaksi: number;
  bulan_aktif: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtNum = (n: number) => new Intl.NumberFormat("id-ID").format(Math.round(n));
const fmtRp = (n: number) => "Rp " + new Intl.NumberFormat("id-ID").format(Math.round(n));

const fmtPeriod = (p: string) => {
  const [y, m] = p.split("-");
  const names = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  return `${names[+m - 1]} '${y.slice(2)}`;
};

const LEVEL_COLOR: Record<string, string> = {
  Merah: "#DC2626", Oranye: "#EA580C", Kuning: "#CA8A04",
};
const CLUSTER_COLOR: Record<string, string> = {
  "Super Platinum": "#f59e0b", Platinum: "#8b5cf6",
  Gold: "#f97316", Silver: "#6b7280", Bronze: "#92400e",
};

const scoreColor = (s: number) =>
  s >= 85 ? "#DC2626" : s >= 65 ? "#EA580C" : s >= 40 ? "#CA8A04" : "#16a34a";

const POLA_ACTION: Record<string, { title: string; desc: string; urgency: string; steps: string[] }> = {
  A: {
    title: "Pergeseran produk — FBSI naik, harga turun",
    desc: "Volume bergeser ke fighting brand, harga efektif turun. Pola order masih teratur. Kemungkinan toko merespons permintaan pelanggan untuk produk lebih murah.",
    urgency: "Kunjungi dalam 7 hari",
    steps: [
      "Edukasi toko tentang margin Main Brand vs Fighting Brand",
      "Tawarkan program loyalty atau volume bonus untuk Main Brand",
      "Cek apakah ada tekanan harga dari area sekitar",
      "Pantau apakah pola order mulai tidak stabil (berkembang ke Pola B)",
    ],
  },
  B: {
    title: "Tiga Sinyal Aktif Bersamaan — Prioritas Tertinggi",
    desc: "FBSI naik + HE turun + ORS tidak stabil — tiga sinyal aktif bersamaan. Kemungkinan tertinggi ada tekanan dari produk lain di wilayah ini. Prioritas validasi lapangan segera.",
    urgency: "Eskalasi ke ASM dalam 72 jam",
    steps: [
      "Eskalasi ke ASM dalam 72 jam untuk kunjungan bersama",
      "Kunjungi toko segera — investigasi kondisi lapangan secara langsung",
      "Cek apakah toko sekitar juga menunjukkan pola serupa (lihat CAD Alert wilayah)",
      "Investigasi: ada produk lain masuk area? Ada perbedaan harga signifikan?",
    ],
  },
  C: {
    title: "Pre-warning — Pola order berubah",
    desc: "Pola order tidak teratur — toko diprediksi beli tapi tidak beli sesuai jadwal. FBSI dan harga masih normal. Ini sinyal paling awal, belum tentu ada masalah serius.",
    urgency: "Kunjungi dalam 7 hari",
    steps: [
      "Apakah ada masalah stok atau keterlambatan pengiriman dari agen?",
      "Apakah toko sedang mencoba produk lain secara terbatas?",
      "Apakah ada perubahan kebutuhan pelanggan toko (musim, proyek, dll)?",
      "Tindak sebelum FBSI atau HE juga mulai bergerak (berkembang ke Pola A atau B)",
    ],
  },
  D: {
    title: "Pemulihan — Momentum Positif",
    desc: "Semua sinyal membaik — toko kembali ke pola normal. Momentum positif, pertahankan dengan program loyalitas.",
    urgency: "Kunjungi dalam 30 hari",
    steps: [
      "Pertahankan momentum dengan kunjungan rutin dan program reward",
      "Tawarkan peningkatan target volume untuk memanfaatkan momentum positif",
      "Perkuat hubungan — presentasikan data tren perbaikan toko",
      "Usulkan kenaikan target atau program intensif untuk kuartal berikutnya",
    ],
  },
};

// ─── AEGIS-EXPLAIN Section (SHAP) ────────────────────────────────────────────

interface ExplainContribution {
  feature: string;
  label: string;
  feature_value: number;
  shap_value: number;
  abs_shap: number;
  direction: "meningkatkan_risiko" | "menurunkan_risiko";
  pct_contribution: number;
}

interface ExplainResult {
  status: "ok" | "not_found" | "missing_features" | "model_not_ready" | "error";
  message?: string;
  id_toko?: string;
  base_value?: number;
  pred_probability?: number;
  contributions?: ExplainContribution[];
  top_risk_factor?: string | null;
  narasi?: string;
  total_features?: number;
}

function fmtFeatureVal(feature: string, val: number): string {
  switch (feature) {
    case "n_weeks_high":    return `${Math.round(val)} minggu`;
    case "delta_fbsi":      return `${val >= 0 ? "+" : ""}${val.toFixed(1)} pp`;
    case "s_fbsi_adjusted": return val.toFixed(1);
    case "s_he":            return val.toFixed(1);
    case "delta_he_pct":    return `${val >= 0 ? "+" : ""}${val.toFixed(1)}%`;
    case "s_ors":           return val.toFixed(1);
    case "delta_cv":        return `${val >= 0 ? "+" : ""}${val.toFixed(3)}`;
    case "if_score_norm":   return val.toFixed(1);
    default:                return val.toFixed(3);
  }
}

function ShapBarTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: { label: string; value: number; pct: number; direction: string; feature_value: number; feature: string } }[];
}) {
  if (!active || !payload?.length) return null;
  const pt = payload[0]?.payload;
  const isRisk = pt?.direction === "meningkatkan_risiko";
  const shv = pt?.value ?? 0;
  const rc = isRisk ? "#DC2626" : "#16a34a";
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg text-xs space-y-0.5 max-w-[240px]">
      <p className="font-semibold text-[11px] leading-snug">{pt?.label}</p>
      <p className="text-muted-foreground">
        Nilai aktual:{" "}
        <span className="font-medium text-foreground">
          {fmtFeatureVal(pt?.feature ?? "", pt?.feature_value ?? 0)}
        </span>
      </p>
      <p>
        SHAP:{" "}
        <span className="font-semibold" style={{ color: rc }}>
          {shv >= 0 ? "+" : ""}{shv.toFixed(3)}
        </span>
      </p>
      <p>
        Kontribusi: <span className="font-medium">{pt?.pct?.toFixed(1)}%</span> dari total risiko
      </p>
      <p className="text-[10px] font-semibold" style={{ color: rc }}>
        {isRisk ? "↑ Meningkatkan risiko" : "↓ Menurunkan risiko"}
      </p>
    </div>
  );
}

function ExplainSection({
  explain,
  loading,
  cachedAt,
  onRefresh,
}: {
  explain: ExplainResult | null;
  loading: boolean;
  cachedAt: string | null;
  onRefresh: () => void;
}) {
  const contributions = explain?.status === "ok" ? (explain.contributions ?? []) : [];
  const maxAbsShap = Math.max(...contributions.map((c) => c.abs_shap), 0.001);

  const chartData = contributions.map((c) => ({
    label: c.label,
    shortLabel: c.label.length > 28 ? c.label.slice(0, 27) + "…" : c.label,
    value: c.shap_value,
    abs_shap: c.abs_shap,
    pct: c.pct_contribution,
    direction: c.direction,
    feature_value: c.feature_value,
    feature: c.feature,
  }));

  const topRisk = contributions.filter((c) => c.direction === "meningkatkan_risiko").slice(0, 3);

  return (
    <Card>
      <CardHeader className="border-b border-border pb-3">
        <CardTitle className="flex items-center justify-between gap-2">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold">
              🔍 Mengapa Toko Ini Berisiko?
              <Badge variant="outline" className="text-[10px]">SHAP Explainer</Badge>
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Kontribusi setiap faktor terhadap prediksi risiko XGBoost
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {explain?.status === "ok" && (
              <span className="text-[11px] text-muted-foreground">
                Prob risiko:{" "}
                <span className="font-semibold text-foreground">
                  {((explain.pred_probability ?? 0) * 100).toFixed(1)}%
                </span>
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs px-2"
              onClick={onRefresh}
              disabled={loading}
            >
              {loading ? "⏳" : "🔄"} Refresh
            </Button>
          </div>
        </CardTitle>
        {cachedAt && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Cache 1 jam · Terakhir dihitung: {cachedAt}
          </p>
        )}
      </CardHeader>

      <CardContent className="pt-4 space-y-4">
        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-5 w-4/5 rounded" />
            <div className="space-y-1.5">
              {[...Array(8)].map((_, i) => (
                <Skeleton key={i} className="h-5 rounded" style={{ width: `${55 + Math.random() * 40}%` }} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground text-center animate-pulse">
              Menghitung SHAP values… beberapa detik
            </p>
          </div>
        )}

        {!loading && explain?.status === "model_not_ready" && (
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-5 text-center space-y-1">
            <p className="text-sm font-medium">Model belum siap</p>
            <p className="text-xs text-muted-foreground">
              {explain.message ?? "Pastikan data sudah dimuat dan AEGIS engine sudah berjalan."}
            </p>
          </div>
        )}

        {!loading && explain?.status === "error" && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            Gagal menghitung SHAP: {explain.message}
          </div>
        )}

        {!loading &&
          (explain?.status === "not_found" || explain?.status === "missing_features") && (
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-5 text-center">
              <p className="text-sm font-medium text-muted-foreground">Data toko tidak tersedia</p>
            </div>
          )}

        {!loading && explain?.status === "ok" && (
          <>
            {/* Narasi */}
            <div className="bg-muted/50 rounded-lg px-3 py-2.5 text-xs leading-relaxed">
              💡 {explain.narasi}
            </div>

            {/* SHAP horizontal bar chart */}
            <div>
              <p className="text-[10px] text-muted-foreground mb-2 px-1">
                Bar{" "}
                <span className="text-red-600 font-semibold">merah</span> = meningkatkan risiko ·
                Bar{" "}
                <span className="text-green-600 font-semibold">hijau</span> = menurunkan risiko
              </p>
              <ResponsiveContainer width="100%" height={234}>
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 2, right: 54, left: 8, bottom: 2 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    horizontal={false}
                    stroke="currentColor"
                    strokeOpacity={0.07}
                  />
                  <XAxis
                    type="number"
                    domain={["auto", "auto"]}
                    tick={{ fontSize: 9, fill: "currentColor" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => v.toFixed(2)}
                  />
                  <YAxis
                    type="category"
                    dataKey="shortLabel"
                    width={172}
                    tick={{ fontSize: 9, fill: "currentColor" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<ShapBarTooltip />} />
                  <ReferenceLine
                    x={0}
                    stroke="currentColor"
                    strokeOpacity={0.25}
                    strokeWidth={1.5}
                  />
                  <Bar dataKey="value" maxBarSize={18} radius={[0, 2, 2, 0]}>
                    {chartData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.direction === "meningkatkan_risiko" ? "#DC2626" : "#16a34a"}
                        fillOpacity={Math.min(0.9, 0.45 + (entry.abs_shap / maxAbsShap) * 0.5)}
                      />
                    ))}
                    <LabelList
                      dataKey="pct"
                      position="right"
                      style={{ fontSize: 9, fill: "#6b7280" }}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      formatter={(v: any) => `${Number(v).toFixed(1)}%`}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Detail table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Faktor</th>
                    <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Nilai Aktual</th>
                    <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Kontribusi SHAP</th>
                    <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Arah</th>
                    <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">% Total</th>
                  </tr>
                </thead>
                <tbody>
                  {contributions.map((c) => {
                    const isRisk = c.direction === "meningkatkan_risiko";
                    const rc = isRisk ? "#DC2626" : "#16a34a";
                    return (
                      <tr
                        key={c.feature}
                        className="border-b border-border/40 hover:bg-muted/20 transition-colors"
                      >
                        <td className="py-1.5 px-2 font-medium max-w-[160px]">
                          <span title={c.label}>
                            {c.label.length > 26 ? c.label.slice(0, 25) + "…" : c.label}
                          </span>
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
                          {fmtFeatureVal(c.feature, c.feature_value)}
                        </td>
                        <td
                          className="py-1.5 px-2 text-right tabular-nums font-semibold"
                          style={{ color: rc }}
                        >
                          {c.shap_value >= 0 ? "+" : ""}
                          {c.shap_value.toFixed(3)}
                        </td>
                        <td className="py-1.5 px-2 text-center">
                          <span
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold"
                            style={{
                              color: rc,
                              backgroundColor: `${rc}14`,
                              border: `1px solid ${rc}30`,
                            }}
                          >
                            {isRisk ? "↑ Naik" : "↓ Turun"}
                          </span>
                        </td>
                        <td className="py-1.5 px-2">
                          <div className="flex items-center gap-1.5 justify-end">
                            <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{ width: `${c.pct_contribution}%`, backgroundColor: rc }}
                              />
                            </div>
                            <span className="tabular-nums text-muted-foreground w-8 text-right">
                              {c.pct_contribution.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Top risk factors summary */}
            {topRisk.length > 0 && (
              <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 p-3">
                <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-2">
                  {topRisk.length} faktor utama yang mendorong risiko toko ini:
                </p>
                <ol className="space-y-1">
                  {topRisk.map((c, i) => (
                    <li key={c.feature} className="text-xs flex items-start gap-1.5">
                      <span className="text-red-500 font-bold shrink-0">{i + 1}.</span>
                      <span>
                        <span className="font-medium">{c.label}</span>
                        <span className="text-red-600/70 dark:text-red-400/70 ml-1">
                          — kontribusi {c.pct_contribution.toFixed(1)}%
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── AEGIS-PREDICT Section ────────────────────────────────────────────────────

function trendBadgeClass(color: string) {
  switch (color) {
    case "red":    return "border-red-500 text-red-600 dark:text-red-400";
    case "orange": return "border-orange-500 text-orange-600 dark:text-orange-400";
    case "green":  return "border-green-500 text-green-600 dark:text-green-400";
    case "blue":   return "border-blue-500 text-blue-600 dark:text-blue-400";
    default:       return "border-border text-muted-foreground";
  }
}

interface PredictChartPoint {
  ds: string;
  ds_label: string;
  yhat_hist: number | null;
  yhat_fore: number | null;
  ci_lower: number | null;
  ci_upper: number | null;
}

function PredictTooltip({
  active, payload, label,
}: { active?: boolean; payload?: { name: string; value: number; payload: PredictChartPoint }[]; label?: string }) {
  if (!active || !payload?.length || !label) return null;
  const pt = payload[0]?.payload;
  const isFore = pt?.yhat_fore !== null && pt?.yhat_fore !== undefined;
  const score = pt?.yhat_hist ?? pt?.yhat_fore ?? 0;
  const level = score >= 85 ? "Merah" : score >= 65 ? "Oranye" : score >= 40 ? "Kuning" : "Normal";
  const lc = LEVEL_COLOR[level] ?? "#6b7280";
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg text-xs space-y-0.5">
      <p className="font-semibold">{pt?.ds_label ?? label}</p>
      <p>Skor: <span className="font-bold" style={{ color: lc }}>{score.toFixed(1)}</span></p>
      <p>Level: <span className="font-semibold" style={{ color: lc }}>{level}</span></p>
      {isFore && pt?.ci_lower !== null && pt?.ci_upper !== null && (
        <p className="text-muted-foreground">Range 80%: {pt.ci_lower} – {pt.ci_upper}</p>
      )}
      {isFore && <p className="text-blue-500 text-[10px]">Prediksi</p>}
    </div>
  );
}

function PredictSection({
  predict,
  loading,
  cachedAt,
  onRefresh,
}: {
  predict: PredictResult | null;
  loading: boolean;
  cachedAt: string | null;
  onRefresh: () => void;
}) {
  // Build combined chart data
  const chartData: PredictChartPoint[] = [];
  if (predict?.status === "ok") {
    (predict.historical ?? []).forEach((p) => {
      chartData.push({
        ds: p.ds,
        ds_label: new Date(p.ds).toLocaleDateString("id-ID", { day: "2-digit", month: "short" }),
        yhat_hist: p.yhat,
        yhat_fore: null,
        ci_lower: null,
        ci_upper: null,
      });
    });
    // Overlap last historical point with first forecast for visual continuity
    const lastHist = chartData[chartData.length - 1];
    (predict.forecast ?? []).forEach((p, i) => {
      if (i === 0 && lastHist) {
        // Bridge: update last hist point to also carry yhat_fore
        lastHist.yhat_fore = lastHist.yhat_hist;
        lastHist.ci_lower  = p.yhat_lower;
        lastHist.ci_upper  = p.yhat_upper;
      }
      chartData.push({
        ds: p.ds,
        ds_label: new Date(p.ds).toLocaleDateString("id-ID", { day: "2-digit", month: "short" }) + " *",
        yhat_hist: null,
        yhat_fore: p.yhat,
        ci_lower: p.yhat_lower,
        ci_upper: p.yhat_upper,
      });
    });
  }

  const splitDate = predict?.historical?.at(-1)?.ds;
  const forecastStart = predict?.forecast?.[0]?.ds;

  return (
    <Card>
      <CardHeader className="border-b border-border pb-3">
        <CardTitle className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">Prediksi AEGIS Score — 4 Minggu ke Depan</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Berbasis Prophet forecasting · confidence interval 80%
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {predict?.status === "ok" && predict.trend_color && (
              <Badge
                variant="outline"
                className={`text-xs ${trendBadgeClass(predict.trend_color)}`}
              >
                {predict.trend} {(predict.trend_delta ?? 0) >= 0 ? "+" : ""}{predict.trend_delta} poin
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs px-2"
              onClick={onRefresh}
              disabled={loading}
            >
              {loading ? "⏳" : "🔄"} Refresh
            </Button>
          </div>
        </CardTitle>
        {cachedAt && (
          <p className="text-[10px] text-muted-foreground mt-0.5">Cache 1 jam · Terakhir dihitung: {cachedAt}</p>
        )}
      </CardHeader>
      <CardContent className="pt-4 space-y-4">

        {loading && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              {[0,1,2].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
            </div>
            <Skeleton className="h-52 w-full rounded-xl" />
            <p className="text-xs text-muted-foreground text-center animate-pulse">
              Menjalankan Prophet forecasting… prediksi pertama membutuhkan beberapa detik
            </p>
          </div>
        )}

        {!loading && (!predict || predict.status === "insufficient_data") && (
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-5 text-center space-y-1">
            <p className="text-sm font-medium">Data tidak cukup untuk forecasting</p>
            <p className="text-xs text-muted-foreground">
              {predict?.message ?? "Butuh minimal 12 minggu data historis untuk menjalankan Prophet."}
            </p>
          </div>
        )}

        {!loading && predict?.status === "error" && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            Forecasting gagal: {predict.message}
          </div>
        )}

        {!loading && predict?.status === "ok" && (
          <>
            {/* 3 summary cards */}
            <div className="grid grid-cols-3 gap-3">
              {/* Current */}
              {(() => {
                const col = scoreColor(predict.current_score ?? 0);
                return (
                  <div className="rounded-xl border border-border bg-muted/30 px-3 py-3 text-center">
                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-1">Skor Saat Ini</p>
                    <p className="text-2xl font-bold tabular-nums" style={{ color: col }}>
                      {predict.current_score?.toFixed(1)}
                    </p>
                    <span
                      className="mt-1 inline-block text-[10px] font-bold px-1.5 py-0.5 rounded"
                      style={{ color: LEVEL_COLOR[predict.current_level ?? ""] ?? "#6b7280",
                        backgroundColor: `${LEVEL_COLOR[predict.current_level ?? ""] ?? "#6b7280"}18` }}
                    >
                      {predict.current_level}
                    </span>
                  </div>
                );
              })()}

              {/* Predicted */}
              {(() => {
                const col = scoreColor(predict.predicted_score_4w ?? 0);
                const changed = predict.level_change;
                return (
                  <div
                    className="rounded-xl border px-3 py-3 text-center"
                    style={changed
                      ? { borderColor: `${col}50`, backgroundColor: `${col}08` }
                      : { borderColor: "hsl(var(--border))", backgroundColor: "hsl(var(--muted)/0.3)" }
                    }
                  >
                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-1">Prediksi 4W</p>
                    <p className="text-2xl font-bold tabular-nums" style={{ color: col }}>
                      {predict.predicted_score_4w?.toFixed(1)}
                    </p>
                    <span
                      className="mt-1 inline-block text-[10px] font-bold px-1.5 py-0.5 rounded"
                      style={{ color: col, backgroundColor: `${col}18`,
                        ...(changed ? { border: `1px solid ${col}40` } : {}),
                      }}
                    >
                      {predict.predicted_level_4w}
                      {changed && " ←"}
                    </span>
                  </div>
                );
              })()}

              {/* Trend */}
              {(() => {
                const delta = predict.trend_delta ?? 0;
                const color = predict.trend_color ?? "gray";
                const arrow = delta > 3 ? "↑" : delta < -3 ? "↓" : "→";
                const cssColor = color === "red" ? "#DC2626" : color === "orange" ? "#EA580C"
                  : color === "green" ? "#16a34a" : color === "blue" ? "#3b82f6" : "#6b7280";
                return (
                  <div className="rounded-xl border border-border bg-muted/30 px-3 py-3 text-center">
                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-1">Tren</p>
                    <p className="text-2xl font-bold" style={{ color: cssColor }}>{arrow}</p>
                    <p className="text-[11px] font-semibold mt-0.5" style={{ color: cssColor }}>{predict.trend}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {delta >= 0 ? "+" : ""}{delta} poin
                    </p>
                  </div>
                );
              })()}
            </div>

            {/* Level change alert */}
            {predict.level_change && (() => {
              const worse = predict.level_worse;
              const predLevel = predict.predicted_level_4w;
              if (worse) {
                return (
                  <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/20 dark:border-red-800 px-4 py-3 text-sm">
                    <p className="font-semibold text-red-700 dark:text-red-400 mb-0.5">
                      ⚠️ Prediksi Level Memburuk
                    </p>
                    <p className="text-red-600/80 dark:text-red-300/80 text-xs">
                      Toko ini berpotensi masuk level <strong>{predLevel}</strong> dalam 4 minggu ke depan.
                      Pertimbangkan tindakan preventif segera.
                    </p>
                  </div>
                );
              }
              return (
                <div className="rounded-lg border border-green-300 bg-green-50 dark:bg-green-950/20 dark:border-green-800 px-4 py-3 text-sm">
                  <p className="font-semibold text-green-700 dark:text-green-400 mb-0.5">
                    ✅ Prediksi Level Membaik
                  </p>
                  <p className="text-green-600/80 dark:text-green-300/80 text-xs">
                    Kondisi toko berpotensi membaik ke level <strong>{predLevel}</strong>.
                    Pertahankan program yang berjalan.
                  </p>
                </div>
              );
            })()}

            {/* Chart */}
            <div className="relative">
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-[10px] text-muted-foreground">← Historis (12 minggu)</span>
                <span className="text-[10px] text-blue-500">Prediksi (4 minggu) →</span>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="ciGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.07} />
                  <XAxis
                    dataKey="ds_label"
                    tick={{ fontSize: 9, fill: "currentColor" }}
                    tickLine={false}
                    axisLine={false}
                    interval={2}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 10, fill: "currentColor" }}
                    tickLine={false}
                    axisLine={false}
                    width={28}
                  />
                  <Tooltip content={<PredictTooltip />} />

                  {/* Zone shading */}
                  {splitDate && forecastStart && (
                    <>
                      <ReferenceArea
                        x1={chartData[0]?.ds_label}
                        x2={splitDate ? new Date(splitDate).toLocaleDateString("id-ID", { day: "2-digit", month: "short" }) : undefined}
                        fill="currentColor"
                        fillOpacity={0.02}
                      />
                      <ReferenceArea
                        x1={forecastStart ? new Date(forecastStart).toLocaleDateString("id-ID", { day: "2-digit", month: "short" }) + " *" : undefined}
                        x2={chartData.at(-1)?.ds_label}
                        fill="#3b82f6"
                        fillOpacity={0.04}
                      />
                    </>
                  )}

                  {/* Threshold reference lines */}
                  <ReferenceLine y={40} stroke="#CA8A04" strokeDasharray="4 3" strokeOpacity={0.5}
                    label={{ value: "Kuning", fontSize: 9, fill: "#CA8A04", position: "insideTopRight" }} />
                  <ReferenceLine y={65} stroke="#EA580C" strokeDasharray="4 3" strokeOpacity={0.5}
                    label={{ value: "Oranye", fontSize: 9, fill: "#EA580C", position: "insideTopRight" }} />
                  <ReferenceLine y={85} stroke="#DC2626" strokeDasharray="4 3" strokeOpacity={0.5}
                    label={{ value: "Merah", fontSize: 9, fill: "#DC2626", position: "insideTopRight" }} />

                  {/* CI band (forecast only) */}
                  <Area
                    dataKey="ci_upper"
                    stroke="none"
                    fill="url(#ciGradient)"
                    legendType="none"
                    connectNulls={false}
                    dot={false}
                    activeDot={false}
                    name="CI Upper"
                  />
                  <Area
                    dataKey="ci_lower"
                    stroke="none"
                    fill="#ffffff"
                    fillOpacity={1}
                    legendType="none"
                    connectNulls={false}
                    dot={false}
                    activeDot={false}
                    name="CI Lower"
                  />

                  {/* Historical line */}
                  <Line
                    dataKey="yhat_hist"
                    name="Aktual"
                    stroke="#3b82f6"
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 4, fill: "#3b82f6" }}
                    connectNulls={false}
                    legendType="line"
                  />
                  {/* Forecast line */}
                  <Line
                    dataKey="yhat_fore"
                    name="Prediksi"
                    stroke="#f97316"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    dot={false}
                    activeDot={{ r: 4, fill: "#f97316" }}
                    connectNulls={false}
                    legendType="line"
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                    formatter={(value) => (
                      <span className="text-foreground/80">{value}</span>
                    )}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Performance Tracker Card ─────────────────────────────────────────────────

const VERDICT_BADGE_CLS: Record<string, string> = {
  "Membaik":          "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  "Stabil":           "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "Perlu Perhatian":  "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  "Dalam Pemantauan": "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  "Belum di Program": "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
};

function PerformanceCard({
  perf, loading, idToko, onShowJourney,
}: {
  perf: StorePerf | null; loading: boolean; idToko: string; onShowJourney: () => void;
}) {
  return (
    <Card>
      <CardHeader className="border-b border-border pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              Performance Tracker
              <span className="text-[10px] font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded-md">
                AEGIS → Loyalty → Outcome
              </span>
            </CardTitle>
          </div>
          {!loading && perf && (
            <Button variant="outline" size="sm" className="text-xs h-7" onClick={onShowJourney}>
              Lihat Detail Performa →
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {loading ? (
          <div className="flex gap-4">
            <Skeleton className="h-14 flex-1 rounded-lg" />
            <Skeleton className="h-14 flex-1 rounded-lg" />
            <Skeleton className="h-14 flex-1 rounded-lg" />
          </div>
        ) : !perf ? (
          <p className="text-xs text-muted-foreground">Data performa tidak tersedia</p>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            {/* Verdict */}
            <div className="flex-1 min-w-[120px] rounded-lg bg-muted/40 px-3 py-2.5 space-y-1">
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Verdict</p>
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${VERDICT_BADGE_CLS[perf.outcome.verdict] ?? ""}`}>
                {perf.outcome.verdict}
              </span>
            </div>
            {/* Vol delta */}
            <div className="flex-1 min-w-[120px] rounded-lg bg-muted/40 px-3 py-2.5 space-y-1">
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Volume</p>
              <p className={`text-sm font-bold tabular-nums ${perf.outcome.vol_delta_pct > 0 ? "text-green-600 dark:text-green-400" : perf.outcome.vol_delta_pct < 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                {perf.outcome.vol_delta_pct > 0 ? "↑" : perf.outcome.vol_delta_pct < 0 ? "↓" : "–"} {Math.abs(perf.outcome.vol_delta_pct).toFixed(1)}%
              </p>
            </div>
            {/* FBSI delta */}
            <div className="flex-1 min-w-[120px] rounded-lg bg-muted/40 px-3 py-2.5 space-y-1">
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Porsi Produk Murah</p>
              <p className={`text-sm font-bold tabular-nums ${perf.outcome.fbsi_delta_pp < 0 ? "text-green-600 dark:text-green-400" : perf.outcome.fbsi_delta_pp > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                {perf.outcome.fbsi_delta_pp > 0 ? "↑" : perf.outcome.fbsi_delta_pp < 0 ? "↓" : "–"} {Math.abs(perf.outcome.fbsi_delta_pp).toFixed(1)}pp
              </p>
            </div>
            {/* Loyalty */}
            <div className="flex-1 min-w-[140px] rounded-lg bg-muted/40 px-3 py-2.5 space-y-1">
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Status Loyalty</p>
              {perf.loyalty ? (
                <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  Peserta aktif sejak {perf.loyalty.tgl_masuk ?? "—"}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Belum di program</p>
              )}
            </div>
          </div>
        )}
        {!loading && perf && (
          <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">{perf.outcome.verdict_detail}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Score Gauge ─────────────────────────────────────────────────────────────

function ScoreGauge({ score }: { score: number }) {
  const color = scoreColor(score);
  const pct = Math.min(Math.max(score, 0), 100);
  const ARC_LEN = 251.3; // π * 80
  const filled = (pct / 100) * ARC_LEN;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 115" width="180" height="104">
        {/* Track */}
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none" stroke="currentColor" strokeOpacity={0.12}
          strokeWidth="14" strokeLinecap="round"
        />
        {/* Fill */}
        <path
          d="M 20 100 A 80 80 0 0 1 180 100"
          fill="none" stroke={color}
          strokeWidth="14" strokeLinecap="round"
          strokeDasharray={`${filled} ${ARC_LEN}`}
        />
        {/* Tick marks at 40, 65, 85 */}
        {[40, 65, 85].map((t) => {
          const angle = (t / 100) * Math.PI;
          const ix = 100 - 80 * Math.cos(angle);
          const iy = 100 - 80 * Math.sin(angle);
          const ox = 100 - 88 * Math.cos(angle);
          const oy = 100 - 88 * Math.sin(angle);
          const tc = t >= 85 ? "#DC2626" : t >= 65 ? "#EA580C" : "#CA8A04";
          return <line key={t} x1={ix} y1={iy} x2={ox} y2={oy} stroke={tc} strokeWidth="2" />;
        })}
        {/* Score */}
        <text x="100" y="90" textAnchor="middle" fontSize="34" fontWeight="bold" fill={color}>
          {score.toFixed(1)}
        </text>
        <text x="100" y="108" textAnchor="middle" fontSize="11" fill="currentColor" opacity={0.45}>
          / 100
        </text>
      </svg>
    </div>
  );
}

// ─── Custom chart tooltips ────────────────────────────────────────────────────

function FbsiTooltip({
  active, payload, label,
}: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg text-xs space-y-1">
      <p className="font-semibold">{fmtPeriod(label)}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {p.name.includes("HE") ? fmtRp(p.value) : `${p.value.toFixed(1)}%`}
        </p>
      ))}
    </div>
  );
}

function VolTooltip({
  active, payload, label,
}: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg text-xs space-y-1">
      <p className="font-semibold">{fmtPeriod(label)}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {fmtNum(p.value)} ton
        </p>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StoreDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [data, setData]               = useState<StoreDetail | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [explain, setExplain]           = useState<ExplainResult | null>(null);
  const [explainLoading, setELoading]   = useState(false);
  const [explainCachedAt, setECachedAt] = useState<string | null>(null);

  const [predict, setPredict]         = useState<PredictResult | null>(null);
  const [predictLoading, setPLoading] = useState(false);
  const [predictCachedAt, setPCachedAt] = useState<string | null>(null);

  const [perfData, setPerfData]       = useState<StorePerf | null>(null);
  const [perfLoading, setPerfLoading] = useState(false);
  const [showJourney, setShowJourney] = useState(false);

  interface StoreAiInsight {
    status: string;
    narasi: string | null;
    generated_at?: string;
    cached?: boolean;
  }
  const [storeInsight,     setStoreInsight]     = useState<StoreAiInsight | null>(null);
  const [storeInsightLoad, setStoreInsightLoad] = useState(false);

  interface CADHistoryItem {
    id: string;
    kabupaten: string;
    tgl_alert: string;
    status: string;
    status_resolusi: string;
    kondisi: string | null;
    catatan: string | null;
    validated_by: string | null;
    waktu_validasi: string | null;
    cad_id: string;
  }
  const [cadHistory,        setCadHistory]      = useState<CADHistoryItem[]>([]);
  const [cadLoading,        setCadLoading]      = useState(false);
  const [showTokoModal,     setShowTokoModal]   = useState(false);
  const { isAdmin }    = useAuth();
  const currentUser    = getUser()?.name || getUser()?.username || "";

  interface CompTriRow {
    provinsi:           string;
    verdict:            string;
    aegis_warning_pct:  number;
    own_brand_ms_pct:   number | null;
    top_competitor: { brand: string; ms_current_pct: number; ms_change_pp: number; trend: string } | null;
    ms_brand_periode:   string | null;
    insight:            string;
  }
  const [compContext,   setCompContext]   = useState<CompTriRow | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`${API}/api/aegis/store/${encodeURIComponent(id)}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((r) => setData(r.data))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const fetchExplain = useCallback(() => {
    if (!id) return;
    setELoading(true);
    fetch(`${API}/api/aegis/explain/${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((r) => {
        setExplain(r.data ?? null);
        setECachedAt(r.cached_at ? new Date(r.cached_at).toLocaleTimeString("id-ID") : null);
      })
      .catch(() => {})
      .finally(() => setELoading(false));
  }, [id]);

  useEffect(() => {
    if (!loading && data) fetchExplain();
  }, [loading, data, fetchExplain]);

  const fetchPrediction = useCallback(() => {
    if (!id) return;
    setPLoading(true);
    fetch(`${API}/api/aegis/predict/${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((r) => {
        setPredict(r.data ?? null);
        setPCachedAt(r.cached_at ? new Date(r.cached_at).toLocaleTimeString("id-ID") : null);
      })
      .catch(() => {})
      .finally(() => setPLoading(false));
  }, [id]);

  useEffect(() => {
    if (!loading && data) fetchPrediction();
  }, [loading, data, fetchPrediction]);

  const fetchStoreInsight = useCallback(() => {
    if (!id) return;
    setStoreInsightLoad(true);
    fetch(`${API}/api/aegis/store/${encodeURIComponent(id)}/insight`)
      .then((r) => r.json())
      .then((r) => setStoreInsight(r.data ?? null))
      .catch(() => {})
      .finally(() => setStoreInsightLoad(false));
  }, [id]);

  useEffect(() => {
    if (!loading && data) fetchStoreInsight();
  }, [loading, data, fetchStoreInsight]);

  useEffect(() => {
    if (!id || loading) return;
    setPerfLoading(true);
    fetch(`${API}/api/performance/store/${encodeURIComponent(id)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((r) => { if (r?.data) setPerfData(r.data as StorePerf); })
      .catch(() => {})
      .finally(() => setPerfLoading(false));
  }, [id, loading]);

  const fetchCadHistory = useCallback(() => {
    if (!id) return;
    setCadLoading(true);
    fetch(`${API}/api/aegis/store/${encodeURIComponent(id)}/cad-validasi`)
      .then((r) => r.ok ? r.json() : null)
      .then((r) => { if (r?.data) setCadHistory(r.data as CADHistoryItem[]); })
      .catch(() => {})
      .finally(() => setCadLoading(false));
  }, [id]);

  useEffect(() => {
    if (!loading && data) fetchCadHistory();
  }, [loading, data, fetchCadHistory]);

  useEffect(() => {
    if (!loading && data) {
      const prov = data.info_toko.provinsi;
      fetch(`${API}/api/competitor/triangulation`)
        .then((r) => r.ok ? r.json() : null)
        .then((r) => {
          if (!r?.data) return;
          const match = (r.data as CompTriRow[]).find(
            (t) => t.provinsi === prov || t.provinsi.includes(prov)
          );
          setCompContext(match ?? null);
        })
        .catch(() => {});
    }
  }, [loading, data]);

  if (loading) return <LoadingSkeleton />;
  if (error || !data) return <ErrorState error={error ?? "Data tidak ditemukan"} />;

  const { info_toko: info, current_warning: cw, metrics_current: mc } = data;
  const levelColor = LEVEL_COLOR[cw.level] ?? "#6b7280";
  const clusterColor = CLUSTER_COLOR[info.cluster_pareto] ?? "#6b7280";
  const polaColor = cw.pola_kode === "C" ? "#6b7280" : levelColor;
  const polaAction = POLA_ACTION[cw.pola_kode];
  const scoreCol = scoreColor(cw.aegis_score);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16 max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-5">

        {/* ── Breadcrumb ──────────────────────────────────────────── */}
        <div className="flex items-center gap-2 text-sm">
          <a href="/aegis" className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
            ← Kembali ke AEGIS Monitor
          </a>
          <span className="text-muted-foreground/40">/</span>
          <span className="text-foreground font-medium truncate max-w-[200px]" title={info.nama_toko}>
            {info.nama_toko}
          </span>
        </div>

        {/* ── Header card ─────────────────────────────────────────── */}
        <Card>
          <CardContent className="pt-5 pb-5">
            <div className="flex flex-col lg:flex-row gap-6">

              {/* Left: name + badges + info grid */}
              <div className="flex-1 space-y-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    {/* Cluster badge */}
                    <span
                      className="text-[10px] font-bold px-2.5 py-1 rounded-full"
                      style={{ backgroundColor: `${clusterColor}18`, color: clusterColor, border: `1px solid ${clusterColor}30` }}
                    >
                      {info.cluster_pareto}
                    </span>
                    {/* Level badge */}
                    {cw.level !== "Normal" && (
                      <span
                        className="text-[10px] font-bold px-2.5 py-1 rounded-full"
                        style={{ backgroundColor: `${levelColor}18`, color: levelColor, border: `1px solid ${levelColor}30` }}
                      >
                        ⚠ {cw.level}
                      </span>
                    )}
                  </div>
                  <h1 className="text-xl font-bold tracking-tight">{info.nama_toko}</h1>
                  <p className="text-sm text-muted-foreground mt-0.5 font-mono">{info.id_toko}</p>
                </div>

                {/* Info grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Kabupaten", value: info.kabupaten.replace(/^KABUPATEN /, "KAB. ") },
                    { label: "TSO", value: info.tso.replace(/^TSO-\d+ /, "") },
                    { label: "ASM", value: info.asm.replace(/^ASM-\d+ /, "") },
                    { label: "SSM", value: info.ssm.replace(/^SSM-\d+ /, "") },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-lg bg-muted/40 px-3 py-2.5">
                      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-0.5">{label}</p>
                      <p className="text-xs font-semibold truncate" title={value}>{value}</p>
                    </div>
                  ))}
                </div>

                {/* Pola */}
                {cw.pola_kode !== "N" && (
                  <div
                    className="rounded-lg px-3 py-2.5 flex items-center gap-2"
                    style={{ backgroundColor: `${polaColor}10`, border: `1px solid ${polaColor}25` }}
                  >
                    <span className="text-xs font-bold w-5 h-5 rounded flex items-center justify-center shrink-0"
                      style={{ backgroundColor: `${polaColor}25`, color: polaColor }}>
                      {cw.pola_kode}
                    </span>
                    <p className="text-xs font-medium" style={{ color: polaColor }}>{cw.pola}</p>
                    {cw.pola_kode === "C" && (
                      <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                        Pre-warning
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Right: AEGIS Score gauge */}
              <div className="flex flex-col items-center justify-center bg-muted/30 rounded-xl px-6 py-4 min-w-[200px]">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
                  AEGIS Score
                </p>
                <ScoreGauge score={cw.aegis_score} />
                <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                  <span style={{ color: "#CA8A04" }}>●40</span>
                  <span style={{ color: "#EA580C" }}>●65</span>
                  <span style={{ color: "#DC2626" }}>●85</span>
                </div>
                {/* Bar breakdown hint */}
                <p className="text-[9px] text-muted-foreground/50 mt-2 text-center">
                  Risiko Produk×50% + Anomali×20% + Risiko Beralih×30%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── AI Store Analysis ────────────────────────────────────── */}
        {(storeInsightLoad || (storeInsight && storeInsight.status !== "disabled")) && (
          <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="p-1.5 bg-blue-100 dark:bg-blue-900/50 rounded-lg mt-0.5 shrink-0">
                  <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                      AI Store Analysis
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      {storeInsight?.generated_at && !storeInsightLoad && (
                        <span className="text-xs text-muted-foreground">
                          {new Date(storeInsight.generated_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                          {storeInsight.cached && " · cache"}
                        </span>
                      )}
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={fetchStoreInsight} disabled={storeInsightLoad}>
                        <RefreshCw className={`h-3 w-3 ${storeInsightLoad ? "animate-spin" : ""}`} />
                      </Button>
                    </div>
                  </div>
                  {storeInsightLoad ? (
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-5/6" />
                      <Skeleton className="h-4 w-3/5" />
                    </div>
                  ) : storeInsight?.status === "error" ? (
                    <p className="text-sm text-muted-foreground">Gagal memuat analisis. Coba refresh.</p>
                  ) : storeInsight?.narasi ? (
                    <p className="text-sm text-foreground leading-relaxed">{storeInsight.narasi}</p>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Konteks Pasar Provinsi (ASPERSSI) ───────────────────── */}
        {compContext && (
          <Card className="border-orange-200/50 dark:border-orange-800/30 bg-orange-50/30 dark:bg-orange-950/10">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="space-y-1.5 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-orange-600 dark:text-orange-400">
                    Konteks Pasar Provinsi {info.provinsi}
                  </p>
                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Verdict */}
                    {(() => {
                      const vCfg: Record<string, { label: string; cls: string }> = {
                        KONFIRMASI_KOMPETITOR:  { label: "Terkonfirmasi Kompetitor", cls: "text-red-600 dark:text-red-400" },
                        WASPADA_AWAL:           { label: "Waspada Awal",             cls: "text-amber-600 dark:text-amber-400" },
                        INTERNAL_ATAU_SEASONAL: { label: "Bukan Kompetitor",         cls: "text-blue-600 dark:text-blue-400" },
                        TIDAK_CUKUP_DATA:       { label: "Data Kurang",              cls: "text-muted-foreground" },
                        NORMAL:                 { label: "Normal",                   cls: "text-green-600 dark:text-green-400" },
                      };
                      const cfg = vCfg[compContext.verdict] ?? vCfg.TIDAK_CUKUP_DATA;
                      return <span className={`text-xs font-semibold ${cfg.cls}`}>{cfg.label}</span>;
                    })()}
                    {compContext.own_brand_ms_pct !== null && (
                      <span className="text-[11px] text-muted-foreground">
                        MS Semen Elang: <strong>{compContext.own_brand_ms_pct.toFixed(1)}%</strong>
                      </span>
                    )}
                    {compContext.top_competitor && (
                      <span className="text-[11px] text-muted-foreground">
                        Top kompetitor: <strong>{compContext.top_competitor.brand}</strong>{" "}
                        <span className={compContext.top_competitor.ms_change_pp > 0 ? "text-red-500" : "text-green-600"}>
                          {compContext.top_competitor.ms_change_pp > 0 ? "+" : ""}
                          {compContext.top_competitor.ms_change_pp.toFixed(1)}pp
                        </span>
                      </span>
                    )}
                  </div>
                </div>
                <a
                  href="/competitor"
                  className="text-[11px] text-orange-600 dark:text-orange-400 underline underline-offset-2 hover:no-underline shrink-0"
                >
                  Lihat Detail →
                </a>
              </div>
              <p className="text-[10px] text-muted-foreground/70 mt-2">
                Data ASPERSSI {compContext.ms_brand_periode ?? "—"} — dalam persentase, bukan volume absolut
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── Metric risk cards ────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* FBSI */}
          {(() => {
            const danger = mc.fbsi_latest > mc.fbsi_threshold;
            const col = danger ? "#DC2626" : "#16a34a";
            const dir = mc.delta_fbsi > 1 ? "↑ Naik ⚠️" : mc.delta_fbsi < -1 ? "↓ Turun" : "Normal ✓";
            return (
              <Card style={{ borderColor: `${col}30`, backgroundColor: `${col}05` }}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">FBSI</p>
                      <p className="text-[10px] text-muted-foreground">Porsi Produk Murah</p>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: `${col}18`, color: col, border: `1px solid ${col}30` }}>
                      {dir}
                    </span>
                  </div>
                  <p className="text-3xl font-bold tabular-nums" style={{ color: col }}>
                    {mc.fbsi_latest.toFixed(1)}<span className="text-base font-medium ml-0.5">%</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Δ {mc.delta_fbsi > 0 ? "+" : ""}{mc.delta_fbsi.toFixed(1)}pp vs baseline · threshold {mc.fbsi_threshold}%
                  </p>
                  <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(mc.fbsi_latest, 100)}%`, backgroundColor: col }} />
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* HE */}
          {(() => {
            const danger = mc.delta_he_pct < mc.he_threshold;
            const col = danger ? "#DC2626" : "#16a34a";
            const dir = mc.delta_he_pct > 1 ? "↑ Naik" : mc.delta_he_pct < -1 ? (danger ? "↓ Turun ⚠️" : "↓ Turun") : "Normal ✓";
            return (
              <Card style={{ borderColor: `${col}30`, backgroundColor: `${col}05` }}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">HE</p>
                      <p className="text-[10px] text-muted-foreground">Rata-rata Harga Jual per TON</p>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: `${col}18`, color: col, border: `1px solid ${col}30` }}>
                      {dir}
                    </span>
                  </div>
                  <p className="text-xl font-bold tabular-nums" style={{ color: col }}>
                    {fmtRp(mc.he_latest)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Δ {mc.delta_he_pct > 0 ? "+" : ""}{mc.delta_he_pct.toFixed(1)}% vs baseline · threshold {mc.he_threshold}%
                  </p>
                  <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{
                      width: `${Math.min(Math.abs(mc.delta_he_pct) * 5, 100)}%`,
                      backgroundColor: col,
                    }} />
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* ORS/CV */}
          {(() => {
            const danger = mc.delta_cv > 0.3;
            const col = danger ? "#DC2626" : "#16a34a";
            const dir = mc.delta_cv > 0.05 ? "↑ Tidak Teratur ⚠️" : mc.delta_cv < -0.05 ? "↓ Membaik" : "Normal ✓";
            return (
              <Card style={{ borderColor: `${col}30`, backgroundColor: `${col}05` }}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">ORS/CV</p>
                      <p className="text-[10px] text-muted-foreground">Keteraturan Pola Order</p>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: `${col}18`, color: col, border: `1px solid ${col}30` }}>
                      {dir}
                    </span>
                  </div>
                  <p className="text-3xl font-bold tabular-nums" style={{ color: col }}>
                    {mc.delta_cv.toFixed(3)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Δ CV order · {mc.delta_cv > 0.3 ? "variasi tinggi" : "variasi normal"}
                  </p>
                  <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(mc.delta_cv / 0.5 * 100, 100)}%`, backgroundColor: col }} />
                  </div>
                </CardContent>
              </Card>
            );
          })()}
        </div>

        {/* ── Ensemble breakdown ───────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cara Skor AEGIS Dihitung</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">

              {/* CRS 50% */}
              {(() => {
                const col = scoreColor(cw.crs);
                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold">CRS Score</p>
                        <p className="text-[10px] text-muted-foreground">Bobot 50%</p>
                      </div>
                      <p className="text-2xl font-bold tabular-nums" style={{ color: col }}>
                        {cw.crs.toFixed(1)}
                      </p>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${cw.crs}%`, backgroundColor: col }} />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Composite Risk Score = FBSI×60% + HE×30% + ORS×10%
                    </p>
                  </div>
                );
              })()}

              {/* IF 20% */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold">Deteksi Anomali</p>
                    <p className="text-[10px] text-muted-foreground">Bobot 20%</p>
                  </div>
                  {cw.if_label === -1 ? (
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg bg-[#DC2626]/12 text-[#DC2626] border border-[#DC2626]/25">
                      ⚠ Anomali
                    </span>
                  ) : (
                    <span className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-muted text-muted-foreground">
                      Normal
                    </span>
                  )}
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${cw.if_score}%`, backgroundColor: cw.if_label === -1 ? "#DC2626" : "#16a34a" }} />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {cw.if_label === -1 ? "Pola transaksi toko ini tidak normal" : "Pola transaksi masih dalam batas normal"}
                </p>
              </div>

              {/* XGB Churn 30% */}
              {(() => {
                const pct = cw.churn_prob * 100;
                const col = pct >= 80 ? "#DC2626" : pct >= 50 ? "#CA8A04" : "#16a34a";
                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold">Risiko Beralih</p>
                        <p className="text-[10px] text-muted-foreground">Bobot 30%</p>
                      </div>
                      <p className="text-2xl font-bold tabular-nums" style={{ color: col }}>
                        {pct.toFixed(1)}<span className="text-sm">%</span>
                      </p>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: col }} />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Kemungkinan toko akan beralih produk · threshold 90%
                    </p>
                  </div>
                );
              })()}
            </div>

            {/* Formula */}
            <div className="mt-4 pt-3 border-t border-border flex flex-wrap gap-2 items-center">
              <p className="text-[11px] text-muted-foreground">Formula:</p>
              {[
                { label: "Risiko Produk", weight: "×50%", val: (cw.crs * 0.5).toFixed(1) },
                { label: "Anomali", weight: "×20%", val: (cw.if_score * 0.2).toFixed(1) },
                { label: "Risiko Beralih", weight: "×30%", val: (cw.churn_prob * 100 * 0.3).toFixed(1) },
              ].map(({ label, weight, val }, i) => (
                <span key={label} className="text-[11px]">
                  {i > 0 && <span className="text-muted-foreground mx-1">+</span>}
                  <span className="font-semibold">{label}</span>
                  <span className="text-muted-foreground">{weight}</span>
                  <span className="text-muted-foreground ml-1">({val})</span>
                </span>
              ))}
              <span className="text-[11px] font-bold ml-auto" style={{ color: scoreCol }}>
                = {cw.aegis_score.toFixed(1)}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* ── Performance Tracker ──────────────────────────────────── */}
        <PerformanceCard
          perf={perfData}
          loading={perfLoading}
          idToko={id}
          onShowJourney={() => setShowJourney(true)}
        />

        {/* ── AEGIS-EXPLAIN ────────────────────────────────────────── */}
        <ExplainSection
          explain={explain}
          loading={explainLoading}
          cachedAt={explainCachedAt}
          onRefresh={fetchExplain}
        />

        {/* ── AEGIS-PREDICT ────────────────────────────────────────── */}
        <PredictSection
          predict={predict}
          loading={predictLoading}
          cachedAt={predictCachedAt}
          onRefresh={fetchPrediction}
        />

        {/* ── FBSI / HE trend chart ────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="text-sm">
              Tren FBSI & Harga Efektif — 8 Periode
              <span className="ml-2 text-xs font-normal text-muted-foreground">bulanan</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={data.tren_fbsi} margin={{ top: 4, right: 60, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.07} />
                <XAxis dataKey="periode" tickFormatter={fmtPeriod} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  yAxisId="fbsi"
                  tickFormatter={(v: number) => `${v}%`}
                  tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={38}
                  domain={[0, "auto"]}
                />
                <YAxis
                  yAxisId="he"
                  orientation="right"
                  tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}K`}
                  tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={46}
                />
                <Tooltip content={<FbsiTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {/* FBSI threshold */}
                <ReferenceLine
                  yAxisId="fbsi" y={mc.fbsi_threshold}
                  stroke="#DC2626" strokeDasharray="4 3" strokeOpacity={0.6}
                  label={{ value: `${mc.fbsi_threshold}%`, fontSize: 10, fill: "#DC2626", position: "insideTopLeft" }}
                />
                <Line
                  yAxisId="fbsi" type="monotone" dataKey="fbsi_pct"
                  name="FBSI %" stroke="#DC2626" strokeWidth={2.5} dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  yAxisId="he" type="monotone" dataKey="he_value"
                  name="HE (Rp/ton)" stroke="#3b82f6" strokeWidth={2}
                  dot={{ r: 3 }} activeDot={{ r: 5 }} strokeDasharray="5 2"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* ── Monthly volume chart ─────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="text-sm">
              Tren Volume Bulanan — 12 Bulan
              <span className="ml-2 text-xs font-normal text-muted-foreground">TON</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={data.tren_bulanan} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.07} />
                <XAxis dataKey="bulan" tickFormatter={fmtPeriod} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={42}
                  tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)} />
                <Tooltip content={<VolTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="ton_main" name="SEMEN ELANG" stackId="vol" fill="#16a34a" radius={[0, 0, 0, 0]} maxBarSize={28} />
                <Bar dataKey="ton_fighting" name="SEMEN BANTENG" stackId="vol" fill="#DC2626" radius={[2, 2, 0, 0]} maxBarSize={28} />
                <Line type="monotone" dataKey="ton_total" name="Total TON" stroke="#3b82f6" strokeWidth={2}
                  dot={false} activeDot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* ── Action Plan ──────────────────────────────────────────── */}
        {polaAction && (
          <Card style={{ borderColor: `${polaColor}30` }}>
            <CardHeader className="border-b pb-3" style={{ borderColor: `${polaColor}20` }}>
              <CardTitle className="text-sm flex items-center gap-2">
                <span className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0"
                  style={{ backgroundColor: `${polaColor}20`, color: polaColor }}>
                  {cw.pola_kode}
                </span>
                Action Plan — {polaAction.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-start gap-3">
                <span
                  className="text-xs font-bold px-3 py-1.5 rounded-lg shrink-0"
                  style={{ backgroundColor: `${polaColor}15`, color: polaColor, border: `1px solid ${polaColor}25` }}
                >
                  {polaAction.urgency}
                </span>
                <p className="text-sm text-muted-foreground">{polaAction.desc}</p>
              </div>
              <div className="space-y-2">
                {polaAction.steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5"
                      style={{ backgroundColor: `${polaColor}15`, color: polaColor }}>
                      {i + 1}
                    </span>
                    <p className="text-sm text-foreground/80">{step}</p>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground/70 border-t border-border pt-3 mt-1 leading-relaxed">
                ⚠️ Sistem hanya memberikan indikasi berbasis data transaksi. Konfirmasi kondisi lapangan diperlukan sebelum mengambil keputusan.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── Store statistics ─────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Avg TON / Bulan", value: fmtNum(data.avg_ton_bulanan), sub: "ton rata-rata per bulan" },
            { label: "Total Transaksi", value: fmtNum(data.total_transaksi), sub: "unik dalam periode data" },
            { label: "Bulan Aktif", value: String(data.bulan_aktif), sub: "dari total periode data" },
          ].map(({ label, value, sub }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
                <p className="text-2xl font-bold tabular-nums mt-1">{value}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* ── Riwayat Validasi CAD ────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm">Riwayat Validasi CAD</CardTitle>
              {isAdmin && (
                <button
                  onClick={() => setShowTokoModal(true)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-amber-500/60 text-amber-600
                    hover:bg-amber-50 dark:text-amber-400 dark:border-amber-500/40 dark:hover:bg-amber-950/30 transition-colors"
                >
                  + Tambah Validasi
                </button>
              )}
            </div>
          </CardHeader>
          <CardContent className="pt-3 pb-3">
            {cadLoading ? (
              <div className="space-y-2 py-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <div className="w-2 h-2 rounded-full bg-muted mt-1.5 shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-muted rounded w-2/3" />
                      <div className="h-3 bg-muted rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : cadHistory.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                Belum ada riwayat validasi CAD untuk toko ini.
              </p>
            ) : (
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-[6px] top-4 bottom-2 w-px bg-border" />
                <div className="space-y-4 pl-5">
                  {cadHistory.map((item) => {
                    const KONDISI_CLS: Record<string, string> = {
                      "Kompetitor Eksternal":               "text-red-600 dark:text-red-400",
                      "Masalah Harga / Gap Harga Besar":    "text-yellow-600 dark:text-yellow-400",
                      "Masalah Stok / Keterlambatan Kirim": "text-orange-600 dark:text-orange-400",
                      "Faktor Seasonal":                    "text-blue-600 dark:text-blue-400",
                      "Faktor Internal Distributor":        "text-purple-600 dark:text-purple-400",
                      "Kondisi Normal / False Alarm":       "text-green-600 dark:text-green-400",
                      "Butuh Investigasi Lanjut":           "text-muted-foreground",
                    };
                    return (
                      <div key={item.id} className="relative">
                        {/* Dot */}
                        <div className="absolute -left-5 top-1.5 w-2.5 h-2.5 rounded-full border-2 border-background bg-border" />
                        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 space-y-1.5">
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <div>
                              <p className="text-xs font-semibold">
                                Alert CAD · {item.tgl_alert || "—"}
                                {item.cad_id && (
                                  <Link
                                    href={`/aegis/cad-history/${encodeURIComponent(item.cad_id)}`}
                                    className="ml-1.5 text-[10px] text-blue-500 hover:underline"
                                  >
                                    Lihat Detail →
                                  </Link>
                                )}
                              </p>
                              {item.kondisi && (
                                <p className={`text-[11px] font-medium ${KONDISI_CLS[item.kondisi] ?? "text-muted-foreground"}`}>
                                  {item.kondisi}
                                </p>
                              )}
                            </div>
                            <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                              {item.waktu_validasi
                                ? new Date(item.waktu_validasi).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })
                                : "—"}
                            </span>
                          </div>
                          {item.catatan && (
                            <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
                              {item.catatan}
                            </p>
                          )}
                          {item.validated_by && (
                            <p className="text-[10px] text-muted-foreground/70">
                              oleh {item.validated_by}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground pb-1">
          CORE Platform v2 · AEGIS Store Detail · {info.id_toko}
        </p>
        <p className="text-center text-[10px] text-muted-foreground/60 pb-4">
          Data berbasis transaksi internal SIG. Validasi lapangan oleh TSO diperlukan untuk konfirmasi kondisi aktual.
        </p>
      </main>

      {/* Journey Modal */}
      {showJourney && (
        <StoreJourneyModal idToko={id} onClose={() => setShowJourney(false)} />
      )}

      {/* Toko Validasi Modal */}
      {showTokoModal && (
        <TokoValidasiModal
          cadId=""
          idToko={id}
          namaToko={info.nama_toko}
          aegisScore={cw.aegis_score}
          currentUser={currentUser}
          onClose={() => setShowTokoModal(false)}
          onSaved={() => { fetchCadHistory(); setShowTokoModal(false); }}
        />
      )}
    </div>
  );
}

// ─── Loading / Error states ───────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16 max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-5">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </main>
    </div>
  );
}

function ErrorState({ error }: { error: string }) {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16 flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <p className="text-4xl">⚠</p>
          <p className="text-base font-semibold">Toko tidak ditemukan</p>
          <p className="text-sm text-muted-foreground">{error}</p>
          <a href="/aegis" className="inline-block mt-2 text-sm text-foreground underline underline-offset-2">
            Kembali ke AEGIS Monitor
          </a>
        </div>
      </main>
    </div>
  );
}
