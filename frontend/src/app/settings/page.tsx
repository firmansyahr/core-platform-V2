"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Settings, Tags, ChevronRight } from "lucide-react";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/hooks/useAuth";
import { getToken } from "@/lib/auth";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const LS_KEY = "core-platform-settings";

interface AegisSettings {
  fbsiThreshold: number;
  heThreshold: number;
  fbsiWindow: number;
  heWindow: number;
  crsKuning: number;
  crsOranye: number;
  crsMerah: number;
  wFbsi: number;
  wHe: number;
  wOrs: number;
}

interface IlpSettings {
  defaultBudget: number;
  defaultMaxToko: number;
  wRatio: number;
  wTrx: number;
  wGrowth: number;
}

interface DataInfo {
  path: string;
  file_exists: boolean;
  is_loaded: boolean;
  rows?: number;
  columns?: number;
  date_min?: string;
  date_max?: string;
}

interface HealthData {
  status: string;
  data_loaded: boolean;
  row_count: number;
  model_trained: boolean;
  periode: string;
  uptime_seconds: number;
  version: string;
}

const AEGIS_DEFAULTS: AegisSettings = {
  fbsiThreshold: 15.0,
  heThreshold: -8.0,
  fbsiWindow: 8,
  heWindow: 8,
  crsKuning: 40,
  crsOranye: 65,
  crsMerah: 85,
  wFbsi: 60,
  wHe: 30,
  wOrs: 10,
};

// Label kategori untuk display saja — KEY tetap nama brand asli (kompatibel
// dengan brand_point_values yang sudah tersimpan di backend/database).
const BRAND_CATEGORY_LABELS: { key: string; label: string; hint: string }[] = [
  { key: "Semen Elang",   label: "Main Brand (MB)",      hint: "Berlaku untuk brand yang dikategorikan sebagai MB di Konfigurasi Brand per Wilayah" },
  { key: "Semen Badak",   label: "Companion Brand (CB)", hint: "Berlaku untuk brand yang dikategorikan sebagai CB di Konfigurasi Brand per Wilayah" },
  { key: "Semen Banteng", label: "Fighting Brand (FB)",  hint: "Berlaku untuk brand yang dikategorikan sebagai FB di Konfigurasi Brand per Wilayah" },
];

const ILP_DEFAULTS: IlpSettings = {
  defaultBudget: 2_000_000_000,
  defaultMaxToko: 100,
  wRatio: 47,
  wTrx: 43,
  wGrowth: 10,
};

function loadFromStorage(): { aegis: AegisSettings; ilp: IlpSettings } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function Toast({ msg, show }: { msg: string; show: boolean }) {
  return (
    <div
      className={`fixed bottom-24 right-6 z-50 flex items-center gap-2 px-5 py-3
        rounded-xl bg-foreground text-background text-sm font-medium shadow-2xl
        transition-all duration-300 ${
          show ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3 pointer-events-none"
        }`}
    >
      <span>✓</span>
      {msg}
    </div>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  hint,
  type = "number",
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  hint?: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input
        type={type}
        value={value}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className={`w-full px-3 py-2 text-sm rounded-lg border border-border bg-background
          focus:outline-none focus:ring-2 focus:ring-ring/50 text-foreground
          ${disabled ? "opacity-60 cursor-not-allowed bg-muted" : ""}`}
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function WeightSlider({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-36 text-sm text-muted-foreground flex-shrink-0">{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`flex-1 accent-primary h-1.5 ${disabled ? "opacity-60 cursor-not-allowed" : ""}`}
      />
      <span className="w-10 text-sm font-mono font-semibold text-right">{value}%</span>
    </div>
  );
}

function WeightTotal({ total }: { total: number }) {
  const ok = Math.round(total) === 100;
  return (
    <p
      className={`text-right text-xs font-mono font-semibold mt-1 ${
        ok ? "text-muted-foreground" : "text-destructive"
      }`}
    >
      Total: {total}%{!ok && " — harus 100%"}
    </p>
  );
}

function ErrorBox({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 space-y-1">
      {errors.map((e) => (
        <p key={e} className="text-xs text-destructive">
          ⚠ {e}
        </p>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { isAdmin } = useAuth();

  const [aegis, setAegis] = useState<AegisSettings>(AEGIS_DEFAULTS);
  const [ilp, setIlp] = useState<IlpSettings>(ILP_DEFAULTS);
  const [dataInfo, setDataInfo] = useState<DataInfo | null>(null);
  const [backendAegis, setBackendAegis] = useState<Record<string, number> | null>(null);
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [reloading, setReloading] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: "" });
  const [brandPV, setBrandPV] = useState<Record<string, number>>({
    "Semen Elang": 5000, "Semen Badak": 4000, "Semen Banteng": 0,
  });
  const [bpvSaving, setBpvSaving] = useState(false);
  const [bpvMsg, setBpvMsg] = useState("");

  // Load from localStorage on mount
  useEffect(() => {
    const saved = loadFromStorage();
    if (saved) {
      if (saved.aegis) setAegis({ ...AEGIS_DEFAULTS, ...saved.aegis });
      if (saved.ilp) setIlp({ ...ILP_DEFAULTS, ...saved.ilp });
    }
  }, []);

  // Fetch backend defaults + data source info
  useEffect(() => {
    fetch(`${API}/api/settings`)
      .then((r) => r.json())
      .then((res) => {
        if (res.status === "ok") {
          setDataInfo(res.data.data_source as DataInfo);
          setBackendAegis(res.data.aegis as Record<string, number>);
        }
      })
      .catch(() => {});

    fetch(`${API}/api/health`)
      .then((r) => r.json())
      .then((res) => {
        if (res.status === "ok") setHealthData(res as HealthData);
      })
      .catch(() => {});

    fetch(`${API}/api/settings/brand-point-values`)
      .then((r) => r.json())
      .then((res) => {
        if (res.status === "ok") setBrandPV(res.data.brand_point_values as Record<string, number>);
      })
      .catch(() => {});
  }, []);

  function showToast(msg: string) {
    setToast({ show: true, msg });
    setTimeout(() => setToast({ show: false, msg: "" }), 3000);
  }

  // ── Validation ──────────────────────────────────────────────
  const aegisErrors: string[] = [];
  if (aegis.crsKuning >= aegis.crsOranye)
    aegisErrors.push("CRS Kuning harus lebih kecil dari Oranye");
  if (aegis.crsOranye >= aegis.crsMerah)
    aegisErrors.push("CRS Oranye harus lebih kecil dari Merah");
  const aegisWTotal = aegis.wFbsi + aegis.wHe + aegis.wOrs;
  if (Math.round(aegisWTotal) !== 100)
    aegisErrors.push(`Bobot CRS total ${aegisWTotal}%`);

  const ilpWTotal = ilp.wRatio + ilp.wTrx + ilp.wGrowth;
  const ilpErrors: string[] = [];
  if (Math.round(ilpWTotal) !== 100)
    ilpErrors.push(`Bobot scoring total ${ilpWTotal}%`);

  const hasErrors = aegisErrors.length > 0 || ilpErrors.length > 0;

  // ── CRS bar (clamped so widths are always ≥ 0) ──────────────
  const kBar = Math.max(0, Math.min(aegis.crsKuning, 100));
  const oBar = Math.max(kBar, Math.min(aegis.crsOranye, 100));
  const mBar = Math.max(oBar, Math.min(aegis.crsMerah, 100));

  // ── Handlers ────────────────────────────────────────────────
  function handleSave() {
    if (hasErrors) return;
    localStorage.setItem(LS_KEY, JSON.stringify({ aegis, ilp }));
    showToast("Pengaturan berhasil disimpan");
  }

  function handleReset() {
    setAegis(AEGIS_DEFAULTS);
    setIlp(ILP_DEFAULTS);
    localStorage.removeItem(LS_KEY);
    showToast("Pengaturan dikembalikan ke default");
  }

  async function handleReload() {
    setReloading(true);
    try {
      const token = getToken() ?? "";
      const res = await fetch(`${API}/api/settings/reload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.status === "ok") {
        showToast("Cache dibersihkan. Data akan dimuat ulang.");
        const [res2, res3] = await Promise.all([
          fetch(`${API}/api/settings`),
          fetch(`${API}/api/health`),
        ]);
        const data2 = await res2.json();
        if (data2.status === "ok") setDataInfo(data2.data.data_source as DataInfo);
        const data3 = await res3.json();
        if (data3.status === "ok") setHealthData(data3 as HealthData);
      }
    } catch {
      showToast("Gagal menghubungi server");
    } finally {
      setReloading(false);
    }
  }

  const fmt = (n: number) => new Intl.NumberFormat("id-ID").format(n);

  async function handleSaveBrandPV() {
    setBpvSaving(true); setBpvMsg("");
    try {
      const token = getToken() ?? "";
      const r = await fetch(`${API}/api/settings/brand-point-values`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ brand_point_values: brandPV }),
      });
      const j = await r.json();
      if (j.status === "ok") showToast("Nilai poin per brand berhasil disimpan");
      else setBpvMsg(j.detail || "Gagal menyimpan");
    } catch {
      setBpvMsg("Koneksi gagal");
    } finally {
      setBpvSaving(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-4xl mx-auto px-6 pt-20 pb-32">
        {/* Page header */}
        <div className="mb-8 pt-6">
          <div className="flex items-center gap-2 mb-1">
            <Settings size={20} className="text-muted-foreground" />
            <h1 className="text-xl font-bold">Settings</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Konfigurasi parameter AEGIS, ILP, dan sumber data. Perubahan disimpan di browser lokal.
          </p>
        </div>

        <div className="space-y-6">
          {/* ── AEGIS Configuration ─────────────────────────────── */}
          <section className="rounded-xl border border-border bg-card p-6 space-y-6">
            <div>
              <h2 className="font-semibold text-base">AEGIS Configuration</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Parameter fighting brand monitoring dan perhitungan CRS.
                {backendAegis && (
                  <span className="ml-1 opacity-70">
                    Nilai aktif backend: FBSI threshold {backendAegis.fbsi_threshold}, CRS{" "}
                    {backendAegis.crs_kuning}/{backendAegis.crs_oranye}/{backendAegis.crs_merah}
                  </span>
                )}
              </p>
            </div>

            {/* FBSI + HE windows & thresholds */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-3">FBSI &amp; HE</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <FieldInput
                  label="Batas Kenaikan Porsi Produk Murah (%)"
                  value={aegis.fbsiThreshold}
                  step={0.5}
                  min={0}
                  max={100}
                  onChange={(v) => setAegis((s) => ({ ...s, fbsiThreshold: v }))}
                  hint="Jika porsi produk murah naik lebih dari nilai ini dibanding bulan lalu, toko masuk pemantauan. Default: 15.0"
                  disabled={!isAdmin}
                />
                <FieldInput
                  label="FBSI Window (bulan)"
                  value={aegis.fbsiWindow}
                  step={1}
                  min={1}
                  max={24}
                  onChange={(v) => setAegis((s) => ({ ...s, fbsiWindow: Math.round(v) }))}
                  hint="Default: 8"
                  disabled={!isAdmin}
                />
                <FieldInput
                  label="Batas Penurunan Harga Jual (%)"
                  value={aegis.heThreshold}
                  step={0.5}
                  min={-100}
                  max={0}
                  onChange={(v) => setAegis((s) => ({ ...s, heThreshold: v }))}
                  hint="Default: −8.0"
                  disabled={!isAdmin}
                />
                <FieldInput
                  label="HE Window (bulan)"
                  value={aegis.heWindow}
                  step={1}
                  min={1}
                  max={24}
                  onChange={(v) => setAegis((s) => ({ ...s, heWindow: Math.round(v) }))}
                  hint="Default: 8"
                  disabled={!isAdmin}
                />
              </div>
            </div>

            {/* CRS thresholds */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-3">Ambang Batas Peringatan</p>
              <div className="grid grid-cols-3 gap-4">
                <FieldInput
                  label="Ambang Batas Peringatan Kuning"
                  value={aegis.crsKuning}
                  step={1}
                  min={1}
                  max={99}
                  onChange={(v) => setAegis((s) => ({ ...s, crsKuning: Math.round(v) }))}
                  hint="Default: 40"
                  disabled={!isAdmin}
                />
                <FieldInput
                  label="Ambang Batas Peringatan Oranye"
                  value={aegis.crsOranye}
                  step={1}
                  min={1}
                  max={99}
                  onChange={(v) => setAegis((s) => ({ ...s, crsOranye: Math.round(v) }))}
                  hint="Default: 65"
                  disabled={!isAdmin}
                />
                <FieldInput
                  label="Ambang Batas Peringatan Merah"
                  value={aegis.crsMerah}
                  step={1}
                  min={2}
                  max={100}
                  onChange={(v) => setAegis((s) => ({ ...s, crsMerah: Math.round(v) }))}
                  hint="Default: 85"
                  disabled={!isAdmin}
                />
              </div>

              {/* CRS visual bar */}
              <div className="mt-4 h-2.5 rounded-full bg-muted overflow-hidden flex">
                <div style={{ width: `${kBar}%` }} className="bg-muted-foreground/20" />
                <div
                  style={{ width: `${oBar - kBar}%` }}
                  className="bg-yellow-400/80"
                />
                <div
                  style={{ width: `${mBar - oBar}%` }}
                  className="bg-orange-400/80"
                />
                <div
                  style={{ width: `${100 - mBar}%` }}
                  className="bg-red-500/80"
                />
              </div>
              <div className="flex justify-between mt-1.5 text-xs text-muted-foreground">
                <span>0 Normal</span>
                <span className="text-yellow-600 dark:text-yellow-400">
                  {aegis.crsKuning} Kuning
                </span>
                <span className="text-orange-600 dark:text-orange-400">
                  {aegis.crsOranye} Oranye
                </span>
                <span className="text-red-600 dark:text-red-400">{aegis.crsMerah} Merah</span>
                <span>100</span>
              </div>
            </div>

            {/* AEGIS weight sliders */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                Bobot Perhitungan Risiko{" "}
                <span className="font-normal opacity-60">— eksperimental, belum diterapkan</span>
              </p>
              <div className="space-y-3 mt-3">
                <WeightSlider
                  label="FBSI"
                  value={aegis.wFbsi}
                  onChange={(v) => setAegis((s) => ({ ...s, wFbsi: v }))}
                  disabled={!isAdmin}
                />
                <WeightSlider
                  label="HE"
                  value={aegis.wHe}
                  onChange={(v) => setAegis((s) => ({ ...s, wHe: v }))}
                  disabled={!isAdmin}
                />
                <WeightSlider
                  label="ORS"
                  value={aegis.wOrs}
                  onChange={(v) => setAegis((s) => ({ ...s, wOrs: v }))}
                  disabled={!isAdmin}
                />
              </div>
              <WeightTotal total={aegisWTotal} />
            </div>

            <ErrorBox errors={aegisErrors} />
          </section>

          {/* ── ILP Default Parameters ──────────────────────────── */}
          <section className="rounded-xl border border-border bg-card p-6 space-y-6">
            <div>
              <h2 className="font-semibold text-base">ILP Default Parameters</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Nilai default yang dipakai saat halaman ILP pertama kali dibuka.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Budget Maks Default (Rp)
                </label>
                <input
                  type="number"
                  value={ilp.defaultBudget}
                  step={100_000_000}
                  min={0}
                  disabled={!isAdmin}
                  onChange={(e) =>
                    setIlp((s) => ({ ...s, defaultBudget: parseInt(e.target.value) || 0 }))
                  }
                  className={`w-full px-3 py-2 text-sm rounded-lg border border-border bg-background
                    focus:outline-none focus:ring-2 focus:ring-ring/50 text-foreground
                    ${!isAdmin ? "opacity-60 cursor-not-allowed bg-muted" : ""}`}
                />
                <p className="text-xs text-muted-foreground">Rp {fmt(ilp.defaultBudget)}</p>
              </div>
              <FieldInput
                label="Maks Toko Default"
                value={ilp.defaultMaxToko}
                step={10}
                min={1}
                max={10000}
                onChange={(v) => setIlp((s) => ({ ...s, defaultMaxToko: Math.round(v) }))}
                hint="Default: 100 toko"
                disabled={!isAdmin}
              />
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-3">Bobot Scoring Default</p>
              <div className="space-y-3">
                <WeightSlider
                  label="Ratio vs Cluster"
                  value={ilp.wRatio}
                  onChange={(v) => setIlp((s) => ({ ...s, wRatio: v }))}
                  disabled={!isAdmin}
                />
                <WeightSlider
                  label="Avg Transaksi"
                  value={ilp.wTrx}
                  onChange={(v) => setIlp((s) => ({ ...s, wTrx: v }))}
                  disabled={!isAdmin}
                />
                <WeightSlider
                  label="Growth Trend"
                  value={ilp.wGrowth}
                  onChange={(v) => setIlp((s) => ({ ...s, wGrowth: v }))}
                  disabled={!isAdmin}
                />
              </div>
              <WeightTotal total={ilpWTotal} />
            </div>

            <ErrorBox errors={ilpErrors} />
          </section>

          {/* ── Brand Point Values ──────────────────────────────── */}
          <section className="rounded-xl border border-border bg-card p-6 space-y-5">
            <div>
              <h2 className="font-semibold text-base">Konfigurasi Nilai Poin per Brand</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Digunakan dalam kalkulasi reward multi-tier. 1 poin = nilai Rp yang ditentukan di sini.
              </p>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-800 space-y-1">
              <p className="font-semibold">Catatan Penting</p>
              <p>Perubahan nilai poin bersifat <span className="font-medium">tidak retroaktif</span> — hanya berlaku untuk kalkulasi monitoring yang dijalankan setelah perubahan disimpan. Program yang sudah selesai tidak terpengaruh.</p>
            </div>

            <div className="border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-600">Kategori</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-600">Nilai per Poin (Rp)</th>
                    <th className="px-4 py-2.5 text-center text-xs font-medium text-gray-600">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {BRAND_CATEGORY_LABELS.map(({ key, label, hint }) => {
                    const val = brandPV[key] ?? 0;
                    const isDisabled = !isAdmin;
                    return (
                      <tr key={key} className="border-t">
                        <td className="px-4 py-3">
                          <p className="font-medium">{label}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
                        </td>
                        <td className="px-4 py-3 text-right align-top">
                          <input
                            type="number"
                            min={0}
                            step={500}
                            className={`w-32 border rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-purple-400 ${isDisabled ? "opacity-60 cursor-not-allowed bg-gray-100" : ""}`}
                            value={val}
                            disabled={isDisabled}
                            onChange={e => setBrandPV(prev => ({ ...prev, [key]: +e.target.value }))}
                          />
                        </td>
                        <td className="px-4 py-3 text-center align-top">
                          <span className="text-xs text-green-600 font-medium">Aktif</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {bpvMsg && <p className="text-xs text-red-600">{bpvMsg}</p>}

            {isAdmin ? (
              <button
                onClick={handleSaveBrandPV}
                disabled={bpvSaving}
                className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                {bpvSaving ? "Menyimpan..." : "Simpan Konfigurasi"}
              </button>
            ) : (
              <p className="text-xs text-muted-foreground italic">Hanya Admin yang dapat mengubah nilai poin.</p>
            )}
          </section>

          {/* ── Brand Config per Wilayah (link) ─────────────────── */}
          <Link
            href="/settings/brand-config"
            className="block rounded-xl border border-border bg-card p-4 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg shrink-0">
                <Tags className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">Konfigurasi Brand per Wilayah</p>
                <p className="text-xs text-muted-foreground">
                  Setting MB/CB/FB per provinsi dan kabupaten untuk perhitungan volume dan reward loyalty
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </div>
          </Link>

          {/* ── Data Source ─────────────────────────────────────── */}
          <section className="rounded-xl border border-border bg-card p-6 space-y-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold text-base">Data Source &amp; System Health</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Status live dari endpoint{" "}
                  <span className="font-mono">/api/health</span>.
                </p>
              </div>
              {healthData && (
                <span className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-green-500/15 text-green-700 dark:text-green-400">
                  <span className="text-[8px]">●</span>
                  v{healthData.version}
                </span>
              )}
            </div>

            {dataInfo || healthData ? (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                {dataInfo && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Path</dt>
                    <dd className="text-sm font-mono mt-0.5 break-all">{dataInfo.path}</dd>
                  </div>
                )}
                {dataInfo && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Status File</dt>
                    <dd className="mt-1">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
                          dataInfo.file_exists
                            ? "bg-green-500/15 text-green-700 dark:text-green-400"
                            : "bg-destructive/15 text-destructive"
                        }`}
                      >
                        <span className="text-[8px]">●</span>
                        {dataInfo.file_exists ? "File tersedia" : "File tidak ditemukan"}
                      </span>
                    </dd>
                  </div>
                )}
                {healthData && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Data Cache</dt>
                    <dd className="mt-1">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
                          healthData.data_loaded
                            ? "bg-blue-500/15 text-blue-700 dark:text-blue-400"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <span className="text-[8px]">●</span>
                        {healthData.data_loaded ? "Dimuat di memori" : "Belum dimuat"}
                      </span>
                    </dd>
                  </div>
                )}
                {healthData && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Model ML</dt>
                    <dd className="mt-1">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
                          healthData.model_trained
                            ? "bg-violet-500/15 text-violet-700 dark:text-violet-400"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <span className="text-[8px]">●</span>
                        {healthData.model_trained ? "XGB cache tersedia" : "Belum di-train"}
                      </span>
                    </dd>
                  </div>
                )}
                {healthData && healthData.row_count > 0 && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Jumlah Baris</dt>
                    <dd className="text-sm font-semibold mt-0.5">
                      {fmt(healthData.row_count)} baris
                    </dd>
                  </div>
                )}
                {dataInfo?.columns !== undefined && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Kolom</dt>
                    <dd className="text-sm mt-0.5">{dataInfo.columns} kolom</dd>
                  </div>
                )}
                {healthData?.periode && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Periode Data</dt>
                    <dd className="text-sm font-mono mt-0.5">{healthData.periode}</dd>
                  </div>
                )}
                {healthData && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Uptime Server</dt>
                    <dd className="text-sm mt-0.5">
                      {(() => {
                        const s = Math.round(healthData.uptime_seconds);
                        if (s < 60) return `${s} detik`;
                        if (s < 3600) return `${Math.floor(s / 60)} menit ${s % 60} detik`;
                        return `${Math.floor(s / 3600)} jam ${Math.floor((s % 3600) / 60)} menit`;
                      })()}
                    </dd>
                  </div>
                )}
              </dl>
            ) : (
              <div className="h-20 flex items-center">
                <p className="text-sm text-muted-foreground">Memuat info data source…</p>
              </div>
            )}

            <div className="pt-4 border-t border-border flex flex-col gap-2">
              {isAdmin ? (
                <div>
                  <button
                    onClick={handleReload}
                    disabled={reloading}
                    className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg border border-border
                      bg-background hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {reloading ? (
                      <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <span>↺</span>
                    )}
                    Reload Data Cache
                  </button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  Reload data hanya tersedia untuk Admin.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Membersihkan cache backend agar parquet dibaca ulang dari disk pada request
                berikutnya.
              </p>
            </div>
          </section>
        </div>
      </main>

      {/* ── Fixed action footer ────────────────────────────────── */}
      <div className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-card/90 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-3 flex-wrap">
          {isAdmin ? (
            <>
              <button
                onClick={handleSave}
                disabled={hasErrors}
                className="px-5 py-2 rounded-lg bg-foreground text-background text-sm font-medium
                  hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Simpan Perubahan
              </button>
              <button
                onClick={handleReset}
                className="px-5 py-2 rounded-lg border border-border text-sm font-medium
                  hover:bg-muted transition-colors"
              >
                Reset ke Default
              </button>
              {hasErrors && (
                <p className="text-xs text-destructive">Perbaiki error sebelum menyimpan.</p>
              )}
            </>
          ) : (
            <span className="flex items-center gap-2.5">
              <span className="px-2.5 py-1 rounded-full bg-muted border border-border text-xs font-semibold text-muted-foreground">
                Read Only
              </span>
              <span className="text-sm text-muted-foreground">
                Login sebagai Admin untuk mengubah pengaturan
              </span>
            </span>
          )}
          <p className="ml-auto text-xs text-muted-foreground hidden sm:block">
            Perubahan hanya disimpan di browser lokal (localStorage).
          </p>
        </div>
      </div>

      <Toast msg={toast.msg} show={toast.show} />
    </div>
  );
}
