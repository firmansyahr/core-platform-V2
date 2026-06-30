"use client";

import Navbar from "@/components/Navbar";
import {
  AlertTriangle, BarChart2, Users, TrendingUp,
  Brain, Cpu, Target, Zap, Layers, GitBranch,
  ShieldCheck, Activity, Swords, Bot, Sparkles,
  CheckCircle2, XCircle, Scale, GitMerge,
  ExternalLink, Map, FileText, Award, Bell,
} from "lucide-react";

// ─── Data ─────────────────────────────────────────────────────────────────────

const HERO_BADGES = [
  "Python", "FastAPI", "Next.js 14", "TypeScript",
  "XGBoost", "Prophet", "SHAP", "ILP/PuLP",
  "scikit-learn", "GMM", "Recharts", "Claude API",
];

const MODULES = [
  {
    id: "aegis",
    color: "#dc2626",
    bgCls:   "bg-red-50 dark:bg-red-950/20",
    borderCls: "border-red-200/60 dark:border-red-800/40",
    iconCls: "bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400",
    icon:    AlertTriangle,
    label:   "Early Warning System",
    name:    "AEGIS Market Share Defense",
    desc:    "Deteksi anomali perilaku transaksi toko mitra 3–6 minggu sebelum berdampak pada volume. Ensemble tiga model AI: CRS + Isolation Forest + XGBoost.",
    metric:  "ROC-AUC 0.860 · Recall 73.6%",
    features: [
      "Peta Choropleth wilayah",
      "Store Detail per toko",
      "CAD Alert History",
      "AEGIS-PREDICT (Prophet)",
      "AEGIS-EXPLAIN (SHAP)",
    ],
  },
  {
    id: "ilp",
    color: "#2563eb",
    bgCls:   "bg-blue-50 dark:bg-blue-950/20",
    borderCls: "border-blue-200/60 dark:border-blue-800/40",
    iconCls: "bg-blue-100 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400",
    icon:    BarChart2,
    label:   "Mathematical Optimizer",
    name:    "ILP Store Selection",
    desc:    "Integer Linear Programming untuk seleksi toko loyalty program optimal dengan multi-constraint: budget, cluster, wilayah, dan hierarki sales.",
    metric:  "PuLP CBC Solver · Multi-criteria scoring",
    features: [
      "Scenario comparison",
      "Bobot scoring dinamis",
      "Filter SSM → ASM → TSO",
      "Constraint distribusi cluster",
      "Referensi Loyalty Program",
    ],
  },
  {
    id: "loyalty",
    color: "#16a34a",
    bgCls:   "bg-green-50 dark:bg-green-950/20",
    borderCls: "border-green-200/60 dark:border-green-800/40",
    iconCls: "bg-green-100 dark:bg-green-950/40 text-green-600 dark:text-green-400",
    icon:    Users,
    label:   "Operational System",
    name:    "Loyalty Management",
    desc:    "Manajemen peserta program loyalty dengan target hybrid adaptive, smart promotion berbasis kondisi AEGIS, dan pengelolaan program promo multi-jenis.",
    metric:  "Hybrid target: 60% rolling 3M + 40% YoY",
    features: [
      "Smart Promotion Engine",
      "Program Promo multi-jenis",
      "Target & Achievement",
      "Re-enroll & Takeout",
      "Takeout Recommendations",
      "Brand Config per Wilayah",
    ],
  },
  {
    id: "tracker",
    color: "#7c3aed",
    bgCls:   "bg-purple-50 dark:bg-purple-950/20",
    borderCls: "border-purple-200/60 dark:border-purple-800/40",
    iconCls: "bg-purple-100 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400",
    icon:    TrendingUp,
    label:   "Outcome Monitor",
    name:    "Store Performance Tracker",
    desc:    "Memantau outcome toko setelah intervensi program loyalty — menutup loop AEGIS Detection + GMM Cannibalization + Competitor Intelligence → ILP Optimization → Loyalty Enrollment → hasil nyata di lapangan.",
    metric:  "End-to-end loop closure",
    features: [
      "Journey timeline 3-tahap",
      "Volume delta monitoring",
      "FBSI delta tracking",
      "Verdict otomatis per toko",
      "Store Journey Modal",
    ],
  },
  {
    id: "competitor",
    color: "#ea580c",
    bgCls:   "bg-orange-50 dark:bg-orange-950/20",
    borderCls: "border-orange-200/60 dark:border-orange-800/40",
    iconCls: "bg-orange-100 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400",
    icon:    Swords,
    label:   "External Signal Layer",
    name:    "Competitor Intelligence",
    desc:    "Triangulasi sinyal internal AEGIS dengan data ASPERSSI untuk mengkonfirmasi apakah anomali transaksi disebabkan tekanan kompetitor eksternal atau faktor internal dan seasonal.",
    metric:  "Prophet + LinReg + Delta Projection · 5 Verdict",
    features: [
      "Triangulasi per Provinsi",
      "5 Verdict Level",
      "Ranking Dual-Source (ASPERSSI + CAD)",
      "Prediksi Market Share",
      "AI Insight Competitor",
    ],
  },
];

const AI_CAPS = [
  {
    icon: Activity,
    title: "Isolation Forest",
    desc: "Deteksi anomali statistik per tier cluster",
    detail: "Contamination: SP 3% · Platinum 4% · Gold 5% · Silver 6% · Bronze 8%",
    color: "text-red-600 dark:text-red-400",
    bg: "bg-red-50 dark:bg-red-950/20",
  },
  {
    icon: Brain,
    title: "XGBoost Classifier",
    desc: "Prediksi probabilitas risiko beralih",
    detail: "SMOTE oversampling · Walk-forward validation · ROC-AUC 0.860",
    color: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-50 dark:bg-orange-950/20",
  },
  {
    icon: Cpu,
    title: "Integer Linear Programming",
    desc: "Optimasi alokasi dengan multi-constraint",
    detail: "PuLP CBC Solver · Global optimum · Tidak greedy",
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-950/20",
  },
  {
    icon: TrendingUp,
    title: "Prophet Forecasting",
    desc: "Prediksi trendline adaptif di 3 modul platform",
    detail: "AEGIS-PREDICT (4 minggu) · Loyalty trendline · Competitor market share (Prophet + LinReg + Delta adaptive) · CI 80% · Seasonal aware",
    color: "text-sky-600 dark:text-sky-400",
    bg: "bg-sky-50 dark:bg-sky-950/20",
  },
  {
    icon: Layers,
    title: "SHAP Explainability",
    desc: "Transparansi keputusan model AI",
    detail: "TreeExplainer · Narasi otomatis bahasa bisnis",
    color: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-50 dark:bg-violet-950/20",
  },
  {
    icon: Target,
    title: "Hybrid Adaptive Target",
    desc: "Target loyalty yang fair dan seasonal-aware",
    detail: "Base_1 (60%) × rolling 3M + Base_2 (40%) × YoY · Growth rate per AEGIS",
    color: "text-green-600 dark:text-green-400",
    bg: "bg-green-50 dark:bg-green-950/20",
  },
  {
    icon: Zap,
    title: "Smart Promotion Engine",
    desc: "Rekomendasi insentif real-time per toko",
    detail: "Emergency Boost · Retention · Loyalty Reward · Standard",
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/20",
  },
  {
    icon: GitBranch,
    title: "Performance Attribution",
    desc: "Mengukur dampak nyata intervensi program",
    detail: "Volume delta · FBSI delta · Verdict otomatis · Journey reconstruction",
    color: "text-purple-600 dark:text-purple-400",
    bg: "bg-purple-50 dark:bg-purple-950/20",
  },
  {
    icon: ShieldCheck,
    title: "GMM Cannibalization Detector",
    desc: "Membedakan kanibalisasi internal dari tekanan kompetitor eksternal",
    detail: "Gaussian Mixture Model · BIC-optimal k · 4 brand-shift features · Digunakan ILP & Smart Promotion Engine",
    color: "text-indigo-600 dark:text-indigo-400",
    bg: "bg-indigo-50 dark:bg-indigo-950/20",
  },
  {
    icon: Scale,
    title: "Causal Impact Estimator",
    desc: "Mengkuantifikasi besaran dampak program loyalty terhadap volume toko",
    detail: "DoWhy + EconML · Panel Diff-in-Diff · Causal Forest (CATE per toko) · Refutation test",
    color: "text-teal-600 dark:text-teal-400",
    bg: "bg-teal-50 dark:bg-teal-950/20",
  },
  {
    icon: GitMerge,
    title: "Multi-Signal Priority Adjustment",
    desc: "Menyesuaikan skor ILP dari sinyal GMM dan triangulasi kompetitor, dengan deteksi sinyal bertentangan",
    detail: "GMM Cannibalization × Competitor Intelligence (ASPERSSI) · Verdict Kompetitor per provinsi · Sinyal Bertentangan → reset skor dasar + Validasi Lapangan TSO",
    color: "text-fuchsia-600 dark:text-fuchsia-400",
    bg: "bg-fuchsia-50 dark:bg-fuchsia-950/20",
  },
];

const GEN_AI_CAPS = [
  {
    icon: Bot,
    title: "ORACLE Intelligence",
    desc: "AI analyst dengan tool calling ke data real platform, page-context aware, dan Root Cause Analysis",
    detail: "14+ tools (volume, AEGIS, kompetitor, GMM, ROI promo, simulasi) · Floating widget di semua halaman + Full Workspace di /analytics/oracle · Claude API",
    color: "text-cyan-600 dark:text-cyan-400",
    bg: "bg-cyan-50 dark:bg-cyan-950/20",
  },
  {
    icon: Sparkles,
    title: "AI Report Generator",
    desc: "Laporan bulanan lengkap otomatis dalam satu klik",
    detail: "Ringkasan eksekutif · Analisis AEGIS · Evaluasi Loyalty · Rekomendasi tindakan · Download PDF",
    color: "text-pink-600 dark:text-pink-400",
    bg: "bg-pink-50 dark:bg-pink-950/20",
  },
  {
    icon: Award,
    title: "Executive Summary",
    desc: "Ringkasan kondisi platform lintas-modul dalam satu halaman — orientasi cepat untuk stakeholder",
    detail: "Health score AEGIS · Loyalty achievement snapshot · Competitor risk overview · KPI utama · Cross-module aggregation",
    color: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-50 dark:bg-violet-950/20",
  },
  {
    icon: Bell,
    title: "Action Center",
    desc: "Agregasi rekomendasi aksi terprioritasi dari semua modul dalam satu tampilan",
    detail: "3 severity level (Kritis/Penting/Info) · Source: AEGIS, Loyalty, Competitor Intelligence · Badge real-time di navbar · Dismiss per item · 5-menit cache TTL",
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/20",
  },
];

const WHY_ITEMS = [
  {
    q: "Mengapa Ensemble untuk AEGIS Score?",
    rows: [
      { label: "CRS (50%)",  desc: "Sinyal bisnis yang dapat diinterpretasikan langsung" },
      { label: "IF (20%)",   desc: "Anomali statistik yang tidak terlihat oleh aturan bisnis" },
      { label: "XGB (30%)",  desc: "Pola kompleks dari kombinasi fitur historis" },
    ],
    note: null,
  },
  {
    q: "Mengapa Target Hybrid 60/40?",
    rows: [
      { label: "Rolling 3M",  desc: "Responsif terhadap kondisi terkini, tapi rentan seasonal" },
      { label: "YoY",         desc: "Mengeliminasi seasonal, tapi sensitif kejadian luar biasa" },
      { label: "Kombinasi 60/40", desc: "Menghasilkan target yang stabil dan fair" },
    ],
    note: null,
  },
  {
    q: "Mengapa AEGIS adalah Warning, Bukan Diagnosis?",
    rows: [
      { label: "Sumber data",    desc: "Hanya transaksi internal — kompetitor tidak terlihat langsung" },
      { label: "Sinyal anomali", desc: "Terkonsentrasi = indikasi, bukan bukti aktivitas kompetitor" },
      { label: "Keputusan akhir", desc: "Validasi lapangan TSO tetap kunci — sistem hanya trigger" },
    ],
    note: "AEGIS adalah sistem early warning, bukan pengganti validasi lapangan.",
  },
];

const STEPS = [
  { n: 1, icon: "🔑", title: "Login",                desc: "Gunakan demo account viewer / viewer123 (read-only) atau admin / admin123 (penuh)." },
  { n: 2, icon: "🏠", title: "Home Dashboard",       desc: "Ringkasan kondisi pasar: distribusi warning level, top toko berisiko, peta sebaran." },
  { n: 3, icon: "⚠️", title: "AEGIS Monitor",        desc: "Identifikasi toko dan wilayah berisiko, analisis pola A/B/C/D, prioritaskan kunjungan TSO." },
  { n: 4, icon: "🔍", title: "Store Detail",          desc: "Analisis mendalam per toko: SHAP explanation faktor risiko, prediksi 4 minggu ke depan." },
  { n: 5, icon: "🗺️", title: "Peta Wilayah",         desc: "Visualisasi geografis choropleth distribusi CAD Alert per kabupaten/kota." },
  { n: 6, icon: "📊", title: "ILP Optimizer",         desc: "Seleksi toko untuk program loyalty dengan constraint budget, cluster, dan wilayah." },
  { n: 7, icon: "👥", title: "Loyalty Management",    desc: "Kelola peserta aktif, smart promotion berbasis AEGIS, target & achievement monitoring." },
  { n: 8, icon: "🎁", title: "Program Promo",         desc: "Buat, monitor, dan hentikan program promosi multi-jenis dengan tracking realisasi." },
  { n: 9, icon: "📈", title: "Performance Tracker",       desc: "Evaluasi outcome program: volume delta, FBSI delta, dan verdict otomatis per toko." },
  { n: 10, icon: "🤝", title: "Competitor Intelligence", desc: "Triangulasi AEGIS + ASPERSSI per provinsi: konfirmasi ancaman kompetitor, ranking brand dari dua sumber, dan prediksi market share dengan label keandalan." },
  { n: 11, icon: "📄", title: "AI Report Generator",    desc: "Generate laporan bulanan otomatis — ringkasan eksekutif, analisis AEGIS, evaluasi loyalty, dan rekomendasi tindakan dalam satu klik. Tinjau di browser sebelum unduh PDF." },
  { n: 12, icon: "📊", title: "Executive Summary",     desc: "Ringkasan lintas-modul dalam satu halaman: health score AEGIS, Loyalty achievement, Competitor snapshot, dan KPI utama — orientasi cepat kondisi platform untuk stakeholder." },
  { n: 13, icon: "⚡", title: "Action Center",         desc: "Rekomendasi aksi terprioritasi dari semua modul. Severity Kritis → tindak segera, Penting → dalam 48 jam, Info → pantau berkala. Dismiss item yang sudah ditangani." },
];

const ACCESS_MATRIX = [
  { feature: "Home Dashboard",           admin: true,  viewer: true  },
  { feature: "AEGIS Monitor + Detail",   admin: true,  viewer: true  },
  { feature: "Peta Choropleth",          admin: true,  viewer: true  },
  { feature: "AEGIS-PREDICT",            admin: true,  viewer: true  },
  { feature: "AEGIS-EXPLAIN (SHAP)",     admin: true,  viewer: true  },
  { feature: "CAD Alert History",        admin: true,  viewer: true  },
  { feature: "ILP Optimizer",            admin: true,  viewer: true  },
  { feature: "Loyalty Management",       admin: true,  viewer: true  },
  { feature: "Program Promo",            admin: true,  viewer: true  },
  { feature: "Performance Tracker",      admin: true,  viewer: true  },
  { feature: "Competitor Intelligence",  admin: true,  viewer: true  },
  { feature: "Executive Summary",         admin: true,  viewer: true  },
  { feature: "Action Center",            admin: true,  viewer: true  },
  { feature: "AI Report Generator",      admin: true,  viewer: true  },
  { feature: "ORACLE Intelligence",      admin: true,  viewer: true  },
  { feature: "Settings (view)",          admin: true,  viewer: true  },
  { feature: "Settings (edit)",          admin: true,  viewer: false },
  { feature: "Brand Config (view)",      admin: true,  viewer: true  },
  { feature: "Brand Config (tambah/edit/hapus)", admin: true,  viewer: false },
  { feature: "Reload Data",             admin: true,  viewer: true  },
];

const PATTERNS = [
  { code: "A", label: "Toko mulai beralih ke produk murah — order masih rutin",                cls: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400" },
  { code: "B", label: "Toko bermasalah — tiga sinyal aktif bersamaan · Prioritas tertinggi",   cls: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400" },
  { code: "C", label: "Pola order berubah — pre-warning, pantau sebelum memburuk",              cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
  { code: "D", label: "Toko sudah kembali normal — momentum positif, perkuat hubungan",        cls: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400" },
];

const CI_VERDICTS = [
  { verdict: "Terkonfirmasi",    label: "Warning AEGIS tinggi DAN market share kompetitor naik di provinsi yang sama", cls: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400" },
  { verdict: "Waspada Awal",     label: "Market share kompetitor naik meski warning AEGIS masih rendah — sinyal dini", cls: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400" },
  { verdict: "Bukan Kompetitor", label: "Warning AEGIS tinggi tapi market share stabil — indikasi masalah internal/seasonal", cls: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400" },
  { verdict: "Data Kurang",      label: "Warning AEGIS tinggi tapi data ASPERSSI tidak tersedia untuk provinsi ini", cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
  { verdict: "Normal",           label: "Tidak ada indikasi tekanan kompetitor maupun anomali internal", cls: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400" },
];

const PROMO_TYPES = [
  {
    id:    "flat_multiplier",
    label: "Tipe 1",
    name:  "Flat Multiplier",
    tag:   "Efek Instan",
    color: "#2563eb",
    bgCls: "bg-blue-50 dark:bg-blue-950/20",
    borderCls: "border-blue-200/60 dark:border-blue-800/40",
    desc:  "Setiap transaksi langsung mendapat poin berlipat tanpa perlu mencapai target apapun. Cocok untuk dorongan jangka pendek yang ingin langsung terasa.",
    example: "\"Semua transaksi Elang bulan ini 2× Poin\"",
  },
  {
    id:    "multi_tier",
    label: "Tipe 2",
    name:  "Multi-Tier Target",
    tag:   "Target-Driven",
    color: "#16a34a",
    bgCls: "bg-green-50 dark:bg-green-950/20",
    borderCls: "border-green-200/60 dark:border-green-800/40",
    desc:  "Reward bertingkat berdasarkan persentase pencapaian target individual toko. Threshold dan multiplier setiap tier dikonfigurasi bebas saat membuat program.",
    example: "100% target → 2× Poin · 120% target → 3× Poin · >120% → 1× Poin (reguler)",
  },
  {
    id:    "leaderboard",
    label: "Tipe 3",
    name:  "Gamifikasi / Leaderboard",
    tag:   "Kompetitif",
    color: "#ea580c",
    bgCls: "bg-orange-50 dark:bg-orange-950/20",
    borderCls: "border-orange-200/60 dark:border-orange-800/40",
    desc:  "Toko-toko bersaing membentuk papan peringkat berdasarkan volume total atau growth persentase, dengan scope per cluster atau global. Reward berbeda per posisi — poin maupun Rupiah tetap.",
    example: "Ranking Posisi 1 → Rp 5 jt · Posisi 2 → Rp 3 jt · Posisi 3 → Rp 1 jt",
  },
];

const BRAND_CATEGORIES = [
  {
    id:    "mb",
    label: "Kategori 1",
    name:  "Main Brand (MB)",
    tag:   "Reward 100%",
    color: "#2563eb",
    bgCls: "bg-blue-50 dark:bg-blue-950/20",
    borderCls: "border-blue-200/60 dark:border-blue-800/40",
    desc:  "Brand utama wilayah tersebut — tepat satu brand per konfigurasi. Volume brand ini dihitung penuh terhadap target dan reward loyalty.",
    example: "Default: SEMEN ELANG",
  },
  {
    id:    "cb",
    label: "Kategori 2",
    name:  "Companion Brand (CB)",
    tag:   "Reward 50%",
    color: "#16a34a",
    bgCls: "bg-green-50 dark:bg-green-950/20",
    borderCls: "border-green-200/60 dark:border-green-800/40",
    desc:  "Brand pendukung — boleh lebih dari satu per wilayah, mendukung strategi multi-brand sesuai kondisi pasar setempat.",
    example: "Default: SEMEN BADAK",
  },
  {
    id:    "fb",
    label: "Kategori 3",
    name:  "Fighting Brand (FB)",
    tag:   "Reward 50% · Opsional",
    color: "#ea580c",
    bgCls: "bg-orange-50 dark:bg-orange-950/20",
    borderCls: "border-orange-200/60 dark:border-orange-800/40",
    desc:  "Brand fighting/value untuk melawan kompetitor di kelas harga rendah. Dapat dikosongkan per wilayah jika tidak ingin diikutkan dalam kalkulasi.",
    example: "Default: SEMEN BANTENG",
  },
];

// ─── Section label helper ─────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest text-center mb-10">
      {children}
    </p>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16">

        {/* ══ 1. HERO ══════════════════════════════════════════════════════════ */}
        <section className="py-24 px-6">
          <div className="max-w-3xl mx-auto text-center">
            <span className="inline-block px-3 py-1 rounded-full text-xs font-medium bg-muted border border-border text-muted-foreground mb-6">
              Portfolio Project · Analitik Pasar Semen Kantong
            </span>
            <h1 className="text-5xl font-extrabold tracking-tight mb-3">CORE Platform</h1>
            <p className="text-xl text-muted-foreground font-medium mb-6">
              Commercial Optimization &amp; Retention Engine
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed mb-10 max-w-2xl mx-auto">
              Sistem analitik prediktif berbasis AI untuk mendukung pengambilan keputusan komersial di pasar
              semen kantong. Mengintegrasikan deteksi risiko pasar, optimasi program loyalty, manajemen
              operasional peserta, dan pemantauan outcome dalam satu ekosistem digital yang terhubung.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {HERO_BADGES.map((t) => (
                <span key={t} className="px-3 py-1 rounded-full text-xs font-medium bg-muted border border-border text-foreground">
                  {t}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ══ 2. EMPAT MODUL ═══════════════════════════════════════════════════ */}
        <section className="py-16 px-6 border-t border-border">
          <div className="max-w-6xl mx-auto">
            <SectionLabel>Lima Modul Utama</SectionLabel>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {MODULES.map((m, idx) => {
                const Icon = m.icon;
                const isLastAlone = idx === MODULES.length - 1 && MODULES.length % 2 !== 0;
                return (
                  <div
                    key={m.id}
                    className={`rounded-xl border bg-card p-6 flex flex-col gap-4 ${m.borderCls}${isLastAlone ? " md:col-span-2 lg:col-span-1" : ""}`}
                  >
                    {/* Header */}
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${m.iconCls}`}>
                        <Icon size={18} />
                      </div>
                      <div>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {m.label}
                        </span>
                        <h3 className="font-semibold leading-tight">{m.name}</h3>
                      </div>
                    </div>

                    {/* Desc */}
                    <p className="text-sm text-muted-foreground leading-relaxed">{m.desc}</p>

                    {/* Metric */}
                    <div className={`rounded-lg px-3 py-2 text-xs font-semibold ${m.bgCls}`} style={{ color: m.color }}>
                      {m.metric}
                    </div>

                    {/* Features */}
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        Fitur
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {m.features.map((f) => (
                          <span key={f} className="text-[11px] px-2 py-0.5 rounded-md bg-muted border border-border text-muted-foreground">
                            {f}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* AEGIS Patterns */}
            <div className="mt-6 rounded-xl border border-border bg-muted/30 p-5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                4 Pola Deteksi AEGIS
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PATTERNS.map(({ code, label, cls }) => (
                  <div key={code} className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold w-5 h-5 rounded flex items-center justify-center shrink-0 ${cls}`}>
                      {code}
                    </span>
                    <span className="text-xs text-muted-foreground">{label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* CI Verdicts */}
            <div className="mt-4 rounded-xl border border-border bg-muted/30 p-5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                5 Verdict Competitor Intelligence
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {CI_VERDICTS.map(({ verdict, label, cls }) => (
                  <div key={verdict} className="flex items-start gap-2">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 leading-tight mt-0.5 ${cls}`}>
                      {verdict}
                    </span>
                    <span className="text-xs text-muted-foreground leading-snug">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ══ 2.5. TIGA TIPE PROGRAM PROMO ════════════════════════════════════ */}
        <section className="py-16 px-6 border-t border-border">
          <div className="max-w-6xl mx-auto">
            <SectionLabel>Tiga Tipe Program Promo</SectionLabel>
            <p className="text-sm text-muted-foreground text-center mb-8 max-w-2xl mx-auto">
              Program Promo mendukung tiga tipe konfigurasi yang masing-masing cocok untuk strategi
              insentif berbeda. Semua tipe menggunakan satuan Poin yang dikonversi ke Rupiah
              berdasarkan nilai per brand yang dikonfigurasi terpusat di Settings.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {PROMO_TYPES.map((t) => (
                <div key={t.id} className={`rounded-xl border bg-card p-6 flex flex-col gap-4 ${t.borderCls}`}>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t.label}</span>
                    <h3 className="font-semibold leading-tight">{t.name}</h3>
                  </div>
                  <span
                    className={`self-start px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${t.bgCls}`}
                    style={{ color: t.color }}
                  >
                    {t.tag}
                  </span>
                  <p className="text-sm text-muted-foreground leading-relaxed">{t.desc}</p>
                  <div
                    className={`rounded-lg px-3 py-2 text-xs font-medium ${t.bgCls}`}
                    style={{ color: t.color }}
                  >
                    {t.example}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-xl border border-border bg-muted/30 p-5">
              <p className="text-xs font-semibold text-foreground mb-1.5">Konversi Poin ke Rupiah</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Ketiga tipe program menggunakan satuan <strong>Poin</strong> yang dikonversi ke Rupiah berdasarkan nilai per brand
                yang dikonfigurasi terpusat di Settings — memungkinkan strategi insentif berbeda per brand tanpa mengubah
                struktur program satu per satu.
              </p>
            </div>
          </div>
        </section>

        {/* ══ 2.6. KONFIGURASI BRAND PER WILAYAH ══════════════════════════════ */}
        <section className="py-16 px-6 border-t border-border">
          <div className="max-w-6xl mx-auto">
            <SectionLabel>Konfigurasi Brand per Wilayah (MB/CB/FB)</SectionLabel>
            <p className="text-sm text-muted-foreground text-center mb-8 max-w-2xl mx-auto">
              Sistem konfigurasi brand loyalty yang fleksibel per provinsi dan kabupaten, dengan
              hierarki resolusi otomatis: setting kabupaten menggantikan provinsi, provinsi
              menggantikan default global. Memungkinkan strategi brand yang berbeda per wilayah
              sesuai kondisi pasar setempat.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {BRAND_CATEGORIES.map((c) => (
                <div key={c.id} className={`rounded-xl border bg-card p-6 flex flex-col gap-4 ${c.borderCls}`}>
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{c.label}</span>
                    <h3 className="font-semibold leading-tight">{c.name}</h3>
                  </div>
                  <span
                    className={`self-start px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${c.bgCls}`}
                    style={{ color: c.color }}
                  >
                    {c.tag}
                  </span>
                  <p className="text-sm text-muted-foreground leading-relaxed">{c.desc}</p>
                  <div
                    className={`rounded-lg px-3 py-2 text-xs font-medium ${c.bgCls}`}
                    style={{ color: c.color }}
                  >
                    {c.example}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-xl border border-border bg-muted/30 p-5">
              <p className="text-xs font-semibold text-foreground mb-1.5">Hierarki Resolusi &amp; Kalkulasi Volume</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Resolusi config mengikuti urutan <strong>Kabupaten → Provinsi → Default Global</strong>.
                Volume dan target toko loyalty dihitung dari semua brand yang masuk kategori MB+CB+FB
                sesuai konfigurasi wilayah yang berlaku — bukan statis dari satu brand saja. Perhitungan
                ini menggunakan fork kalkulasi terpisah dari ILP Optimizer untuk menjaga independensi
                kedua sistem.
              </p>
            </div>
          </div>
        </section>

        {/* ══ 3. KAPABILITAS AI ════════════════════════════════════════════════ */}
        <section className="py-16 px-6 border-t border-border bg-muted/30">
          <div className="max-w-6xl mx-auto">
            <SectionLabel>Kapabilitas AI</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {AI_CAPS.map((cap) => {
                const Icon = cap.icon;
                return (
                  <div key={cap.title} className="rounded-xl border border-border bg-card p-4 space-y-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${cap.bg}`}>
                      <Icon size={16} className={cap.color} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold leading-tight">{cap.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{cap.desc}</p>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed border-t border-border pt-2">
                      {cap.detail}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Generative AI */}
            <div className="mt-8 pt-8 border-t border-border/50">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest text-center mb-6">
                Generative AI (Claude API)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
                {GEN_AI_CAPS.map((cap) => {
                  const Icon = cap.icon;
                  return (
                    <div key={cap.title} className="rounded-xl border border-border bg-card p-4 space-y-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${cap.bg}`}>
                        <Icon size={16} className={cap.color} />
                      </div>
                      <div>
                        <p className="text-sm font-semibold leading-tight">{cap.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{cap.desc}</p>
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-relaxed border-t border-border pt-2">
                        {cap.detail}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* ══ 4. LOGIKA BISNIS ═════════════════════════════════════════════════ */}
        <section className="py-16 px-6 border-t border-border bg-muted/30">
          <div className="max-w-5xl mx-auto">
            <SectionLabel>Logika Bisnis</SectionLabel>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {WHY_ITEMS.map((item) => (
                <div key={item.q} className="rounded-xl border border-border bg-card p-5 space-y-4">
                  <p className="text-sm font-semibold leading-snug">{item.q}</p>
                  <div className="space-y-2">
                    {item.rows.map((r) => (
                      <div key={r.label} className="flex items-start gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-foreground/30 mt-1.5 shrink-0" />
                        <span className="text-xs text-muted-foreground">
                          <span className="text-foreground font-medium">{r.label}</span>
                          {" "}— {r.desc}
                        </span>
                      </div>
                    ))}
                  </div>
                  {item.note && (
                    <div className="rounded-lg border border-amber-300/50 bg-amber-50 dark:border-amber-700/30 dark:bg-amber-950/20 px-3 py-2 flex items-start gap-2">
                      <span className="text-amber-600 dark:text-amber-400 text-xs shrink-0 mt-0.5">⚠</span>
                      <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">{item.note}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ══ 6. CARA MENGGUNAKAN ══════════════════════════════════════════════ */}
        <section className="py-16 px-6 border-t border-border">
          <div className="max-w-2xl mx-auto">
            <SectionLabel>Cara Menggunakan</SectionLabel>
            <div className="flex flex-col gap-2.5">
              {STEPS.map(({ n, icon, title, desc }) => (
                <div key={n} className="flex gap-4 rounded-xl border border-border bg-card p-4">
                  <div className="w-9 h-9 rounded-full bg-primary/8 text-primary text-sm font-bold flex items-center justify-center shrink-0 border border-primary/15">
                    {n}
                  </div>
                  <div className="pt-0.5 min-w-0">
                    <p className="text-sm font-semibold mb-0.5 flex items-center gap-1.5">
                      <span>{icon}</span>
                      {title}
                    </p>
                    <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ══ 7. HAK AKSES ═════════════════════════════════════════════════════ */}
        <section className="py-16 px-6 border-t border-border bg-muted/30">
          <div className="max-w-2xl mx-auto">
            <SectionLabel>Hak Akses per Role</SectionLabel>
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground">Fitur</th>
                    <th className="px-4 py-3 text-xs font-bold text-center text-green-600 dark:text-green-400 w-20">Admin</th>
                    <th className="px-4 py-3 text-xs font-semibold text-center text-muted-foreground w-20">Viewer</th>
                  </tr>
                </thead>
                <tbody>
                  {ACCESS_MATRIX.map(({ feature, admin, viewer }) => (
                    <tr key={feature} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{feature}</td>
                      <td className="px-4 py-2.5 text-center">
                        {admin
                          ? <CheckCircle2 size={14} className="mx-auto text-green-600 dark:text-green-400" />
                          : <XCircle size={14} className="mx-auto text-muted-foreground/40" />}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {viewer
                          ? <CheckCircle2 size={14} className="mx-auto text-green-600 dark:text-green-400" />
                          : <XCircle size={14} className="mx-auto text-red-500 dark:text-red-400" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground text-center mt-3">
              Demo:{" "}
              <span className="font-mono font-semibold text-foreground">admin / admin123</span>
              {" · "}
              <span className="font-mono font-semibold text-foreground">viewer / viewer123</span>
            </p>
          </div>
        </section>

        {/* ══ 8. CAD VALIDATION GUIDE ═════════════════════════════════════════ */}
        <section className="py-16 px-6 border-t border-border">
          <div className="max-w-4xl mx-auto">
            <SectionLabel>Panduan Pengisian CAD Alert Validasi</SectionLabel>
            <p className="text-sm text-muted-foreground text-center mb-8 max-w-2xl mx-auto">
              Panduan kategori validasi lapangan untuk TSO saat mengisi hasil kunjungan
              setelah toko muncul di CAD Alert.
            </p>

            {/* Category guide table */}
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/60 border-b border-border">
                    <th className="px-4 py-3 text-left font-semibold text-[11px] uppercase tracking-wider text-muted-foreground w-52">Kategori</th>
                    <th className="px-4 py-3 text-left font-semibold text-[11px] uppercase tracking-wider text-muted-foreground">Kapan Digunakan</th>
                    <th className="px-4 py-3 text-left font-semibold text-[11px] uppercase tracking-wider text-muted-foreground w-60">Contoh Catatan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[
                    {
                      k: "Kompetitor Eksternal",
                      color: "text-red-600 dark:text-red-400",
                      when: "Toko terbukti aktif membeli produk kompetitor (brand selain ELANG & BADAK) dalam 4 minggu terakhir, atau terpantau ada stok kompetitor di area display utama.",
                      ex: "\"Toko beli SEMEN BANTENG 80 zak 2 minggu lalu. Harga lebih murah Rp 3.000/zak.\"",
                    },
                    {
                      k: "Masalah Harga / Gap Harga Besar",
                      color: "text-yellow-600 dark:text-yellow-400",
                      when: "Toko mengeluhkan selisih harga >Rp 2.000/zak dengan kompetitor namun belum beralih brand. Gunakan jika harga adalah satu-satunya faktor keluhan.",
                      ex: "\"Pelanggan tanya kenapa Elang lebih mahal Rp 4.500/zak dari Banteng. Toko belum beralih.\"",
                    },
                    {
                      k: "Masalah Stok / Keterlambatan Kirim",
                      color: "text-orange-600 dark:text-orange-400",
                      when: "Toko mengalami kekosongan stok ELANG/BADAK minimal 3 hari, atau pengiriman distributor terlambat >2 hari dari jadwal rutin.",
                      ex: "\"Stok ELANG kosong 5 hari karena truk distributor breakdown. Sekarang sudah isi ulang.\"",
                    },
                    {
                      k: "Faktor Seasonal",
                      color: "text-blue-600 dark:text-blue-400",
                      when: "Penurunan volume terjadi bersamaan dengan musim hujan, bulan Ramadan, atau akhir tahun di mana seluruh area mengalami penurunan serupa. Cek dengan toko lain sekitar.",
                      ex: "\"Semua toko di kecamatan turun volume. Proyek konstruksi berhenti sementara karena hujan deras.\"",
                    },
                    {
                      k: "Faktor Internal Distributor",
                      color: "text-purple-600 dark:text-purple-400",
                      when: "Masalah berasal dari sisi distributor: konflik SO-toko, penghentian kredit, perubahan rute pengiriman, atau salesman baru yang belum kenal toko.",
                      ex: "\"Distributor stop kredit toko karena tunggakan 2 bulan. Hubungan sedang diperbaiki.\"",
                    },
                    {
                      k: "Kondisi Normal / False Alarm",
                      color: "text-green-600 dark:text-green-400",
                      when: "Kunjungan lapangan membuktikan toko tidak bermasalah: tidak ada kompetitor, stok cukup, tidak ada keluhan harga. Alert disebabkan fluktuasi data normal.",
                      ex: "\"Toko baik-baik saja. Proyek musiman selesai, volume akan naik bulan depan.\"",
                    },
                    {
                      k: "Butuh Investigasi Lanjut",
                      color: "text-gray-500 dark:text-gray-400",
                      when: "Situasi di lapangan tidak jelas atau toko tidak dapat ditemui. Perlukan kunjungan kedua atau eskalasi ke ASM.",
                      ex: "\"Toko tutup 3 hari berturut-turut, tidak ada info. Perlu cek kembali minggu depan.\"",
                    },
                  ].map(({ k, color, when, ex }) => (
                    <tr key={k} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 align-top">
                        <span className={`font-semibold text-[11px] ${color}`}>{k}</span>
                      </td>
                      <td className="px-4 py-3 align-top text-muted-foreground leading-relaxed">{when}</td>
                      <td className="px-4 py-3 align-top italic text-muted-foreground/80 leading-relaxed">{ex}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Writing tips */}
            <div className="mt-6 rounded-xl border border-border bg-muted/30 p-5 space-y-3">
              <p className="text-xs font-semibold text-foreground">Tips Penulisan Catatan Validasi</p>
              <ul className="space-y-1.5 text-xs text-muted-foreground list-none">
                {[
                  "Tulis dalam kalimat lengkap. Hindari singkatan yang ambigu (\"KB\" → tulis \"Kabupaten Boyolali\").",
                  "Sertakan angka konkret: volume, harga per zak, jumlah hari kosong, jumlah zak kompetitor.",
                  "Pisahkan fakta lapangan dari asumsi. Fakta: \"Toko beli 100 zak Banteng\". Asumsi: \"Sepertinya karena harga\".",
                  "Jika lebih dari satu kategori berlaku, pilih yang paling dominan sebagai Utama dan sisanya sebagai Sekunder.",
                  "Action items wajib berisi langkah konkret: siapa, apa, kapan. Bukan hanya \"akan ditindaklanjuti\".",
                ].map((tip, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-foreground font-medium shrink-0">{i + 1}.</span>
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ══ 10. TECH STACK ═══════════════════════════════════════════════════ */}
        <section className="py-16 px-6 border-t border-border">
          <div className="max-w-3xl mx-auto">
            <SectionLabel>Tech Stack</SectionLabel>
            <div className="flex flex-col gap-4">
              {[
                { category: "Backend",         items: ["Python 3.12", "FastAPI", "Uvicorn", "pandas", "PyArrow", "slowapi", "SQLAlchemy", "SQLite"] },
                { category: "ML & Optimasi",   items: ["scikit-learn", "XGBoost", "Isolation Forest", "PuLP CBC", "Prophet", "SHAP", "SMOTE"] },
                { category: "Frontend",        items: ["Next.js 14", "TypeScript", "Tailwind CSS", "shadcn/ui", "Recharts", "lucide-react", "HugeIcons"] },
                { category: "Data",            items: ["Parquet", "2,15 jt baris", "36 kolom", "21.014 toko unik"] },
              ].map(({ category, items }) => (
                <div key={category} className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
                  <span className="text-xs font-semibold text-muted-foreground sm:w-40 shrink-0 sm:pt-1 sm:text-right">
                    {category}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((item) => (
                      <span key={item} className="px-2.5 py-1 rounded-md text-xs font-medium bg-muted border border-border text-foreground">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-xl border border-border bg-muted/30 p-5">
              <p className="text-xs font-semibold text-foreground mb-1.5">Persistent Storage</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Data platform (loyalty members, program promo, CAD history, dan data ASPERSSI) disimpan
                di SQLite database pada Railway persistent volume, memastikan data tidak hilang saat
                redeploy. Setiap modul menggunakan feature flag{" "}
                <code className="px-1 py-0.5 rounded bg-muted font-mono text-[10px]">USE_SQLITE_STORAGE</code>{" "}
                untuk rollback aman jika diperlukan.
              </p>
            </div>
          </div>
        </section>

        {/* ══ 11. FOOTER ═══════════════════════════════════════════════════════ */}
        <section className="py-16 px-6 border-t border-border pb-24">
          <div className="max-w-sm mx-auto">
            <div className="rounded-2xl border border-border bg-card p-7 text-center space-y-5 shadow-sm">
              {/* Avatar */}
              <div className="w-14 h-14 rounded-2xl bg-foreground flex items-center justify-center mx-auto">
                <span className="text-background text-xl font-black">F</span>
              </div>

              <div>
                <p className="font-semibold text-base">Firmansyah Romadhoni</p>
                <p className="text-xs text-muted-foreground mt-0.5">Data Science &amp; Analytics Engineer</p>
                <p className="text-xs text-muted-foreground">Portfolio Project · 2026</p>
              </div>

              <div className="flex items-center justify-center gap-4">
                <a href="https://github.com/firmansyahr" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2">
                  GitHub <ExternalLink size={10} />
                </a>
                <span className="text-border text-xs">·</span>
                <a href="https://www.linkedin.com/in/firmansyahr/" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2">
                  LinkedIn <ExternalLink size={10} />
                </a>
              </div>
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}
