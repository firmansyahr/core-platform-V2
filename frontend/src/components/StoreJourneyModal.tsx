"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { X, TrendingUp, TrendingDown, Minus, AlertTriangle, Target, CheckCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import { apiFetch, API } from "@/lib/fetch";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StoreInfo {
  id_toko: string; nama_toko: string; kabupaten: string;
  cluster_pareto: string; tso: string;
}
interface CurrentAegis { score: number; level: string; pola: string; }
interface LoyaltyInfo {
  status: string; tgl_masuk: string | null; tgl_keluar: string | null;
  reward_type: string; enrollment_count: number;
}
interface Outcome {
  vol_before_avg: number; vol_after_avg: number; vol_delta_pct: number;
  fbsi_before_avg: number; fbsi_after_avg: number; fbsi_delta_pp: number;
  verdict: string; verdict_detail: string; verdict_color: string;
}
interface MonthlyTrend {
  periode: string; ton_total: number; ton_main: number;
  ton_fighting: number; fbsi: number; trx_count: number;
}
interface JourneyData {
  status: string; info: StoreInfo; current_aegis: CurrentAegis;
  loyalty: LoyaltyInfo | null; outcome: Outcome;
  monthly_trend: MonthlyTrend[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtNum = (n: number) =>
  new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(n);

const fmtPeriod = (p: string) => {
  const [y, m] = p.split("-");
  const names = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  return `${names[+m - 1]} '${y.slice(2)}`;
};

const VERDICT_BADGE: Record<string, string> = {
  "Membaik":          "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  "Stabil":           "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  "Perlu Perhatian":  "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  "Dalam Pemantauan": "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  "Belum di Program": "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
};

const AEGIS_COLOR: Record<string, string> = {
  Merah: "#dc2626", Oranye: "#ea580c", Kuning: "#ca8a04", Normal: "#16a34a",
};

const CLUSTER_BADGE: Record<string, string> = {
  "Super Platinum": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  "Platinum":       "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  "Gold":           "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  "Silver":         "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  "Bronze":         "bg-stone-100 text-stone-700 dark:bg-stone-900/30 dark:text-stone-400",
};

function TrendTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg text-xs space-y-1">
      <p className="font-semibold text-sm">{fmtPeriod(label ?? "")}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium">{fmtNum(p.value)}{p.name === "FBSI %" ? "%" : " ton"}</span>
        </div>
      ))}
    </div>
  );
}

function DeltaArrow({ v, invert = false }: { v: number; invert?: boolean }) {
  const good = invert ? v < 0 : v > 0;
  const zero = Math.abs(v) < 0.05;
  if (zero) return <Minus size={13} className="text-muted-foreground inline" />;
  return good
    ? <TrendingUp size={13} className="text-green-600 dark:text-green-400 inline" />
    : <TrendingDown size={13} className="text-red-600 dark:text-red-400 inline" />;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StoreJourneyModal({
  idToko,
  onClose,
}: {
  idToko: string;
  onClose: () => void;
}) {
  const [data, setData]       = useState<JourneyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  const fetchJourney = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch(`${API}/api/performance/store/${encodeURIComponent(idToko)}`);
      const r = await res.json();
      setData(r.data as JourneyData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat data");
    } finally {
      setLoading(false);
    }
  }, [idToko]);

  useEffect(() => {
    fetchJourney();
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fetchJourney, onClose]);

  const loyaltyPeriod = data?.loyalty?.tgl_masuk
    ? data.monthly_trend.find((m) => m.periode >= (data.loyalty!.tgl_masuk ?? "").slice(0, 7))?.periode
    : null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl border border-border bg-background shadow-2xl">

        {/* Header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-6 py-4 border-b border-border bg-background/95 backdrop-blur-sm">
          {loading ? (
            <div className="space-y-1.5">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : data ? (
            <div className="flex items-start gap-3 min-w-0">
              <div className="min-w-0">
                <h2 className="text-base font-semibold leading-tight truncate">{data.info.nama_toko}</h2>
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${CLUSTER_BADGE[data.info.cluster_pareto] ?? ""}`}>
                    {data.info.cluster_pareto}
                  </span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold text-white"
                    style={{ backgroundColor: AEGIS_COLOR[data.current_aegis.level] ?? "#6b7280" }}
                  >
                    AEGIS {data.current_aegis.level} {data.current_aegis.score.toFixed(1)}
                  </span>
                  <span className="text-xs text-muted-foreground">{data.info.kabupaten}</span>
                </div>
              </div>
              <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full font-semibold ml-auto ${VERDICT_BADGE[data.outcome.verdict] ?? ""}`}>
                {data.outcome.verdict}
              </span>
            </div>
          ) : null}
          <button
            onClick={onClose}
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-6 space-y-8">
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {loading && (
            <div className="space-y-6">
              <Skeleton className="h-28 w-full rounded-xl" />
              <Skeleton className="h-56 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
          )}

          {data && !loading && (
            <>
              {/* Section 1 — Journey Timeline */}
              <section>
                <h3 className="text-sm font-semibold mb-4 text-muted-foreground uppercase tracking-wider">
                  Perjalanan Toko
                </h3>
                <div className="flex items-stretch gap-0">
                  {/* Step 1: AEGIS */}
                  <div className="flex-1 rounded-l-xl border border-border bg-card p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0"
                        style={{ backgroundColor: AEGIS_COLOR[data.current_aegis.level] ?? "#6b7280" }}
                      >
                        <AlertTriangle size={14} />
                      </div>
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        AEGIS Detection
                      </span>
                    </div>
                    <p className="text-sm font-semibold leading-snug">
                      Score {data.current_aegis.score.toFixed(1)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Level <span className="font-semibold" style={{ color: AEGIS_COLOR[data.current_aegis.level] }}>
                        {data.current_aegis.level}
                      </span> · Pola {data.current_aegis.pola}
                    </p>
                  </div>

                  {/* Arrow */}
                  <div className="flex items-center px-2 text-muted-foreground/40 text-lg">→</div>

                  {/* Step 2: Loyalty */}
                  <div className={`flex-1 border border-border bg-card p-4 space-y-2 ${data.loyalty ? "" : "opacity-60"}`}>
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 ${data.loyalty ? "bg-emerald-600" : "bg-gray-400"}`}>
                        <Target size={14} />
                      </div>
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Program Loyalty
                      </span>
                    </div>
                    {data.loyalty ? (
                      <>
                        <p className="text-sm font-semibold leading-snug">
                          Aktif sejak {data.loyalty.tgl_masuk ?? "—"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {data.loyalty.reward_type} · Enrollment #{data.loyalty.enrollment_count}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-medium leading-snug text-muted-foreground">
                          Belum terdaftar
                        </p>
                        <Link
                          href="/loyalty"
                          className="text-xs text-primary hover:underline"
                          onClick={onClose}
                        >
                          Daftarkan ke Loyalty →
                        </Link>
                      </>
                    )}
                  </div>

                  {/* Arrow */}
                  <div className="flex items-center px-2 text-muted-foreground/40 text-lg">→</div>

                  {/* Step 3: Outcome */}
                  <div className="flex-1 rounded-r-xl border border-border bg-card p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 ${
                        data.outcome.verdict_color === "green" ? "bg-green-600"
                        : data.outcome.verdict_color === "blue" ? "bg-blue-600"
                        : data.outcome.verdict_color === "red" ? "bg-red-600"
                        : "bg-gray-400"
                      }`}>
                        {data.outcome.verdict_color === "green" || data.outcome.verdict_color === "blue"
                          ? <CheckCircle size={14} />
                          : <XCircle size={14} />}
                      </div>
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Outcome
                      </span>
                    </div>
                    <p className="text-sm font-semibold leading-snug">
                      {fmtNum(data.outcome.vol_before_avg)} → {fmtNum(data.outcome.vol_after_avg)} ton/bln
                    </p>
                    <p className="text-xs text-muted-foreground leading-snug">
                      {data.outcome.verdict_detail}
                    </p>
                  </div>
                </div>
              </section>

              {/* Section 2 — Monthly Trend Chart */}
              <section>
                <h3 className="text-sm font-semibold mb-4 text-muted-foreground uppercase tracking-wider">
                  Tren Bulanan
                </h3>
                <div className="rounded-xl border border-border bg-card p-4">
                  <ResponsiveContainer width="100%" height={240}>
                    <ComposedChart data={data.monthly_trend} margin={{ top: 4, right: 48, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis
                        dataKey="periode"
                        tickFormatter={fmtPeriod}
                        tick={{ fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        yAxisId="ton"
                        tick={{ fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => fmtNum(v)}
                        label={{ value: "TON", angle: -90, position: "insideLeft", style: { fontSize: 9 }, offset: 8 }}
                      />
                      <YAxis
                        yAxisId="fbsi"
                        orientation="right"
                        tick={{ fontSize: 10 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v) => `${v}%`}
                        domain={[0, "auto"]}
                      />
                      <Tooltip content={<TrendTooltip />} />
                      <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />

                      {loyaltyPeriod && (
                        <ReferenceLine
                          x={loyaltyPeriod}
                          yAxisId="ton"
                          stroke="#16a34a"
                          strokeDasharray="5 3"
                          strokeWidth={1.5}
                          label={{ value: "Masuk Loyalty", fontSize: 9, fill: "#16a34a", position: "top" }}
                        />
                      )}

                      <Bar yAxisId="ton" dataKey="ton_main"     name="TON Main Brand"     stackId="a" fill="#2563eb" fillOpacity={0.8} radius={[0, 0, 0, 0]} />
                      <Bar yAxisId="ton" dataKey="ton_fighting" name="TON Fighting Brand" stackId="a" fill="#dc2626" fillOpacity={0.8} radius={[3, 3, 0, 0]} />
                      <Line yAxisId="fbsi" type="monotone" dataKey="fbsi" name="FBSI %" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 4 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </section>

              {/* Section 3 — Performance Summary Grid */}
              <section>
                <h3 className="text-sm font-semibold mb-4 text-muted-foreground uppercase tracking-wider">
                  Ringkasan Performa
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    {
                      label: "Avg TON sebelum program",
                      before: data.outcome.vol_before_avg,
                      after: data.outcome.vol_after_avg,
                      delta: data.outcome.vol_delta_pct,
                      unit: "ton/bln",
                      invert: false,
                    },
                    {
                      label: "FBSI sebelum program",
                      before: data.outcome.fbsi_before_avg,
                      after: data.outcome.fbsi_after_avg,
                      delta: data.outcome.fbsi_delta_pp,
                      unit: "%",
                      invert: true,
                    },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border border-border bg-card p-4 space-y-3">
                      <p className="text-xs text-muted-foreground font-medium">{item.label}</p>
                      <div className="flex items-end gap-2">
                        <div className="text-center">
                          <p className="text-lg font-bold tabular-nums">{fmtNum(item.before)}</p>
                          <p className="text-[10px] text-muted-foreground">Sebelum</p>
                        </div>
                        <div className="text-muted-foreground/40 pb-4">→</div>
                        <div className="text-center">
                          <p className="text-lg font-bold tabular-nums">{fmtNum(item.after)}</p>
                          <p className="text-[10px] text-muted-foreground">Setelah</p>
                        </div>
                        <div className="ml-auto text-right pb-1">
                          <div className="flex items-center gap-1 justify-end">
                            <DeltaArrow v={item.delta} invert={item.invert} />
                            <span className={`text-sm font-semibold tabular-nums ${
                              Math.abs(item.delta) < 0.05 ? "text-muted-foreground"
                              : (item.invert ? item.delta < 0 : item.delta > 0)
                                ? "text-green-600 dark:text-green-400"
                                : "text-red-600 dark:text-red-400"
                            }`}>
                              {item.delta > 0 ? "+" : ""}{fmtNum(item.delta)}{item.unit === "%" ? "pp" : "%"}
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground">{item.unit}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Footer actions */}
              <div className="flex items-center justify-between pt-2 border-t border-border flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link href={`/aegis/store/${idToko}`} onClick={onClose}>
                    <Button variant="outline" size="sm" className="text-xs gap-1">
                      Lihat Store Detail AEGIS →
                    </Button>
                  </Link>
                  <Link href="/loyalty" onClick={onClose}>
                    <Button variant="outline" size="sm" className="text-xs gap-1">
                      Lihat di Loyalty →
                    </Button>
                  </Link>
                </div>
                <Button variant="ghost" size="sm" className="text-xs" onClick={onClose}>
                  Tutup
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
