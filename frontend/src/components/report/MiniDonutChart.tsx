"use client";

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface DonutItem {
  name: string;
  value: number;
  fill: string;
}

interface Props {
  data: DonutItem[];
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
  showLegend?: boolean;
}

export function MiniDonutChart({
  data,
  height = 180,
  innerRadius = 45,
  outerRadius = 68,
  showLegend = true,
}: Props) {
  const filtered = data.filter((d) => d.value > 0);
  if (!filtered.length) {
    return (
      <p className="text-xs text-muted-foreground text-center py-6">
        Tidak ada data
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={filtered}
          cx="50%"
          cy="50%"
          innerRadius={innerRadius}
          outerRadius={outerRadius}
          dataKey="value"
          strokeWidth={2}
        >
          {filtered.map((entry, i) => (
            <Cell key={i} fill={entry.fill} />
          ))}
        </Pie>
        <Tooltip
          formatter={(v, n) => [v, n]}
          contentStyle={{ fontSize: 11, borderRadius: 6 }}
        />
        {showLegend && (
          <Legend
            iconSize={8}
            iconType="circle"
            wrapperStyle={{ fontSize: 10 }}
          />
        )}
      </PieChart>
    </ResponsiveContainer>
  );
}
