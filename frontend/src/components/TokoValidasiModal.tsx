"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { getToken } from "@/lib/auth";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const KONDISI_CHOICES = [
  "Kompetitor Eksternal",
  "Masalah Harga / Gap Harga Besar",
  "Masalah Stok / Keterlambatan Kirim",
  "Faktor Seasonal",
  "Faktor Internal Distributor",
  "Kondisi Normal / False Alarm",
  "Butuh Investigasi Lanjut",
];

export const KONDISI_COLOR: Record<string, string> = {
  "Kompetitor Eksternal":              "bg-red-100 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-400",
  "Masalah Harga / Gap Harga Besar":   "bg-yellow-100 text-yellow-700 border-yellow-300 dark:bg-yellow-950/30 dark:text-yellow-400",
  "Masalah Stok / Keterlambatan Kirim":"bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-950/30 dark:text-orange-400",
  "Faktor Seasonal":                   "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-950/30 dark:text-blue-400",
  "Faktor Internal Distributor":       "bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-950/30 dark:text-purple-400",
  "Kondisi Normal / False Alarm":      "bg-green-100 text-green-700 border-green-300 dark:bg-green-950/30 dark:text-green-400",
  "Butuh Investigasi Lanjut":          "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-400",
};

interface Props {
  cadId: string;
  idToko?: string;
  namaToko?: string;
  aegisScore?: number;
  currentUser?: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function TokoValidasiModal({
  cadId,
  idToko = "",
  namaToko = "",
  aegisScore,
  currentUser = "",
  onClose,
  onSaved,
}: Props) {
  const [form, setForm] = useState({
    id_toko:      idToko,
    nama_toko:    namaToko,
    kondisi:      "",
    catatan:      "",
    validated_by: currentUser,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");

  const scoreColor = (s: number) =>
    s >= 85 ? "#DC2626" : s >= 65 ? "#EA580C" : s >= 40 ? "#CA8A04" : "#16a34a";

  const submit = async () => {
    if (!form.id_toko.trim())      { setError("ID Toko harus diisi"); return; }
    if (!form.kondisi)             { setError("Pilih kondisi toko"); return; }
    if (!form.validated_by.trim()) { setError("Nama TSO harus diisi"); return; }
    setSaving(true);
    setError("");
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/aegis/cad-history/${cadId}/toko-validasi`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          id_toko:      form.id_toko,
          nama_toko:    form.nama_toko || null,
          aegis_score:  aegisScore ?? null,
          kondisi:      form.kondisi,
          catatan:      form.catatan || null,
          validated_by: form.validated_by,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-background rounded-2xl shadow-2xl w-full max-w-md">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-sm">Validasi Per Toko</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">

          {/* Toko info */}
          <div className="rounded-lg bg-muted/40 p-3 space-y-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">ID Toko</label>
              {idToko ? (
                <p className="text-sm font-mono font-semibold">{idToko}</p>
              ) : (
                <input
                  type="text"
                  value={form.id_toko}
                  onChange={(e) => setForm((p) => ({ ...p, id_toko: e.target.value }))}
                  placeholder="TK-XXXXXXXX"
                  className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring/50 font-mono"
                />
              )}
            </div>

            {namaToko && (
              <p className="text-sm font-medium">{namaToko}</p>
            )}

            {aegisScore !== undefined && (
              <p className="text-xs text-muted-foreground">
                AEGIS Score:{" "}
                <span className="font-bold tabular-nums" style={{ color: scoreColor(aegisScore) }}>
                  {aegisScore.toFixed(1)}
                </span>
              </p>
            )}
          </div>

          {/* Kondisi */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Kondisi Toko</label>
            <select
              value={form.kondisi}
              onChange={(e) => setForm((p) => ({ ...p, kondisi: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring/50"
            >
              <option value="">— Pilih kondisi —</option>
              {KONDISI_CHOICES.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
            {form.kondisi && (
              <span className={`inline-block text-[11px] px-2.5 py-0.5 rounded-full border mt-1 font-medium ${KONDISI_COLOR[form.kondisi] || ""}`}>
                {form.kondisi}
              </span>
            )}
          </div>

          {/* Catatan */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              Catatan Singkat <span className="text-muted-foreground/60">(maks. 200 karakter)</span>
            </label>
            <textarea
              rows={3}
              maxLength={200}
              value={form.catatan}
              onChange={(e) => setForm((p) => ({ ...p, catatan: e.target.value }))}
              placeholder="Sudah beli dari brand X 2x bulan ini…"
              className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring/50 resize-none placeholder:text-muted-foreground/60"
            />
            <p className="text-[10px] text-muted-foreground text-right">{form.catatan.length}/200</p>
          </div>

          {/* Validated by */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Divalidasi Oleh</label>
            <input
              type="text"
              value={form.validated_by}
              onChange={(e) => setForm((p) => ({ ...p, validated_by: e.target.value }))}
              placeholder="TSO-xxx Nama"
              className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring/50"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <button onClick={onClose}
            className="px-4 py-2 text-sm font-medium border border-border rounded-lg hover:bg-muted transition-colors">
            Batal
          </button>
          <button onClick={submit} disabled={saving}
            className="px-5 py-2 text-sm font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:opacity-50">
            {saving ? "Menyimpan…" : "Simpan"}
          </button>
        </div>
      </div>
    </div>
  );
}
