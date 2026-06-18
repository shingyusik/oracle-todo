import { describe, expect, it } from "vitest";

import {
  resolveInitialSelection,
  resolveSelection,
  workbenchNavigation,
} from "@/domain/workbench/navigation";

describe("workbench navigation", () => {
  it("starts on dashboard", () => {
    expect(resolveInitialSelection()).toEqual({
      mainTabId: "dashboard",
      leafTabId: "dashboard",
      plannerExpanded: false,
    });
  });

  it("resolves workspace to areas by default", () => {
    expect(resolveSelection("workspace")).toEqual({
      mainTabId: "workspace",
      leafTabId: "areas",
      plannerExpanded: false,
    });
  });

  it("resolves planner to yearly and keeps planner expanded", () => {
    expect(resolveSelection("planner")).toEqual({
      mainTabId: "workspace",
      leafTabId: "yearly",
      plannerExpanded: true,
    });
  });

  it("keeps daily under the workspace planner group", () => {
    expect(resolveSelection("daily")).toEqual({
      mainTabId: "workspace",
      leafTabId: "daily",
      plannerExpanded: true,
    });
  });

  it("defines the expected top-level tabs", () => {
    expect(workbenchNavigation.mainTabs.map((tab) => tab.id)).toEqual([
      "dashboard",
      "todo",
      "workspace",
    ]);
  });
});
