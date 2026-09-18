"use client";

import React from "react";
import { Rectangle, ResponsiveContainer, Scatter, ScatterChart, XAxis, YAxis, usePlotArea } from "recharts";
import { BRISTOL_COMPARISON_MIN_MEALS, type HealthReport } from "@/features/health/model/health-reports";
import { chartTooltipStyle, useChartAnimation, ChartTooltip } from "@/lib/chart-ui";

type Cell = { x: number; y: number; tag: string; difference: number | null; label: string; detail: string; selection: string };

export function BristolHeatmap({ report, selected, onSelect, onTagSelect }: {
  report: HealthReport;
  selected: string | null;
  onSelect: (text: string) => void;
  onTagSelect?: (tag: string) => void;
}) {
  const animate = useChartAnimation();
  const chartAnchor = React.useRef<HTMLDivElement>(null);
  const rows = report.dietTagBristolComparisons;
  const data: Cell[] = rows.flatMap((row, y) => {
    const enough = Math.min(row.withTag.observedMeals, row.withoutTag.observedMeals) >= BRISTOL_COMPARISON_MIN_MEALS;
    return row.withTag.bristolMeals.map((count, index) => {
      const withRate = row.withTag.observedMeals ? count / row.withTag.observedMeals * 100 : null;
      const withoutRate = row.withoutTag.observedMeals ? row.withoutTag.bristolMeals[index] / row.withoutTag.observedMeals * 100 : null;
      const difference = enough ? Number((withRate! - withoutRate!).toFixed(1)) : null;
      const label = difference === null ? "Insufficient data" : `${signed(difference)} pp`;
      const detail = `With tag: ${count}/${row.withTag.observedMeals} (${withRate === null ? "unavailable" : `${withRate.toFixed(1)}%`}). Without tag: ${row.withoutTag.bristolMeals[index]}/${row.withoutTag.observedMeals} (${withoutRate === null ? "unavailable" : `${withoutRate.toFixed(1)}%`}).`;
      return { x: index + 1, y, tag: row.tag, difference, label, detail,
        selection: `${row.tag} · Bristol ${index + 1} · ${label}. ${detail} No bowel record (with / without): ${row.withTag.eligibleMeals - row.withTag.observedMeals} / ${row.withoutTag.eligibleMeals - row.withoutTag.observedMeals}. Awaiting 24h: ${row.withTag.pendingMeals} / ${row.withoutTag.pendingMeals}.`,
      };
    });
  });
  return <div className="health-report-heatmap-scroll" role="region" aria-label="Scrollable Bristol comparison chart" tabIndex={0}>
    <div ref={chartAnchor} className="health-report-heatmap-chart" style={{ height: rows.length * 44 + 48 }}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 650, height: rows.length * 44 + 48 }}>
        <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <XAxis type="number" dataKey="x" domain={[0.5, 7.5]} ticks={[1, 2, 3, 4, 5, 6, 7]}
            orientation="top" axisLine={false} tickLine={false} stroke="var(--color-text-muted)" />
          <YAxis type="number" dataKey="y" domain={[-0.5, rows.length - 0.5]} reversed
            ticks={rows.map((_, i) => i)} interval={0} width={112} axisLine={false} tickLine={false}
            tick={(props) => {
              const tag = rows[props.payload.value]?.tag ?? "";
              return <text x={props.x} y={props.y} dy={4} textAnchor="end" fill="var(--color-ink)" fontSize={12}
                role={onTagSelect ? "button" : undefined} tabIndex={onTagSelect ? 0 : undefined}
                aria-label={tag} onClick={() => onTagSelect?.(tag)} onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onTagSelect?.(tag); }
                }}><title>{tag}</title>{tag.length > 14 ? `${tag.slice(0, 13)}…` : tag}</text>;
            }} />
          <ChartTooltip anchor={chartAnchor} cursor={false} content={({ active, payload }) => active && payload?.length
              ? <div className="chart-tooltip" style={chartTooltipStyle}>{payload[0].payload.selection}</div> : null} />
          <Scatter data={data} isAnimationActive={animate} animationDuration={350}
            shape={(props: unknown) => <HeatCell {...props as { cx: number; cy: number; payload: Cell }} selected={selected} onSelect={onSelect} />} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  </div>;
}

function HeatCell({ cx, cy, payload, selected, onSelect }: {
  cx: number; cy: number; payload: Cell; selected: string | null; onSelect: (text: string) => void;
}) {
  const plot = usePlotArea();
  const width = Math.max(1, (plot?.width ?? 530) / 7 - 4);
  const fill = payload.difference === null ? "var(--color-surface-raised)"
    : `color-mix(in srgb, var(--color-heatmap-${payload.difference >= 0 ? "more" : "less"}) ${Math.abs(payload.difference)}%, var(--color-surface-raised))`;
  return <g className="chart-heat-cell" role="button" tabIndex={0}
    aria-label={`${payload.tag}, Bristol ${payload.x}: ${payload.label}. ${payload.detail}`}
    aria-pressed={selected === payload.selection} data-comparable={payload.difference !== null}
    onClick={() => onSelect(payload.selection)} onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(payload.selection); }
    }}>
    <Rectangle x={cx - width / 2} y={cy - 20} width={width} height={40} radius={10} fill={fill}
      stroke={selected === payload.selection ? "var(--color-accent-strong)" : "transparent"} strokeWidth={2} />
    <text x={cx} y={cy} dy={4} textAnchor="middle" fill="var(--color-ink)" fontSize={12} pointerEvents="none">
      {payload.difference === null ? "—" : signed(payload.difference)}
    </text>
  </g>;
}

function signed(value: number) { return `${value > 0 ? "+" : ""}${value}`; }
