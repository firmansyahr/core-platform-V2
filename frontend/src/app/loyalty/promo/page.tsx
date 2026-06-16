"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, Search, X, Calendar, Users, Zap, TrendingUp, AlertCircle,
  ChevronRight, BarChart2, Check, ExternalLink,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const fmtRp  = (n: number) => "Rp " + new Intl.NumberFormat("id-ID").format(Math.round(n));
const fmtNum = (n: number) => new Intl.NumberFormat("id-ID").format(n);
const fmtDate = (d: string) => {
  if (!d) return "–";
  const [y, m, day] = d.split("-");
  const months = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
  return `${day} ${months[+m - 1]} ${y}`;
};

// ── Types ────────────────────────────────────────────────────────────────────

interface SummaryPeserta {
  total_toko: number;
  per_cluster: Record<string, number>;
  estimasi_budget_total: number;
}

interface FinalSummary {
  overall_achievement_pct: number;
  total_reward_earned: number;
  total_peserta: number;
  peserta_aktif_transaksi: number;
}

interface Promo {
  id: string;
  nama_promo: string;
  deskripsi: string;
  jenis_promo: string;
  status: string;
  periode_mulai: string;
  periode_selesai: string;
  created_by: string;
  created_at: string;
  konfigurasi_promo: {
    reward_rate:  { enabled: boolean; mode: string; flat_rate: number; per_cluster_rates: Record<string, number> };
    target_bonus: { enabled: boolean; threshold_pct: number; bonus_rate: number };
    cashback:     { enabled: boolean; cashback_pct: number };
  };
  summary_peserta: SummaryPeserta;
  final_summary?: FinalSummary;
}

// ── Badge components ──────────────────────────────────────────────────────────

const STATUS_META: Record<string, { bg: string; text: string; dot: string }> = {
  Draft:      { bg: "bg-gray-100",   text: "text-gray-700",   dot: "bg-gray-400"  },
  Aktif:      { bg: "bg-green-100",  text: "text-green-700",  dot: "bg-green-500" },
  Selesai:    { bg: "bg-blue-100",   text: "text-blue-700",   dot: "bg-blue-500"  },
  Dibatalkan: { bg: "bg-red-100",    text: "text-red-700",    dot: "bg-red-400"   },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.Draft;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${m.bg} ${m.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot} ${status === "Aktif" ? "animate-pulse" : ""}`} />
      {status}
    </span>
  );
}

const JENIS_META: Record<string, { label: string; bg: string; text: string }> = {
  reward_rate:  { label: "Reward Rate",  bg: "bg-purple-100", text: "text-purple-700" },
  target_bonus: { label: "Target Bonus", bg: "bg-amber-100",  text: "text-amber-700"  },
  cashback:     { label: "Cashback",     bg: "bg-sky-100",    text: "text-sky-700"    },
  kombinasi:    { label: "Kombinasi",    bg: "bg-pink-100",   text: "text-pink-700"   },
};

function JenisBadge({ jenis }: { jenis: string }) {
  const m = JENIS_META[jenis] ?? { label: jenis, bg: "bg-gray-100", text: "text-gray-700" };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${m.bg} ${m.text}`}>
      {m.label}
    </span>
  );
}

// ── Modal wrapper ─────────────────────────────────────────────────────────────

function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col z-10">
        {children}
      </div>
    </div>
  );
}

// ── CreatePromoModal ───────────────────────────────────────────────────────────

const CLUSTERS = ["Super Platinum", "Platinum", "Gold", "Silver", "Bronze"];

const DEFAULT_FORM = {
  nama_promo:      "",
  deskripsi:       "",
  periode_mulai:   "",
  periode_selesai: "",
  reward_rate_enabled:  true,
  rr_mode:              "flat" as "flat" | "per_cluster" | "per_toko",
  rr_flat_rate:         10000,
  rr_per_cluster:       { "Super Platinum": 15000, Platinum: 12000, Gold: 10000, Silver: 8000, Bronze: 6000 } as Record<string, number>,
  target_bonus_enabled: false,
  tb_threshold:         100,
  tb_bonus_rate:        2000,
  cashback_enabled:     false,
  cb_cashback_pct:      2.0,
};

function CreatePromoModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  function setF<K extends keyof typeof DEFAULT_FORM>(k: K, v: typeof DEFAULT_FORM[K]) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  function buildPayload() {
    return {
      nama_promo:       form.nama_promo,
      deskripsi:        form.deskripsi,
      periode_mulai:    form.periode_mulai,
      periode_selesai:  form.periode_selesai,
      konfigurasi_promo: {
        reward_rate: {
          enabled:           form.reward_rate_enabled,
          mode:              form.rr_mode,
          flat_rate:         form.rr_flat_rate,
          per_cluster_rates: form.rr_per_cluster,
        },
        target_bonus: {
          enabled:       form.target_bonus_enabled,
          threshold_pct: form.tb_threshold,
          bonus_rate:    form.tb_bonus_rate,
        },
        cashback: {
          enabled:      form.cashback_enabled,
          cashback_pct: form.cb_cashback_pct,
        },
      },
    };
  }

  async function handleSave() {
    setSaving(true); setErr("");
    try {
      const r = await fetch(`${API}/api/promo/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload()),
      });
      if (!r.ok) {
        const j = await r.json();
        setErr(j.detail || "Gagal membuat promo");
        return;
      }
      onCreated();
    } catch {
      setErr("Koneksi gagal");
    } finally {
      setSaving(false);
    }
  }

  // Estimate budget
  function estBudget() {
    let b = 0;
    if (form.reward_rate_enabled) {
      if (form.rr_mode === "flat") b += 50 * form.rr_flat_rate;
    }
    if (form.target_bonus_enabled) b += 50 * form.tb_bonus_rate;
    if (form.cashback_enabled) b += 50 * 800000 * form.cb_cashback_pct / 100;
    return b;
  }

  const step1Valid = form.nama_promo.trim().length > 0 && form.periode_mulai && form.periode_selesai
    && form.periode_selesai >= form.periode_mulai;

  return (
    <Modal open onClose={onClose}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div>
          <h2 className="font-semibold text-base">Buat Program Promo Baru</h2>
          <p className="text-xs text-muted-foreground">Langkah {step} dari 3</p>
        </div>
        <div className="flex items-center gap-2">
          {[1,2,3].map(s => (
            <div key={s} className={`w-8 h-1.5 rounded-full transition-colors ${s === step ? "bg-purple-600" : s < step ? "bg-purple-300" : "bg-gray-200"}`} />
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

        {/* ── Step 1: Info Dasar ── */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1">Nama Program <span className="text-red-500">*</span></label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="mis. Promo Lebaran 2026"
                value={form.nama_promo}
                onChange={e => setF("nama_promo", e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Deskripsi</label>
              <textarea
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none"
                rows={2}
                placeholder="Keterangan program promo..."
                value={form.deskripsi}
                onChange={e => setF("deskripsi", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1">Periode Mulai <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  value={form.periode_mulai}
                  onChange={e => setF("periode_mulai", e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Periode Selesai <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                  value={form.periode_selesai}
                  min={form.periode_mulai}
                  onChange={e => setF("periode_selesai", e.target.value)}
                />
              </div>
            </div>
            {form.periode_mulai && form.periode_selesai && (
              <div className="text-xs text-muted-foreground bg-gray-50 rounded-lg px-3 py-2 flex items-center gap-1.5">
                <Calendar size={12} />
                Durasi: {Math.max(0, Math.round((new Date(form.periode_selesai).getTime() - new Date(form.periode_mulai).getTime()) / 86400000) + 1)} hari
              </div>
            )}
          </div>
        )}

        {/* ── Step 2: Konfigurasi ── */}
        {step === 2 && (
          <div className="space-y-5">
            {/* Reward Rate */}
            <div className="border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Reward Rate</p>
                  <p className="text-xs text-muted-foreground">Reward per TON yang direalisasi</p>
                </div>
                <button
                  className={`relative inline-flex w-11 h-6 rounded-full transition-colors ${form.reward_rate_enabled ? "bg-purple-600" : "bg-gray-300"}`}
                  onClick={() => setF("reward_rate_enabled", !form.reward_rate_enabled)}
                >
                  <span className={`inline-block w-4 h-4 rounded-full bg-white shadow transition-transform m-1 ${form.reward_rate_enabled ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>
              {form.reward_rate_enabled && (
                <div className="space-y-3 pt-1">
                  <div className="flex gap-2">
                    {(["flat","per_cluster","per_toko"] as const).map(m => (
                      <button
                        key={m}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${form.rr_mode === m ? "bg-purple-600 text-white border-purple-600" : "border-gray-300 text-gray-600 hover:border-purple-400"}`}
                        onClick={() => setF("rr_mode", m)}
                      >
                        {m === "flat" ? "Flat" : m === "per_cluster" ? "Per Cluster" : "Per Toko"}
                      </button>
                    ))}
                  </div>
                  {form.rr_mode === "flat" && (
                    <div>
                      <label className="block text-xs font-medium mb-1">Rate (Rp/ton)</label>
                      <input
                        type="number"
                        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                        value={form.rr_flat_rate}
                        onChange={e => setF("rr_flat_rate", +e.target.value)}
                      />
                    </div>
                  )}
                  {(form.rr_mode === "per_cluster" || form.rr_mode === "per_toko") && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium">Rate per Cluster (Rp/ton)</p>
                      {CLUSTERS.map(cl => (
                        <div key={cl} className="flex items-center gap-3">
                          <label className="text-xs w-28 text-gray-600">{cl}</label>
                          <input
                            type="number"
                            className="flex-1 border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                            value={form.rr_per_cluster[cl] ?? 0}
                            onChange={e => setF("rr_per_cluster", { ...form.rr_per_cluster, [cl]: +e.target.value })}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Target Bonus */}
            <div className="border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Target Bonus</p>
                  <p className="text-xs text-muted-foreground">Bonus tambahan saat mencapai threshold</p>
                </div>
                <button
                  className={`relative inline-flex w-11 h-6 rounded-full transition-colors ${form.target_bonus_enabled ? "bg-amber-500" : "bg-gray-300"}`}
                  onClick={() => setF("target_bonus_enabled", !form.target_bonus_enabled)}
                >
                  <span className={`inline-block w-4 h-4 rounded-full bg-white shadow transition-transform m-1 ${form.target_bonus_enabled ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>
              {form.target_bonus_enabled && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-xs font-medium mb-1">Threshold (%)</label>
                    <input
                      type="number"
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                      value={form.tb_threshold}
                      onChange={e => setF("tb_threshold", +e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Bonus Rate (Rp/ton)</label>
                    <input
                      type="number"
                      className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                      value={form.tb_bonus_rate}
                      onChange={e => setF("tb_bonus_rate", +e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Cashback */}
            <div className="border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">Cashback</p>
                  <p className="text-xs text-muted-foreground">Persentase cashback dari nilai transaksi</p>
                </div>
                <button
                  className={`relative inline-flex w-11 h-6 rounded-full transition-colors ${form.cashback_enabled ? "bg-sky-500" : "bg-gray-300"}`}
                  onClick={() => setF("cashback_enabled", !form.cashback_enabled)}
                >
                  <span className={`inline-block w-4 h-4 rounded-full bg-white shadow transition-transform m-1 ${form.cashback_enabled ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>
              {form.cashback_enabled && (
                <div className="pt-1">
                  <label className="block text-xs font-medium mb-1">Cashback (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
                    value={form.cb_cashback_pct}
                    onChange={e => setF("cb_cashback_pct", +e.target.value)}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Step 3: Review ── */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Nama Program</span>
                <span className="font-medium">{form.nama_promo}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Periode</span>
                <span className="font-medium">{fmtDate(form.periode_mulai)} – {fmtDate(form.periode_selesai)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Komponen Reward</p>
              {form.reward_rate_enabled && (
                <div className="flex items-center justify-between border rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-purple-500" />
                    <span className="text-sm font-medium">Reward Rate</span>
                    <span className="text-xs text-muted-foreground">
                      {form.rr_mode === "flat" ? `Flat Rp ${fmtNum(form.rr_flat_rate)}/ton` : `Per ${form.rr_mode === "per_cluster" ? "Cluster" : "Toko"}`}
                    </span>
                  </div>
                  <Check size={16} className="text-green-500" />
                </div>
              )}
              {form.target_bonus_enabled && (
                <div className="flex items-center justify-between border rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-500" />
                    <span className="text-sm font-medium">Target Bonus</span>
                    <span className="text-xs text-muted-foreground">
                      ≥{form.tb_threshold}% → +Rp {fmtNum(form.tb_bonus_rate)}/ton
                    </span>
                  </div>
                  <Check size={16} className="text-green-500" />
                </div>
              )}
              {form.cashback_enabled && (
                <div className="flex items-center justify-between border rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-sky-500" />
                    <span className="text-sm font-medium">Cashback</span>
                    <span className="text-xs text-muted-foreground">{form.cb_cashback_pct}% dari nilai transaksi</span>
                  </div>
                  <Check size={16} className="text-green-500" />
                </div>
              )}
              {!form.reward_rate_enabled && !form.target_bonus_enabled && !form.cashback_enabled && (
                <p className="text-xs text-red-500 px-1">Minimal satu komponen reward harus aktif</p>
              )}
            </div>

            <div className="bg-purple-50 rounded-xl p-4">
              <p className="text-xs text-muted-foreground mb-1">Estimasi Budget (50 toko, 100% achievement)</p>
              <p className="text-xl font-bold text-purple-700">{fmtRp(estBudget())}</p>
            </div>

            {err && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-6 py-4 border-t">
        <Button variant="outline" size="sm" onClick={step === 1 ? onClose : () => setStep(s => s - 1)}>
          {step === 1 ? "Batal" : "← Kembali"}
        </Button>
        <div className="flex gap-2">
          {step < 3 && (
            <Button
              size="sm"
              className="bg-purple-600 hover:bg-purple-700"
              disabled={step === 1 && !step1Valid}
              onClick={() => setStep(s => s + 1)}
            >
              Lanjut →
            </Button>
          )}
          {step === 3 && (
            <Button
              size="sm"
              className="bg-purple-600 hover:bg-purple-700"
              disabled={saving || (!form.reward_rate_enabled && !form.target_bonus_enabled && !form.cashback_enabled)}
              onClick={handleSave}
            >
              {saving ? "Menyimpan..." : "Simpan sebagai Draft"}
            </Button>
          )}
        </div>
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
            {loading ? "..." : "Ya, Lanjutkan"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color, icon: Icon }: {
  label: string; value: string; sub: string; color: string;
  icon: React.ElementType;
}) {
  return (
    <Card className="shadow-sm" style={{ borderBottom: `3px solid ${color}` }}>
      <CardContent className="p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
          <Icon size={10} color={color} />{label}
        </p>
        <p className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</p>
        <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PromoListPage() {
  const router = useRouter();
  const [promos, setPromos]       = useState<Promo[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const [confirm, setConfirm]     = useState<null | { msg: string; action: () => Promise<void> }>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const fetchPromos = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/promo`);
      const j = await r.json();
      setPromos(j.data ?? []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchPromos(); }, [fetchPromos]);

  // Derived KPIs
  const aktif     = promos.filter(p => p.status === "Aktif");
  const selesai   = promos.filter(p => p.status === "Selesai");
  const totalPesertaAktif = aktif.reduce((s, p) => s + (p.summary_peserta?.total_toko ?? 0), 0);
  const totalBudgetAktif  = aktif.reduce((s, p) => s + (p.summary_peserta?.estimasi_budget_total ?? 0), 0);
  const avgAch = selesai.length > 0
    ? selesai.reduce((s, p) => s + (p.final_summary?.overall_achievement_pct ?? 0), 0) / selesai.length
    : null;

  const filtered = promos.filter(p => {
    if (filterStatus && p.status !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!p.nama_promo.toLowerCase().includes(q) && !p.id.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  async function runAction(action: () => Promise<void>, msg: string) {
    setConfirm({ msg, action });
  }

  async function execConfirm() {
    if (!confirm) return;
    setConfirmLoading(true);
    try { await confirm.action(); fetchPromos(); }
    catch { /* ignore */ }
    finally { setConfirmLoading(false); setConfirm(null); }
  }

  async function handleActivate(id: string) {
    await runAction(async () => {
      const r = await fetch(`${API}/api/promo/${id}/activate`, { method: "POST" });
      if (!r.ok) { const j = await r.json(); throw new Error(j.detail); }
    }, "Aktifkan promo ini? Pastikan peserta sudah disiapkan.");
  }

  async function handleComplete(id: string) {
    await runAction(async () => {
      const r = await fetch(`${API}/api/promo/${id}/complete`, { method: "POST" });
      if (!r.ok) { const j = await r.json(); throw new Error(j.detail); }
    }, "Selesaikan promo ini? Achievement final akan dihitung dari data transaksi.");
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      {showCreate && (
        <CreatePromoModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); fetchPromos(); }} />
      )}
      {confirm && (
        <Confirm
          message={confirm.msg}
          onConfirm={execConfirm}
          onCancel={() => setConfirm(null)}
          loading={confirmLoading}
        />
      )}

      <main className="pt-16 max-w-7xl mx-auto px-6 py-8 space-y-6">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link href="/loyalty" className="hover:text-foreground">Loyalty</Link>
          <ChevronRight size={12} />
          <span className="text-foreground font-medium">Pengelolaan Promo</span>
        </nav>

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Pengelolaan Promo</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Buat dan monitor program promo untuk peserta loyalty</p>
          </div>
          <Button className="bg-purple-600 hover:bg-purple-700 gap-2" onClick={() => setShowCreate(true)}>
            <Plus size={16} />Buat Promo Baru
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {loading ? (
            Array.from({length: 4}).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
          ) : (
            <>
              <KpiCard label="Promo Aktif"        value={fmtNum(aktif.length)}             sub="sedang berjalan"            color="#16a34a" icon={Zap} />
              <KpiCard label="Total Peserta Aktif" value={fmtNum(totalPesertaAktif)}        sub="toko dalam promo aktif"     color="#3b82f6" icon={Users} />
              <KpiCard label="Budget Berjalan"     value={fmtRp(totalBudgetAktif)}          sub="estimasi promo aktif"       color="#7c3aed" icon={TrendingUp} />
              <KpiCard
                label="Avg Achievement"
                value={avgAch !== null ? `${avgAch.toFixed(1)}%` : "–"}
                sub={`dari ${selesai.length} promo selesai`}
                color="#D97706"
                icon={BarChart2}
              />
            </>
          )}
        </div>

        {/* Filter */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              className="w-full border rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              placeholder="Cari nama promo atau ID..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2"><X size={14} className="text-muted-foreground" /></button>}
          </div>
          <div className="flex gap-1.5">
            {["", "Draft", "Aktif", "Selesai", "Dibatalkan"].map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filterStatus === s ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
              >
                {s || "Semua"}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground ml-auto">{filtered.length} program</span>
        </div>

        {/* Table */}
        <Card className="shadow-sm">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Program</TableHead>
                  <TableHead className="text-xs">Jenis</TableHead>
                  <TableHead className="text-xs">Periode</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs text-right">Peserta</TableHead>
                  <TableHead className="text-xs text-right">Achievement</TableHead>
                  <TableHead className="text-xs text-right">Est. Budget</TableHead>
                  <TableHead className="text-xs">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({length: 4}).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({length: 8}).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-20" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-12 text-sm">
                      {search || filterStatus ? "Tidak ada promo yang cocok dengan filter" : "Belum ada program promo. Klik 'Buat Promo Baru' untuk memulai."}
                    </TableCell>
                  </TableRow>
                ) : filtered.map(p => (
                  <TableRow key={p.id} className="group">
                    <TableCell>
                      <Link href={`/loyalty/promo/${p.id}`} className="font-medium text-sm hover:text-purple-600 hover:underline">
                        {p.nama_promo}
                      </Link>
                      <p className="text-[10px] text-muted-foreground">{p.id}</p>
                    </TableCell>
                    <TableCell><JenisBadge jenis={p.jenis_promo} /></TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {fmtDate(p.periode_mulai)} –<br />{fmtDate(p.periode_selesai)}
                    </TableCell>
                    <TableCell><StatusBadge status={p.status} /></TableCell>
                    <TableCell className="text-right text-sm font-medium">
                      {fmtNum(p.summary_peserta?.total_toko ?? 0)}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {p.status === "Selesai" && p.final_summary ? (
                        <span className={`font-semibold ${p.final_summary.overall_achievement_pct >= 100 ? "text-green-600" : p.final_summary.overall_achievement_pct >= 80 ? "text-amber-600" : "text-red-600"}`}>
                          {p.final_summary.overall_achievement_pct.toFixed(1)}%
                        </span>
                      ) : p.status === "Aktif" ? (
                        <span className="text-xs text-green-600 font-medium">Live</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">–</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {fmtRp(p.summary_peserta?.estimasi_budget_total ?? 0)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Link href={`/loyalty/promo/${p.id}`}>
                          <Button variant="outline" size="sm" className="h-7 px-2 text-xs">
                            <ExternalLink size={12} className="mr-1" />
                            {p.status === "Aktif" ? "Monitor" : p.status === "Selesai" ? "Laporan" : "Detail"}
                          </Button>
                        </Link>
                        {p.status === "Draft" && (
                          <Button
                            size="sm"
                            className="h-7 px-2 text-xs bg-green-600 hover:bg-green-700"
                            onClick={() => handleActivate(p.id)}
                          >
                            Aktifkan
                          </Button>
                        )}
                        {p.status === "Aktif" && (
                          <Button
                            size="sm"
                            className="h-7 px-2 text-xs bg-blue-600 hover:bg-blue-700"
                            onClick={() => handleComplete(p.id)}
                          >
                            Selesaikan
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      </main>
    </div>
  );
}
