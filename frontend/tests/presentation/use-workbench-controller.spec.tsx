import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkbenchController } from "@/features/workbench/hooks/useWorkbenchController";

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

  it("hydrates planner group settings after the deterministic first render", async () => {
    window.localStorage.setItem(
      "oracle-todo.planner-group-settings.v1.daily",
      JSON.stringify({ groupBy: "tag", sort: "alphabetical", hideEmpty: false }),
    );

    const { result } = renderHook(() => useWorkbenchController());

    await waitFor(() =>
      expect(result.current.planner.groupSettings.daily).toMatchObject({
        groupBy: "tag",
        sort: "alphabetical",
        hideEmpty: false,
      }),
    );
  });

  it("recovers malformed saved group settings independently per planner view", async () => {
    window.localStorage.setItem("oracle-todo.planner-group-settings.v1.daily", "{");
    window.localStorage.setItem(
      "oracle-todo.planner-group-settings.v1.weekly",
      JSON.stringify({ groupBy: "status", sort: "manual", hideEmpty: true }),
    );

    const { result } = renderHook(() => useWorkbenchController());

    await waitFor(() =>
      expect(result.current.planner.groupSettings.weekly.groupBy).toBe("status"),
    );
    expect(result.current.planner.groupSettings.daily.groupBy).toBe("none");
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

  it("stores planner advanced filter rules", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          json: async () => (url === "/todo-engine/items?type=task" ? [] : []),
        }),
      ),
    );

    const { result } = renderHook(() => useWorkbenchController());

    act(() => {
      result.current.setPlannerFilterMode("or");
      result.current.setPlannerFilterRules([
        { id: "r1", field: "title", type: "text", operator: "contains", value: "plan" },
      ]);
    });

    expect(result.current.planner.filterMode).toBe("or");
    expect(result.current.planner.filterRules).toHaveLength(1);

    act(() => result.current.clearPlannerFilterRules());

    expect(result.current.planner.filterMode).toBe("and");
    expect(result.current.planner.filterRules).toEqual([]);
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
          { id: "task-1", type: "task", title: "One", status: "approved" },
          { id: "task-2", type: "task", title: "Two", status: "approved" },
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
          { id: "task-1", type: "task", title: "One", status: "approved" },
          { id: "task-2", type: "task", title: "Two", status: "approved" },
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
            status: "approved",
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
          { id: "event-1", type: "event", title: "Review", status: "approved" },
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

  it("creates a task from the active workspace table and opens it", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/tasks/propose") {
        expect(init).toEqual(expect.objectContaining({ method: "POST" }));
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-new",
            type: "task",
            title: "New task",
            status: "approved",
          }),
        });
      }
      if (url === "/todo-engine/items/task-new/activate") {
        expect(init).toEqual(expect.objectContaining({ method: "POST" }));
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "task-new",
            type: "task",
            title: "New task",
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
      result.current.selectTab("tasks");
    });

    act(() => result.current.openCreationDialog());
    expect(result.current.creationDialogOpen).toBe(true);

    await act(async () => {
      await result.current.createWorkspaceItem({ title: "New task" });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/tasks/propose",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ title: "New task", actor: "user" }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/task-new/activate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(result.current.detailItem?.id).toBe("task-new");
    expect(result.current.detailItem?.status).toBe("active");
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
            status: "approved",
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
            status: "approved",
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
            status: "approved",
          }),
        });
      }
      if (url === "/todo-engine/items/event-new/activate") {
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
            status: "approved",
            note: "Saved note",
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "One", status: "approved", note: "Old note" },
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
      if (url === "/todo-engine/items/task-1/activate") {
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
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => [
          { id: "task-1", type: "task", title: "One", status: "approved" },
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
      await result.current.transitionWorkspaceItem("task-1", "activate");
    });

    expect(result.current.workspaceItems.items[0]?.status).toBe("active");
  });

  it("coalesces concurrent transitions for the same workspace item", async () => {
    let resolveTransition!: (value: Response) => void;
    const transitionResponse = new Promise<Response>((resolve) => {
      resolveTransition = resolve;
    });
    const fetchMock = vi.fn(() => transitionResponse);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWorkbenchController());

    let firstTransition!: Promise<void>;
    let duplicateTransition!: Promise<void>;
    act(() => {
      firstTransition = result.current.transitionWorkspaceItem("task-1", "complete");
      duplicateTransition = result.current.transitionWorkspaceItem("task-1", "complete");
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
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
