"use client";

import React from "react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { LineChartSpec } from "@/features/dashboard/model/dashboard-widgets";
import { chartTooltipStyle, useChartAnimation, ChartTooltip } from "@/lib/chart-ui";

type DashboardLineChartProps = {
  chart: LineChartSpec;
  scale?: "automatic" | "percentage";
  domain?: { minimum: number; maximum: number };
  valueSuffix?: string;
  dateRange?: { start: string; end: string };
  referenceBand?: { minimum: number; maximum: number; label: string };
};

export function DashboardLineChart({ chart, scale = "automatic", domain, valueSuffix = "", dateRange, referenceBand }: DashboardLineChartProps) {
  const animate = useChartAnimation();
  const chartAnchor = React.useRef<HTMLDivElement>(null);
  const explicitDomain = domain && Number.isFinite(domain.minimum) && Number.isFinite(domain.maximum)
    && domain.maximum > domain.minimum ? domain : undefined;
  const minimum = explicitDomain?.minimum ?? 0;
  const maximum = explicitDomain?.maximum ?? (scale === "percentage" ? 100
    : Math.max(1, referenceBand?.maximum ?? 0, ...chart.points.map((point) => point.value)));
  const suffix = scale === "percentage" ? "%" : valueSuffix;
  const dated = chart.points.every((point) => Number.isFinite(Date.parse(point.label)));
  const points = chart.points.map((point, index) => ({ ...point, x: dated ? Date.parse(point.label) : index }));
  const dateDomain: [number | "dataMin", number | "dataMax"] = dateRange
    ? [Date.parse(dateRange.start), Date.parse(dateRange.end)] : ["dataMin", "dataMax"];
  const start = dateRange ? Date.parse(dateRange.start) : points[0]?.x ?? 0;
  const end = dateRange ? Date.parse(dateRange.end) : points[points.length - 1]?.x ?? start;
  const tickCount = Math.min(7, dateRange ? Math.round((end - start) / 86_400_000) + 1 : points.length);
  const xTicks = [...new Set(Array.from({ length: tickCount }, (_, index) => dateRange
    ? start + Math.round(index * (end - start) / 86_400_000 / Math.max(1, tickCount - 1)) * 86_400_000
    : points[Math.round(index * (points.length - 1) / Math.max(1, tickCount - 1))].x))];
  const yTicks = explicitDomain || scale === "percentage"
    ? Array.from({ length: 5 }, (_, index) => maximum - (maximum - minimum) * index / 4) : undefined;

  return (
    <div className="dashboard-chart dashboard-chart-line" role="group" aria-label={chart.ariaLabel}>
      <div ref={chartAnchor} className="chart-line-frame">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 260 }}>
          <LineChart data={points} margin={{ top: 16, right: 24, bottom: 8, left: 8 }} accessibilityLayer>
            <CartesianGrid vertical={false} stroke="var(--color-hairline-light)" />
            <XAxis dataKey="x" type="number" domain={dateDomain} ticks={xTicks} minTickGap={20}
              tickFormatter={(value) => dated ? new Date(value).toISOString().slice(5, 10) : chart.points[value]?.label ?? ""}
              tick={(props) => {
                const date = dated ? new Date(props.payload.value).toISOString().slice(0, 10) : chart.points[props.payload.value]?.label ?? "";
                return <text x={props.x} y={props.y} dy={16} textAnchor="middle" fill="var(--color-text-muted)"
                  fontSize={12} data-date={date}><title>{date}</title><tspan>{dated ? date.slice(5) : date}</tspan></text>;
              }}
              stroke="var(--color-text-muted)" tickLine={false} />
            <YAxis domain={[minimum, maximum]} ticks={yTicks} allowDataOverflow width={66} tickCount={5}
              tickFormatter={(value: number) => `${Number(value.toFixed(2))}${suffix}`}
              stroke="var(--color-text-muted)" axisLine={false} tickLine={false} />
            {referenceBand && <ReferenceArea y1={referenceBand.minimum} y2={referenceBand.maximum}
              fill="var(--color-accent-strong)" fillOpacity={0.08}
              label={{ value: referenceBand.label, fill: "var(--color-text-muted)", position: "insideTopLeft", fontSize: 11 }} />}
            <ChartTooltip anchor={chartAnchor} content={({ active, payload }) => active && payload?.length
              ? <div className="chart-tooltip" style={chartTooltipStyle}>{payload[0].payload.ariaLabel}</div> : null} />
            <Line type="linear" dataKey="value" stroke="var(--color-accent-strong)" strokeWidth={2.5}
              dot={(props: unknown) => {
                const point = props as { cx: number; cy: number; payload: typeof points[number] };
                return <circle key={point.payload.id} cx={point.cx} cy={point.cy} r={3}
                  fill="var(--color-surface-raised)" stroke="var(--color-accent-strong)" strokeWidth={2}
                  role="img" aria-label={point.payload.ariaLabel} />;
              }} activeDot={{ r: 6 }}
              isAnimationActive={animate} animationDuration={350} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul className="sr-only">{chart.points.map((point) => <li key={point.id}>{point.ariaLabel}</li>)}</ul>
    </div>
  );
}
