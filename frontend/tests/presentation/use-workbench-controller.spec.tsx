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

function capturePlannerSettingsWrites(): unknown[] {
  const writes: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
    if (url !== "/api/v1/preferences/planner.v1") {
      return Promise.resolve({ ok: true, json: async () => [] });
    }
    if (!init) {
      return Promise.resolve({ ok: true, json: async () => null });
    }
    writes.push(JSON.parse(String(init.body)).value);
    return Promise.resolve({ ok: true, json: async () => null });
  }));
  return writes;
}

function todoTableRecord(id: string, type = "task") {
  return {
    id, type, title: id, status: "active", tags: [], area_id: null,
    project_id: null, routine_id: null, parent_id: null, description: null,
    note: null, outcome: null, definition_of_done: null, standard: null,
    review_cycle: null, recurrence_rule: null, materialization_policy: "sliding",
    future_occurrences: 7, priority: null, due: null, scheduled: null,
    horizon: null, completed_at: null, last_materialized_at: null,
    created_at: "2026-08-22T01:00:00Z", updated_at: "2026-08-22T01:00:00Z",
    metadata_: { location: null, participants: [], commitment_type: null },
  };
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

  it("pages ToDo table rows independently, dedupes occurrences, and retries the same offset", async () => {
    const record = {
      id: "task-1", type: "task", title: "Ship", status: "active", tags: [],
      area_id: null, project_id: null, routine_id: null, parent_id: null,
      description: null, note: null, outcome: null, definition_of_done: null,
      standard: null, review_cycle: null, recurrence_rule: null,
      materialization_policy: "sliding", future_occurrences: 7, priority: null,
      due: null, scheduled: null, horizon: null, completed_at: null,
      last_materialized_at: null, created_at: "2026-08-22T01:00:00Z",
      updated_at: "2026-08-22T01:00:00Z",
      metadata_: { location: null, participants: [], commitment_type: null },
    };
    let pageCalls = 0;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/table/query") {
        pageCalls += 1;
        const offset = JSON.parse(String(init?.body)).offset;
        if (pageCalls === 2) return Promise.reject(new TypeError("offline"));
        return Promise.resolve(new Response(JSON.stringify({
          items: [{ key: "0::task-1", group_key: null, group_label: null, record }],
          next_offset: offset === 0 ? 50 : null,
        }), { headers: { "content-type": "application/json" } }));
      }
      if (url.startsWith("/api/v1/todo/table/lookups")) return Promise.resolve(new Response(JSON.stringify({ items: [] }), { headers: { "content-type": "application/json" } }));
      if (url.startsWith("/api/v1/preferences/")) return Promise.resolve({ ok: true, json: async () => null });
      return new Promise(() => {});
    }));
    const { result } = renderHook(() => useWorkbenchController());
    const target = { surface: "workspace", scope: "workspace.task" } as const;

    await act(() => result.current.ensureTodoTable(target));
    expect(result.current.todoTablePage(target)).toMatchObject({ items: [{ key: "0::task-1" }], nextOffset: 50 });
    await act(() => result.current.loadMoreTodoTable(target));
    expect(result.current.todoTablePage(target)).toMatchObject({ items: [{ key: "0::task-1" }], nextOffset: 50, moreError: "Could not load more rows." });
    await act(() => result.current.loadMoreTodoTable(target));
    expect(result.current.todoTablePage(target)).toMatchObject({ items: [{ key: "0::task-1" }], nextOffset: null, moreError: null });
    const offsets = (fetch as ReturnType<typeof vi.fn>).mock.calls
      .filter(([url]) => url === "/api/v1/todo/table/query")
      .map(([, init]) => JSON.parse(String(init?.body)).offset);
    expect(offsets).toEqual([0, 50, 50]);
  });

  it("keeps Workspace, Planner, and linked table keys independent and reloads semantic changes", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let failNextWorkspace = false;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/table/query") {
        const body = JSON.parse(String(init?.body));
        bodies.push(body);
        if (failNextWorkspace && body.scope === "workspace.task") {
          failNextWorkspace = false;
          return Promise.reject(new TypeError("offline"));
        }
        const id = `${body.scope}:${body.context.parent_id ?? body.context.from ?? "root"}:${body.filters.length}`;
        return Promise.resolve(new Response(JSON.stringify({
          items: [{ key: `0::${id}`, group_key: null, group_label: null, record: todoTableRecord(id) }],
          next_offset: null,
        }), { headers: { "content-type": "application/json" } }));
      }
      if (url.startsWith("/api/v1/todo/table/lookups")) return Promise.resolve(new Response(JSON.stringify({ items: [] }), { headers: { "content-type": "application/json" } }));
      if (url.startsWith("/api/v1/preferences/")) return Promise.resolve({ ok: true, json: async () => null });
      if (url === "/api/v1/todo/items/task-1") return Promise.resolve({ ok: true, json: async () => ({ id: "task-1", type: "task", title: "changed", status: "active" }) });
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWorkbenchController());
    const workspace = { surface: "workspace", scope: "workspace.task" } as const;
    const planner = { surface: "planner", tableId: "daily.today" } as const;
    const linkedA = { surface: "linked", scope: "linked.project.task", parentType: "project", parentId: "p1" } as const;
    const linkedB = { ...linkedA, parentId: "p2" } as const;

    await act(async () => Promise.all([
      result.current.ensureTodoTable(workspace),
      result.current.ensureTodoTable(planner),
      result.current.ensureTodoTable(linkedA),
    ]));
    expect(result.current.todoTablePage(workspace).items[0]?.record.id).toContain("workspace.task");
    expect(result.current.todoTablePage(planner).items[0]?.record.id).toContain("planner.daily-today");
    expect(result.current.todoTablePage(linkedA).items[0]?.record.id).toContain(":p1:");
    expect(bodies.slice(0, 3).map((body) => body.context)).toEqual([
      expect.objectContaining({ reference_date: expect.any(String) }),
      expect.objectContaining({ from: expect.any(String), to: expect.any(String) }),
      expect.objectContaining({ parent_type: "project", parent_id: "p1" }),
    ]);

    act(() => result.current.updateWorkspaceTableSettings("workspace.task", (settings) => ({
      ...settings,
      filterRules: [{ id: "active", field: "status", type: "select", operator: "is", value: ["active"] }],
    })));
    await act(() => result.current.ensureTodoTable(workspace));
    await act(() => result.current.ensureTodoTable(linkedB));
    expect(bodies.at(-2)).toMatchObject({ scope: "workspace.task", offset: 0, filters: [{ field: "status" }] });
    expect(bodies.at(-1)).toMatchObject({ scope: "linked.project.task", offset: 0, context: { parent_id: "p2" } });

    failNextWorkspace = true;
    const retained = result.current.todoTablePage(workspace).items;
    await act(() => result.current.patchWorkspaceItem("task-1", { title: "changed" }));
    await waitFor(() => expect(result.current.todoTablePage(workspace).moreStatus).toBe("error"));
    expect(result.current.todoTablePage(workspace).items).toEqual(retained);
    await act(() => result.current.ensureTodoTable(workspace));
    expect(bodies.filter((body) => body.scope === "workspace.task")).toHaveLength(4);
    expect(bodies.filter((body) => body.scope === "workspace.task").at(-1)?.offset).toBe(0);
    const legacyNavigationCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/items?type="));
    expect(legacyNavigationCalls).toHaveLength(0);
  });

  it("ignores stale initial and appended pages after table settings change", async () => {
    const pending: Array<(value: Response) => void> = [];
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url === "/api/v1/todo/table/query") {
        return new Promise<Response>((resolve) => pending.push(resolve));
      }
      if (url.startsWith("/api/v1/todo/table/lookups")) return Promise.resolve(new Response(JSON.stringify({ items: [] }), { headers: { "content-type": "application/json" } }));
      if (url.startsWith("/api/v1/preferences/")) return Promise.resolve({ ok: true, json: async () => null });
      return Promise.resolve({ ok: true, json: async () => [] });
    }));
    const page = (id: string, nextOffset: number | null) => new Response(JSON.stringify({
      items: [{ key: `0::${id}`, group_key: null, group_label: null, record: todoTableRecord(id) }],
      next_offset: nextOffset,
    }), { headers: { "content-type": "application/json" } });
    const { result } = renderHook(() => useWorkbenchController());
    const target = { surface: "workspace", scope: "workspace.task" } as const;

    let staleInitial!: Promise<void>;
    act(() => { staleInitial = result.current.ensureTodoTable(target); });
    act(() => result.current.updateWorkspaceTableSettings("workspace.task", (settings) => ({ ...settings, filterMode: "or" })));
    let currentInitial!: Promise<void>;
    act(() => { currentInitial = result.current.ensureTodoTable(target); });
    await act(async () => pending[1]?.(page("current", 50)));
    await currentInitial;
    await act(async () => pending[0]?.(page("stale", null)));
    await staleInitial;
    expect(result.current.todoTablePage(target).items.map((item) => item.record.id)).toEqual(["current"]);

    let staleMore!: Promise<void>;
    act(() => { staleMore = result.current.loadMoreTodoTable(target); });
    act(() => result.current.updateWorkspaceTableSettings("workspace.task", (settings) => ({
      ...settings,
      groupSettings: { ...settings.groupSettings, groupBy: "status" },
    })));
    let newest!: Promise<void>;
    act(() => { newest = result.current.ensureTodoTable(target); });
    await act(async () => pending[3]?.(page("newest", null)));
    await newest;
    await act(async () => pending[2]?.(page("stale-more", null)));
    await staleMore;
    expect(result.current.todoTablePage(target).items.map((item) => item.record.id)).toEqual(["newest"]);
  });

  it("retries an offset-zero failure without changing its page key", async () => {
    let attempts = 0;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url === "/api/v1/todo/table/query") {
        attempts += 1;
        if (attempts === 1) return Promise.reject(new TypeError("offline"));
        return Promise.resolve(new Response(JSON.stringify({
          items: [{ key: "0::recovered", group_key: null, group_label: null, record: todoTableRecord("recovered") }],
          next_offset: null,
        }), { headers: { "content-type": "application/json" } }));
      }
      if (url.startsWith("/api/v1/todo/table/lookups")) return Promise.resolve(new Response(JSON.stringify({ items: [] }), { headers: { "content-type": "application/json" } }));
      if (url.startsWith("/api/v1/preferences/")) return Promise.resolve({ ok: true, json: async () => null });
      return Promise.resolve({ ok: true, json: async () => [] });
    }));
    const { result } = renderHook(() => useWorkbenchController());
    const target = { surface: "workspace", scope: "workspace.task" } as const;
    await act(() => result.current.ensureTodoTable(target));
    expect(result.current.todoTablePage(target)).toMatchObject({ nextOffset: 0, moreStatus: "error", moreError: "Could not load rows." });
    await act(() => result.current.ensureTodoTable(target));
    expect(result.current.todoTablePage(target)).toMatchObject({ items: [{ key: "0::recovered" }], nextOffset: null, moreStatus: "idle", moreError: null });
  });

  it("opens Task creation only after navigation reaches the Tasks leaf", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => [] })));
    const { result } = renderHook(() => useWorkbenchController());

    act(() => result.current.openTaskCreation());

    await waitFor(() => {
      expect(result.current.selection.leafTabId).toBe("tasks");
      expect(result.current.creationDialogOpen).toBe(true);
    });
  });

  it("keeps Task creation pending through dirty navigation confirmation", async () => {
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => [] })));
    const { result } = renderHook(() => useWorkbenchController());
    await waitFor(() => expect(result.current.workspaceItems.status).toBe("loaded"));

    act(() => result.current.selectTab("projects"));
    await waitFor(() => expect(result.current.selection.leafTabId).toBe("projects"));
    act(() => {
      expect(
        result.current.createWorkspaceTableTab("workspace.project", "Focus"),
      ).toBe(true);
      result.current.updateWorkspaceTableSettings(
        "workspace.project",
        (settings) => ({ ...settings, filterMode: "or" }),
      );
      result.current.openTaskCreation();
    });

    expect(result.current.selection.leafTabId).toBe("projects");
    expect(result.current.creationDialogOpen).toBe(false);
    expect(result.current.tableViewTabConfirmation).toMatchObject({
      kind: "navigate",
      targetSelection: { leafTabId: "tasks" },
    });

    act(() => result.current.confirmTableViewTabAction());
    await waitFor(() => {
      expect(result.current.selection.leafTabId).toBe("tasks");
      expect(result.current.creationDialogOpen).toBe(true);
    });
  });

  it("loads all items when the initial Dashboard is selected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items"
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
    expect(fetch).toHaveBeenCalledWith("/api/v1/todo/items");
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

  it.each([
    [
      "daily",
      { kind: "daily", date: "2026-07-25" },
      "daily.today",
      "weekly.day-grid",
    ],
    [
      "daily-overdue",
      { kind: "daily-overdue", date: "2026-07-26" },
      "daily.overdue",
      "weekly.day-grid",
    ],
    [
      "weekly",
      { kind: "weekly", weekStart: "2026-07-20" },
      "weekly.day-grid",
      "daily.today",
    ],
  ] as const)(
    "resets visible Planner tabs on Dashboard %s re-entry",
    (kind, destination, targetTableId, unrelatedTableId) => {
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init?: RequestInit) =>
          init?.method === "PUT"
            ? Promise.resolve({ ok: true, json: async () => null })
            : new Promise(() => {})
        ),
      );
      const { result } = renderHook(() => useWorkbenchController());
      const targetLeaf = kind === "weekly" ? "weekly" : "daily";

      act(() => result.current.selectTab(targetLeaf));
      act(() => {
        result.current.createPlannerTableTab(targetTableId, "Second");
        result.current.createPlannerTableTab(unrelatedTableId, "Unrelated");
      });
      const targetSecondId =
        result.current.plannerTableTabs(targetTableId).tabs[1]!.id;
      const unrelatedSecondId =
        result.current.plannerTableTabs(unrelatedTableId).tabs[1]!.id;
      expect(result.current.plannerTableTabs(targetTableId).activeTabId).toBe(
        targetSecondId,
      );

      act(() => result.current.selectTab("dashboard"));
      expect(result.current.selection.leafTabId).toBe("dashboard");
      expect(result.current.plannerTabConfirmation).toBeNull();

      act(() => result.current.navigateDashboard(destination));

      expect(result.current.selection.leafTabId).toBe(targetLeaf);
      expect(result.current.plannerTabConfirmation).toBeNull();
      if (kind === "weekly") {
        expect(result.current.planner.weeklyDate).toBe(destination.weekStart);
      } else {
        expect(result.current.planner.dailyDate).toBe(destination.date);
      }
      const visibleTableIds = targetLeaf === "weekly"
        ? [
            "weekly.month-goals",
            "weekly.week-goals",
            "weekly.day-grid",
          ] as const
        : [
            "daily.today",
            "daily.overdue",
            "daily.unscheduled",
          ] as const;
      for (const tableId of visibleTableIds) {
        const tableTabs = result.current.plannerTableTabs(tableId);
        expect(tableTabs.activeTabId).toBe(tableTabs.tabs[0]?.id);
        expect(tableTabs.draftSettings).toEqual(tableTabs.tabs[0]?.settings);
      }
      expect(
        result.current.plannerTableTabs(unrelatedTableId).activeTabId,
      ).toBe(unrelatedSecondId);
    },
  );

  it("opens an Area detail from the Dashboard snapshot without refetching items", async () => {
    const fetchMock = vi.fn((url: string) => Promise.resolve({
      ok: true,
      json: async () => url === "/api/v1/todo/items"
        ? [{ id: "area-1", type: "area", title: "Health", status: "active" }]
        : [],
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWorkbenchController());
    await waitFor(() =>
      expect(result.current.workspaceItems.status).toBe("loaded"),
    );

    const itemCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/v1/todo/items").length;
    act(() =>
      result.current.navigateDashboard({
        kind: "area-detail",
        itemId: "area-1",
      }),
    );

    expect(result.current.selection.leafTabId).toBe("areas");
    await waitFor(() => expect(result.current.detailItem?.id).toBe("area-1"));
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/v1/todo/items")).toHaveLength(itemCalls);
  });

  it("waits for the target list refresh before opening a Project detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items"
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

  it("does not refetch Dashboard detail data after navigation", async () => {
    let requestMode: "dashboard" | "area-failure" | "projects" = "dashboard";
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/v1/todo/items" && requestMode === "area-failure") {
          return Promise.reject(new Error("unavailable"));
        }

        return Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items" && requestMode === "projects"
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
    await waitFor(() => expect(result.current.workspaceItems.status).toBe("loaded"));

    requestMode = "projects";
    act(() => result.current.selectTab("projects"));
    await waitFor(() =>
      expect(result.current.workspaceItems.status).toBe("loaded"),
    );

    expect(result.current.detailItem).toBeNull();
  });

  it("clears a Dashboard detail when navigating to another workspace", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        return Promise.resolve({
          ok: true,
          json: async () => url === "/api/v1/todo/items"
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

    act(() =>
      result.current.navigateDashboard({
        kind: "area-detail",
        itemId: "area-1",
      }),
    );
    await waitFor(() => expect(result.current.detailItem?.id).toBe("area-1"));

    act(() => result.current.selectTab("projects"));
    await waitFor(() =>
      expect(result.current.workspaceItems.status).toBe("loaded"),
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
      fetchMock.mock.calls.filter(([url]) => url === "/api/v1/todo/items");

    await waitFor(() => expect(allItemCalls()).toHaveLength(1));
    act(() => result.current.reloadDashboard());
    await waitFor(() => expect(allItemCalls()).toHaveLength(2));
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).startsWith("/api/v1/todo/items?type="),
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
            url === "/api/v1/preferences/planner.v1" ? savedPreferences : [],
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
          json: async () => url === "/api/v1/preferences/planner.v1"
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
      vi.fn((url: string) => url === "/api/v1/preferences/planner.v1"
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
        url === "/api/v1/preferences/planner.v1" && !init
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

  it("replays early saved edits and tab creation over a delayed stored tab document", async () => {
    let resolveSettings:
      | ((value: { ok: boolean; json: () => Promise<unknown> }) => void)
      | undefined;
    const writes: unknown[] = [];
    const storedSettings = defaultPlannerTableSettings("daily.today");
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url !== "/api/v1/preferences/planner.v1") {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (!init) {
        return new Promise((resolve) => {
          resolveSettings = resolve;
        });
      }
      writes.push(JSON.parse(String(init.body)).value);
      return Promise.resolve({ ok: true, json: async () => null });
    }));

    const { result } = renderHook(() => useWorkbenchController());
    await waitFor(() => expect(resolveSettings).toBeDefined());
    const initialTabId =
      result.current.plannerTableTabs("daily.today").activeTabId;

    act(() => {
      result.current.updatePlannerTableSettings("daily.today", (settings) => ({
        ...settings,
        filterMode: "or",
      }));
      result.current.savePlannerTableTab("daily.today");
      expect(result.current.renamePlannerTableTab(
        "daily.today",
        initialTabId,
        "Renamed stored",
      )).toBe(true);
      expect(result.current.createPlannerTableTab("daily.today", "Early")).toBe(true);
    });

    expect(writes).toHaveLength(0);
    await act(async () => resolveSettings?.({
      ok: true,
      json: async () => ({
        tableTabs: {
          "daily.today": {
            tabs: [
              { id: "stored-one", name: "Stored one", settings: storedSettings },
              { id: "stored-two", name: "Stored two", settings: storedSettings },
            ],
          },
        },
      }),
    }));

    await waitFor(() =>
      expect(
        result.current.plannerTableTabs("daily.today").tabs.map(({ name }) => name),
      ).toEqual(["Renamed stored", "Stored two", "Early"]),
    );
    expect(
      result.current.plannerTableTabs("daily.today").tabs[0]?.settings.filterMode,
    ).toBe("or");
    expect(
      result.current.plannerTableTabs("daily.today").tabs[1]?.settings.filterMode,
    ).toBe("and");
    expect(result.current.plannerTableSettings("daily.today").filterMode).toBe("or");
    await waitFor(() => expect(writes).toHaveLength(3));
    expect(
      (writes.at(-1) as {
        tableTabs: Record<string, { tabs: Array<{ name: string }> }>;
      }).tableTabs["daily.today"]?.tabs.map(({ name }) => name),
    ).toEqual(["Renamed stored", "Stored two", "Early"]);
  });

  it("replays and persists queued tab commands after the initial settings load fails", async () => {
    let rejectSettings: ((reason: Error) => void) | undefined;
    const writes: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url !== "/api/v1/preferences/planner.v1") {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (!init) {
        return new Promise((_resolve, reject) => {
          rejectSettings = reject;
        });
      }
      writes.push(JSON.parse(String(init.body)).value);
      return Promise.resolve({ ok: true, json: async () => null });
    }));

    const { result } = renderHook(() => useWorkbenchController());
    await waitFor(() => expect(rejectSettings).toBeDefined());

    act(() => {
      result.current.updatePlannerTableSettings("daily.today", (settings) => ({
        ...settings,
        filterMode: "or",
      }));
      result.current.savePlannerTableTab("daily.today");
      expect(result.current.createPlannerTableTab("daily.today", "Offline")).toBe(true);
    });
    expect(writes).toHaveLength(0);

    await act(async () => rejectSettings?.(new Error("offline")));

    await waitFor(() => expect(writes).toHaveLength(2));
    expect(
      result.current.plannerTableTabs("daily.today").tabs.map(({ name }) => name),
    ).toEqual(["Table", "Offline"]);
    expect(result.current.plannerTableTabs("daily.today").tabs[0]?.settings.filterMode).toBe(
      "or",
    );
    expect(
      (writes.at(-1) as {
        tableTabs: Record<string, { tabs: Array<{ name: string }> }>;
      }).tableTabs["daily.today"]?.tabs.map(({ name }) => name),
    ).toEqual(["Table", "Offline"]);
  });

  it.each(["resolve", "reject"] as const)(
    "does not persist queued tab commands after unmount when settings %s",
    async (settlement) => {
      let resolveSettings:
        | ((value: { ok: boolean; json: () => Promise<unknown> }) => void)
        | undefined;
      let rejectSettings: ((reason: Error) => void) | undefined;
      const writes: unknown[] = [];
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
        if (url !== "/api/v1/preferences/planner.v1") {
          return Promise.resolve({ ok: true, json: async () => [] });
        }
        if (!init) {
          return new Promise((resolve, reject) => {
            resolveSettings = resolve;
            rejectSettings = reject;
          });
        }
        writes.push(JSON.parse(String(init.body)).value);
        return Promise.resolve({ ok: true, json: async () => null });
      }));
      const hook = renderHook(() => useWorkbenchController());

      act(() => {
        expect(hook.result.current.createPlannerTableTab(
          "daily.today",
          "Queued",
        )).toBe(true);
      });
      expect(writes).toHaveLength(0);
      hook.unmount();

      await act(async () => {
        if (settlement === "resolve") {
          resolveSettings?.({ ok: true, json: async () => null });
        } else {
          rejectSettings?.(new Error("offline"));
        }
      });

      expect(writes).toHaveLength(0);
      expect(consoleError).not.toHaveBeenCalled();
    },
  );

  it("migrates tableSettings into one Table tab and persists only saved tabs", async () => {
    const writes: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url !== "/api/v1/preferences/planner.v1") {
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

  it("requires discard confirmation before switching a dirty tab", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        init?.method === "PUT"
          ? Promise.resolve({ ok: true, json: async () => null })
          : new Promise(() => {})
      ),
    );
    const { result } = renderHook(() => useWorkbenchController());
    act(() => {
      result.current.createPlannerTableTab("daily.today", "Second");
      result.current.updatePlannerTableSettings("daily.today", (settings) => ({
        ...settings,
        filterMode: "or",
      }));
    });
    const firstId = result.current.plannerTableTabs("daily.today").tabs[0]!.id;

    act(() => result.current.selectPlannerTableTab("daily.today", firstId));
    expect(result.current.plannerTabConfirmation).toEqual({
      kind: "select",
      tableId: "daily.today",
      targetTabId: firstId,
    });
    expect(result.current.plannerTableTabs("daily.today").activeTabId).not.toBe(firstId);

    act(() => result.current.cancelPlannerTabAction());
    expect(result.current.plannerTabConfirmation).toBeNull();

    act(() => result.current.selectPlannerTableTab("daily.today", firstId));
    act(() => result.current.confirmPlannerTabAction());
    expect(result.current.plannerTableTabs("daily.today").activeTabId).toBe(firstId);
    expect(result.current.plannerTableIsDirty("daily.today")).toBe(false);
  });

  it("reconciles a pending tab selection target after delayed stored tabs load", async () => {
    let resolveSettings:
      | ((value: { ok: boolean; json: () => Promise<unknown> }) => void)
      | undefined;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url !== "/api/v1/preferences/planner.v1") {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      if (!init) {
        return new Promise((resolve) => {
          resolveSettings = resolve;
        });
      }
      return Promise.resolve({ ok: true, json: async () => null });
    }));
    const { result } = renderHook(() => useWorkbenchController());
    const optimisticDefaultId =
      result.current.plannerTableTabs("daily.today").activeTabId;

    act(() => {
      result.current.createPlannerTableTab("daily.today", "Second");
      result.current.updatePlannerTableSettings("daily.today", (settings) => ({
        ...settings,
        filterMode: "or",
      }));
      result.current.selectPlannerTableTab("daily.today", optimisticDefaultId);
    });
    expect(result.current.plannerTabConfirmation).toEqual({
      kind: "select",
      tableId: "daily.today",
      targetTabId: optimisticDefaultId,
    });

    await waitFor(() => expect(resolveSettings).toBeDefined());
    await act(async () => resolveSettings?.({
      ok: true,
      json: async () => ({
        tableTabs: {
          "daily.today": {
            tabs: [
              { id: "stored-one", name: "Stored one", settings: {} },
              { id: "stored-two", name: "Stored two", settings: {} },
            ],
          },
        },
      }),
    }));

    expect(result.current.plannerTabConfirmation).toEqual({
      kind: "select",
      tableId: "daily.today",
      targetTabId: "stored-one",
    });
  });

  it("discards every dirty table on the departing Planner screen", () => {
    const { result } = renderHook(() => useWorkbenchController());
    act(() => result.current.selectTab("daily"));
    act(() => {
      result.current.updatePlannerTableSettings("daily.today", (settings) => ({
        ...settings,
        filterMode: "or",
      }));
      result.current.updatePlannerTableSettings("daily.overdue", (settings) => ({
        ...settings,
        filterMode: "or",
      }));
    });

    act(() => result.current.selectTab("weekly"));
    expect(result.current.selection.leafTabId).toBe("daily");
    expect(result.current.plannerTabConfirmation?.kind).toBe("navigate");

    act(() => result.current.confirmPlannerTabAction());
    expect(result.current.selection.leafTabId).toBe("weekly");
    expect(result.current.plannerTableIsDirty("daily.today")).toBe(false);
    expect(result.current.plannerTableIsDirty("daily.overdue")).toBe(false);
  });

  it("activates the first table tabs whenever a Planner screen is entered", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) =>
        init?.method === "PUT"
          ? Promise.resolve({ ok: true, json: async () => null })
          : new Promise(() => {})
      ),
    );
    const { result } = renderHook(() => useWorkbenchController());
    act(() => result.current.selectTab("weekly"));
    act(() => {
      result.current.createPlannerTableTab("weekly.day-grid", "Second");
    });
    expect(result.current.plannerTableTabs("weekly.day-grid").activeTabId).toBe(
      result.current.plannerTableTabs("weekly.day-grid").tabs[1]?.id,
    );

    act(() => result.current.selectTab("daily"));
    act(() => result.current.selectTab("weekly"));

    for (const tableId of [
      "weekly.month-goals",
      "weekly.week-goals",
      "weekly.day-grid",
    ] as const) {
      const tableTabs = result.current.plannerTableTabs(tableId);
      expect(tableTabs.activeTabId).toBe(tableTabs.tabs[0]?.id);
      expect(tableTabs.draftSettings).toEqual(tableTabs.tabs[0]?.settings);
    }
  });

  it("serializes persisted tab mutations so the latest full document wins", async () => {
    const pendingWrites: Array<() => void> = [];
    let serverSettings: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url !== "/api/v1/preferences/planner.v1") {
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

  it("keeps consecutive same-table commands in one React batch", async () => {
    const writes = capturePlannerSettingsWrites();
    const { result } = renderHook(() => useWorkbenchController());

    act(() => {
      expect(result.current.createPlannerTableTab("daily.today", "Focus")).toBe(true);
      expect(result.current.createPlannerTableTab("daily.today", "Deep")).toBe(true);
    });

    expect(
      result.current.plannerTableTabs("daily.today").tabs.map(({ name }) => name),
    ).toEqual(["Table", "Focus", "Deep"]);
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(
      (writes[1] as {
        tableTabs: Record<string, { tabs: Array<{ name: string }> }>;
      }).tableTabs["daily.today"]?.tabs.map(({ name }) => name),
    ).toEqual(["Table", "Focus", "Deep"]);
  });

  it("keeps consecutive cross-table commands in one React batch", async () => {
    const writes = capturePlannerSettingsWrites();
    const { result } = renderHook(() => useWorkbenchController());

    act(() => {
      expect(result.current.createPlannerTableTab("daily.today", "Focus")).toBe(true);
      expect(result.current.createPlannerTableTab("daily.overdue", "Recovery")).toBe(true);
    });

    expect(result.current.plannerTableTabs("daily.today").tabs).toHaveLength(2);
    expect(result.current.plannerTableTabs("daily.overdue").tabs).toHaveLength(2);
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(
      (writes[1] as {
        tableTabs: Record<string, { tabs: Array<{ name: string }> }>;
      }).tableTabs["daily.today"]?.tabs.map(({ name }) => name),
    ).toEqual(["Table", "Focus"]);
    expect(
      (writes[1] as {
        tableTabs: Record<string, { tabs: Array<{ name: string }> }>;
      }).tableTabs["daily.overdue"]?.tabs.map(({ name }) => name),
    ).toEqual(["Table", "Recovery"]);
  });

  it("saves a draft edited immediately before save in one React batch", async () => {
    const writes = capturePlannerSettingsWrites();
    const { result } = renderHook(() => useWorkbenchController());

    act(() => {
      result.current.updatePlannerTableSettings("daily.today", (settings) => ({
        ...settings,
        filterMode: "or",
      }));
      result.current.savePlannerTableTab("daily.today");
    });

    expect(result.current.plannerTableSettings("daily.today").filterMode).toBe("or");
    expect(result.current.plannerTableIsDirty("daily.today")).toBe(false);
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(
      (writes[0] as {
        tableTabs: Record<string, { tabs: Array<{ settings: { filterMode: string } }> }>;
      }).tableTabs["daily.today"]?.tabs[0]?.settings.filterMode,
    ).toBe("or");
  });

  it("keeps session tabs after a failed write and retries the full document", async () => {
    const bodies: unknown[] = [];
    let putCount = 0;
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => {
      if (url !== "/api/v1/preferences/planner.v1") {
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
      ledgerExpanded: false,
      healthExpanded: false,
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
      ledgerExpanded: false,
      healthExpanded: false,
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
            url === "/api/v1/preferences/planner.v1" ? null : [],
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
        if (url !== "/api/v1/preferences/planner.v1") {
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
      ledgerExpanded: false,
      healthExpanded: false,
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
      ledgerExpanded: false,
      healthExpanded: false,
    });
    expect(result.current.panel.title).toBe("ToDo");

    act(() => result.current.toggleWorkspaceExpansion());

    expect(result.current.selection).toEqual({
      mainTabId: "todo",
      leafTabId: "areas",
      workspaceExpanded: true,
      plannerExpanded: false,
      ledgerExpanded: false,
      healthExpanded: false,
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
      ledgerExpanded: false,
      healthExpanded: false,
    });

    act(() => result.current.selectTab("workspace"));

    expect(result.current.selection).toEqual({
      mainTabId: "todo",
      leafTabId: "yearly",
      workspaceExpanded: false,
      plannerExpanded: true,
      ledgerExpanded: false,
      healthExpanded: false,
    });

    act(() => result.current.selectTab("planner"));

    expect(result.current.selection).toEqual({
      mainTabId: "todo",
      leafTabId: "todo",
      workspaceExpanded: false,
      plannerExpanded: false,
      ledgerExpanded: false,
      healthExpanded: false,
    });
  });

  it.each([
    ["daily"],
    ["weekly"],
    ["monthly"],
    ["yearly"],
  ] as const)(
    "does not eagerly load planner item sets for %s",
    async (tabId) => {
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

      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/items?type="))).toBe(false);
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
      "/api/v1/todo/items/task-1/archive",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.current.workspaceItems.allItems.map((item) => item.id)).toEqual(["task-2"]);
    expect(result.current.selectedItemIds).toEqual([]);
    expect(result.current.archiveConfirmationOpen).toBe(false);
  });

  it("keeps failed archive rows selected while removing successful rows", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/v1/todo/items/task-1/archive") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ id: "task-1", status: "archived" }),
        });
      }
      if (url === "/api/v1/todo/items/task-2/archive") {
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
      if (url === "/api/v1/todo/items/event-1") {
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
      if (url === "/api/v1/todo/items/task-1") {
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
        if (url === "/api/v1/todo/tasks/propose") {
          return Promise.resolve({
            ok: true,
            json: async () => ({ id: "task-new", type: "task", title: "New", status: "active" }),
          });
        }
        if (url === "/api/v1/todo/items?type=task" || url === "/api/v1/todo/items") {
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
          if (url === "/api/v1/todo/items") {
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

          return url === "/api/v1/todo/items?type=task"
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
            if (url === "/api/v1/todo/items?type=area") {
              return [{ id: "area-1", type: "area", title: "Health", status: "active" }];
            }
            if (url === "/api/v1/todo/items") {
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

    await waitFor(() => expect(result.current.workspaceItems.allItems).toHaveLength(3));

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
        const type = String(url).match(
          /\/api\/v1\/todo\/(tasks|events|projects|routines)\/propose/,
        )?.[1];
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
        `/api/v1/todo/${panel}/propose`,
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
      if (url === "/api/v1/todo/goals/propose") {
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
      "/api/v1/todo/goals/propose",
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
      if (url === "/api/v1/todo/tasks/propose") {
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
      if (url === "/api/v1/todo/events/propose") {
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
      if (url === "/api/v1/todo/goals/propose") {
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
      if (url === "/api/v1/todo/goals/propose") {
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
      if (url === "/api/v1/todo/goals/propose") {
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
      if (url === "/api/v1/todo/tasks/propose") {
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
      if (url === "/api/v1/todo/events/propose") {
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
        message: "Event is not allowed for weekly.week-goals.",
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
      if (url === "/api/v1/todo/tasks/propose") {
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
      scheduled: testMonthStart(),
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
      if (url === "/api/v1/todo/goals/propose") {
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
          fetchMock.mock.calls.find(([url]) => url === "/api/v1/todo/goals/propose")?.[1]
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
      .filter(([url]) => url === "/api/v1/todo/goals/propose")
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
      if (url === "/api/v1/todo/events/propose") {
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
      "/api/v1/todo/events/propose",
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
      if (url === "/api/v1/todo/items/task-1" && init?.method === "PATCH") {
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
      if (url === "/api/v1/todo/items/task-1/complete") {
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

  it("removes an archived detail item from active workspace state", async () => {
    const task = {
      id: "task-1",
      type: "task",
      title: "One",
      status: "active",
      area_id: "area-1",
    };
    const area = {
      id: "area-1",
      type: "area",
      title: "Focus",
      status: "active",
    };
    const archivedTask = {
      ...task,
      title: "Canonical One",
      status: "archived",
    };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-1/archive") {
        expect(init).toEqual(
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({}),
          }),
        );
        return Promise.resolve({
          ok: true,
          json: async () => archivedTask,
        });
      }
      if (url === "/api/v1/todo/items?type=task") {
        return Promise.resolve({ ok: true, json: async () => [task] });
      }
      if (url === "/api/v1/todo/items?type=area") {
        return Promise.resolve({ ok: true, json: async () => [area] });
      }
      if (url === "/api/v1/todo/items") {
        return Promise.resolve({ ok: true, json: async () => [task, area] });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWorkbenchController());

    await act(async () => {
      result.current.selectTab("workspace");
      result.current.selectTab("tasks");
    });
    await waitFor(() =>
      expect(result.current.workspaceItems.status).toBe("loaded"),
    );

    act(() => {
      result.current.openDetailView(task);
      result.current.toggleItemSelection("task-1");
    });

    await act(async () => {
      await result.current.transitionWorkspaceItem("task-1", "archive");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/items/task-1/archive",
      expect.objectContaining({ body: JSON.stringify({}) }),
    );
    expect(result.current.selection.leafTabId).toBe("tasks");
    expect(result.current.detailItem).toEqual(archivedTask);
    expect(result.current.workspaceItems.items.map(({ id }) => id)).toEqual([]);
    expect(result.current.workspaceItems.allItems.map(({ id }) => id)).toEqual([
      "area-1",
    ]);
    expect(result.current.selectedItemIds).toEqual([]);
    expect(result.current.workspaceItems.relatedItems.areas).toEqual({
      "area-1": "Focus",
    });
  });

  it("rebuilds area relations after archiving an Area detail item", async () => {
    const areaOne = {
      id: "area-1",
      type: "area",
      title: "One",
      status: "active",
    };
    const areaTwo = {
      id: "area-2",
      type: "area",
      title: "Two",
      status: "active",
    };
    const archivedArea = {
      ...areaOne,
      title: "Canonical One",
      status: "archived",
    };
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/v1/todo/items/area-1/archive") {
        return Promise.resolve({
          ok: true,
          json: async () => archivedArea,
        });
      }
      if (url === "/api/v1/todo/items?type=area" || url === "/api/v1/todo/items") {
        return Promise.resolve({
          ok: true,
          json: async () => [areaOne, areaTwo],
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWorkbenchController());

    await act(async () => {
      result.current.selectTab("workspace");
      result.current.selectTab("areas");
    });
    await waitFor(() =>
      expect(result.current.workspaceItems.status).toBe("loaded"),
    );

    act(() => {
      result.current.openDetailView(areaOne);
      result.current.toggleItemSelection("area-1");
    });

    await act(async () => {
      await result.current.transitionWorkspaceItem("area-1", "archive");
    });

    expect(result.current.selection.leafTabId).toBe("areas");
    expect(result.current.detailItem).toEqual(archivedArea);
    expect(result.current.workspaceItems.items.map(({ id }) => id)).toEqual([
      "area-2",
    ]);
    expect(result.current.workspaceItems.allItems.map(({ id }) => id)).toEqual([
      "area-2",
    ]);
    expect(result.current.selectedItemIds).toEqual([]);
    expect(result.current.workspaceItems.relatedItems.areas).toEqual({
      "area-2": "Two",
    });
  });

  it("marks a Planner item missed without removing it from the loaded collection", async () => {
    const source = {
      id: "task-1",
      type: "task",
      title: "One",
      status: "active",
      scheduled: "2026-07-25",
      tags: ["focus"],
    };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-1/miss") {
        expect(init).toEqual(
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({}),
          }),
        );
        return Promise.resolve({
          ok: true,
          json: async () => ({ ...source, status: "missed" }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => url === "/api/v1/todo/items" ? [source] : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWorkbenchController());

    await act(async () => {
      result.current.selectTab("planner");
      result.current.selectTab("daily");
    });
    await waitFor(() => expect(result.current.workspaceItems.status).toBe("loaded"));
    act(() => result.current.openDetailView(source));

    await act(async () => {
      await result.current.missWorkspaceItem(source.id);
    });

    expect(result.current.selection.leafTabId).toBe("daily");
    expect(result.current.workspaceItems.items).toEqual([
      expect.objectContaining({ id: source.id, status: "missed" }),
    ]);
    expect(result.current.workspaceItems.allItems).toEqual([
      expect.objectContaining({ id: source.id, status: "missed" }),
    ]);
    expect(result.current.detailItem).toEqual(
      expect.objectContaining({ id: source.id, status: "missed" }),
    );
  });

  it("postpones with an explicit date and reconciles an existing follow-up in place", async () => {
    const source = {
      id: "task-1",
      type: "task",
      title: "One",
      status: "active",
      scheduled: "2026-07-25",
    };
    const staleFollowUp = {
      id: "task-2",
      type: "task",
      title: "Stale follow-up",
      status: "active",
      scheduled: "2026-07-26",
    };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-1/postpone") {
        expect(init).toEqual(
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              today: formatDate(new Date()),
              scheduled: "2026-07-26",
            }),
          }),
        );
        return Promise.resolve({
          ok: true,
          json: async () => ({
            source: { ...source, status: "missed" },
            follow_up: { ...staleFollowUp, title: "Current follow-up" },
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () =>
          url === "/api/v1/todo/items" ? [source, staleFollowUp] : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWorkbenchController());

    await act(async () => {
      result.current.selectTab("planner");
      result.current.selectTab("daily");
    });
    await waitFor(() => expect(result.current.workspaceItems.status).toBe("loaded"));
    act(() => result.current.openDetailView(staleFollowUp));

    await act(async () => {
      await result.current.postponeWorkspaceItem(source.id, "2026-07-26");
    });

    expect(result.current.selection.leafTabId).toBe("daily");
    expect(result.current.workspaceItems.items).toHaveLength(2);
    expect(result.current.workspaceItems.items).toEqual([
      expect.objectContaining({ id: source.id, status: "missed" }),
      expect.objectContaining({ id: staleFollowUp.id, title: "Current follow-up" }),
    ]);
    expect(result.current.workspaceItems.allItems).toHaveLength(2);
    expect(result.current.detailItem).toEqual(
      expect.objectContaining({
        id: staleFollowUp.id,
        title: "Current follow-up",
      }),
    );
  });

  it("postpones a workspace item and synchronizes the source and follow-up once", async () => {
    const source = {
      id: "task-1",
      type: "task",
      title: "One",
      status: "active",
      scheduled: "2026-07-24",
      tags: ["focus"],
    };
    const followUp = {
      id: "task-2",
      type: "task",
      title: "One",
      status: "active",
      scheduled: "2026-07-25",
      tags: ["next"],
    };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-1/postpone") {
        expect(init).toEqual(
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              today: formatDate(new Date()),
              scheduled: "2026-07-25",
            }),
          }),
        );
        return Promise.resolve({
          ok: true,
          json: async () => ({
            source: { ...source, status: "missed", tags: ["focus", "deferred"] },
            follow_up: followUp,
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [source],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWorkbenchController());

    await act(async () => {
      result.current.selectTab("workspace");
      result.current.selectTab("tasks");
    });
    await waitFor(() => expect(result.current.workspaceItems.status).toBe("loaded"));
    act(() => result.current.openDetailView(source));

    await act(async () => {
      await result.current.postponeWorkspaceItem("task-1", "2026-07-25");
    });

    expect(result.current.workspaceItems.items.map((item) => item.id)).toEqual([
      "task-1",
      "task-2",
    ]);
    expect(result.current.workspaceItems.allItems.map((item) => item.id)).toEqual([
      "task-1",
      "task-2",
    ]);
    expect(result.current.workspaceItems.items[0]?.status).toBe("missed");
    expect(result.current.workspaceItems.tagOptions).toEqual([
      "deferred",
      "focus",
      "next",
    ]);
    expect(result.current.detailItem?.status).toBe("missed");
  });

  it("keeps a linked postponed task out of the current routines collection", async () => {
    const routine = {
      id: "routine-1",
      type: "routine",
      title: "Daily review",
      status: "active",
    };
    const linkedTask = {
      id: "task-1",
      type: "task",
      title: "Daily review task",
      status: "active",
      routine_id: "routine-1",
    };
    const followUp = {
      ...linkedTask,
      id: "task-2",
      routine_id: null,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url === "/api/v1/todo/items/task-1/postpone") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              source: { ...linkedTask, status: "missed" },
              follow_up: followUp,
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/todo/items?type=routine"
              ? [routine]
              : url === "/api/v1/todo/items"
                ? [routine, linkedTask]
                : [],
        });
      }),
    );
    const { result } = renderHook(() => useWorkbenchController());

    await act(async () => {
      result.current.selectTab("workspace");
      result.current.selectTab("routines");
    });
    await waitFor(() => expect(result.current.workspaceItems.status).toBe("loaded"));
    act(() => result.current.openDetailView(linkedTask));

    await act(async () => {
      await result.current.postponeWorkspaceItem(linkedTask.id, "2026-07-25");
    });

    expect(result.current.workspaceItems.items.map((item) => item.id)).toEqual([
      routine.id,
    ]);
    expect(result.current.workspaceItems.allItems.map((item) => item.id)).toEqual([
      routine.id,
      linkedTask.id,
      followUp.id,
    ]);
    expect(result.current.detailItem?.status).toBe("missed");
  });

  it("posts an explicit date when postponing a workspace item", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/todo/items/task-1/postpone") {
        expect(init).toEqual(
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              today: formatDate(new Date()),
              scheduled: "2026-08-01",
            }),
          }),
        );
        return Promise.resolve({
          ok: true,
          json: async () => ({
            source: {
              id: "task-1",
              type: "task",
              title: "One",
              status: "missed",
            },
            follow_up: {
              id: "task-2",
              type: "task",
              title: "One",
              status: "active",
              scheduled: "2026-08-01",
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWorkbenchController());

    await act(async () => {
      await result.current.postponeWorkspaceItem("task-1", "2026-08-01");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/todo/items/task-1/postpone",
      expect.objectContaining({
        body: JSON.stringify({
          today: formatDate(new Date()),
          scheduled: "2026-08-01",
        }),
      }),
    );
  });

  it("exposes postpone API errors through the workspace item transition state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          url === "/api/v1/todo/items/task-1/postpone"
            ? {
                ok: false,
                status: 400,
                json: async () => ({
                  code: "validation_error",
                  message: "scheduled must be in the future",
                  fields: { scheduled: ["must be in the future"] },
                  request_id: "00000000-0000-4000-8000-000000000001",
                }),
              }
            : { ok: true, json: async () => [] },
        ),
      ),
    );
    const { result } = renderHook(() => useWorkbenchController());

    await act(async () => {
      await expect(
        result.current.postponeWorkspaceItem("task-1", "2026-07-25"),
      ).rejects.toThrow("scheduled must be in the future");
    });

    expect(result.current.workspaceItemTransitionState("task-1")).toEqual({
      pending: false,
      error: "scheduled must be in the future",
    });
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
        if (url === "/api/v1/todo/routines/routine-1/materialize") {
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
        if (url === "/api/v1/todo/items?type=routine" || url === "/api/v1/todo/items") {
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
      url === "/api/v1/preferences/planner.v1"
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
        ([url]) => url === "/api/v1/todo/items/task-1/complete",
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
      if (url === "/api/v1/todo/items/task-1/reopen") {
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

  it("loads Workspace views independently and isolates malformed scopes", async () => {
    const storedTaskSettings = {
      filterMode: "or",
      filterRules: [
        {
          id: "stored-task-filter",
          field: "title",
          type: "text",
          operator: "contains",
          value: "focus",
        },
      ],
      sortRules: [
        { id: "stored-task-sort", field: "title", direction: "asc" },
      ],
      groupSettings: {
        groupBy: "status",
        sort: "alphabetical",
        hideEmpty: false,
        manualOrder: [],
        hiddenGroupKeys: [],
      },
    };
    const storedDetailSettings = {
      ...storedTaskSettings,
      filterRules: [
        {
          id: "stored-detail-filter",
          field: "title",
          type: "text",
          operator: "contains",
          value: "linked",
        },
      ],
    };
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () => {
          if (url === "/api/v1/preferences/workspace.views.v1") {
            return {
              "workspace.task": {
                tabs: [
                  {
                    id: "stored-task",
                    name: "Stored task",
                    settings: storedTaskSettings,
                  },
                ],
              },
              "workspace.project": "malformed",
              "detail.area.task": {
                tabs: [
                  {
                    id: "stored-detail",
                    name: "Stored detail",
                    settings: storedDetailSettings,
                  },
                ],
              },
            };
          }
          return url === "/api/v1/preferences/planner.v1" ? null : [];
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWorkbenchController());

    await waitFor(() =>
      expect(result.current.workspaceTableTabs("workspace.task").activeTabId).toBe(
        "stored-task",
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/preferences/planner.v1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/preferences/workspace.views.v1",
    );
    expect(result.current.workspaceTableSettings("workspace.task")).toEqual(
      storedTaskSettings,
    );
    expect(result.current.workspaceTableTabs("workspace.project").tabs[0]?.name)
      .toBe("Table");
    expect(result.current.workspaceTableTabs("detail.area.task").activeTabId)
      .toBe("stored-detail");
    expect(result.current.workspaceTableSettings("detail.area.task")).toEqual(
      storedDetailSettings,
    );
  });

  it("persists Workspace and Planner view commands to independent endpoints", async () => {
    const writes: Array<{ url: string; value: unknown }> = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        writes.push({
          url,
          value: JSON.parse(String(init.body)).value,
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () =>
          url === "/api/v1/preferences/planner.v1" ||
          url === "/api/v1/preferences/workspace.views.v1"
            ? null
            : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWorkbenchController());
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/preferences/workspace.views.v1",
      ),
    );

    act(() => {
      result.current.updateWorkspaceTableSettings(
        "workspace.task",
        (settings) => ({ ...settings, filterMode: "or" }),
      );
      result.current.saveWorkspaceTableTab("workspace.task");
    });
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.url).toBe("/api/v1/preferences/workspace.views.v1");
    expect(writes[0]?.value).toHaveProperty("workspace.task");
    expect(writes[0]?.value).not.toHaveProperty("tableTabs");

    act(() => {
      expect(result.current.createPlannerTableTab("daily.today", "Planner"))
        .toBe(true);
    });
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]?.url).toBe("/api/v1/preferences/planner.v1");
    expect(writes[1]?.value).toHaveProperty("tableTabs");
    expect(writes[1]?.value).not.toHaveProperty("workspace.task");
  });

  it("replays delayed Workspace commands and serializes the final stored document", async () => {
    let resolveWorkspaceSettings:
      | ((value: { ok: boolean; json: () => Promise<unknown> }) => void)
      | undefined;
    const pendingWorkspaceWrites: Array<() => void> = [];
    let serverWorkspaceSettings: unknown;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/v1/preferences/workspace.views.v1") {
        if (!init) {
          return new Promise((resolve) => {
            resolveWorkspaceSettings = resolve;
          });
        }
        const value = JSON.parse(String(init.body)).value;
        return new Promise((resolve) => {
          pendingWorkspaceWrites.push(() => {
            serverWorkspaceSettings = value;
            resolve({ ok: true, json: async () => value });
          });
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () =>
          url === "/api/v1/preferences/planner.v1" ? null : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWorkbenchController());
    await waitFor(() => expect(resolveWorkspaceSettings).toBeDefined());
    const optimisticDefaultId =
      result.current.workspaceTableTabs("workspace.task").activeTabId;

    act(() => {
      result.current.updateWorkspaceTableSettings(
        "workspace.task",
        (settings) => ({ ...settings, filterMode: "or" }),
      );
      result.current.saveWorkspaceTableTab("workspace.task");
      expect(
        result.current.renameWorkspaceTableTab(
          "workspace.task",
          optimisticDefaultId,
          "Renamed stored",
        ),
      ).toBe(true);
      expect(
        result.current.createWorkspaceTableTab("workspace.task", "Early"),
      ).toBe(true);
    });
    expect(pendingWorkspaceWrites).toHaveLength(0);

    await act(async () => resolveWorkspaceSettings?.({
      ok: true,
      json: async () => ({
        "workspace.task": {
          tabs: [
            { id: "stored-one", name: "Stored one", settings: {} },
            { id: "stored-two", name: "Stored two", settings: {} },
          ],
        },
      }),
    }));

    await waitFor(() => expect(pendingWorkspaceWrites).toHaveLength(1));
    expect(
      result.current.workspaceTableTabs("workspace.task").tabs.map(
        ({ name }) => name,
      ),
    ).toEqual(["Renamed stored", "Stored two", "Early"]);
    expect(
      result.current.workspaceTableTabs("workspace.task").tabs[0]?.settings
        .filterMode,
    ).toBe("or");
    expect(
      result.current.workspaceTableTabs("workspace.task").tabs[1]?.settings
        .filterMode,
    ).toBe("and");

    await act(async () => pendingWorkspaceWrites.shift()?.());
    await waitFor(() => expect(pendingWorkspaceWrites).toHaveLength(1));
    await act(async () => pendingWorkspaceWrites.shift()?.());
    await waitFor(() => expect(pendingWorkspaceWrites).toHaveLength(1));
    await act(async () => pendingWorkspaceWrites.shift()?.());

    expect(serverWorkspaceSettings).toMatchObject({
      "workspace.task": {
        tabs: [
          { name: "Renamed stored", settings: { filterMode: "or" } },
          { name: "Stored two", settings: { filterMode: "and" } },
          { name: "Early", settings: { filterMode: "or" } },
        ],
      },
    });
  });

  it("keeps item loading and local default views when preference requests fail", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (
        url === "/api/v1/preferences/planner.v1" ||
        url === "/api/v1/preferences/workspace.views.v1"
      ) {
        return Promise.reject(new Error("preferences unavailable"));
      }
      return Promise.resolve({
        ok: true,
        json: async () =>
          url === "/api/v1/todo/items"
            ? [{ id: "task-1", type: "task", title: "One", status: "active" }]
            : [],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useWorkbenchController());

    await waitFor(() => expect(result.current.workspaceItems.status).toBe("loaded"));
    expect(result.current.workspaceItems.allItems).toHaveLength(1);
    expect(result.current.workspaceTableTabs("workspace.task").tabs).toEqual([
      expect.objectContaining({
        id: "workspace.task-table",
        name: "Table",
      }),
    ]);
    expect(result.current.workspaceTableSettings("workspace.task")).toMatchObject({
      filterMode: "and",
      filterRules: [],
      sortRules: [{ field: "updated", direction: "desc" }],
    });
  });

  it("supports Workspace tab commands and shared confirmations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/preferences/planner.v1" ||
            url === "/api/v1/preferences/workspace.views.v1"
              ? null
              : [],
        }),
      ),
    );
    const { result } = renderHook(() => useWorkbenchController());
    await waitFor(() => expect(result.current.workspaceItems.status).toBe("loaded"));

    expect(result.current.createWorkspaceTableTab("workspace.task", "")).toBe(false);
    expect(
      result.current.renameWorkspaceTableTab(
        "workspace.task",
        "unknown",
        "Unknown",
      ),
    ).toBe(false);
    act(() => {
      expect(
        result.current.createWorkspaceTableTab("workspace.task", "Focus"),
      ).toBe(true);
    });
    const firstId =
      result.current.workspaceTableTabs("workspace.task").tabs[0]!.id;
    const focusId =
      result.current.workspaceTableTabs("workspace.task").activeTabId;

    act(() => {
      expect(
        result.current.renameWorkspaceTableTab(
          "workspace.task",
          focusId,
          "Table",
        ),
      ).toBe(true);
      result.current.updateWorkspaceTableSettings(
        "workspace.task",
        (settings) => ({ ...settings, filterMode: "or" }),
      );
    });
    expect(
      result.current.workspaceTableTabs("workspace.task").tabs[1]?.name,
    ).toBe("Table 2");
    expect(result.current.workspaceTableIsDirty("workspace.task")).toBe(true);

    act(() =>
      result.current.selectWorkspaceTableTab("workspace.task", firstId),
    );
    expect(result.current.tableViewTabConfirmation).toEqual({
      kind: "select",
      target: { surface: "workspace", scope: "workspace.task" },
      targetTabId: firstId,
    });
    act(() => result.current.cancelTableViewTabAction());
    expect(result.current.tableViewTabConfirmation).toBeNull();

    act(() =>
      result.current.selectWorkspaceTableTab("workspace.task", firstId),
    );
    act(() => result.current.confirmTableViewTabAction());
    expect(result.current.workspaceTableTabs("workspace.task").activeTabId)
      .toBe(firstId);
    expect(result.current.workspaceTableIsDirty("workspace.task")).toBe(false);

    act(() =>
      result.current.requestDeleteWorkspaceTableTab(
        "workspace.task",
        focusId,
      ),
    );
    expect(result.current.tableViewTabConfirmation).toEqual({
      kind: "delete",
      target: { surface: "workspace", scope: "workspace.task" },
      targetTabId: focusId,
    });
    act(() => result.current.confirmTableViewTabAction());
    expect(result.current.workspaceTableTabs("workspace.task").tabs).toHaveLength(1);

    act(() => {
      result.current.updateWorkspaceTableSettings(
        "workspace.task",
        (settings) => ({ ...settings, filterMode: "or" }),
      );
      result.current.saveWorkspaceTableTab("workspace.task");
    });
    expect(result.current.workspaceTableIsDirty("workspace.task")).toBe(false);

    act(() => {
      result.current.selectTab("workspace");
      result.current.selectTab("tasks");
      result.current.updateWorkspaceTableSettings(
        "workspace.task",
        (settings) => ({ ...settings, filterMode: "and" }),
      );
    });
    act(() => result.current.selectTab("projects"));
    expect(result.current.selection.leafTabId).toBe("tasks");
    expect(result.current.tableViewTabConfirmation).toMatchObject({
      kind: "navigate",
      dirtyTargets: [
        { surface: "workspace", scope: "workspace.task" },
      ],
      targetSelection: { leafTabId: "projects" },
    });
    act(() => result.current.confirmTableViewTabAction());
    expect(result.current.selection.leafTabId).toBe("projects");
    expect(result.current.workspaceTableIsDirty("workspace.task")).toBe(false);
  });

  it("keeps Planner state unchanged across Workspace confirmation actions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url === "/api/v1/preferences/planner.v1" ||
            url === "/api/v1/preferences/workspace.views.v1"
              ? null
              : [],
        }),
      ),
    );
    const { result } = renderHook(() => useWorkbenchController());
    await waitFor(() => expect(result.current.workspaceItems.status).toBe("loaded"));

    act(() => {
      expect(
        result.current.createPlannerTableTab("daily.today", "Planner sentinel"),
      ).toBe(true);
      result.current.updatePlannerTableSettings("daily.today", (settings) => ({
        ...settings,
        filterMode: "or",
      }));
      expect(
        result.current.createWorkspaceTableTab("workspace.task", "Workspace"),
      ).toBe(true);
      result.current.updateWorkspaceTableSettings(
        "workspace.task",
        (settings) => ({ ...settings, filterMode: "or" }),
      );
    });
    const plannerSentinel = JSON.parse(JSON.stringify(
      result.current.plannerTableTabs("daily.today"),
    ));
    const workspaceTabs = result.current.workspaceTableTabs("workspace.task");
    const firstWorkspaceId = workspaceTabs.tabs[0]!.id;
    const secondWorkspaceId = workspaceTabs.activeTabId;

    act(() =>
      result.current.selectWorkspaceTableTab(
        "workspace.task",
        firstWorkspaceId,
      ),
    );
    expect(result.current.tableViewTabConfirmation).toMatchObject({
      kind: "select",
      target: { surface: "workspace", scope: "workspace.task" },
    });
    act(() => result.current.confirmTableViewTabAction());
    expect(result.current.plannerTableTabs("daily.today")).toEqual(
      plannerSentinel,
    );

    act(() =>
      result.current.requestDeleteWorkspaceTableTab(
        "workspace.task",
        secondWorkspaceId,
      ),
    );
    expect(result.current.tableViewTabConfirmation).toMatchObject({
      kind: "delete",
      target: { surface: "workspace", scope: "workspace.task" },
    });
    act(() => result.current.confirmTableViewTabAction());
    expect(result.current.plannerTableTabs("daily.today")).toEqual(
      plannerSentinel,
    );
  });

  it("toggles selection from the currently visible Workspace row ids", async () => {
    const tasks = [
      { id: "task-1", type: "task", title: "One", status: "active" },
      { id: "task-2", type: "task", title: "Two", status: "active" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () =>
            url.startsWith("/api/v1/todo/items") ? tasks : null,
        }),
      ),
    );
    const { result } = renderHook(() => useWorkbenchController());
    act(() => {
      result.current.selectTab("workspace");
      result.current.selectTab("tasks");
    });
    await waitFor(() => expect(result.current.workspaceItems.items).toHaveLength(2));

    act(() => {
      result.current.setVisibleWorkspaceItemIds(["task-2"]);
      result.current.toggleVisibleSelection();
    });

    expect(result.current.selectedItemIds).toEqual(["task-2"]);
  });

  it("clears visible ids and selection when the Workspace panel changes", async () => {
    const tasks = [
      { id: "task-1", type: "task", title: "One", status: "active" },
      { id: "task-2", type: "task", title: "Two", status: "active" },
    ];
    const projects = [
      { id: "project-1", type: "project", title: "Project", status: "active" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => {
            if (url === "/api/v1/todo/items?type=task") return tasks;
            if (url === "/api/v1/todo/items?type=project") return projects;
            if (url === "/api/v1/todo/items") return [...tasks, ...projects];
            return url === "/api/v1/preferences/planner.v1" ||
              url === "/api/v1/preferences/workspace.views.v1"
              ? null
              : [];
          },
        }),
      ),
    );
    const { result } = renderHook(() => useWorkbenchController());
    act(() => {
      result.current.selectTab("workspace");
      result.current.selectTab("tasks");
    });
    await waitFor(() =>
      expect(result.current.workspaceItems.items.map(({ id }) => id)).toEqual([
        "task-1",
        "task-2",
      ]),
    );
    act(() => {
      result.current.setVisibleWorkspaceItemIds(["task-2"]);
      result.current.toggleVisibleSelection();
    });
    expect(result.current.selectedItemIds).toEqual(["task-2"]);

    act(() => result.current.selectTab("projects"));
    await waitFor(() =>
      expect(result.current.workspaceItems.items.map(({ id }) => id)).toEqual([
        "project-1",
      ]),
    );
    expect(result.current.selectedItemIds).toEqual([]);

    act(() => result.current.toggleVisibleSelection());
    expect(result.current.selectedItemIds).toEqual([]);
  });
});
