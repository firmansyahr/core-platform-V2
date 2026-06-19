"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import UpdateCADModal from "@/components/UpdateCADModal";
import ValidasiModal, { type CADRecordFull } from "@/components/ValidasiModal";
import type { CADRecord } from "@/components/UpdateCADModal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { getToken, getUser } from "@/lib/auth";
import { downloadFile } from "@/lib/download";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  AlertCircleIcon, ChevronLeftIcon, ChevronRightIcon,
  CheckmarkCircle01Icon, Clock01Icon, BarChartIcon, DownloadIcon,
} from "@hugeicons/core-free-icons";

const toIcon = (i: unknown) => i as IconSvgElement;
const API      = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const PAGE_SIZE = 25;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Summary {
  total_alerts:     number;
  total_alert:      number;
  pending_validasi: number;
  in_progress:      number;
  resolved:         number;
  avg_response_days: number;
  avg_toko_dikunjungi: number;
  kategori_distribution: Record<string, number>;
}

interface CADRecordExt extends CADRecord {
  status?: string;
  tgl_alert?: string;
  overdue?: boolean;
  hasil_validasi_detail?: Record<string, unknown> | null;
  kondisi_alert?: {
    total_toko_warning: number;
    merah_count: number;
    oranye_count: number;
    kuning_count: number;
    avg_aegis_score: number;
    pola_dominan: string;
  };
}

// ─── Style maps ───────────────────────────────────────────────────────────────

const ALERT_COLOR: Record<string, string> = {
  KRITIS: "#DC2626", MERAH: "#EA580C", KUNING: "#CA8A04",
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  "Pending Validasi": { label: "Pending Validasi", cls: "bg-muted text-muted-foreground border border-border" },
  "In Progress":      { label: "In Progress",      cls: "bg-blue-50 text-blue-700 border border-blue-300 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-700/50" },
  "Resolved":         { label: "Resolved",          cls: "bg-green-50 text-green-700 border border-green-300 dark:bg-green-950/30 dark:text-green-400 dark:border-green-700/50" },
  "Butuh Eskalasi":   { label: "Butuh Eskalasi",   cls: "bg-red-50 text-red-700 border border-red-300 dark:bg-red-950/30 dark:text-red-400 dark:border-red-700/50" },
  // Legacy
  OPEN:        { label: "Pending Validasi", cls: "bg-muted text-muted-foreground border border-border" },
  IN_PROGRESS: { label: "In Progress",      cls: "bg-blue-50 text-blue-700 border border-blue-300 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-700/50" },
  RESOLVED:    { label: "Resolved",         cls: "bg-green-50 text-green-700 border border-green-300 dark:bg-green-950/30 dark:text-green-400 dark:border-green-700/50" },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({
  title, value, sub, icon, color,
}: { title: string; value: string; sub?: string; icon: unknown; color: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1 flex-1 pr-2 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold leading-none" style={{ color }}>{value}</p>
            {sub && <p className="text-[11px] text-muted-foreground leading-snug">{sub}</p>}
          </div>
          <span style={{ color }} className="opacity-60 shrink-0 mt-0.5">
            <HugeiconsIcon icon={toIcon(icon)} size={20} />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CADHistoryPage() {
  const { isAdmin }  = useAuth();
  const router       = useRouter();
  const currentUser  = getUser()?.name || getUser()?.username || "";

  const [records,     setRecords]     = useState<CADRecordExt[]>([]);
  const [total,       setTotal]       = useState(0);
  const [summary,     setSummary]     = useState<Summary | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [summLoading, setSummLoading] = useState(true);

  const [draftStatus,    setDraftStatus]    = useState("all");
  const [draftKabupaten, setDraftKabupaten] = useState("");
  const [appliedStatus,    setAppliedStatus]    = useState("all");
  const [appliedKabupaten, setAppliedKabupaten] = useState("");
  const [page, setPage] = useState(0);

  const [modalRecord,   setModalRecord]   = useState<CADRecordExt | null>(null);
  const [modalReadOnly, setModalReadOnly] = useState(false);
  const [validasiRecord, setValidasiRecord] = useState<CADRecordExt | null>(null);

  const [generating,   setGenerating]   = useState(false);
  const [genResult,    setGenResult]    = useState("");
  const [exportingCsv, setExportingCsv] = useState(false);

  // ─── Fetchers ─────────────────────────────────────────────────────────────

  const fetchSummary = useCallback(() => {
    setSummLoading(true);
    fetch(`${API}/api/aegis/cad-history/summary`)
      .then((r) => r.json())
      .then((r) => setSummary(r.data ?? null))
      .catch(() => {})
      .finally(() => setSummLoading(false));
  }, []);

  const fetchRecords = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({
      status:    appliedStatus,
      kabupaten: appliedKabupaten,
      limit:     String(PAGE_SIZE),
      offset:    String(page * PAGE_SIZE),
    });
    fetch(`${API}/api/aegis/cad-history?${params}`)
      .then((r) => r.json())
      .then((r) => {
        setRecords(r.data ?? []);
        setTotal(r.meta?.total ?? 0);
      })
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [appliedStatus, appliedKabupaten, page]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  // ─── Actions ──────────────────────────────────────────────────────────────

  const applyFilter = () => {
    setAppliedStatus(draftStatus);
    setAppliedKabupaten(draftKabupaten);
    setPage(0);
  };

  const resetFilter = () => {
    setDraftStatus("all"); setDraftKabupaten("");
    setAppliedStatus("all"); setAppliedKabupaten("");
    setPage(0);
  };

  const handleGenerate = async () => {
    setGenerating(true); setGenResult("");
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/aegis/cad-history/generate`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (res.ok) {
        setGenResult(`✓ ${data.data.created} record baru dibuat, ${data.data.skipped} sudah ada.`);
        fetchRecords(); fetchSummary();
      } else {
        setGenResult(`✗ ${data.detail ?? "Gagal generate"}`);
      }
    } catch { setGenResult("✗ Koneksi gagal"); }
    finally { setGenerating(false); }
  };

  const handleSaved = (updated: CADRecord) => {
    setRecords((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
    setModalRecord(null);
    fetchSummary();
  };

  // ─── Pagination ───────────────────────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages - 1);
  const pageButtons = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i);
    if (safePage < 4)             return [0,1,2,3,4,5,6];
    if (safePage > totalPages - 5) return Array.from({ length: 7 }, (_, i) => totalPages - 7 + i);
    return [safePage-3, safePage-2, safePage-1, safePage, safePage+1, safePage+2, safePage+3];
  }, [totalPages, safePage]);

  const getStatusLabel = (rec: CADRecordExt) =>
    rec.status || (rec.status_resolusi === "OPEN" ? "Pending Validasi" :
                   rec.status_resolusi === "IN_PROGRESS" ? "In Progress" : "Resolved");

  const getKategoriUtama = (rec: CADRecordExt) => {
    const hvd = rec.hasil_validasi_detail;
    if (hvd && typeof hvd === "object" && (hvd as Record<string, unknown>).kategori_utama) {
      return String((hvd as Record<string, unknown>).kategori_utama);
    }
    const MAP: Record<string, string> = {
      KOMPETITOR_EKSTERNAL: "Kompetitor Eksternal",
      MASALAH_LOGISTIK: "Masalah Stok",
      MASALAH_STOK: "Masalah Stok",
      TIDAK_ADA_MASALAH: "Kondisi Normal",
      LAINNYA: "Lainnya",
    };
    return rec.hasil_validasi ? (MAP[rec.hasil_validasi] || rec.hasil_validasi) : "—";
  };

  const getDikunjungi = (rec: CADRecordExt) => {
    const hvd = rec.hasil_validasi_detail;
    if (hvd && typeof hvd === "object") {
      const val = (hvd as Record<string, unknown>).toko_dikunjungi;
      if (val != null) return String(val);
    }
    return "—";
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="pt-16 max-w-7xl mx-auto px-6 py-8 space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Link href="/aegis" className="hover:text-foreground transition-colors">AEGIS Monitor</Link>
              <span>/</span>
              <span>CAD Alert History</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">CAD Alert History</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Riwayat validasi lapangan · Critical Account Defense
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              <button
                disabled={exportingCsv}
                onClick={async () => {
                  setExportingCsv(true);
                  try {
                    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
                    await downloadFile(`${API}/api/export/cad-history-csv`, "GET", undefined, `CAD_History_${today}.csv`);
                  } finally { setExportingCsv(false); }
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                  border border-border hover:bg-muted transition-colors disabled:opacity-50"
              >
                <HugeiconsIcon icon={toIcon(DownloadIcon)} size={14} />
                {exportingCsv ? "Exporting…" : "Export CSV"}
              </button>
              {isAdmin && (
                <button onClick={handleGenerate} disabled={generating}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                    border border-border hover:bg-muted transition-colors disabled:opacity-50">
                  {generating ? "Generating…" : "Generate dari Data Terkini"}
                </button>
              )}
            </div>
            {genResult && (
              <p className={`text-xs ${genResult.startsWith("✓") ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
                {genResult}
              </p>
            )}
          </div>
        </div>

        {/* Summary cards */}
        {summLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        ) : summary && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryCard
              title="Total Alert" icon={AlertCircleIcon} color="#DC2626"
              value={String(summary.total_alerts ?? summary.total_alert ?? 0)}
              sub={`${summary.avg_response_days} hari avg response`}
            />
            <SummaryCard
              title="Pending Validasi" icon={Clock01Icon} color="#6b7280"
              value={String(summary.pending_validasi ?? 0)}
              sub="belum divalidasi"
            />
            <SummaryCard
              title="In Progress" icon={BarChartIcon} color="#3b82f6"
              value={String(summary.in_progress ?? 0)}
              sub={`avg ${summary.avg_toko_dikunjungi} toko dikunjungi`}
            />
            <SummaryCard
              title="Resolved" icon={CheckmarkCircle01Icon} color="#16a34a"
              value={String(summary.resolved ?? 0)}
              sub="selesai divalidasi"
            />
          </div>
        )}

        {/* Filter bar */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium">Status</label>
                <select
                  value={draftStatus}
                  onChange={(e) => setDraftStatus(e.target.value)}
                  className="px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring/50"
                >
                  <option value="all">Semua Status</option>
                  <option value="OPEN">Pending Validasi</option>
                  <option value="IN_PROGRESS">In Progress</option>
                  <option value="RESOLVED">Resolved</option>
                  <option value="Butuh Eskalasi">Butuh Eskalasi</option>
                </select>
              </div>
              <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
                <label className="text-xs font-medium">Kabupaten</label>
                <input
                  type="text"
                  placeholder="Cari kabupaten…"
                  value={draftKabupaten}
                  onChange={(e) => setDraftKabupaten(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilter()}
                  className="px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring/50 placeholder:text-muted-foreground"
                />
              </div>
              <div className="flex items-center gap-2">
                <button onClick={applyFilter}
                  className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-foreground text-background hover:bg-foreground/90 transition-colors">
                  Terapkan
                </button>
                <button onClick={resetFilter}
                  className="px-4 py-1.5 rounded-lg text-sm font-medium border border-border hover:bg-muted transition-colors text-muted-foreground">
                  Reset
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <HugeiconsIcon icon={toIcon(AlertCircleIcon)} size={15} color="#DC2626" />
              Riwayat CAD Alert
              {!loading && (
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  {total} record · halaman {safePage + 1} / {totalPages}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 px-0">
            {loading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9 rounded" />)}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur-sm">
                      <TableRow className="border-b border-muted/50 hover:bg-transparent">
                        <TableHead className="pl-4 text-xs uppercase tracking-wider">Kabupaten</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Tgl Alert</TableHead>
                        <TableHead className="text-right text-xs uppercase tracking-wider">Warning</TableHead>
                        <TableHead className="text-right text-xs uppercase tracking-wider">Dikunjungi</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Kategori Utama</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
                        <TableHead className="w-36 pr-4 text-right text-xs uppercase tracking-wider">Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {records.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-14 text-muted-foreground">
                            <p className="text-sm font-medium">Tidak ada record yang sesuai</p>
                            <button onClick={resetFilter} className="text-xs underline underline-offset-2 mt-1">Reset filter</button>
                          </TableCell>
                        </TableRow>
                      ) : records.map((rec) => {
                        const statusLabel = getStatusLabel(rec);
                        const badge       = STATUS_BADGE[statusLabel] ?? STATUS_BADGE["Pending Validasi"];
                        const kategori    = getKategoriUtama(rec);
                        const dikunjungi  = getDikunjungi(rec);

                        return (
                          <TableRow key={rec.id} className="hover:bg-muted/30 border-b border-muted/50">
                            <TableCell className="pl-4 font-medium max-w-[180px]">
                              <p className="truncate" title={rec.kabupaten}>
                                {rec.kabupaten.replace(/^KABUPATEN /, "KAB. ")}
                              </p>
                              {rec.overdue && (
                                <span className="text-[9px] font-bold text-red-600 dark:text-red-400">⏰ Overdue</span>
                              )}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-xs tabular-nums">
                              {rec.tgl_alert || rec.tanggal_alert}
                            </TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">
                              <div>
                                {rec.jumlah_toko}
                                {rec.kondisi_alert && (
                                  <p className="text-[9px] text-muted-foreground font-normal">
                                    <span style={{ color: "#DC2626" }}>{rec.kondisi_alert.merah_count}M</span>
                                    {" "}
                                    <span style={{ color: "#EA580C" }}>{rec.kondisi_alert.oranye_count}O</span>
                                  </p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {dikunjungi}
                            </TableCell>
                            <TableCell className="max-w-[140px]">
                              {kategori !== "—" ? (
                                <span className="text-[10px] font-medium text-muted-foreground truncate block">
                                  {kategori}
                                </span>
                              ) : (
                                <span className="text-muted-foreground/50 text-xs">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <span className={`text-[10px] font-medium px-2 py-0.5 rounded whitespace-nowrap ${badge.cls}`}>
                                {badge.label}
                              </span>
                            </TableCell>
                            <TableCell className="pr-4 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {isAdmin && statusLabel !== "Resolved" && (
                                  <button
                                    onClick={() => setValidasiRecord(rec)}
                                    className="inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium transition-colors
                                      border-amber-500/60 text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-500/40 dark:hover:bg-amber-950/30"
                                  >
                                    Validasi
                                  </button>
                                )}
                                <Link
                                  href={`/aegis/cad-history/${encodeURIComponent(rec.id)}`}
                                  className="inline-flex items-center px-2.5 py-1 rounded border text-xs font-medium transition-colors
                                    border-border text-muted-foreground hover:bg-muted"
                                >
                                  Detail →
                                </Link>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                    <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:bg-muted transition-colors disabled:opacity-40">
                      <HugeiconsIcon icon={toIcon(ChevronLeftIcon)} size={13} />
                      Sebelumnya
                    </button>
                    <div className="flex items-center gap-1">
                      {pageButtons.map((p) => (
                        <button key={p} onClick={() => setPage(p)}
                          className={`w-7 h-7 rounded text-xs font-medium transition-colors ${
                            p === safePage ? "bg-foreground text-background" : "hover:bg-muted text-muted-foreground"
                          }`}>
                          {p + 1}
                        </button>
                      ))}
                    </div>
                    <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:bg-muted transition-colors disabled:opacity-40">
                      Berikutnya
                      <HugeiconsIcon icon={toIcon(ChevronRightIcon)} size={13} />
                    </button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {!isAdmin && (
          <p className="text-center text-[11px] text-muted-foreground/60">
            Login sebagai admin untuk mengisi hasil validasi lapangan.
          </p>
        )}
      </main>

      {/* Modals */}
      {modalRecord && (
        <UpdateCADModal record={modalRecord} readOnly={modalReadOnly}
          onClose={() => setModalRecord(null)} onSaved={handleSaved} />
      )}
      {validasiRecord && (
        <ValidasiModal
          record={{
            id: validasiRecord.id,
            kabupaten: validasiRecord.kabupaten,
            tgl_alert: validasiRecord.tgl_alert || validasiRecord.tanggal_alert || "",
            tanggal_alert: validasiRecord.tanggal_alert,
            status: getStatusLabel(validasiRecord),
            status_resolusi: validasiRecord.status_resolusi,
            kondisi_alert: validasiRecord.kondisi_alert,
            jumlah_toko: validasiRecord.jumlah_toko,
            aegis_score_rata: validasiRecord.aegis_score_rata,
            hasil_validasi_detail: validasiRecord.hasil_validasi_detail,
          } as CADRecordFull}
          currentUser={currentUser}
          onClose={() => setValidasiRecord(null)}
          onSaved={() => { fetchRecords(); fetchSummary(); setValidasiRecord(null); }}
        />
      )}
    </div>
  );
}
