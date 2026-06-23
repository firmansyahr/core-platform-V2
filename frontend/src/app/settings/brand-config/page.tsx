"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Pencil, Trash2, Plus, X } from "lucide-react";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/hooks/useAuth";
import { apiFetch, API } from "@/lib/fetch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const BC_API = `${API}/api/brand-config`;

interface BrandConfigRow {
  id: string | null;
  provinsi: string | null;
  kabupaten: string | null;
  mb_brands: string[];
  cb_brands: string[];
  fb_brands: string[];
}

interface RegionsData {
  provinsi: string[];
  kabupaten_by_provinsi: Record<string, string[]>;
}

interface ResolveResult {
  mb_brands: string[];
  cb_brands: string[];
  fb_brands: string[];
  source: "default" | "provinsi" | "kabupaten";
  provinsi?: string;
  kabupaten?: string;
}

const DEFAULT_GLOBAL: BrandConfigRow = {
  id: null,
  provinsi: null,
  kabupaten: null,
  mb_brands: ["SEMEN ELANG"],
  cb_brands: ["SEMEN BADAK"],
  fb_brands: ["SEMEN BANTENG"],
};

function BrandPills({ brands }: { brands: string[] }) {
  if (brands.length === 0) return <span className="text-xs text-muted-foreground italic">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {brands.map((b) => (
        <span key={b} className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-medium whitespace-nowrap">
          {b}
        </span>
      ))}
    </div>
  );
}

function SourceBadge({ source }: { source: ResolveResult["source"] }) {
  if (source === "kabupaten") return <Badge className="bg-green-600 text-white">Dari Kabupaten</Badge>;
  if (source === "provinsi") return <Badge className="bg-blue-600 text-white">Dari Provinsi</Badge>;
  return <Badge variant="secondary">Default</Badge>;
}

// ─── Modal shell ────────────────────────────────────────────────────────────

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card shadow-2xl">
        {children}
      </div>
    </div>
  );
}

// ─── Add/Edit form modal ────────────────────────────────────────────────────

function BrandConfigFormModal({
  target, regions, brands, onClose, onSaved,
}: {
  target: BrandConfigRow | "new";
  regions: RegionsData;
  brands: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isGlobal = target !== "new" && target.provinsi === null && target.kabupaten === null;
  const isEditingRegional = target !== "new" && !isGlobal;

  const [provinsi, setProvinsi] = useState<string>(target === "new" ? "" : target.provinsi ?? "");
  const [kabupaten, setKabupaten] = useState<string>(
    target === "new" ? "" : target.kabupaten ?? "",
  );
  const [mb, setMb] = useState<string>(
    target === "new" ? (brands[0] ?? "") : target.mb_brands[0] ?? "",
  );
  const [cb, setCb] = useState<string[]>(target === "new" ? [] : target.cb_brands);
  const [fb, setFb] = useState<string[]>(target === "new" ? ["SEMEN BANTENG"] : target.fb_brands);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const kabupatenOptions = provinsi ? regions.kabupaten_by_provinsi[provinsi] ?? [] : [];

  function toggle(list: string[], setList: (v: string[]) => void, brand: string) {
    setList(list.includes(brand) ? list.filter((b) => b !== brand) : [...list, brand]);
  }

  function validate(): string | null {
    if (!isGlobal && !provinsi) return "Provinsi wajib dipilih";
    if (!mb) return "MB wajib dipilih (tepat satu brand)";
    if (cb.length < 1) return "CB wajib minimal satu brand";
    return null;
  }

  async function handleSubmit() {
    const v = validate();
    if (v) { setErr(v); return; }
    setSaving(true); setErr("");

    const body = {
      provinsi: isGlobal ? null : provinsi,
      kabupaten: isGlobal ? null : (kabupaten || null),
      mb_brands: [mb],
      cb_brands: cb,
      fb_brands: fb,
    };

    try {
      const existingId = target !== "new" ? target.id : null;
      const r = existingId
        ? await apiFetch(`${BC_API}/${existingId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mb_brands: body.mb_brands, cb_brands: body.cb_brands, fb_brands: body.fb_brands }),
          })
        : await apiFetch(BC_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j.detail ?? "Gagal menyimpan");
        return;
      }
      onSaved(); onClose();
    } catch {
      setErr("Gagal menghubungi server");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">
            {isGlobal ? "Edit Default Global" : isEditingRegional ? "Edit Config Wilayah" : "Tambah Config Wilayah"}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
        </div>

        {!isGlobal && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium">Provinsi</label>
              <select
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:opacity-60 disabled:cursor-not-allowed"
                value={provinsi}
                disabled={isEditingRegional}
                onChange={(e) => { setProvinsi(e.target.value); setKabupaten(""); }}
              >
                <option value="">Pilih provinsi…</option>
                {regions.provinsi.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium">Kabupaten (opsional)</label>
              <select
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 disabled:opacity-60 disabled:cursor-not-allowed"
                value={kabupaten}
                disabled={isEditingRegional || !provinsi}
                onChange={(e) => setKabupaten(e.target.value)}
              >
                <option value="">Semua kabupaten (level provinsi)</option>
                {kabupatenOptions.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            {isEditingRegional && (
              <p className="col-span-2 text-[11px] text-muted-foreground italic">
                Provinsi/kabupaten tidak bisa diubah setelah dibuat — hapus dan buat baru kalau perlu pindah wilayah.
              </p>
            )}
          </div>
        )}

        <div>
          <label className="text-xs font-medium">Main Brand (MB) — pilih satu</label>
          <select
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
            value={mb}
            onChange={(e) => setMb(e.target.value)}
          >
            <option value="">Pilih brand…</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <p className="text-[11px] text-muted-foreground mt-1">Reward 100% dari rate dasar.</p>
        </div>

        <div>
          <label className="text-xs font-medium">Companion Brand (CB) — minimal satu</label>
          <div className="mt-1 flex flex-wrap gap-2 border border-border rounded-md p-2">
            {brands.map((b) => (
              <label key={b} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-muted/50 cursor-pointer">
                <input type="checkbox" checked={cb.includes(b)} onChange={() => toggle(cb, setCb, b)} />
                {b}
              </label>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Reward 50% dari rate dasar.</p>
        </div>

        <div>
          <label className="text-xs font-medium">Fighting Brand (FB) — boleh kosong</label>
          <div className="mt-1 flex flex-wrap gap-2 border border-border rounded-md p-2">
            {brands.map((b) => (
              <label key={b} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-muted/50 cursor-pointer">
                <input type="checkbox" checked={fb.includes(b)} onChange={() => toggle(fb, setFb, b)} />
                {b}
              </label>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Reward 50% dari rate dasar jika diikutkan. Kosongkan untuk mengecualikan FB di wilayah ini.
          </p>
        </div>

        {err && <p className="text-xs text-destructive">{err}</p>}

        <div className="flex gap-2 pt-1">
          <Button onClick={handleSubmit} disabled={saving} size="sm" className="flex-1">
            {saving ? "Menyimpan…" : "Simpan"}
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>Batal</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Delete confirm modal ───────────────────────────────────────────────────

function DeleteConfirmModal({ row, onClose, onDeleted }: { row: BrandConfigRow; onClose: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState("");

  async function handleDelete() {
    setDeleting(true); setErr("");
    try {
      const r = await apiFetch(`${BC_API}/${row.id}`, { method: "DELETE" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j.detail ?? "Gagal menghapus");
        return;
      }
      onDeleted(); onClose();
    } catch {
      setErr("Gagal menghubungi server");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="p-5 space-y-4">
        <h2 className="text-sm font-bold">Hapus Config Wilayah?</h2>
        <p className="text-sm text-muted-foreground">
          Config untuk <span className="font-semibold">{row.kabupaten ?? row.provinsi}</span>
          {row.kabupaten && <> ({row.provinsi})</>} akan dihapus. Wilayah ini akan kembali memakai
          config provinsi atau default global.
        </p>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <div className="flex gap-2">
          <Button onClick={handleDelete} disabled={deleting} size="sm" variant="destructive" className="flex-1">
            {deleting ? "Menghapus…" : "Ya, Hapus"}
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>Batal</Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Resolve preview ────────────────────────────────────────────────────────

function ResolvePreview({ regions }: { regions: RegionsData }) {
  const [provinsi, setProvinsi] = useState("");
  const [kabupaten, setKabupaten] = useState("");
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [loading, setLoading] = useState(false);

  const kabupatenOptions = provinsi ? regions.kabupaten_by_provinsi[provinsi] ?? [] : [];

  useEffect(() => {
    if (!provinsi || !kabupaten) { setResult(null); return; }
    setLoading(true);
    apiFetch(`${BC_API}/resolve?provinsi=${encodeURIComponent(provinsi)}&kabupaten=${encodeURIComponent(kabupaten)}`)
      .then((r) => r.json())
      .then((j) => setResult(j.status === "ok" ? j.data : null))
      .catch(() => setResult(null))
      .finally(() => setLoading(false));
  }, [provinsi, kabupaten]);

  return (
    <section className="rounded-xl border border-border bg-card p-6 space-y-4">
      <div>
        <h2 className="font-semibold text-base">Preview Resolusi Hierarki</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Cek config yang BERLAKU untuk wilayah tertentu setelah hierarki kabupaten → provinsi → default diterapkan.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Select value={provinsi} onValueChange={(v) => { setProvinsi(v); setKabupaten(""); }}>
          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Pilih provinsi…" /></SelectTrigger>
          <SelectContent>
            {regions.provinsi.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={kabupaten} onValueChange={setKabupaten} disabled={!provinsi}>
          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Pilih kabupaten…" /></SelectTrigger>
          <SelectContent>
            {kabupatenOptions.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading && <p className="text-xs text-muted-foreground">Memuat…</p>}

      {result && !loading && (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Sumber config:</span>
            <SourceBadge source={result.source} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-1">MB (100%)</p>
              <BrandPills brands={result.mb_brands} />
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-1">CB (50%)</p>
              <BrandPills brands={result.cb_brands} />
            </div>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-1">FB (50%)</p>
              <BrandPills brands={result.fb_brands} />
            </div>
          </div>
        </div>
      )}

      {!provinsi && (
        <p className="text-xs text-muted-foreground italic">Pilih provinsi dan kabupaten untuk melihat preview.</p>
      )}
    </section>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function BrandConfigPage() {
  const { isAdmin } = useAuth();

  const [configs, setConfigs] = useState<BrandConfigRow[]>([]);
  const [regions, setRegions] = useState<RegionsData>({ provinsi: [], kabupaten_by_provinsi: {} });
  const [brands, setBrands] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [formTarget, setFormTarget] = useState<BrandConfigRow | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BrandConfigRow | null>(null);

  const fetchConfigs = useCallback(async () => {
    try {
      const r = await apiFetch(BC_API);
      const j = await r.json();
      if (j.status === "ok") setConfigs(j.data as BrandConfigRow[]);
    } catch {
      setError("Gagal memuat daftar config");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchConfigs(),
      apiFetch(`${BC_API}/regions`).then((r) => r.json()).then((j) => {
        if (j.status === "ok") setRegions(j.data as RegionsData);
      }),
      apiFetch(`${BC_API}/available-brands`).then((r) => r.json()).then((j) => {
        if (j.status === "ok") setBrands((j.data.brands as string[]) ?? []);
      }),
    ])
      .catch(() => setError("Gagal memuat data"))
      .finally(() => setLoading(false));
  }, [fetchConfigs]);

  const globalRow = configs.find((c) => c.provinsi === null && c.kabupaten === null) ?? DEFAULT_GLOBAL;
  const regionalRows = configs.filter((c) => !(c.provinsi === null && c.kabupaten === null));

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-5xl mx-auto px-6 pt-20 pb-20">
        <div className="mb-8 pt-6">
          <Link href="/settings" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-3">
            <ArrowLeft size={13} /> Kembali ke Settings
          </Link>
          <h1 className="text-xl font-bold">Brand Configuration per Wilayah</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Atur brand Main/Companion/Fighting per provinsi atau kabupaten untuk kalkulasi volume dan reward Loyalty Program.
          </p>
        </div>

        {error && <p className="text-sm text-destructive mb-4">{error}</p>}

        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-card p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-base">Daftar Konfigurasi</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Hierarki resolusi: Kabupaten → Provinsi → Default Global.
                </p>
              </div>
              {isAdmin && (
                <Button size="sm" onClick={() => setFormTarget("new")}>
                  <Plus size={14} className="mr-1" /> Tambah Config
                </Button>
              )}
            </div>

            {loading ? (
              <p className="text-sm text-muted-foreground">Memuat…</p>
            ) : (
              <div className="border rounded-xl overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Scope</TableHead>
                      <TableHead>Wilayah</TableHead>
                      <TableHead>MB</TableHead>
                      <TableHead>CB</TableHead>
                      <TableHead>FB</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow className="bg-muted/30">
                      <TableCell><Badge variant="secondary">Default Global</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground italic">Semua wilayah lain</TableCell>
                      <TableCell><BrandPills brands={globalRow.mb_brands} /></TableCell>
                      <TableCell><BrandPills brands={globalRow.cb_brands} /></TableCell>
                      <TableCell><BrandPills brands={globalRow.fb_brands} /></TableCell>
                      <TableCell className="text-right">
                        {isAdmin && (
                          <Button size="sm" variant="ghost" onClick={() => setFormTarget(globalRow)}>
                            <Pencil size={13} />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>

                    {regionalRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <Badge variant="outline">{row.kabupaten ? "Kabupaten" : "Provinsi"}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.kabupaten ? (
                            <>
                              <span className="font-medium">{row.kabupaten}</span>
                              <span className="text-muted-foreground"> ({row.provinsi})</span>
                            </>
                          ) : (
                            <span className="font-medium">{row.provinsi}</span>
                          )}
                        </TableCell>
                        <TableCell><BrandPills brands={row.mb_brands} /></TableCell>
                        <TableCell><BrandPills brands={row.cb_brands} /></TableCell>
                        <TableCell><BrandPills brands={row.fb_brands} /></TableCell>
                        <TableCell className="text-right">
                          {isAdmin && (
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="ghost" onClick={() => setFormTarget(row)}>
                                <Pencil size={13} />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(row)}>
                                <Trash2 size={13} className="text-destructive" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}

                    {regionalRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-6">
                          Belum ada config provinsi/kabupaten. Semua wilayah memakai Default Global.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {!isAdmin && (
              <p className="text-xs text-muted-foreground italic">Login sebagai Admin untuk menambah/mengubah config.</p>
            )}
          </section>

          {!loading && <ResolvePreview regions={regions} />}
        </div>
      </main>

      {formTarget && (
        <BrandConfigFormModal
          target={formTarget}
          regions={regions}
          brands={brands}
          onClose={() => setFormTarget(null)}
          onSaved={fetchConfigs}
        />
      )}
      {deleteTarget && (
        <DeleteConfirmModal
          row={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={fetchConfigs}
        />
      )}
    </div>
  );
}
