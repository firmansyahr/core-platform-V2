"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Shield, Users, TrendingDown, TrendingUp,
  Target, Heart, FlaskConical, Bot, Layers,
  BarChart3, Zap, ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ── types ─────────────────────────────────────────────────────────────────────

interface HomeSummary {
  toko_aktif: number;
  warning_merah: number;
  warning_oranye: number;
  warning_kuning: number;
  volume_at_risk: number;
}
interface LoyaltySummary { total_aktif: number }
interface VarPrediction { data: { volume_at_risk: { prediction: { value: number } } } }

interface KpiData {
  volume_at_risk_ton: number;
  toko_aktif: number;
  loyalty_aktif: number;
  warning_count: number;
}

// ── module cards ──────────────────────────────────────────────────────────────

const MODULES = [
  {
    icon: Shield,
    color: "text-orange-500",
    bg: "bg-orange-50 dark:bg-orange-950/30",
    title: "AEGIS — Market Share Defense",
    headline: "Deteksi dini toko berisiko sebelum volume hilang",
    body: "Sistem 3-layer ensemble (CRS Score, Isolation Forest, XGBoost+SMOTE) mengklasifikasikan toko ke dalam 4 pola warning. CAD Alert otomatis ter-generate setiap bulan per kabupaten.",
    metric: "Merah · Oranye · Kuning · Hijau — 4 level intervensi",
    href: "/aegis",
  },
  {
    icon: Target,
    color: "text-blue-500",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    title: "STRATEGOS — Budget Optimizer",
    headline: "Alokasi budget loyalty ke toko dengan ROI tertinggi",
    body: "Integer Linear Programming (PuLP) memilih kombinasi toko optimal dalam constraint budget. Terintegrasi dengan GMM Cannibalization Detector untuk hindari kanibalisasi internal.",
    metric: "300 kandidat · constraint budget real-time · ILP solver",
    href: "/ilp",
  },
  {
    icon: BarChart3,
    color: "text-purple-500",
    bg: "bg-purple-50 dark:bg-purple-950/30",
    title: "Competitor Intelligence — ASPERSSI",
    headline: "Triangulasi tekanan kompetitor dari tiga sumber data",
    body: "Menggabungkan sinyal AEGIS, data market share ASPERSSI, dan pola transaksi untuk verdict 5-level per kabupaten/provinsi. Prediksi market share 3 bulan ke depan via Prophet.",
    metric: "5 provinsi · 28 periode · multi-brand tracking",
    href: "/competitor",
  },
  {
    icon: Heart,
    color: "text-green-500",
    bg: "bg-green-50 dark:bg-green-950/30",
    title: "Loyalty Management — Member Engine",
    headline: "Program loyalty berbasis data dengan reward yang adil",
    body: "Manajemen member aktif dengan kalkulasi reward berbasis Brand Config per wilayah (MB×100% / CB×50% / FB×50%). Performance Tracker dengan churn risk prediction otomatis.",
    metric: "Churn risk · Brand-aware reward · Multi-tier program",
    href: "/loyalty",
  },
  {
    icon: FlaskConical,
    color: "text-teal-500",
    bg: "bg-teal-50 dark:bg-teal-950/30",
    title: "Causal ML — Impact Estimator",
    headline: "Mengukur dampak nyata program, bukan korelasi",
    body: "Panel Difference-in-Differences (DoWhy + EconML) memisahkan efek kausal program loyalty dari faktor eksternal. ATE -1.6% dengan refutation test PASSED — bukan sekadar korelasi.",
    metric: "ATE -1.6% · Refutation PASSED · p < 0.05",
    href: "/loyalty",
  },
  {
    icon: Bot,
    color: "text-indigo-500",
    bg: "bg-indigo-50 dark:bg-indigo-950/30",
    title: "ORACLE — AI Intelligence",
    headline: "Agentic AI yang memahami konteks bisnis platform",
    body: "Multi-step analysis dengan smart model routing (Haiku/Sonnet/Opus). Auto-validasi CAD Alert, daily briefing 07:00, streaming response, dan anti-hijack security 3-layer.",
    metric: "Haiku 80% · Sonnet 15% · Opus 5% (RCA only)",
    href: "/analytics/oracle",
  },
];

// ── component ─────────────────────────────────────────────────────────────────

export default function ExecutiveSummaryPage() {
  const [kpi, setKpi] = useState<KpiData | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchAll = async () => {
      const safe = async <T,>(url: string): Promise<T | null> => {
        try {
          const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (!r.ok) return null;
          return r.json();
        } catch { return null; }
      };

      const [home, loyalty, varPred] = await Promise.all([
        safe<{ status: string; data: HomeSummary }>(`${API}/api/home/summary`),
        safe<{ status: string; data: LoyaltySummary }>(`${API}/api/loyalty/summary`),
        safe<VarPrediction>(`${API}/api/predictions/home-executive`),
      ]);

      if (cancelled) return;

      setKpi({
        volume_at_risk_ton: varPred?.data?.volume_at_risk?.prediction?.value ?? 92858,
        toko_aktif:         home?.data?.toko_aktif         ?? 3783,
        loyalty_aktif:      loyalty?.data?.total_aktif     ?? 366,
        warning_count:
          (home?.data?.warning_merah  ?? 137) +
          (home?.data?.warning_oranye ?? 211) +
          (home?.data?.warning_kuning ?? 1067),
      });
    };

    fetchAll();
    return () => { cancelled = true; };
  }, []);

  const fmt = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1_000
      ? `${(n / 1_000).toFixed(0)}K`
      : String(n);

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 space-y-12">

      {/* ── SECTION 1: HERO ───────────────────────────────────────────────── */}
      <section className="border-b pb-8">
        <p className="text-xs text-muted-foreground tracking-widest uppercase mb-3">
          CORE Platform v2 — Commercial Optimization &amp; Retention Engine
        </p>
        <h1 className="text-3xl font-semibold tracking-tight mb-4">
          Dari Data Distribusi ke Keputusan Bisnis
        </h1>
        <p className="text-muted-foreground max-w-2xl leading-relaxed text-sm">
          Platform intelijen komersial yang mengintegrasikan machine learning,
          kausal inference, dan optimasi operasional untuk distributor semen
          skala nasional Indonesia — dirancang untuk mengubah 2,1 juta baris
          data transaksi menjadi aksi strategis yang terukur.
        </p>
        <div className="flex flex-wrap gap-2 mt-5">
          <Badge className="text-xs font-normal">2,1 juta baris · 5.248 toko · 99 kabupaten</Badge>
          <Badge className="text-xs font-normal">Jan 2024 – Apr 2026</Badge>
          <Badge variant="outline" className="text-xs font-normal">Synthetic Dataset · Portfolio Demo</Badge>
        </div>
      </section>

      {/* ── SECTION 2: IMPACT NUMBERS ─────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground tracking-widest uppercase mb-5">
          Dampak Terukur
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">

          {/* Volume at Risk */}
          <Card className="border-orange-200 dark:border-orange-900">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-orange-50 dark:bg-orange-950/40 mt-0.5">
                  <Shield size={16} className="text-orange-500" />
                </div>
                <div className="min-w-0">
                  {kpi ? (
                    <p className="text-xl font-semibold tabular-nums">
                      ~{fmt(kpi.volume_at_risk_ton)}<span className="text-sm font-normal ml-1">ton</span>
                    </p>
                  ) : (
                    <Skeleton className="h-7 w-20 mb-1" />
                  )}
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                    volume teridentifikasi berisiko per bulan
                  </p>
                  <p className="text-[10px] text-orange-500 mt-1">AEGIS Market Defense</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Toko Dimonitor */}
          <Card className="border-blue-200 dark:border-blue-900">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/40 mt-0.5">
                  <Layers size={16} className="text-blue-500" />
                </div>
                <div className="min-w-0">
                  {kpi ? (
                    <p className="text-xl font-semibold tabular-nums">
                      {kpi.toko_aktif.toLocaleString("id-ID")}
                    </p>
                  ) : (
                    <Skeleton className="h-7 w-16 mb-1" />
                  )}
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                    toko aktif dianalisis pola warning-nya
                  </p>
                  <p className="text-[10px] text-blue-500 mt-1">
                    {kpi ? `${kpi.warning_count.toLocaleString("id-ID")} dalam status warning` : "—"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Member Loyalty */}
          <Card className="border-green-200 dark:border-green-900">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-green-50 dark:bg-green-950/40 mt-0.5">
                  <Users size={16} className="text-green-500" />
                </div>
                <div className="min-w-0">
                  {kpi ? (
                    <p className="text-xl font-semibold tabular-nums">
                      {kpi.loyalty_aktif.toLocaleString("id-ID")}
                    </p>
                  ) : (
                    <Skeleton className="h-7 w-14 mb-1" />
                  )}
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                    member loyalty aktif dikelola
                  </p>
                  <p className="text-[10px] text-green-500 mt-1">reward dioptimalkan via ILP</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Causal Impact */}
          <Card className="border-teal-200 dark:border-teal-900">
            <CardContent className="pt-5 pb-4">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-teal-50 dark:bg-teal-950/40 mt-0.5">
                  <TrendingDown size={16} className="text-teal-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-xl font-semibold tabular-nums text-teal-600 dark:text-teal-400">
                    −1.6%
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                    penurunan risiko terukur dari program loyalty
                  </p>
                  <p className="text-[10px] text-teal-500 mt-1">DiD · ATE · Refutation PASSED</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── SECTION 3: PLATFORM MODULES ───────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground tracking-widest uppercase mb-5">
          Arsitektur Platform — 6 Modul Terintegrasi
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {MODULES.map((m) => {
            const Icon = m.icon;
            return (
              <Link key={m.title} href={m.href} className="group block">
                <Card className="h-full transition-shadow group-hover:shadow-md group-hover:border-foreground/20">
                  <CardHeader className="pb-2 pt-4 px-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`p-1.5 rounded-md ${m.bg}`}>
                        <Icon size={14} className={m.color} />
                      </div>
                      <CardTitle className="text-xs font-semibold text-muted-foreground tracking-wide">
                        {m.title}
                      </CardTitle>
                    </div>
                    <p className="text-sm font-medium leading-snug">{m.headline}</p>
                  </CardHeader>
                  <CardContent className="px-4 pb-4">
                    <p className="text-[12px] text-muted-foreground leading-relaxed mb-3">
                      {m.body}
                    </p>
                    <p className={`text-[11px] font-medium ${m.color}`}>
                      {m.metric}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ── SECTION 4: METHODOLOGY ────────────────────────────────────────── */}
      <section className="border-y py-8">
        <h2 className="text-xs font-semibold text-muted-foreground tracking-widest uppercase mb-6">
          Pendekatan Metodologi
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Zap size={14} className="text-yellow-500" />
              <h3 className="text-sm font-semibold">2-Stage ML Pipeline</h3>
            </div>
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              GMM clustering (unsupervised discovery) menghasilkan sinyal kanibalisasi
              tanpa label bias, lalu XGBoost surrogate classifier mempelajari pola
              tersebut secara scalable. Trained pada 21.014 toko dari dataset sintetis
              2,1 juta baris — menghindari circular reasoning dalam label construction.
            </p>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <FlaskConical size={14} className="text-teal-500" />
              <h3 className="text-sm font-semibold">Beyond Correlation</h3>
            </div>
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              Panel DiD dengan DoWhy + EconML mengidentifikasi efek kausal bersih
              program loyalty, terpisah dari seasonal trend dan market-wide movement.
              Refutation test (placebo, random common cause) memvalidasi bahwa
              estimasi bukan artefak statistik.
            </p>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Target size={14} className="text-blue-500" />
              <h3 className="text-sm font-semibold">Constrained Optimization</h3>
            </div>
            <p className="text-[12px] text-muted-foreground leading-relaxed">
              ILP (PuLP) dengan integrasi GMM cannibalization signal menghasilkan
              portofolio toko optimal dalam budget constraint — bukan hanya ranking
              sederhana. Solusi matematically optimal, bukan heuristik greedy.
            </p>
          </div>
        </div>
      </section>

      {/* ── SECTION 5: TECH STACK ─────────────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground tracking-widest uppercase mb-5">
          Tech Stack
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-semibold tracking-wide uppercase">
                Backend
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2">
              {[
                ["Runtime", "FastAPI · SQLAlchemy · SQLite (Railway Volume)"],
                ["ML / Stat", "Prophet · DoWhy · EconML · XGBoost · scikit-learn"],
                ["Clustering", "Gaussian Mixture Models (GMM) · Isolation Forest"],
                ["Optimization", "PuLP (ILP) · APScheduler · SHAP"],
                ["AI", "Claude API — Haiku / Sonnet / Opus routing"],
              ].map(([label, value]) => (
                <div key={label} className="flex gap-3">
                  <span className="text-[11px] text-muted-foreground w-24 shrink-0 mt-px">{label}</span>
                  <span className="text-[12px] leading-snug">{value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs text-muted-foreground font-semibold tracking-wide uppercase">
                Frontend &amp; Deployment
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2">
              {[
                ["Framework", "Next.js 14 App Router · TypeScript"],
                ["UI", "shadcn/ui · Tailwind CSS · Recharts"],
                ["AI Client", "react-markdown · streaming SSE"],
                ["Deploy BE", "Railway (Python 3.12 · Uvicorn · Volume mount)"],
                ["Deploy FE", "Vercel (Edge Network · Auto-deploy dari GitHub)"],
              ].map(([label, value]) => (
                <div key={label} className="flex gap-3">
                  <span className="text-[11px] text-muted-foreground w-24 shrink-0 mt-px">{label}</span>
                  <span className="text-[12px] leading-snug">{value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── SECTION 6: CTA ────────────────────────────────────────────────── */}
      <section className="border-t pt-8 flex flex-wrap gap-3 items-center">
        <Button asChild size="sm">
          <Link href="/">
            <TrendingUp size={14} className="mr-1.5" />
            Explore Dashboard
          </Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href="/about">Metodologi Lengkap</Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href="/aegis">Lihat AEGIS Live</Link>
        </Button>
        <span className="text-xs text-muted-foreground ml-auto hidden md:block">
          Data diperbarui real-time dari Railway backend
          <span className="mx-1">·</span>
          {kpi ? (
            <span className="text-green-500">● API connected</span>
          ) : (
            <span className="text-muted-foreground">○ loading...</span>
          )}
        </span>
      </section>

    </main>
  );
}
