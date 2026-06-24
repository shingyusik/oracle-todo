import { describe, expect, it } from "vitest";

import {
  resolveInitialSelection,
  resolveSelection,
  toggleTodoGroupExpansion,
  toggleWorkspaceExpansion,
  workbenchNavigation,
} from "@/domain/workbench/navigation";

describe("workbench navigation", () => {
  it("starts on dashboard", () => {
    expect(resolveInitialSelection()).toEqual({
      mainTabId: "dashboard",
      leafTabId: "dashboard",
      workspaceExpanded: false,
      plannerExpanded: false,
    });
  });

  it("resolves workspace under todo and opens areas by default", () => {
    expect(resolveSelection("workspace")).toEqual({
      mainTabId: "todo",
      leafTabId: "areas",
      workspaceExpanded: true,
      plannerExpanded: false,
    });
  });

  it("resolves planner to yearly and keeps planner expanded", () => {
    expect(resolveSelection("planner")).toEqual({
      mainTabId: "todo",
      leafTabId: "yearly",
      workspaceExpanded: false,
      plannerExpanded: true,
    });
  });

  it("keeps daily under the todo planner group", () => {
    expect(resolveSelection("daily")).toEqual({
      mainTabId: "todo",
      leafTabId: "daily",
      workspaceExpanded: false,
      plannerExpanded: true,
    });
  });

  it("resolves events and goals under workspace", () => {
    expect(resolveSelection("events")).toEqual({
      mainTabId: "todo",
      leafTabId: "events",
      workspaceExpanded: true,
      plannerExpanded: false,
    });
    expect(resolveSelection("goals")).toEqual({
      mainTabId: "todo",
      leafTabId: "goals",
      workspaceExpanded: true,
      plannerExpanded: false,
    });
  });

  it("collapses workspace children back to the todo panel", () => {
    expect(toggleWorkspaceExpansion(resolveSelection("routines"))).toEqual({
      mainTabId: "todo",
      leafTabId: "todo",
      workspaceExpanded: false,
      plannerExpanded: false,
    });
  });

  it("expands workspace children from the todo panel", () => {
    expect(toggleWorkspaceExpansion(resolveSelection("todo"))).toEqual({
      mainTabId: "todo",
      leafTabId: "areas",
      workspaceExpanded: true,
      plannerExpanded: false,
    });
  });

  it("keeps workspace open when planner opens as another todo group", () => {
    expect(
      toggleTodoGroupExpansion(resolveSelection("workspace"), "planner"),
    ).toEqual({
      mainTabId: "todo",
      leafTabId: "yearly",
      workspaceExpanded: true,
      plannerExpanded: true,
    });
  });

  it("collapses only the requested todo group", () => {
    const bothExpanded = toggleTodoGroupExpansion(
      resolveSelection("workspace"),
      "planner",
    );

    expect(toggleTodoGroupExpansion(bothExpanded, "workspace")).toEqual({
      mainTabId: "todo",
      leafTabId: "yearly",
      workspaceExpanded: false,
      plannerExpanded: true,
    });
    expect(toggleTodoGroupExpansion(bothExpanded, "planner")).toEqual({
      mainTabId: "todo",
      leafTabId: "areas",
      workspaceExpanded: true,
      plannerExpanded: false,
    });
  });

  it("defines the expected top-level tabs", () => {
    expect(workbenchNavigation.mainTabs.map((tab) => tab.id)).toEqual([
      "dashboard",
      "todo",
    ]);
  });

  it("defines workspace and planner as sibling todo tabs", () => {
    expect(workbenchNavigation.todoTabs.map((tab) => tab.id)).toEqual([
      "workspace",
      "planner",
    ]);
    expect(workbenchNavigation.workspaceTabs.map((tab) => tab.id)).toEqual([
      "areas",
      "projects",
      "routines",
      "tasks",
      "events",
      "goals",
    ]);
  });
});
