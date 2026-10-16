import { afterEach, describe, expect, it, vi } from "vitest";

import { healthApi } from "@/features/health/api/health-api";
import { defaultHealthTableSettings } from "@/features/health/model/health-table-views";
import { ledgerApi } from "@/features/ledger/api/ledger-api";
import { defaultLedgerTableSettings } from "@/features/ledger/model/ledger-table-views";
import { queryTodoTable, queryTodoTableGroups } from "@/features/workbench/api/table-api";
import { defaultPlannerTableSettings } from "@/features/workbench/model/planner-model";

afterEach(() => vi.unstubAllGlobals());
const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
const candidates = [{ key: "hidden", label: "Stored related label", count: 250 }];

describe("compact group API", () => {
  it.each(["ledger", "health"] as const)("keeps %s table filters and grouping context without fetching rows", async (domain) => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ groups: candidates }))
      .mockResolvedValueOnce(response({ items: [], next_offset: null }));
    vi.stubGlobal("fetch", fetch);
    const date = new Date(2026, 9, 14);
    if (domain === "ledger") {
      const settings = defaultLedgerTableSettings("ledger.transactions");
      settings.groupSettings.groupBy = "category";
      settings.groupSettings.hiddenGroupKeys = ["hidden"];
      settings.filterRules = [{ id: "content", field: "content", type: "text", operator: "contains", value: "Lunch" }];
      expect(await ledgerApi.tableGroups("ledger.transactions", settings, date)).toEqual(candidates);
      expect(fetch).toHaveBeenCalledOnce();
      await ledgerApi.queryTable("ledger.transactions", settings, 0, date);
    } else {
      const settings = defaultHealthTableSettings("health.diet");
      settings.groupSettings.groupBy = "tag";
      settings.groupSettings.hiddenGroupKeys = ["hidden"];
      settings.filterRules = [{ id: "food", field: "food", type: "text", operator: "contains", value: "Lunch" }];
      expect(await healthApi.tableGroups("health.diet", settings, date)).toEqual(candidates);
      expect(fetch).toHaveBeenCalledOnce();
      await healthApi.queryTable("health.diet", settings, 0, date);
    }
    expect(fetch.mock.calls[0][0]).toBe(`/api/v1/${domain}/table/groups`);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(JSON.parse(fetch.mock.calls[1][1].body));
  });

  it.each([
    { scope: "workspace.task", context: { kind: "workspace" } },
    { scope: "planner.weekly-day-grid", context: { kind: "planner", from: "2026-10-12", to: "2026-10-18" } },
    { scope: "linked.project.task", context: { kind: "linked", parentType: "project", parentId: "parent-2" } },
  ] as const)("keeps ToDo scope and context: $scope", async ({ scope, context }) => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ groups: candidates }))
      .mockResolvedValueOnce(response({ items: [], next_offset: null }));
    vi.stubGlobal("fetch", fetch);
    const settings = defaultPlannerTableSettings("daily.today");
    settings.groupSettings.groupBy = "project";
    const query = { scope, context, settings };
    expect(await queryTodoTableGroups(query, "2026-10-14")).toEqual(candidates);
    expect(fetch).toHaveBeenCalledOnce();
    await queryTodoTable(query, "2026-10-14");
    expect(fetch.mock.calls[0][0]).toBe("/api/v1/todo/table/groups");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(JSON.parse(fetch.mock.calls[1][1].body));
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid group count %s", async (count) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ groups: [{ ...candidates[0], count }] })));
    await expect(ledgerApi.tableGroups("ledger.transactions", defaultLedgerTableSettings("ledger.transactions")))
      .rejects.toThrow();
  });
});
