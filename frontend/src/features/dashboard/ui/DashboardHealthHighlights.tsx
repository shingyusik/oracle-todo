"use client";

import React from "react";

import { healthApi } from "@/features/health/api/health-api";
import { resolveHealthReportRange, type HealthReport } from "@/features/health/model/health-reports";
import { HealthReportHighlights } from "@/features/health/ui/HealthReportCharts";

export function DashboardHealthHighlights({ mutationEpoch = 0, onNavigate }: {
  mutationEpoch?: number;
  onNavigate: () => void;
}) {
  const [preset, setPreset] = React.useState<7 | 14 | 30>(14);
  const [data, setData] = React.useState<HealthReport | null>(null);
  const [status, setStatus] = React.useState<"loading" | "loaded" | "error">("loading");
  const [retry, setRetry] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    setStatus("loading");
    const now = new Date();
    const load = (days: 7 | 14 | 30) => {
      const result = resolveHealthReportRange({ preset: days }, now);
      if (!result.ok) throw new Error("Invalid health highlight period");
      return healthApi.reports({ from: result.range.start, to: result.range.end });
    };
    void load(preset).then((report) => {
      if (!active) return;
      setData(report);
      setStatus("loaded");
    }).catch(() => {
      if (active) setStatus("error");
    });
    return () => { active = false; };
  }, [preset, mutationEpoch, retry]);

  return <section className="dashboard-health" aria-label="Health Journal highlights">
    <header className="dashboard-ledger-header">
      <h2><button type="button" onClick={onNavigate}>Health Journal highlights</button></h2>
      <div className="dashboard-ledger-period" role="group" aria-label="Health trend period">
        {([7, 14, 30] as const).map((days) => <button
          key={days}
          type="button"
          aria-label={`Health trends: ${days} days`}
          aria-pressed={preset === days}
          onClick={() => setPreset(days)}
        >{days} days</button>)}
      </div>
    </header>
    <div aria-busy={status === "loading"}>
      {status === "loading" ? <p role="status">Loading Health Journal highlights…</p>
        : status === "error" ? <div>
          <p role="alert">Could not load Health Journal highlights.</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry Health highlights</button>
        </div>
        : data && <HealthReportHighlights report={data} />}
    </div>
  </section>;
}
