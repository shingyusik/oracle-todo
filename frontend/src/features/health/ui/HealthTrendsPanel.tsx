"use client";

import React, { useState } from "react";

import type { LineChartSpec } from "@/features/dashboard/model/dashboard-widgets";
import { DashboardLineChart } from "@/features/dashboard/ui/DashboardLineChart";
import type { HealthController } from "@/features/health/hooks/useHealthController";
import type {
  NamedCount,
  NumericSeries,
} from "@/features/health/model/health-model";

export function HealthTrendsPanel({
  controller,
}: {
  controller: HealthController;
}) {
  const [days, setDays] = useState("30");
  const { state } = controller;

  if (state.trendsStatus === "loading" && !state.trends) {
    return (
      <section>
        <h1>Trends</h1>
        <p role="status" className="items-message">Loading health trends…</p>
      </section>
    );
  }
  if (state.trendsStatus === "error" && !state.trends) {
    return (
      <section>
        <h1>Trends</h1>
        <p role="alert" className="items-message">
          {state.trendsError ?? "Health trends are unavailable"}
        </p>
        <button type="button" onClick={() => void controller.refreshTrends(Number(days))}>
          Retry trends
        </button>
      </section>
    );
  }

  const trends = state.trends;
  return (
    <section aria-labelledby="health-trends-heading">
      <header className="workspace-table-header">
        <h1 id="health-trends-heading">Trends</h1>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void controller.refreshTrends(Number(days));
        }}
      >
        <label className="field-label">
          Trend range
          <select value={days} onChange={(event) => setDays(event.target.value)}>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">365 days</option>
          </select>
        </label>
        <button type="submit">Refresh trends</button>
      </form>
      {state.trendsError && (
        <p role="alert" className="items-message">{state.trendsError}</p>
      )}
      {!trends ? (
        <p className="items-message">No trend data yet.</p>
      ) : (
        <>
          <TrendChart
            id="bowel-bristol-average"
            label="Bowel Bristol average"
            points={trends.bowelAverageByDay.map((point) => ({
              id: point.localDate,
              label: point.localDate,
              value: point.average,
              ariaLabel: `${point.localDate}: Bristol ${point.average}`,
            }))}
          />
          {trends.numericSeries.map((series) => (
            <NumericTrend key={`${series.category}:${series.metricKey}`} series={series} />
          ))}
          <CountTable heading="Symptoms" rows={trends.symptomFrequencies} />
          <CountTable heading="Medication" rows={trends.medicationFrequencies} />
          <CountTable heading="Top diet tags" rows={trends.topDietTags} />
          <section aria-labelledby="diet-reactions-heading">
            <h2 id="diet-reactions-heading">Possible diet reactions</h2>
            <p>
              Diet reaction counts are descriptive associations, not causal conclusions.
            </p>
            {trends.reactionDisclaimer && <p>{trends.reactionDisclaimer}</p>}
            {trends.possibleTagReactions.length === 0 ? (
              <p className="items-message">No possible tag reactions in this range.</p>
            ) : (
              <div className="items-section">
                <table className="items-table">
                  <thead>
                    <tr>
                      <th>Tag</th>
                      <th>Diet entries</th>
                      <th>Events within 24h</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trends.possibleTagReactions.map((reaction) => (
                      <tr key={reaction.tag}>
                        <td>{reaction.tag}</td>
                        <td>{reaction.dietEntries}</td>
                        <td>{reaction.eventsWithin24h}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}

function NumericTrend({ series }: { series: NumericSeries }) {
  const label = `${series.name}${series.unit ? ` (${series.unit})` : ""}`;
  return (
    <TrendChart
      id={`${series.category}-${series.metricKey}`}
      label={label}
      points={series.points.map((point) => ({
        id: point.occurredAt,
        label: point.occurredAt,
        value: point.value,
        ariaLabel: `${formatDate(point.occurredAt)}: ${point.value}${
          series.unit ? ` ${series.unit}` : ""
        }`,
      }))}
    />
  );
}

function TrendChart({
  id,
  label,
  points,
}: {
  id: string;
  label: string;
  points: LineChartSpec["points"];
}) {
  const headingId = `trend-${slug(id)}`;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>{label}</h2>
      {points.length === 0 ? (
        <p className="items-message">No {label.toLowerCase()} data.</p>
      ) : (
        <DashboardLineChart
          chart={{ kind: "line", ariaLabel: label, total: points.length, points }}
        />
      )}
    </section>
  );
}

function CountTable({ heading, rows }: { heading: string; rows: NamedCount[] }) {
  return (
    <section aria-labelledby={`trend-${slug(heading)}`}>
      <h2 id={`trend-${slug(heading)}`}>{heading}</h2>
      {rows.length === 0 ? (
        <p className="items-message">No {heading.toLowerCase()} data.</p>
      ) : (
        <div className="items-section">
          <table className="items-table">
            <thead>
              <tr><th>Name</th><th>Count</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name}><td>{row.name}</td><td>{row.count}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })
    .format(new Date(value));
}
