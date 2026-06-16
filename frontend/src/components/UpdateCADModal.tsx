"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { getToken } from "@/lib/auth";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface CADRecord {
  id: string;
  kabupaten: string;
  tanggal_alert: string;
  status_alert: string;
  jumlah_toko: number;
  aegis_score_rata: number;
  tso_assigned: string | null;
  tanggal_kunjungan: string | null;
  hasil_validasi: string | null;
  catatan: string | null;
  status_resolusi: string;
  tanggal_resolved: string | null;
  created_at: string;
}

interface Props {
  record: CADRecord;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: (updated: CADRecord) => void;
}

const HASIL_OPTIONS = [
  {
    value: "KOMPETITOR_EKSTERNAL",
    label: "Kompetitor Eksternal",
    desc: "Ditemukan produk kompetitor di area",
    color: "red",
  },
  {
    value: "MASALAH_LOGISTIK",
    label: "Masalah Logistik",
    desc: "Keterlambatan pengiriman atau distribusi",
    color: "orange",
  },
  {
    value: "MASALAH_STOK",
    label: "Masalah Stok",
    desc: "Kehabisan stok Main Brand",
    color: "orange",
  },
  {
    value: "TIDAK_ADA_MASALAH",
    label: "Tidak Ada Masalah",
    desc: "Kondisi normal, anomali data",
    color: "green",
  },
  {
    value: "LAINNYA",
    label: "Lainnya",
    desc: "Lihat catatan",
    color: "gray",
  },
] as const;

const ALERT_COLOR: Record<string, string> = {
  KRITIS: "#DC2626",
  MERAH:  "#EA580C",
  KUNING: "#CA8A04",
};

export default function UpdateCADModal({ record, readOnly = false, onClose, onSaved }: Props) {
  const [tsoList, setTsoList] = useState<string[]>([]);
  const [form, setForm] = useState({
    tso_assigned:      record.tso_assigned      ?? "",
    tanggal_kunjungan: record.tanggal_kunjungan ?? "",
    hasil_validasi:    record.hasil_validasi    ?? "",
    catatan:           record.catatan           ?? "",
    status_resolusi:
      record.status_resolusi === "OPEN" ? "IN_PROGRESS" : record.status_resolusi,
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  useEffect(() => {
    fetch(`${API}/api/aegis/tso-list`)
      .then((r) => r.json())
      .then((r) => setTsoList(r.data ?? []))
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/aegis/cad-history/${record.id}/update`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          tso_assigned:      form.tso_assigned      || null,
          tanggal_kunjungan: form.tanggal_kunjungan || null,
          hasil_validasi:    form.hasil_validasi    || null,
          catatan:           form.catatan           || null,
          status_resolusi:   form.status_resolusi,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.detail ?? "Gagal menyimpan perubahan");
        return;
      }
      const data = await res.json();
      onSaved(data.data as CADRecord);
    } catch {
      setError("Koneksi ke server gagal");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative z-10 bg-card border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold">
              {readOnly ? "Detail CAD Alert" : "Update CAD Alert"}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">{record.kabupaten}</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center
              text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Alert info bar */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 rounded-lg bg-muted/50 text-xs">
            <span className="text-muted-foreground">Alert:</span>
            <span className="font-medium">{record.tanggal_alert}</span>
            <span className="text-muted-foreground/40">·</span>
            <span className="font-medium">{record.jumlah_toko} toko</span>
            <span className="text-muted-foreground/40">·</span>
            <span
              className="font-bold"
              style={{ color: ALERT_COLOR[record.status_alert] ?? "#6b7280" }}
            >
              {record.status_alert}
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-muted-foreground">Score rata {record.aegis_score_rata.toFixed(1)}</span>
          </div>

          {/* TSO */}
          <div>
            <label className="text-xs font-medium mb-1.5 block">TSO yang Ditugaskan</label>
            {readOnly ? (
              <p className="px-3 py-2 text-sm bg-muted rounded-md">
                {record.tso_assigned ?? <span className="text-muted-foreground">—</span>}
              </p>
            ) : (
              <select
                value={form.tso_assigned}
                onChange={(e) => setForm((f) => ({ ...f, tso_assigned: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background
                  focus:outline-none focus:ring-2 focus:ring-ring/50"
              >
                <option value="">— Pilih TSO —</option>
                {tsoList.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Tanggal kunjungan */}
          <div>
            <label className="text-xs font-medium mb-1.5 block">Tanggal Kunjungan</label>
            {readOnly ? (
              <p className="px-3 py-2 text-sm bg-muted rounded-md">
                {record.tanggal_kunjungan ?? <span className="text-muted-foreground">—</span>}
              </p>
            ) : (
              <input
                type="date"
                value={form.tanggal_kunjungan}
                onChange={(e) => setForm((f) => ({ ...f, tanggal_kunjungan: e.target.value }))}
                className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background
                  focus:outline-none focus:ring-2 focus:ring-ring/50"
              />
            )}
          </div>

          {/* Hasil validasi */}
          <div>
            <label className="text-xs font-medium mb-2 block">Hasil Validasi</label>
            {readOnly ? (
              <p className="px-3 py-2 text-sm bg-muted rounded-md">
                {HASIL_OPTIONS.find((o) => o.value === record.hasil_validasi)?.label
                  ?? <span className="text-muted-foreground">Belum divalidasi</span>}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {HASIL_OPTIONS.map((opt) => {
                  const active = form.hasil_validasi === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, hasil_validasi: opt.value }))}
                      className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                        active
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-foreground/25"
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded-full border-2 mt-0.5 shrink-0 flex items-center justify-center ${
                          active ? "border-primary" : "border-border"
                        }`}
                      >
                        {active && (
                          <div className="w-2 h-2 rounded-full bg-primary" />
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-medium text-foreground">{opt.label}</p>
                        <p className="text-[11px] text-muted-foreground">{opt.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Catatan */}
          <div>
            <label className="text-xs font-medium mb-1.5 block">
              Catatan{" "}
              {!readOnly && (
                <span className="text-muted-foreground font-normal">(opsional)</span>
              )}
            </label>
            {readOnly ? (
              <p className="px-3 py-2 text-sm bg-muted rounded-md min-h-[3rem] leading-relaxed">
                {record.catatan ?? <span className="text-muted-foreground">—</span>}
              </p>
            ) : (
              <textarea
                value={form.catatan}
                onChange={(e) => setForm((f) => ({ ...f, catatan: e.target.value }))}
                rows={3}
                placeholder="Temuan lapangan, kondisi toko, detail kompetitor, dll."
                className="w-full px-3 py-2 text-sm rounded-md border border-border bg-background resize-none
                  focus:outline-none focus:ring-2 focus:ring-ring/50 placeholder:text-muted-foreground"
              />
            )}
          </div>

          {/* Status resolusi (edit only) */}
          {!readOnly && (
            <div>
              <label className="text-xs font-medium mb-2 block">Status Resolusi</label>
              <div className="flex gap-2">
                {(["IN_PROGRESS", "RESOLVED"] as const).map((s) => {
                  const active = form.status_resolusi === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, status_resolusi: s }))}
                      className={`flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                        active
                          ? s === "RESOLVED"
                            ? "border-green-500 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400 dark:border-green-600"
                            : "border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-600"
                          : "border-border text-muted-foreground hover:border-foreground/30"
                      }`}
                    >
                      {s === "IN_PROGRESS" ? "Sedang Ditangani" : "Selesai"}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Resolved timestamp (read only) */}
          {readOnly && record.tanggal_resolved && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800/40">
              <span className="text-green-600 dark:text-green-400 text-xs font-semibold">✓</span>
              <span className="text-xs text-green-700 dark:text-green-300">
                Diselesaikan pada {record.tanggal_resolved}
              </span>
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-border hover:bg-muted transition-colors"
          >
            {readOnly ? "Tutup" : "Batal"}
          </button>
          {!readOnly && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-foreground text-background
                hover:bg-foreground/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Menyimpan…" : "Simpan"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
