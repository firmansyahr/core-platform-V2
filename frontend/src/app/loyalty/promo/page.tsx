"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, Search, X, Calendar, Users, Zap, TrendingUp, AlertCircle,
  ChevronRight, BarChart2, ExternalLink,
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

// ── Types ─────────────────────────────────────────────────────────────────────

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
  reward_rate:      { label: "Reward Rate",    bg: "bg-purple-100", text: "text-purple-700" },
  target_bonus:     { label: "Target Bonus",   bg: "bg-amber-100",  text: "text-amber-700"  },
  cashback:         { label: "Cashback",       bg: "bg-sky-100",    text: "text-sky-700"    },
  kombinasi:        { label: "Kombinasi",      bg: "bg-pink-100",   text: "text-pink-700"   },
  multi_tier_points:{ label: "Multi-Tier",     bg: "bg-indigo-100", text: "text-indigo-700" },
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

// ── CreatePromoModal ──────────────────────────────────────────────────────────

interface TierRow {
  tier_id: number;
  label: string;
  threshold_pct: number;
  multiplier: number;
  keterangan: string;
}

interface SimResult {
  achievement_pct: number;
  tier_berlaku: string;
  total_poin: number;
  total_rupiah: number;
  breakdown: { segmen: string; volume_ton: number; multiplier: number; poin: number; keterangan: string }[];
}

const BRANDS = ["Semen Elang", "Semen Badak"];

const DEFAULT_FORM = {
  nama_promo:      "",
  deskripsi:       "",
  periode_mulai:   "",
  periode_selesai: "",
};

const DEFAULT_TIERS: TierRow[] = [
  { tier_id: 1, label: "Tier 1 — Silver", threshold_pct: 100, multiplier: 1.5, keterangan: "" },
];

function CreatePromoModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [step, setStep]             = useState(1);
  const [form, setForm]             = useState(DEFAULT_FORM);
  const [tiers, setTiers]           = useState<TierRow[]>(DEFAULT_TIERS);
  const [simTarget, setSimTarget]   = useState(100);
  const [simRealisasi, setSimReal]  = useState(110);
  const [simBrand, setSimBrand]     = useState("Semen Elang");
  const [simResult, setSimResult]   = useState<SimResult | null>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [err, setErr]               = useState("");

  function setF<K extends keyof typeof DEFAULT_FORM>(k: K, v: typeof DEFAULT_FORM[K]) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  const sortedTiers      = [...tiers].sort((a, b) => a.threshold_pct - b.threshold_pct);
  const highestThreshold = sortedTiers.length > 0 ? sortedTiers[sortedTiers.length - 1].threshold_pct : 100;
  const tier1Threshold   = sortedTiers.length > 0 ? sortedTiers[0].threshold_pct : 100;

  function addTier() {
    const nextId  = tiers.length > 0 ? Math.max(...tiers.map(t => t.tier_id)) + 1 : 1;
    const nextThr = highestThreshold + 20;
    const nextMul = tiers.length > 0 ? +(Math.max(...tiers.map(t => t.multiplier)) + 0.5).toFixed(1) : 2.0;
    setTiers(prev => [...prev, { tier_id: nextId, label: `Tier ${nextId}`, threshold_pct: nextThr, multiplier: nextMul, keterangan: "" }]);
  }

  function removeTier(id: number) { setTiers(prev => prev.filter(t => t.tier_id !== id)); }

  function updateTier(id: number, key: keyof TierRow, val: string | number) {
    setTiers(prev => prev.map(t => t.tier_id === id ? { ...t, [key]: val } : t));
  }

  // Tier validation
  const tierErrors: string[] = [];
  if (tiers.length === 0) tierErrors.push("Minimal satu tier harus ditambahkan");
  const thresholds = sortedTiers.map(t => t.threshold_pct);
  if (new Set(thresholds).size !== thresholds.length) tierErrors.push("Threshold tier tidak boleh duplikat");
  sortedTiers.forEach(t => {
    if (t.multiplier <= 1) tierErrors.push(`${t.label}: multiplier harus > 1`);
    if (t.threshold_pct <= 0) tierErrors.push(`${t.label}: threshold harus > 0%`);
  });
  const step2Valid = tierErrors.length === 0;

  async function runSimulation() {
    setSimLoading(true); setSimResult(null);
    try {
      const r = await fetch(`${API}/api/promo/preview-calc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          volume_realisasi:    simRealisasi,
          volume_target:       simTarget,
          brand:               simBrand,
          tiers:               sortedTiers,
          reguler_multiplier:  1.0,
          overflow_multiplier: 1.0,
        }),
      });
      const j = await r.json();
      if (j.status === "ok") setSimResult(j.data as SimResult);
    } catch { /* ignore */ } finally { setSimLoading(false); }
  }

  function buildPayload() {
    return {
      nama_promo:      form.nama_promo,
      deskripsi:       form.deskripsi,
      periode_mulai:   form.periode_mulai,
      periode_selesai: form.periode_selesai,
      reward_config: {
        type:                "multi_tier_points",
        tiers:               sortedTiers,
        reguler_multiplier:  1.0,
        overflow_multiplier: 1.0,
      },
    };
  }

  async function handleSave() {
    setSaving(true); setErr("");
    try {
      const r = await fetch(`${API}/api/promo/create-v2`, {
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

        {/* Step 1: Info Dasar */}
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

        {/* Step 2: Struktur Multi-Tier Target */}
        {step === 2 && (
          <div className="space-y-4">
            {/* Info box */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-1.5 text-xs text-blue-900">
              <p className="font-semibold text-blue-800">Sistem Multi-Tier Target</p>
              <p>• <span className="font-medium">Reguler</span>: 0% hingga threshold Tier 1 — semua volume mendapat 1X poin</p>
              <p>• <span className="font-medium">Tier</span>: saat threshold dicapai, SELURUH volume dalam program mendapat multiplier tier tersebut</p>
              <p>• <span className="font-medium">Overflow</span>: volume di atas tier tertinggi program ini kembali ke 1X (relatif terhadap tier tertinggi program, bukan angka tetap)</p>
            </div>

            {/* Tier table */}
            <div className="border rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Label</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Threshold</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Multiplier</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-600">Keterangan</th>
                    <th className="px-3 py-2 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {/* Fixed Reguler row */}
                  <tr className="border-t bg-gray-50/60">
                    <td className="px-3 py-2 font-medium text-gray-500">Reguler</td>
                    <td className="px-3 py-2 text-gray-500">0% → {tier1Threshold}%</td>
                    <td className="px-3 py-2 text-gray-500">1X</td>
                    <td className="px-3 py-2 text-gray-400 italic">Baseline — tidak dapat diedit</td>
                    <td className="px-3 py-2" />
                  </tr>

                  {/* Dynamic tier rows */}
                  {sortedTiers.map(t => (
                    <tr key={t.tier_id} className="border-t hover:bg-gray-50/50">
                      <td className="px-3 py-2">
                        <input
                          className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-purple-400"
                          value={t.label}
                          onChange={e => updateTier(t.tier_id, "label", e.target.value)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={1}
                            className="w-20 border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-purple-400"
                            value={t.threshold_pct}
                            onChange={e => updateTier(t.tier_id, "threshold_pct", +e.target.value)}
                          />
                          <span className="text-gray-400">%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={1.1}
                            step={0.1}
                            className="w-16 border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-purple-400"
                            value={t.multiplier}
                            onChange={e => updateTier(t.tier_id, "multiplier", +e.target.value)}
                          />
                          <span className="text-gray-400">X</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-purple-400"
                          placeholder="opsional"
                          value={t.keterangan}
                          onChange={e => updateTier(t.tier_id, "keterangan", e.target.value)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <button onClick={() => removeTier(t.tier_id)} className="text-red-400 hover:text-red-600 transition-colors">
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}

                  {/* Fixed Overflow row */}
                  <tr className="border-t bg-purple-50/50">
                    <td className="px-3 py-2 font-medium text-purple-700">Overflow</td>
                    <td className="px-3 py-2 text-purple-600">&gt; {highestThreshold}%</td>
                    <td className="px-3 py-2 text-purple-600">1X</td>
                    <td className="px-3 py-2 text-purple-400 italic">Di atas tier tertinggi — tidak dapat diedit</td>
                    <td className="px-3 py-2" />
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Add tier button */}
            <button
              onClick={addTier}
              className="flex items-center gap-1.5 text-xs text-purple-600 hover:text-purple-700 font-medium transition-colors"
            >
              <Plus size={14} /> Tambah Tier
            </button>

            {/* Validation errors */}
            {tierErrors.length > 0 && (
              <div className="space-y-1">
                {tierErrors.map((e, i) => (
                  <p key={i} className="text-xs text-red-600 flex items-center gap-1">
                    <AlertCircle size={12} />{e}
                  </p>
                ))}
              </div>
            )}

            {/* Simulation */}
            <div className="border rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Simulasi Kalkulasi</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Target (ton)</label>
                  <input
                    type="number"
                    min={1}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    value={simTarget}
                    onChange={e => setSimTarget(+e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Realisasi (ton)</label>
                  <input
                    type="number"
                    min={0}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    value={simRealisasi}
                    onChange={e => setSimReal(+e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Brand</label>
                  <select
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    value={simBrand}
                    onChange={e => setSimBrand(e.target.value)}
                  >
                    {BRANDS.map(b => <option key={b}>{b}</option>)}
                  </select>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="border-purple-300 text-purple-700 hover:bg-purple-50"
                disabled={simLoading || !step2Valid}
                onClick={runSimulation}
              >
                {simLoading ? "Menghitung..." : "Hitung Estimasi"}
              </Button>

              {simResult && (
                <div className="bg-gray-50 rounded-xl p-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-muted-foreground">Achievement</p>
                      <p className="font-bold text-lg">{simResult.achievement_pct}%</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Tier Berlaku</p>
                      <p className="font-semibold">{simResult.tier_berlaku}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Total Poin</p>
                      <p className="font-bold">{fmtNum(simResult.total_poin)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Estimasi Reward</p>
                      <p className="font-bold text-purple-700">{fmtRp(simResult.total_rupiah)}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium mb-1.5">Rincian Breakdown</p>
                    <div className="space-y-1">
                      {simResult.breakdown.map((b, i) => (
                        <div key={i} className="flex items-start justify-between text-xs py-1.5 border-t first:border-t-0">
                          <div>
                            <p className="font-medium">{b.segmen}</p>
                            <p className="text-muted-foreground">{b.keterangan}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-medium">{fmtNum(b.volume_ton)} ton &times; {b.multiplier}X</p>
                            <p className="text-purple-600">{fmtNum(b.poin)} poin</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 3: Review */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Nama Program</span>
                <span className="font-medium">{form.nama_promo}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Periode</span>
                <span className="font-medium">{fmtDate(form.periode_mulai)} &ndash; {fmtDate(form.periode_selesai)}</span>
              </div>
              {form.deskripsi && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Deskripsi</span>
                  <span className="font-medium text-right max-w-[60%]">{form.deskripsi}</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Struktur Tier</p>

              <div className="flex items-center justify-between border rounded-lg p-3 bg-gray-50">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-gray-400" />
                  <span className="text-sm font-medium">Reguler</span>
                  <span className="text-xs text-muted-foreground">0% &rarr; {tier1Threshold}% target</span>
                </div>
                <span className="text-xs font-semibold text-gray-600">1X</span>
              </div>

              {sortedTiers.map((t, i) => {
                const colors = ["bg-blue-500","bg-green-500","bg-amber-500","bg-orange-500","bg-red-500"];
                return (
                  <div key={t.tier_id} className="flex items-center justify-between border rounded-lg p-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${colors[i % colors.length]}`} />
                      <span className="text-sm font-medium">{t.label}</span>
                      <span className="text-xs text-muted-foreground">&ge; {t.threshold_pct}% target</span>
                    </div>
                    <span className="text-xs font-semibold text-purple-700">{t.multiplier}X</span>
                  </div>
                );
              })}

              <div className="flex items-center justify-between border rounded-lg p-3 bg-purple-50">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-purple-600" />
                  <span className="text-sm font-medium">Overflow</span>
                  <span className="text-xs text-muted-foreground">&gt; {highestThreshold}% target</span>
                </div>
                <span className="text-xs font-semibold text-purple-600">1X</span>
              </div>
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
              disabled={(step === 1 && !step1Valid) || (step === 2 && !step2Valid)}
              onClick={() => setStep(s => s + 1)}
            >
              Lanjut &rarr;
            </Button>
          )}
          {step === 3 && (
            <Button
              size="sm"
              className="bg-purple-600 hover:bg-purple-700"
              disabled={saving}
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

  // suppress unused import warning for router
  void router;

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
                      {fmtDate(p.periode_mulai)} &ndash;<br />{fmtDate(p.periode_selesai)}
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
                        <span className="text-muted-foreground text-xs">&ndash;</span>
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
