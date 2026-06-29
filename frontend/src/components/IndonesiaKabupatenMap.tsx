"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { feature } from "topojson-client";
import type { Topology, Objects } from "topojson-specification";
import type { GeoPermissibleObjects } from "d3-geo";
import { Loader2 } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface KabupatenData {
  kabupaten: string; // AEGIS format: "KABUPATEN BATANG" / "KOTA TEGAL"
  value: number;
  label?: string;
}

interface Props {
  data: KabupatenData[];
  colorScale?: "danger" | "success" | "info";
  onKabupatenClick?: (kabupaten: string) => void;
  height?: number;
  valueLabel?: string;
}

interface TooltipState {
  x: number;
  y: number;
  content: string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const OBJ_KEY = "IDN_adm_2_kabkota";

const ALIAS: Record<string, string> = {
  "KAYONG UTARA": "Ketapang",
  "KUBU RAYA":    "Pontianak",
  "MELAWI":       "Sintang",
  "MEMPAWAH":     "Pontianak",
  "SEKADAU":      "Sanggau",
};

const COLOR_RAMPS: Record<Props["colorScale"] & string, string[]> = {
  danger:  ["#FEF2F2", "#FECACA", "#FCA5A5", "#F87171", "#EF4444", "#B91C1C"],
  success: ["#F0FDF4", "#BBF7D0", "#86EFAC", "#4ADE80", "#22C55E", "#15803D"],
  info:    ["#EFF6FF", "#BFDBFE", "#93C5FD", "#60A5FA", "#3B82F6", "#1D4ED8"],
};

// Normalize AEGIS name → Title Case for TopoJSON NAME_2 lookup
function normalize(s: string): string {
  const stripped = s.replace(/^(KABUPATEN|KOTA)\s+/i, "").trim().toUpperCase();
  const aliased  = ALIAS[stripped];
  return (aliased ?? stripped);
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function IndonesiaKabupatenMap({
  data,
  colorScale = "danger",
  onKabupatenClick,
  height = 480,
  valueLabel = "Nilai",
}: Props) {
  const svgRef       = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [topoData, setTopoData] = useState<Topology<Objects<Record<string, unknown>>> | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [tooltip,  setTooltip]  = useState<TooltipState | null>(null);

  // Load TopoJSON once
  useEffect(() => {
    fetch("/maps/indonesia-kabupaten.topo.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => { setTopoData(d); setLoading(false); })
      .catch((err) => { console.error("TopoJSON load failed:", err); setLoading(false); });
  }, []);

  // Draw / redraw whenever topoData or data changes
  useEffect(() => {
    if (!topoData || !svgRef.current) return;

    // ── Aggregate: multiple AEGIS kabupaten can alias to same polygon ──
    const dataMap = new Map<string, { value: number; sources: string[] }>();
    data.forEach((d) => {
      const key = normalize(d.kabupaten).toUpperCase();
      const isAlias = ALIAS[d.kabupaten.replace(/^(KABUPATEN|KOTA)\s+/i, "").trim().toUpperCase()];
      const existing = dataMap.get(key);
      if (existing) {
        existing.value += d.value;
        existing.sources.push(d.kabupaten);
        if (isAlias && !existing.sources.includes("pemekaran")) {
          existing.sources.push("pemekaran");
        }
      } else {
        dataMap.set(key, { value: d.value, sources: [d.kabupaten] });
      }
    });

    const values = Array.from(dataMap.values()).map((d) => d.value);
    const maxVal = Math.max(...values, 1);
    const ramp   = COLOR_RAMPS[colorScale];

    const colorFn = d3.scaleQuantize<string>()
      .domain([0, maxVal])
      .range(ramp);

    // Dark mode detection for no-data fill
    const isDark = typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark");
    const noDataFill = isDark ? "#1e293b" : "#f1f5f9";
    const strokeCol  = isDark ? "#334155" : "#cbd5e1";

    // ── D3 setup ──
    const W = 680;
    const H = 420;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${W} ${H}`);

    const projection = d3.geoMercator()
      .center([118, -2])
      .scale(1050)
      .translate([W / 2, H / 2]);

    const pathFn = d3.geoPath().projection(projection);

    // topojson.feature returns a FeatureCollection
    const featureCollection = feature(
      topoData,
      topoData.objects[OBJ_KEY] as Parameters<typeof feature>[1],
    );
    const features = ("features" in featureCollection ? featureCollection.features : []) as Array<{
      type: string;
      properties: Record<string, string>;
      geometry: GeoPermissibleObjects;
    }>;

    svg.selectAll<SVGPathElement, typeof features[0]>("path")
      .data(features)
      .join("path")
      .attr("d", (d) => pathFn(d.geometry as GeoPermissibleObjects) ?? "")
      .attr("fill", (d) => {
        const key = (d.properties.NAME_2 ?? "").toUpperCase().trim();
        const match = dataMap.get(key);
        return match ? colorFn(match.value) : noDataFill;
      })
      .attr("stroke", strokeCol)
      .attr("stroke-width", 0.3)
      .style("cursor", "pointer")
      .on("mouseenter", function (event: MouseEvent, d) {
        const key   = (d.properties.NAME_2 ?? "").toUpperCase().trim();
        const match = dataMap.get(key);
        const hasPemekaran = match?.sources.some((s) => Object.keys(ALIAS).some(
          (a) => a !== s.replace(/^(KABUPATEN|KOTA)\s+/i, "").trim().toUpperCase()
            && normalize(s) === key
        ));

        d3.select(this).attr("stroke", "#64748b").attr("stroke-width", 1.4);

        const aliasNote = match && match.sources.length > 1 && hasPemekaran
          ? " (termasuk wilayah pemekaran)"
          : "";

        const svgEl   = svgRef.current!;
        const rect    = svgEl.getBoundingClientRect();
        const scaleX  = rect.width  / W;
        const scaleY  = rect.height / H;
        const svgRect = svgEl.getBoundingClientRect();

        setTooltip({
          x: (event.clientX - svgRect.left) / scaleX,
          y: (event.clientY - svgRect.top)  / scaleY,
          content: match
            ? `${d.properties.NAME_2}: ${match.value.toLocaleString("id-ID")} ${valueLabel}${aliasNote}`
            : `${d.properties.NAME_2}: Tidak ada data`,
        });
      })
      .on("mousemove", function (event: MouseEvent) {
        const svgEl  = svgRef.current!;
        const rect   = svgEl.getBoundingClientRect();
        const scaleX = rect.width  / W;
        const scaleY = rect.height / H;
        setTooltip((prev) =>
          prev
            ? {
                ...prev,
                x: (event.clientX - rect.left) / scaleX,
                y: (event.clientY - rect.top)  / scaleY,
              }
            : null,
        );
      })
      .on("mouseleave", function () {
        d3.select(this).attr("stroke", strokeCol).attr("stroke-width", 0.3);
        setTooltip(null);
      })
      .on("click", function (_event: MouseEvent, d) {
        const key   = (d.properties.NAME_2 ?? "").toUpperCase().trim();
        const match = dataMap.get(key);
        if (match && onKabupatenClick) {
          // return the first (non-alias) AEGIS kabupaten name
          const primary = match.sources.find((s) => s !== "pemekaran") ?? match.sources[0];
          onKabupatenClick(primary);
        }
      });
  }, [topoData, data, colorScale, valueLabel, onKabupatenClick]);

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <Loader2 size={24} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height }}>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ display: "block" }}
      />
      {tooltip && (
        <div
          style={{
            position:       "absolute",
            left:           `${(tooltip.x / 680) * 100}%`,
            top:            `${(tooltip.y / 420) * 100}%`,
            transform:      "translate(10px, -50%)",
            pointerEvents:  "none",
            zIndex:         20,
          }}
          className="rounded-lg border border-border bg-popover px-3 py-1.5 text-xs shadow-lg whitespace-nowrap text-popover-foreground"
        >
          {tooltip.content}
        </div>
      )}
    </div>
  );
}
