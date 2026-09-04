"use client";

import React, { useEffect, useRef, useState } from "react";

import type { HealthController } from "@/features/health/hooks/useHealthController";
import {
  resolveHealthReportRange,
  type HealthReportDrilldown,
  type HealthReportSelection,
} from "@/features/health/model/health-reports";
import { HealthReportAnalysis } from "@/features/health/ui/HealthReportCharts";

const presets = [7, 14, 30, 90] as const;

export function HealthReports({
  controller,
  onDrilldown,
}: {
  controller: HealthController;
  onDrilldown?: (target: HealthReportDrilldown) => void;
}) {
  const defaultRequested = useRef(false);
  const [range, setRange] = useState(() => controller.state.reportSelection.preset === "custom"
    ? {
      from: controller.state.reportSelection.from,
      to: controller.state.reportSelection.to,
    }
    : { from: "", to: "" });
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [retryPending, setRetryPending] = useState(false);
  const [customOpen, setCustomOpen] = useState(
    () => controller.state.reportSelection.preset === "custom",
  );
  const { state } = controller;
  const loading = state.reportStatus === "loading";

  useEffect(() => {
    if (defaultRequested.current || state.reportStatus !== "idle") return;
    defaultRequested.current = true;
    void controller.runReports({ preset: 30 }).catch(() => undefined);
  }, [controller, state.reportStatus]);

  function request(selection: HealthReportSelection) {
    setRangeError(null);
    void controller.runReports(selection).catch(() => undefined);
  }

  function applyCustom() {
    const selection = { preset: "custom", ...range } as const;
    const resolved = resolveHealthReportRange(selection);
    if (!resolved.ok) {
      setRangeError({
        invalid_date: "Choose valid From and To dates.",
        invalid_order: "From date must start on or before To date.",
        range_too_long: "Report range must be 366 days or fewer.",
      }[resolved.error]);
      return;
    }
    request(selection);
  }

  async function retry() {
    if (retryPending || loading) return;
    setRetryPending(true);
    try {
      await controller.retryReports();
    } catch {
      // The controller owns the visible request error.
    } finally {
      setRetryPending(false);
    }
  }

  return (
    <section className="health-reports" aria-labelledby="health-reports-heading">
      <header className="workspace-table-header">
        <h1 id="health-reports-heading">Reports</h1>
      </header>
      <div className="health-report-period" aria-label="Health report period">
        <div className="health-report-presets">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-pressed={state.reportSelection.preset === preset}
              disabled={loading}
              onClick={() => {
                setCustomOpen(false);
                request({ preset });
              }}
            >
              {preset} days
            </button>
          ))}
          <button
            type="button"
            aria-pressed={customOpen}
            disabled={loading}
            onClick={() => setCustomOpen(true)}
          >
            Custom range
          </button>
        </div>
        {customOpen && (
          <form
            className="health-report-custom"
            aria-label="Custom health report range"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              applyCustom();
            }}
          >
            <label>
              From
              <input
                type="date"
                value={range.from}
                disabled={loading}
                onChange={(event) => {
                  setRangeError(null);
                  setRange((current) => ({ ...current, from: event.target.value }));
                }}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={range.to}
                disabled={loading}
                onChange={(event) => {
                  setRangeError(null);
                  setRange((current) => ({ ...current, to: event.target.value }));
                }}
              />
            </label>
            <button type="submit" disabled={loading}>Apply</button>
          </form>
        )}
      </div>
      {rangeError && <p role="alert" className="items-message health-report-error">{rangeError}</p>}
      {state.reportError && (
        <div className="items-message health-report-error">
          <p role="alert">{state.reportError}</p>
          <button type="button" disabled={loading || retryPending} onClick={() => void retry()}>
            Retry reports
          </button>
        </div>
      )}
      <div
        className="health-report-analysis"
        role="region"
        aria-label="Health report analysis"
        aria-busy={loading}
      >
        {state.report ? (
          <HealthReportAnalysis report={state.report} onDrilldown={onDrilldown} />
        ) : state.reportStatus === "error" ? null : (
          <p role="status" className="items-message">Loading reports…</p>
        )}
      </div>
    </section>
  );
}
