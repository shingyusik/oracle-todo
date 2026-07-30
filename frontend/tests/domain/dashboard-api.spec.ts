import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchDashboard } from "@/features/dashboard/api/dashboard-api";

afterEach(() => vi.unstubAllGlobals());

describe("Dashboard API boundary", () => {
  it("preserves independent domain success and error projections", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      request_id: "00000000-0000-4000-8000-000000000001",
      todo: { status: "ok", data: {
        active: 2, today_completed: 1, today_incomplete: 1,
        today_missed: 0, today_total: 2, overdue: 0,
      } },
      ledger: {
        status: "error",
        code: "domain_unavailable",
        message: "This data is currently unavailable.",
        request_id: "00000000-0000-4000-8000-000000000001",
      },
      health: { status: "ok", data: {
        latest_condition: null, latest_sleep: null, latest_bowel: null,
        latest_medication: null, recent_diet_tags: ["vegetable"],
      } },
      recent_activity: [{
        domain: "todo", action: "complete", record_id: "task-1",
        timestamp: "2026-07-31T01:00:00Z",
      }],
    }), { headers: { "content-type": "application/json" } })));

    const dashboard = await fetchDashboard();

    expect(dashboard.todo.status).toBe("ok");
    expect(dashboard.ledger).toMatchObject({
      status: "error",
      code: "domain_unavailable",
    });
    expect(dashboard.health.status).toBe("ok");
    expect(dashboard.recentActivity).toHaveLength(1);
  });
});
