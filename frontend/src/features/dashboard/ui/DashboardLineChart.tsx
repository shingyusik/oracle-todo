import React from "react";

import type { LineChartSpec } from "@/features/dashboard/model/dashboard-widgets";

type DashboardLineChartProps = {
  chart: LineChartSpec;
  scale?: "automatic" | "percentage";
  domain?: { minimum: number; maximum: number };
  valueSuffix?: string;
  referenceBand?: { minimum: number; maximum: number; label: string };
};

export function DashboardLineChart({
  chart,
  scale = "automatic",
  domain,
  valueSuffix = "",
  referenceBand,
}: DashboardLineChartProps) {
  const explicitDomain = domain && Number.isFinite(domain.minimum)
    && Number.isFinite(domain.maximum) && domain.maximum > domain.minimum
    ? domain
    : undefined;
  const minimum = explicitDomain?.minimum ?? 0;
  const maximum = explicitDomain?.maximum ?? (scale === "percentage"
    ? 100
    : Math.max(1, referenceBand?.maximum ?? 0, ...chart.points.map((point) => point.value)));
  const range = maximum - minimum;
  const coordinates = chart.points.map((point, index) => ({
    ...point,
    x:
      chart.points.length === 1
        ? 50
        : (index / (chart.points.length - 1)) * 100,
    y: 94 - ((point.value - minimum) / range) * 84,
  }));
  const maximumXAxisTicks = 7;
  const xTicks = coordinates.length <= maximumXAxisTicks
    ? coordinates
    : Array.from(
      { length: maximumXAxisTicks },
      (_, index) => coordinates[Math.round(
        index * (coordinates.length - 1) / (maximumXAxisTicks - 1),
      )],
    );
  const yTickStep = Math.max(1, Math.ceil(maximum / 4));
  const yTicks = explicitDomain
    ? Array.from({ length: 5 }, (_, index) => maximum - (range * index) / 4)
    : scale === "percentage"
    ? [100, 75, 50, 25, 0]
    : [
      ...Array.from(
        { length: Math.ceil(maximum / yTickStep) },
        (_, index) => index * yTickStep,
      ),
      maximum,
    ].filter((tick, index, ticks) => ticks.indexOf(tick) === index).reverse();

  return (
    <div
      className="dashboard-chart dashboard-chart-line"
      role="group"
      aria-label={chart.ariaLabel}
    >
      <div className="dashboard-line-frame">
        <div className="dashboard-line-y-axis" aria-hidden="true">
          {yTicks.map((tick) => (
            <span
              key={tick}
              className="dashboard-line-y-tick"
              style={{ top: `${94 - ((tick - minimum) / range) * 84}%` }}
            >
              {Number.isInteger(tick) ? tick : Number(tick.toFixed(2))}
              {scale === "percentage" ? "%" : valueSuffix}
            </span>
          ))}
        </div>
        <div className="dashboard-line-plot">
          {referenceBand && (
            <div
              className="dashboard-line-reference-band"
              aria-hidden="true"
              style={{
                top: `${94 - ((referenceBand.maximum - minimum) / range) * 84}%`,
                height: `${((referenceBand.maximum - referenceBand.minimum) / range) * 84}%`,
              }}
            >
              <span>{referenceBand.label}</span>
            </div>
          )}
          <svg
            className="dashboard-line-svg"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polyline
              className="dashboard-line-path"
              points={coordinates
                .map((point) => `${point.x},${point.y}`)
                .join(" ")}
            />
          </svg>
          {coordinates.map((point) => (
            <span
              key={point.id}
              className="dashboard-line-point"
              role="img"
              tabIndex={0}
              aria-label={point.ariaLabel}
              style={{ left: `${point.x}%`, top: `${point.y}%` }}
            >
              <span className="dashboard-line-marker" aria-hidden="true" />
              <span className="dashboard-line-tooltip">
                {point.ariaLabel}
              </span>
            </span>
          ))}
        </div>
        <div className="dashboard-line-x-axis" aria-hidden="true">
          {xTicks.map((tick, index) => (
            <time
              key={tick.id}
              className="dashboard-line-x-tick"
              dateTime={tick.label}
              data-edge={
                index === 0
                  ? "start"
                  : index === xTicks.length - 1
                    ? "end"
                    : undefined
              }
              style={{ left: `${tick.x}%` }}
            >
              {tick.label}
            </time>
          ))}
        </div>
      </div>
    </div>
  );
}
