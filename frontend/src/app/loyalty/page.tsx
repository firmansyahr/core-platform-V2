"use client";

export const dynamic = 'force-dynamic';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ComposedChart, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, ReferenceLine, Cell,
} from "recharts";
import {
  Users, Plus, Upload, Download, Search, X, Check,
  TrendingDown, Zap, BookOpen, Clock, AlertCircle, ChevronRight,
  Target, Settings, TrendingUp, BarChart2, Activity,
} from "lucide-react";
import { apiFetch, API } from "@/lib/fetch";

const fmtRp = (n: number) =>
  "Rp " + new Intl.NumberFormat("id-ID").format(Math.round(n));
const fmtNum = (n: number) => new Intl.NumberFormat("id-ID").format(Math.round(n));
const TARGET_PAGE_SIZE = 50;

const TAB_LABELS: Record<string, string> = {
  peserta:     "Peserta Aktif",
  takeout:     "Toko Takeout",
  rekomendasi: "Rekomendasi Take Out",
  target:      "Target & Achievement",
  promo:       "Smart Promotion",
  ilp:         "Referensi ILP",
  history:     "History",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface LoyaltyMember {
  id: string; id_toko: string; nama_toko: string; kabupaten: string;
  cluster_pareto: string; tso: string; reward_type: string; catatan: string;
  status: string; tgl_masuk: string; tgl_keluar: string | null;
  alasan_keluar: string | null;
  aegis_score?: number; aegis_level?: string;
  est_budget?: number; avg_ton_bulanan?: number;
}
interface Summary {
  total_aktif: number; total_nonaktif: number; est_budget_bulan: number;
  per_reward_type: Record<string, number>;
  rekomendasi_takeout: number; rekomendasi_takein: number;
}
interface TakeoutRec {
  id: string; id_toko: string; nama_toko: string; kabupaten: string;
  cluster_pareto: string; tso: string; reward_type: string;
  skor: number; alasan: string[]; budget_dihemat: number;
}
interface SmartPromo {
  id: string; id_toko: string; nama_toko: string; cluster_pareto: string;
  aegis_score: number; level: string;
  promo_aktif: string; tipe_promo: string; rate: number;
  durasi: number; est_budget: number; est_roi: number;
}
interface ILPRec {
  id_toko: string; nama_toko: string; kabupaten: string;
  cluster_pareto: string; tso: string;
  ilp_score: number; aegis_score: number; aegis_level: string;
  avg_ton_bulanan: number; est_cost_bln: number;
}
interface HistoryEvent {
  id_member: string; id_toko: string; nama_toko: string;
  tanggal: string; perubahan: string; alasan: string; status_baru: string;
}
interface StoreSearch {
  id_toko: string; nama_toko: string; kabupaten: string;
  cluster_pareto: string; tso: string;
  aegis_score: number; aegis_level: string; avg_ton_bulanan: number; sudah_ada: boolean;
}
interface HistoricalTarget {
  id_toko: string; nama_toko: string; cluster: string;
  bulan: number; tahun: number; periode: string; periode_label: string;
  base_1: number; base_2: number | null; baseline: number;
  growth_rate: number; growth_label: string;
  target_ton: number; realisasi_ton: number;
  achievement_pct: number; status_achievement: string;
  kabupaten: string; aegis_level: string; aegis_score: number; tso: string;
}
interface TargetSummary {
  on_track: number; at_risk: number; below_target: number;
  avg_achievement_pct: number; total_target_ton: number; total_realisasi_ton: number;
}
interface GrowthOverride {
  id: string; label: string;
  type: "monthly" | "quarterly";
  bulan: number | null; tahun: number; kuartal: number | null;
  normal: number; warning: number; kritis: number; catatan: string;
}
interface TargetConfig {
  w1: number; w2: number;
  min_pct_sp: number; min_pct_platinum: number; min_pct_gold: number; min_pct_silver: number;
  growth_rates: {
    default: { normal: number; warning: number; kritis: number };
    overrides: GrowthOverride[];
  };
}

interface VolumeTrendPoint {
  bulan: string; bulan_label: string;
  volume_loyalty: number; volume_non_loyalty: number;
  target_loyalty: number; achievement_pct: number;
}
interface ComparisonPoint {
  bulan: string; bulan_label: string;
  avg_ton_loyalty: number; avg_ton_non_loyalty: number; ratio: number;
}
interface EffectivenessTrendPoint {
  bulan: string; bulan_label: string;
  efektivitas_pct: number; volume_achievement_pct: number; peserta_aktif_pct: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const REWARD_TYPES = ["Standard", "Emergency Boost", "Retention Boost", "Loyalty Reward"] as const;
const CLUSTERS = ["Super Platinum", "Platinum", "Gold", "Silver", "Bronze"] as const;
const RATES: Record<string, number> = {
  "Emergency Boost": 15_000, "Retention Boost": 10_000,
  "Loyalty Reward": 10_000, Standard: 5_000,
};
const TAKEOUT_REASONS = [
  "Volume Turun", "Tidak Aktif", "Sudah Normal", "Efisiensi Rendah", "Keputusan Manual",
] as const;

const REWARD_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  "Emergency Boost": { bg: "#DC262618", text: "#DC2626", border: "#DC262630" },
  "Retention Boost": { bg: "#EA580C18", text: "#EA580C", border: "#EA580C30" },
  "Loyalty Reward":  { bg: "#16a34a18", text: "#16a34a", border: "#16a34a30" },
  Standard:          { bg: "#6b728018", text: "#6b7280", border: "#6b728030" },
};
const LEVEL_COLOR: Record<string, string> = {
  Merah: "#DC2626", Oranye: "#EA580C", Kuning: "#CA8A04",
};

function RewardBadge({ type }: { type: string }) {
  const s = REWARD_STYLE[type] ?? REWARD_STYLE.Standard;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold"
      style={{ backgroundColor: s.bg, color: s.text, border: `1px solid ${s.border}` }}
    >
      {type}
    </span>
  );
}

function LevelBadge({ level }: { level: string }) {
  const color = LEVEL_COLOR[level] ?? "#6b7280";
  if (!level || level === "Normal") return <span className="text-xs text-muted-foreground">Normal</span>;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold"
      style={{ backgroundColor: `${color}18`, color, border: `1px solid ${color}30` }}
    >
      {level}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "On Track"
      ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400 border-green-200 dark:border-green-800"
      : status === "At Risk"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-800"
      : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400 border-red-200 dark:border-red-800";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${cls}`}>
      {status}
    </span>
  );
}

// ─── Modal overlay wrapper ────────────────────────────────────────────────────

function Modal({
  children, onClose, maxWidth = "max-w-lg",
}: {
  children: React.ReactNode; onClose: () => void; maxWidth?: string;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative z-10 w-full ${maxWidth} max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card shadow-2xl`}>
        {children}
      </div>
    </div>
  );
}

// ─── AddMemberModal ───────────────────────────────────────────────────────────

function AddMemberModal({
  onClose, onAdded, prefill,
}: {
  onClose: () => void;
  onAdded: () => void;
  prefill?: Partial<StoreSearch>;
}) {
  const [query, setQuery] = useState(prefill?.nama_toko ?? "");
  const [suggestions, setSuggestions] = useState<StoreSearch[]>([]);
  const [selected, setSelected] = useState<StoreSearch | null>(
    prefill ? (prefill as StoreSearch) : null,
  );
  const [rewardType, setRewardType] = useState<string>("Standard");
  const [catatan, setCatatan] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((q: string) => {
    if (q.length < 2) { setSuggestions([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await apiFetch(`${API}/api/loyalty/search-stores?q=${encodeURIComponent(q)}`);
        const j = await r.json();
        setSuggestions(j.data ?? []);
      } catch { setSuggestions([]); }
    }, 300);
  }, []);

  useEffect(() => { if (!prefill) search(query); }, [query, search, prefill]);

  const estBudget = selected
    ? Math.round((selected.avg_ton_bulanan ?? 0) * (RATES[rewardType] ?? 5000))
    : 0;

  async function handleSubmit() {
    if (!selected) { setErr("Pilih toko terlebih dahulu"); return; }
    setSaving(true); setErr("");
    try {
      const r = await apiFetch(`${API}/api/loyalty/members/add-one`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id_toko: selected.id_toko, nama_toko: selected.nama_toko,
          kabupaten: selected.kabupaten, cluster_pareto: selected.cluster_pareto,
          tso: selected.tso, reward_type: rewardType, catatan,
        }),
      });
      if (r.status === 409) { setErr("Toko sudah ada di program loyalty"); return; }
      if (!r.ok) { const j = await r.json(); setErr(j.detail ?? "Gagal menambah"); return; }
      onAdded(); onClose();
    } catch { setErr("Gagal menghubungi server"); }
    finally { setSaving(false); }
  }

  return (
    <Modal onClose={onClose}>
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">Tambah Toko ke Program</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
        </div>

        {!selected ? (
          <div className="space-y-2">
            <label className="text-xs font-medium">Cari Nama Toko</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring/50"
                placeholder="Ketik nama atau kabupaten…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
            </div>
            {suggestions.length > 0 && (
              <div className="border border-border rounded-md divide-y divide-border overflow-hidden">
                {suggestions.map((s) => (
                  <button
                    key={s.id_toko}
                    disabled={s.sudah_ada}
                    onClick={() => { setSelected(s); setSuggestions([]); setQuery(s.nama_toko); }}
                    className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <p className="text-xs font-medium">{s.nama_toko}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {s.kabupaten} · {s.cluster_pareto}
                      {s.sudah_ada && " · sudah di program"}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold">{selected.nama_toko}</p>
                <p className="text-[10px] text-muted-foreground">{selected.kabupaten} · {selected.cluster_pareto}</p>
                <p className="text-[10px] text-muted-foreground">{selected.tso}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <LevelBadge level={selected.aegis_level ?? "Normal"} />
                <span className="text-[10px] text-muted-foreground">AEGIS {selected.aegis_score.toFixed(1)}</span>
              </div>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-[10px] text-primary hover:underline"
            >
              Ganti toko
            </button>
          </div>
        )}

        <div>
          <label className="text-xs font-medium">Reward Type</label>
          <select
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
            value={rewardType}
            onChange={(e) => setRewardType(e.target.value)}
          >
            {REWARD_TYPES.map((t) => (
              <option key={t} value={t}>{t} — Rp {fmtNum(RATES[t])}/ton</option>
            ))}
          </select>
        </div>

        {selected && (
          <div className="rounded-md bg-primary/5 border border-primary/20 px-3 py-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Estimasi budget/bulan</span>
            <span className="text-sm font-bold text-primary">{fmtRp(estBudget)}</span>
          </div>
        )}

        <div>
          <label className="text-xs font-medium">Catatan (opsional)</label>
          <textarea
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 resize-none"
            rows={2}
            placeholder="Catatan tambahan…"
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
          />
        </div>

        {err && <p className="text-xs text-destructive">{err}</p>}

        <div className="flex gap-2 pt-1">
          <Button
            onClick={handleSubmit}
            disabled={saving || !selected}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white"
            size="sm"
          >
            {saving ? "Menyimpan…" : "Tambah ke Program"}
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>Batal</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── UploadExcelModal ─────────────────────────────────────────────────────────

function UploadExcelModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ berhasil: number; duplikat: number; error: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(f: File) {
    if (!f.name.toLowerCase().endsWith(".xlsx") && !f.name.toLowerCase().endsWith(".xls")) {
      alert("Hanya file .xlsx atau .xls yang diterima"); return;
    }
    setFile(f); setResult(null);
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await apiFetch(`${API}/api/loyalty/members/upload-excel`, { method: "POST", body: fd });
      const j = await r.json();
      if (j.data) setResult(j.data);
    } catch { alert("Gagal upload"); }
    finally { setUploading(false); }
  }

  async function handleTemplate() {
    const r = await apiFetch(`${API}/api/loyalty/template`);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "loyalty_template.xlsx"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Modal onClose={onClose}>
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">Upload Excel Peserta</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
        </div>

        <button
          onClick={handleTemplate}
          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          <Download size={12} /> Download template format Excel
        </button>

        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
            dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault(); setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
          }}
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={24} className="mx-auto mb-2 text-muted-foreground" />
          {file ? (
            <p className="text-sm font-medium">{file.name}</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">Drag & drop atau klik untuk pilih file</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Hanya .xlsx dan .xls</p>
            </>
          )}
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />

        {result ? (
          <div className="space-y-2">
            <div className="rounded-lg border border-border p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <Check size={14} className="text-green-600" />
                <span className="text-sm font-medium">{result.berhasil} toko berhasil ditambahkan</span>
              </div>
              {result.duplikat > 0 && (
                <p className="text-xs text-amber-600">{result.duplikat} duplikat dilewati</p>
              )}
              {result.error.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-medium text-destructive mb-1">{result.error.length} error:</p>
                  <ul className="text-[10px] text-muted-foreground space-y-0.5">
                    {result.error.slice(0, 5).map((e, i) => <li key={i}>• {e}</li>)}
                    {result.error.length > 5 && <li>…dan {result.error.length - 5} lainnya</li>}
                  </ul>
                </div>
              )}
            </div>
            <Button onClick={() => { onDone(); onClose(); }} className="w-full" size="sm">Selesai</Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button onClick={handleUpload} disabled={!file || uploading} className="flex-1" size="sm">
              {uploading ? "Mengupload…" : "Upload & Proses"}
            </Button>
            <Button variant="outline" size="sm" onClick={onClose}>Batal</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── TakeOutModal ─────────────────────────────────────────────────────────────

function TakeOutModal({
  member, systemAlasan,
  onClose, onDone,
}: {
  member: LoyaltyMember | TakeoutRec;
  systemAlasan?: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [alasan, setAlasan] = useState<string>(systemAlasan?.[0] ?? TAKEOUT_REASONS[0]);
  const [catatan, setCatatan] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    setSaving(true);
    try {
      await apiFetch(`${API}/api/loyalty/members/${(member as LoyaltyMember).id}/take-out`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alasan, catatan }),
      });
      onDone(); onClose();
    } catch { alert("Gagal menghubungi server"); }
    finally { setSaving(false); }
  }

  return (
    <Modal onClose={onClose}>
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-destructive">Konfirmasi Take Out</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
        </div>

        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-xs font-semibold">{member.nama_toko}</p>
          <p className="text-[10px] text-muted-foreground">{member.kabupaten} · {member.cluster_pareto}</p>
          {systemAlasan && systemAlasan.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {systemAlasan.map((a) => (
                <span key={a} className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                  {a}
                </span>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="text-xs font-medium">Alasan Take Out</label>
          <select
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
            value={alasan}
            onChange={(e) => setAlasan(e.target.value)}
          >
            {TAKEOUT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <div>
          <label className="text-xs font-medium">Catatan (opsional)</label>
          <textarea
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 resize-none"
            rows={2}
            placeholder="Catatan tambahan…"
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
          />
        </div>

        <div className="flex gap-2">
          <Button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            size="sm"
          >
            {saving ? "Memproses…" : "Konfirmasi Take Out"}
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>Batal</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── TargetConfigModal ────────────────────────────────────────────────────────

const DEFAULT_TARGET_CONFIG: TargetConfig = {
  w1: 0.6, w2: 0.4,
  min_pct_sp: 0.8, min_pct_platinum: 0.7, min_pct_gold: 0.6, min_pct_silver: 0.5,
  growth_rates: {
    default: { normal: 0.03, warning: 0.01, kritis: 0.0 },
    overrides: [],
  },
};

// ── Schedule helpers (mirror backend logic, run client-side for live preview) ──

interface ScheduleRow {
  bulan: string; bulan_num: number; tahun: number;
  normal_pct: number; warning_pct: number; kritis_pct: number; sumber: string;
}

function localGrowthRate(
  kondisi: "normal" | "warning" | "kritis",
  bulan: number, tahun: number, cfg: TargetConfig
): { rate: number; sumber: string } {
  const ovs = cfg.growth_rates.overrides;
  for (const ov of ovs)
    if (ov.type === "monthly" && ov.bulan === bulan && ov.tahun === tahun)
      return { rate: ov[kondisi], sumber: ov.label };
  const kw = Math.floor((bulan - 1) / 3) + 1;
  for (const ov of ovs)
    if (ov.type === "quarterly" && ov.kuartal === kw && ov.tahun === tahun)
      return { rate: ov[kondisi], sumber: ov.label };
  return { rate: cfg.growth_rates.default[kondisi], sumber: "Default" };
}

function buildSchedule(cfg: TargetConfig, startB: number, startY: number): ScheduleRow[] {
  const MN = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  let b = startB, y = startY;
  return Array.from({ length: 12 }, () => {
    const { rate: nr, sumber } = localGrowthRate("normal",  b, y, cfg);
    const { rate: wr }         = localGrowthRate("warning", b, y, cfg);
    const { rate: kr }         = localGrowthRate("kritis",  b, y, cfg);
    const row: ScheduleRow = {
      bulan: `${MN[b-1]} ${y}`, bulan_num: b, tahun: y,
      normal_pct:  Math.round(nr * 1000) / 10,
      warning_pct: Math.round(wr * 1000) / 10,
      kritis_pct:  Math.round(kr * 1000) / 10,
      sumber,
    };
    if (++b > 12) { b = 1; y++; }
    return row;
  });
}

const MONTH_OPTIONS = [
  {v:1,l:"Januari"},{v:2,l:"Februari"},{v:3,l:"Maret"},{v:4,l:"April"},
  {v:5,l:"Mei"},{v:6,l:"Juni"},{v:7,l:"Juli"},{v:8,l:"Agustus"},
  {v:9,l:"September"},{v:10,l:"Oktober"},{v:11,l:"November"},{v:12,l:"Desember"},
];

function TargetConfigModal({
  config, startPeriod, onClose, onSaved,
}: {
  config: TargetConfig;
  startPeriod: { bulan: number; tahun: number };
  onClose: () => void;
  onSaved: (cfg: TargetConfig) => void;
}) {
  const [cfg, setCfg]           = useState<TargetConfig>(config);
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState("");
  const [showAdd, setShowAdd]   = useState(false);
  const [addErr, setAddErr]     = useState("");
  const [newOv, setNewOv]       = useState<Partial<GrowthOverride>>({
    id: "", label: "", type: "monthly",
    bulan: startPeriod.bulan, tahun: startPeriod.tahun, kuartal: 1,
    normal: 0.03, warning: 0.01, kritis: 0.0, catatan: "",
  });

  const schedule = useMemo(
    () => buildSchedule(cfg, startPeriod.bulan, startPeriod.tahun),
    [cfg, startPeriod]
  );

  const wSum = cfg.w1 + cfg.w2;

  function setDefault(k: "normal" | "warning" | "kritis", v: number) {
    setCfg(p => ({ ...p, growth_rates: { ...p.growth_rates, default: { ...p.growth_rates.default, [k]: v } } }));
  }
  function removeOverride(id: string) {
    setCfg(p => ({ ...p, growth_rates: { ...p.growth_rates, overrides: p.growth_rates.overrides.filter(o => o.id !== id) } }));
  }

  function handleAddOverride() {
    setAddErr("");
    if (!newOv.label?.trim()) { setAddErr("Label harus diisi"); return; }
    if (newOv.type === "monthly" && (!newOv.bulan || newOv.bulan < 1 || newOv.bulan > 12)) {
      setAddErr("Bulan harus 1–12"); return;
    }
    if (newOv.type === "quarterly" && (!newOv.kuartal || newOv.kuartal < 1 || newOv.kuartal > 4)) {
      setAddErr("Kuartal harus Q1–Q4"); return;
    }
    if (!newOv.tahun || newOv.tahun < 2024) { setAddErr("Tahun minimal 2024"); return; }
    const dup = cfg.growth_rates.overrides.some(o => {
      if (o.tahun !== newOv.tahun) return false;
      return newOv.type === "monthly" ? o.type === "monthly" && o.bulan === newOv.bulan
                                      : o.type === "quarterly" && o.kuartal === newOv.kuartal;
    });
    if (dup) { setAddErr("Periode ini sudah ada override"); return; }

    const added: GrowthOverride = {
      id: `ov-${Date.now()}`, label: newOv.label!.trim(), type: newOv.type!,
      bulan:   newOv.type === "monthly"   ? newOv.bulan!   : null,
      kuartal: newOv.type === "quarterly" ? newOv.kuartal! : null,
      tahun: newOv.tahun!, normal: newOv.normal ?? 0.03,
      warning: newOv.warning ?? 0.01, kritis: newOv.kritis ?? 0.0,
      catatan: newOv.catatan ?? "",
    };
    setCfg(p => ({ ...p, growth_rates: { ...p.growth_rates, overrides: [...p.growth_rates.overrides, added] } }));
    setShowAdd(false);
    setNewOv({ id:"", label:"", type:"monthly", bulan:startPeriod.bulan, tahun:startPeriod.tahun, kuartal:1, normal:0.03, warning:0.01, kritis:0.0, catatan:"" });
  }

  async function handleSave() {
    if (Math.abs(wSum - 1.0) > 0.01) { setErr("w1 + w2 harus = 1.0"); return; }
    setSaving(true); setErr("");
    try {
      const r = await apiFetch(`${API}/api/loyalty/targets/config`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      onSaved((await r.json()).data);
      onClose();
    } catch { setErr("Gagal menghubungi server"); }
    finally { setSaving(false); }
  }

  function numIn(label: string, val: number, onChange: (v: number) => void, step=0.01, pct=false) {
    return (
      <div className="space-y-1">
        <label className="text-[10px] font-medium text-muted-foreground">{label}</label>
        <div className="flex items-center gap-1">
          <input type="number" step={step} min={0} max={pct ? 0.5 : 1}
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
            value={val}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          />
          {pct && <span className="text-[10px] text-muted-foreground shrink-0 w-8">{(val*100).toFixed(0)}%</span>}
        </div>
      </div>
    );
  }

  const periodLabel = (ov: GrowthOverride) => {
    if (ov.type === "monthly") return `${MONTH_OPTIONS.find(m => m.v === ov.bulan)?.l ?? ov.bulan} ${ov.tahun}`;
    return `Q${ov.kuartal} ${ov.tahun}`;
  };

  return (
    <Modal onClose={onClose} maxWidth="max-w-3xl">
      <div className="p-5 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">Konfigurasi Target Loyalty</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
        </div>

        {/* ── Section 1: Bobot Baseline ── */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Bobot Baseline</p>
          <div className="grid grid-cols-2 gap-3">
            {numIn("w1 — rata-rata 3 bulan terakhir", cfg.w1, v => setCfg(p => ({...p,w1:v})))}
            {numIn("w2 — YoY bulan yang sama", cfg.w2, v => setCfg(p => ({...p,w2:v})))}
          </div>
          {Math.abs(wSum - 1.0) > 0.01 && (
            <p className="text-xs text-amber-600">w1 + w2 = {wSum.toFixed(2)} — harus = 1.00</p>
          )}
        </div>

        {/* ── Section 2: Growth Rate Default ── */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Growth Rate Default</p>
          <p className="text-[10px] text-muted-foreground">Berlaku jika tidak ada override untuk periode tertentu</p>
          <div className="grid grid-cols-3 gap-3">
            {numIn("Normal / Pola D", cfg.growth_rates.default.normal, v => setDefault("normal",v), 0.005, true)}
            {numIn("Warning / Pola A–C", cfg.growth_rates.default.warning, v => setDefault("warning",v), 0.005, true)}
            {numIn("Kritis / Pola B", cfg.growth_rates.default.kritis, v => setDefault("kritis",v), 0.005, true)}
          </div>
        </div>

        {/* ── Section 3: Override per Periode ── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Penyesuaian Growth Rate per Periode</p>
              <p className="text-[10px] text-muted-foreground">Untuk periode khusus: peak season, promo nasional, dll.</p>
            </div>
            {!showAdd && (
              <Button size="sm" variant="outline" className="text-[10px] h-7 px-2" onClick={() => { setShowAdd(true); setAddErr(""); }}>
                + Tambah Override
              </Button>
            )}
          </div>

          {/* Override table */}
          {cfg.growth_rates.overrides.length > 0 ? (
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-[10px]">
                <thead className="bg-muted/50">
                  <tr>
                    {["Label","Tipe","Periode","Normal","Warning","Kritis",""].map(h => (
                      <th key={h} className="px-2 py-1.5 text-left font-semibold text-muted-foreground uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {cfg.growth_rates.overrides.map(ov => (
                    <tr key={ov.id} className="hover:bg-muted/20">
                      <td className="px-2 py-1.5 font-medium max-w-[120px] truncate" title={ov.label}>{ov.label}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">{ov.type === "monthly" ? "Bulanan" : "Kuartalan"}</td>
                      <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">{periodLabel(ov)}</td>
                      <td className="px-2 py-1.5 text-green-600 font-medium">{(ov.normal*100).toFixed(1)}%</td>
                      <td className="px-2 py-1.5 text-amber-600 font-medium">{(ov.warning*100).toFixed(1)}%</td>
                      <td className="px-2 py-1.5 text-red-600 font-medium">{(ov.kritis*100).toFixed(1)}%</td>
                      <td className="px-2 py-1.5">
                        <button onClick={() => removeOverride(ov.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                          <X size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !showAdd && (
            <p className="text-[10px] text-muted-foreground italic">Belum ada override — semua bulan pakai growth rate default.</p>
          )}

          {/* Add override form */}
          {showAdd && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-3">
              <p className="text-[10px] font-semibold text-primary uppercase tracking-wider">Tambah Override Periode</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground">Label</label>
                  <input
                    placeholder='mis. "Q1 2027 — Peak Konstruksi"'
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
                    value={newOv.label ?? ""}
                    onChange={e => setNewOv(p => ({...p, label: e.target.value}))}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground">Tipe</label>
                  <div className="flex gap-3 mt-1">
                    {(["monthly","quarterly"] as const).map(t => (
                      <label key={t} className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input type="radio" value={t} checked={newOv.type === t}
                          onChange={() => setNewOv(p => ({...p, type:t}))} />
                        {t === "monthly" ? "Per Bulan" : "Per Kuartal"}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground">Periode</label>
                  <div className="flex gap-2">
                    {newOv.type === "monthly" ? (
                      <select
                        className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none"
                        value={newOv.bulan ?? 1}
                        onChange={e => setNewOv(p => ({...p, bulan: parseInt(e.target.value)}))}
                      >
                        {MONTH_OPTIONS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
                      </select>
                    ) : (
                      <select
                        className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none"
                        value={newOv.kuartal ?? 1}
                        onChange={e => setNewOv(p => ({...p, kuartal: parseInt(e.target.value)}))}
                      >
                        {[1,2,3,4].map(q => <option key={q} value={q}>Q{q} ({["Jan-Mar","Apr-Jun","Jul-Sep","Okt-Des"][q-1]})</option>)}
                      </select>
                    )}
                    <input type="number" min={2024} max={2035}
                      className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none"
                      value={newOv.tahun ?? startPeriod.tahun}
                      onChange={e => setNewOv(p => ({...p, tahun: parseInt(e.target.value) || startPeriod.tahun}))}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground">Growth Normal (%)</label>
                  <input type="number" step={0.5} min={0} max={50}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none"
                    value={(newOv.normal ?? 0.03) * 100}
                    onChange={e => setNewOv(p => ({...p, normal: (parseFloat(e.target.value)||0)/100}))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground">Growth Warning (%)</label>
                  <input type="number" step={0.5} min={0} max={50}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none"
                    value={(newOv.warning ?? 0.01) * 100}
                    onChange={e => setNewOv(p => ({...p, warning: (parseFloat(e.target.value)||0)/100}))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground">Growth Kritis (%)</label>
                  <input type="number" step={0.5} min={0} max={50}
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none"
                    value={(newOv.kritis ?? 0) * 100}
                    onChange={e => setNewOv(p => ({...p, kritis: (parseFloat(e.target.value)||0)/100}))}
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground">Catatan (opsional)</label>
                  <input
                    className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none"
                    value={newOv.catatan ?? ""}
                    onChange={e => setNewOv(p => ({...p, catatan: e.target.value}))}
                  />
                </div>
              </div>
              {addErr && <p className="text-xs text-destructive">{addErr}</p>}
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAddOverride} className="flex-1">Tambahkan</Button>
                <Button size="sm" variant="outline" onClick={() => { setShowAdd(false); setAddErr(""); }}>Batal</Button>
              </div>
            </div>
          )}
        </div>

        {/* ── Section 4: Preview Jadwal 12 Bulan ── */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Preview Jadwal Growth Rate — 12 Bulan ke Depan</p>
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-[10px]">
              <thead className="bg-muted/50">
                <tr>
                  {["Bulan","Normal","Warning","Kritis","Sumber"].map(h => (
                    <th key={h} className="px-2 py-1.5 text-left font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {schedule.map((row, i) => (
                  <tr key={i} className={row.sumber !== "Default" ? "bg-blue-50/60 dark:bg-blue-950/20" : "hover:bg-muted/20"}>
                    <td className="px-2 py-1 font-medium whitespace-nowrap">{row.bulan}</td>
                    <td className="px-2 py-1 text-green-600 font-medium">{row.normal_pct.toFixed(1)}%</td>
                    <td className="px-2 py-1 text-amber-600 font-medium">{row.warning_pct.toFixed(1)}%</td>
                    <td className="px-2 py-1 text-red-600 font-medium">{row.kritis_pct.toFixed(1)}%</td>
                    <td className="px-2 py-1 text-muted-foreground max-w-[140px] truncate" title={row.sumber}>
                      {row.sumber !== "Default" && <span className="mr-1 text-blue-500">★</span>}
                      {row.sumber}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Section 5: Minimum Target per Cluster ── */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Minimum Target per Cluster (× Median Cluster)</p>
          <div className="grid grid-cols-2 gap-3">
            {numIn("Super Platinum", cfg.min_pct_sp, v => setCfg(p => ({...p,min_pct_sp:v})))}
            {numIn("Platinum",       cfg.min_pct_platinum, v => setCfg(p => ({...p,min_pct_platinum:v})))}
            {numIn("Gold",           cfg.min_pct_gold, v => setCfg(p => ({...p,min_pct_gold:v})))}
            {numIn("Silver",         cfg.min_pct_silver, v => setCfg(p => ({...p,min_pct_silver:v})))}
          </div>
          <p className="text-[10px] text-muted-foreground">Bronze: tidak ada minimum target</p>
        </div>

        {err && <p className="text-xs text-destructive">{err}</p>}

        <div className="flex gap-2 pt-1">
          <Button onClick={handleSave} disabled={saving} className="flex-1" size="sm">
            {saving ? "Menyimpan…" : "Simpan Konfigurasi"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCfg(DEFAULT_TARGET_CONFIG)}>Reset Default</Button>
          <Button variant="outline" size="sm" onClick={onClose}>Batal</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon: Icon, color,
}: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; color: string;
}) {
  return (
    <Card className="shadow-sm min-h-[100px]" style={{ borderBottom: `3px solid ${color}` }}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate pr-2">{label}</p>
          <Icon size={16} style={{ color }} className="opacity-50 shrink-0" />
        </div>
        <p className="text-2xl font-bold leading-none tabular-nums" style={{ color }}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function LoyaltyContent() {
  const router = useRouter();
  const [summary, setSummary]       = useState<Summary | null>(null);
  const [members, setMembers]       = useState<LoyaltyMember[]>([]);
  const [takeoutRecs, setTakeoutRecs] = useState<TakeoutRec[]>([]);
  const [smartPromos, setSmartPromos] = useState<SmartPromo[]>([]);
  const [ilpRecs, setIlpRecs]       = useState<ILPRec[]>([]);
  const [history, setHistory]       = useState<HistoryEvent[]>([]);

  const [loading, setLoading]           = useState(true);
  const [takeoutLoading, setTakeoutLoading] = useState(false);
  const [promoLoading, setPromoLoading]  = useState(false);
  const [ilpLoading, setIlpLoading]      = useState(false);
  const [histLoading, setHistLoading]    = useState(false);

  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab"); // null → main overview page
  const [search, setSearch]       = useState("");
  const [filterCluster, setFilterCluster] = useState<string[]>([]);
  const [filterReward, setFilterReward]   = useState("");

  const [addModal, setAddModal]     = useState(false);
  const [uploadModal, setUploadModal] = useState(false);
  const [takeoutTarget, setTakeoutTarget] = useState<{ member: LoyaltyMember | TakeoutRec; system?: string[] } | null>(null);
  const [applyingAll, setApplyingAll] = useState(false);
  const [prefillStore, setPrefillStore] = useState<Partial<ILPRec> | null>(null);

  const [targets, setTargets]               = useState<HistoricalTarget[]>([]);
  const [targetSummary, setTargetSummary]   = useState<TargetSummary | null>(null);
  const [targetTotal, setTargetTotal]       = useState(0);
  const [targetPage, setTargetPage]         = useState(0);
  const [selectedPeriode, setSelectedPeriode]   = useState("2026-04");
  const [targetCluster,    setTargetCluster]     = useState("");
  const [targetStatus,     setTargetStatus]      = useState("");
  const [targetSearch,     setTargetSearch]      = useState("");
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetConfig, setTargetConfig]     = useState<TargetConfig>(DEFAULT_TARGET_CONFIG);
  const [targetConfigModal, setTargetConfigModal] = useState(false);

  const [nonaktifMembers,  setNonaktifMembers]  = useState<LoyaltyMember[]>([]);
  const [nonaktifLoading,  setNonaktifLoading]  = useState(false);

  const [volumeTrend,      setVolumeTrend]      = useState<VolumeTrendPoint[]>([]);
  const [comparison,       setComparison]       = useState<ComparisonPoint[]>([]);
  const [effectTrend,      setEffectTrend]      = useState<EffectivenessTrendPoint[]>([]);
  const [insightLoad,      setInsightLoad]      = useState(true);
  const [avgRatio,         setAvgRatio]         = useState(0);
  const [promoAktifCount,  setPromoAktifCount]  = useState<number | null>(null);

  const fetchTargets = useCallback(async (opts?: {
    bulan?: string; cluster?: string; status?: string; search?: string; page?: number;
  }) => {
    setTargetsLoading(true);
    try {
      const o = opts ?? {};
      const qs = new URLSearchParams();
      if (o.bulan && o.bulan !== "all") qs.set("bulan", o.bulan);
      if (o.cluster) qs.set("cluster", o.cluster);
      if (o.status)  qs.set("status",  o.status);
      if (o.search)  qs.set("search",  o.search);
      qs.set("limit",  String(TARGET_PAGE_SIZE));
      qs.set("offset", String((o.page ?? 0) * TARGET_PAGE_SIZE));

      const [tRes, cfgRes] = await Promise.all([
        apiFetch(`${API}/api/loyalty/targets?${qs}`),
        apiFetch(`${API}/api/loyalty/targets/config`),
      ]);
      const tJson   = await tRes.json();
      const cfgJson = await cfgRes.json();
      setTargets(tJson.data ?? []);
      setTargetSummary(tJson.summary ?? null);
      setTargetTotal(tJson.meta?.total ?? 0);
      setTargetConfig(cfgJson.data ?? DEFAULT_TARGET_CONFIG);
    } catch (e) { console.error("loyalty targets error:", e); setTargets([]); }
    finally { setTargetsLoading(false); }
  }, []);

  const fetchSummary = useCallback(async () => {
    try {
      const r = await apiFetch(`${API}/api/loyalty/summary`);
      const j = await r.json();
      console.log("loyalty summary:", j);
      setSummary(j.data);
    } catch (e) { console.error("loyalty summary error:", e); }
  }, []);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiFetch(`${API}/api/loyalty/members?limit=500`);
      const j = await r.json();
      console.log("loyalty members:", j);
      setMembers(j.data ?? []);
    } catch (e) { console.error("loyalty members error:", e); setMembers([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchSummary();
    fetchMembers();
    fetchTargets();

    // Insight data — non-blocking, each fetch individually fault-tolerant
    Promise.all([
      apiFetch(`${API}/api/loyalty/insights/volume-trend`).then(r => r.json()).catch((e) => { console.error("volume-trend error:", e); return { data: [] }; }),
      apiFetch(`${API}/api/loyalty/insights/comparison`).then(r => r.json()).catch((e) => { console.error("comparison error:", e); return { data: [], meta: {} }; }),
      apiFetch(`${API}/api/loyalty/insights/effectiveness-trend`).then(r => r.json()).catch((e) => { console.error("effectiveness-trend error:", e); return { data: [] }; }),
    ])
      .then(([vt, cmp, eff]) => {
        console.log("loyalty volume-trend:", vt);
        console.log("loyalty comparison:", cmp);
        console.log("loyalty effectiveness-trend:", eff);
        setVolumeTrend(vt.data ?? []);
        setComparison(cmp.data ?? []);
        setAvgRatio(cmp.meta?.avg_ratio ?? 0);
        setEffectTrend(eff.data ?? []);
      })
      .finally(() => setInsightLoad(false));

    // Promo aktif count — non-blocking
    apiFetch(`${API}/api/promo?status=Aktif`)
      .then(r => r.json())
      .then(j => setPromoAktifCount(j.meta?.total ?? 0))
      .catch(() => {});
  }, [fetchSummary, fetchMembers, fetchTargets]);

  useEffect(() => {
    if (activeTab === "takeout" && nonaktifMembers.length === 0) {
      setNonaktifLoading(true);
      apiFetch(`${API}/api/loyalty/members?status=Nonaktif&limit=500`)
        .then((r) => r.json())
        .then((j) => { console.log("loyalty nonaktif:", j); setNonaktifMembers(j.data ?? []); })
        .catch((e) => console.error("loyalty nonaktif error:", e))
        .finally(() => setNonaktifLoading(false));
    }
    if (activeTab === "rekomendasi" && takeoutRecs.length === 0) {
      setTakeoutLoading(true);
      apiFetch(`${API}/api/loyalty/takeout-recommendations`)
        .then((r) => r.json())
        .then((j) => { console.log("loyalty takeout-recs:", j); setTakeoutRecs(j.data ?? []); })
        .catch((e) => console.error("loyalty takeout-recs error:", e))
        .finally(() => setTakeoutLoading(false));
    }
    if (activeTab === "promo" && smartPromos.length === 0) {
      setPromoLoading(true);
      apiFetch(`${API}/api/loyalty/smart-promotions`)
        .then((r) => r.json())
        .then((j) => { console.log("loyalty smart-promotions:", j); setSmartPromos(j.data ?? []); })
        .catch((e) => console.error("loyalty smart-promotions error:", e))
        .finally(() => setPromoLoading(false));
    }
    if (activeTab === "ilp" && ilpRecs.length === 0) {
      setIlpLoading(true);
      apiFetch(`${API}/api/loyalty/ilp-recommendations`)
        .then((r) => r.json())
        .then((j) => { console.log("loyalty ilp-recs:", j); setIlpRecs(j.data ?? []); })
        .catch((e) => console.error("loyalty ilp-recs error:", e))
        .finally(() => setIlpLoading(false));
    }
    if (activeTab === "history" && history.length === 0) {
      setHistLoading(true);
      apiFetch(`${API}/api/loyalty/history`)
        .then((r) => r.json())
        .then((j) => { console.log("loyalty history:", j); setHistory(j.data ?? []); })
        .catch((e) => console.error("loyalty history error:", e))
        .finally(() => setHistLoading(false));
    }
    if (activeTab === "target") {
      fetchTargets({ bulan: selectedPeriode });
    }
  }, [activeTab, selectedPeriode]); // eslint-disable-line react-hooks/exhaustive-deps

  function refreshAll() {
    fetchSummary(); fetchMembers(); fetchTargets({ bulan: selectedPeriode });
    setNonaktifMembers([]); setTakeoutRecs([]); setSmartPromos([]); setHistory([]);
  }

  const targetsMap = useMemo(() => {
    const m: Record<string, HistoricalTarget> = {};
    for (const t of targets) {
      if (!m[t.id_toko] || t.periode > m[t.id_toko].periode) m[t.id_toko] = t;
    }
    return m;
  }, [targets]);

  const startPeriod = useMemo(() => {
    const p = targets[0]?.periode;
    if (!p) { const n = new Date(); return { bulan: n.getMonth() + 1, tahun: n.getFullYear() }; }
    const [y, mo] = p.split("-");
    return { bulan: parseInt(mo), tahun: parseInt(y) };
  }, [targets]);

  const periodeOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = [];
    const d = new Date(2024, 0, 1);
    const end = new Date(2026, 3, 1);
    while (d <= end) {
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
      opts.push({ value, label });
      d.setMonth(d.getMonth() + 1);
    }
    return opts.reverse();
  }, []);

  // Filtered members for Tab 1
  const filteredMembers = members.filter((m) => {
    if (m.status !== "Aktif") return false;
    if (filterCluster.length > 0 && !filterCluster.includes(m.cluster_pareto)) return false;
    if (filterReward && m.reward_type !== filterReward) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!m.nama_toko.toLowerCase().includes(q) && !m.kabupaten.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  async function applyRewardType(memberId: string, rewardType: string) {
    await apiFetch(`${API}/api/loyalty/members/${memberId}/reward-type`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reward_type: rewardType }),
    });
  }

  async function applyAllPromos() {
    const toApply = smartPromos.filter((p) => p.tipe_promo !== p.promo_aktif);
    if (!toApply.length) return;
    setApplyingAll(true);
    try {
      await Promise.all(toApply.map((p) => applyRewardType(p.id, p.tipe_promo)));
      const r = await apiFetch(`${API}/api/loyalty/smart-promotions`);
      const j = await r.json();
      setSmartPromos(j.data ?? []);
      refreshAll();
    } finally { setApplyingAll(false); }
  }

  // Promo summary stats
  const promoStats = REWARD_TYPES.reduce<Record<string, { count: number; budget: number }>>((acc, t) => {
    const items = smartPromos.filter((p) => p.tipe_promo === t);
    acc[t] = { count: items.length, budget: items.reduce((s, p) => s + p.est_budget, 0) };
    return acc;
  }, {} as Record<string, { count: number; budget: number }>);

  const stdBudget   = smartPromos.reduce((s, p) => s + p.est_budget / Math.max(p.rate, 1) * 5000, 0);
  const smartBudget = smartPromos.reduce((s, p) => s + p.est_budget, 0);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="pt-16 max-w-7xl mx-auto p-6 space-y-6">

        {/* ── MAIN OVERVIEW PAGE (/loyalty without ?tab=) ───────────────── */}
        {activeTab === null && (
          <>

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Loyalty Program</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Monitor peserta · Analisis performa · Tools manajemen
          </p>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
          ) : (
            <>
              <KpiCard
                label="Peserta Aktif" icon={Users} color="#3b82f6"
                value={fmtNum(summary?.total_aktif ?? members.filter((m) => m.status === "Aktif").length)}
                sub={`${summary?.total_nonaktif ?? 0} nonaktif`}
              />
              <KpiCard
                label="Est. Budget/Bulan" icon={Zap} color="#16a34a"
                value={fmtRp(summary?.est_budget_bulan ?? 0)}
                sub="total semua peserta aktif"
              />
              <KpiCard
                label="Perlu Perhatian" icon={AlertCircle} color="#DC2626"
                value={fmtNum((summary?.per_reward_type?.["Emergency Boost"] ?? 0) + (summary?.per_reward_type?.["Retention Boost"] ?? 0))}
                sub="Emergency + Retention Boost"
              />
              <KpiCard
                label="Rekomendasi Take Out" icon={TrendingDown} color="#EA580C"
                value={fmtNum(summary?.rekomendasi_takeout ?? 0)}
                sub="peserta perlu dievaluasi"
              />
              <Link href="/loyalty/promo" className="block">
                <Card className="h-full shadow-sm hover:shadow-md transition-shadow cursor-pointer" style={{ borderBottom: "3px solid #7c3aed" }}>
                  <CardContent className="p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
                      <BarChart2 size={10} color="#7c3aed" />Promo Aktif
                    </p>
                    <p className="text-2xl font-bold leading-none tabular-nums text-purple-700">
                      {promoAktifCount ?? "–"}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-0.5">
                      program berjalan <ChevronRight size={10} />
                    </p>
                  </CardContent>
                </Card>
              </Link>
            </>
          )}
        </div>

        {/* ── Charts Section ─────────────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Chart A — Tren Volume 12 Bulan (full width) */}
          <Card className="shadow-sm w-full overflow-hidden">
            <CardHeader className="border-b border-border pb-3">
              <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <BarChart2 size={13} /> Tren Volume 12 Bulan
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              {insightLoad ? <Skeleton className="h-[300px] w-full rounded-lg" /> : volumeTrend.length === 0 ? (
                <p className="text-xs text-center text-muted-foreground py-16">Tidak ada data</p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={volumeTrend} margin={{ top: 4, right: 40, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06} />
                    <XAxis dataKey="bulan_label" tick={{ fontSize: 9, fill: "currentColor" }} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="vol" tick={{ fontSize: 9, fill: "currentColor" }} tickLine={false} axisLine={false} width={44}
                      tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : `${v}`} />
                    <YAxis yAxisId="pct" orientation="right" domain={[0,120]} tick={{ fontSize: 9, fill: "currentColor" }} tickLine={false} axisLine={false} width={32}
                      tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip
                      contentStyle={{ fontSize: 11 }}
                      formatter={(v: unknown, name: unknown) => {
                        const n = String(name ?? "");
                        if (n === "achievement_pct") return [`${(v as number).toFixed(1)}%`, "Achievement"];
                        if (n === "target_loyalty") return [fmtNum(v as number), "Target"];
                        if (n === "volume_loyalty") return [fmtNum(v as number), "Loyalty"];
                        if (n === "volume_non_loyalty") return [fmtNum(v as number), "Non-Loyalty"];
                        return [`${v}`, n];
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar yAxisId="vol" dataKey="volume_loyalty" name="Loyalty" stackId="v" fill="#3b82f6" opacity={0.8} />
                    <Bar yAxisId="vol" dataKey="volume_non_loyalty" name="Non-Loyalty" stackId="v" fill="#94a3b8" opacity={0.5} />
                    <Line yAxisId="vol" type="monotone" dataKey="target_loyalty" name="Target" stroke="#f97316" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
                    <Line yAxisId="pct" type="monotone" dataKey="achievement_pct" name="achievement_pct" stroke="#8b5cf6" strokeWidth={1.5} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Row 2: Efektivitas (left) + Avg TON (right) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Chart C — Tren Efektivitas 12 Bulan */}
            <Card className="shadow-sm w-full overflow-hidden">
              <CardHeader className="border-b border-border pb-3">
                <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Activity size={13} /> Tren Efektivitas 12 Bulan
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                {insightLoad ? <Skeleton className="h-[240px] w-full rounded-lg" /> : effectTrend.length === 0 ? (
                  <p className="text-xs text-center text-muted-foreground py-12">Tidak ada data</p>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={effectTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06} />
                      <XAxis dataKey="bulan_label" tick={{ fontSize: 9, fill: "currentColor" }} tickLine={false} axisLine={false} />
                      <YAxis domain={[0, 120]} tick={{ fontSize: 9, fill: "currentColor" }} tickLine={false} axisLine={false} width={30}
                        tickFormatter={(v: number) => `${v}%`} />
                      <Tooltip contentStyle={{ fontSize: 11 }}
                        formatter={(v: unknown) => [`${(v as number).toFixed(1)}%`]} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <ReferenceLine y={80} stroke="#DC2626" strokeDasharray="4 2" strokeWidth={1} label={{ value: "80%", fill: "#DC2626", fontSize: 9, position: "insideTopRight" }} />
                      <Line type="monotone" dataKey="efektivitas_pct" name="Efektivitas" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="volume_achievement_pct" name="Vol Achievement" stroke="#3b82f6" strokeWidth={1.5} dot={false} strokeDasharray="3 1" />
                      <Line type="monotone" dataKey="peserta_aktif_pct" name="Keaktifan" stroke="#16a34a" strokeWidth={1.5} dot={false} strokeDasharray="3 1" />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Chart B — Avg TON Loyalty vs Non-Loyalty */}
            <Card className="shadow-sm w-full overflow-hidden">
              <CardHeader className="border-b border-border pb-3">
                <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <BarChart2 size={13} /> Avg TON/Toko — Loyalty vs Non-Loyalty (6 Bln)
                  {avgRatio > 0 && (
                    <span className="ml-auto text-[10px] font-normal normal-case tracking-normal text-green-600 dark:text-green-400">
                      {avgRatio.toFixed(1)}× lebih besar
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                {insightLoad ? <Skeleton className="h-[240px] w-full rounded-lg" /> : comparison.length === 0 ? (
                  <p className="text-xs text-center text-muted-foreground py-12">Tidak ada data</p>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={comparison} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06} />
                      <XAxis dataKey="bulan_label" tick={{ fontSize: 9, fill: "currentColor" }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 9, fill: "currentColor" }} tickLine={false} axisLine={false} width={40}
                        tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}K` : `${v}`} />
                      <Tooltip contentStyle={{ fontSize: 11 }}
                        formatter={(v: unknown, name: unknown) => [
                          `${fmtNum(v as number)} TON/toko`,
                          String(name ?? "") === "avg_ton_loyalty" ? "Peserta Loyalty" : "Non-Loyalty",
                        ]} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Bar dataKey="avg_ton_loyalty" name="Loyalty" fill="#3b82f6" opacity={0.85} radius={[2,2,0,0]} />
                      <Bar dataKey="avg_ton_non_loyalty" name="Non-Loyalty" fill="#94a3b8" opacity={0.6} radius={[2,2,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Navigation grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { href: "/loyalty?tab=peserta",     emoji: "👥", label: "Peserta Aktif",       sub: () => `${summary?.total_aktif ?? 0} toko aktif` },
            { href: "/loyalty?tab=takeout",     emoji: "📤", label: "Toko Takeout",        sub: () => `${summary?.total_nonaktif ?? 0} toko nonaktif` },
            { href: "/loyalty?tab=rekomendasi", emoji: "⚡", label: "Rekomendasi Take Out", sub: () => `${summary?.rekomendasi_takeout ?? 0} perlu dievaluasi` },
            { href: "/loyalty?tab=target",      emoji: "🎯", label: "Target & Achievement", sub: () => "Historis semua periode" },
            { href: "/loyalty?tab=promo",       emoji: "🎁", label: "Smart Promotion",      sub: () => `${summary?.per_reward_type?.["Emergency Boost"] ?? 0} emergency boost` },
            { href: "/loyalty/promo",           emoji: "📋", label: "Program Promo",        sub: () => `${promoAktifCount ?? 0} program berjalan` },
            { href: "/loyalty?tab=ilp",         emoji: "📊", label: "Referensi ILP",        sub: () => "Top rekomendasi optimizer" },
            { href: "/loyalty?tab=history",     emoji: "🕐", label: "History",              sub: () => "Log semua perubahan" },
            { href: "/performance",             emoji: "📈", label: "Performance Tracker",   sub: () => "Monitor outcome toko setelah masuk program" },
          ].map(({ href, emoji, label, sub }) => (
            <Card
              key={href}
              className="cursor-pointer hover:shadow-md transition-all hover:border-primary/30"
              onClick={() => router.push(href)}
            >
              <CardContent className="p-4 flex items-center gap-3">
                <div className="text-2xl shrink-0">{emoji}</div>
                <div className="min-w-0">
                  <div className="font-medium text-sm leading-tight">{label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">{sub()}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

          </> /* end activeTab === null */
        )}

        {/* ── SUB-PAGE BREADCRUMB (/loyalty?tab=xxx) ────────────────────── */}
        {activeTab !== null && (
          <div className="flex items-center gap-2 text-sm">
            <button
              onClick={() => router.push("/loyalty")}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Loyalty
            </button>
            <span className="text-muted-foreground/50">/</span>
            <span className="text-foreground font-medium">{TAB_LABELS[activeTab] ?? activeTab}</span>
          </div>
        )}

        {/* ── Peserta Aktif ─────────────────────────────────────────────────── */}
        {activeTab === "peserta" && (
          <div className="space-y-3">
            {/* Toolbar */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setAddModal(true)} className="bg-green-600 hover:bg-green-700 text-white">
                  <Plus size={14} className="mr-1" /> Tambah Toko
                </Button>
                <Button size="sm" variant="outline" onClick={() => setUploadModal(true)}>
                  <Upload size={14} className="mr-1" /> Upload Excel
                </Button>
                <Button
                  size="sm" variant="outline"
                  onClick={async () => {
                    const r = await apiFetch(`${API}/api/loyalty/template`);
                    const blob = await r.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a"); a.href = url; a.download = "loyalty_template.xlsx"; a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download size={14} className="mr-1" /> Download Template
                </Button>
              </div>
              <span className="text-xs text-muted-foreground">
                {fmtNum(filteredMembers.length)} peserta aktif
              </span>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative flex-1 min-w-[180px]">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring/50"
                  placeholder="Cari nama atau kabupaten…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-1">
                {CLUSTERS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setFilterCluster((p) => p.includes(c) ? p.filter((x) => x !== c) : [...p, c])}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-medium border transition-colors ${
                      filterCluster.includes(c)
                        ? "bg-foreground text-background border-foreground"
                        : "border-border text-muted-foreground hover:border-foreground/50 hover:text-foreground"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <select
                className="px-2.5 py-1.5 text-xs rounded-md border border-border bg-background focus:outline-none"
                value={filterReward}
                onChange={(e) => setFilterReward(e.target.value)}
              >
                <option value="">Semua Reward</option>
                {REWARD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {/* Table */}
            <Card>
              <CardContent className="pt-0 px-0">
                {loading ? (
                  <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 rounded" />)}</div>
                ) : filteredMembers.length === 0 ? (
                  <div className="py-16 text-center">
                    <Users size={32} className="mx-auto mb-3 text-muted-foreground/40" />
                    <p className="text-sm font-medium text-muted-foreground">Belum ada peserta</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">Tambah manual atau upload Excel</p>
                    <Button size="sm" className="mt-4 bg-green-600 hover:bg-green-700 text-white" onClick={() => setAddModal(true)}>
                      <Plus size={13} className="mr-1" /> Tambah Toko
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur-sm">
                        <TableRow className="border-b border-muted/50 hover:bg-transparent">
                          {["Nama Toko","Kabupaten","Cluster","TSO","Tgl Masuk","Reward Type","AEGIS","Target TON","Achievement","Est. Budget/bln",""].map((h) => (
                            <TableHead key={h} className="text-xs uppercase tracking-wider whitespace-nowrap">{h}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredMembers.map((m) => (
                          <TableRow key={m.id} className="hover:bg-muted/30 border-b border-muted/50">
                            <TableCell className="font-medium text-xs max-w-[160px] truncate" title={m.nama_toko}>{m.nama_toko}</TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[130px] truncate">{m.kabupaten.replace(/^KABUPATEN /, "KAB. ")}</TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{m.cluster_pareto}</TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[110px] truncate">{m.tso.replace(/^TSO-\d+ /, "")}</TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{m.tgl_masuk}</TableCell>
                            <TableCell><RewardBadge type={m.reward_type} /></TableCell>
                            <TableCell><LevelBadge level={m.aegis_level ?? "Normal"} /></TableCell>
                            <TableCell className="text-xs tabular-nums whitespace-nowrap text-muted-foreground">
                              {targetsMap[m.id_toko] ? fmtNum(targetsMap[m.id_toko].target_ton) : "–"}
                            </TableCell>
                            <TableCell>
                              {targetsMap[m.id_toko] ? (
                                <StatusBadge status={targetsMap[m.id_toko].status_achievement} />
                              ) : (
                                <span className="text-xs text-muted-foreground">–</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs tabular-nums whitespace-nowrap">{fmtRp(m.est_budget ?? 0)}</TableCell>
                            <TableCell className="pr-3">
                              <div className="flex gap-1.5">
                                <select
                                  className="text-[10px] border border-border rounded px-1.5 py-0.5 bg-background"
                                  value={m.reward_type}
                                  onChange={async (e) => {
                                    await applyRewardType(m.id, e.target.value);
                                    fetchMembers(); fetchSummary();
                                  }}
                                >
                                  {REWARD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                                </select>
                                <button
                                  onClick={() => setTakeoutTarget({ member: m })}
                                  className="px-2 py-0.5 text-[10px] rounded border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30 transition-colors"
                                >
                                  Take Out
                                </button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Toko Takeout ──────────────────────────────────────────────────── */}
        {activeTab === "takeout" && (
          <div className="mt-4">
            <Card>
              <CardContent className="pt-0 px-0">
                {nonaktifLoading ? (
                  <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 rounded" />)}</div>
                ) : nonaktifMembers.length === 0 ? (
                  <div className="py-16 text-center">
                    <Check size={32} className="mx-auto mb-3 text-green-500" />
                    <p className="text-sm font-medium">Belum ada toko yang di-takeout</p>
                    <p className="text-xs text-muted-foreground mt-1">Toko nonaktif akan muncul di sini</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur-sm">
                        <TableRow className="border-b border-muted/50 hover:bg-transparent">
                          {["Nama Toko","Kabupaten","Cluster","Tgl Masuk","Tgl Keluar","Alasan","Aksi"].map((h) => (
                            <TableHead key={h} className="text-xs uppercase tracking-wider whitespace-nowrap">{h}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {nonaktifMembers.map((m) => (
                          <TableRow key={m.id} className="hover:bg-muted/30 border-b border-muted/50">
                            <TableCell className="font-medium text-xs">{m.nama_toko}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{m.kabupaten}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{m.cluster_pareto}</TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(m.tgl_masuk).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {m.tgl_keluar ? new Date(m.tgl_keluar).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "–"}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate" title={m.alasan_keluar ?? ""}>
                              {m.alasan_keluar ?? "–"}
                            </TableCell>
                            <TableCell className="pr-3">
                              <div className="flex gap-1.5">
                                <button
                                  onClick={async () => {
                                    if (!confirm(`Re-enroll ${m.nama_toko}?`)) return;
                                    try {
                                      await apiFetch(`${API}/api/loyalty/members/add-one`, {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({
                                          id_toko: m.id_toko, nama_toko: m.nama_toko,
                                          kabupaten: m.kabupaten, cluster_pareto: m.cluster_pareto,
                                          tso: m.tso, reward_type: m.reward_type, catatan: "Re-enroll",
                                        }),
                                      });
                                      setNonaktifMembers((p) => p.filter((x) => x.id !== m.id));
                                      refreshAll();
                                    } catch { alert("Gagal re-enroll"); }
                                  }}
                                  className="px-2 py-0.5 text-[10px] rounded border border-green-500/50 text-green-600 hover:bg-green-50 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-950/30 whitespace-nowrap"
                                >
                                  Re-enroll
                                </button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Target & Achievement ──────────────────────────────────────────── */}
        {activeTab === "target" && (
          <div className="mt-4 space-y-4">
            {/* Filter bar */}
            <Card className="shadow-sm">
              <CardContent className="p-3">
                <div className="flex flex-wrap gap-2 items-end">
                  {/* Period picker */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">Periode</label>
                    <Select value={selectedPeriode} onValueChange={v => { setSelectedPeriode(v); setTargetPage(0); }}>
                      <SelectTrigger className="h-8 text-xs w-[180px]">
                        <SelectValue placeholder="Pilih Periode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Semua Periode</SelectItem>
                        {periodeOptions.map(p => (
                          <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Cluster */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">Cluster</label>
                    <select value={targetCluster} onChange={e => setTargetCluster(e.target.value)}
                      className="h-8 text-xs border border-border rounded px-2 bg-background">
                      <option value="">Semua</option>
                      <option value="Super Platinum">Super Platinum</option>
                      <option value="Platinum">Platinum</option>
                      <option value="Gold">Gold</option>
                      <option value="Silver">Silver</option>
                      <option value="Bronze">Bronze</option>
                    </select>
                  </div>

                  {/* Status */}
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">Status</label>
                    <select value={targetStatus} onChange={e => setTargetStatus(e.target.value)}
                      className="h-8 text-xs border border-border rounded px-2 bg-background">
                      <option value="">Semua</option>
                      <option value="On Track">On Track</option>
                      <option value="At Risk">At Risk</option>
                      <option value="Below Target">Below Target</option>
                    </select>
                  </div>

                  {/* Search */}
                  <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
                    <label className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">Cari</label>
                    <div className="relative">
                      <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      <input value={targetSearch} onChange={e => setTargetSearch(e.target.value)}
                        placeholder="ID / Nama Toko"
                        className="h-8 text-xs border border-border rounded pl-6 pr-2 bg-background w-full"
                        onKeyDown={e => {
                          if (e.key === "Enter") {
                            setTargetPage(0);
                            fetchTargets({ bulan: selectedPeriode, cluster: targetCluster, status: targetStatus, search: targetSearch, page: 0 });
                          }
                        }}
                      />
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-1.5 items-end pb-0.5">
                    <Button size="sm" onClick={() => {
                      setTargetPage(0);
                      fetchTargets({ bulan: selectedPeriode, cluster: targetCluster, status: targetStatus, search: targetSearch, page: 0 });
                    }}>Terapkan</Button>
                    <Button size="sm" variant="outline" onClick={() => {
                      setSelectedPeriode("2026-04");
                      setTargetCluster(""); setTargetStatus(""); setTargetSearch("");
                      setTargetPage(0); fetchTargets({ bulan: "2026-04", page: 0 });
                    }}>Reset</Button>
                    <Button size="sm" variant="outline" onClick={async () => {
                      const qs = new URLSearchParams();
                      if (selectedPeriode && selectedPeriode !== "all") qs.set("bulan", selectedPeriode);
                      if (targetCluster) qs.set("cluster", targetCluster);
                      if (targetStatus)  qs.set("status",  targetStatus);
                      if (targetSearch)  qs.set("search",  targetSearch);
                      try {
                        const r = await apiFetch(`${API}/api/loyalty/targets/export?${qs}`);
                        const blob = await r.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a"); a.href = url; a.download = "targets.xlsx"; a.click();
                        URL.revokeObjectURL(url);
                      } catch { alert("Export gagal"); }
                    }}>
                      <Download size={13} className="mr-1" /> Export
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setTargetConfigModal(true)}>
                      <Settings size={13} className="mr-1" /> Konfigurasi
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Summary cards */}
            {targetSummary && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Card className="shadow-sm" style={{ borderBottom: "3px solid #16a34a" }}>
                  <CardContent className="p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">On Track (≥90%)</p>
                    <p className="text-3xl font-bold tabular-nums text-green-600">{fmtNum(targetSummary.on_track)}</p>
                    <p className="text-xs text-muted-foreground mt-1">{targetTotal > 0 ? ((targetSummary.on_track / targetTotal) * 100).toFixed(0) : 0}% dari {fmtNum(targetTotal)} record</p>
                  </CardContent>
                </Card>
                <Card className="shadow-sm" style={{ borderBottom: "3px solid #d97706" }}>
                  <CardContent className="p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">At Risk (70–89%)</p>
                    <p className="text-3xl font-bold tabular-nums text-amber-600">{fmtNum(targetSummary.at_risk)}</p>
                    <p className="text-xs text-muted-foreground mt-1">{targetTotal > 0 ? ((targetSummary.at_risk / targetTotal) * 100).toFixed(0) : 0}% dari {fmtNum(targetTotal)} record</p>
                  </CardContent>
                </Card>
                <Card className="shadow-sm" style={{ borderBottom: "3px solid #dc2626" }}>
                  <CardContent className="p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Below Target (&lt;70%)</p>
                    <p className="text-3xl font-bold tabular-nums text-red-600">{fmtNum(targetSummary.below_target)}</p>
                    <p className="text-xs text-muted-foreground mt-1">{targetTotal > 0 ? ((targetSummary.below_target / targetTotal) * 100).toFixed(0) : 0}% dari {fmtNum(targetTotal)} record</p>
                  </CardContent>
                </Card>
                <Card className="shadow-sm" style={{ borderBottom: "3px solid #8b5cf6" }}>
                  <CardContent className="p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Rata-Rata ACH</p>
                    <p className="text-3xl font-bold tabular-nums text-violet-500">{targetSummary.avg_achievement_pct.toFixed(1)}%</p>
                    <p className="text-xs text-muted-foreground mt-1">{fmtNum(targetSummary.total_realisasi_ton)} / {fmtNum(targetSummary.total_target_ton)} TON</p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Table */}
            <Card>
              <CardContent className="pt-0 px-0">
                {targetsLoading ? (
                  <div className="p-4 space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9 rounded" />)}</div>
                ) : targets.length === 0 ? (
                  <div className="py-16 text-center">
                    <Target size={32} className="mx-auto mb-3 text-muted-foreground/40" />
                    <p className="text-sm font-medium text-muted-foreground">Tidak ada data untuk filter ini</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur-sm">
                        <TableRow className="border-b border-muted/50 hover:bg-transparent">
                          {["Periode","ID Toko","Nama Toko","AEGIS","Cluster","Kabupaten","Target TON","Realisasi","ACH%","Status"].map(h => (
                            <TableHead key={h} className="text-xs uppercase tracking-wider whitespace-nowrap">{h}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {targets.map((t, i) => (
                          <TableRow key={`${t.id_toko}-${t.periode}-${i}`} className="hover:bg-muted/30 border-b border-muted/50">
                            <TableCell className="text-xs font-medium whitespace-nowrap">{t.periode_label}</TableCell>
                            <TableCell className="text-xs tabular-nums text-muted-foreground whitespace-nowrap">{t.id_toko}</TableCell>
                            <TableCell className="text-xs max-w-[160px] truncate" title={t.nama_toko}>{t.nama_toko}</TableCell>
                            <TableCell><LevelBadge level={t.aegis_level} /></TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{t.cluster}</TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[130px] truncate" title={t.kabupaten}>{t.kabupaten || "–"}</TableCell>
                            <TableCell className="text-xs tabular-nums font-semibold whitespace-nowrap">{fmtNum(t.target_ton)}</TableCell>
                            <TableCell className="text-xs tabular-nums whitespace-nowrap">{fmtNum(t.realisasi_ton)}</TableCell>
                            <TableCell>
                              <span className={`text-sm font-bold tabular-nums ${
                                t.achievement_pct >= 90 ? "text-green-600" :
                                t.achievement_pct >= 70 ? "text-amber-600" : "text-red-600"
                              }`}>{t.achievement_pct.toFixed(1)}%</span>
                            </TableCell>
                            <TableCell><StatusBadge status={t.status_achievement} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Pagination */}
            {targetTotal > TARGET_PAGE_SIZE && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{fmtNum(targetTotal)} total record · Halaman {targetPage + 1} dari {Math.ceil(targetTotal / TARGET_PAGE_SIZE)}</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" disabled={targetPage === 0}
                    onClick={() => {
                      const p = targetPage - 1; setTargetPage(p);
                      fetchTargets({ bulan: selectedPeriode, cluster: targetCluster, status: targetStatus, search: targetSearch, page: p });
                    }}>
                    ‹ Prev
                  </Button>
                  <Button size="sm" variant="outline" disabled={(targetPage + 1) * TARGET_PAGE_SIZE >= targetTotal}
                    onClick={() => {
                      const p = targetPage + 1; setTargetPage(p);
                      fetchTargets({ bulan: selectedPeriode, cluster: targetCluster, status: targetStatus, search: targetSearch, page: p });
                    }}>
                    Next ›
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Rekomendasi Take Out ──────────────────────────────────────────── */}
        {activeTab === "rekomendasi" && (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg bg-muted/50 border border-border p-3 text-xs text-muted-foreground flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5 text-amber-500" />
              <div>
                Sistem mendeteksi <strong>{takeoutRecs.length} peserta</strong> yang memenuhi kriteria take-out.
                Kriteria: <span className="font-medium">Volume Turun &gt;30%</span> (+3) ·
                <span className="font-medium"> Tidak Aktif 60 hari</span> (+4) ·
                <span className="font-medium"> Sudah Normal</span> (+2) ·
                <span className="font-medium"> Efisiensi Rendah</span> (+1) — skor ≥ 3 direkomendasikan.
              </div>
            </div>

            {takeoutRecs.length > 0 && (
              <Button
                size="sm"
                className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                onClick={async () => {
                  if (!confirm(`Take out semua ${takeoutRecs.length} peserta?`)) return;
                  for (const r of takeoutRecs) {
                    await apiFetch(`${API}/api/loyalty/members/${r.id}/take-out`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ alasan: r.alasan[0] ?? "Sistem", catatan: "" }),
                    });
                  }
                  setTakeoutRecs([]);
                  refreshAll();
                }}
              >
                Take Out Semua Rekomendasi ({takeoutRecs.length})
              </Button>
            )}

            <Card>
              <CardContent className="pt-0 px-0">
                {takeoutLoading ? (
                  <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 rounded" />)}</div>
                ) : takeoutRecs.length === 0 ? (
                  <div className="py-16 text-center">
                    <Check size={32} className="mx-auto mb-3 text-green-500" />
                    <p className="text-sm font-medium">Tidak ada peserta yang perlu di-take out saat ini</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur-sm">
                        <TableRow className="border-b border-muted/50 hover:bg-transparent">
                          {["Nama Toko","Cluster","Alasan","Skor","Budget Dihemat/bln",""].map((h) => (
                            <TableHead key={h} className="text-xs uppercase tracking-wider">{h}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {takeoutRecs.map((r) => (
                          <TableRow key={r.id_toko} className="hover:bg-muted/30 border-b border-muted/50">
                            <TableCell className="font-medium text-xs">{r.nama_toko}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{r.cluster_pareto}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {r.alasan.map((a) => (
                                  <span key={a} className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                                    {a}
                                  </span>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm font-bold text-amber-600 dark:text-amber-400">{r.skor}</span>
                            </TableCell>
                            <TableCell className="text-xs tabular-nums text-green-600 dark:text-green-400 font-medium">
                              {fmtRp(r.budget_dihemat)}/bln
                            </TableCell>
                            <TableCell className="pr-3">
                              <div className="flex gap-1.5">
                                <button
                                  onClick={() => setTakeoutTarget({ member: r, system: r.alasan })}
                                  className="px-2 py-0.5 text-[10px] rounded border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
                                >
                                  Take Out
                                </button>
                                <button
                                  onClick={() => setTakeoutRecs((p) => p.filter((x) => x.id_toko !== r.id_toko))}
                                  className="px-2 py-0.5 text-[10px] rounded border border-border text-muted-foreground hover:bg-muted"
                                >
                                  Abaikan
                                </button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Smart Promotion ───────────────────────────────────────────────── */}
        {activeTab === "promo" && (
          <div className="mt-4 space-y-3">
            {/* Summary cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {REWARD_TYPES.map((t) => {
                const s = REWARD_STYLE[t];
                const stat = promoStats[t] ?? { count: 0, budget: 0 };
                return (
                  <div key={t} className="rounded-lg border p-3" style={{ borderColor: s.border, backgroundColor: s.bg }}>
                    <p className="text-[10px] font-bold" style={{ color: s.text }}>{t}</p>
                    <p className="text-lg font-bold tabular-nums mt-1" style={{ color: s.text }}>{stat.count} toko</p>
                    <p className="text-[10px]" style={{ color: s.text, opacity: 0.7 }}>{fmtRp(stat.budget)}/bln</p>
                  </div>
                );
              })}
            </div>

            {smartPromos.length > 0 && (
              <div className="rounded-md bg-muted/50 border border-border px-3 py-2 text-xs text-muted-foreground flex flex-wrap gap-4">
                <span>Budget Standard: <strong>{fmtRp(stdBudget)}</strong></span>
                <span>Dengan Smart Promo: <strong>{fmtRp(smartBudget)}</strong></span>
                <span className={smartBudget > stdBudget ? "text-amber-600" : "text-green-600"}>
                  Selisih: {fmtRp(Math.abs(smartBudget - stdBudget))}
                  {smartBudget > stdBudget ? " lebih tinggi" : " lebih hemat"}
                </span>
              </div>
            )}

            {smartPromos.filter((p) => p.tipe_promo !== p.promo_aktif).length > 0 && (
              <Button size="sm" onClick={applyAllPromos} disabled={applyingAll}>
                {applyingAll ? "Menerapkan…" : `Terapkan Semua Rekomendasi (${smartPromos.filter((p) => p.tipe_promo !== p.promo_aktif).length})`}
              </Button>
            )}

            <Card>
              <CardContent className="pt-0 px-0">
                {promoLoading ? (
                  <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 rounded" />)}</div>
                ) : smartPromos.length === 0 ? (
                  <div className="py-16 text-center">
                    <Zap size={32} className="mx-auto mb-3 text-muted-foreground/40" />
                    <p className="text-sm font-medium text-muted-foreground">Tambah peserta untuk melihat rekomendasi promo</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur-sm">
                        <TableRow className="border-b border-muted/50 hover:bg-transparent">
                          {["Nama Toko","Cluster","AEGIS","Achievement","Promo Aktif","Rekomendasi","Est. Budget","ROI",""].map((h) => (
                            <TableHead key={h} className="text-xs uppercase tracking-wider whitespace-nowrap">{h}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {smartPromos.map((p) => {
                          const diff = p.tipe_promo !== p.promo_aktif;
                          return (
                            <TableRow
                              key={p.id}
                              className={`hover:bg-muted/30 border-b border-muted/50 ${diff ? "bg-amber-50/40 dark:bg-amber-950/20" : ""}`}
                            >
                              <TableCell className="font-medium text-xs max-w-[140px] truncate" title={p.nama_toko}>{p.nama_toko}</TableCell>
                              <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{p.cluster_pareto}</TableCell>
                              <TableCell>
                                <span className="text-xs tabular-nums">{p.aegis_score.toFixed(1)}</span>
                                {" "}
                                <LevelBadge level={p.level} />
                              </TableCell>
                              <TableCell>
                                {targetsMap[p.id_toko] ? (
                                  <span className={`text-xs font-medium tabular-nums ${
                                    targetsMap[p.id_toko].achievement_pct >= 90 ? "text-green-600" :
                                    targetsMap[p.id_toko].achievement_pct >= 70 ? "text-amber-600" : "text-red-600"
                                  }`}>
                                    {targetsMap[p.id_toko].achievement_pct.toFixed(1)}%
                                  </span>
                                ) : <span className="text-xs text-muted-foreground">–</span>}
                              </TableCell>
                              <TableCell><RewardBadge type={p.promo_aktif} /></TableCell>
                              <TableCell><RewardBadge type={p.tipe_promo} /></TableCell>
                              <TableCell className="text-xs tabular-nums whitespace-nowrap">{fmtRp(p.est_budget)}</TableCell>
                              <TableCell className="text-xs tabular-nums text-muted-foreground">{p.est_roi.toFixed(1)}×</TableCell>
                              <TableCell className="pr-3">
                                {diff ? (
                                  <button
                                    onClick={async () => {
                                      await applyRewardType(p.id, p.tipe_promo);
                                      setSmartPromos((prev) => prev.map((x) => x.id === p.id ? { ...x, promo_aktif: p.tipe_promo } : x));
                                      fetchMembers(); fetchSummary();
                                    }}
                                    className="px-2 py-0.5 text-[10px] rounded border border-primary/50 text-primary hover:bg-primary/10 whitespace-nowrap"
                                  >
                                    Terapkan
                                  </button>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Referensi ILP ─────────────────────────────────────────────────── */}
        {activeTab === "ilp" && (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 p-3 flex items-start gap-2">
              <BookOpen size={14} className="shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
              <div className="text-xs text-blue-700 dark:text-blue-300">
                <strong>Top 50 rekomendasi ILP yang belum masuk program.</strong>
                {" "}Ini hanya referensi — keputusan penambahan tetap dilakukan manual.
              </div>
            </div>

            <Card>
              <CardContent className="pt-0 px-0">
                {ilpLoading ? (
                  <div className="p-4 space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 rounded" />)}</div>
                ) : ilpRecs.length === 0 ? (
                  <div className="py-16 text-center">
                    <BookOpen size={32} className="mx-auto mb-3 text-muted-foreground/40" />
                    <p className="text-sm font-medium text-muted-foreground">Jalankan ILP Optimizer untuk melihat rekomendasi</p>
                    <Button
                      size="sm" variant="outline" className="mt-4"
                      onClick={() => router.push("/ilp")}
                    >
                      Buka ILP Optimizer <ChevronRight size={13} className="ml-1" />
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur-sm">
                        <TableRow className="border-b border-muted/50 hover:bg-transparent">
                          {["Nama Toko","Kabupaten","Cluster","ILP Score","AEGIS","Est. Cost/bln",""].map((h) => (
                            <TableHead key={h} className="text-xs uppercase tracking-wider whitespace-nowrap">{h}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {ilpRecs.map((r) => (
                          <TableRow key={r.id_toko} className="hover:bg-muted/30 border-b border-muted/50">
                            <TableCell className="font-medium text-xs max-w-[160px] truncate" title={r.nama_toko}>{r.nama_toko}</TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">{r.kabupaten.replace(/^KABUPATEN /, "KAB. ")}</TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{r.cluster_pareto}</TableCell>
                            <TableCell className="text-xs tabular-nums font-semibold">{r.ilp_score.toFixed(1)}</TableCell>
                            <TableCell><LevelBadge level={r.aegis_level} /></TableCell>
                            <TableCell className="text-xs tabular-nums whitespace-nowrap">{fmtRp(r.est_cost_bln)}</TableCell>
                            <TableCell className="pr-3">
                              <button
                                onClick={() => {
                                  setPrefillStore(r);
                                  setAddModal(true);
                                }}
                                className="px-2 py-0.5 text-[10px] rounded border border-green-500/50 text-green-600 hover:bg-green-50 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-950/30 whitespace-nowrap"
                              >
                                Tambah ke Program
                              </button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── History ───────────────────────────────────────────────────────── */}
        {activeTab === "history" && (
          <div className="mt-4">
            <Card>
              <CardContent className="pt-0 px-0">
                {histLoading ? (
                  <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 rounded" />)}</div>
                ) : history.length === 0 ? (
                  <div className="py-16 text-center">
                    <Clock size={32} className="mx-auto mb-3 text-muted-foreground/40" />
                    <p className="text-sm font-medium text-muted-foreground">Belum ada riwayat perubahan</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur-sm">
                        <TableRow className="border-b border-muted/50 hover:bg-transparent">
                          {["Tanggal","Nama Toko","Perubahan","Alasan","Status Baru"].map((h) => (
                            <TableHead key={h} className="text-xs uppercase tracking-wider whitespace-nowrap">{h}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {history.map((h, i) => (
                          <TableRow key={i} className="hover:bg-muted/30 border-b border-muted/50">
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {new Date(h.tanggal).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </TableCell>
                            <TableCell className="text-xs font-medium max-w-[150px] truncate" title={h.nama_toko}>{h.nama_toko}</TableCell>
                            <TableCell className="text-xs">{h.perubahan}</TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate" title={h.alasan}>{h.alasan}</TableCell>
                            <TableCell>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                h.status_baru === "Aktif"
                                  ? "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400"
                                  : "bg-muted text-muted-foreground"
                              }`}>
                                {h.status_baru}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      {/* Modals */}
      {addModal && (
        <AddMemberModal
          onClose={() => { setAddModal(false); setPrefillStore(null); }}
          onAdded={refreshAll}
          prefill={prefillStore ? {
            id_toko: prefillStore.id_toko, nama_toko: prefillStore.nama_toko,
            kabupaten: prefillStore.kabupaten, cluster_pareto: prefillStore.cluster_pareto,
            tso: prefillStore.tso, aegis_score: prefillStore.aegis_score,
            aegis_level: prefillStore.aegis_level, avg_ton_bulanan: prefillStore.avg_ton_bulanan,
          } as Partial<StoreSearch> : undefined}
        />
      )}
      {uploadModal && (
        <UploadExcelModal onClose={() => setUploadModal(false)} onDone={refreshAll} />
      )}
      {takeoutTarget && (
        <TakeOutModal
          member={takeoutTarget.member}
          systemAlasan={takeoutTarget.system}
          onClose={() => setTakeoutTarget(null)}
          onDone={refreshAll}
        />
      )}
      {targetConfigModal && (
        <TargetConfigModal
          config={targetConfig}
          startPeriod={startPeriod}
          onClose={() => setTargetConfigModal(false)}
          onSaved={(cfg) => { setTargetConfig(cfg); fetchTargets(); }}
        />
      )}
    </div>
  );
}

export default function LoyaltyPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoyaltyContent />
    </Suspense>
  );
}
