"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import Navbar from "@/components/Navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, Download, RefreshCw, FileText } from "lucide-react";
import { getToken } from "@/lib/auth";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

interface ReportSections {
  executive_summary: string;
  analisis_aegis: string;
  analisis_loyalty: string;
  rekomendasi: string;
}

interface ReportResult {
  status: string;
  sections: ReportSections | null;
  periode: string;
  generated_at: string;
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

interface FullReport {
  result: ReportResult;
  summary: KpiSnapshot;
  aegis: AegisSnapshot;
  loyalty: LoyaltySnapshot;
}

const STEPS = [
  "Menganalisis data pasar…",
  "Menganalisis kondisi AEGIS…",
  "Menganalisis program loyalty…",
  "Menyusun rekomendasi…",
];

function SectionHeader({ num, title }: { num: number; title: string }) {
  return (
    <h2 className="text-base font-bold mb-3 flex items-center gap-2">
      <span className="w-6 h-6 bg-primary text-primary-foreground rounded text-xs flex items-center justify-center shrink-0 font-bold">
        {num}
      </span>
      {title}
    </h2>
  );
}

function KpiTable({ summary }: { summary: KpiSnapshot }) {
  const fmtNum = (n: number) => new Intl.NumberFormat("id-ID").format(Math.round(n));
  const rows = [
    ["Volume Bulan Ini", `${fmtNum(summary.volume_bulan_ini)} TON`],
    ["Growth MoM", `${summary.growth_mom_pct >= 0 ? "+" : ""}${summary.growth_mom_pct.toFixed(1)}%`],
    ["Growth YoY", summary.growth_yoy_pct !== null ? `${(summary.growth_yoy_pct ?? 0) >= 0 ? "+" : ""}${(summary.growth_yoy_pct ?? 0).toFixed(1)}%` : "N/A"],
    ["Toko Aktif", fmtNum(summary.toko_aktif)],
    ["Warning Merah", String(summary.warning_merah)],
    ["Warning Oranye", String(summary.warning_oranye)],
    ["Warning Kuning", String(summary.warning_kuning)],
    ["Porsi Produk Murah", `${summary.fighting_brand_share_pct.toFixed(1)}%`],
    ["Volume Berisiko", `${summary.volume_at_risk_pct.toFixed(1)}% dari total`],
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-muted">
            <th className="text-left px-3 py-2 font-semibold text-xs uppercase tracking-wider">Metrik</th>
            <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-wider">Nilai</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, val], i) => (
            <tr key={label} className={i % 2 === 0 ? "bg-background" : "bg-muted/30"}>
              <td className="px-3 py-1.5 text-xs">{label}</td>
              <td className="px-3 py-1.5 text-xs text-right font-mono tabular-nums">{val}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AegisTable({ top_kab }: { top_kab: { kabupaten: string; jumlah: number }[] }) {
  if (!top_kab?.length) return null;
  return (
    <div className="overflow-x-auto mt-4">
      <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Top 5 Kabupaten Warning</p>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-muted">
            <th className="text-left px-3 py-2 font-semibold text-xs">Kabupaten</th>
            <th className="text-right px-3 py-2 font-semibold text-xs">Jumlah Toko</th>
          </tr>
        </thead>
        <tbody>
          {top_kab.map((k, i) => (
            <tr key={k.kabupaten} className={i % 2 === 0 ? "bg-background" : "bg-muted/30"}>
              <td className="px-3 py-1.5 text-xs">{k.kabupaten.replace(/^KABUPATEN /, "KAB. ")}</td>
              <td className="px-3 py-1.5 text-xs text-right tabular-nums">{k.jumlah}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LoyaltyTable({ loyalty }: { loyalty: LoyaltySnapshot }) {
  const fmtRp = (n: number) => `Rp ${new Intl.NumberFormat("id-ID").format(Math.round(n))}`;
  const eff = loyalty.efektivitas_bulan_ini;
  const rows = [
    ["Peserta Aktif", String(loyalty.total_aktif ?? "–")],
    ["Efektivitas Program", eff ? `${eff.efektivitas_pct.toFixed(1)}%` : "–"],
    ["Volume Achievement", eff ? `${eff.volume_achievement_pct.toFixed(1)}%` : "–"],
    ["Estimasi Budget", loyalty.est_budget_bulan ? fmtRp(loyalty.est_budget_bulan) : "–"],
  ];
  return (
    <div className="overflow-x-auto mt-4">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-muted">
            <th className="text-left px-3 py-2 font-semibold text-xs uppercase tracking-wider">Metrik</th>
            <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-wider">Nilai</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, val], i) => (
            <tr key={label} className={i % 2 === 0 ? "bg-background" : "bg-muted/30"}>
              <td className="px-3 py-1.5 text-xs">{label}</td>
              <td className="px-3 py-1.5 text-xs text-right tabular-nums">{val}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ReportPage() {
  const [report,      setReport]      = useState<FullReport | null>(null);
  const [generating,  setGenerating]  = useState(false);
  const [step,        setStep]        = useState(0);
  const [downloading, setDownloading] = useState(false);

  async function generateReport() {
    setGenerating(true);
    setReport(null);
    setStep(0);

    // Animate through progress steps
    const timer = setInterval(() => {
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    }, 4000);

    try {
      const token = getToken();
      const res = await fetch(`${API}/api/home/report/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const json = await res.json();
      const d = json.data ?? json;

      // Also fetch summary + aegis + loyalty to build full context for tables
      const [sumRes, aegisRes] = await Promise.all([
        fetch(`${API}/api/home/summary`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }),
        fetch(`${API}/api/home/report/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        }),
      ]);

      const sumJson  = await sumRes.json();
      const aegisJson = await aegisRes.json();

      setReport({
        result:  d,
        summary: sumJson.data ?? {},
        aegis:   (aegisJson.data as { sections?: unknown; periode?: string; generated_at?: string; report_data?: unknown } | null)?.report_data as AegisSnapshot ?? {},
        loyalty: {},
      });
    } catch {
      // Even on error, show what we have
    } finally {
      clearInterval(timer);
      setStep(STEPS.length - 1);
      setGenerating(false);
    }
  }

  // Simpler approach: fetch summary and generate in parallel
  async function generate() {
    setGenerating(true);
    setReport(null);
    setStep(0);

    const timer = setInterval(() => {
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    }, 4500);

    try {
      const token = getToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      const [genRes, sumRes] = await Promise.all([
        fetch(`${API}/api/home/report/generate`, { method: "POST", headers }),
        fetch(`${API}/api/home/summary`, { headers }),
      ]);

      const genJson = await genRes.json();
      const sumJson = await sumRes.json();

      const d = genJson.data ?? genJson;

      setReport({
        result:  d,
        summary: sumJson.data ?? {},
        aegis:   d.report_data?.aegis ?? {},
        loyalty: d.report_data?.loyalty ?? {},
      });
    } catch {
      // silent
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
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
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
  const periode  = report?.result?.periode;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16 max-w-5xl mx-auto px-6 py-8 space-y-6">

        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FileText className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            <h1 className="text-2xl font-bold tracking-tight">AI Report Generator</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Generate laporan bulanan otomatis dengan analisis AI berdasarkan data real-time platform
          </p>
        </div>

        {/* Generate button */}
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="flex-1">
                <p className="text-sm font-semibold mb-1">Generate Laporan Bulan Ini</p>
                <p className="text-xs text-muted-foreground">
                  AI akan menganalisis data pasar, kondisi AEGIS, program loyalty, dan menyusun
                  rekomendasi tindakan. Proses membutuhkan ~20–30 detik.
                </p>
              </div>
              <Button
                onClick={generate}
                disabled={generating}
                className="shrink-0 gap-2"
                size="lg"
              >
                <Sparkles className={`h-4 w-4 ${generating ? "animate-pulse" : ""}`} />
                {generating ? "Generating…" : "Generate Laporan"}
              </Button>
            </div>

            {/* Progress */}
            {generating && (
              <div className="mt-6 space-y-3">
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-1000"
                    style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
                  />
                </div>
                <p className="text-sm text-muted-foreground text-center animate-pulse">
                  {STEPS[step]}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Preview */}
        {sections && (
          <>
            {/* Action buttons */}
            <div className="flex items-center gap-3">
              <Button onClick={downloadPdf} disabled={downloading} className="gap-2">
                <Download className="h-4 w-4" />
                {downloading ? "Menyiapkan PDF…" : "Download PDF"}
              </Button>
              <Button variant="outline" onClick={generate} disabled={generating} className="gap-2">
                <RefreshCw className={`h-4 w-4 ${generating ? "animate-spin" : ""}`} />
                Regenerate
              </Button>
              {report?.result?.generated_at && (
                <span className="text-xs text-muted-foreground ml-auto">
                  Generated:{" "}
                  {new Date(report.result.generated_at).toLocaleString("id-ID")}
                </span>
              )}
            </div>

            {/* Report preview */}
            <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg p-8 space-y-8 border">

              {/* Cover */}
              <div className="text-center border-b border-border pb-6">
                <div className="text-2xl font-bold tracking-tight">LAPORAN BULANAN</div>
                <div className="text-base text-muted-foreground mt-1">
                  Ringkasan Kinerja Distribusi — {periode}
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  Generated by CORE Platform AI  •{" "}
                  {report?.result?.generated_at
                    ? new Date(report.result.generated_at).toLocaleString("id-ID")
                    : ""}
                </div>
              </div>

              {/* 1. Executive Summary */}
              <section>
                <SectionHeader num={1} title="Executive Summary" />
                <div className="text-sm leading-relaxed space-y-3">
                  {sections.executive_summary.split("\n\n").map((p, i) => (
                    <p key={i}>{p.trim()}</p>
                  ))}
                </div>
              </section>

              {/* 2. KPI */}
              <section>
                <SectionHeader num={2} title="KPI Utama Bulan Ini" />
                {report?.summary ? (
                  <KpiTable summary={report.summary} />
                ) : (
                  <Skeleton className="h-40 w-full rounded" />
                )}
              </section>

              {/* 3. AEGIS */}
              <section>
                <SectionHeader num={3} title="Kondisi Pasar & AEGIS Warning" />
                <div className="text-sm leading-relaxed space-y-3">
                  {sections.analisis_aegis.split("\n\n").map((p, i) => (
                    <p key={i}>{p.trim()}</p>
                  ))}
                </div>
                {report?.aegis?.top_kabupaten && (
                  <AegisTable top_kab={report.aegis.top_kabupaten} />
                )}
              </section>

              {/* 4. Loyalty */}
              <section>
                <SectionHeader num={4} title="Program Loyalty" />
                <div className="text-sm leading-relaxed space-y-3">
                  {sections.analisis_loyalty.split("\n\n").map((p, i) => (
                    <p key={i}>{p.trim()}</p>
                  ))}
                </div>
                {report?.loyalty && Object.keys(report.loyalty).length > 0 && (
                  <LoyaltyTable loyalty={report.loyalty} />
                )}
              </section>

              {/* 5. Rekomendasi */}
              <section>
                <SectionHeader num={5} title="Rekomendasi Tindakan" />
                <div className="text-sm whitespace-pre-line leading-relaxed">
                  {sections.rekomendasi}
                </div>
              </section>

              {/* Footer */}
              <div className="border-t border-border pt-4 text-center">
                <p className="text-xs text-muted-foreground">
                  Generated by CORE Platform AI  •  Data berbasis transaksi internal  •  Untuk keperluan internal
                </p>
              </div>
            </div>
          </>
        )}

        {/* Skeleton while generating */}
        {generating && !sections && (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        )}
      </main>
    </div>
  );
}
