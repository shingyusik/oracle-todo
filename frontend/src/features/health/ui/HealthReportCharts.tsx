"use client";

import React, { useState } from "react";

import type { LineChartSpec } from "@/features/dashboard/model/dashboard-widgets";
import { DashboardLineChart } from "@/features/dashboard/ui/DashboardLineChart";
import type {
  HealthReport,
  HealthReportAnalysis as ReportAnalysis,
  HealthReportDrilldown,
  HealthReportMetric,
} from "@/features/health/model/health-reports";
import { buildHealthReportAnalysis } from "@/features/health/model/health-reports";

type Drilldown = (target: HealthReportDrilldown) => void;
type Range = HealthReportDrilldown["range"];

const supportingMetricDefinitions = [
  { metric: "sleep_duration", label: "Sleep", field: "sleep" },
  { metric: "crp", label: "CRP", field: "crp" },
  { metric: "fecal_calprotectin", label: "Calprotectin", field: "calprotectin" },
  { metric: "overall_condition", label: "Condition", field: "condition" },
] as const satisfies ReadonlyArray<{
  metric: Exclude<HealthReportMetric, "body_weight">;
  label: string;
  field: "sleep" | "crp" | "calprotectin" | "condition";
}>;

type SupportingMetric = typeof supportingMetricDefinitions[number]["metric"];

export function HealthReportAnalysis({
  report,
  onDrilldown,
}: {
  report: HealthReport;
  onDrilldown?: Drilldown;
}) {
  const range = { start: report.range.from, end: report.range.to };
  const analysis = buildHealthReportAnalysis(report);
  return (
    <>
      {!hasUsableData(report) && (
        <p className="items-message">No health records are available for this period.</p>
      )}
      <Summary analysis={analysis} range={range} onDrilldown={onDrilldown} />
      <div className="health-report-primary-grid">
        <BowelChart analysis={analysis} range={range} onDrilldown={onDrilldown} />
        <WeightChart analysis={analysis} range={range} onDrilldown={onDrilldown} />
      </div>
      <MetricChart analysis={analysis} range={range} onDrilldown={onDrilldown} />
      <div className="health-report-list-grid">
        <FrequencyList
          heading="Medication frequency"
          empty="No medication records are available for this period."
          coverage={report.medicationCount.current}
          rows={report.medicationFrequencies}
          onSelect={onDrilldown && ((name) => onDrilldown({
            tab: "medication", field: "medication_name", value: name, range,
          }))}
        />
        <FrequencyList
          heading="Diet tag frequency"
          empty="No diet tags are available for this period."
          coverage={report.dietCount.current}
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
  analysis,
  range,
  onDrilldown,
}: {
  analysis: ReportAnalysis;
  range: Range;
  onDrilldown?: Drilldown;
}) {
  const bowelDrilldown = () => onDrilldown?.({ tab: "bowel", range });
  const weightDrilldown = () => onDrilldown?.({
    tab: "health-metrics", field: "weight", range,
  });
  const latestBowelValue = analysis.latestDailyBowel
    ? bristolAverage(analysis.latestDailyBowel.value) : "Unavailable";
  const latestBowelContext = analysis.latestDailyBowel
    ? `${analysis.latestDailyBowel.localDate}, ${recordCount(analysis.latestDailyBowel.recordCount)}`
    : "No records in selected period";
  const latestWeightValue = analysis.latestWeight
    ? `${number(analysis.latestWeight.value)} kg` : "Unavailable";
  const latestWeightContext = analysis.latestWeight?.localDate ?? "No records in selected period";
  const weightChangeValue = analysis.weightChange === null
    ? "No comparison available" : `${signed(analysis.weightChange)} kg`;
  const weightChangeContext = "First to latest record in selected period";
  return (
    <section className="health-report-section" aria-label="Summary">
      <h2>Summary</h2>
      <div className="health-report-primary-summary">
        <ReportCard
          label="Latest daily Bristol average"
          onClick={onDrilldown && bowelDrilldown}
          ariaLabel={`Latest daily Bristol average: ${latestBowelValue}, ${latestBowelContext}`}
        >
          <strong>{latestBowelValue}</strong>
          <small>{analysis.latestDailyBowel ? `${analysis.latestDailyBowel.localDate} · ${recordCount(analysis.latestDailyBowel.recordCount)}` : latestBowelContext}</small>
        </ReportCard>
        <ReportCard
          label="Latest weight"
          onClick={onDrilldown && weightDrilldown}
          ariaLabel={`Latest weight: ${latestWeightValue}, ${latestWeightContext}`}
        >
          <strong>{latestWeightValue}</strong>
          <small>{latestWeightContext}</small>
        </ReportCard>
        <ReportCard
          label="Weight change"
          onClick={onDrilldown && weightDrilldown}
          ariaLabel={`Weight change: ${weightChangeValue}, ${weightChangeContext}`}
        >
          <strong>{weightChangeValue}</strong>
          <small>{weightChangeContext}</small>
        </ReportCard>
      </div>
    </section>
  );
}

function ReportCard({
  label,
  onClick,
  ariaLabel,
  children,
}: React.PropsWithChildren<{ label: string; onClick?: () => void; ariaLabel?: string }>) {
  const content = <><span>{label}</span>{children}</>;
  return onClick ? (
    <button
      type="button"
      className="health-report-card"
      aria-label={ariaLabel}
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

function BowelChart({
  analysis,
  range,
  onDrilldown,
}: {
  analysis: ReportAnalysis;
  range: Range;
  onDrilldown?: Drilldown;
}) {
  const points = analysis.dailyBowelPoints.map((point) => ({
    id: point.localDate,
    label: point.localDate,
    value: point.value,
    ariaLabel: `${point.localDate}: Average Bristol ${bristolAverage(point.value)} from ${recordCount(point.recordCount)}`,
  }));
  return (
    <section className="health-report-section" aria-label="Daily average Bristol score">
      <div className="health-report-section-heading">
        <h2>Daily average Bristol score</h2>
        {onDrilldown && (
          <button
            type="button"
            onClick={() => onDrilldown({ tab: "bowel", range })}
          >
            View bowel records
          </button>
        )}
      </div>
      {points.length === 0 ? (
        <p className="items-message">No bowel Bristol readings are available for this period.</p>
      ) : (
        <DashboardLineChart
          chart={{
            kind: "line",
            ariaLabel: "Daily average Bristol score. Typical Bristol band 3 to 5",
            total: points.length,
            points,
          }}
          domain={{ minimum: 1, maximum: 7 }}
          referenceBand={{ minimum: 3, maximum: 5, label: "Typical Bristol 3 to 5" }}
        />
      )}
    </section>
  );
}

function WeightChart({
  analysis,
  range,
  onDrilldown,
}: {
  analysis: ReportAnalysis;
  range: Range;
  onDrilldown?: Drilldown;
}) {
  const points = analysis.weightPoints.map((point, index) => ({
    id: `${point.occurredAt}-${index}`,
    label: point.localDate,
    value: point.value,
    ariaLabel: `${point.localDate}: Weight ${number(point.value)} kg`,
  }));
  const values = analysis.weightPoints.map(({ value }) => value);
  const domain = values.length === 0 ? undefined : {
    minimum: Math.floor(Math.min(...values) - 1),
    maximum: Math.ceil(Math.max(...values) + 1),
  };
  return (
    <section className="health-report-section" aria-label="Weight trend">
      <div className="health-report-section-heading">
        <h2>Weight trend</h2>
        {analysis.weightPoints.length > 0 && (
          <small>First {number(analysis.weightPoints[0]!.value)} kg · Latest {number(analysis.latestWeight!.value)} kg</small>
        )}
      </div>
      {points.length === 0 ? (
        <p className="items-message">No weight readings are available for this period.</p>
      ) : (
        <DashboardLineChart
          chart={{ kind: "line", ariaLabel: "Weight trend (kg)", total: points.length, points }}
          domain={domain}
          valueSuffix=" kg"
        />
      )}
      {onDrilldown && (
        <button
          type="button"
          className="health-report-chart-action"
          onClick={() => onDrilldown({ tab: "health-metrics", field: "weight", range })}
        >
          View weight records
        </button>
      )}
    </section>
  );
}

function MetricChart({
  analysis,
  range,
  onDrilldown,
}: {
  analysis: ReportAnalysis;
  range: Range;
  onDrilldown?: Drilldown;
}) {
  const [selected, setSelected] = useState<SupportingMetric>(() => defaultSupportingMetric(analysis));
  const selectedMetric = analysis.supportingMetrics.find(({ metric }) => metric === selected);
  const definition = supportingMetricDefinitions.find(({ metric }) => metric === selected)
    ?? supportingMetricDefinitions[0];

  const name = selectedMetric?.name ?? definition.label;
  const unit = selectedMetric?.unit ?? null;
  const label = `${name}${unit ? ` (${unit})` : ""}`;
  const points: LineChartSpec["points"] = (selectedMetric?.points ?? []).map((point, index) => ({
    id: `${selected}-${point.occurredAt}-${index}`,
    label: point.localDate,
    value: point.value,
    ariaLabel: `${dateTime(point.occurredAt)}: ${number(point.value)}${unit ? ` ${unit}` : ""}`,
  }));
  return (
    <section className="health-report-section" aria-label="Other health metrics">
      <div className="health-report-section-heading">
        <h2>Other health metrics</h2>
        <div className="health-report-metric-controls" role="group" aria-label="Other health metrics">
          {supportingMetricDefinitions.map((metric) => (
            <button
              key={metric.metric}
              type="button"
              aria-pressed={selected === metric.metric}
              onClick={() => setSelected(metric.metric)}
            >
              {metric.label}
            </button>
          ))}
        </div>
      </div>
      {points.length === 0 ? (
        <p className="items-message">No {name} readings are available for this period.</p>
      ) : (
        <>
          <div className="health-report-metric-summary">
            <strong>Latest: {number(selectedMetric!.latest!.value)}{unit ? ` ${unit}` : ""}</strong>
            <small>{selectedMetric!.change === null
              ? "No previous reading"
              : `Change: ${signed(selectedMetric!.change)}${unit ? ` ${unit}` : ""}`}</small>
          </div>
          <DashboardLineChart
            chart={{ kind: "line", ariaLabel: label, total: points.length, points }}
            valueSuffix={unit ? ` ${unit}` : undefined}
          />
        </>
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
  coverage,
  rows,
  onSelect,
}: {
  heading: string;
  empty: string;
  coverage: number | null;
  rows: HealthReport["medicationFrequencies"];
  onSelect?: (name: string) => void;
}) {
  const maximum = Math.max(1, ...rows.map(({ count }) => count));
  return (
    <section className="health-report-section" aria-label={heading}>
      <h2>{heading}</h2>
      <p className="health-report-coverage">{coverage === null ? "Unavailable" : `${recordCount(coverage)} in selected period`}</p>
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
                  <button type="button" aria-label={`${row.name}, ${recordCount(row.count)}`} onClick={() => onSelect(row.name)}>{content}</button>
                ) : <div aria-label={`${row.name}, ${recordCount(row.count)}`}>{content}</div>}
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
            const text = `${row.positiveMeals} / ${row.eligibleMeals}, ${Math.round(row.rate * 100)}%`;
            const content = <>
              <span
                className="health-report-frequency-bar health-report-response-bar"
                style={{ "--health-report-bar": row.rate } as React.CSSProperties}
                aria-hidden="true"
              />
              <span>{row.tag}</span><strong>{text}</strong>
            </>;
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

function defaultSupportingMetric(analysis: ReportAnalysis): SupportingMetric {
  return supportingMetricDefinitions.find(({ metric }) =>
    analysis.supportingMetrics.find((item) => item.metric === metric)?.points.length,
  )?.metric ?? supportingMetricDefinitions[0].metric;
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
  const rounded = Number(value.toPrecision(12));
  return `${rounded > 0 ? "+" : ""}${number(rounded)}`;
}

function recordCount(value: number): string {
  return `${value} record${value === 1 ? "" : "s"}`;
}

function bristolAverage(value: number): string {
  return number(Number(value.toFixed(1)));
}

function dateTime(value: string): string {
  return new Date(value).toLocaleString();
}
