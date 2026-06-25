"use client";

const MODEL_LABEL: Record<string, string> = {
  "claude-haiku-4-5-20251001": "⚡ Haiku",
  "claude-sonnet-4-6": "🔹 Sonnet",
  "claude-opus-4-8": "🔮 Opus",
};

interface OracleModelBadgeProps {
  modelUsed?: string | null;
  routingReason?: string | null;
}

export function OracleModelBadge({ modelUsed, routingReason }: OracleModelBadgeProps) {
  if (!modelUsed) return null;
  const label = MODEL_LABEL[modelUsed] ?? modelUsed;

  return (
    <span className="block text-[10px] text-muted-foreground mt-1">
      {label}
      {routingReason && <> · {routingReason.replace(/_/g, " ")}</>}
    </span>
  );
}
