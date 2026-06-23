"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useAuth } from "@/hooks/useAuth";
import { getUser } from "@/lib/auth";
import TokoValidasiModal, { KONDISI_COLOR, KONDISI_CHOICES } from "@/components/TokoValidasiModal";
import ValidasiModal, { type CADRecordFull } from "@/components/ValidasiModal";
import UpdateCADModal, { type CADRecord as UpdateCADRecord } from "@/components/UpdateCADModal";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ─── Types ────────────────────────────────────────────────────────────────────

interface KondisiAlert {
  total_toko_warning: number;
  merah_count: number;
  oranye_count: number;
  kuning_count: number;
  avg_aegis_score: number;
  pola_dominan: string;
}

interface HasilValidasi {
  kategori_utama: string;
  kategori_sekunder: string[] | null;
  toko_dikunjungi: number | null;
  toko_terdampak: number | null;
  toko_false_alarm: number | null;
  toko_butuh_investigasi: number | null;
  detail_kompetitor: {
    ada_kompetitor: boolean;
    nama_brand: string;
    gap_harga_per_zak: number | null;
    metode_masuk: string;
    toko_sudah_beralih: number | null;
    toko_terpengaruh_belum_beralih: number | null;
  } | null;
  detail_stok: {
    ada_masalah_stok: boolean;
    lama_kosong_hari: number | null;
    sudah_resolved: boolean;
  } | null;
  distribusi_kondisi: { kategori: string; jumlah_toko: number }[];
  target_resolusi: string | null;
  action_items: string | null;
  catatan_detail: string | null;
}

interface TokoValidasi {
  id_toko: string;
  nama_toko: string | null;
  aegis_score: number | null;
  kondisi: string;
  catatan: string | null;
  validated_by: string;
  validated_at: string;
}

interface CADRecord {
  id: string;
  kabupaten: string;
  provinsi: string | null;
  tgl_alert: string;
  tanggal_alert?: string;
  status: string;
  status_alert: string;
  status_resolusi: string;
  jumlah_toko: number;
  aegis_score_rata: number;
  kondisi_alert?: KondisiAlert;
  hasil_validasi?: string | null;
  hasil_validasi_detail?: HasilValidasi | null;
  toko_validasi?: TokoValidasi[];
  validated_by: string | null;
  tso_assigned?: string | null;
  tgl_validasi: string | null;
  tanggal_kunjungan?: string | null;
  catatan?: string | null;
  tanggal_resolved?: string | null;
  created_at: string;
  follow_up?: {
    status: string;
    reminder_sent: boolean;
    eskalasi_asm: boolean;
    resolved_at: string | null;
  };
  overdue?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PIE_COLORS = ["#DC2626","#EA580C","#CA8A04","#3b82f6","#8b5cf6","#16a34a","#6b7280"];

const STATUS_BADGE: Record<string, string> = {
  "Pending Validasi": "bg-muted text-muted-foreground border border-border",
  "In Progress":      "bg-blue-100 text-blue-700 border border-blue-300 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-700",
  "Resolved":         "bg-green-100 text-green-700 border border-green-300 dark:bg-green-950/30 dark:text-green-400 dark:border-green-700",
  "Butuh Eskalasi":   "bg-red-100 text-red-700 border border-red-300 dark:bg-red-950/30 dark:text-red-400 dark:border-red-700",
};

function fmtDate(s: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}

function fmtDateTime(s: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CADHistoryDetailPage() {
  const params = useParams<{ id: string }>();
  const id     = params.id;
  const { isAdmin } = useAuth();

  const [record,  setRecord]  = useState<CADRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  const [showTokoModal, setShowTokoModal] = useState(false);
  const [showValidasiModal, setShowValidasiModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);

  const currentUser = getUser()?.name || getUser()?.username || "";

  const fetchRecord = useCallback(() => {
    if (!id) return;
    setLoading(true);
    fetch(`${API}/api/aegis/cad-history/${encodeURIComponent(id)}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((r) => setRecord(r.data ?? null))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { fetchRecord(); }, [fetchRecord]);

  if (loading) return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16 max-w-6xl mx-auto px-6 py-8 space-y-5">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-36 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </main>
    </div>
  );

  if (error || !record) return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16 flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <p className="text-4xl">⚠</p>
          <p className="font-semibold">Record tidak ditemukan</p>
          <Link href="/aegis/cad-history" className="text-sm underline underline-offset-2 text-muted-foreground">
            ← Kembali ke CAD History
          </Link>
        </div>
      </main>
    </div>
  );

  const kondisi    = record.kondisi_alert;
  const hasil      = record.hasil_validasi_detail;
  const tokoList   = record.toko_validasi ?? [];
  const totalWarn  = kondisi?.total_toko_warning ?? record.jumlah_toko;
  const statusCls  = STATUS_BADGE[record.status] ?? STATUS_BADGE["Pending Validasi"];

  const distribusiData = hasil?.distribusi_kondisi.length
    ? hasil.distribusi_kondisi
    : tokoList.length > 0
    ? Object.entries(
        tokoList.reduce<Record<string, number>>((acc, t) => {
          acc[t.kondisi] = (acc[t.kondisi] || 0) + 1;
          return acc;
        }, {})
      ).map(([kategori, jumlah_toko]) => ({ kategori, jumlah_toko }))
    : [];

  const asCADFull: CADRecordFull = {
    id:               record.id,
    kabupaten:        record.kabupaten,
    tgl_alert:        record.tgl_alert,
    tanggal_alert:    record.tanggal_alert,
    status:           record.status,
    status_resolusi:  record.status_resolusi,
    kondisi_alert:    record.kondisi_alert,
    jumlah_toko:      record.jumlah_toko,
    aegis_score_rata: record.aegis_score_rata,
    hasil_validasi_detail: record.hasil_validasi_detail as Record<string, unknown> | null | undefined,
  };

  const asUpdateCADRecord: UpdateCADRecord = {
    id:                record.id,
    kabupaten:         record.kabupaten,
    tanggal_alert:     record.tanggal_alert ?? record.tgl_alert,
    status_alert:      record.status_alert,
    jumlah_toko:       record.jumlah_toko,
    aegis_score_rata:  record.aegis_score_rata,
    tso_assigned:      record.tso_assigned ?? null,
    tanggal_kunjungan: record.tanggal_kunjungan ?? null,
    hasil_validasi:    record.hasil_validasi ?? null,
    catatan:           record.catatan ?? null,
    status_resolusi:   record.status_resolusi,
    tanggal_resolved:  record.tanggal_resolved ?? null,
    created_at:        record.created_at,
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16 max-w-6xl mx-auto px-6 py-8 space-y-5">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/aegis" className="hover:text-foreground transition-colors">AEGIS</Link>
          <span>/</span>
          <Link href="/aegis/cad-history" className="hover:text-foreground transition-colors">CAD History</Link>
          <span>/</span>
          <span className="text-foreground font-medium truncate">{record.kabupaten}</span>
        </div>

        {/* ── Section 1 — Overview ──────────────────────────────── */}
        <Card>
          <CardContent className="pt-5 pb-5">
            <div className="flex flex-col sm:flex-row gap-6">
              <div className="flex-1 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${statusCls}`}>
                    {record.status}
                  </span>
                  {record.overdue && (
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-700 border border-red-300 dark:bg-red-950/30 dark:text-red-400">
                      ⏰ Overdue
                    </span>
                  )}
                </div>
                <div>
                  <h1 className="text-xl font-bold">{record.kabupaten}</h1>
                  {record.provinsi && (
                    <p className="text-sm text-muted-foreground">{record.provinsi}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1 font-mono">{record.id}</p>
                </div>
                <div className="flex flex-wrap gap-4 text-xs">
                  <div>
                    <p className="text-muted-foreground">Tanggal Alert</p>
                    <p className="font-semibold">{fmtDate(record.tgl_alert)}</p>
                  </div>
                  {record.tgl_validasi && (
                    <div>
                      <p className="text-muted-foreground">Tanggal Validasi</p>
                      <p className="font-semibold">{fmtDate(record.tgl_validasi)}</p>
                    </div>
                  )}
                  {record.validated_by && (
                    <div>
                      <p className="text-muted-foreground">Divalidasi Oleh</p>
                      <p className="font-semibold">{record.validated_by}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Kondisi alert counts */}
              {kondisi && (
                <div className="flex flex-col gap-2 min-w-[180px]">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Kondisi Alert</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: "Merah",  count: kondisi.merah_count,  color: "#DC2626" },
                      { label: "Oranye", count: kondisi.oranye_count, color: "#EA580C" },
                      { label: "Kuning", count: kondisi.kuning_count, color: "#CA8A04" },
                    ].map(({ label, count, color }) => (
                      <div key={label} className="rounded-lg bg-muted/40 p-2 text-center">
                        <p className="text-[10px] text-muted-foreground">{label}</p>
                        <p className="text-lg font-bold" style={{ color }}>{count}</p>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0.5 mt-1">
                    <div className="flex justify-between">
                      <span>Total warning</span>
                      <span className="font-semibold">{kondisi.total_toko_warning}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Avg AEGIS Score</span>
                      <span className="font-semibold">{kondisi.avg_aegis_score.toFixed(1)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Pola dominan</span>
                      <span className="font-bold">{kondisi.pola_dominan}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Follow-up status */}
            {record.follow_up && (
              <div className="mt-4 pt-3 border-t border-border flex flex-wrap items-center gap-3 text-xs">
                <span className="text-muted-foreground">Follow-up:</span>
                {record.follow_up.eskalasi_asm && (
                  <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200 dark:bg-red-950/30 dark:text-red-400 font-medium">
                    Eskalasi ke ASM
                  </span>
                )}
                {record.follow_up.resolved_at && (
                  <span className="text-muted-foreground">
                    Resolved: {fmtDate(record.follow_up.resolved_at)}
                  </span>
                )}
                {isAdmin && record.status !== "Pending Validasi" && (
                  <button
                    onClick={() => setShowValidasiModal(true)}
                    className="ml-auto text-xs px-3 py-1 rounded border border-border hover:bg-muted transition-colors"
                  >
                    Edit Validasi
                  </button>
                )}
                {isAdmin && record.status === "Pending Validasi" && (
                  <button
                    onClick={() => setShowValidasiModal(true)}
                    className="ml-auto text-xs px-3 py-1.5 rounded border border-amber-400 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30 transition-colors font-medium"
                  >
                    Mulai Validasi →
                  </button>
                )}
                {isAdmin && (
                  <button
                    onClick={() => setShowUpdateModal(true)}
                    className="text-xs px-3 py-1 rounded border border-border hover:bg-muted transition-colors"
                  >
                    Update Status
                  </button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Section 2 — Hasil Validasi ────────────────────────── */}
        {hasil ? (
          <Card>
            <CardHeader className="border-b border-border pb-3">
              <CardTitle className="text-sm">Hasil Validasi Lapangan</CardTitle>
            </CardHeader>
            <CardContent className="pt-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                {/* Left */}
                <div className="space-y-4">
                  {/* Kategori */}
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Kategori</p>
                    <div className="flex flex-wrap gap-1.5">
                      {hasil.kategori_utama && (
                        <span className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold ${KONDISI_COLOR[hasil.kategori_utama] || "bg-muted text-muted-foreground border-border"}`}>
                          ★ {hasil.kategori_utama}
                        </span>
                      )}
                      {(hasil.kategori_sekunder || []).map((k) => (
                        <span key={k} className={`text-xs px-2.5 py-0.5 rounded-full border ${KONDISI_COLOR[k] || "bg-muted text-muted-foreground border-border"}`}>
                          {k}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Toko stats */}
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: "Dikunjungi",       value: hasil.toko_dikunjungi },
                      { label: "Terdampak",         value: hasil.toko_terdampak },
                      { label: "False Alarm",        value: hasil.toko_false_alarm },
                      { label: "Butuh Investigasi", value: hasil.toko_butuh_investigasi },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-lg bg-muted/40 px-3 py-2">
                        <p className="text-[10px] text-muted-foreground">{label}</p>
                        <p className="text-lg font-bold">{value ?? "—"}</p>
                      </div>
                    ))}
                  </div>

                  {/* Detail kompetitor */}
                  {hasil.detail_kompetitor?.ada_kompetitor && (
                    <div className="rounded-lg border border-red-200 dark:border-red-800 p-3 space-y-1.5 text-xs">
                      <p className="font-semibold text-red-700 dark:text-red-400">Detail Kompetitor</p>
                      {hasil.detail_kompetitor.nama_brand && (
                        <p><span className="text-muted-foreground">Brand: </span>{hasil.detail_kompetitor.nama_brand}</p>
                      )}
                      {hasil.detail_kompetitor.gap_harga_per_zak && (
                        <p><span className="text-muted-foreground">Gap harga: </span>
                          Rp {new Intl.NumberFormat("id-ID").format(hasil.detail_kompetitor.gap_harga_per_zak)}/zak
                        </p>
                      )}
                      {hasil.detail_kompetitor.metode_masuk && (
                        <p><span className="text-muted-foreground">Metode: </span>{hasil.detail_kompetitor.metode_masuk}</p>
                      )}
                      <div className="flex gap-4">
                        {hasil.detail_kompetitor.toko_sudah_beralih != null && (
                          <p><span className="text-muted-foreground">Sudah beralih: </span>
                            <span className="font-semibold text-red-600">{hasil.detail_kompetitor.toko_sudah_beralih} toko</span>
                          </p>
                        )}
                        {hasil.detail_kompetitor.toko_terpengaruh_belum_beralih != null && (
                          <p><span className="text-muted-foreground">Terpengaruh: </span>
                            <span className="font-semibold text-orange-600">{hasil.detail_kompetitor.toko_terpengaruh_belum_beralih} toko</span>
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Action items */}
                  {hasil.action_items && (
                    <div className="space-y-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Action Items</p>
                      <p className="text-sm leading-relaxed whitespace-pre-line">{hasil.action_items}</p>
                    </div>
                  )}

                  {hasil.target_resolusi && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Target resolusi:</span>
                      <span className="font-semibold">{fmtDate(hasil.target_resolusi)}</span>
                    </div>
                  )}

                  {hasil.catatan_detail && (
                    <div className="space-y-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Catatan Detail</p>
                      <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{hasil.catatan_detail}</p>
                    </div>
                  )}
                </div>

                {/* Right — Donut chart */}
                <div className="space-y-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Distribusi Kondisi Toko
                  </p>
                  {distribusiData.length > 0 ? (
                    <>
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie
                            data={distribusiData}
                            dataKey="jumlah_toko"
                            nameKey="kategori"
                            cx="50%"
                            cy="50%"
                            innerRadius={55}
                            outerRadius={90}
                            paddingAngle={2}
                          >
                            {distribusiData.map((_, i) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(val, name) => [`${Number(val)} toko`, String(name)]}
                            contentStyle={{ fontSize: 11, borderRadius: 8 }}
                          />
                          <Legend
                            wrapperStyle={{ fontSize: 10 }}
                            formatter={(value) => value.length > 30 ? value.slice(0, 29) + "…" : value}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="space-y-1">
                        {distribusiData.map((d, i) => (
                          <div key={d.kategori} className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                              <span className="text-muted-foreground truncate max-w-[180px]">{d.kategori}</span>
                            </div>
                            <span className="font-semibold">{d.jumlah_toko} toko</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Distribusi belum tersedia. Isi per-toko validasi untuk melihat distribusi otomatis.
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ) : record.status === "Pending Validasi" ? (
          <Card className="border-dashed border-2">
            <CardContent className="py-10 text-center space-y-3">
              <p className="text-sm font-medium text-muted-foreground">Belum ada hasil validasi</p>
              {isAdmin && (
                <button
                  onClick={() => setShowValidasiModal(true)}
                  className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-lg bg-amber-500 hover:bg-amber-600 text-white transition-colors"
                >
                  Mulai Validasi Sekarang →
                </button>
              )}
            </CardContent>
          </Card>
        ) : null}

        {/* ── Section 3 — Validasi Per Toko ─────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="flex items-center justify-between gap-2 text-sm">
              <span>
                Validasi Per Toko
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {tokoList.length} dari {totalWarn} toko warning tervalidasi
                </span>
              </span>
              {isAdmin && (
                <button
                  onClick={() => setShowTokoModal(true)}
                  className="text-xs px-3 py-1.5 rounded border border-border hover:bg-muted transition-colors font-medium"
                >
                  + Tambah Validasi Toko
                </button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            {/* Progress bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{tokoList.length} tervalidasi</span>
                <span>{totalWarn} total warning</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-green-500 transition-all"
                  style={{ width: `${Math.min(100, totalWarn > 0 ? (tokoList.length / totalWarn) * 100 : 0)}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground">
                {totalWarn > 0 ? ((tokoList.length / totalWarn) * 100).toFixed(1) : 0}% toko warning sudah divalidasi
              </p>
            </div>

            {tokoList.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                Belum ada toko yang divalidasi secara individual.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground">Nama Toko</th>
                      <th className="text-right py-2 px-2 font-medium text-muted-foreground">AEGIS</th>
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground">Kondisi</th>
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground hidden sm:table-cell">Catatan</th>
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground hidden md:table-cell">Oleh</th>
                      <th className="text-left py-2 px-2 font-medium text-muted-foreground hidden lg:table-cell">Waktu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokoList.map((t, i) => (
                      <tr key={t.id_toko + i} className="border-b border-border/40 hover:bg-muted/20">
                        <td className="py-2 px-2">
                          <p className="font-medium truncate max-w-[140px]" title={t.nama_toko || t.id_toko}>
                            {t.nama_toko || t.id_toko}
                          </p>
                          <p className="text-muted-foreground/70 font-mono text-[10px]">{t.id_toko}</p>
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums font-semibold">
                          {t.aegis_score != null
                            ? <span style={{ color: t.aegis_score >= 85 ? "#DC2626" : t.aegis_score >= 65 ? "#EA580C" : t.aegis_score >= 40 ? "#CA8A04" : "#16a34a" }}>
                                {t.aegis_score.toFixed(1)}
                              </span>
                            : "—"
                          }
                        </td>
                        <td className="py-2 px-2">
                          <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full border font-medium whitespace-nowrap ${KONDISI_COLOR[t.kondisi] || "bg-muted text-muted-foreground border-border"}`}>
                            {t.kondisi.length > 20 ? t.kondisi.slice(0, 18) + "…" : t.kondisi}
                          </span>
                        </td>
                        <td className="py-2 px-2 max-w-[160px] hidden sm:table-cell">
                          <p className="truncate text-muted-foreground" title={t.catatan || ""}>{t.catatan || "—"}</p>
                        </td>
                        <td className="py-2 px-2 text-muted-foreground truncate max-w-[100px] hidden md:table-cell">
                          {t.validated_by?.replace(/^TSO-\d+ /, "") || "—"}
                        </td>
                        <td className="py-2 px-2 text-muted-foreground whitespace-nowrap hidden lg:table-cell">
                          {fmtDateTime(t.validated_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

      </main>

      {/* Modals */}
      {showTokoModal && (
        <TokoValidasiModal
          cadId={record.id}
          currentUser={currentUser}
          onClose={() => setShowTokoModal(false)}
          onSaved={() => { fetchRecord(); setShowTokoModal(false); }}
        />
      )}
      {showValidasiModal && (
        <ValidasiModal
          record={asCADFull}
          currentUser={currentUser}
          onClose={() => setShowValidasiModal(false)}
          onSaved={() => { fetchRecord(); }}
        />
      )}
      {showUpdateModal && (
        <UpdateCADModal
          record={asUpdateCADRecord}
          onClose={() => setShowUpdateModal(false)}
          onSaved={() => { fetchRecord(); setShowUpdateModal(false); }}
        />
      )}
    </div>
  );
}
