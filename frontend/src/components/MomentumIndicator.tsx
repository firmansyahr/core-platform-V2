"use client";

const MOMENTUM_CFG: Record<string, { arrow: string; cls: string }> = {
  accelerating_loss: { arrow: "↓↓", cls: "text-red-600 dark:text-red-400 font-bold" },
  slow_erosion:      { arrow: "↓",  cls: "text-orange-500 dark:text-orange-400" },
  stable:            { arrow: "→",  cls: "text-muted-foreground" },
  gaining:           { arrow: "↑",  cls: "text-green-600 dark:text-green-400 font-bold" },
};

export function MomentumIndicator({ label }: { label: string | null }) {
  const cfg = MOMENTUM_CFG[label ?? "stable"] ?? MOMENTUM_CFG.stable;
  return (
    <span className={`text-xs ${cfg.cls}`}>
      {cfg.arrow} {label?.replace(/_/g, " ") ?? "stable"}
    </span>
  );
}
