"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  ComposedChart, BarChart, PieChart, Pie, Bar, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, Cell,
} from "recharts";
import {
  ChevronRight, Plus, Upload, Download, Trash2, Users, Zap, TrendingUp,
  AlertCircle, Check, X, Search, BarChart2, FileDown, Trophy, RefreshCw,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const fmtRp  = (n: number) => "Rp " + new Intl.NumberFormat("id-ID").format(Math.round(n));
const fmtNum = (n: number) => new Intl.NumberFormat("id-ID").format(n);
const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const fmtDate = (d: string) => {
  if (!d) return "–";
  const [y, m, day] = d.split("-");
  const months = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  return `${day} ${months[+m - 1]} ${y}`;
};

// ── Types ────────────────────────────────────────────────────────────────────

interface Peserta {
  id_toko:       string;
  nama_toko:     string;
  cluster:       string;
  rate_override: number | null;
  target_ton:    number;
  catatan:       string;
}

interface KonfigurasiPromo {
  reward_rate:  { enabled: boolean; mode: string; flat_rate: number; per_cluster_rates: Record<string, number> };
  target_bonus: { enabled: boolean; threshold_pct: number; bonus_rate: number };
  cashback:     { enabled: boolean; cashback_pct: number };
}

interface PromoDetail {
  id:               string;
  nama_promo:       string;
  deskripsi:        string;
  jenis_promo:      string;
  tipe_program?:    string;
  status:           string;
  periode_mulai:    string;
  periode_selesai:  string;
  created_by:       string;
  created_at:       string;
  activated_at?:    string;
  completed_at?:    string;
  cancelled_at?:    string;
  alasan_batal?:    string;
  konfigurasi_promo?: KonfigurasiPromo;
  reward_config?:   Record<string, unknown>;
  peserta:          Peserta[];
  summary_peserta:  { total_toko: number; per_cluster: Record<string, number>; estimasi_budget_total: number };
  final_summary?:   { overall_achievement_pct: number; total_reward_earned: number; total_peserta: number; peserta_aktif_transaksi: number };
}

interface AchievementRow {
  id_toko:            string;
  nama_toko:          string;
  cluster:            string;
  target_ton:         number;
  realisasi_ton:      number;
  achievement_pct:    number;
  reward_rate_earned: number;
  bonus_earned:       number;
  cashback_earned:    number;
  total_reward:       number;
  status:             string;
}

interface MonitoringData {
  tipe_program:       "legacy";
  is_multi_tier?:     false;
  achievements:       AchievementRow[];
  summary:            {
    total_peserta: number; peserta_aktif_transaksi: number;
    total_target_ton: number; total_realisasi_ton: number;
    overall_achievement_pct: number; total_reward_earned: number;
    estimasi_budget_sisa: number; mencapai_target_count: number;
    belum_mencapai_count: number; melampaui_count: number;
    top_5_toko: AchievementRow[]; bottom_5_toko: AchievementRow[];
  };
  daily_trend:        { tanggal: string; realisasi_kumulatif: number; target_kumulatif: number; gap: number }[];
  distribution:       { label: string; count: number; color: string }[];
  cluster_comparison: { cluster: string; vol_promo: number; vol_before: number; delta: number; delta_pct: number }[];
  recommendations:    string[];
}

interface MultiTierBreakdown {
  segmen: string; volume_ton: number; multiplier: number; poin: number; keterangan: string;
}

interface MultiTierPesertaRow {
  id_toko:           string;
  nama_toko:         string;
  cluster:           string;
  target_ton:        number;
  realisasi_ton:     number;
  achievement_pct:   number;
  tier_berlaku:      string;
  multiplier_efektif: number;
  total_poin:        number;
  total_rupiah:      number;
  breakdown:         MultiTierBreakdown[];
}

interface MultiTierMonData {
  tipe_program:      "multi_tier";
  is_multi_tier:     true;
  program_id:        string;
  program_nama:      string;
  total_peserta:     number;
  total_poin:        number;
  total_rupiah:      number;
  tier_distribution: Record<string, number>;
  peserta_detail:    MultiTierPesertaRow[];
}

interface FlatMultiplierPesertaRow {
  id_toko:            string;
  nama_toko:          string;
  cluster:            string;
  brand_utama:        string;
  volume_ton:         number;
  multiplier_berlaku: number;
  total_poin:         number;
  total_rupiah:       number;
  keterangan:         string;
}

interface FlatMultiplierMonData {
  tipe_program:    "flat_multiplier";
  program_id:      string;
  program_nama:    string;
  multiplier:      number;
  brand_filter:    string[];
  total_peserta:   number;
  total_poin:      number;
  total_rupiah:    number;
  peserta_detail:  FlatMultiplierPesertaRow[];
}

interface LeaderboardStandingRow {
  id_toko:          string;
  nama_toko:        string;
  cluster:          string;
  brand_utama:      string;
  volume_periode:   number;
  jumlah_transaksi: number;
  score:            number;
  rank:             number;
  reward_label:     string;
  reward_poin:      number | null;
  reward_rupiah:    number;
  cluster_scope?:   string;
}

interface LeaderboardMonData {
  tipe_program:            "leaderboard";
  program_id:              string;
  program_nama:            string;
  basis_ranking:           string;
  scope:                   string;
  bentuk_reward:           string;
  minimum_transaksi:       number;
  total_peserta_eligible:  number;
  tidak_eligible:          number;
  total_reward_rupiah:     number;
  standings:               LeaderboardStandingRow[];
  grouped_standings:       Record<string, LeaderboardStandingRow[]> | null;
}

type AnyMonData = MonitoringData | MultiTierMonData | FlatMultiplierMonData | LeaderboardMonData;

// ── Badge components ──────────────────────────────────────────────────────────

const STATUS_META: Record<string, { bg: string; text: string; dot: string }> = {
  Draft:      { bg: "bg-gray-100",  text: "text-gray-700",  dot: "bg-gray-400"  },
  Aktif:      { bg: "bg-green-100", text: "text-green-700", dot: "bg-green-500" },
  Selesai:    { bg: "bg-blue-100",  text: "text-blue-700",  dot: "bg-blue-500"  },
  Dibatalkan: { bg: "bg-red-100",   text: "text-red-700",   dot: "bg-red-400"   },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.Draft;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium ${m.bg} ${m.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot} ${status === "Aktif" ? "animate-pulse" : ""}`} />
      {status}
    </span>
  );
}

const MON_STATUS_COLOR: Record<string, string> = {
  "Melampaui Target": "text-emerald-600 bg-emerald-50",
  "Mencapai Target":  "text-green-600 bg-green-50",
  "On Track":         "text-amber-600 bg-amber-50",
  "Belum Mencapai":   "text-red-600 bg-red-50",
};

function MonStatusBadge({ status }: { status: string }) {
  const cls = MON_STATUS_COLOR[status] ?? "text-gray-600 bg-gray-50";
  return <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium ${cls}`}>{status}</span>;
}

const TIER_BADGE_COLORS: string[] = [
  "bg-blue-100 text-blue-700",
  "bg-green-100 text-green-700",
  "bg-amber-100 text-amber-700",
  "bg-orange-100 text-orange-700",
  "bg-red-100 text-red-700",
];

function TierBadge({ tier }: { tier: string }) {
  if (tier === "Reguler") return <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">{tier}</span>;
  if (tier.toLowerCase().includes("overflow")) return <span className="inline-flex px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-100 text-indigo-700">{tier}</span>;
  const tierNum = parseInt(tier.replace(/\D/g, ""), 10) || 0;
  const cls = TIER_BADGE_COLORS[(tierNum - 1) % TIER_BADGE_COLORS.length] ?? TIER_BADGE_COLORS[0];
  return <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium ${cls}`}>{tier}</span>;
}

// ── Modal wrapper ─────────────────────────────────────────────────────────────

function Modal({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col z-10">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-semibold text-sm">{title}</h2>
          <button onClick={onClose}><X size={16} className="text-muted-foreground hover:text-foreground" /></button>
        </div>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// ── AddPromoMemberModal ───────────────────────────────────────────────────────

function AddPromoMemberModal({
  promoId, open, onClose, onAdded,
}: { promoId: string; open: boolean; onClose: () => void; onAdded: () => void }) {
  const [idToko,       setIdToko]       = useState("");
  const [targetTon,    setTargetTon]    = useState("");
  const [rateOverride, setRateOverride] = useState("");
  const [catatan,      setCatatan]      = useState("");
  const [saving,       setSaving]       = useState(false);
  const [err,          setErr]          = useState("");

  function reset() {
    setIdToko(""); setTargetTon(""); setRateOverride(""); setCatatan(""); setErr("");
  }

  async function handleAdd() {
    if (!idToko.trim()) { setErr("ID Toko wajib diisi"); return; }
    setSaving(true); setErr("");
    try {
      const r = await fetch(`${API}/api/promo/${promoId}/peserta/add-one`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_toko:       idToko.trim(),
          target_ton:    targetTon ? +targetTon : null,
          rate_override: rateOverride ? +rateOverride : null,
          catatan,
        }),
      });
      if (!r.ok) {
        const j = await r.json();
        setErr(j.detail || "Gagal menambah peserta");
        return;
      }
      reset();
      onAdded();
    } catch { setErr("Koneksi gagal"); }
    finally { setSaving(false); }
  }

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title="Tambah Peserta Promo">
      <div className="px-5 py-4 space-y-4">
        <div>
          <label className="block text-xs font-medium mb-1">ID Toko <span className="text-red-500">*</span></label>
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
            placeholder="Masukkan ID Toko..."
            value={idToko}
            onChange={e => setIdToko(e.target.value)}
          />
          <p className="text-[10px] text-muted-foreground mt-0.5">Nama toko dan cluster akan otomatis terisi dari data loyalty</p>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Target TON (opsional)</label>
          <input
            type="number"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
            placeholder="0"
            value={targetTon}
            onChange={e => setTargetTon(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Rate Override Rp/ton (opsional)</label>
          <input
            type="number"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
            placeholder="Kosongkan untuk pakai rate cluster"
            value={rateOverride}
            onChange={e => setRateOverride(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1">Catatan</label>
          <textarea
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none"
            rows={2}
            placeholder="Catatan opsional..."
            value={catatan}
            onChange={e => setCatatan(e.target.value)}
          />
        </div>
        {err && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
      </div>
      <div className="flex items-center justify-between px-5 py-4 border-t">
        <Button variant="outline" size="sm" onClick={() => { reset(); onClose(); }}>Batal</Button>
        <Button size="sm" className="bg-purple-600 hover:bg-purple-700" disabled={saving} onClick={handleAdd}>
          {saving ? "Menambahkan..." : "Tambah Peserta"}
        </Button>
      </div>
    </Modal>
  );
}

// ── UploadExcelModal ──────────────────────────────────────────────────────────

function UploadExcelModal({
  promoId, open, onClose, onUploaded,
}: { promoId: string; open: boolean; onClose: () => void; onUploaded: () => void }) {
  const [file,    setFile]    = useState<File | null>(null);
  const [result,  setResult]  = useState<{ berhasil: number; duplikat: number; errors: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err,     setErr]     = useState("");

  async function handleUpload() {
    if (!file) { setErr("Pilih file terlebih dahulu"); return; }
    setLoading(true); setErr(""); setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`${API}/api/promo/${promoId}/peserta/upload-excel`, {
        method: "POST", body: fd,
      });
      const j = await r.json();
      if (!r.ok) { setErr(j.detail || "Upload gagal"); return; }
      setResult(j.data);
      if (j.data.berhasil > 0) onUploaded();
    } catch { setErr("Koneksi gagal"); }
    finally { setLoading(false); }
  }

  return (
    <Modal open={open} onClose={() => { setFile(null); setResult(null); setErr(""); onClose(); }} title="Upload Peserta via Excel">
      <div className="px-5 py-4 space-y-4">
        <a
          href={`${API}/api/promo/template/peserta`}
          className="flex items-center gap-2 text-sm text-purple-600 hover:underline"
        >
          <Download size={14} />Download template Excel
        </a>

        <div
          className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-purple-400 transition-colors"
          onClick={() => document.getElementById("promo-excel-input")?.click()}
        >
          <Upload size={24} className="mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            {file ? file.name : "Klik atau drag & drop file .xlsx"}
          </p>
          <input
            id="promo-excel-input"
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={e => { setFile(e.target.files?.[0] ?? null); setResult(null); setErr(""); }}
          />
        </div>

        {result && (
          <div className="bg-gray-50 rounded-xl p-4 space-y-1.5 text-sm">
            <p className="text-green-600 font-medium">✓ {result.berhasil} peserta berhasil ditambahkan</p>
            {result.duplikat > 0 && <p className="text-amber-600">⚠ {result.duplikat} duplikat dilewati</p>}
            {result.errors.map((e, i) => <p key={i} className="text-red-600 text-xs">{e}</p>)}
          </div>
        )}
        {err && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
      </div>
      <div className="flex items-center justify-between px-5 py-4 border-t">
        <Button variant="outline" size="sm" onClick={onClose}>Tutup</Button>
        <Button size="sm" className="bg-purple-600 hover:bg-purple-700" disabled={!file || loading} onClick={handleUpload}>
          {loading ? "Mengupload..." : "Upload"}
        </Button>
      </div>
    </Modal>
  );
}

// ── Confirm overlay ───────────────────────────────────────────────────────────

function Confirm({
  message, onConfirm, onCancel, loading,
}: { message: string; onConfirm: () => void; onCancel: () => void; loading: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl p-6 w-80 z-10 space-y-4">
        <p className="text-sm font-medium">{message}</p>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel}>Batal</Button>
          <Button size="sm" className="bg-purple-600 hover:bg-purple-700" disabled={loading} onClick={onConfirm}>
            {loading ? "..." : "Lanjutkan"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Konfigurasi display ───────────────────────────────────────────────────────

function KonfigurasiSection({ cfg }: { cfg: KonfigurasiPromo }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {/* Reward Rate */}
      <div className={`rounded-xl border p-4 ${cfg.reward_rate.enabled ? "border-purple-200 bg-purple-50" : "opacity-50"}`}>
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-2 h-2 rounded-full ${cfg.reward_rate.enabled ? "bg-purple-500" : "bg-gray-400"}`} />
          <p className="text-sm font-semibold">Reward Rate</p>
        </div>
        {cfg.reward_rate.enabled ? (
          <div className="text-xs text-muted-foreground space-y-1">
            <p>Mode: <span className="text-foreground font-medium capitalize">{cfg.reward_rate.mode.replace("_"," ")}</span></p>
            {cfg.reward_rate.mode === "flat" ? (
              <p>Rate: <span className="text-foreground font-medium">Rp {fmtNum(cfg.reward_rate.flat_rate)}/ton</span></p>
            ) : (
              Object.entries(cfg.reward_rate.per_cluster_rates).map(([cl, r]) => (
                <p key={cl}>{cl}: <span className="text-foreground font-medium">Rp {fmtNum(r)}/ton</span></p>
              ))
            )}
          </div>
        ) : <p className="text-xs text-muted-foreground">Tidak aktif</p>}
      </div>

      {/* Target Bonus */}
      <div className={`rounded-xl border p-4 ${cfg.target_bonus.enabled ? "border-amber-200 bg-amber-50" : "opacity-50"}`}>
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-2 h-2 rounded-full ${cfg.target_bonus.enabled ? "bg-amber-500" : "bg-gray-400"}`} />
          <p className="text-sm font-semibold">Target Bonus</p>
        </div>
        {cfg.target_bonus.enabled ? (
          <div className="text-xs text-muted-foreground space-y-1">
            <p>Threshold: <span className="text-foreground font-medium">{cfg.target_bonus.threshold_pct}%</span></p>
            <p>Bonus: <span className="text-foreground font-medium">Rp {fmtNum(cfg.target_bonus.bonus_rate)}/ton</span></p>
          </div>
        ) : <p className="text-xs text-muted-foreground">Tidak aktif</p>}
      </div>

      {/* Cashback */}
      <div className={`rounded-xl border p-4 ${cfg.cashback.enabled ? "border-sky-200 bg-sky-50" : "opacity-50"}`}>
        <div className="flex items-center gap-2 mb-2">
          <div className={`w-2 h-2 rounded-full ${cfg.cashback.enabled ? "bg-sky-500" : "bg-gray-400"}`} />
          <p className="text-sm font-semibold">Cashback</p>
        </div>
        {cfg.cashback.enabled ? (
          <p className="text-xs text-muted-foreground">
            Rate: <span className="text-foreground font-medium">{cfg.cashback.cashback_pct}% dari nilai transaksi</span>
          </p>
        ) : <p className="text-xs text-muted-foreground">Tidak aktif</p>}
      </div>
    </div>
  );
}

// ── Multi-tier Monitoring View ────────────────────────────────────────────────

const TIER_PIE_COLORS = ["#9ca3af","#3b82f6","#22c55e","#f59e0b","#f97316","#ef4444","#6366f1"];

function MultiTierMonitoringView({ data }: { data: MultiTierMonData }) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const tierEntries = Object.entries(data.tier_distribution);
  const pieData = tierEntries.map(([name, count], i) => ({
    name, value: count, fill: TIER_PIE_COLORS[i % TIER_PIE_COLORS.length],
  }));

  const highestTierReached = tierEntries
    .filter(([name]) => name !== "Reguler" && !name.toLowerCase().includes("overflow"))
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Reguler";

  const sorted = [...data.peserta_detail].sort((a, b) => b.achievement_pct - a.achievement_pct);

  return (
    <div className="space-y-5">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Total Peserta",       value: fmtNum(data.total_peserta),  sub: "terdaftar",         color: "#3b82f6" },
          { label: "Total Poin",          value: fmtNum(data.total_poin),     sub: "akumulasi poin",    color: "#16a34a" },
          { label: "Total Estimasi Rp",   value: fmtRp(data.total_rupiah),    sub: "estimasi reward",   color: "#7c3aed" },
          { label: "Tier Tertinggi",      value: highestTierReached.split("(")[0].trim(), sub: "dicapai peserta", color: "#D97706" },
        ].map(c => (
          <Card key={c.label} className="shadow-sm" style={{ borderBottom: `3px solid ${c.color}` }}>
            <CardContent className="p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">{c.label}</p>
              <p className="text-base font-bold tabular-nums truncate" style={{ color: c.color }}>{c.value}</p>
              <p className="text-[10px] text-muted-foreground">{c.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tier distribution donut */}
      {pieData.length > 0 && (
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Distribusi Tier</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-6">
              <div style={{ width: 160, height: 160 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" innerRadius={45} outerRadius={70} paddingAngle={2}>
                      {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Pie>
                    <Tooltip formatter={(v: unknown, name: unknown) => [`${v} toko`, String(name ?? "")]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-1.5">
                {pieData.map((d, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: d.fill }} />
                      <span className="truncate max-w-[160px]">{d.name}</span>
                    </div>
                    <span className="font-semibold ml-2">{d.value} toko</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Achievement table */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Achievement per Toko</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Toko</TableHead>
                  <TableHead className="text-xs text-right">Target</TableHead>
                  <TableHead className="text-xs text-right">Realisasi</TableHead>
                  <TableHead className="text-xs text-right">Achievement</TableHead>
                  <TableHead className="text-xs">Tier Berlaku</TableHead>
                  <TableHead className="text-xs text-right">Total Poin</TableHead>
                  <TableHead className="text-xs text-right">Estimasi Rp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.slice(0, 50).map(a => (
                  <>
                    <TableRow
                      key={a.id_toko}
                      className="cursor-pointer hover:bg-gray-50/70"
                      onClick={() => setExpandedRow(expandedRow === a.id_toko ? null : a.id_toko)}
                    >
                      <TableCell>
                        <p className="text-sm font-medium">{a.nama_toko}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{a.id_toko}</p>
                        <div className="w-full bg-gray-200 rounded-full h-1 mt-1.5">
                          <div
                            className={`h-1 rounded-full ${a.achievement_pct >= 100 ? "bg-green-500" : a.achievement_pct >= 80 ? "bg-amber-500" : "bg-red-400"}`}
                            style={{ width: `${Math.min(100, a.achievement_pct)}%` }}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm">{fmtNum(a.target_ton)}</TableCell>
                      <TableCell className="text-right text-sm font-medium">{fmtNum(a.realisasi_ton)}</TableCell>
                      <TableCell className="text-right">
                        <span className={`text-sm font-semibold ${a.achievement_pct >= 100 ? "text-green-600" : a.achievement_pct >= 80 ? "text-amber-600" : "text-red-600"}`}>
                          {fmtPct(a.achievement_pct)}
                        </span>
                      </TableCell>
                      <TableCell><TierBadge tier={a.tier_berlaku} /></TableCell>
                      <TableCell className="text-right text-sm">{fmtNum(a.total_poin)}</TableCell>
                      <TableCell className="text-right text-sm font-medium text-purple-700">{fmtRp(a.total_rupiah)}</TableCell>
                    </TableRow>
                    {expandedRow === a.id_toko && (
                      <TableRow key={`${a.id_toko}-expanded`}>
                        <TableCell colSpan={7} className="bg-purple-50/40 p-4">
                          <p className="text-xs font-semibold mb-2">Rincian Breakdown</p>
                          <div className="space-y-1">
                            {a.breakdown.map((b, i) => (
                              <div key={i} className="flex items-start justify-between text-xs py-1 border-b last:border-b-0">
                                <div>
                                  <span className="font-medium">{b.segmen}</span>
                                  <span className="text-muted-foreground ml-2">{b.keterangan}</span>
                                </div>
                                <div className="text-right">
                                  <span className="font-medium">{fmtNum(b.volume_ton)} ton &times; {b.multiplier}X</span>
                                  <span className="text-purple-600 ml-3">{fmtNum(b.poin)} poin</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
            {data.peserta_detail.length > 50 && (
              <p className="text-xs text-muted-foreground text-center py-2">
                Menampilkan 50 dari {data.peserta_detail.length} toko.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Legacy Monitoring View (old konfigurasi_promo programs) ───────────────────

function LegacyMonitoringView({
  monitoring, monSortBy, monOrder, setMonSortBy, setMonOrder, setMonLoaded,
}: {
  monitoring: MonitoringData;
  monSortBy: string; monOrder: string;
  setMonSortBy: (v: string) => void;
  setMonOrder:  (v: string) => void;
  setMonLoaded: (v: boolean) => void;
}) {
  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: "Total Peserta",    value: fmtNum(monitoring.summary.total_peserta),           sub: "terdaftar",         color: "#3b82f6" },
          { label: "Bertransaksi",      value: fmtNum(monitoring.summary.peserta_aktif_transaksi), sub: "aktif transaksi",   color: "#16a34a" },
          { label: "Overall Ach.",      value: fmtPct(monitoring.summary.overall_achievement_pct), sub: "realisasi/target",  color: monitoring.summary.overall_achievement_pct >= 100 ? "#16a34a" : monitoring.summary.overall_achievement_pct >= 80 ? "#D97706" : "#DC2626" },
          { label: "Reward Earned",     value: fmtRp(monitoring.summary.total_reward_earned),     sub: "total reward",      color: "#7c3aed" },
          { label: "Budget Sisa",       value: fmtRp(monitoring.summary.estimasi_budget_sisa),    sub: "sisa anggaran",     color: "#EA580C" },
        ].map(c => (
          <Card key={c.label} className="shadow-sm" style={{ borderBottom: `3px solid ${c.color}` }}>
            <CardContent className="p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">{c.label}</p>
              <p className="text-lg font-bold tabular-nums" style={{ color: c.color }}>{c.value}</p>
              <p className="text-[10px] text-muted-foreground">{c.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-4 flex-wrap text-sm">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" />{monitoring.summary.melampaui_count} Melampaui Target</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500" />{monitoring.summary.mencapai_target_count} Mencapai Target</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400" />{monitoring.summary.belum_mencapai_count} Belum Mencapai</span>
      </div>

      {monitoring.daily_trend.length > 0 && (
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Tren Kumulatif Realisasi vs Target</CardTitle>
          </CardHeader>
          <CardContent>
            <div style={{ height: 240 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monitoring.daily_trend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="tanggal" tick={{ fontSize: 10 }}
                    tickFormatter={v => { const [,m,d] = v.split("-"); return `${d}/${m}`; }}
                    interval={Math.floor(monitoring.daily_trend.length / 6)}
                  />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                  <Tooltip
                    formatter={(v: unknown, name: unknown) => [`${Number(v).toFixed(1)} ton`, String(name ?? "")]}
                    labelFormatter={(l: unknown) => fmtDate(String(l ?? ""))}
                  />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="realisasi_kumulatif" name="Realisasi" fill="#ddd6fe" stroke="#7c3aed" strokeWidth={2} />
                  <Line type="monotone" dataKey="target_kumulatif" name="Target" stroke="#f97316" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {monitoring.distribution.length > 0 && (
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Distribusi Achievement</CardTitle>
          </CardHeader>
          <CardContent>
            <div style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monitoring.distribution} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip formatter={(v: unknown) => [String(v), "Toko"]} />
                  <Bar dataKey="count" name="Jumlah Toko" radius={[4,4,0,0]}>
                    {monitoring.distribution.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm font-semibold">Achievement per Toko</CardTitle>
            <div className="flex items-center gap-2">
              <select className="border rounded px-2 py-1 text-xs" value={monSortBy} onChange={e => { setMonSortBy(e.target.value); setMonLoaded(false); }}>
                <option value="achievement">Sort: Achievement</option>
                <option value="realisasi">Sort: Realisasi</option>
                <option value="reward">Sort: Reward</option>
              </select>
              <select className="border rounded px-2 py-1 text-xs" value={monOrder} onChange={e => { setMonOrder(e.target.value); setMonLoaded(false); }}>
                <option value="desc">Turun</option>
                <option value="asc">Naik</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Toko</TableHead>
                  <TableHead className="text-xs">Cluster</TableHead>
                  <TableHead className="text-xs text-right">Target</TableHead>
                  <TableHead className="text-xs text-right">Realisasi</TableHead>
                  <TableHead className="text-xs text-right">Achievement</TableHead>
                  <TableHead className="text-xs text-right">Total Reward</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monitoring.achievements.slice(0, 50).map(a => (
                  <TableRow key={a.id_toko}>
                    <TableCell>
                      <p className="text-sm font-medium">{a.nama_toko}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{a.id_toko}</p>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{a.cluster}</TableCell>
                    <TableCell className="text-right text-sm">{fmtNum(a.target_ton)}</TableCell>
                    <TableCell className="text-right text-sm font-medium">{fmtNum(a.realisasi_ton)}</TableCell>
                    <TableCell className="text-right">
                      <span className={`text-sm font-semibold ${a.achievement_pct >= 100 ? "text-green-600" : a.achievement_pct >= 80 ? "text-amber-600" : "text-red-600"}`}>
                        {fmtPct(a.achievement_pct)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-sm">{fmtRp(a.total_reward)}</TableCell>
                    <TableCell><MonStatusBadge status={a.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {monitoring.achievements.length > 50 && (
              <p className="text-xs text-muted-foreground text-center py-2">
                Menampilkan 50 dari {monitoring.achievements.length} toko. Export untuk data lengkap.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Flat Multiplier Monitoring View ──────────────────────────────────────────

function FlatMultiplierMonitoringView({ data }: { data: FlatMultiplierMonData }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Total Peserta",      value: fmtNum(data.total_peserta), sub: "terdaftar",        color: "#3b82f6" },
          { label: "Multiplier",         value: `${data.multiplier}×`,      sub: "flat reward",      color: "#2563eb" },
          { label: "Total Poin",         value: fmtNum(data.total_poin),    sub: "akumulasi poin",   color: "#16a34a" },
          { label: "Estimasi Reward",    value: fmtRp(data.total_rupiah),   sub: "total reward",     color: "#7c3aed" },
        ].map(c => (
          <Card key={c.label} className="shadow-sm" style={{ borderBottom: `3px solid ${c.color}` }}>
            <CardContent className="p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">{c.label}</p>
              <p className="text-base font-bold tabular-nums truncate" style={{ color: c.color }}>{c.value}</p>
              <p className="text-[10px] text-muted-foreground">{c.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {data.brand_filter.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-900">
          <span className="font-semibold">Brand filter: </span>
          {data.brand_filter.join(", ")} — toko dengan brand lain mendapat 1× (tidak berlipat)
        </div>
      )}

      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Volume & Reward per Toko</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Toko</TableHead>
                  <TableHead className="text-xs">Cluster</TableHead>
                  <TableHead className="text-xs">Brand</TableHead>
                  <TableHead className="text-xs text-right">Volume (ton)</TableHead>
                  <TableHead className="text-xs text-right">Multiplier</TableHead>
                  <TableHead className="text-xs text-right">Total Poin</TableHead>
                  <TableHead className="text-xs text-right">Estimasi Rp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...data.peserta_detail].sort((a, b) => b.total_poin - a.total_poin).slice(0, 50).map(p => (
                  <TableRow key={p.id_toko}>
                    <TableCell>
                      <p className="text-sm font-medium">{p.nama_toko}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{p.id_toko}</p>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{p.cluster}</TableCell>
                    <TableCell className="text-xs">{p.brand_utama}</TableCell>
                    <TableCell className="text-right text-sm">{fmtNum(p.volume_ton)}</TableCell>
                    <TableCell className="text-right">
                      <span className={`text-sm font-semibold ${p.multiplier_berlaku > 1 ? "text-blue-600" : "text-gray-500"}`}>{p.multiplier_berlaku}×</span>
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium">{fmtNum(p.total_poin)}</TableCell>
                    <TableCell className="text-right text-sm font-medium text-purple-700">{fmtRp(p.total_rupiah)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data.peserta_detail.length > 50 && (
              <p className="text-xs text-muted-foreground text-center py-2">
                Menampilkan 50 dari {data.peserta_detail.length} toko.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Leaderboard View ─────────────────────────────────────────────────────────

function LeaderboardView({ data, onRefresh }: { data: LeaderboardMonData; onRefresh: () => void }) {
  const [activeCluster, setActiveCluster] = useState<string>("all");

  const clusters = data.grouped_standings ? Object.keys(data.grouped_standings) : [];
  const displayStandings = (
    data.scope === "per_cluster" && data.grouped_standings && activeCluster !== "all"
      ? data.grouped_standings[activeCluster] ?? []
      : data.standings
  ).slice(0, 100);

  const top3 = displayStandings.slice(0, 3);

  const podiumColors = [
    { bg: "bg-amber-50 border-amber-300", text: "text-amber-700", badge: "bg-amber-400", icon: "🥇" },
    { bg: "bg-gray-100 border-gray-300",  text: "text-gray-600",  badge: "bg-gray-400",  icon: "🥈" },
    { bg: "bg-orange-50 border-orange-300", text: "text-orange-700", badge: "bg-orange-400", icon: "🥉" },
  ];

  const scoreLabel = data.basis_ranking === "volume" ? "ton" : "%";

  return (
    <div className="space-y-5">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Peserta Eligible",   value: fmtNum(data.total_peserta_eligible), sub: `min. ${data.minimum_transaksi}x transaksi`, color: "#16a34a" },
          { label: "Tidak Eligible",     value: fmtNum(data.tidak_eligible),          sub: "kurang transaksi",                          color: "#DC2626" },
          { label: "Total Reward",       value: fmtRp(data.total_reward_rupiah),      sub: "estimasi hadiah",                           color: "#7c3aed" },
          { label: "Basis Ranking",      value: data.basis_ranking === "volume" ? "Volume" : "Growth %", sub: data.scope === "global" ? "kompetisi global" : "per cluster", color: "#D97706" },
        ].map(c => (
          <Card key={c.label} className="shadow-sm" style={{ borderBottom: `3px solid ${c.color}` }}>
            <CardContent className="p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">{c.label}</p>
              <p className="text-base font-bold tabular-nums truncate" style={{ color: c.color }}>{c.value}</p>
              <p className="text-[10px] text-muted-foreground">{c.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Cluster tabs (if per_cluster) */}
      {data.scope === "per_cluster" && clusters.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setActiveCluster("all")}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${activeCluster === "all" ? "bg-amber-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            Semua Cluster
          </button>
          {clusters.map(cl => (
            <button key={cl} onClick={() => setActiveCluster(cl)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${activeCluster === cl ? "bg-amber-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
              {cl}
            </button>
          ))}
        </div>
      )}

      {/* Podium */}
      {top3.length > 0 && (
        <Card className="shadow-sm">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              <Trophy size={14} className="text-amber-500" />
              Podium {activeCluster !== "all" ? `— ${activeCluster}` : ""}
            </CardTitle>
            <button onClick={onRefresh} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
              <RefreshCw size={12} />Refresh
            </button>
          </CardHeader>
          <CardContent>
            <div className="flex items-end justify-center gap-4">
              {/* Silver (rank 2) — left */}
              {top3[1] && (
                <div className={`flex-1 border-2 rounded-xl p-4 text-center ${podiumColors[1].bg}`}>
                  <div className="text-2xl mb-1">{podiumColors[1].icon}</div>
                  <p className="text-xs font-bold text-gray-500 mb-1">Rank #2</p>
                  <p className="text-sm font-semibold truncate">{top3[1].nama_toko}</p>
                  <p className="text-xs text-muted-foreground">{top3[1].cluster}</p>
                  <p className="text-sm font-bold mt-2">{fmtNum(top3[1].score)} {scoreLabel}</p>
                  <p className="text-xs text-amber-700 font-medium mt-1">{top3[1].reward_label}</p>
                  <p className="text-xs text-purple-700">{fmtRp(top3[1].reward_rupiah)}</p>
                </div>
              )}
              {/* Gold (rank 1) — center, taller */}
              {top3[0] && (
                <div className={`flex-1 border-2 rounded-xl p-4 text-center scale-105 shadow-md ${podiumColors[0].bg}`}>
                  <div className="text-3xl mb-1">{podiumColors[0].icon}</div>
                  <p className="text-xs font-bold text-amber-600 mb-1">Rank #1</p>
                  <p className="text-sm font-bold truncate">{top3[0].nama_toko}</p>
                  <p className="text-xs text-muted-foreground">{top3[0].cluster}</p>
                  <p className="text-base font-bold mt-2">{fmtNum(top3[0].score)} {scoreLabel}</p>
                  <p className="text-xs text-amber-700 font-semibold mt-1">{top3[0].reward_label}</p>
                  <p className="text-sm font-bold text-purple-700">{fmtRp(top3[0].reward_rupiah)}</p>
                </div>
              )}
              {/* Bronze (rank 3) — right */}
              {top3[2] && (
                <div className={`flex-1 border-2 rounded-xl p-4 text-center ${podiumColors[2].bg}`}>
                  <div className="text-2xl mb-1">{podiumColors[2].icon}</div>
                  <p className="text-xs font-bold text-orange-500 mb-1">Rank #3</p>
                  <p className="text-sm font-semibold truncate">{top3[2].nama_toko}</p>
                  <p className="text-xs text-muted-foreground">{top3[2].cluster}</p>
                  <p className="text-sm font-bold mt-2">{fmtNum(top3[2].score)} {scoreLabel}</p>
                  <p className="text-xs text-orange-700 font-medium mt-1">{top3[2].reward_label}</p>
                  <p className="text-xs text-purple-700">{fmtRp(top3[2].reward_rupiah)}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Full standings table */}
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Klasemen Lengkap</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs w-12">Rank</TableHead>
                  <TableHead className="text-xs">Toko</TableHead>
                  {data.scope === "per_cluster" && activeCluster === "all" && <TableHead className="text-xs">Cluster</TableHead>}
                  <TableHead className="text-xs text-right">{data.basis_ranking === "volume" ? "Volume (ton)" : "Growth (%)"}</TableHead>
                  <TableHead className="text-xs text-right">Transaksi</TableHead>
                  <TableHead className="text-xs">Reward</TableHead>
                  <TableHead className="text-xs text-right">Nilai Reward</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayStandings.map(s => (
                  <TableRow key={`${s.id_toko}-${s.rank}`} className={s.rank <= 3 ? "bg-amber-50/40" : ""}>
                    <TableCell>
                      <span className={`text-sm font-bold ${s.rank === 1 ? "text-amber-600" : s.rank === 2 ? "text-gray-500" : s.rank === 3 ? "text-orange-600" : "text-muted-foreground"}`}>
                        #{s.rank}
                      </span>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm font-medium">{s.nama_toko}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{s.id_toko}</p>
                    </TableCell>
                    {data.scope === "per_cluster" && activeCluster === "all" && (
                      <TableCell className="text-xs text-muted-foreground">{s.cluster}</TableCell>
                    )}
                    <TableCell className="text-right text-sm font-semibold">{fmtNum(s.score)}</TableCell>
                    <TableCell className="text-right text-sm">{fmtNum(s.jumlah_transaksi)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{s.reward_label}</TableCell>
                    <TableCell className="text-right text-sm font-medium text-purple-700">
                      {s.reward_rupiah > 0 ? fmtRp(s.reward_rupiah) : "–"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {data.standings.length > 100 && (
              <p className="text-xs text-muted-foreground text-center py-2">
                Menampilkan 100 dari {data.standings.length} toko.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {data.tidak_eligible > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800">
          <span className="font-semibold">{data.tidak_eligible} toko tidak eligible</span> karena jumlah transaksi kurang dari {data.minimum_transaksi}x selama periode program.
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PromoDetailPage() {
  const params  = useParams();
  const router  = useRouter();
  const promoId = params.id as string;

  const [promo,              setPromo]              = useState<PromoDetail | null>(null);
  const [monitoring,         setMonitoring]         = useState<AnyMonData | null>(null);
  const [promoLoading,       setPromoLoading]       = useState(true);
  const [monLoading,         setMonLoading]         = useState(false);
  const [monLoaded,          setMonLoaded]          = useState(false);
  const [activeTab,          setActiveTab]          = useState("detail");
  const [showAddMember,      setShowAddMember]      = useState(false);
  const [showUpload,         setShowUpload]         = useState(false);
  const [confirm,            setConfirm]            = useState<null | { msg: string; action: () => Promise<void> }>(null);
  const [confirmLoading,     setConfirmLoading]     = useState(false);
  const [pesertaSearch,      setPesertaSearch]      = useState("");
  const [monSortBy,          setMonSortBy]          = useState("achievement");
  const [monOrder,           setMonOrder]           = useState("desc");
  const [actionLoading,      setActionLoading]      = useState(false);

  const fetchPromo = useCallback(async () => {
    setPromoLoading(true);
    try {
      const r = await fetch(`${API}/api/promo/${promoId}`);
      if (!r.ok) { router.push("/loyalty/promo"); return; }
      const j = await r.json();
      setPromo(j.data);
    } catch { /* ignore */ } finally { setPromoLoading(false); }
  }, [promoId, router]);

  const fetchMonitoring = useCallback(async () => {
    setMonLoading(true);
    try {
      const r = await fetch(`${API}/api/promo/${promoId}/monitoring?sort_by=${monSortBy}&order=${monOrder}`);
      if (!r.ok) return;
      const j = await r.json();
      setMonitoring(j.data);
      setMonLoaded(true);
    } catch { /* ignore */ } finally { setMonLoading(false); }
  }, [promoId, monSortBy, monOrder]);

  useEffect(() => { fetchPromo(); }, [fetchPromo]);

  useEffect(() => {
    if (activeTab === "monitoring" && promo && promo.status !== "Draft") {
      fetchMonitoring();
    }
    if (activeTab === "analisis" && promo && promo.status === "Selesai" && !monLoaded) {
      fetchMonitoring();
    }
  }, [activeTab, promo, fetchMonitoring, monLoaded]);

  const filteredPeserta = useMemo(() => {
    if (!promo) return [];
    const q = pesertaSearch.toLowerCase();
    if (!q) return promo.peserta;
    return promo.peserta.filter(p =>
      p.id_toko.toLowerCase().includes(q) ||
      p.nama_toko.toLowerCase().includes(q) ||
      p.cluster.toLowerCase().includes(q)
    );
  }, [promo, pesertaSearch]);

  async function runAction(action: () => Promise<void>, msg: string) {
    setConfirm({ msg, action });
  }

  async function execConfirm() {
    if (!confirm) return;
    setConfirmLoading(true);
    try { await confirm.action(); await fetchPromo(); setMonLoaded(false); }
    catch { /* ignore */ }
    finally { setConfirmLoading(false); setConfirm(null); }
  }

  async function handleActivate() {
    await runAction(async () => {
      const r = await fetch(`${API}/api/promo/${promoId}/activate`, { method: "POST" });
      if (!r.ok) { const j = await r.json(); throw new Error(j.detail); }
    }, "Aktifkan promo ini? Pastikan peserta sudah disiapkan.");
  }

  async function handleComplete() {
    await runAction(async () => {
      const r = await fetch(`${API}/api/promo/${promoId}/complete`, { method: "POST" });
      if (!r.ok) { const j = await r.json(); throw new Error(j.detail); }
    }, "Selesaikan promo ini? Achievement final akan dihitung dari data transaksi.");
  }

  async function handleCancel() {
    await runAction(async () => {
      const r = await fetch(`${API}/api/promo/${promoId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alasan: "" }),
      });
      if (!r.ok) { const j = await r.json(); throw new Error(j.detail); }
    }, "Batalkan promo ini? Tindakan ini tidak bisa diurungkan.");
  }

  async function handleRemovePeserta(idToko: string) {
    setActionLoading(true);
    try {
      const r = await fetch(`${API}/api/promo/${promoId}/peserta/${idToko}`, { method: "DELETE" });
      if (r.ok) await fetchPromo();
    } catch { /* ignore */ } finally { setActionLoading(false); }
  }

  if (promoLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="pt-16 max-w-7xl mx-auto px-6 py-8 space-y-4">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-12 w-72" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </main>
      </div>
    );
  }

  if (!promo) return null;

  const isDraft    = promo.status === "Draft";
  const isAktif    = promo.status === "Aktif";
  const isSelesai  = promo.status === "Selesai";
  const hasMon     = isAktif || isSelesai;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      {confirm && (
        <Confirm
          message={confirm.msg}
          onConfirm={execConfirm}
          onCancel={() => setConfirm(null)}
          loading={confirmLoading}
        />
      )}
      {showAddMember && (
        <AddPromoMemberModal
          promoId={promoId}
          open={showAddMember}
          onClose={() => setShowAddMember(false)}
          onAdded={() => { setShowAddMember(false); fetchPromo(); }}
        />
      )}
      {showUpload && (
        <UploadExcelModal
          promoId={promoId}
          open={showUpload}
          onClose={() => setShowUpload(false)}
          onUploaded={() => fetchPromo()}
        />
      )}

      <main className="pt-16 max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link href="/loyalty" className="hover:text-foreground">Loyalty</Link>
          <ChevronRight size={12} />
          <Link href="/loyalty/promo" className="hover:text-foreground">Pengelolaan Promo</Link>
          <ChevronRight size={12} />
          <span className="text-foreground font-medium truncate max-w-xs">{promo.nama_promo}</span>
        </nav>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">{promo.nama_promo}</h1>
              <StatusBadge status={promo.status} />
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {promo.id} · {fmtDate(promo.periode_mulai)} – {fmtDate(promo.periode_selesai)}
              {promo.deskripsi && ` · ${promo.deskripsi}`}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isDraft && (
              <>
                <Button variant="outline" size="sm" className="text-red-600 border-red-300 hover:bg-red-50" onClick={handleCancel}>Batalkan</Button>
                <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={handleActivate}>Aktifkan</Button>
              </>
            )}
            {isAktif && (
              <>
                <Button variant="outline" size="sm" className="text-red-600 border-red-300 hover:bg-red-50" onClick={handleCancel}>Batalkan</Button>
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={handleComplete}>Selesaikan</Button>
              </>
            )}
            {isSelesai && (
              <a href={`${API}/api/promo/${promoId}/monitoring/export`} target="_blank">
                <Button size="sm" className="bg-purple-600 hover:bg-purple-700 gap-1.5">
                  <FileDown size={14} />Export Laporan
                </Button>
              </a>
            )}
            {isAktif && (
              <a href={`${API}/api/promo/${promoId}/monitoring/export`} target="_blank">
                <Button variant="outline" size="sm" className="gap-1.5">
                  <FileDown size={14} />Export
                </Button>
              </a>
            )}
          </div>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-gray-50 rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Total Peserta</p>
            <p className="text-xl font-bold">{fmtNum(promo.summary_peserta.total_toko)}</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Est. Budget</p>
            <p className="text-lg font-bold">{fmtRp(promo.summary_peserta.estimasi_budget_total)}</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Durasi</p>
            <p className="text-xl font-bold">
              {Math.round((new Date(promo.periode_selesai).getTime() - new Date(promo.periode_mulai).getTime()) / 86400000) + 1} hari
            </p>
          </div>
          <div className="bg-gray-50 rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Achievement</p>
            <p className={`text-xl font-bold ${isSelesai && promo.final_summary ? (promo.final_summary.overall_achievement_pct >= 100 ? "text-green-600" : promo.final_summary.overall_achievement_pct >= 80 ? "text-amber-600" : "text-red-600") : "text-muted-foreground"}`}>
              {isSelesai && promo.final_summary ? `${promo.final_summary.overall_achievement_pct.toFixed(1)}%` : isAktif ? "Live" : "–"}
            </p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent mb-6">
            <TabsTrigger value="detail">Detail Promo</TabsTrigger>
            <TabsTrigger value="monitoring">Monitoring</TabsTrigger>
            <TabsTrigger value="analisis">Analisis</TabsTrigger>
          </TabsList>

          {/* ── Tab: Detail ── */}
          <TabsContent value="detail" className="space-y-5 mt-4">
            {/* Konfigurasi */}
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Konfigurasi Promo</CardTitle>
              </CardHeader>
              <CardContent>
                {promo.konfigurasi_promo ? (
                  <KonfigurasiSection cfg={promo.konfigurasi_promo} />
                ) : promo.reward_config ? (
                  <div className="bg-gray-50 rounded-xl p-4">
                    <pre className="text-xs text-gray-700 whitespace-pre-wrap overflow-auto max-h-48">
                      {JSON.stringify(promo.reward_config, null, 2)}
                    </pre>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Konfigurasi tidak tersedia</p>
                )}
              </CardContent>
            </Card>

            {/* Peserta */}
            <Card className="shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">
                    Daftar Peserta ({fmtNum(promo.peserta.length)} toko)
                  </CardTitle>
                  {isDraft && (
                    <div className="flex gap-2">
                      <a href={`${API}/api/promo/template/peserta`} target="_blank">
                        <Button variant="outline" size="sm" className="gap-1 h-8 text-xs">
                          <Download size={12} />Template
                        </Button>
                      </a>
                      <Button variant="outline" size="sm" className="gap-1 h-8 text-xs" onClick={() => setShowUpload(true)}>
                        <Upload size={12} />Upload Excel
                      </Button>
                      <Button size="sm" className="gap-1 h-8 text-xs bg-purple-600 hover:bg-purple-700" onClick={() => setShowAddMember(true)}>
                        <Plus size={12} />Tambah Toko
                      </Button>
                    </div>
                  )}
                </div>
                <div className="relative mt-2 max-w-xs">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    className="w-full border rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-400"
                    placeholder="Cari toko..."
                    value={pesertaSearch}
                    onChange={e => setPesertaSearch(e.target.value)}
                  />
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">ID Toko</TableHead>
                        <TableHead className="text-xs">Nama Toko</TableHead>
                        <TableHead className="text-xs">Cluster</TableHead>
                        <TableHead className="text-xs text-right">Target TON</TableHead>
                        <TableHead className="text-xs text-right">Rate Override</TableHead>
                        <TableHead className="text-xs">Catatan</TableHead>
                        {isDraft && <TableHead className="text-xs w-12" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredPeserta.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={isDraft ? 7 : 6} className="text-center text-muted-foreground py-8 text-sm">
                            {pesertaSearch ? "Tidak ditemukan" : "Belum ada peserta. Tambahkan toko."}
                          </TableCell>
                        </TableRow>
                      ) : filteredPeserta.map(p => (
                        <TableRow key={p.id_toko} className="group">
                          <TableCell className="text-xs font-mono">{p.id_toko}</TableCell>
                          <TableCell className="text-sm">{p.nama_toko}</TableCell>
                          <TableCell>
                            <span className="text-xs text-muted-foreground">{p.cluster}</span>
                          </TableCell>
                          <TableCell className="text-right text-sm">{p.target_ton > 0 ? fmtNum(p.target_ton) : "–"}</TableCell>
                          <TableCell className="text-right text-sm">
                            {p.rate_override ? fmtRp(p.rate_override) : <span className="text-muted-foreground text-xs">cluster default</span>}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">{p.catatan || "–"}</TableCell>
                          {isDraft && (
                            <TableCell>
                              <button
                                className="opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-600"
                                disabled={actionLoading}
                                onClick={() => handleRemovePeserta(p.id_toko)}
                              >
                                <Trash2 size={14} />
                              </button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Tab: Monitoring ── */}
          <TabsContent value="monitoring" className="space-y-5 mt-4">
            {!hasMon ? (
              <div className="text-center py-12 text-muted-foreground">
                Monitoring tersedia setelah program diaktifkan
              </div>
            ) : monLoading && !monitoring ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {Array.from({length: 4}).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
                </div>
                <Skeleton className="h-64 rounded-xl" />
                <Skeleton className="h-48 rounded-xl" />
              </div>
            ) : monitoring?.tipe_program === "flat_multiplier" ? (
              <FlatMultiplierMonitoringView data={monitoring} />
            ) : monitoring?.tipe_program === "multi_tier" || (monitoring as MultiTierMonData | null)?.is_multi_tier ? (
              <MultiTierMonitoringView data={monitoring as MultiTierMonData} />
            ) : monitoring?.tipe_program === "leaderboard" ? (
              <LeaderboardView data={monitoring} onRefresh={() => { setMonLoaded(false); fetchMonitoring(); }} />
            ) : monitoring ? (
              <LegacyMonitoringView
                monitoring={monitoring as MonitoringData}
                monSortBy={monSortBy}
                monOrder={monOrder}
                setMonSortBy={setMonSortBy}
                setMonOrder={setMonOrder}
                setMonLoaded={setMonLoaded}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Gagal memuat data monitoring.</p>
            )}
          </TabsContent>

          {/* ── Tab: Analisis ── */}
          <TabsContent value="analisis" className="space-y-5 mt-4">
            {!isSelesai ? (
              <div className="text-center py-12 text-muted-foreground">
                Analisis tersedia setelah program selesai
              </div>
            ) : !monitoring && monLoading ? (
              <Skeleton className="h-64 rounded-xl" />
            ) : !monitoring ? (
              <p className="text-sm text-muted-foreground">Memuat data analisis...</p>
            ) : monitoring.tipe_program === "legacy" ? (
              (() => {
                const mon = monitoring;
                return (
                  <>
                    {mon.cluster_comparison.length > 0 && (
                      <Card className="shadow-sm">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-semibold">Volume per Cluster: Sebelum vs Selama Promo</CardTitle>
                          <p className="text-xs text-muted-foreground">Periode perbandingan: durasi yang sama sebelum promo dimulai</p>
                        </CardHeader>
                        <CardContent>
                          <div style={{ height: 220 }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={mon.cluster_comparison} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                                <XAxis dataKey="cluster" tick={{ fontSize: 10 }} />
                                <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                                <Tooltip formatter={(v: unknown, name: unknown) => [`${Number(v).toFixed(1)} ton`, String(name ?? "")]} />
                                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                                <Bar dataKey="vol_before" name="Sebelum Promo" fill="#e5e7eb" radius={[3,3,0,0]} />
                                <Bar dataKey="vol_promo"  name="Selama Promo"  fill="#7c3aed" radius={[3,3,0,0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {mon.cluster_comparison.map(c => (
                              <div key={c.cluster} className="bg-gray-50 rounded-lg p-3">
                                <p className="text-xs font-semibold text-muted-foreground">{c.cluster}</p>
                                <p className={`text-sm font-bold ${c.delta_pct > 0 ? "text-green-600" : c.delta_pct < 0 ? "text-red-600" : "text-gray-600"}`}>
                                  {c.delta_pct > 0 ? "+" : ""}{fmtPct(c.delta_pct)}
                                </p>
                                <p className="text-[10px] text-muted-foreground">{c.delta > 0 ? "+" : ""}{fmtNum(c.delta)} ton</p>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <Card className="shadow-sm">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-semibold text-green-700">Top 5 Toko</CardTitle>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="space-y-2">
                            {mon.summary.top_5_toko.map((t, i) => (
                              <div key={t.id_toko} className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold text-muted-foreground w-5">{i+1}.</span>
                                  <div>
                                    <p className="text-xs font-medium leading-tight">{t.nama_toko}</p>
                                    <p className="text-[10px] text-muted-foreground">{t.cluster}</p>
                                  </div>
                                </div>
                                <span className="text-sm font-bold text-green-600">{fmtPct(t.achievement_pct)}</span>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                      <Card className="shadow-sm">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-semibold text-red-700">Bottom 5 Toko</CardTitle>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="space-y-2">
                            {mon.summary.bottom_5_toko.map((t, i) => (
                              <div key={t.id_toko} className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold text-muted-foreground w-5">{i+1}.</span>
                                  <div>
                                    <p className="text-xs font-medium leading-tight">{t.nama_toko}</p>
                                    <p className="text-[10px] text-muted-foreground">{t.cluster}</p>
                                  </div>
                                </div>
                                <span className="text-sm font-bold text-red-600">{fmtPct(t.achievement_pct)}</span>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    {mon.recommendations.length > 0 && (
                      <Card className="shadow-sm border-purple-200">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-semibold text-purple-700">Rekomendasi</CardTitle>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <ul className="space-y-2">
                            {mon.recommendations.map((r, i) => (
                              <li key={i} className="flex items-start gap-2 text-sm">
                                <span className="w-1.5 h-1.5 rounded-full bg-purple-500 shrink-0 mt-1.5" />
                                {r}
                              </li>
                            ))}
                          </ul>
                        </CardContent>
                      </Card>
                    )}
                  </>
                );
              })()
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <p className="text-sm">Tab Analisis tidak tersedia untuk tipe program <span className="font-medium">{monitoring.tipe_program}</span>.</p>
                <p className="text-xs mt-1">Lihat tab Monitoring untuk data detail program ini.</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
