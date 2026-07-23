import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkbenchController } from "@/features/workbench/hooks/useWorkbenchController";
import { defaultPlannerTableSettings } from "@/features/workbench/model/planner-model";
import type { PlannerCreationContext } from "@/features/workbench/model/workbench-model";

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function testWeekStart(): string {
  const value = new Date();
  const day = value.getDay();
  value.setDate(value.getDate() + (day === 0 ? -6 : 1 - day));
  return formatDate(value);
}

function testYearStart(): string {
  return `${new Date().getFullYear()}-01-01`;
}

function testMonthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

describe("useWorkbenchController", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts on the dashboard panel", () => {
    const { result } = renderHook(() => useWorkbenchController());

    expect(result.current.selection.leafTabId).toBe("dashboard");
    expect(result.current.panel.title).toBe("Dashboard");
  });

  it("loads all items when the initial Dashboard is selected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/todo-engine/items"
              ? [
                  {
                    id: "area",
                    type: "area",
                    title: "Health",
                    status: "active",
                  },
                ]
              : [],
        }),
      ),
    );

    const { result } = renderHook(() => useWorkbenchController());

    await waitFor(() =>
      expect(result.current.workspaceItems.allItems).toHaveLength(1),
    );
    expect(fetch).toHaveBeenCalledWith("/todo-engine/items");
  });

  it("opens a Daily Planner date from a Dashboard destination", () => {
    const { result } = renderHook(() => useWorkbenchController());

    act(() =>
      result.current.navigateDashboard({
        kind: "daily",
        date: "2026-07-25",
      }),
    );

    expect(result.current.selection.leafTabId).toBe("daily");
    expect(result.current.planner.dailyDate).toBe("2026-07-25");
  });

  it("opens a Weekly Planner date from a Dashboard destination", () => {
    const { result } = renderHook(() => useWorkbenchController());

    act(() =>
      result.current.navigateDashboard({
        kind: "weekly",
        weekStart: "2026-07-20",
      }),
    );

    expect(result.current.selection.leafTabId).toBe("weekly");
    expect(result.current.planner.weeklyDate).toBe("2026-07-20");
  });

  it("waits for the target list refresh before opening an Area detail", async () => {
    let deferTargetItems = false;
    let resolveItems:
      | ((value: { ok: boolean; json: () => Promise<unknown[]> }) => void)
      | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/todo-engine/items" && deferTargetItems) {
          return new Promise((resolve) => {
            resolveItems = resolve;
          });
        }

        return Promise.resolve({
          ok: true,
          json: async () => [],
        });
      }),
    );
    const { result } = renderHook(() => useWorkbenchController());
    await waitFor(() =>
      expect(result.current.workspaceItems.status).toBe("loaded"),
    );

    deferTargetItems = true;
    act(() =>
      result.current.navigateDashboard({
        kind: "area-detail",
        itemId: "area-1",
      }),
    );

    expect(result.current.selection.leafTabId).toBe("areas");
    expect(result.current.detailItem).toBeNull();
    await waitFor(() => expect(resolveItems).toBeDefined());
    await act(async () =>
      resolveItems?.({
        ok: true,
        json: async () => [
          {
            id: "area-1",
            type: "area",
            title: "Health",
            status: "active",
          },
        ],
      }),
    );
    await waitFor(() => expect(result.current.detailItem?.id).toBe("area-1"));
  });

  it("waits for the target list refresh before opening a Project detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/todo-engine/items"
              ? [
                  {
                    id: "project-1",
                    type: "project",
                    title: "Launch",
                    status: "active",
                  },
                ]
              : [],
        }),
      ),
    );
    const { result } = renderHook(() => useWorkbenchController());
    await waitFor(() =>
      expect(result.current.workspaceItems.status).toBe("loaded"),
    );

    act(() =>
      result.current.navigateDashboard({
        kind: "project-detail",
        itemId: "project-1",
      }),
    );

    expect(result.current.selection.leafTabId).toBe("projects");
    await waitFor(() =>
      expect(result.current.detailItem?.id).toBe("project-1"),
    );
  });

  it("discards a pending Dashboard detail when the target refresh fails", async () => {
    let requestMode: "dashboard" | "area-failure" | "projects" = "dashboard";
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/todo-engine/items" && requestMode === "area-failure") {
          return Promise.reject(new Error("unavailable"));
        }

        return Promise.resolve({
          ok: true,
          json: async () =>
            url === "/todo-engine/items" && requestMode === "projects"
              ? [
                  {
                    id: "area-1",
                    type: "area",
                    title: "Health",
                    status: "active",
                  },
                ]
              : [],
        });
      }),
    );
    const { result } = renderHook(() => useWorkbenchController());
    await waitFor(() =>
      expect(result.current.workspaceItems.status).toBe("loaded"),
    );

    requestMode = "area-failure";
    act(() =>
      result.current.navigateDashboard({
        kind: "area-detail",
        itemId: "area-1",
      }),
    );
    await waitFor(() =>
      expect(result.current.workspaceItems.status).toBe("error"),
    );

    requestMode = "projects";
    act(() => result.current.selectTab("projects"));
    await waitFor(() =>
      expect(result.current.workspaceItems.status).toBe("loaded"),
    );

    expect(result.current.detailItem).toBeNull();
  });

  it("does not open a cancelled Area detail from a later Projects refresh", async () => {
    let requestMode: "dashboard" | "areas" | "projects" = "dashboard";
    let resolveAreaItems:
      | ((value: { ok: boolean; json: () => Promise<unknown[]> }) => void)
      | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/todo-engine/items" && requestMode === "areas") {
          return new Promise((resolve) => {
            resolveAreaItems = resolve;
          });
        }

        return Promise.resolve({
          ok: true,
          json: async () =>
            url === "/todo-engine/items" && requestMode === "projects"
              ? [
                  {
                    id: "area-1",
                    type: "area",
                    title: "Health",
                    status: "active",
                  },
                ]
              : [],
        });
      }),
    );
    const { result } = renderHook(() => useWorkbenchController());
    await waitFor(() =>
      expect(result.current.workspaceItems.status).toBe("loaded"),
    );

    requestMode = "areas";
    act(() =>
      result.current.navigateDashboard({
        kind: "area-detail",
        itemId: "area-1",
      }),
    );
    await waitFor(() => expect(resolveAreaItems).toBeDefined());

    requestMode = "projects";
    act(() => result.current.selectTab("projects"));
    await waitFor(() =>
      expect(result.current.workspaceItems.status).toBe("loaded"),
    );

    expect(result.current.detailItem).toBeNull();
    await act(async () =>
      resolveAreaItems?.({
        ok: true,
        json: async () => [
          {
            id: "area-1",
            type: "area",
            title: "Health",
            status: "active",
          },
        ],
      }),
    );
    expect(result.current.detailItem).toBeNull();
  });

  it("routes Dashboard workspace summaries without opening an item", () => {
    const { result } = renderHook(() => useWorkbenchController());

    act(() => result.current.navigateDashboard({ kind: "areas" }));
    expect(result.current.selection.leafTabId).toBe("areas");
    expect(result.current.detailItem).toBeNull();

    act(() => result.current.navigateDashboard({ kind: "projects" }));
    expect(result.current.selection.leafTabId).toBe("projects");
    expect(result.current.detailItem).toBeNull();

    act(() => result.current.navigateDashboard({ kind: "tasks" }));
    expect(result.current.selection.leafTabId).toBe("tasks");

    act(() => result.current.navigateDashboard({ kind: "events" }));
    expect(result.current.selection.leafTabId).toBe("events");

    act(() => result.current.navigateDashboard({ kind: "routines" }));
    expect(result.current.selection.leafTabId).toBe("routines");
  });

  it("routes the overdue summary to Daily on today without changing any item", () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      new Promise(() => {}),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWorkbenchController());

    act(() =>
      result.current.navigateDashboard({
        kind: "daily-overdue",
        date: "2026-07-23",
      }),
    );

    expect(result.current.selection.leafTabId).toBe("daily");
    expect(result.current.planner.dailyDate).toBe("2026-07-23");
    expect(result.current.detailItem).toBeNull();
    expect(
      fetchMock.mock.calls.filter(([, init]) =>
        ["POST", "PUT", "PATCH", "DELETE"].includes(
          (init as RequestInit | undefined)?.method ?? "",
        ),
      ),
    ).toHaveLength(0);
  });

  it("repeats only the Dashboard all-items request when retrying", async () => {
    const fetchMock = vi.fn((_url: string) =>
      Promise.resolve({ ok: true, json: async () => [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWorkbenchController());
    const allItemCalls = () =>
      fetchMock.mock.calls.filter(([url]) => url === "/todo-engine/items");

    await waitFor(() => expect(allItemCalls()).toHaveLength(1));
    act(() => result.current.reloadDashboard());
    await waitFor(() => expect(allItemCalls()).toHaveLength(2));
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).startsWith("/todo-engine/items?type="),
      ),
    ).toHaveLength(0);
  });

  it("migrates each table from its tab's former shared settings", async () => {
    const savedPreferences = {
      filterMode: "or",
      filterRules: [
        { id: "r1", field: "title", type: "text", operator: "contains", value: "plan" },
      ],
      groupSettings: {
        daily: {
          groupBy: "tag",
          sort: "alphabetical",
          hideEmpty: false,
          manualOrder: ["focus"],
          hiddenGroupKeys: ["later"],
        },
        weekly: {
          groupBy: "project",
          sort: "reverse_alphabetical",
          hideEmpty: false,
          manualOrder: ["project-1"],
          hiddenGroupKeys: ["project-2"],
        },
      },
      dailySortRules: [{ id: "s1", field: "updated", direction: "desc" }],
      yearlySortRules: [],
      monthlySortRules: [],
      weeklySortRules: [{ id: "s2", field: "updated", direction: "desc" }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/todo-engine/settings/planner" ? savedPreferences : [],
        }),
      ),
    );

    const { result } = renderHook(() => useWorkbenchController());

    await waitFor(() =>
      expect(result.current.plannerTableSettings("daily.today").groupSettings.groupBy).toBe("tag"),
    );
    const dailyToday = result.current.plannerTableSettings("daily.today");
    const dailyOverdue = result.current.plannerTableSettings("daily.overdue");
    const dailyUnscheduled = result.current.plannerTableSettings("daily.unscheduled");
    for (const settings of [dailyToday, dailyOverdue, dailyUnscheduled]) {
      expect(settings.filterMode).toBe("or");
      expect(settings.filterRules).toEqual(savedPreferences.filterRules);
      expect(settings.sortRules).toEqual(savedPreferences.dailySortRules);
      expect(settings.groupSettings).toMatchObject({
        groupBy: "tag",
        sort: "alphabetical",
        manualOrder: ["focus"],
        hiddenGroupKeys: ["later"],
      });
    }
    expect(dailyToday.filterRules).not.toBe(dailyOverdue.filterRules);
    expect(dailyToday.sortRules).not.toBe(dailyOverdue.sortRules);
    expect(dailyToday.groupSettings.manualOrder).not.toBe(
      dailyOverdue.groupSettings.manualOrder,
    );

    expect(result.current.plannerTableSettings("weekly.day-grid")).toMatchObject({
      filterMode: "or",
      sortRules: savedPreferences.weeklySortRules,
      groupSettings: {
        groupBy: "project",
        sort: "reverse_alphabetical",
        hideEmpty: false,
        manualOrder: ["project-1"],
        hiddenGroupKeys: ["project-2"],
      },
    });
    expect(result.current.plannerTableSettings("weekly.month-goals")).toMatchObject({
      filterMode: "or",
      sortRules: savedPreferences.weeklySortRules,
      groupSettings: {
        groupBy: "none",
        sort: "reverse_alphabetical",
        manualOrder: ["project-1"],
        hiddenGroupKeys: ["project-2"],
      },
    });
    expect(result.current.plannerTableSettings("weekly.week-goals")).toMatchObject({
      filterMode: "or",
      sortRules: savedPreferences.weeklySortRules,
      groupSettings: {
        groupBy: "none",
        sort: "reverse_alphabetical",
        manualOrder: ["project-1"],
        hiddenGroupKeys: ["project-2"],
      },
    });
  });

  it("isolates a malformed persisted table from a valid neighboring table", async () => {
    const validOverdue = {
      filterMode: "or",
      filterRules: [
        { id: "overdue-filter", field: "title", type: "text", operator: "contains", value: "late" },
      ],
      sortRules: [{ id: "overdue-sort", field: "title", direction: "desc" }],
      groupSettings: {
        groupBy: "status",
        sort: "alphabetical",
        hideEmpty: false,
        manualOrder: [],
        hiddenGroupKeys: [],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => url === "/todo-engine/settings/planner"
            ? { tableSettings: { "daily.today": "broken", "daily.overdue": validOverdue } }
            : [],
        }),
      ),
    );

    const { result } = renderHook(() => useWorkbenchController());

    await waitFor(() =>
      expect(result.current.plannerTableSettings("daily.overdue").filterMode).toBe("or"),
    );
    expect(result.current.plannerTableSettings("daily.overdue")).toEqual(validOverdue);
    expect(result.current.plannerTableSettings("daily.today")).toMatchObject({
      filterMode: "and",
      filterRules: [],
      sortRules: [{ field: "priority", direction: "asc" }],
    });
  });

  it("uses fresh defaults instead of legacy migration when the table settings map is malformed", async () => {
    let resolveSettings: ((value: unknown) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => url === "/todo-engine/settings/planner"
        ? new Promise((resolve) => { resolveSettings = resolve; })
        : Promise.resolve({ ok: true, json: async () => [] })),
    );

    const { result } = renderHook(() => useWorkbenchController());

    await waitFor(() => expect(resolveSettings).toBeDefined());
    await act(async () => resolveSettings?.({
      ok: true,
      json: async () => ({
        tableSettings: "broken",
        filterMode: "or",
        dailySortRules: [{ id: "legacy-sort", field: "title", direction: "desc" }],
      }),
    }));

    expect(result.current.plannerTableSettings("daily.today").sortRules[0]?.id).toBe(
      "daily.today-default-sort",
    );
    expect(result.current.plannerTableSettings("daily.today").filterMode).toBe("and");
  });

  it("keeps planner changes made before saved preferences finish loading", async () => {
    let resolveSettings: ((value: unknown) => void) | undefined;
    const savedPreferences = {
      dailyFilters: { tags: [], areaIds: [], projectIds: [], routineIds: [], itemTypes: [], statuses: [] },
      filterMode: "and",
      filterRules: [],
      groupSettings: {},
      dailySortRules: [],
      yearlySortRules: [],
      monthlySortRules: [],
      weeklySortRules: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) =>
        url === "/todo-engine/settings/planner" && !init
          ? new Promise((resolve) => { resolveSettings = resolve; })
          : Promise.resolve({ ok: true, json: async () => [] }),
      ),
    );

    const { result } = renderHook(() => useWorkbenchController());

    await waitFor(() => expect(resolveSettings).toBeDefined());
    act(() => result.current.updatePlannerTableSettings("daily.today", (settings) => ({
      ...settings,
      filterMode: "or",
    })));
    await act(async () => {
      resolveSettings?.({ ok: true, json: async () => savedPreferences });
    });

    expect(result.current.plannerTableSettings("daily.today").filterMode).toBe("or");
  });

  it("migrates tableSettings into one Table tab and persists only saved tabs", async () => {
    const writes: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url !== "/todo-engine/settings/planner") {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (!init) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            tableSettings: {
              "daily.today": {
                ...defaultPlannerTableSettings("daily.today"),
                filterMode: "or",
              },
            },
          }),
        });
      }
      writes.push(JSON.parse(String(init.body)).value);
      return Promise.resolve({ ok: true, json: async () => null });
    }));

    const { result } = renderHook(() => useWorkbenchController());
    await waitFor(() =>
      expect(result.current.plannerTableTabs("daily.today").tabs[0]?.name).toBe("Table"),
    );

    act(() => result.current.updatePlannerTableSettings("daily.today", (settings) => ({
      ...settings,
      filterMode: "and",
    })));
    expect(result.current.plannerTableIsDirty("daily.today")).toBe(true);
    expect(writes).toHaveLength(0);

    act(() => result.current.savePlannerTableTab("daily.today"));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(
      (writes[0] as {
        tableTabs: Record<string, { tabs: Array<{ name: string }> }>;
      }).tableTabs["daily.today"]?.tabs[0]?.name,
    ).toBe("Table");
    expect(
      (writes[0] as { tableTabs: Record<string, Record<string, unknown>> })
        .tableTabs["daily.today"],
    ).not.toHaveProperty("activeTabId");
    expect(
      (writes[0] as { tableTabs: Record<string, Record<string, unknown>> })
        .tableTabs["daily.today"],
    ).not.toHaveProperty("draftSettings");
    expect(writes[0]).not.toHaveProperty("tableSettings");
  });

  it("creates, renames, and deletes tabs without crossing table boundaries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] })),
    );
    const { result } = renderHook(() => useWorkbenchController());
    await waitFor(() => expect(result.current.workspaceItems.status).toBe("loaded"));
    const overdueBefore = result.current.plannerTableTabs("daily.overdue");

    act(() => {
      expect(result.current.createPlannerTableTab("daily.today", "새 보기")).toBe(true);
    });
    const created = result.current.plannerTableTabs("daily.today");
    expect(created.tabs).toHaveLength(2);
    expect(created.tabs[1]?.name).toBe("새 보기");
    expect(result.current.plannerTableTabs("daily.overdue")).toBe(overdueBefore);

    act(() => {
      expect(result.current.renamePlannerTableTab(
        "daily.today",
        created.activeTabId,
        "Table",
      )).toBe(true);
    });
    expect(result.current.plannerTableTabs("daily.today").tabs[1]?.name).toBe("Table 2");

    act(() => result.current.requestDeletePlannerTableTab(
      "daily.today",
      created.activeTabId,
    ));
    expect(result.current.plannerTabConfirmation?.kind).toBe("delete");
    act(() => result.current.confirmPlannerTabAction());
    expect(result.current.plannerTableTabs("daily.today").tabs).toHaveLength(1);
  });

  it("serializes persisted tab mutations so the latest full document wins", async () => {
    const pendingWrites: Array<() => void> = [];
    let serverSettings: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url !== "/todo-engine/settings/planner") {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        if (init?.method !== "PUT") {
          return Promise.resolve({ ok: true, json: async () => null });
        }

        const value = JSON.parse(String(init.body)).value;
        return new Promise((resolve) => {
          pendingWrites.push(() => {
            serverSettings = value;
            resolve({ ok: true, json: async () => value });
          });
        });
      }),
    );

    const { result } = renderHook(() => useWorkbenchController());

    act(() => {
      expect(result.current.createPlannerTableTab("daily.today", "Focus")).toBe(true);
    });

    await waitFor(() => expect(pendingWrites).toHaveLength(1));
    const activeId = result.current.plannerTableTabs("daily.today").activeTabId;
    act(() => {
      expect(result.current.renamePlannerTableTab(
        "daily.today",
        activeId,
        "Deep focus",
      )).toBe(true);
    });
    expect(pendingWrites).toHaveLength(1);
    await act(async () => pendingWrites.shift()?.());
    await waitFor(() => expect(pendingWrites).toHaveLength(1));
    await act(async () => pendingWrites.shift()?.());

    expect(serverSettings).toMatchObject({
      tableTabs: {
        "daily.today": {
          tabs: [{ name: "Table" }, { name: "Deep focus" }],
        }
      },
    });
  });

  it("keeps session tabs after a failed write and retries the full document", async () => {
    const bodies: unknown[] = [];
    let putCount = 0;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url !== "/todo-engine/settings/planner") {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (!init) {
        return Promise.resolve({ ok: true, json: async () => null });
      }
      putCount += 1;
      bodies.push(JSON.parse(String(init.body)).value);
      return putCount === 1
        ? Promise.reject(new Error("offline"))
        : Promise.resolve({ ok: true, json: async () => null });
    }));

    const { result } = renderHook(() => useWorkbenchController());
    act(() => {
      expect(result.current.createPlannerTableTab("daily.today", "Focus")).toBe(true);
    });
    await waitFor(() => expect(putCount).toBe(1));
    expect(result.current.plannerTableTabs("daily.today").tabs).toHaveLength(2);

    const activeId = result.current.plannerTableTabs("daily.today").activeTabId;
    act(() => {
      expect(result.current.renamePlannerTableTab(
        "daily.today",
        activeId,
        "Deep focus",
      )).toBe(true);
    });
    await waitFor(() => expect(putCount).toBe(2));
    expect(
      (bodies[1] as {
        tableTabs: Record<string, { tabs: Array<{ name: string }> }>;
      }).tableTabs["daily.today"]?.tabs.map(({ name }) => name),
    ).toEqual(["Table", "Deep focus"]);
  });

  it("selects areas under todo when workspace is clicked", () => {
    const { result } = renderHook(() => useWorkbenchController());

    act(() => result.current.selectTab("workspace"));

    expect(result.current.selection).toEqual({
      mainTabId: "todo",
      leafTabId: "areas",
      workspaceExpanded: true,
      plannerExpanded: false,
    });
    expect(result.current.panel.title).toBe("Areas");
  });

  it("selects daily under the planner group", () => {
    const { result } = renderHook(() => useWorkbenchController());

    act(() => result.current.selectTab("daily"));

    expect(result.current.selection).toEqual({
      mainTabId: "todo",
      leafTabId: "daily",
      workspaceExpanded: false,
      plannerExpanded: true,
    });
    expect(result.current.panel.title).toBe("Daily");
  });

  it("updates one planner table without changing its neighbor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/todo-engine/settings/planner" ? null : [],
        }),
      ),
    );

    const { result } = renderHook(() => useWorkbenchController());
    await waitFor(() =>
      expect(result.current.workspaceItems.status).toBe("loaded"),
    );
    const overdueBefore = result.current.plannerTableSettings("daily.overdue");

    act(() => result.current.updatePlannerTableSettings("daily.today", (settings) => ({
      ...settings,
      filterMode: "or",
      filterRules: [
        { id: "r1", field: "title", type: "text", operator: "contains", value: "plan" },
      ],
    })));

    expect(result.current.plannerTableSettings("daily.today")).toMatchObject({
      filterMode: "or",
      filterRules: [
        { id: "r1", field: "title", type: "text", operator: "contains", value: "plan" },
      ],
    });
    expect(result.current.plannerTableSettings("daily.overdue")).toBe(overdueBefore);
  });

  it("persists saved tab settings and restores the changed table after remounting", async () => {
    let serverSettings: unknown = null;
    const putBodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url !== "/todo-engine/settings/planner") {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        if (init?.method === "PUT") {
          const body = JSON.parse(String(init.body));
          putBodies.push(body);
          serverSettings = body.value;
          return Promise.resolve({ ok: true, json: async () => body.value });
        }
        return Promise.resolve({ ok: true, json: async () => serverSettings });
      }),
    );

    const first = renderHook(() => useWorkbenchController());
    await waitFor(() => expect(first.result.current.plannerTableSettings("daily.today")).toBeDefined());

    act(() => first.result.current.updatePlannerTableSettings("daily.today", (settings) => ({
      ...settings,
      filterMode: "or",
      filterRules: [
        { id: "saved", field: "title", type: "text", operator: "contains", value: "persisted" },
      ],
    })));
    expect(putBodies).toHaveLength(0);
    act(() => first.result.current.savePlannerTableTab("daily.today"));

    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toEqual({
      value: expect.objectContaining({
        tableTabs: expect.objectContaining({
          "daily.today": {
            tabs: [
              expect.objectContaining({
                settings: expect.objectContaining({ filterMode: "or" }),
              }),
            ],
          },
        }),
      }),
    });
    expect(Object.keys((putBodies[0] as { value: Record<string, unknown> }).value)).toEqual([
      "tableTabs",
    ]);

    first.unmount();
    const restored = renderHook(() => useWorkbenchController());

    await waitFor(() =>
      expect(restored.result.current.plannerTableSettings("daily.today").filterMode).toBe("or"),
    );
    expect(restored.result.current.plannerTableSettings("daily.today").filterRules).toEqual([
      { id: "saved", field: "title", type: "text", operator: "contains", value: "persisted" },
    ]);
  });

  it("selects yearly under the planner sibling branch", () => {
    const { result } = renderHook(() => useWorkbenchController());

    act(() => result.current.selectTab("planner"));

    expect(result.current.selection).toEqual({
      mainTabId: "todo",
      leafTabId: "yearly",
      workspaceExpanded: false,
      plannerExpanded: true,
    });
    expect(result.current.panel.title).toBe("Yearly");
  });

  it("toggles workspace children from the rail control", () => {
    const { result } = renderHook(() => useWorkbenchController());

    act(() => result.current.selectTab("workspace"));
    act(() => result.current.toggleWorkspaceExpansion());

    expect(result.current.selection).toEqual({
      mainTabId: "todo",
      leafTabId: "todo",
      workspaceExpanded: false,
      plannerExpanded: false,
    });
    expect(result.current.panel.title).toBe("ToDo");

    act(() => result.current.toggleWorkspaceExpansion());

    expect(result.current.selection).toEqual({
      mainTabId: "todo",
      leafTabId: "areas",
      workspaceExpanded: true,
      plannerExpanded: false,
    });
    expect(result.current.panel.title).toBe("Areas");
  });

  it("keeps workspace and planner expanded independently", () => {
    const { result } = renderHook(() => useWorkbenchController());

    act(() => result.current.selectTab("workspace"));
    act(() => result.current.selectTab("planner"));

    expect(result.current.selection).toEqual({
      mainTabId: "todo",
      leafTabId: "yearly",
      workspaceExpanded: true,
      plannerExpanded: true,
    });

    act(() => result.current.selectTab("workspace"));

    expect(result.current.selection).toEqual({
      mainTabId: "todo",
      leafTabId: "yearly",
      workspaceExpanded: false,
      plannerExpanded: true,
    });

    act(() => result.current.selectTab("planner"));

    expect(result.current.selection).toEqual({
      mainTabId: "todo",
      leafTabId: "todo",
      workspaceExpanded: false,
      plannerExpanded: false,
    });
  });

  it.each([
    ["daily", ["task", "event", "routine", "area", "project"]],
    ["weekly", ["goal", "task", "event", "routine", "area", "project"]],
    ["monthly", ["goal", "task", "event", "routine", "area", "project"]],
    ["yearly", ["goal", "area", "project"]],
  ] as const)(
    "loads planner item sets for %s",
    async (tabId, itemTypes) => {
      const fetchMock = vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => [],
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() => useWorkbenchController());

      await act(async () => {
        result.current.selectTab(tabId);
      });

      await vi.waitFor(() =>
        expect(result.current.workspaceItems.status).toBe("loaded"),
      );

      for (const itemType of itemTypes) {
        expect(fetchMock).toHaveBeenCalledWith(`/todo-engine/items?type=${itemType}`);
      }
    },
  );

  it("selects weekly and daily dates without sharing periods", async () => {
    const { result } = renderHook(() => useWorkbenchController());

    act(() => result.current.selectTab("weekly"));
    await waitFor(() => expect(result.current.panel.id).toBe("weekly"));

    act(() => result.current.selectPlannerPeriodDate("2026-07-09"));
    expect(result.current.planner.weeklyDate).toBe("2026-07-06");

    act(() => result.current.selectTab("daily"));
    await waitFor(() => expect(result.current.panel.id).toBe("daily"));

    act(() => result.current.selectPlannerPeriodDate("2026-07-09"));
    expect(result.current.planner.dailyDate).toBe("2026-07-09");

    act(() => result.current.selectTab("weekly"));
    expect(result.current.planner.date).toBe("2026-07-06");
  });

  it("archives selected workspace rows after confirmation", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).endsWith("/archive")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: "task-1", status: "archived" }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "One", status: "active" },
          { id: "task-2", type: "task", title: "Two", status: "active" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWorkbenchController());

    await act(async () => {
      result.current.selectTab("workspace");
      result.current.selectTab("tasks");
    });

    await vi.waitFor(() =>
      expect(result.current.workspaceItems.status).toBe("loaded"),
    );

    act(() => result.current.toggleItemSelection("task-1"));
    expect(result.current.selectedItemIds).toEqual(["task-1"]);

    act(() => result.current.requestArchiveSelected());
    expect(result.current.archiveConfirmationOpen).toBe(true);

    await act(async () => result.current.confirmArchiveSelected());

    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/task-1/archive",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.current.workspaceItems.allItems.map((item) => item.id)).toEqual(["task-2"]);
    expect(result.current.selectedItemIds).toEqual([]);
    expect(result.current.archiveConfirmationOpen).toBe(false);
  });

  it("keeps failed archive rows selected while removing successful rows", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/todo-engine/items/task-1/archive") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: "task-1", status: "archived" }),
        });
      }
      if (url === "/todo-engine/items/task-2/archive") {
        return Promise.resolve({ ok: false, json: async () => ({}) });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "One", status: "active" },
          { id: "task-2", type: "task", title: "Two", status: "active" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWorkbenchController());

    await act(async () => {
      result.current.selectTab("workspace");
      result.current.selectTab("tasks");
    });

    await vi.waitFor(() =>
      expect(result.current.workspaceItems.status).toBe("loaded"),
    );

    act(() => {
      result.current.toggleItemSelection("task-1");
      result.current.toggleItemSelection("task-2");
      result.current.requestArchiveSelected();
    });

    await act(async () => result.current.confirmArchiveSelected());

    expect(result.current.workspaceItems.items.map((item) => item.id)).toEqual([
      "task-2",
    ]);
    expect(result.current.selectedItemIds).toEqual(["task-2"]);
    expect(result.current.archiveConfirmationOpen).toBe(false);
  });

  it("patches detail-only and metadata workspace fields", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/event-1") {
        expect(init).toEqual(
          expect.objectContaining({
            method: "PATCH",
            body: JSON.stringify({
              description: "Bring agenda",
              note: "Confirm room",
              location: "Desk",
              participants: ["Me", "Team"],
              commitment_type: "review",
            }),
          }),
        );

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "event-1",
            type: "event",
            title: "Review",
            status: "active",
            description: "Bring agenda",
            note: "Confirm room",
            metadata_: {
              location: "Desk",
              participants: ["Me", "Team"],
              commitment_type: "review",
            },
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "event-1", type: "event", title: "Review", status: "active" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWorkbenchController());

    await act(async () => {
      result.current.selectTab("workspace");
      result.current.selectTab("events");
    });

    await vi.waitFor(() =>
      expect(result.current.workspaceItems.status).toBe("loaded"),
    );

    act(() => result.current.openDetailView(result.current.workspaceItems.items[0]!));

    await act(async () => {
      await result.current.saveDetailItem({
        description: "Bring agenda",
        note: "Confirm room",
        location: "Desk",
        participants: ["Me", "Team"],
        commitment_type: "review",
      });
    });

    expect(result.current.detailItem?.metadata_?.location).toBe("Desk");
  });

  it("patches item tags from workspace edits", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/task-1") {
        expect(init).toEqual(
          expect.objectContaining({
            method: "PATCH",
            body: JSON.stringify({ tags: ["deep-work", "planning"] }),
          }),
        );
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "Plan",
            status: "active",
            tags: ["deep-work", "planning"],
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "Plan", status: "active", tags: [] },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWorkbenchController());

    await act(async () => {
      result.current.selectTab("workspace");
      result.current.selectTab("tasks");
    });

    await vi.waitFor(() => expect(result.current.workspaceItems.status).toBe("loaded"));

    await act(async () => {
      await result.current.patchWorkspaceItem("task-1", {
        tags: ["deep-work", "planning"],
      });
    });

    expect(result.current.workspaceItems.items[0].tags).toEqual([
      "deep-work",
      "planning",
    ]);
    expect(result.current.workspaceItems.allItems[0]?.tags).toEqual([
      "deep-work",
      "planning",
    ]);
  });

  it("adds created workspace items to all loaded items", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/todo-engine/tasks/propose") {
          return Promise.resolve({
            ok: true,
            json: async () => ({ id: "task-new", type: "task", title: "New", status: "active" }),
          });
        }
        if (url === "/todo-engine/items?type=task" || url === "/todo-engine/items") {
          return Promise.resolve({
            ok: true,
            json: async () => [
              { id: "task-1", type: "task", title: "Existing", status: "active" },
            ],
          });
        }

        return Promise.resolve({ ok: true, json: async () => [] });
      }),
    );

    const { result } = renderHook(() => useWorkbenchController());

    await act(async () => {
      result.current.selectTab("workspace");
      result.current.selectTab("tasks");
    });
    await waitFor(() => expect(result.current.workspaceItems.status).toBe("loaded"));

    await act(async () => {
      await result.current.createWorkspaceItem({ title: "New" });
    });

    expect(result.current.workspaceItems.items.map((item) => item.id)).toEqual([
      "task-new",
      "task-1",
    ]);
    expect(result.current.workspaceItems.allItems.map((item) => item.id)).toEqual([
      "task-new",
      "task-1",
    ]);
  });

  it("loads tag options from all item tags", async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () => {
          if (url === "/todo-engine/items") {
            return [
              { id: "area-1", type: "area", title: "Area", status: "active", tags: ["backend"] },
              {
                id: "project-1",
                type: "project",
                title: "Project",
                status: "active",
                tags: ["design", "backend"],
              },
              { id: "task-2", type: "task", title: "Other", status: "active", tags: ["security"] },
            ];
          }

          return url === "/todo-engine/items?type=task"
            ? [{ id: "task-1", type: "task", title: "Plan", status: "active", tags: [] }]
            : [];
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWorkbenchController());

    await act(async () => {
      result.current.selectTab("workspace");
      result.current.selectTab("tasks");
    });

    await vi.waitFor(() => expect(result.current.workspaceItems.status).toBe("loaded"));

    expect(result.current.workspaceItems.tagOptions).toEqual([
      "backend",
      "design",
      "security",
    ]);
  });

  it("keeps typed workspace items separate from all loaded items", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => {
            if (url === "/todo-engine/items?type=area") {
              return [{ id: "area-1", type: "area", title: "Health", status: "active" }];
            }
            if (url === "/todo-engine/items") {
              return [
                { id: "area-1", type: "area", title: "Health", status: "active" },
                {
                  id: "project-1",
                  type: "project",
                  title: "Checkup",
                  status: "active",
                  area_id: "area-1",
                },
                {
                  id: "task-1",
                  type: "task",
                  title: "Book appointment",
                  status: "active",
                  area_id: "area-1",
                },
              ];
            }

            return [];
          },
        }),
      ),
    );

    const { result } = renderHook(() => useWorkbenchController());

    act(() => result.current.selectTab("workspace"));

    await waitFor(() => expect(result.current.workspaceItems.status).toBe("loaded"));

    expect(result.current.workspaceItems.items.map((item) => item.id)).toEqual(["area-1"]);
    expect(result.current.workspaceItems).toMatchObject({
      allItems: [
        { id: "area-1" },
        { id: "project-1", area_id: "area-1" },
        { id: "task-1", area_id: "area-1" },
      ],
    });
  });

  it("creates active workspace items with one complete request and no activation", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).endsWith("/propose")) {
        const type = String(url).match(/\/todo-engine\/(tasks|events|projects|routines)\/propose/)?.[1];
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: `${type}-new`,
            type: type?.slice(0, -1),
            title: JSON.parse(String(init?.body)).title,
            status: "active",
          }),
        });
      }

      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWorkbenchController());

    const cases = [
      ["tasks", { title: "New task" }, { title: "New task", actor: "user" }],
      [
        "events",
        { title: "New event", scheduled: "2026-07-16" },
        { title: "New event", scheduled: "2026-07-16", actor: "user" },
      ],
      [
        "projects",
        { title: "New project", definition_of_done: "Done when verified" },
        { title: "New project", actor: "user", definition_of_done: "Done when verified" },
      ],
      [
        "routines",
        { title: "New routine", recurrence_rule: "RRULE:FREQ=DAILY" },
        {
          title: "New routine",
          actor: "user",
          materialization_policy: "single_open",
          recurrence_rule: "RRULE:FREQ=DAILY",
        },
      ],
    ] as const;

    for (const [panel, form, body] of cases) {
      await act(async () => {
        result.current.selectTab("workspace");
        result.current.selectTab(panel);
      });
      await act(async () => result.current.createWorkspaceItem(form));

      expect(fetchMock).toHaveBeenCalledWith(
        `/todo-engine/${panel}/propose`,
        expect.objectContaining({ method: "POST", body: JSON.stringify(body) }),
      );
    }

    const creationUrls = fetchMock.mock.calls
      .filter(([, init]) => init?.method === "POST")
      .map(([url]) => String(url));
    expect(creationUrls).toHaveLength(4);
  });

  it("anchors weekly planner goal creation to the active week", async () => {
    const weekStart = testWeekStart();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/goals/propose") {
        expect(init).toEqual(expect.objectContaining({ method: "POST" }));
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "goal-new",
            type: "goal",
            title: "New goal",
            status: "active",
            horizon: "week",
            scheduled: weekStart,
          }),
        });
      }

      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWorkbenchController());

    await act(async () => {
      result.current.selectTab("planner");
      result.current.selectTab("weekly");
    });

    await act(async () => {
      await result.current.createWorkspaceItem({
        title: "New goal",
      });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/goals/propose",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          title: "New goal",
          horizon: "week",
          scheduled: weekStart,
          actor: "user",
        }),
      }),
    );
    expect(result.current.detailItem?.id).toBe("goal-new");
    expect(result.current.workspaceItems.items[0]).toMatchObject({
      id: "goal-new",
      horizon: "week",
      scheduled: weekStart,
    });
  });

  it("prefills a contextual Task request with the filtered project", async () => {
    const scheduled = formatDate(new Date());
    const requestBodies: unknown[] = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/tasks/propose") {
        const body = JSON.parse(String(init?.body));
        requestBodies.push(body);
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-contextual",
            type: "task",
            title: body.title,
            status: "active",
            ...body,
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const context = {
      tableId: "daily.today",
      itemTypes: ["task", "event"],
      scheduled,
      editableDate: false,
      tableSettings: {
        filterMode: "and",
        filterRules: [
          { id: "area", field: "area", type: "relation", operator: "is", value: ["area-1"] },
          { id: "project", field: "project", type: "relation", operator: "is", value: ["project-1"] },
          { id: "priority", field: "priority", type: "select", operator: "is", value: ["3"] },
          { id: "tags", field: "tags", type: "multiSelect", operator: "contains", value: ["focus"] },
        ],
        sortRules: [],
        groupSettings: {
          groupBy: "none",
          sort: "manual",
          hideEmpty: true,
          manualOrder: [],
          hiddenGroupKeys: [],
        },
      },
    } satisfies PlannerCreationContext;

    const { result } = renderHook(() => useWorkbenchController());
    act(() => {
      result.current.selectTab("planner");
      result.current.selectTab("daily");
    });
    act(() => result.current.openPlannerCreationDialog(context));

    expect(result.current.plannerCreationAnalysis).toEqual({
      prefills: {
        area_id: "area-1",
        project_id: "project-1",
        priority: 3,
        tags: ["focus"],
      },
      visibilityWarning: false,
    });
    act(() => result.current.closeCreationDialog());
    expect(result.current.plannerCreationContext).toBeNull();
    expect(result.current.plannerCreationAnalysis).toEqual({
      prefills: {},
      visibilityWarning: false,
    });
    act(() => result.current.openPlannerCreationDialog(context));

    await act(async () => {
      await result.current.createWorkspaceItem({ title: "Filtered task", itemType: "task" });
    });

    expect(requestBodies).toEqual([{
      title: "Filtered task",
      scheduled,
      area: "area-1",
      project_id: "project-1",
      priority: 3,
      tags: ["focus"],
      actor: "user",
    }]);
  });

  it("keeps user-entered dates for an approved editable creation context", async () => {
    const requestBodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/events/propose") {
        const body = JSON.parse(String(init?.body));
        requestBodies.push(body);
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: "event-user", type: "event", status: "active", ...body }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    }));
    const context = {
      tableId: "monthly.calendar",
      itemTypes: ["task", "event"],
      scheduled: testMonthStart(),
      editableDate: true,
      tableSettings: {
        filterMode: "and",
        filterRules: [
          { id: "area", field: "area", type: "relation", operator: "is", value: ["area-filter"] },
          { id: "project", field: "project", type: "relation", operator: "is", value: ["project-filter"] },
          { id: "priority", field: "priority", type: "select", operator: "is", value: ["2"] },
          { id: "tags", field: "tags", type: "multiSelect", operator: "contains", value: ["filter-tag"] },
        ],
        sortRules: [],
        groupSettings: {
          groupBy: "none",
          sort: "manual",
          hideEmpty: true,
          manualOrder: [],
          hiddenGroupKeys: [],
        },
      },
    } satisfies PlannerCreationContext;

    const { result } = renderHook(() => useWorkbenchController());
    act(() => {
      result.current.selectTab("planner");
      result.current.selectTab("monthly");
    });
    act(() => result.current.openPlannerCreationDialog(context));
    await act(async () => {
      await result.current.createWorkspaceItem({
        title: "Explicit event",
        itemType: "event",
        scheduled: "2026-07-22",
        area_id: "area-user",
        project_id: "project-user",
        priority: 8,
        tags: ["user-tag"],
      });
    });

    expect(requestBodies).toEqual([{
      title: "Explicit event",
      scheduled: "2026-07-22",
      area: "area-user",
      project_id: "project-user",
      priority: 8,
      tags: ["user-tag"],
      actor: "user",
    }]);
    expect(result.current.plannerCreationContext).toBeNull();
  });

  it("canonicalizes a forged weekly goal context and re-enforces its fixed policy", async () => {
    const requestBodies: unknown[] = [];
    const weekStart = testWeekStart();
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/goals/propose") {
        const body = JSON.parse(String(init?.body));
        requestBodies.push(body);
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: "goal-fixed", type: "goal", status: "active", ...body }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    }));

    const { result } = renderHook(() => useWorkbenchController());
    act(() => {
      result.current.selectTab("planner");
      result.current.selectTab("weekly");
    });
    act(() => result.current.openPlannerCreationDialog({
      tableId: "weekly.week-goals",
      itemTypes: ["task", "event"],
      scheduled: "2030-01-01",
      horizon: "month",
      editableDate: true,
      tableSettings: {
        filterMode: "and",
        filterRules: [],
        sortRules: [],
        groupSettings: {
          groupBy: "none",
          sort: "manual",
          hideEmpty: true,
          manualOrder: [],
          hiddenGroupKeys: [],
        },
      },
    }));

    expect(result.current.plannerCreationContext).toMatchObject({
      tableId: "weekly.week-goals",
      itemTypes: ["goal"],
      scheduled: weekStart,
      horizon: "week",
      editableDate: false,
    });

    await act(async () => {
      await result.current.createWorkspaceItem({
        title: "Fixed goal",
        itemType: "goal",
        scheduled: "2030-01-01",
        horizon: "month",
        area_id: "area-1",
        project_id: "project-1",
        priority: 8,
        tags: ["focus"],
      });
    });

    expect(requestBodies).toEqual([{
      title: "Fixed goal",
      horizon: "week",
      scheduled: weekStart,
      tags: ["focus"],
      actor: "user",
    }]);
  });

  it("uses the moved planner period when a fixed goal context is submitted", async () => {
    const requestBodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/goals/propose") {
        const body = JSON.parse(String(init?.body));
        requestBodies.push(body);
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: "goal-moved", type: "goal", status: "active", ...body }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    }));

    const { result } = renderHook(() => useWorkbenchController());
    act(() => {
      result.current.selectTab("planner");
      result.current.selectTab("yearly");
    });
    await waitFor(() => expect(result.current.panel.id).toBe("yearly"));

    const openedYear = result.current.planner.date.slice(0, 4);
    act(() => result.current.openPlannerCreationDialog({
      tableId: "yearly.period-goals",
      itemTypes: ["goal"],
      scheduled: `${openedYear}-01-01`,
      horizon: "year",
      editableDate: false,
      tableSettings: result.current.plannerTableSettings("yearly.period-goals"),
    }));
    act(() => result.current.movePlannerPeriod(1));
    const movedAnchor = result.current.planner.date;

    await act(async () => {
      await result.current.createWorkspaceItem({ title: "Moved year goal" });
    });

    expect(requestBodies).toEqual([{
      title: "Moved year goal",
      horizon: "year",
      scheduled: movedAnchor,
      actor: "user",
    }]);
  });

  it("keeps an editable goal date while enforcing the table horizon at submit", async () => {
    const requestBodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/goals/propose") {
        const body = JSON.parse(String(init?.body));
        requestBodies.push(body);
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: "goal-editable", type: "goal", status: "active", ...body }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    }));

    const { result } = renderHook(() => useWorkbenchController());
    act(() => {
      result.current.selectTab("planner");
      result.current.selectTab("monthly");
    });
    await waitFor(() => expect(result.current.panel.id).toBe("monthly"));
    act(() => result.current.openPlannerCreationDialog({
      tableId: "monthly.week-goals",
      itemTypes: ["task"],
      scheduled: "2030-01-01",
      horizon: "year",
      editableDate: false,
      tableSettings: result.current.plannerTableSettings("monthly.week-goals"),
    }));

    await act(async () => {
      await result.current.createWorkspaceItem({
        title: "Editable week goal",
        scheduled: "2026-07-22",
        horizon: "month",
      });
    });

    expect(requestBodies).toEqual([{
      title: "Editable week goal",
      horizon: "week",
      scheduled: "2026-07-22",
      actor: "user",
    }]);
  });

  it("canonicalizes forged Daily Unscheduled semantics on open and submit", async () => {
    const requestBodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/tasks/propose") {
        const body = JSON.parse(String(init?.body));
        requestBodies.push(body);
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: "task-unscheduled", type: "task", status: "active", ...body }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    }));

    const { result } = renderHook(() => useWorkbenchController());
    act(() => {
      result.current.selectTab("planner");
      result.current.selectTab("daily");
    });
    act(() => result.current.openPlannerCreationDialog({
      tableId: "daily.unscheduled",
      itemTypes: ["event"],
      scheduled: "2030-01-01",
      horizon: "week",
      editableDate: true,
      tableSettings: result.current.plannerTableSettings("daily.unscheduled"),
    }));

    expect(result.current.plannerCreationContext).toMatchObject({
      tableId: "daily.unscheduled",
      itemTypes: ["task"],
      scheduled: "",
      editableDate: false,
    });
    expect(result.current.plannerCreationContext?.horizon).toBeUndefined();

    await act(async () => {
      await result.current.createWorkspaceItem({
        title: "No date",
        itemType: "task",
        scheduled: "2035-05-05",
        horizon: "month",
      });
    });

    expect(requestBodies).toEqual([{
      title: "No date",
      actor: "user",
    }]);
  });

  it("canonicalizes forged Daily Today values and re-enforces the selected date", async () => {
    const requestBodies: unknown[] = [];
    const selectedDate = formatDate(new Date());
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/events/propose") {
        const body = JSON.parse(String(init?.body));
        requestBodies.push(body);
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: "event-today", type: "event", status: "active", ...body }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    }));

    const { result } = renderHook(() => useWorkbenchController());
    act(() => {
      result.current.selectTab("planner");
      result.current.selectTab("daily");
    });
    act(() => result.current.openPlannerCreationDialog({
      tableId: "daily.today",
      itemTypes: ["goal"],
      scheduled: "2030-01-01",
      horizon: "year",
      editableDate: true,
      tableSettings: result.current.plannerTableSettings("daily.today"),
    }));

    expect(result.current.plannerCreationContext).toMatchObject({
      tableId: "daily.today",
      itemTypes: ["task", "event"],
      scheduled: selectedDate,
      editableDate: false,
    });
    expect(result.current.plannerCreationContext?.horizon).toBeUndefined();

    await act(async () => {
      await result.current.createWorkspaceItem({
        title: "Today event",
        itemType: "event",
        scheduled: "2035-05-05",
        horizon: "month",
      });
    });

    expect(requestBodies).toEqual([{
      title: "Today event",
      scheduled: selectedDate,
      actor: "user",
    }]);
  });

  it("rejects a contextual item type that the source table does not allow", async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve({ ok: true, json: async () => [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWorkbenchController());

    act(() => result.current.openPlannerCreationDialog({
      tableId: "weekly.week-goals",
      itemTypes: ["goal"],
      scheduled: "2026-07-20",
      horizon: "week",
      editableDate: false,
      tableSettings: {
        filterMode: "and",
        filterRules: [],
        sortRules: [],
        groupSettings: {
          groupBy: "none",
          sort: "manual",
          hideEmpty: true,
          manualOrder: [],
          hiddenGroupKeys: [],
        },
      },
    }));

    await act(async () => {
      await expect(result.current.createWorkspaceItem({
        title: "Wrong type",
        itemType: "event",
      })).rejects.toMatchObject({
        status: 400,
        code: "validation_error",
        detail: "Event is not allowed for weekly.week-goals.",
      });
    });

    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    expect(result.current.creationDialogOpen).toBe(true);
    expect(result.current.plannerCreationContext?.tableId).toBe("weekly.week-goals");
  });

  it("warns and discards all suggestions when contextual filters conflict", () => {
    const { result } = renderHook(() => useWorkbenchController());
    act(() => result.current.openPlannerCreationDialog({
      tableId: "daily.today",
      itemTypes: ["task", "event"],
      scheduled: "2026-07-20",
      editableDate: false,
      tableSettings: {
        filterMode: "and",
        filterRules: [
          { id: "area-1", field: "area", type: "relation", operator: "is", value: ["area-1"] },
          { id: "area-2", field: "area", type: "relation", operator: "is", value: ["area-2"] },
        ],
        sortRules: [],
        groupSettings: {
          groupBy: "none",
          sort: "manual",
          hideEmpty: true,
          manualOrder: [],
          hiddenGroupKeys: [],
        },
      },
    }));

    expect(result.current.plannerCreationAnalysis).toEqual({
      prefills: {},
      visibilityWarning: true,
    });
  });

  it("creates date-work items from the monthly calendar context", async () => {
    const requestBodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/tasks/propose") {
        const body = JSON.parse(String(init?.body));
        requestBodies.push(body);
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: "task-month", type: "task", status: "active", ...body }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    }));

    const { result } = renderHook(() => useWorkbenchController());
    act(() => result.current.selectTab("planner"));
    act(() => result.current.selectTab("monthly"));
    await waitFor(() => expect(result.current.panel.id).toBe("monthly"));
    act(() => result.current.openPlannerCreationDialog({
      tableId: "monthly.calendar",
      itemTypes: ["task", "event"],
      scheduled: "2026-07-01",
      editableDate: true,
      tableSettings: {
        filterMode: "and",
        filterRules: [],
        sortRules: [],
        groupSettings: {
          groupBy: "none",
          sort: "manual",
          hideEmpty: true,
          manualOrder: [],
          hiddenGroupKeys: [],
        },
      },
    }));

    await act(async () => {
      await result.current.createWorkspaceItem({ title: "Monthly task" });
    });
    expect(requestBodies).toEqual([{
      title: "Monthly task",
      scheduled: "2026-07-01",
      actor: "user",
    }]);
  });

  it("moves yearly and monthly planner periods through canonical dates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [],
        }),
      ),
    );

    const { result } = renderHook(() => useWorkbenchController());

    act(() => result.current.selectTab("todo"));
    act(() => result.current.selectTab("planner"));
    await waitFor(() => expect(result.current.panel.id).toBe("yearly"));

    const startingYear = result.current.planner.date.slice(0, 4);
    act(() => result.current.movePlannerPeriod(1));
    expect(result.current.planner.date).toBe(`${Number(startingYear) + 1}-01-01`);
    act(() => result.current.movePlannerPeriod(-1));
    expect(result.current.planner.date).toBe(`${startingYear}-01-01`);

    act(() => result.current.selectTab("monthly"));
    await waitFor(() => expect(result.current.panel.id).toBe("monthly"));
    const monthlyBase = result.current.planner.date;
    act(() => result.current.movePlannerPeriod(1));
    expect(result.current.planner.date).toBe(
      (() => {
        const [year, month] = monthlyBase.split("-").map(Number);
        const nextMonth = new Date(year, month, 1);
        return `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-01`;
      })(),
    );
  });

  it("keeps planner periods independent between tabs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [],
        }),
      ),
    );

    const { result } = renderHook(() => useWorkbenchController());

    act(() => result.current.selectTab("todo"));
    act(() => result.current.selectTab("planner"));
    await waitFor(() => expect(result.current.panel.id).toBe("yearly"));

    const yearlyBase = result.current.planner.date;
    act(() => result.current.movePlannerPeriod(1));
    const movedYearlyDate = result.current.planner.date;
    expect(movedYearlyDate).not.toBe(yearlyBase);

    act(() => result.current.selectTab("monthly"));
    await waitFor(() => expect(result.current.panel.id).toBe("monthly"));
    const monthlyBase = result.current.planner.date;
    expect(monthlyBase).toBe(testMonthStart());

    act(() => result.current.movePlannerPeriod(1));
    const movedMonthlyDate = result.current.planner.date;
    expect(movedMonthlyDate).not.toBe(monthlyBase);

    act(() => result.current.selectTab("yearly"));
    await waitFor(() => expect(result.current.panel.id).toBe("yearly"));
    expect(result.current.planner.date).toBe(movedYearlyDate);

    act(() => result.current.selectTab("monthly"));
    await waitFor(() => expect(result.current.panel.id).toBe("monthly"));
    expect(result.current.planner.date).toBe(movedMonthlyDate);
  });

  it("creates yearly and monthly goals with canonical scheduled anchors", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/goals/propose") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "goal-new",
            type: "goal",
            title: JSON.parse(String(init?.body)).title,
            status: "active",
            horizon: JSON.parse(String(init?.body)).horizon,
            scheduled: JSON.parse(String(init?.body)).scheduled,
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWorkbenchController());

    act(() => result.current.selectTab("todo"));
    act(() => result.current.selectTab("planner"));
    await waitFor(() => expect(result.current.panel.id).toBe("yearly"));

    await act(async () => {
      await result.current.createWorkspaceItem({ title: "Year goal" });
    });
    expect(
      JSON.parse(
        String(
          fetchMock.mock.calls.find(([url]) => url === "/todo-engine/goals/propose")?.[1]
            ?.body,
        ),
      ),
    ).toEqual(
      expect.objectContaining({
        horizon: "year",
        scheduled: `${result.current.planner.date.slice(0, 4)}-01-01`,
      }),
    );

    act(() => result.current.selectTab("monthly"));
    await waitFor(() => expect(result.current.panel.id).toBe("monthly"));
    await act(async () => {
      await result.current.createWorkspaceItem({ title: "Month goal" });
    });
    const goalBodies = fetchMock.mock.calls
      .filter(([url]) => url === "/todo-engine/goals/propose")
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(goalBodies.at(-1)).toEqual(
      expect.objectContaining({
        horizon: "month",
        scheduled: `${result.current.planner.date.slice(0, 7)}-01`,
      }),
    );
  });

  it("resets planner periods to canonical starts for the active panel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [],
        }),
      ),
    );

    const { result } = renderHook(() => useWorkbenchController());

    act(() => result.current.selectTab("todo"));
    act(() => result.current.selectTab("planner"));
    await waitFor(() => expect(result.current.panel.id).toBe("yearly"));

    act(() => result.current.resetPlannerPeriodToToday());
    expect(result.current.planner.date).toBe(testYearStart());

    act(() => result.current.selectTab("monthly"));
    await waitFor(() => expect(result.current.panel.id).toBe("monthly"));
    act(() => result.current.resetPlannerPeriodToToday());
    expect(result.current.planner.date).toBe(testMonthStart());

    act(() => result.current.selectTab("weekly"));
    await waitFor(() => expect(result.current.panel.id).toBe("weekly"));
    act(() => result.current.resetPlannerPeriodToToday());
    expect(result.current.planner.date).toBe(testWeekStart());

    act(() => result.current.selectTab("daily"));
    await waitFor(() => expect(result.current.panel.id).toBe("daily"));
    act(() => result.current.resetPlannerPeriodToToday());
    expect(result.current.planner.date).toBe(formatDate(new Date()));
  });

  it("posts the user-provided scheduled value for events", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/events/propose") {
        expect(init).toEqual(expect.objectContaining({ method: "POST" }));
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "event-new",
            type: "event",
            title: "New event",
            status: "active",
          }),
        });
      }

      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWorkbenchController());

    await act(async () => {
      result.current.selectTab("workspace");
      result.current.selectTab("events");
    });

    await act(async () => {
      await result.current.createWorkspaceItem({
        title: "New event",
        scheduled: "",
      });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/events/propose",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          title: "New event",
          scheduled: "",
          actor: "user",
        }),
      }),
    );
    expect(result.current.detailItem?.id).toBe("event-new");
    expect(result.current.detailItem?.status).toBe("active");
  });

  it("saves the open detail item and updates list state", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/task-1" && init?.method === "PATCH") {
        expect(init).toEqual(
          expect.objectContaining({
            method: "PATCH",
            body: JSON.stringify({ title: "One", note: "Saved note" }),
          }),
        );

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "One",
            status: "active",
            note: "Saved note",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "One", status: "active", note: "Old note" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWorkbenchController());

    await act(async () => {
      result.current.selectTab("workspace");
      result.current.selectTab("tasks");
    });

    await vi.waitFor(() =>
      expect(result.current.workspaceItems.status).toBe("loaded"),
    );

    act(() => result.current.openDetailView(result.current.workspaceItems.items[0]!));
    expect(result.current.detailItem?.note).toBe("Old note");

    await act(async () => {
      await result.current.saveDetailItem({ title: "One", note: "Saved note" });
    });

    expect(result.current.detailItem?.note).toBe("Saved note");
    expect(result.current.workspaceItems.items[0]?.note).toBe("Saved note");
  });

  it("transitions a workspace item and updates list state", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/task-1/complete") {
        expect(init).toEqual(
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({}),
          }),
        );

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "One",
            status: "completed",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "One", status: "active" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWorkbenchController());

    await act(async () => {
      result.current.selectTab("workspace");
      result.current.selectTab("tasks");
    });

    await vi.waitFor(() =>
      expect(result.current.workspaceItems.status).toBe("loaded"),
    );

    await act(async () => {
      await result.current.transitionWorkspaceItem("task-1", "complete");
    });

    expect(result.current.workspaceItems.items[0]?.status).toBe("completed");
    expect(result.current.workspaceItems.allItems[0]?.status).toBe("completed");
  });

  it("replaces the routine and adds materialized tasks to all loaded items", async () => {
    const routine = {
      id: "routine-1",
      type: "routine",
      title: "Review inbox",
      status: "active",
      recurrence_rule: "RRULE:FREQ=DAILY",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/todo-engine/routines/routine-1/materialize") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              routine: { ...routine, last_materialized_at: "2026-07-22T09:00:00Z" },
              created: [
                {
                  id: "task-1",
                  type: "task",
                  title: "Review inbox",
                  status: "active",
                  routine_id: "routine-1",
                },
              ],
            }),
          });
        }
        if (url === "/todo-engine/items?type=routine" || url === "/todo-engine/items") {
          return Promise.resolve({ ok: true, json: async () => [routine] });
        }

        return Promise.resolve({ ok: true, json: async () => [] });
      }),
    );

    const { result } = renderHook(() => useWorkbenchController());

    await act(async () => {
      result.current.selectTab("workspace");
      result.current.selectTab("routines");
    });
    await waitFor(() => expect(result.current.workspaceItems.status).toBe("loaded"));

    await act(async () => {
      await result.current.materializeRoutine("routine-1", { future_occurrences: 1 });
    });

    expect(result.current.workspaceItems.items).toEqual([
      { ...routine, last_materialized_at: "2026-07-22T09:00:00Z" },
    ]);
    expect(result.current.workspaceItems.allItems).toEqual([
      {
        id: "task-1",
        type: "task",
        title: "Review inbox",
        status: "active",
        routine_id: "routine-1",
      },
      { ...routine, last_materialized_at: "2026-07-22T09:00:00Z" },
    ]);
  });

  it("coalesces concurrent transitions for the same workspace item", async () => {
    let resolveTransition!: (value: Response) => void;
    const transitionResponse = new Promise<Response>((resolve) => {
      resolveTransition = resolve;
    });
    const fetchMock = vi.fn((url: string) =>
      url === "/todo-engine/settings/planner"
        ? Promise.resolve({ ok: true, json: async () => null })
        : transitionResponse,
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWorkbenchController());

    let firstTransition!: Promise<void>;
    let duplicateTransition!: Promise<void>;
    act(() => {
      firstTransition = result.current.transitionWorkspaceItem("task-1", "complete");
      duplicateTransition = result.current.transitionWorkspaceItem("task-1", "complete");
    });

    expect(
      fetchMock.mock.calls.filter(
        ([url]) => url === "/todo-engine/items/task-1/complete",
      ),
    ).toHaveLength(1);
    expect(firstTransition).toBe(duplicateTransition);
    expect(result.current.workspaceItemTransitionState("task-1")).toEqual({
      pending: true,
      error: null,
    });
    expect(result.current.workspaceItemTransitionState("task-2")).toEqual({
      pending: false,
      error: null,
    });

    resolveTransition({
      ok: true,
      json: async () => ({
        id: "task-1",
        type: "task",
        title: "One",
        status: "completed",
      }),
    } as Response);
    await act(async () => {
      await Promise.all([firstTransition, duplicateTransition]);
    });
    expect(result.current.workspaceItemTransitionState("task-1")).toEqual({
      pending: false,
      error: null,
    });
  });

  it("uses the fallback error for non-API transition failures", async () => {
    let rejectTransition!: (reason?: unknown) => void;
    const transitionResponse = new Promise<Response>((_, reject) => {
      rejectTransition = reject;
    });
    vi.stubGlobal("fetch", vi.fn(() => transitionResponse));
    const { result } = renderHook(() => useWorkbenchController());

    let transition!: Promise<void>;
    act(() => {
      transition = result.current.transitionWorkspaceItem("task-1", "complete");
    });

    expect(result.current.workspaceItemTransitionState("task-1")).toEqual({
      pending: true,
      error: null,
    });

    await act(async () => {
      rejectTransition(new Error("network unavailable"));
      await expect(transition).rejects.toThrow("network unavailable");
    });

    expect(result.current.workspaceItemTransitionState("task-1")).toEqual({
      pending: false,
      error: "Could not update item.",
    });
  });

  it("reopens a completed workspace item and replaces list state", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/task-1/reopen") {
        expect(init).toEqual(
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({}),
          }),
        );
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-1",
            type: "task",
            title: "One",
            status: "active",
            completed_at: null,
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "One", status: "completed" },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWorkbenchController());

    await act(async () => {
      result.current.selectTab("workspace");
      result.current.selectTab("tasks");
    });
    await vi.waitFor(() => expect(result.current.workspaceItems.status).toBe("loaded"));

    await act(async () => {
      await result.current.transitionWorkspaceItem("task-1", "reopen");
    });

    expect(result.current.workspaceItems.items[0]?.status).toBe("active");
  });
});
