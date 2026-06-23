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
});
