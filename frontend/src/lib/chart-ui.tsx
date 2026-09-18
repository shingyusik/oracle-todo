"use client";

import React, { useEffect, useLayoutEffect, useState } from "react";
import { Cell, DefaultTooltipContent, Pie, PieChart, ResponsiveContainer, Tooltip, type TooltipContentProps, type TooltipProps } from "recharts";

export const chartTooltipStyle = {
  background: "var(--color-surface-raised)",
  border: "1px solid var(--color-hairline-light)",
  borderRadius: 14,
  color: "var(--color-ink)",
};

export const chartToneColors = {
  success: "var(--color-accent-strong)",
  primary: "var(--color-ink)",
  secondary: "var(--color-shade-50)",
  warning: "var(--color-chart-warning)",
};

export function useChartAnimation() {
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setAnimate(!preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  return animate;
}

export function ChartDonut({ data, center, onSelect }: {
  data: Array<{ label: string; value: number; color: string; description?: string }>;
  center: React.ReactNode;
  onSelect?: (index: number) => void;
}) {
  const animate = useChartAnimation();
  const anchor = React.useRef<HTMLDivElement>(null);
  const empty = !data.some(({ value }) => value > 0);
  const slices = empty
    ? [{ label: "No data", value: 1, color: "var(--color-hairline-light)", description: "No data" }]
    : data;
  return (
    <>
      <div className="chart-donut-plot" ref={anchor}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 180, height: 180 }}>
          <PieChart accessibilityLayer={false}>
            <Pie data={slices} dataKey="value" nameKey="label" innerRadius="66%" outerRadius="96%"
              startAngle={90} endAngle={-270} stroke="none"
              isAnimationActive={animate} animationDuration={350}
              onClick={(_, index) => { if (!empty) onSelect?.(index); }}>
              {slices.map((slice, index) => <Cell key={`${slice.label}-${index}`} fill={slice.color} />)}
            </Pie>
            {!empty && <ChartTooltip anchor={anchor}
              formatter={(value, _, item) => item.payload.description ?? value} />}
          </PieChart>
        </ResponsiveContainer>
      </div>
      {center}
    </>
  );
}

type TooltipValue = number | string | ReadonlyArray<number | string>;
type ChartTooltipProps = TooltipProps<TooltipValue, number | string> & {
  anchor: React.RefObject<HTMLDivElement>;
};

export function ChartTooltip({ anchor, content, ...props }: ChartTooltipProps) {
  return <Tooltip {...props} contentStyle={chartTooltipStyle} itemStyle={{ color: "var(--color-ink)" }}
    portal={typeof document === "undefined" ? undefined : document.body}
    wrapperStyle={{ position: "fixed", left: 0, top: 0, zIndex: 100, pointerEvents: "none" }}
    content={(value) => <FloatingContent anchor={anchor} value={value} content={content} />} />;
}

function FloatingContent({ anchor, value, content }: {
  anchor: React.RefObject<HTMLDivElement>;
  value: TooltipContentProps<TooltipValue, number | string>;
  content: ChartTooltipProps["content"];
}) {
  const [, refresh] = useState(0);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    setHeight(contentRef.current?.getBoundingClientRect().height ?? 0);
  }, [value.active, value.payload]);
  useEffect(() => {
    if (!value.active) return;
    const update = () => refresh((current) => current + 1);
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update, true); window.removeEventListener("resize", update); };
  }, [value.active]);
  if (!value.active || !value.payload?.length || !anchor.current) return null;
  const bounds = anchor.current.getBoundingClientRect();
  const width = Math.min(300, window.innerWidth - 24);
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, bounds.left + (value.coordinate?.x ?? 0) + 12));
  const top = Math.max(12, Math.min(window.innerHeight - height - 12, bounds.top + (value.coordinate?.y ?? 0) + 12));
  return <div ref={contentRef} style={{ width, overflowWrap: "anywhere", transform: `translate(${left}px, ${top}px)` }}>
    {typeof content === "function" ? content(value) : content ?? <DefaultTooltipContent {...value} />}
  </div>;
}
