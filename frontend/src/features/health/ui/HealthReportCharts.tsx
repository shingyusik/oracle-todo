"use client";

import React, { useState } from "react";

import type { LineChartSpec } from "@/features/dashboard/model/dashboard-widgets";
import { DashboardLineChart } from "@/features/dashboard/ui/DashboardLineChart";
import type {
  HealthReport,
  HealthReportDrilldown,
  HealthReportMetric,
  HealthReportMetricSummary,
} from "@/features/health/model/health-reports";

type Drilldown = (target: HealthReportDrilldown) => void;
type Range = HealthReportDrilldown["range"];

const metrics = [
  { metric: "body_weight", label: "Weight", field: "weight" },
  { metric: "sleep_duration", label: "Sleep", field: "sleep" },
  { metric: "crp", label: "CRP", field: "crp" },
  { metric: "fecal_calprotectin", label: "Calprotectin", field: "calprotectin" },
  { metric: "overall_condition", label: "Condition", field: "condition" },
] as const satisfies ReadonlyArray<{
  metric: HealthReportMetric;
  label: string;
  field: "weight" | "sleep" | "crp" | "calprotectin" | "condition";
}>;

export function HealthReportAnalysis({
  report,
  onDrilldown,
}: {
  report: HealthReport;
  onDrilldown?: Drilldown;
}) {
  const range = { start: report.range.from, end: report.range.to };
  return (
    <>
      {!hasUsableData(report) && (
        <p className="items-message">No health records are available for this period.</p>
      )}
      <Summary report={report} range={range} onDrilldown={onDrilldown} />
      <div className="health-report-chart-grid">
        <BowelChart report={report} range={range} onDrilldown={onDrilldown} />
        <MetricChart report={report} range={range} onDrilldown={onDrilldown} />
      </div>
      <div className="health-report-list-grid">
        <FrequencyList
          heading="Medication frequency"
          empty="No medication records are available for this period."
          rows={report.medicationFrequencies}
          onSelect={onDrilldown && ((name) => onDrilldown({
            tab: "medication", field: "medication_name", value: name, range,
          }))}
        />
        <FrequencyList
          heading="Diet tag frequency"
          empty="No diet tags are available for this period."
          rows={report.dietTagFrequencies}
          onSelect={onDrilldown && ((name) => onDrilldown({
            tab: "diet", field: "tags", value: name, range,
          }))}
        />
      </div>
      <DietTagResponses report={report} range={range} onDrilldown={onDrilldown} />
    </>
  );
}

function Summary({
  report,
  range,
  onDrilldown,
}: {
  report: HealthReport;
  range: Range;
  onDrilldown?: Drilldown;
}) {
  const metricCards = metrics.map((definition) => ({
    label: definition.label,
    summary: report.metrics.find(({ metric }) => metric === definition.metric) ?? null,
    target: { tab: "health-metrics", field: definition.field, range } as const,
  }));
  const aggregateCards = [
    {
      label: "Diet count",
      current: report.dietCount.current,
      previous: report.dietCount.previous,
      target: { tab: "diet", range } as const,
    },
    {
      label: "Bowel count",
      current: report.bowel.currentCount,
      previous: report.bowel.previousCount,
      target: { tab: "bowel", range } as const,
    },
    {
      label: "Bowel average",
      current: report.bowel.currentAverage,
      previous: report.bowel.previousAverage,
      target: { tab: "bowel", range } as const,
    },
    {
      label: "Medication count",
      current: report.medicationCount.current,
      previous: report.medicationCount.previous,
      target: { tab: "medication", range } as const,
    },
  ];
  return (
    <section className="health-report-section" aria-label="Summary">
      <h2>Summary</h2>
      <div className="health-report-summary health-report-summary-metrics">
        {metricCards.map(({ label, summary, target }) => (
          <ReportCard
            key={label}
            label={label}
            onClick={onDrilldown && (() => onDrilldown(target))}
          >
            <MetricComparison summary={summary} />
          </ReportCard>
        ))}
      </div>
      <div className="health-report-summary health-report-summary-counts">
        {aggregateCards.map(({ label, current, previous, target }) => (
          <ReportCard
            key={label}
            label={label}
            onClick={onDrilldown && (() => onDrilldown(target))}
          >
            <NumberComparison current={current} previous={previous} />
          </ReportCard>
        ))}
      </div>
    </section>
  );
}

function ReportCard({
  label,
  onClick,
  children,
}: React.PropsWithChildren<{ label: string; onClick?: () => void }>) {
  const content = <><span>{label}</span>{children}</>;
  return onClick ? (
    <button
      type="button"
      className="health-report-card"
      aria-label={`View ${label} records for selected period`}
      data-report-card={label}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <div className="health-report-card" role="group" aria-label={label} data-report-card={label}>
      {content}
    </div>
  );
}

function MetricComparison({ summary }: { summary: HealthReportMetricSummary | null }) {
  const current = summary?.current;
  const previous = summary?.previous;
  if (!current) return <><strong>Unavailable</strong><small>Previous Unavailable</small></>;
  const unit = summary?.unit ? ` ${summary.unit}` : "";
  return (
    <>
      <strong>{number(current.value)}{unit}</strong>
      <small>{current.localDate}</small>
      <small>
        Previous {previous ? `${number(previous.value)}${unit} · ${signed(current.value - previous.value)}${unit}` : "Unavailable"}
      </small>
    </>
  );
}

function NumberComparison({
  current,
  previous,
}: {
  current: number | null;
  previous: number | null;
}) {
  return (
    <>
      <strong>{current === null ? "Unavailable" : number(current)}</strong>
      <small>
        Previous {previous === null ? "Unavailable" : number(previous)}
        {current !== null && previous !== null ? ` · ${signed(current - previous)}` : ""}
      </small>
    </>
  );
}

function BowelChart({
  report,
  range,
  onDrilldown,
}: {
  report: HealthReport;
  range: Range;
  onDrilldown?: Drilldown;
}) {
  const points = [...report.bowelPoints]
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
    .map((point, index) => ({
      id: `${point.occurredAt}-${index}`,
      label: point.localDate,
      value: point.bristolScale,
      ariaLabel: `${dateTime(point.occurredAt)}: Bristol ${point.bristolScale}`,
    }));
  return (
    <section className="health-report-section" aria-label="Bowel Bristol scale">
      <div className="health-report-section-heading">
        <h2>Bowel Bristol scale</h2>
        {onDrilldown && (
          <button
            type="button"
            onClick={() => onDrilldown({ tab: "bowel", field: "bristol_scale", range })}
          >
            View abnormal bowel records
          </button>
        )}
      </div>
      {points.length === 0 ? (
        <p className="items-message">No bowel Bristol readings are available for this period.</p>
      ) : (
        <DashboardLineChart
          chart={{
            kind: "line",
            ariaLabel: "Bowel Bristol scale. Typical Bristol band 3 to 5",
            total: points.length,
            points,
          }}
          referenceBand={{ minimum: 3, maximum: 5, label: "Typical Bristol 3 to 5" }}
        />
      )}
    </section>
  );
}

function MetricChart({
  report,
  range,
  onDrilldown,
}: {
  report: HealthReport;
  range: Range;
  onDrilldown?: Drilldown;
}) {
  const [selected, setSelected] = useState<HealthReportMetric>(() => defaultMetric(report));
  const definition = metrics.find(({ metric }) => metric === selected) ?? metrics[0];
  const summary = report.metrics.find(({ metric }) => metric === selected);
  const series = report.metricSeries.find(({ metric }) => metric === selected);
  const label = `${definition.label}${summary?.unit ? ` (${summary.unit})` : ""}`;
  const points: LineChartSpec["points"] = (series?.points ?? []).map((point, index) => ({
    id: `${selected}-${point.occurredAt}-${index}`,
    label: point.localDate,
    value: point.value,
    ariaLabel: `${dateTime(point.occurredAt)}: ${number(point.value)}${summary?.unit ? ` ${summary.unit}` : ""}`,
  }));
  return (
    <section className="health-report-section" aria-label="Health metric">
      <div className="health-report-section-heading">
        <h2>Health metric</h2>
        <label>
          Metric
          <select value={selected} onChange={(event) => setSelected(event.target.value as HealthReportMetric)}>
            {metrics.map((metric) => <option key={metric.metric} value={metric.metric}>{metric.label}</option>)}
          </select>
        </label>
      </div>
      {points.length === 0 ? (
        <p className="items-message">No {definition.label.toLowerCase()} readings are available for this period.</p>
      ) : (
        <DashboardLineChart chart={{ kind: "line", ariaLabel: label, total: points.length, points }} />
      )}
      {onDrilldown && (
        <button
          type="button"
          className="health-report-chart-action"
          onClick={() => onDrilldown({
            tab: "health-metrics", field: definition.field, range,
          })}
        >
          View {definition.label.toLowerCase()} records
        </button>
      )}
    </section>
  );
}

function FrequencyList({
  heading,
  empty,
  rows,
  onSelect,
}: {
  heading: string;
  empty: string;
  rows: HealthReport["medicationFrequencies"];
  onSelect?: (name: string) => void;
}) {
  const maximum = Math.max(1, ...rows.map(({ count }) => count));
  return (
    <section className="health-report-section" aria-label={heading}>
      <h2>{heading}</h2>
      {rows.length === 0 ? <p className="items-message">{empty}</p> : (
        <ul className="health-report-frequency-list">
          {rows.map((row) => {
            const content = (
              <>
                <span className="health-report-frequency-bar" style={{ "--health-report-bar": row.count / maximum } as React.CSSProperties} aria-hidden="true" />
                <span>{row.name}</span><strong>{row.count}</strong>
              </>
            );
            return (
              <li key={row.name}>
                {onSelect ? (
                  <button type="button" aria-label={`${row.name}, ${row.count} records`} onClick={() => onSelect(row.name)}>{content}</button>
                ) : <div aria-label={`${row.name}, ${row.count} records`}>{content}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function DietTagResponses({
  report,
  range,
  onDrilldown,
}: {
  report: HealthReport;
  range: Range;
  onDrilldown?: Drilldown;
}) {
  return (
    <section className="health-report-section" aria-label="Diet-tag bowel response">
      <h2>Diet-tag bowel response</h2>
      <p>{report.reactionDisclaimer}</p>
      {report.dietTagBowelResponses.length === 0 ? (
        <p className="items-message">No diet-tag bowel response data are available for this period.</p>
      ) : (
        <ul className="health-report-response-list">
          {report.dietTagBowelResponses.map((row) => {
            const text = `${row.positiveMeals} / ${row.eligibleMeals} (${Math.round(row.rate * 100)}%)`;
            const content = <><span>{row.tag}</span><strong>{text}</strong></>;
            return (
              <li key={row.tag}>
                {onDrilldown ? (
                  <button
                    type="button"
                    aria-label={`${row.tag}, ${text}`}
                    onClick={() => onDrilldown({ tab: "diet", field: "tags", value: row.tag, range })}
                  >{content}</button>
                ) : <div aria-label={`${row.tag}, ${text}`}>{content}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function defaultMetric(report: HealthReport): HealthReportMetric {
  return metrics.find(({ metric }) =>
    report.metricSeries.find((series) => series.metric === metric)?.points.length,
  )?.metric ?? "body_weight";
}

function hasUsableData(report: HealthReport): boolean {
  return report.metrics.some(({ current }) => current !== null)
    || (report.dietCount.current ?? 0) > 0
    || (report.bowel.currentCount ?? 0) > 0
    || report.bowel.currentAverage !== null
    || (report.medicationCount.current ?? 0) > 0
    || report.bowelPoints.length > 0
    || report.metricSeries.some(({ points }) => points.length > 0)
    || report.medicationFrequencies.length > 0
    || report.dietTagFrequencies.length > 0
    || report.dietTagBowelResponses.length > 0;
}

function number(value: number): string {
  return Object.is(value, -0) ? "0" : value.toString();
}

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${number(value)}`;
}

function dateTime(value: string): string {
  return new Date(value).toLocaleString();
}
