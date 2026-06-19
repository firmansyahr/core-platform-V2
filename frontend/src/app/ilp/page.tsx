"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/hooks/useAuth";
import { getToken } from "@/lib/auth";
import { downloadFile } from "@/lib/download";
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
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  BarChartIcon,
  PlayIcon,
  DownloadIcon,
  BuildingIcon,
  DollarIcon,
  AnalyticsIcon,
  AwardIcon,
  PackageIcon,
  AddCircleIcon,
  DeleteIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ChevronRightIcon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const CLUSTERS = ["Super Platinum", "Platinum", "Gold", "Silver", "Bronze"] as const;
const CLUSTER_COLORS: Record<string, string> = {
  "Super Platinum": "#f59e0b",
  Platinum:         "#8b5cf6",
  Gold:             "#f97316",
  Silver:           "#6b7280",
  Bronze:           "#92400e",
};
const BRAND_COLOR: Record<string, string> = {
  Mix:              "#8b5cf6",
  "Main Only":      "#3b82f6",
  "Companion Only": "#10b981",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface ILPResult {
  id_toko:        string;
  nama_toko:      string;
  kabupaten:      string;
  provinsi:       string;
  cluster_pareto: string;
  ssm:            string;
  asm:            string;
  tso:            string;
  score:          number;
  score_adjusted: number;
  estimated_cost: number;
  brand_category: string;
  avg_ton:        number;
  ton_growth:     number;
  efficiency:     number;
  ratio_score:    number;
  trx_score:      number;
  growth_score:   number;
  adjustment_factor:        number;
  cannibalization_category: string | null;
  cannibalization_label:    string | null;
}

const GMM_BADGE: Record<string, { label: string; color: string }> = {
  kanibalisasi:                    { label: "Kanibalisasi",      color: "#3b82f6" },
  kanibalisasi_sebagian_eksternal: { label: "Kanibal+Eksternal", color: "#6366f1" },
  tekanan_eksternal:               { label: "Tekanan Eksternal", color: "#DC2626" },
  fighting_brand_shift:            { label: "Fighting Brand",    color: "#f97316" },
  perlu_investigasi:               { label: "Perlu Investigasi", color: "#f59e0b" },
  de_kanibalisasi:                 { label: "De-Kanibalisasi",   color: "#10b981" },
  stabil:                          { label: "Stabil",            color: "#6b7280" },
  campuran:                        { label: "Campuran",          color: "#6b7280" },
};

interface ILPMeta {
  generated_at:                    string;
  method:                          string;
  total_toko:                      number;
  total_cost:                      number;
  budget_utilization_pct:          number;
  exclude_existing_loyalty?:       boolean;
  toko_dikecualikan?:              number;
  total_kandidat_dianalisis?:      number;
  cannibalization_adjustment_used?: boolean;
}

interface ILPResponse {
  status: string;
  data:   ILPResult[];
  meta:   ILPMeta;
}

interface Hierarchy {
  provinsi:  string[];
  hierarchy: Record<string, Record<string, string[]>>;
}

interface Scenario {
  id:     string;
  name:   string;
  result: ILPResponse;
  budget: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toIcon = (i: unknown) => i as IconSvgElement;
const fmtRp = (n: number) =>
  "Rp " + new Intl.NumberFormat("id-ID").format(Math.round(n));
const fmtNum = (n: number) =>
  new Intl.NumberFormat("id-ID").format(Math.round(n));
const shortRp = (n: number) =>
  n >= 1_000_000_000
    ? `Rp ${(n / 1_000_000_000).toFixed(2)} M`
    : n >= 1_000_000
    ? `Rp ${(n / 1_000_000).toFixed(1)} jt`
    : fmtRp(n);

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({
  title, value, sub, icon, iconColor = "text-muted-foreground", accent,
}: {
  title: string; value: string; sub?: string;
  icon: unknown; iconColor?: string; accent?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-2 mb-2">
          <span className={iconColor}>
            <HugeiconsIcon icon={toIcon(icon)} size={15} />
          </span>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {title}
          </p>
        </div>
        <p
          className="text-2xl font-bold tabular-nums leading-none"
          style={accent ? { color: accent } : undefined}
        >
          {value}
        </p>
        {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function ChartTooltip({
  active, payload, label, valueFormat = (v: number) => String(v),
}: {
  active?: boolean;
  payload?: { value: number; fill?: string }[];
  label?: string;
  valueFormat?: (v: number) => string;
}) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold mb-0.5 max-w-[180px]">{label}</p>
      <p className="text-muted-foreground">{valueFormat(payload[0].value)}</p>
    </div>
  );
}

// ─── Tooltip (hover) ─────────────────────────────────────────────────────────

function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div className="relative group inline-flex items-center">
      {children}
      <div
        className="absolute bottom-full left-0 mb-2 w-56 px-2.5 py-2 rounded-lg
          bg-foreground text-background text-[11px] leading-snug shadow-lg z-50
          opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity"
      >
        {text}
        <div className="absolute top-full left-3 border-4 border-transparent border-t-foreground" />
      </div>
    </div>
  );
}

// ─── Tag input with dropdown autocomplete ────────────────────────────────────

function TagInput({
  label,
  options,
  selected,
  onChange,
  placeholder = "Ketik untuk mencari…",
  disabled = false,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const displayOf = (v: string) => v.replace(/^(SSM|ASM|TSO)-\d+ /, "");

  const suggestions = useMemo(() => {
    if (!query.trim()) return options.filter((o) => !selected.includes(o)).slice(0, 30);
    const q = query.toLowerCase();
    return options
      .filter((o) => !selected.includes(o) && o.toLowerCase().includes(q))
      .slice(0, 30);
  }, [query, options, selected]);

  const add = (v: string) => {
    if (!selected.includes(v)) onChange([...selected, v]);
    setQuery("");
    setOpen(false);
  };

  const remove = (v: string) => onChange(selected.filter((x) => x !== v));

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && suggestions.length > 0) {
      e.preventDefault();
      add(suggestions[0]);
    }
    if (e.key === "Backspace" && !query && selected.length > 0) {
      remove(selected[selected.length - 1]);
    }
    if (e.key === "Escape") setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {label}
        </label>
        {selected.length > 0 && (
          <button
            onClick={() => onChange([])}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Hapus semua
          </button>
        )}
      </div>

      {/* Input box with tags */}
      <div
        className={`flex flex-wrap gap-1.5 min-h-[38px] w-full px-2.5 py-1.5 rounded-md border
          bg-background cursor-text transition-colors
          ${disabled ? "opacity-50 cursor-not-allowed border-border" : "border-border focus-within:ring-2 focus-within:ring-ring/50"}`}
        onClick={() => !disabled && document.getElementById(`tag-input-${label}`)?.focus()}
      >
        {selected.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-foreground/10
              text-foreground text-[11px] font-medium max-w-[200px]"
          >
            <span className="truncate" title={v}>{displayOf(v)}</span>
            {!disabled && (
              <button
                onClick={(e) => { e.stopPropagation(); remove(v); }}
                className="text-muted-foreground hover:text-foreground shrink-0 leading-none"
              >
                ×
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            id={`tag-input-${label}`}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={selected.length === 0 ? placeholder : ""}
            className="flex-1 min-w-[120px] bg-transparent text-xs outline-none
              placeholder:text-muted-foreground py-0.5"
          />
        )}
      </div>

      {/* Dropdown */}
      {open && !disabled && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-card shadow-lg
          max-h-48 overflow-y-auto">
          {suggestions.map((opt) => (
            <button
              key={opt}
              onMouseDown={(e) => { e.preventDefault(); add(opt); }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors truncate"
              title={opt}
            >
              {displayOf(opt)}
              {opt !== displayOf(opt) && (
                <span className="text-muted-foreground ml-1.5 font-mono text-[10px]">
                  {opt.match(/^(SSM|ASM|TSO)-\d+/)?.[0]}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {open && !disabled && query.trim() && suggestions.length === 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-card shadow-lg px-3 py-2">
          <p className="text-xs text-muted-foreground">Tidak ditemukan</p>
        </div>
      )}
    </div>
  );
}

// ─── Scenario comparison card ─────────────────────────────────────────────────

function ScenarioCompare({ a, b }: { a: Scenario; b: Scenario }) {
  const metrics = [
    {
      label: "Toko Terpilih",
      va: a.result.meta.total_toko,
      vb: b.result.meta.total_toko,
      fmt: fmtNum,
    },
    {
      label: "Total Cost",
      va: a.result.meta.total_cost,
      vb: b.result.meta.total_cost,
      fmt: shortRp,
    },
    {
      label: "Utilisasi Budget",
      va: a.result.meta.budget_utilization_pct,
      vb: b.result.meta.budget_utilization_pct,
      fmt: (v: number) => `${v.toFixed(1)}%`,
    },
    {
      label: "Avg Score",
      va: a.result.data.reduce((s, r) => s + (r.score_adjusted ?? r.score), 0) / (a.result.data.length || 1),
      vb: b.result.data.reduce((s, r) => s + (r.score_adjusted ?? r.score), 0) / (b.result.data.length || 1),
      fmt: (v: number) => v.toFixed(2),
    },
    {
      label: "Avg Efficiency",
      va: a.result.data.reduce((s, r) => s + r.efficiency, 0) / (a.result.data.length || 1),
      vb: b.result.data.reduce((s, r) => s + r.efficiency, 0) / (b.result.data.length || 1),
      fmt: (v: number) => v.toFixed(3) + " pt/jt",
    },
  ];

  return (
    <Card className="border-violet-500/20">
      <CardHeader className="border-b border-border pb-3">
        <CardTitle className="text-sm">Perbandingan Skenario</CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="grid grid-cols-[auto_1fr_1fr] gap-x-6 gap-y-3">
          {/* Header */}
          <div />
          <div className="text-xs font-bold text-center text-violet-600 dark:text-violet-400">
            {a.name}
          </div>
          <div className="text-xs font-bold text-center text-blue-600 dark:text-blue-400">
            {b.name}
          </div>
          {/* Rows */}
          {metrics.map(({ label, va, vb, fmt }) => {
            const aWins = va > vb;
            const equal = Math.abs(va - vb) < 0.001;
            return [
              <div key={`l-${label}`} className="text-xs text-muted-foreground self-center">
                {label}
              </div>,
              <div
                key={`a-${label}`}
                className={`text-sm font-semibold tabular-nums text-center py-1 px-2 rounded ${
                  equal
                    ? ""
                    : aWins
                    ? "bg-green-500/10 text-green-600 dark:text-green-400"
                    : "text-muted-foreground"
                }`}
              >
                {fmt(va)}
              </div>,
              <div
                key={`b-${label}`}
                className={`text-sm font-semibold tabular-nums text-center py-1 px-2 rounded ${
                  equal
                    ? ""
                    : !aWins
                    ? "bg-green-500/10 text-green-600 dark:text-green-400"
                    : "text-muted-foreground"
                }`}
              >
                {fmt(vb)}
              </div>,
            ];
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ILPPage() {
  const { isAdmin } = useAuth();

  // Form state
  const [budget, setBudget]     = useState("2000000000");
  const [maxToko, setMaxToko]   = useState("100");
  const [clusterPct, setClusterPct] = useState<Record<string, string>>({
    "Super Platinum": "0",
    Platinum:         "0",
    Gold:             "0",
    Silver:           "0",
    Bronze:           "0",
  });

  const [excludeLoyalty, setExcludeLoyalty] = useState(true);
  const [useGmmAdjust, setUseGmmAdjust]   = useState(true);

  // Scoring weights (integers 0–100 representing %)
  const [wRatio,  setWRatio]  = useState(47);
  const [wTrx,    setWTrx]    = useState(43);
  const [wGrowth, setWGrowth] = useState(10);
  const totalW = wRatio + wTrx + wGrowth;
  const weightsValid = totalW === 100;

  // Hierarchy / filter state
  const [hierarchy, setHierarchy]         = useState<Hierarchy | null>(null);
  const [hierLoading, setHierLoading]     = useState(true);
  const [selProvinsi, setSelProvinsi]     = useState<string[]>([]);
  const [selSSM, setSelSSM]               = useState<string[]>([]);
  const [selASM, setSelASM]               = useState<string[]>([]);
  const [selTSO, setSelTSO]               = useState<string[]>([]);
  const [filterOpen, setFilterOpen]       = useState(false);

  // Result state
  const [solving, setSolving]         = useState(false);
  const [exportingILPPdf, setExportingILPPdf] = useState(false);
  const [result, setResult]           = useState<ILPResponse | null>(null);
  const [error, setError]             = useState<string | null>(null);

  // Table sort
  const [sortKey, setSortKey]   = useState<keyof ILPResult>("score_adjusted");
  const [sortAsc, setSortAsc]   = useState(false);

  // Scenarios
  const [scenarios, setScenarios]   = useState<Scenario[]>([]);
  const [compareIds, setCompareIds] = useState<[string, string] | null>(null);
  const [saveName, setSaveName]     = useState("");

  // Fetch hierarchy on mount
  useEffect(() => {
    fetch(`${API}/api/ilp/metadata`)
      .then((r) => r.json())
      .then((r) => setHierarchy(r.data))
      .finally(() => setHierLoading(false));
  }, []);

  // Cascade: SSM → ASM → TSO
  const availableSSM = useMemo(
    () => (hierarchy ? Object.keys(hierarchy.hierarchy).sort() : []),
    [hierarchy]
  );
  const availableASM = useMemo(() => {
    if (!hierarchy) return [];
    const ssms = selSSM.length > 0 ? selSSM : Object.keys(hierarchy.hierarchy);
    const asmSet: Record<string, true> = {};
    ssms.forEach((ssm) => Object.keys(hierarchy.hierarchy[ssm] ?? {}).forEach((a) => { asmSet[a] = true; }));
    return Object.keys(asmSet).sort();
  }, [hierarchy, selSSM]);
  const availableTSO = useMemo(() => {
    if (!hierarchy) return [];
    const ssms = selSSM.length > 0 ? selSSM : Object.keys(hierarchy.hierarchy);
    const asms = selASM.length > 0 ? selASM : availableASM;
    const tsoSet: Record<string, true> = {};
    ssms.forEach((ssm) =>
      asms.forEach((asm) =>
        (hierarchy.hierarchy[ssm]?.[asm] ?? []).forEach((t) => { tsoSet[t] = true; })
      )
    );
    return Object.keys(tsoSet).sort();
  }, [hierarchy, selSSM, selASM, availableASM]);

  // Clear downstream selections on parent change
  useEffect(() => { setSelASM([]); setSelTSO([]); }, [selSSM]);
  useEffect(() => { setSelTSO([]); }, [selASM]);

  const handleRun = useCallback(async () => {
    const budgetVal = parseFloat(budget.replace(/\./g, ""));
    const maxTokoVal = parseInt(maxToko);
    if (!budgetVal || budgetVal <= 0) { setError("Budget harus lebih dari 0"); return; }
    if (!maxTokoVal || maxTokoVal <= 0) { setError("Maks toko harus lebih dari 0"); return; }
    if (!weightsValid) { setError("Total bobot scoring harus 100%"); return; }

    setError(null);
    setSolving(true);
    setResult(null);

    const cluster_constraints = {
      super_platinum: parseFloat(clusterPct["Super Platinum"]) || 0,
      platinum:       parseFloat(clusterPct["Platinum"]) || 0,
      gold:           parseFloat(clusterPct["Gold"]) || 0,
      silver:         parseFloat(clusterPct["Silver"]) || 0,
      bronze:         parseFloat(clusterPct["Bronze"]) || 0,
    };

    try {
      const token = getToken() ?? "";
      const res = await fetch(`${API}/api/ilp/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          budget_maks:                    budgetVal,
          maks_toko:                      maxTokoVal,
          cluster_constraints,
          provinsi_filter:                selProvinsi,
          ssm_filter:                     selSSM,
          asm_filter:                     selASM,
          tso_filter:                     selTSO,
          weight_ratio_cluster:           wRatio  / 100,
          weight_avg_trx:                 wTrx    / 100,
          weight_growth:                  wGrowth / 100,
          exclude_existing_loyalty:       excludeLoyalty,
          use_cannibalization_adjustment: useGmmAdjust,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ILPResponse = await res.json();
      setResult(data);
      setSaveName(`Skenario ${scenarios.length + 1}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Terjadi kesalahan");
    } finally {
      setSolving(false);
    }
  }, [budget, maxToko, clusterPct, selProvinsi, selSSM, selASM, selTSO,
      wRatio, wTrx, wGrowth, weightsValid, excludeLoyalty, useGmmAdjust, scenarios.length]);

  const sortedData = useMemo(() => {
    if (!result) return [];
    return [...result.data].sort((a, b) => {
      const av = a[sortKey] as number;
      const bv = b[sortKey] as number;
      return sortAsc ? av - bv : bv - av;
    });
  }, [result, sortKey, sortAsc]);

  const handleSort = (key: keyof ILPResult) => {
    if (sortKey === key) setSortAsc((p) => !p);
    else { setSortKey(key); setSortAsc(false); }
  };

  const SortHeader = ({ colKey, children }: { colKey: keyof ILPResult; children: React.ReactNode }) => (
    <TableHead
      className="cursor-pointer select-none hover:text-foreground transition-colors"
      onClick={() => handleSort(colKey)}
    >
      <span className="flex items-center gap-1">
        {children}
        {sortKey === colKey && (
          <HugeiconsIcon
            icon={toIcon(sortAsc ? ChevronUpIcon : ChevronDownIcon)}
            size={11}
          />
        )}
      </span>
    </TableHead>
  );

  // Charts data
  const clusterChart = useMemo(() => {
    if (!result) return [];
    const counts: Record<string, number> = {};
    result.data.forEach((r) => { counts[r.cluster_pareto] = (counts[r.cluster_pareto] ?? 0) + 1; });
    return CLUSTERS.map((c) => ({ name: c, value: counts[c] ?? 0 }));
  }, [result]);

  const provinsiChart = useMemo(() => {
    if (!result) return [];
    const counts: Record<string, number> = {};
    result.data.forEach((r) => { counts[r.provinsi] = (counts[r.provinsi] ?? 0) + 1; });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({ name, value }));
  }, [result]);

  const costChart = useMemo(() => {
    if (!result) return [];
    const sums: Record<string, number> = {};
    result.data.forEach((r) => { sums[r.cluster_pareto] = (sums[r.cluster_pareto] ?? 0) + r.estimated_cost; });
    return CLUSTERS.map((c) => ({ name: c, value: Math.round((sums[c] ?? 0) / 1_000_000) }));
  }, [result]);

  const avgScore = result
    ? result.data.reduce((s, r) => s + (r.score_adjusted ?? r.score), 0) / (result.data.length || 1)
    : 0;

  const saveScenario = () => {
    if (!result || !saveName.trim()) return;
    const id = Date.now().toString();
    setScenarios((prev) => [...prev, { id, name: saveName.trim(), result, budget: parseFloat(budget) }]);
    setSaveName("");
  };

  const deleteScenario = (id: string) => {
    setScenarios((prev) => prev.filter((s) => s.id !== id));
    if (compareIds && compareIds.includes(id)) setCompareIds(null);
  };

  const toggleCompare = (id: string) => {
    if (!compareIds) {
      setCompareIds([id, ""]);
    } else {
      const [a, b] = compareIds;
      if (a === id || b === id) {
        setCompareIds(null);
      } else if (!b) {
        setCompareIds([a, id]);
      } else {
        setCompareIds([id, b]);
      }
    }
  };

  const exportCSV = () => {
    if (!result) return;
    const headers = [
      "ID Toko","Nama Toko","Kabupaten","Provinsi","Cluster","SSM","ASM","TSO",
      "Score ILP","Score GMM","Faktor Adj","Ratio Score","Trx Score","Growth Score",
      "Est Cost (Rp)","Brand","Avg TON","TON Growth %","Efficiency (pt/jt)","Sinyal GMM"
    ];
    const rows = sortedData.map((r) =>
      [
        r.id_toko, r.nama_toko, r.kabupaten, r.provinsi, r.cluster_pareto,
        r.ssm, r.asm, r.tso,
        r.score.toFixed(2), (r.score_adjusted ?? r.score).toFixed(2),
        (r.adjustment_factor ?? 1).toFixed(3),
        r.ratio_score.toFixed(1), r.trx_score.toFixed(1),
        r.growth_score.toFixed(1), r.estimated_cost, r.brand_category,
        r.avg_ton.toFixed(2), r.ton_growth.toFixed(2), r.efficiency.toFixed(4),
        r.cannibalization_category ?? "—",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    const blob = new Blob([[headers.join(","), ...rows].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ilp_result_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const compareScenarios =
    compareIds && compareIds[0] && compareIds[1]
      ? ([
          scenarios.find((s) => s.id === compareIds[0]),
          scenarios.find((s) => s.id === compareIds[1]),
        ] as [Scenario | undefined, Scenario | undefined])
      : null;

  const hasActiveFilters =
    selProvinsi.length > 0 || selSSM.length > 0 || selASM.length > 0 || selTSO.length > 0;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="pt-16 max-w-7xl mx-auto px-6 py-8 space-y-5">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">ILP Optimizer</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Integer Linear Programming · Seleksi toko loyalty program optimal
          </p>
        </div>

        {/* ── Parameter card ───────────────────────────────────────────── */}
        <Card>
          <CardHeader className="border-b border-border pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <HugeiconsIcon icon={toIcon(BarChartIcon)} size={15} color="#3b82f6" />
              Parameter Optimasi
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-5 space-y-6">

            {/* Budget + Maks Toko */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Budget Maks (Rp / tahun)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    Rp
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={budget ? new Intl.NumberFormat("id-ID").format(parseInt(budget, 10) || 0) : ""}
                    disabled={!isAdmin}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d]/g, "");
                      setBudget(raw || "0");
                    }}
                    className={`w-full pl-9 pr-3 py-2 text-sm rounded-md border border-border bg-background
                      focus:outline-none focus:ring-2 focus:ring-ring/50 tabular-nums
                      ${!isAdmin ? "opacity-60 cursor-not-allowed bg-muted" : ""}`}
                  />
                </div>
                {budget && !isNaN(parseFloat(budget)) && (
                  <p className="text-[10px] text-muted-foreground">{shortRp(parseFloat(budget))}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Maks Toko
                </label>
                <input
                  type="number"
                  value={maxToko}
                  disabled={!isAdmin}
                  onChange={(e) => setMaxToko(e.target.value)}
                  min={1}
                  max={3000}
                  className={`w-full px-3 py-2 text-sm rounded-md border border-border bg-background
                    focus:outline-none focus:ring-2 focus:ring-ring/50 tabular-nums
                    ${!isAdmin ? "opacity-60 cursor-not-allowed bg-muted" : ""}`}
                />
                <p className="text-[10px] text-muted-foreground">
                  Maks toko yang dipilih solver
                </p>
              </div>
            </div>

            {/* Per-cluster max % */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Maks % per Cluster
                </p>
                <span className="text-muted-foreground" title="0 = tidak ada batasan untuk cluster tersebut">
                  <HugeiconsIcon icon={toIcon(InformationCircleIcon)} size={13} />
                </span>
                <span className="text-[10px] text-muted-foreground font-normal">(0 = tidak ada batasan)</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {CLUSTERS.map((c) => (
                  <div key={c} className="space-y-1">
                    <label
                      className="text-[10px] font-semibold"
                      style={{ color: CLUSTER_COLORS[c] }}
                    >
                      {c}
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        value={clusterPct[c]}
                        disabled={!isAdmin}
                        onChange={(e) =>
                          setClusterPct((p) => ({ ...p, [c]: e.target.value }))
                        }
                        min={0}
                        max={100}
                        step={5}
                        className={`w-full pl-2 pr-6 py-1.5 text-xs rounded-md border border-border
                          bg-background focus:outline-none focus:ring-1 focus:ring-ring/50 tabular-nums
                          ${!isAdmin ? "opacity-60 cursor-not-allowed bg-muted" : ""}`}
                      />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                        %
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Exclude existing loyalty members */}
            <label
              className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors select-none
                ${excludeLoyalty
                  ? "border-blue-500/40 bg-blue-500/5"
                  : "border-border bg-muted/20 hover:bg-muted/40"
                } ${!isAdmin ? "opacity-60 cursor-not-allowed" : ""}`}
            >
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-blue-600 cursor-pointer"
                checked={excludeLoyalty}
                disabled={!isAdmin}
                onChange={(e) => setExcludeLoyalty(e.target.checked)}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-tight">
                  Kecualikan toko yang sudah aktif di Loyalty Program
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Fokus optimasi pada kandidat baru — hindari rekomendasi ulang toko yang sudah terdaftar
                </p>
              </div>
            </label>

            {/* GMM Cannibalization Adjustment toggle */}
            <label
              className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors select-none
                ${useGmmAdjust
                  ? "border-violet-500/40 bg-violet-500/5"
                  : "border-border bg-muted/20 hover:bg-muted/40"
                } ${!isAdmin ? "opacity-60 cursor-not-allowed" : ""}`}
            >
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-violet-600 cursor-pointer"
                checked={useGmmAdjust}
                disabled={!isAdmin}
                onChange={(e) => setUseGmmAdjust(e.target.checked)}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-tight">
                  Aktifkan GMM Cannibalization Adjustment
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Sesuaikan ILP score berdasarkan sinyal GMM — kanibalisasi internal de-prioritas (×0.7),
                  tekanan eksternal diprioritaskan (×1.3)
                </p>
              </div>
            </label>

            {/* ── Bobot Scoring Kriteria ───────────────────────────── */}
            <div className="border border-border rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Bobot Scoring Kriteria
                  </p>
                  <span
                    className={`text-xs font-bold px-2 py-0.5 rounded-full transition-colors ${
                      weightsValid
                        ? "bg-green-500/15 text-green-600 dark:text-green-400"
                        : "bg-red-500/15 text-red-500"
                    }`}
                  >
                    Total: {totalW}%
                  </span>
                </div>
                <button
                  onClick={() => { setWRatio(47); setWTrx(43); setWGrowth(10); }}
                  disabled={!isAdmin}
                  className={`text-[11px] text-muted-foreground hover:text-foreground transition-colors
                    ${!isAdmin ? "opacity-40 pointer-events-none" : ""}`}
                >
                  Reset ke default
                </button>
              </div>

              {[
                {
                  label:   "Ratio vs Cluster",
                  value:   wRatio,
                  setter:  setWRatio,
                  color:   "#8b5cf6",
                  tooltip: "Seberapa besar volume toko dibanding rata-rata cluster-nya. Toko yang menjual jauh di atas median cluster-nya dianggap lebih potensial untuk dipertahankan.",
                },
                {
                  label:   "Avg Transaksi",
                  value:   wTrx,
                  setter:  setWTrx,
                  color:   "#3b82f6",
                  tooltip: "Frekuensi order per bulan. Toko yang sering order mencerminkan ketergantungan tinggi pada produk kita dan loyalitas jangka panjang.",
                },
                {
                  label:   "Growth Trend",
                  value:   wGrowth,
                  setter:  setWGrowth,
                  color:   "#10b981",
                  tooltip: "Pertumbuhan volume 3 bulan terakhir vs 3 bulan sebelumnya. Toko yang sedang tumbuh diprioritaskan untuk dikunci sebelum fighting brand masuk.",
                },
              ].map(({ label, value, setter, color, tooltip }) => (
                <div key={label} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium">{label}</span>
                      <Tooltip text={tooltip}>
                        <span className="text-muted-foreground cursor-help">
                          <HugeiconsIcon icon={toIcon(InformationCircleIcon)} size={12} />
                        </span>
                      </Tooltip>
                    </div>
                    <span
                      className="text-sm font-bold tabular-nums w-10 text-right"
                      style={{ color }}
                    >
                      {value}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={value}
                    disabled={!isAdmin}
                    onChange={(e) => setter(Number(e.target.value))}
                    className={`w-full h-1.5 appearance-none rounded-full bg-muted cursor-pointer
                      [&::-webkit-slider-thumb]:appearance-none
                      [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4
                      [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary
                      [&::-webkit-slider-thumb]:shadow
                      [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4
                      [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary
                      [&::-moz-range-thumb]:border-0
                      ${!isAdmin ? "opacity-60 cursor-not-allowed" : ""}`}
                  />
                </div>
              ))}
            </div>

            {/* Hierarchical filter (collapsible) */}
            <div className="border border-border rounded-lg overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold
                  text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                onClick={() => setFilterOpen((o) => !o)}
              >
                <span className="flex items-center gap-2">
                  Filter Wilayah & Organisasi
                  {hasActiveFilters && (
                    <span className="px-1.5 py-0.5 rounded-full bg-foreground/10 text-foreground text-[10px] font-bold">
                      {selProvinsi.length + selSSM.length + selASM.length + selTSO.length} aktif
                    </span>
                  )}
                </span>
                <HugeiconsIcon
                  icon={toIcon(filterOpen ? ChevronUpIcon : ChevronDownIcon)}
                  size={13}
                />
              </button>

              {filterOpen && (
                <div className="px-4 pb-4 pt-2 border-t border-border space-y-4">
                  {hierLoading ? (
                    <div className="space-y-2">
                      {Array.from({ length: 2 }).map((_, i) => (
                        <Skeleton key={i} className="h-8 w-full rounded" />
                      ))}
                    </div>
                  ) : (
                    <>
                      <TagInput
                        label="Provinsi"
                        options={hierarchy?.provinsi ?? []}
                        selected={selProvinsi}
                        onChange={setSelProvinsi}
                        placeholder="Ketik nama provinsi…"
                      />
                      <TagInput
                        label="SSM"
                        options={availableSSM}
                        selected={selSSM}
                        onChange={setSelSSM}
                        placeholder="Ketik nama SSM…"
                      />
                      <TagInput
                        label="ASM"
                        options={availableASM}
                        selected={selASM}
                        onChange={setSelASM}
                        placeholder={selSSM.length === 0 ? "Pilih SSM dulu" : "Ketik nama ASM…"}
                        disabled={availableASM.length === 0}
                      />
                      <TagInput
                        label="TSO"
                        options={availableTSO}
                        selected={selTSO}
                        onChange={setSelTSO}
                        placeholder={selASM.length === 0 && availableTSO.length === 0 ? "Pilih ASM dulu" : "Ketik nama TSO…"}
                        disabled={availableTSO.length === 0}
                      />
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-lg border border-[#DC2626]/30 bg-[#DC2626]/8 px-3 py-2 text-xs text-[#DC2626]">
                {error}
              </div>
            )}

            {/* Run button */}
            <div className="flex items-center gap-3 flex-wrap">
              {isAdmin ? (
                <button
                  onClick={handleRun}
                  disabled={solving || !weightsValid}
                  title={!weightsValid ? `Total bobot harus 100% (saat ini ${totalW}%)` : undefined}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold
                    bg-foreground text-background hover:bg-foreground/90 transition-colors
                    disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {solving ? (
                    <>
                      <span className="inline-block w-3.5 h-3.5 border-2 border-background/30 border-t-background rounded-full animate-spin" />
                      Solver berjalan…
                    </>
                  ) : (
                    <>
                      <HugeiconsIcon icon={toIcon(PlayIcon)} size={15} />
                      Jalankan Optimasi
                    </>
                  )}
                </button>
              ) : (
                <Tooltip text="Fitur ini hanya tersedia untuk Admin">
                  <button
                    disabled
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold
                      bg-foreground/20 text-foreground/40 cursor-not-allowed border border-border"
                  >
                    <HugeiconsIcon icon={toIcon(PlayIcon)} size={15} />
                    Jalankan Optimasi
                  </button>
                </Tooltip>
              )}
              {isAdmin && !weightsValid && !solving && (
                <span className="text-xs text-red-500 font-medium">
                  Total bobot harus 100% — saat ini {totalW}%
                </span>
              )}
              {result && !solving && weightsValid && (
                <span className="text-xs text-muted-foreground">
                  Metode:{" "}
                  <strong className="text-foreground">{result.meta.method}</strong>
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Loading state ─────────────────────────────────────────────── */}
        {solving && (
          <Card className="border-blue-500/20 bg-blue-500/5">
            <CardContent className="pt-6 pb-6">
              <div className="flex flex-col items-center gap-3 py-2">
                <div className="relative w-10 h-10">
                  <div className="absolute inset-0 rounded-full border-2 border-blue-500/20" />
                  <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-500 animate-spin" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold">CBC ILP Solver berjalan…</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Optimasi binary integer programming · estimasi 5–30 detik
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Results ──────────────────────────────────────────────────── */}
        {result && !solving && (
          <>
            {/* Exclude-loyalty info badge */}
            {result.meta.exclude_existing_loyalty && (result.meta.toko_dikecualikan ?? 0) > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-500/30 bg-blue-500/5 text-xs text-blue-700 dark:text-blue-400">
                <HugeiconsIcon icon={toIcon(InformationCircleIcon)} size={13} />
                <span>
                  <strong>{result.meta.toko_dikecualikan}</strong> toko dikecualikan karena sudah aktif di Loyalty Program.
                  Total <strong>{result.meta.total_kandidat_dianalisis}</strong> toko dianalisis oleh solver.
                </span>
              </div>
            )}

            {/* GMM adjustment active badge */}
            {result.meta.cannibalization_adjustment_used && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-violet-500/30 bg-violet-500/5 text-xs text-violet-700 dark:text-violet-400">
                <HugeiconsIcon icon={toIcon(InformationCircleIcon)} size={13} />
                <span>
                  GMM Cannibalization Adjustment aktif — score ILP disesuaikan berdasarkan sinyal brand shift.
                  Kolom <strong>Sinyal GMM</strong> menampilkan kategori tiap toko.
                </span>
              </div>
            )}

            {/* Summary cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <SummaryCard
                title="Toko Terpilih"
                value={fmtNum(result.meta.total_toko)}
                sub="dari kandidat ILP"
                icon={BuildingIcon}
                iconColor="text-violet-500"
                accent="#8b5cf6"
              />
              <SummaryCard
                title="Total Cost"
                value={shortRp(result.meta.total_cost)}
                sub="estimasi reward / tahun"
                icon={DollarIcon}
                iconColor="text-emerald-500"
              />
              <SummaryCard
                title="Utilisasi Budget"
                value={`${result.meta.budget_utilization_pct.toFixed(1)}%`}
                sub={`dari ${shortRp(parseFloat(budget))}`}
                icon={AnalyticsIcon}
                iconColor="text-blue-500"
                accent={
                  result.meta.budget_utilization_pct > 95 ? "#DC2626" : "#3b82f6"
                }
              />
              <SummaryCard
                title="Rata-rata Score"
                value={avgScore.toFixed(2)}
                sub="ILP score (0–100)"
                icon={AwardIcon}
                iconColor="text-amber-500"
                accent="#f59e0b"
              />
            </div>

            {/* Three charts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Toko per cluster */}
              <Card>
                <CardHeader className="border-b border-border pb-3">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Toko per Cluster
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={clusterChart} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.07} />
                      <XAxis dataKey="name" tick={{ fontSize: 9 }} tickLine={false} axisLine={false}
                        tickFormatter={(v: string) => v.replace(" Platinum", "\nPlatinum")} />
                      <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                      <RTooltip content={<ChartTooltip valueFormat={(v) => `${v} toko`} />} cursor={{ fill: "currentColor", fillOpacity: 0.04 }} />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={32}>
                        {clusterChart.map((e, i) => (
                          <Cell key={i} fill={CLUSTER_COLORS[e.name] ?? "#6b7280"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Top provinsi */}
              <Card>
                <CardHeader className="border-b border-border pb-3">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Top Provinsi
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={provinsiChart} layout="vertical" margin={{ top: 0, right: 32, left: 0, bottom: 0 }}>
                      <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.07} />
                      <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 9.5 }} tickLine={false} axisLine={false} />
                      <RTooltip content={<ChartTooltip valueFormat={(v) => `${v} toko`} />} cursor={{ fill: "currentColor", fillOpacity: 0.04 }} />
                      <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} maxBarSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Cost per cluster */}
              <Card>
                <CardHeader className="border-b border-border pb-3">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Estimated Cost per Cluster (Juta Rp)
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={costChart} margin={{ top: 0, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.07} />
                      <XAxis dataKey="name" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                      <RTooltip content={<ChartTooltip valueFormat={(v) => `Rp ${fmtNum(v)} jt`} />} cursor={{ fill: "currentColor", fillOpacity: 0.04 }} />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={32}>
                        {costChart.map((e, i) => (
                          <Cell key={i} fill={CLUSTER_COLORS[e.name] ?? "#6b7280"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Save scenario bar */}
            <div className="flex items-center gap-3 p-4 rounded-lg border border-border bg-muted/30">
              <HugeiconsIcon icon={toIcon(AddCircleIcon)} size={16} className="text-muted-foreground shrink-0" />
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Nama skenario…"
                className="flex-1 min-w-0 px-3 py-1.5 text-sm rounded-md border border-border bg-background
                  focus:outline-none focus:ring-2 focus:ring-ring/50 placeholder:text-muted-foreground"
              />
              <button
                onClick={saveScenario}
                disabled={!saveName.trim()}
                className="px-3 py-1.5 rounded-md text-xs font-semibold border border-border
                  hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                Simpan Skenario
              </button>
            </div>

            {/* Saved scenarios */}
            {scenarios.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold">
                  Skenario Tersimpan ({scenarios.length})
                  {scenarios.length >= 2 && (
                    <span className="text-xs font-normal text-muted-foreground ml-2">
                      Pilih 2 untuk perbandingan
                    </span>
                  )}
                </h2>
                <div className="flex flex-wrap gap-2">
                  {scenarios.map((s) => {
                    const sel = compareIds?.includes(s.id);
                    return (
                      <div
                        key={s.id}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                          sel
                            ? "border-violet-500 bg-violet-500/10 text-violet-600 dark:text-violet-400"
                            : "border-border hover:border-foreground/30"
                        }`}
                      >
                        <button onClick={() => toggleCompare(s.id)} className="flex items-center gap-1.5">
                          <span>{s.name}</span>
                          <span className="text-muted-foreground">
                            {shortRp(s.result.meta.total_cost)} · {s.result.meta.total_toko} toko
                          </span>
                        </button>
                        <button
                          onClick={() => deleteScenario(s.id)}
                          className="text-muted-foreground hover:text-[#DC2626] transition-colors ml-1"
                        >
                          <HugeiconsIcon icon={toIcon(DeleteIcon)} size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Comparison view */}
                {compareScenarios &&
                  compareScenarios[0] &&
                  compareScenarios[1] && (
                    <ScenarioCompare a={compareScenarios[0]} b={compareScenarios[1]} />
                  )}
              </div>
            )}

            {/* Results table */}
            <Card>
              <CardHeader className="border-b border-border pb-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <HugeiconsIcon icon={toIcon(PackageIcon)} size={15} color="#8b5cf6" />
                  Toko Terpilih
                  <span className="ml-auto flex items-center gap-2">
                    <span className="text-xs font-normal text-muted-foreground">
                      {fmtNum(result.data.length)} toko
                    </span>
                    <button
                      onClick={exportCSV}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium
                        border border-border hover:bg-muted transition-colors"
                    >
                      <HugeiconsIcon icon={toIcon(DownloadIcon)} size={12} />
                      Export CSV
                    </button>
                    <button
                      disabled={exportingILPPdf}
                      onClick={async () => {
                        setExportingILPPdf(true);
                        try {
                          const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
                          await downloadFile(
                            `${API}/api/export/ilp-report`,
                            "POST",
                            {
                              data: result.data,
                              meta: result.meta,
                              params: {
                                budget_maks: Number(budget),
                                maks_toko: Number(maxToko),
                                weight_ratio_cluster: wRatio,
                                weight_avg_trx: wTrx,
                                weight_growth: wGrowth,
                              },
                            },
                            `ILP_Report_${today}.pdf`,
                          );
                        } catch (e) {
                          console.error("Export ILP PDF failed:", e);
                        } finally {
                          setExportingILPPdf(false);
                        }
                      }}
                      className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium
                        border border-border hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <HugeiconsIcon icon={toIcon(DownloadIcon)} size={12} />
                      {exportingILPPdf ? "Generating…" : "Export PDF"}
                    </button>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 px-0">
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur-sm">
                    <TableRow className="border-b border-muted/50 hover:bg-transparent">
                      <TableHead className="pl-4 w-8 text-xs uppercase tracking-wider">#</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">Nama Toko</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">Kabupaten</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">Cluster</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">Avg TON</TableHead>
                      <SortHeader colKey="score_adjusted">Score</SortHeader>
                      <SortHeader colKey="ratio_score">
                        <Tooltip text="Ratio vs Cluster (MinMax 0–100): volume toko relatif terhadap median cluster-nya">
                          <span>Ratio</span>
                        </Tooltip>
                      </SortHeader>
                      <SortHeader colKey="trx_score">
                        <Tooltip text="Avg Transaksi (MinMax 0–100): frekuensi order per bulan">
                          <span>Trx</span>
                        </Tooltip>
                      </SortHeader>
                      <SortHeader colKey="growth_score">
                        <Tooltip text="Growth Trend (MinMax 0–100): pertumbuhan volume 3 bulan terakhir">
                          <span>Growth</span>
                        </Tooltip>
                      </SortHeader>
                      <SortHeader colKey="estimated_cost">Est. Cost</SortHeader>
                      <SortHeader colKey="efficiency">Efisiensi</SortHeader>
                      <TableHead className="text-xs uppercase tracking-wider">Brand</TableHead>
                      <TableHead className="text-xs uppercase tracking-wider">Sinyal GMM</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedData.map((row, idx) => {
                      const bc = BRAND_COLOR[row.brand_category] ?? "#6b7280";
                      const cc = CLUSTER_COLORS[row.cluster_pareto] ?? "#6b7280";
                      return (
                        <TableRow key={row.id_toko} className="hover:bg-muted/30 border-b border-muted/50">
                          <TableCell className="pl-4 tabular-nums text-muted-foreground">
                            {idx + 1}
                          </TableCell>
                          <TableCell className="font-medium max-w-[160px] truncate" title={row.nama_toko}>
                            {row.nama_toko}
                          </TableCell>
                          <TableCell className="text-muted-foreground max-w-[130px] truncate" title={row.kabupaten}>
                            {row.kabupaten.replace(/^KABUPATEN /, "KAB. ")}
                          </TableCell>
                          <TableCell>
                            <span
                              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                              style={{ color: cc, backgroundColor: `${cc}14` }}
                            >
                              {row.cluster_pareto}
                            </span>
                          </TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">
                            {fmtNum(row.avg_ton)}
                          </TableCell>
                          <TableCell className="tabular-nums font-semibold" title={`ILP score: ${row.score.toFixed(1)}`}>
                            {(row.score_adjusted ?? row.score).toFixed(1)}
                          </TableCell>
                          <TableCell className="tabular-nums text-right text-muted-foreground text-[11px]">
                            {row.ratio_score.toFixed(1)}
                          </TableCell>
                          <TableCell className="tabular-nums text-right text-muted-foreground text-[11px]">
                            {row.trx_score.toFixed(1)}
                          </TableCell>
                          <TableCell className="tabular-nums text-right text-muted-foreground text-[11px]">
                            {row.growth_score.toFixed(1)}
                          </TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">
                            {shortRp(row.estimated_cost)}
                          </TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">
                            {row.efficiency.toFixed(2)}
                            <span className="text-[9px] ml-0.5">pt/jt</span>
                          </TableCell>
                          <TableCell>
                            <span
                              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                              style={{ backgroundColor: `${bc}18`, color: bc, border: `1px solid ${bc}28` }}
                            >
                              {row.brand_category}
                            </span>
                          </TableCell>
                          <TableCell>
                            {row.cannibalization_category ? (() => {
                              const b = GMM_BADGE[row.cannibalization_category] ?? { label: row.cannibalization_category, color: "#6b7280" };
                              return (
                                <span
                                  className="text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap"
                                  style={{ color: b.color, backgroundColor: `${b.color}14`, border: `1px solid ${b.color}28` }}
                                  title={row.cannibalization_label ?? undefined}
                                >
                                  {b.label}
                                </span>
                              );
                            })() : <span className="text-[10px] text-muted-foreground">—</span>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {/* Empty state */}
        {!result && !solving && (
          <div className="rounded-xl border border-border border-dashed flex flex-col items-center
            justify-center py-16 gap-3 text-muted-foreground">
            <HugeiconsIcon icon={toIcon(BarChartIcon)} size={36} />
            <p className="text-sm font-medium">Isi parameter dan klik Jalankan Optimasi</p>
            <p className="text-xs">Solver akan memilih toko terbaik berdasarkan ILP scoring</p>
          </div>
        )}

        {/* Info card loyalty */}
        <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/10">
          <CardContent className="p-4 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <HugeiconsIcon icon={toIcon(InformationCircleIcon)} size={16} color="#3b82f6" className="shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700 dark:text-blue-300">
                Hasil ini adalah rekomendasi sistem pendukung keputusan.
                Untuk mendaftarkan toko ke program loyalty, gunakan halaman{" "}
                <strong>Manajemen Loyalty</strong> atau lihat Tab Referensi ILP.
              </p>
            </div>
            <a
              href="/loyalty"
              className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-blue-300 dark:border-blue-700 text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors whitespace-nowrap"
            >
              Buka Manajemen Loyalty
              <HugeiconsIcon icon={toIcon(ChevronRightIcon)} size={11} />
            </a>
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground pb-4">
          CORE Platform v2 · ILP Loyalty Optimizer
        </p>
      </main>
    </div>
  );
}
