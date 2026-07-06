import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkbenchController } from "@/features/workbench/hooks/useWorkbenchController";

describe("useWorkbenchController", () => {
  beforeEach(() => {
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
    ["monthly", ["goal", "area", "project"]],
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
            scheduled: "2026-07-06",
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
          scheduled: "2026-07-06",
          actor: "user",
        }),
      }),
    );
    expect(result.current.detailItem?.id).toBe("goal-new");
    expect(result.current.workspaceItems.items[0]).toMatchObject({
      id: "goal-new",
      horizon: "week",
      scheduled: "2026-07-06",
    });
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
});
