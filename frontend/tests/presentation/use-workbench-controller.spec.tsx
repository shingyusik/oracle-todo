import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useWorkbenchController } from "@/features/workbench/hooks/useWorkbenchController";

describe("useWorkbenchController", () => {
  it("starts on the dashboard panel", () => {
    const { result } = renderHook(() => useWorkbenchController());

    expect(result.current.selection.leafTabId).toBe("dashboard");
    expect(result.current.panel.title).toBe("Dashboard");
  });

  it("selects areas when workspace is clicked", () => {
    const { result } = renderHook(() => useWorkbenchController());

    act(() => result.current.selectTab("workspace"));

    expect(result.current.selection).toEqual({
      mainTabId: "workspace",
      leafTabId: "areas",
      plannerExpanded: false,
    });
    expect(result.current.panel.title).toBe("Areas");
  });

  it("selects daily under the planner group", () => {
    const { result } = renderHook(() => useWorkbenchController());

    act(() => result.current.selectTab("daily"));

    expect(result.current.selection).toEqual({
      mainTabId: "workspace",
      leafTabId: "daily",
      plannerExpanded: true,
    });
    expect(result.current.panel.title).toBe("Daily");
  });
});
