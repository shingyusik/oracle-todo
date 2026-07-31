import React from "react";

import type {
  UnifiedDashboardModel,
} from "@/features/dashboard/model/dashboard-model";

export function RecentActivityCard({
  activity,
}: {
  activity: UnifiedDashboardModel["recentActivity"];
}) {
  return (
    <section className="dashboard-widget" aria-label="Recent activity">
      <header className="dashboard-widget-header">
        <div className="dashboard-widget-heading">
          <h2>Recent activity</h2>
          <p>Latest changes across ToDo, Ledger, and Health Journal.</p>
        </div>
      </header>
      {activity.length === 0 ? (
        <p className="dashboard-widget-empty">No recent activity.</p>
      ) : (
        <ol>
          {activity.map((item) => (
            <li
              key={`${item.domain}-${item.recordId}-${item.timestamp}-${item.action}`}
            >
              <strong>{item.domainLabel}</strong>
              {" · "}
              {item.action}
              {" · "}
              <time dateTime={item.timestamp}>{item.timestamp}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
