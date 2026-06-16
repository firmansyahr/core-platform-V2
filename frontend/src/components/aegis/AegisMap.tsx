"use client";

import { useState, useMemo } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from "react-simple-maps";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

const GEO_URL = "/maps/indonesia-kabupaten.geojson";

export interface RegionMapData {
  nama: string;
  total_toko: number;
  warning_count: number;
  merah_count: number;
  oranye_count: number;
  kuning_count: number;
  normal_count: number;
  avg_aegis_score: number;
  warning_pct: number;
  merah_pct: number;
  cad_status: "KRITIS" | "MERAH" | "KUNING" | "NORMAL";
  volume_at_risk: number;
  dominant_pola: string;
}

export const CAD_COLOR: Record<string, string> = {
  KRITIS: "#DC2626",
  MERAH:  "#EF4444",
  KUNING: "#F59E0B",
  NORMAL: "#10B981",
};

const CAD_COLOR_MUTED: Record<string, string> = {
  KRITIS: "#DC262620",
  MERAH:  "#EF444420",
  KUNING: "#F59E0B20",
  NORMAL: "#10B98120",
};

const CAD_ORDER: Record<string, number> = {
  KRITIS: 0, MERAH: 1, KUNING: 2, NORMAL: 3,
};

const POLA_DESC: Record<string, string> = {
  A: "Beralih ke produk murah",
  B: "Tiga tanda bahaya aktif",
  C: "Pola beli berubah",
  D: "Kembali normal",
  N: "Normal",
};

const fmtNum = (n: number) =>
  new Intl.NumberFormat("id-ID").format(Math.round(n));

// Strip "Kabupaten"/"Kota"/"KAB." prefix from a name (case-insensitive)
function stripPrefix(s: string): string {
  return s
    .toUpperCase()
    .replace(/^(KABUPATEN|KOTA|KAB\.)\s+/i, "")
    .trim();
}

// Build lookup map: stripped_name → RegionMapData
function buildDataMap(data: RegionMapData[]): Record<string, RegionMapData> {
  const m: Record<string, RegionMapData> = {};
  for (const d of data) {
    m[stripPrefix(d.nama)] = d;
  }
  return m;
}

// Get RegionMapData for a GeoJSON feature — tries NAME_2 after stripping prefix
function matchRegion(
  props: Record<string, string | number | null>,
  dataMap: Record<string, RegionMapData>,
): RegionMapData | undefined {
  // GeoJSON NAME_2 may include "Kota"/"Kabupaten" prefix (e.g. "Kota Surabaya")
  const raw = String(props.NAME_2 ?? "");
  const stripped = stripPrefix(raw);
  return dataMap[stripped];
}

function getRegionColor(region: RegionMapData | undefined, hovered: boolean): string {
  if (!region) return hovered ? "#D1D5DB" : "#E5E7EB";
  const base = CAD_COLOR[region.cad_status] ?? "#6B7280";
  // Full opacity on hover, lighter otherwise
  if (hovered) return base;
  const alpha = region.cad_status === "KRITIS" ? "DD" : region.cad_status === "MERAH" ? "BB" : "99";
  return base + alpha;
}

interface TooltipState {
  x: number;
  y: number;
  data: RegionMapData;
}

interface AegisMapProps {
  data: RegionMapData[];
  loading?: boolean;
  onRegionClick?: (region: RegionMapData) => void;
  mini?: boolean;
  height?: number;
}

export default function AegisMap({
  data,
  loading = false,
  onRegionClick,
  mini = false,
  height,
}: AegisMapProps) {
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const dataMap = useMemo(() => buildDataMap(data), [data]);

  const mapHeight = height ?? (mini ? 200 : 580);

  if (loading) {
    return (
      <div
        className="flex items-center justify-center bg-muted/30 rounded-xl animate-pulse"
        style={{ height: mapHeight }}
      >
        <span className="text-xs text-muted-foreground">Memuat peta…</span>
      </div>
    );
  }

  if (mini) {
    return (
      <div className="relative rounded-xl overflow-hidden border border-border/50 bg-muted/10">
        <ComposableMap
          projection="geoMercator"
          projectionConfig={{ center: [118, -2], scale: 900 }}
          width={600}
          height={mapHeight}
          style={{ width: "100%", height: "100%" }}
        >
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const region = matchRegion(geo.properties, dataMap);
                const fill = region
                  ? (CAD_COLOR[region.cad_status] ?? "#6B7280") + "99"
                  : "#E5E7EB";
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={fill}
                    stroke="#FFFFFF"
                    strokeWidth={0.3}
                    style={{
                      default: { outline: "none" },
                      hover: { outline: "none", opacity: 0.85 },
                      pressed: { outline: "none" },
                    }}
                  />
                );
              })
            }
          </Geographies>
        </ComposableMap>
        {/* Mini legend */}
        <div className="absolute bottom-2 left-2 flex items-center gap-2 bg-black/30 rounded px-2 py-1 backdrop-blur-sm">
          {(["KRITIS", "MERAH", "KUNING", "NORMAL"] as const).map((s) => (
            <div key={s} className="flex items-center gap-1">
              <span
                className="w-2 h-2 rounded-sm inline-block"
                style={{ backgroundColor: CAD_COLOR[s] }}
              />
              <span className="text-[9px] text-white/90 font-medium">{s}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="relative" style={{ height: mapHeight }}>
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ center: [118, -2], scale: 1050 }}
        width={800}
        height={mapHeight}
        style={{ width: "100%", height: "100%" }}
      >
        <ZoomableGroup
          center={[118, -2]}
          minZoom={0.8}
          maxZoom={8}
        >
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const region = matchRegion(geo.properties, dataMap);
                const key = String(geo.properties.NAME_2 ?? geo.rsmKey);
                const isHovered = hoveredRegion === key;
                const fill = getRegionColor(region, isHovered);
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={fill}
                    stroke="#FFFFFF"
                    strokeWidth={isHovered ? 1 : 0.3}
                    style={{
                      default: { outline: "none", cursor: region ? "pointer" : "default" },
                      hover: { outline: "none" },
                      pressed: { outline: "none" },
                    }}
                    onMouseEnter={(e) => {
                      setHoveredRegion(key);
                      if (region) {
                        const svgEl = (e.target as SVGElement).closest("svg");
                        const rect = svgEl?.getBoundingClientRect();
                        setTooltip({
                          x: e.clientX - (rect?.left ?? 0),
                          y: e.clientY - (rect?.top ?? 0),
                          data: region,
                        });
                      }
                    }}
                    onMouseLeave={() => {
                      setHoveredRegion(null);
                      setTooltip(null);
                    }}
                    onClick={() => region && onRegionClick?.(region)}
                  />
                );
              })
            }
          </Geographies>
        </ZoomableGroup>
      </ComposableMap>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-border bg-card shadow-xl px-3 py-2.5 text-xs min-w-[180px]"
          style={{
            left: tooltip.x + 14,
            top: tooltip.y - 8,
            transform: tooltip.x > 650 ? "translateX(-110%)" : undefined,
          }}
        >
          <p className="font-semibold mb-1.5 text-sm leading-tight">{tooltip.data.nama}</p>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span
              className="inline-block w-2 h-2 rounded-sm"
              style={{ backgroundColor: CAD_COLOR[tooltip.data.cad_status] }}
            />
            <span
              className="font-bold text-[10px] px-1.5 py-0.5 rounded"
              style={{
                color: CAD_COLOR[tooltip.data.cad_status],
                backgroundColor: CAD_COLOR_MUTED[tooltip.data.cad_status],
              }}
            >
              {tooltip.data.cad_status}
            </span>
          </div>
          <div className="space-y-0.5 text-muted-foreground">
            <p>Warning: {tooltip.data.warning_count} / {tooltip.data.total_toko} toko ({tooltip.data.warning_pct}%)</p>
            <p>Merah: {tooltip.data.merah_count} · Oranye: {tooltip.data.oranye_count} · Kuning: {tooltip.data.kuning_count}</p>
            <p>Avg Score: {tooltip.data.avg_aegis_score.toFixed(1)}</p>
            <p>Vol at risk: {fmtNum(tooltip.data.volume_at_risk)} TON</p>
            {tooltip.data.dominant_pola !== "N" && (
              <p>Pola {tooltip.data.dominant_pola}: {POLA_DESC[tooltip.data.dominant_pola] ?? ""}</p>
            )}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-3 right-3 flex flex-col gap-1 bg-background/90 rounded-lg border border-border px-3 py-2 backdrop-blur-sm">
        <p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Status CAD</p>
        {(["KRITIS", "MERAH", "KUNING", "NORMAL"] as const).map((s) => (
          <div key={s} className="flex items-center gap-1.5 text-[10px]">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: CAD_COLOR[s] }} />
            <span className="text-foreground/80">{s}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 text-[10px] mt-0.5 pt-1 border-t border-border">
          <span className="w-3 h-3 rounded-sm inline-block bg-[#E5E7EB]" />
          <span className="text-muted-foreground">Tidak ada data</span>
        </div>
        <p className="text-[8px] text-muted-foreground/60 mt-0.5">Scroll: zoom · Drag: geser</p>
      </div>
    </div>
  );
}

// ── Kabupaten bar chart (top N by warning count) ──────────────────────────────

interface KabBarTooltipProps {
  active?: boolean;
  payload?: { value: number; payload: { cad_status: string; warning_pct: number } }[];
  label?: string;
}

function KabBarTooltip({ active, payload, label }: KabBarTooltipProps) {
  if (!active || !payload?.length || !label) return null;
  const { cad_status, warning_pct } = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold mb-0.5 max-w-[200px] truncate">{label}</p>
      <p className="text-muted-foreground">
        <span
          className="inline-block w-2 h-2 rounded-sm mr-1 align-middle"
          style={{ backgroundColor: CAD_COLOR[cad_status] }}
        />
        {cad_status} · {payload[0].value} warning ({warning_pct}%)
      </p>
    </div>
  );
}

interface AegisKabChartProps {
  data: RegionMapData[];
  onRegionClick?: (region: RegionMapData) => void;
  topN?: number;
}

export function AegisKabChart({ data, onRegionClick, topN = 20 }: AegisKabChartProps) {
  const sorted = useMemo(
    () =>
      [...data]
        .filter((r) => r.warning_count > 0)
        .sort((a, b) => CAD_ORDER[a.cad_status] - CAD_ORDER[b.cad_status] || b.warning_count - a.warning_count)
        .slice(0, topN),
    [data, topN],
  );

  const chartData = sorted.map((r) => ({
    name: r.nama.replace(/^KABUPATEN /, "KAB. ").replace(/^KOTA /, "KOTA "),
    value: r.warning_count,
    cad_status: r.cad_status,
    warning_pct: r.warning_pct,
    _raw: r,
  }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(280, sorted.length * 30)}>
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 0, right: 48, left: 4, bottom: 0 }}
      >
        <CartesianGrid horizontal={false} strokeDasharray="3 3" strokeOpacity={0.07} />
        <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis
          type="category"
          dataKey="name"
          width={170}
          tick={{ fontSize: 10 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          content={<KabBarTooltip />}
          cursor={{ fill: "currentColor", fillOpacity: 0.04 }}
        />
        <Bar
          dataKey="value"
          radius={[0, 4, 4, 0]}
          maxBarSize={20}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onClick={(entry: any) => (entry as { _raw?: RegionMapData })._raw && onRegionClick?.((entry as { _raw: RegionMapData })._raw)}
          style={{ cursor: "pointer" }}
        >
          {chartData.map((e, i) => (
            <Cell key={i} fill={CAD_COLOR[e.cad_status] ?? "#6B7280"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
