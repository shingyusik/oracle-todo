import React from "react";

import type { DashboardDestination } from "@/features/dashboard/model/dashboard-navigation";
import type { DashboardChartSpec } from "@/features/dashboard/model/dashboard-widgets";
import { DashboardDonutChart } from "@/features/dashboard/ui/DashboardDonutChart";
import { DashboardLineChart } from "@/features/dashboard/ui/DashboardLineChart";
import {
  DashboardStatusDonutGrid,
  type DashboardStatusVisibility,
} from "@/features/dashboard/ui/DashboardStatusDonutGrid";

type DashboardChartProps = {
  chart: DashboardChartSpec;
  onNavigate: (destination: DashboardDestination) => void;
  statusVisibility?: DashboardStatusVisibility;
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
    case "status":
      return (
        <DashboardStatusDonutGrid
          chart={props.chart}
          onNavigate={props.onNavigate}
          visibility={props.statusVisibility}
        />
      );
  }
}
