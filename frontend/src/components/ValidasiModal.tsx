"use client";

import { useState, useEffect } from "react";
import { X, ChevronDown, ChevronUp } from "lucide-react";
import { getToken } from "@/lib/auth";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const KATEGORI_CHOICES = [
  "Kompetitor Eksternal",
  "Masalah Harga / Gap Harga Besar",
  "Masalah Stok / Keterlambatan Kirim",
  "Faktor Seasonal",
  "Faktor Internal Distributor",
  "Kondisi Normal / False Alarm",
  "Butuh Investigasi Lanjut",
];

const KATEGORI_COLOR: Record<string, string> = {
  "Kompetitor Eksternal":              "bg-red-100 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-400 dark:border-red-700",
  "Masalah Harga / Gap Harga Besar":   "bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-950/30 dark:text-yellow-400 dark:border-yellow-700",
  "Masalah Stok / Keterlambatan Kirim":"bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-700",
  "Faktor Seasonal":                   "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-700",
  "Faktor Internal Distributor":       "bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-950/30 dark:text-purple-400 dark:border-purple-700",
  "Kondisi Normal / False Alarm":      "bg-green-100 text-green-700 border-green-300 dark:bg-green-950/30 dark:text-green-400 dark:border-green-700",
  "Butuh Investigasi Lanjut":          "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600",
};

interface KondisiAlert {
  total_toko_warning: number;
  merah_count: number;
  oranye_count: number;
  kuning_count: number;
  avg_aegis_score: number;
  pola_dominan: string;
}

export interface CADRecordFull {
  id: string;
  kabupaten: string;
  tgl_alert: string;
  tanggal_alert?: string;
  status: string;
  status_resolusi: string;
  kondisi_alert?: KondisiAlert;
  jumlah_toko: number;
  aegis_score_rata: number;
  hasil_validasi_detail?: Record<string, unknown> | null;
}

interface Props {
  record: CADRecordFull;
  currentUser?: string;
  onClose: () => void;
  onSaved: () => void;
}

interface FormData {
  tgl_validasi: string;
  validated_by: string;
  toko_dikunjungi: string;
  toko_terdampak: string;
  toko_false_alarm: string;
  toko_butuh_investigasi: string;
  kategori_list: string[];
  kategori_utama: string;
  // Kompetitor
  nama_brand: string;
  gap_harga_kompetitor: string;
  metode_masuk: string;
  toko_sudah_beralih: string;
  toko_terpengaruh: string;
  // Stok
  lama_kosong_hari: string;
  stok_resolved: boolean;
  // Harga
  gap_harga: string;
  produk_lebih_murah: string;
  // Distribusi manual
  distribusi: { kategori: string; jumlah_toko: string }[];
  // Action
  action_items: string;
  target_resolusi: string;
  catatan_detail: string;
}

const METODE_MASUK = ["Sales freelance", "Distributor resmi", "Online", "Tidak diketahui"];

function InputField({ label, value, onChange, type = "text", placeholder = "" }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background
          focus:outline-none focus:ring-2 focus:ring-ring/50 placeholder:text-muted-foreground/60"
      />
    </div>
  );
}

export default function ValidasiModal({ record, currentUser = "", onClose, onSaved }: Props) {
  const kondisi = record.kondisi_alert;
  const today = new Date().toISOString().slice(0, 10);

  const [form, setForm] = useState<FormData>({
    tgl_validasi:         today,
    validated_by:         currentUser,
    toko_dikunjungi:      "",
    toko_terdampak:       "",
    toko_false_alarm:     "",
    toko_butuh_investigasi: "",
    kategori_list:        [],
    kategori_utama:       "",
    nama_brand:           "",
    gap_harga_kompetitor: "",
    metode_masuk:         "Sales freelance",
    toko_sudah_beralih:   "",
    toko_terpengaruh:     "",
    lama_kosong_hari:     "",
    stok_resolved:        false,
    gap_harga:            "",
    produk_lebih_murah:   "",
    distribusi:           KATEGORI_CHOICES.map((k) => ({ kategori: k, jumlah_toko: "" })),
    action_items:         "",
    target_resolusi:      "",
    catatan_detail:       "",
  });

  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");
  const [topStores, setTopStores] = useState<{ id_toko: string; nama_toko: string; aegis_score: number }[]>([]);

  // Pre-fill from existing hasil_validasi_detail
  useEffect(() => {
    if (!record.hasil_validasi_detail) return;
    const hvd = record.hasil_validasi_detail as Record<string, unknown>;
    setForm((prev) => ({
      ...prev,
      kategori_utama: (hvd.kategori_utama as string) || "",
      kategori_list:  hvd.kategori_utama ? [hvd.kategori_utama as string] : [],
      action_items:   (hvd.action_items as string) || "",
      catatan_detail: (hvd.catatan_detail as string) || "",
      target_resolusi:(hvd.target_resolusi as string) || "",
      toko_dikunjungi: hvd.toko_dikunjungi != null ? String(hvd.toko_dikunjungi) : "",
      toko_terdampak:  hvd.toko_terdampak  != null ? String(hvd.toko_terdampak)  : "",
      toko_false_alarm: hvd.toko_false_alarm != null ? String(hvd.toko_false_alarm) : "",
      toko_butuh_investigasi: hvd.toko_butuh_investigasi != null ? String(hvd.toko_butuh_investigasi) : "",
    }));
  }, [record]);

  // Fetch top stores for this kabupaten
  useEffect(() => {
    const kab = encodeURIComponent(record.kabupaten);
    fetch(`${API}/api/aegis/warnings?kabupaten=${kab}&limit=10`)
      .then((r) => r.ok ? r.json() : null)
      .then((r) => {
        if (r?.data) {
          setTopStores(r.data.slice(0, 10).map((s: { id_toko: string; nama_toko: string; aegis_score: number }) => ({
            id_toko: s.id_toko,
            nama_toko: s.nama_toko,
            aegis_score: s.aegis_score,
          })));
        }
      })
      .catch(() => {});
  }, [record.kabupaten]);

  const toggleKategori = (k: string) => {
    setForm((prev) => {
      const next = prev.kategori_list.includes(k)
        ? prev.kategori_list.filter((x) => x !== k)
        : [...prev.kategori_list, k];
      return {
        ...prev,
        kategori_list:  next,
        kategori_utama: next.length > 0 && !next.includes(prev.kategori_utama) ? next[0] : prev.kategori_utama,
      };
    });
  };

  const has = (k: string) => form.kategori_list.includes(k);

  const fmtRp = (n: string) => {
    const num = parseInt(n.replace(/\D/g, ""), 10);
    if (isNaN(num)) return n;
    return new Intl.NumberFormat("id-ID").format(num);
  };

  const buildPayload = () => {
    const detail_kompetitor = has("Kompetitor Eksternal") ? {
      ada_kompetitor:              true,
      nama_brand:                  form.nama_brand,
      gap_harga_per_zak:           parseInt(form.gap_harga_kompetitor) || null,
      metode_masuk:                form.metode_masuk,
      toko_sudah_beralih:          parseInt(form.toko_sudah_beralih) || null,
      toko_terpengaruh_belum_beralih: parseInt(form.toko_terpengaruh) || null,
    } : null;

    const detail_stok = has("Masalah Stok / Keterlambatan Kirim") ? {
      ada_masalah_stok: true,
      lama_kosong_hari: parseInt(form.lama_kosong_hari) || null,
      sudah_resolved:   form.stok_resolved,
    } : null;

    const detail_harga = has("Masalah Harga / Gap Harga Besar") ? {
      gap_harga_per_zak:     parseInt(form.gap_harga) || null,
      produk_lebih_murah:    form.produk_lebih_murah,
    } : null;

    const distribusi_kondisi = form.distribusi
      .filter((d) => d.jumlah_toko && parseInt(d.jumlah_toko) > 0)
      .map((d) => ({ kategori: d.kategori, jumlah_toko: parseInt(d.jumlah_toko) }));

    return {
      kategori_utama:         form.kategori_utama || form.kategori_list[0] || "",
      kategori_sekunder:      form.kategori_list.filter((k) => k !== form.kategori_utama),
      toko_dikunjungi:        parseInt(form.toko_dikunjungi) || null,
      toko_terdampak:         parseInt(form.toko_terdampak) || null,
      toko_false_alarm:       parseInt(form.toko_false_alarm) || null,
      toko_butuh_investigasi: parseInt(form.toko_butuh_investigasi) || null,
      detail_kompetitor,
      detail_stok,
      detail_harga,
      distribusi_kondisi,
      target_resolusi:  form.target_resolusi || null,
      action_items:     form.action_items,
      catatan_detail:   form.catatan_detail || null,
    };
  };

  const submit = async (isDraft: boolean) => {
    if (!form.validated_by.trim()) { setError("Nama TSO harus diisi"); return; }
    if (!isDraft && !form.kategori_utama && form.kategori_list.length === 0) {
      setError("Pilih minimal satu kategori"); return;
    }
    if (!isDraft && !form.action_items.trim()) {
      setError("Action items harus diisi"); return;
    }
    setSaving(true);
    setError("");
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/aegis/cad-history/${record.id}/validate`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          hasil_validasi: buildPayload(),
          validated_by:   form.validated_by,
          tgl_validasi:   form.tgl_validasi,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.detail ?? "Gagal menyimpan"); return; }
      onSaved();
      onClose();
    } catch {
      setError("Koneksi gagal");
    } finally {
      setSaving(false);
    }
  };

  const scoreColor = (s: number) =>
    s >= 85 ? "#DC2626" : s >= 65 ? "#EA580C" : s >= 40 ? "#CA8A04" : "#16a34a";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="font-semibold text-base">Form Validasi Lapangan</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {record.kabupaten} · Alert {record.tgl_alert || record.tanggal_alert}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body - 2 columns */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-border">

            {/* LEFT — Alert Summary */}
            <div className="p-6 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Kondisi Alert</p>

              {kondisi && (
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "Merah", value: kondisi.merah_count, color: "#DC2626" },
                    { label: "Oranye", value: kondisi.oranye_count, color: "#EA580C" },
                    { label: "Kuning", value: kondisi.kuning_count, color: "#CA8A04" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="rounded-lg bg-muted/50 p-2.5 text-center">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="text-xl font-bold tabular-nums" style={{ color }}>{value}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-lg bg-muted/30 p-3 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total warning</span>
                  <span className="font-semibold">{kondisi?.total_toko_warning ?? record.jumlah_toko} toko</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Avg AEGIS Score</span>
                  <span className="font-semibold">{(kondisi?.avg_aegis_score ?? record.aegis_score_rata).toFixed(1)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pola dominan</span>
                  <span className="font-bold">{kondisi?.pola_dominan ?? "—"}</span>
                </div>
              </div>

              {topStores.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">
                    Top {topStores.length} Toko — Score Tertinggi
                  </p>
                  <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                    {topStores.map((s) => (
                      <div key={s.id_toko} className="flex items-center justify-between text-xs py-1 border-b border-border/40">
                        <span className="truncate max-w-[160px] text-muted-foreground" title={s.nama_toko}>
                          {s.nama_toko}
                        </span>
                        <span className="font-bold tabular-nums shrink-0 ml-2" style={{ color: scoreColor(s.aegis_score) }}>
                          {s.aegis_score.toFixed(1)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* RIGHT — Form */}
            <div className="p-6 space-y-5 overflow-y-auto">

              {/* Section 1 — Info Kunjungan */}
              <section className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border pb-1.5">
                  Info Kunjungan
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <InputField
                    label="Tanggal Kunjungan"
                    type="date"
                    value={form.tgl_validasi}
                    onChange={(v) => setForm((p) => ({ ...p, tgl_validasi: v }))}
                  />
                  <InputField
                    label="Nama TSO"
                    value={form.validated_by}
                    onChange={(v) => setForm((p) => ({ ...p, validated_by: v }))}
                    placeholder="TSO-xxx Nama"
                  />
                  <InputField
                    label="Toko Dikunjungi"
                    type="number"
                    value={form.toko_dikunjungi}
                    onChange={(v) => setForm((p) => ({ ...p, toko_dikunjungi: v }))}
                  />
                  <InputField
                    label="Toko Terdampak"
                    type="number"
                    value={form.toko_terdampak}
                    onChange={(v) => setForm((p) => ({ ...p, toko_terdampak: v }))}
                  />
                  <InputField
                    label="False Alarm"
                    type="number"
                    value={form.toko_false_alarm}
                    onChange={(v) => setForm((p) => ({ ...p, toko_false_alarm: v }))}
                  />
                  <InputField
                    label="Butuh Investigasi"
                    type="number"
                    value={form.toko_butuh_investigasi}
                    onChange={(v) => setForm((p) => ({ ...p, toko_butuh_investigasi: v }))}
                  />
                </div>
              </section>

              {/* Section 2 — Kategori */}
              <section className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border pb-1.5">
                  Kategori Kondisi
                </p>
                <div className="space-y-2">
                  {KATEGORI_CHOICES.map((k) => (
                    <label key={k} className="flex items-center gap-3 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={form.kategori_list.includes(k)}
                        onChange={() => toggleKategori(k)}
                        className="w-4 h-4 rounded border-border accent-foreground cursor-pointer"
                      />
                      <span className="text-sm flex-1">{k}</span>
                      {form.kategori_list.includes(k) && (
                        <label className="flex items-center gap-1 text-xs text-muted-foreground">
                          <input
                            type="radio"
                            name="kategori_utama"
                            checked={form.kategori_utama === k}
                            onChange={() => setForm((p) => ({ ...p, kategori_utama: k }))}
                            className="accent-foreground cursor-pointer"
                          />
                          Utama
                        </label>
                      )}
                    </label>
                  ))}
                </div>
                {form.kategori_utama && (
                  <div className={`text-xs px-2.5 py-1 rounded-full border w-fit font-medium ${KATEGORI_COLOR[form.kategori_utama] || ""}`}>
                    Utama: {form.kategori_utama}
                  </div>
                )}
              </section>

              {/* Section 3 — Detail per Kategori (conditional) */}
              {has("Kompetitor Eksternal") && (
                <section className="space-y-3 rounded-lg border border-red-200 dark:border-red-800 p-3">
                  <p className="text-xs font-semibold text-red-700 dark:text-red-400">Detail Kompetitor Eksternal</p>
                  <div className="grid grid-cols-2 gap-3">
                    <InputField label="Nama/Brand Kompetitor" value={form.nama_brand}
                      onChange={(v) => setForm((p) => ({ ...p, nama_brand: v }))} placeholder="Opsional" />
                    <InputField label="Gap Harga per Zak (Rp)" type="number" value={form.gap_harga_kompetitor}
                      onChange={(v) => setForm((p) => ({ ...p, gap_harga_kompetitor: v }))} />
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Metode Masuk</label>
                      <select value={form.metode_masuk}
                        onChange={(e) => setForm((p) => ({ ...p, metode_masuk: e.target.value }))}
                        className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring/50">
                        {METODE_MASUK.map((m) => <option key={m}>{m}</option>)}
                      </select>
                    </div>
                    <InputField label="Toko Sudah Beralih" type="number" value={form.toko_sudah_beralih}
                      onChange={(v) => setForm((p) => ({ ...p, toko_sudah_beralih: v }))} />
                    <InputField label="Terpengaruh Belum Beralih" type="number" value={form.toko_terpengaruh}
                      onChange={(v) => setForm((p) => ({ ...p, toko_terpengaruh: v }))} />
                  </div>
                </section>
              )}

              {has("Masalah Stok / Keterlambatan Kirim") && (
                <section className="space-y-3 rounded-lg border border-orange-200 dark:border-orange-800 p-3">
                  <p className="text-xs font-semibold text-orange-700 dark:text-orange-400">Detail Masalah Stok</p>
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <InputField label="Berapa Hari Stok Kosong" type="number" value={form.lama_kosong_hari}
                        onChange={(v) => setForm((p) => ({ ...p, lama_kosong_hari: v }))} />
                    </div>
                    <label className="flex items-center gap-2 text-sm cursor-pointer mb-1.5">
                      <input type="checkbox" checked={form.stok_resolved}
                        onChange={(e) => setForm((p) => ({ ...p, stok_resolved: e.target.checked }))}
                        className="w-4 h-4 rounded border-border accent-foreground cursor-pointer" />
                      Sudah resolved
                    </label>
                  </div>
                </section>
              )}

              {has("Masalah Harga / Gap Harga Besar") && (
                <section className="space-y-3 rounded-lg border border-yellow-200 dark:border-yellow-800 p-3">
                  <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400">Detail Masalah Harga</p>
                  <div className="grid grid-cols-2 gap-3">
                    <InputField label="Gap Harga per Zak (Rp)" type="number" value={form.gap_harga}
                      onChange={(v) => setForm((p) => ({ ...p, gap_harga: v }))} />
                    <InputField label="Produk yang Lebih Murah" value={form.produk_lebih_murah}
                      onChange={(v) => setForm((p) => ({ ...p, produk_lebih_murah: v }))} placeholder="Nama produk" />
                  </div>
                </section>
              )}

              {/* Section 4 — Distribusi Kondisi per Toko */}
              <section className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border pb-1.5">
                  Distribusi Kondisi per Toko (manual)
                </p>
                <div className="space-y-2">
                  {form.distribusi.map((d, i) => (
                    <div key={d.kategori} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">{d.kategori}</span>
                      <input
                        type="number"
                        min={0}
                        value={d.jumlah_toko}
                        onChange={(e) => setForm((p) => {
                          const next = [...p.distribusi];
                          next[i] = { ...next[i], jumlah_toko: e.target.value };
                          return { ...p, distribusi: next };
                        })}
                        className="w-20 px-2 py-1 text-sm rounded border border-border bg-background focus:outline-none text-right"
                        placeholder="0"
                      />
                      <span className="text-xs text-muted-foreground w-7">toko</span>
                    </div>
                  ))}
                </div>
              </section>

              {/* Section 5 — Action Items */}
              <section className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border pb-1.5">
                  Action Items &amp; Target
                </p>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Action Items (wajib)</label>
                    <textarea
                      rows={3}
                      value={form.action_items}
                      onChange={(e) => setForm((p) => ({ ...p, action_items: e.target.value }))}
                      placeholder="Koordinasi gudang, jadwal kunjungan intensif…"
                      className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring/50 resize-none placeholder:text-muted-foreground/60"
                    />
                  </div>
                  <InputField label="Target Tanggal Resolusi" type="date" value={form.target_resolusi}
                    onChange={(v) => setForm((p) => ({ ...p, target_resolusi: v }))} />
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Catatan Detail (opsional)</label>
                    <textarea
                      rows={3}
                      value={form.catatan_detail}
                      onChange={(e) => setForm((p) => ({ ...p, catatan_detail: e.target.value }))}
                      placeholder="Penjelasan lengkap kondisi lapangan…"
                      className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring/50 resize-none placeholder:text-muted-foreground/60"
                    />
                  </div>
                </div>
              </section>

            </div>
          </div>
        </div>

        {/* Footer */}
        {error && (
          <p className="px-6 py-2 text-xs text-destructive bg-destructive/5 border-t border-destructive/20">{error}</p>
        )}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0 bg-muted/30">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors"
          >
            Batal
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => submit(true)}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
            >
              Simpan Draft
            </button>
            <button
              onClick={() => submit(false)}
              disabled={saving}
              className="px-5 py-2 text-sm font-semibold rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition-colors disabled:opacity-50"
            >
              {saving ? "Menyimpan…" : "Submit Validasi"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
