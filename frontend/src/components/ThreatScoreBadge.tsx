"use client";

const CPI_CFG: Record<string, { cls: string; dot: string; label: string }> = {
  critical: {
    cls: "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-400 dark:border-red-700/40",
    dot: "bg-red-500", label: "Kritis",
  },
  high: {
    cls: "bg-orange-50 text-orange-700 border-orange-300 dark:bg-orange-950/30 dark:text-orange-400 dark:border-orange-700/40",
    dot: "bg-orange-500", label: "Tinggi",
  },
  medium: {
    cls: "bg-yellow-50 text-yellow-700 border-yellow-300 dark:bg-yellow-950/30 dark:text-yellow-500 dark:border-yellow-600/40",
    dot: "bg-yellow-400", label: "Sedang",
  },
  low: {
    cls: "bg-green-50 text-green-700 border-green-300 dark:bg-green-950/30 dark:text-green-400 dark:border-green-700/40",
    dot: "bg-green-400", label: "Rendah",
  },
};

export function ThreatScoreBadge({ label }: { label: string }) {
  const cfg = CPI_CFG[label] ?? CPI_CFG.low;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded border ${cfg.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}
