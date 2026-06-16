"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import UpdateCADModal from "@/components/UpdateCADModal";
import type { CADRecord } from "@/components/UpdateCADModal";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { getToken } from "@/lib/auth";
import { downloadFile } from "@/lib/download";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  AlertCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckmarkCircle01Icon,
  Clock01Icon,
  BarChartIcon,
  DownloadIcon,
} from "@hugeicons/core-free-icons";

const toIcon = (i: unknown) => i as IconSvgElement;
const API      = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const PAGE_SIZE = 25;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Summary {
  total_alert:       number;
  open:              number;
  in_progress:       number;
  resolved:          number;
  pct_validated:     number;
  pct_kompetitor:    number;
  avg_response_days: number;
}

// ── Style maps ────────────────────────────────────────────────────────────────

const ALERT_COLOR: Record<string, string> = {
  KRITIS: "#DC2626",
  MERAH:  "#EA580C",
  KUNING: "#CA8A04",
};

const RESOLUSI_BADGE: Record<string, { label: string; cls: string }> = {
  OPEN:        { label: "Belum Ditangani",  cls: "bg-muted text-muted-foreground border border-border" },
  IN_PROGRESS: { label: "Sedang Ditangani", cls: "bg-amber-50 text-amber-700 border border-amber-300 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-700/50" },
  RESOLVED:    { label: "Selesai",          cls: "bg-green-50 text-green-700 border border-green-300 dark:bg-green-950/30 dark:text-green-400 dark:border-green-700/50" },
};

const HASIL_BADGE: Record<string, { label: string; cls: string }> = {
  KOMPETITOR_EKSTERNAL: { label: "Kompetitor Masuk",   cls: "bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-800/50" },
  MASALAH_LOGISTIK:     { label: "Masalah Logistik",   cls: "bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800/50" },
  MASALAH_STOK:         { label: "Masalah Stok",       cls: "bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-800/50" },
  TIDAK_ADA_MASALAH:    { label: "Tidak Ada Masalah",  cls: "bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800/50" },
  LAINNYA:              { label: "Lainnya",            cls: "bg-muted text-muted-foreground border border-border" },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryCard({
  title, value, sub, icon, color,
}: {
  title: string; value: string; sub?: string; icon: unknown; color: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1 flex-1 pr-2 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {title}
            </p>
            <p className="text-2xl font-bold leading-none" style={{ color }}>
              {value}
            </p>
            {sub && (
              <p className="text-[11px] text-muted-foreground leading-snug">{sub}</p>
            )}
          </div>
          <span style={{ color }} className="opacity-60 shrink-0 mt-0.5">
            <HugeiconsIcon icon={toIcon(icon)} size={20} />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-full bg-muted rounded-full h-1.5 mt-2">
      <div
        className="h-1.5 rounded-full transition-all duration-500"
        style={{ width: `${Math.min(100, pct)}%`, backgroundColor: color }}
      />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CADHistoryPage() {
  const { isAdmin } = useAuth();

  const [records,     setRecords]     = useState<CADRecord[]>([]);
  const [total,       setTotal]       = useState(0);
  const [summary,     setSummary]     = useState<Summary | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [summLoading, setSummLoading] = useState(true);

  // Filter state (draft + applied)
  const [draftStatus,    setDraftStatus]    = useState("all");
  const [draftKabupaten, setDraftKabupaten] = useState("");
  const [appliedStatus,    setAppliedStatus]    = useState("all");
  const [appliedKabupaten, setAppliedKabupaten] = useState("");

  const [page, setPage] = useState(0);

  // Modal state
  const [modalRecord,   setModalRecord]   = useState<CADRecord | null>(null);
  const [modalReadOnly, setModalReadOnly] = useState(false);

  // Generate state
  const [generating,  setGenerating]  = useState(false);
  const [genResult,   setGenResult]   = useState<string>("");
  const [exportingCsv, setExportingCsv] = useState(false);

  // ── Fetchers ──────────────────────────────────────────────────────────────

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

  // ── Actions ───────────────────────────────────────────────────────────────

  const applyFilter = () => {
    setAppliedStatus(draftStatus);
    setAppliedKabupaten(draftKabupaten);
    setPage(0);
  };

  const resetFilter = () => {
    setDraftStatus("all");
    setDraftKabupaten("");
    setAppliedStatus("all");
    setAppliedKabupaten("");
    setPage(0);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setGenResult("");
    try {
      const token = getToken();
      const res = await fetch(`${API}/api/aegis/cad-history/generate`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (res.ok) {
        const { created, skipped } = data.data;
        setGenResult(`✓ ${created} record baru dibuat, ${skipped} sudah ada.`);
        fetchRecords();
        fetchSummary();
      } else {
        setGenResult(`✗ ${data.detail ?? "Gagal generate"}`);
      }
    } catch {
      setGenResult("✗ Koneksi gagal");
    } finally {
      setGenerating(false);
    }
  };

  const openModal = (rec: CADRecord, readOnly: boolean) => {
    setModalRecord(rec);
    setModalReadOnly(readOnly);
  };

  const handleSaved = (updated: CADRecord) => {
    setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setModalRecord(null);
    fetchSummary();
  };

  // ── Pagination ────────────────────────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages - 1);

  const pageButtons = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i);
    if (safePage < 4) return [0, 1, 2, 3, 4, 5, 6];
    if (safePage > totalPages - 5) return Array.from({ length: 7 }, (_, i) => totalPages - 7 + i);
    return [safePage - 3, safePage - 2, safePage - 1, safePage, safePage + 1, safePage + 2, safePage + 3];
  }, [totalPages, safePage]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="pt-16 max-w-7xl mx-auto px-6 py-8 space-y-5">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Link href="/aegis" className="hover:text-foreground transition-colors">
                AEGIS Monitor
              </Link>
              <span>/</span>
              <span>CAD Alert History</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">CAD Alert History</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Riwayat validasi lapangan · Resolusi anomali terkonsentrasi
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
                    await downloadFile(
                      `${API}/api/export/cad-history-csv`,
                      "GET",
                      undefined,
                      `CAD_History_${today}.csv`,
                    );
                  } catch (e) {
                    console.error("Export CSV failed:", e);
                  } finally {
                    setExportingCsv(false);
                  }
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                  border border-border hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <HugeiconsIcon icon={toIcon(DownloadIcon)} size={14} />
                {exportingCsv ? "Exporting…" : "Export CSV"}
              </button>
              {isAdmin && (
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                    border border-border hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {generating ? "Generating…" : "Generate dari Data Terkini"}
                </button>
              )}
            </div>
            {genResult && (
              <p
                className={`text-xs ${genResult.startsWith("✓") ? "text-green-600 dark:text-green-400" : "text-destructive"}`}
              >
                {genResult}
              </p>
            )}
          </div>
        </div>

        {/* ── Summary cards ──────────────────────────────────────────── */}
        {summLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : summary && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryCard
              title="Total CAD Alert"
              value={String(summary.total_alert)}
              sub={`${summary.open} open · ${summary.in_progress} proses · ${summary.resolved} selesai`}
              icon={AlertCircleIcon}
              color="#DC2626"
            />
            <Card>
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 pr-2 min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      % Tervalidasi
                    </p>
                    <p
                      className="text-2xl font-bold leading-none mt-1"
                      style={{ color: summary.pct_validated >= 70 ? "#16a34a" : "#CA8A04" }}
                    >
                      {summary.pct_validated}%
                    </p>
                    <ProgressBar
                      pct={summary.pct_validated}
                      color={summary.pct_validated >= 70 ? "#16a34a" : "#CA8A04"}
                    />
                  </div>
                  <span className="text-green-600 opacity-60 shrink-0 mt-0.5">
                    <HugeiconsIcon icon={toIcon(CheckmarkCircle01Icon)} size={20} />
                  </span>
                </div>
              </CardContent>
            </Card>
            <SummaryCard
              title="% Kompetitor Eksternal"
              value={`${summary.pct_kompetitor}%`}
              sub="dari yang sudah divalidasi"
              icon={BarChartIcon}
              color="#DC2626"
            />
            <SummaryCard
              title="Avg Response Time"
              value={summary.avg_response_days > 0 ? `${summary.avg_response_days} hari` : "—"}
              sub="rata-rata alert → kunjungan"
              icon={Clock01Icon}
              color="#3b82f6"
            />
          </div>
        )}

        {/* ── Filter bar ─────────────────────────────────────────────── */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium">Status</label>
                <select
                  value={draftStatus}
                  onChange={(e) => setDraftStatus(e.target.value)}
                  className="px-3 py-1.5 text-sm rounded-md border border-border bg-background
                    focus:outline-none focus:ring-2 focus:ring-ring/50"
                >
                  <option value="all">Semua Status</option>
                  <option value="OPEN">Open</option>
                  <option value="IN_PROGRESS">In Progress</option>
                  <option value="RESOLVED">Resolved</option>
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
                  className="px-3 py-1.5 text-sm rounded-md border border-border bg-background
                    focus:outline-none focus:ring-2 focus:ring-ring/50 placeholder:text-muted-foreground"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={applyFilter}
                  className="px-4 py-1.5 rounded-lg text-sm font-semibold bg-foreground text-background
                    hover:bg-foreground/90 transition-colors"
                >
                  Terapkan
                </button>
                <button
                  onClick={resetFilter}
                  className="px-4 py-1.5 rounded-lg text-sm font-medium border border-border
                    hover:bg-muted transition-colors text-muted-foreground"
                >
                  Reset
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Table ──────────────────────────────────────────────────── */}
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
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 rounded" />
                ))}
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur-sm">
                      <TableRow className="border-b border-muted/50 hover:bg-transparent">
                        <TableHead className="pl-4 text-xs uppercase tracking-wider">Kabupaten</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Tgl Alert</TableHead>
                        <TableHead className="text-right text-xs uppercase tracking-wider">Toko</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Level</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">TSO</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Hasil Validasi</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider">Status</TableHead>
                        <TableHead className="w-28 pr-4 text-right text-xs uppercase tracking-wider">Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {records.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={8}
                            className="text-center py-14 text-muted-foreground"
                          >
                            <p className="text-sm font-medium">Tidak ada record yang sesuai</p>
                            <button
                              onClick={resetFilter}
                              className="text-xs underline underline-offset-2 mt-1"
                            >
                              Reset filter
                            </button>
                          </TableCell>
                        </TableRow>
                      ) : (
                        records.map((rec) => {
                          const resolusiBadge = RESOLUSI_BADGE[rec.status_resolusi] ?? RESOLUSI_BADGE.OPEN;
                          const hasilBadge    = rec.hasil_validasi
                            ? (HASIL_BADGE[rec.hasil_validasi] ?? { label: rec.hasil_validasi, cls: "bg-muted text-muted-foreground" })
                            : { label: "Belum Divalidasi", cls: "bg-muted text-muted-foreground" };

                          return (
                            <TableRow key={rec.id} className="hover:bg-muted/30 border-b border-muted/50">
                              <TableCell className="pl-4 font-medium max-w-[180px] truncate" title={rec.kabupaten}>
                                {rec.kabupaten.replace(/^KABUPATEN /, "KAB. ")}
                              </TableCell>
                              <TableCell className="text-muted-foreground text-xs tabular-nums">
                                {rec.tanggal_alert}
                              </TableCell>
                              <TableCell className="text-right tabular-nums font-semibold">
                                {rec.jumlah_toko}
                              </TableCell>
                              <TableCell>
                                <span
                                  className="text-[10px] font-bold px-2 py-0.5 rounded"
                                  style={{
                                    color: ALERT_COLOR[rec.status_alert] ?? "#6b7280",
                                    backgroundColor: `${ALERT_COLOR[rec.status_alert] ?? "#6b7280"}18`,
                                    border: `1px solid ${ALERT_COLOR[rec.status_alert] ?? "#6b7280"}30`,
                                  }}
                                >
                                  {rec.status_alert}
                                </span>
                              </TableCell>
                              <TableCell
                                className="text-muted-foreground text-xs max-w-[120px] truncate"
                                title={rec.tso_assigned ?? ""}
                              >
                                {rec.tso_assigned
                                  ? rec.tso_assigned.replace(/^TSO-\d+ /, "")
                                  : <span className="text-muted-foreground/50">—</span>
                                }
                              </TableCell>
                              <TableCell>
                                <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${hasilBadge.cls}`}>
                                  {hasilBadge.label}
                                </span>
                              </TableCell>
                              <TableCell>
                                <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${resolusiBadge.cls}`}>
                                  {resolusiBadge.label}
                                </span>
                              </TableCell>
                              <TableCell className="pr-4 text-right">
                                {rec.status_resolusi === "OPEN" && (
                                  <button
                                    onClick={() => openModal(rec, false)}
                                    disabled={!isAdmin}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border text-xs font-medium transition-colors
                                      border-amber-500/60 text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-500/40 dark:hover:bg-amber-950/30
                                      disabled:opacity-40 disabled:cursor-not-allowed"
                                  >
                                    Assign &amp; Update
                                  </button>
                                )}
                                {rec.status_resolusi === "IN_PROGRESS" && (
                                  <button
                                    onClick={() => openModal(rec, false)}
                                    disabled={!isAdmin}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border text-xs font-medium transition-colors
                                      border-blue-500/60 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:border-blue-500/40 dark:hover:bg-blue-950/30
                                      disabled:opacity-40 disabled:cursor-not-allowed"
                                  >
                                    Update Status
                                  </button>
                                )}
                                {rec.status_resolusi === "RESOLVED" && (
                                  <button
                                    onClick={() => openModal(rec, true)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border text-xs font-medium transition-colors
                                      border-border text-muted-foreground hover:bg-muted"
                                  >
                                    Lihat Detail
                                    <HugeiconsIcon icon={toIcon(ChevronRightIcon)} size={11} />
                                  </button>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={safePage === 0}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
                        border border-border hover:bg-muted transition-colors
                        disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <HugeiconsIcon icon={toIcon(ChevronLeftIcon)} size={13} />
                      Sebelumnya
                    </button>
                    <div className="flex items-center gap-1">
                      {pageButtons.map((p) => (
                        <button
                          key={p}
                          onClick={() => setPage(p)}
                          className={`w-7 h-7 rounded text-xs font-medium transition-colors ${
                            p === safePage
                              ? "bg-foreground text-background"
                              : "hover:bg-muted text-muted-foreground"
                          }`}
                        >
                          {p + 1}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={safePage >= totalPages - 1}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium
                        border border-border hover:bg-muted transition-colors
                        disabled:opacity-40 disabled:cursor-not-allowed"
                    >
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

      {/* Modal */}
      {modalRecord && (
        <UpdateCADModal
          record={modalRecord}
          readOnly={modalReadOnly}
          onClose={() => setModalRecord(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
