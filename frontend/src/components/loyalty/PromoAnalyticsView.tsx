"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const fmtRp  = (n: number) => "Rp " + new Intl.NumberFormat("id-ID").format(Math.round(n));
const fmtNum = (n: number) => new Intl.NumberFormat("id-ID").format(n);
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

export interface AnalyticsPerToko {
  toko_id: string; nama_toko: string;
  baseline_vol: number; during_vol: number; lift_pct: number;
  status: "over_achiever" | "on_track" | "under_achiever" | "no_movement";
}
export interface ProgramAnalytics {
  volume_lift: {
    baseline_total: number; during_total: number; lift_pct: number;
    per_toko: AnalyticsPerToko[];
  };
  achievement: {
    total_peserta: number; mencapai_target: number; pct_achieved: number;
    over_achiever: number; on_track: number; under_achiever: number;
  };
  roi: {
    total_reward_issued: number; incremental_volume: number;
    cost_per_incremental_ton: number | null; roi_pct: number | null;
    breakeven_volume: number;
  };
  responders: {
    top_5: AnalyticsPerToko[]; bottom_5: AnalyticsPerToko[]; non_movers: number;
  };
}

const STATUS_META: Record<AnalyticsPerToko["status"], { label: string; cls: string }> = {
  over_achiever:  { label: "Over Achiever",  cls: "bg-emerald-100 text-emerald-700" },
  on_track:       { label: "On Track",       cls: "bg-amber-100 text-amber-700" },
  under_achiever: { label: "Under Achiever", cls: "bg-red-100 text-red-700" },
  no_movement:    { label: "No Movement",    cls: "bg-gray-100 text-gray-600" },
};

function StatusBadge({ status }: { status: AnalyticsPerToko["status"] }) {
  const m = STATUS_META[status] ?? STATUS_META.no_movement;
  return <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium ${m.cls}`}>{m.label}</span>;
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-gray-50 rounded-xl p-3 text-center">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <p className="text-lg font-bold">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function ResponderRow({ r }: { r: AnalyticsPerToko }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
      <div className="min-w-0 pr-2">
        <p className="text-xs font-medium leading-tight truncate">{r.nama_toko}</p>
        <p className="text-[10px] text-muted-foreground">
          {fmtNum(r.baseline_vol)} → {fmtNum(r.during_vol)} ton
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={`text-xs font-bold ${r.lift_pct >= 0 ? "text-green-600" : "text-red-600"}`}>
          {r.lift_pct > 0 ? "+" : ""}{fmtPct(r.lift_pct)}
        </span>
        <StatusBadge status={r.status} />
      </div>
    </div>
  );
}

export default function PromoAnalyticsView({ analytics }: { analytics: ProgramAnalytics; tipeProgram: string; periodeMulai: string }) {
  const { volume_lift, achievement, roi, responders } = analytics;

  const chartData = [...volume_lift.per_toko]
    .sort((a, b) => b.lift_pct - a.lift_pct)
    .slice(0, 15)
    .map((p) => ({ name: p.nama_toko.length > 14 ? p.nama_toko.slice(0, 14) + "…" : p.nama_toko, lift_pct: p.lift_pct }));

  const naik = volume_lift.per_toko.filter((p) => p.lift_pct > 0).length;

  const donutData = [
    { name: "Over Achiever",  value: achievement.over_achiever,  color: "#10b981" },
    { name: "On Track",       value: achievement.on_track,       color: "#f59e0b" },
    { name: "Under Achiever", value: achievement.under_achiever, color: "#ef4444" },
  ].filter((d) => d.value > 0);

  const achievementInsight =
    achievement.pct_achieved > 70
      ? "Program efektif mendorong target — sebagian besar peserta mencapai atau melampaui target."
      : achievement.pct_achieved < 40
        ? "Target mungkin terlalu tinggi atau reward kurang menarik — pertimbangkan evaluasi ulang."
        : null;

  const roiInsight =
    roi.roi_pct === null
      ? null
      : roi.roi_pct > 0
        ? "Program menghasilkan incremental volume yang nilainya melebihi biaya reward — ROI positif."
        : "Biaya reward melebihi estimasi nilai volume inkremental — perlu evaluasi budget atau target program.";

  const breakevenProgress = roi.breakeven_volume > 0
    ? Math.min((roi.incremental_volume / roi.breakeven_volume) * 100, 100)
    : 0;

  return (
    <div className="space-y-5">
      {/* ── Section 1: Volume Lift ── */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Volume Lift (Sebelum vs Selama Program)</CardTitle>
          <p className="text-xs text-muted-foreground">
            Baseline dinormalisasi ke durasi yang sama dengan periode program (rata-rata 3 bulan sebelum mulai).
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MiniStat label="Baseline Volume" value={`${fmtNum(volume_lift.baseline_total)} ton`} />
            <MiniStat label="Volume Selama Program" value={`${fmtNum(volume_lift.during_total)} ton`} />
            <MiniStat
              label="Lift"
              value={`${volume_lift.lift_pct > 0 ? "+" : ""}${fmtPct(volume_lift.lift_pct)}`}
              sub={volume_lift.lift_pct >= 0 ? "naik dari baseline" : "turun dari baseline"}
            />
            <MiniStat
              label="Status"
              value={volume_lift.lift_pct >= 0 ? "Positif" : "Negatif"}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{naik} dari {volume_lift.per_toko.length} toko</span>{" "}
            menunjukkan peningkatan volume dibanding baseline.
          </p>

          {chartData.length > 0 && (
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${v}%`} />
                  <Tooltip formatter={(v: unknown) => [`${Number(v).toFixed(1)}%`, "Lift"]} />
                  <Bar dataKey="lift_pct" radius={[3, 3, 0, 0]}>
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={d.lift_pct >= 0 ? "#10b981" : "#ef4444"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Section 2: Achievement Summary ── */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Achievement Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row items-center gap-6">
            {donutData.length > 0 && (
              <div className="shrink-0">
                <PieChart width={140} height={140}>
                  <Pie data={donutData} dataKey="value" innerRadius={38} outerRadius={62} strokeWidth={0}>
                    {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Pie>
                  <Tooltip formatter={(v: unknown, name: unknown) => [`${v} toko`, String(name ?? "")]} />
                </PieChart>
              </div>
            )}
            <div className="grid grid-cols-3 gap-3 flex-1 w-full">
              <MiniStat label="Over Achiever" value={fmtNum(achievement.over_achiever)} sub={`${fmtPct(achievement.over_achiever / achievement.total_peserta * 100 || 0)}`} />
              <MiniStat label="On Track" value={fmtNum(achievement.on_track)} sub={`${fmtPct(achievement.on_track / achievement.total_peserta * 100 || 0)}`} />
              <MiniStat label="Under Achiever" value={fmtNum(achievement.under_achiever)} sub={`${fmtPct(achievement.under_achiever / achievement.total_peserta * 100 || 0)}`} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            <span className="font-semibold text-foreground">{fmtPct(achievement.pct_achieved)}</span> dari{" "}
            {achievement.total_peserta} peserta mencapai atau melampaui target ({achievement.mencapai_target} toko).
          </p>
          {achievementInsight && (
            <div className="mt-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
              {achievementInsight}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Section 3: ROI & Cost Efficiency ── */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">ROI &amp; Cost Efficiency</CardTitle>
          <p className="text-xs text-muted-foreground">
            Estimasi nilai volume inkremental dihitung sebagai poin reguler (1X) — perkiraan arah, bukan angka presisi.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MiniStat label="Total Reward Diberikan" value={fmtRp(roi.total_reward_issued)} />
            <MiniStat label="Incremental Volume" value={`${fmtNum(roi.incremental_volume)} ton`} />
            <MiniStat
              label="Cost / Incremental Ton"
              value={roi.cost_per_incremental_ton !== null ? fmtRp(roi.cost_per_incremental_ton) : "–"}
            />
            <MiniStat
              label="ROI"
              value={roi.roi_pct !== null ? `${roi.roi_pct > 0 ? "+" : ""}${fmtPct(roi.roi_pct)}` : "–"}
            />
          </div>

          <div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
              <span>Incremental Volume vs Breakeven</span>
              <span>{fmtNum(roi.incremental_volume)} / {fmtNum(roi.breakeven_volume)} ton</span>
            </div>
            <div className="w-full bg-muted rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full ${breakevenProgress >= 100 ? "bg-emerald-500" : "bg-amber-500"}`}
                style={{ width: `${breakevenProgress}%` }}
              />
            </div>
          </div>

          {roiInsight && (
            <div className={`rounded-lg border px-3 py-2 text-xs ${
              roi.roi_pct !== null && roi.roi_pct > 0
                ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300"
                : "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300"
            }`}>
              {roiInsight}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Section 4: Responder Analysis ── */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Responder Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-green-700 mb-2">Top 5 Responders</p>
              {responders.top_5.length > 0 ? (
                responders.top_5.map((r) => <ResponderRow key={r.toko_id} r={r} />)
              ) : (
                <p className="text-xs text-muted-foreground">Tidak ada data</p>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-red-700 mb-2">Bottom 5 / Non-Movers</p>
              {responders.bottom_5.length > 0 ? (
                responders.bottom_5.map((r) => <ResponderRow key={r.toko_id} r={r} />)
              ) : (
                <p className="text-xs text-muted-foreground">Tidak ada data</p>
              )}
            </div>
          </div>
          {responders.non_movers > 0 && (
            <p className="text-xs text-muted-foreground mt-4 pt-3 border-t border-border">
              <span className="font-semibold text-foreground">{responders.non_movers} toko</span> tidak menunjukkan
              perubahan signifikan (baseline dan volume selama program sama-sama nol) — pertimbangkan untuk tidak
              diikutkan program berikutnya.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
