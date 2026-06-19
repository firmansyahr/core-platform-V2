"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  ResponsiveContainer,
} from "recharts";

interface BarItem {
  name: string;
  value: number;
  fill: string;
}

interface Props {
  data: BarItem[];
  height?: number;
  yWidth?: number;
  layout?: "horizontal" | "vertical";
}

export function MiniBarChart({
  data,
  height = 160,
  yWidth = 80,
  layout = "vertical",
}: Props) {
  if (!data.length) {
    return (
      <p className="text-xs text-muted-foreground text-center py-6">
        Tidak ada data
      </p>
    );
  }

  const isVertical = layout === "vertical";

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout={layout}
        margin={{ left: 0, right: 12, top: 4, bottom: 4 }}
      >
        {isVertical ? (
          <>
            <XAxis
              type="number"
              tick={{ fontSize: 9 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 9 }}
              tickLine={false}
              axisLine={false}
              width={yWidth}
            />
          </>
        ) : (
          <>
            <XAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 9 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              type="number"
              tick={{ fontSize: 9 }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
          </>
        )}
        <Tooltip
          formatter={(v) => [
            new Intl.NumberFormat("id-ID").format(Number(v)),
            "",
          ]}
          contentStyle={{ fontSize: 11, borderRadius: 6 }}
        />
        <Bar
          dataKey="value"
          radius={isVertical ? [0, 3, 3, 0] : [3, 3, 0, 0]}
        >
          {data.map((d, i) => (
            <Cell key={i} fill={d.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
