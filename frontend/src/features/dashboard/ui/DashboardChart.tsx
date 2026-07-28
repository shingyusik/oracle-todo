import React from "react";

import type { DashboardDestination } from "@/features/dashboard/model/dashboard-navigation";
import type { DashboardChartSpec } from "@/features/dashboard/model/dashboard-widgets";
import { DashboardDonutChart } from "@/features/dashboard/ui/DashboardDonutChart";
import { DashboardHeatmap } from "@/features/dashboard/ui/DashboardHeatmap";
import { DashboardLineChart } from "@/features/dashboard/ui/DashboardLineChart";

type DashboardChartProps = {
  chart: DashboardChartSpec;
  onNavigate: (destination: DashboardDestination) => void;
};

export function DashboardChart(props: DashboardChartProps) {
  switch (props.chart.kind) {
    case "donut":
      return (
        <DashboardDonutChart
          chart={props.chart}
          onNavigate={props.onNavigate}
        />
      );
    case "line":
      return <DashboardLineChart chart={props.chart} />;
    case "heatmap":
      return (
        <DashboardHeatmap
          chart={props.chart}
          onNavigate={props.onNavigate}
        />
      );
  }
}
