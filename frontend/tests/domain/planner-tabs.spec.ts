import { describe, expect, it } from "vitest";

import {
  buildPlannerTabsState,
  createPlannerTab,
  deletePlannerTab,
  discardPlannerTabDraft,
  plannerTabIsDirty,
  renamePlannerTab,
  resetPlannerTabsToFirst,
  savePlannerTabDraft,
  selectPlannerTab,
  updatePlannerTabDraft,
} from "@/features/workbench/model/planner-tabs";
import { defaultPlannerGroupSettings } from "@/features/workbench/model/planner-group-settings";
import { defaultPlannerTableSettings } from "@/features/workbench/model/planner-model";
import type { LegacyPlannerControls } from "@/features/workbench/model/workbench-model";

function legacyPlannerControls(): LegacyPlannerControls {
  return {
    filterMode: "and",
    filterRules: [],
    groupSettings: {
      yearly: defaultPlannerGroupSettings(),
      monthly: defaultPlannerGroupSettings(),
      weekly: defaultPlannerGroupSettings(),
      daily: defaultPlannerGroupSettings(),
    },
    dailySortRules: [],
    yearlySortRules: [],
    monthlySortRules: [],
    weeklySortRules: [],
  };
}

describe("planner table tabs", () => {
  it("migrates each legacy table setting into one editable Table tab", () => {
    const today = {
      ...defaultPlannerTableSettings("daily.today"),
      filterMode: "or" as const,
    };
    const state = buildPlannerTabsState(
      undefined,
      { "daily.today": today },
      legacyPlannerControls(),
    );

    expect(state["daily.today"]).toMatchObject({
      activeTabId: "daily.today-table",
      tabs: [{ id: "daily.today-table", name: "Table", settings: today }],
      draftSettings: today,
    });
    expect(state["daily.overdue"].tabs).toHaveLength(1);
  });

  it("keeps at least one tab and repairs duplicate names and ids", () => {
    const settings = defaultPlannerTableSettings("daily.today");
    const state = buildPlannerTabsState({
      "daily.today": {
        tabs: [
          { id: "same", name: "Focus", settings },
          { id: "same", name: "focus", settings },
        ],
      },
      "daily.overdue": { tabs: [] },
    }, undefined, legacyPlannerControls());

    expect(state["daily.today"].tabs.map(({ name }) => name)).toEqual(["Focus", "focus 2"]);
    expect(new Set(state["daily.today"].tabs.map(({ id }) => id)).size).toBe(2);
    expect(state["daily.overdue"].tabs).toHaveLength(1);
    expect(state["daily.overdue"].tabs[0]?.name).toBe("Table");
  });

  it("uses fresh defaults for a malformed persisted tab map", () => {
    const legacy = legacyPlannerControls();
    legacy.filterMode = "or";

    const state = buildPlannerTabsState({ unrelated: true }, undefined, legacy);

    expect(state["daily.today"].tabs[0]?.settings).toEqual(
      defaultPlannerTableSettings("daily.today"),
    );
  });

  it("keeps edits in the draft until explicitly saved", () => {
    const initial = buildPlannerTabsState(undefined, undefined, legacyPlannerControls())["daily.today"];
    const edited = updatePlannerTabDraft(initial, {
      ...initial.draftSettings,
      filterMode: "or",
    });

    expect(plannerTabIsDirty(edited)).toBe(true);
    expect(edited.tabs[0]?.settings.filterMode).toBe("and");
    expect(savePlannerTabDraft(edited).tabs[0]?.settings.filterMode).toBe("or");
    expect(plannerTabIsDirty(savePlannerTabDraft(edited))).toBe(false);
  });

  it("copies the current draft and protects the one-tab minimum", () => {
    const initial = buildPlannerTabsState(undefined, undefined, legacyPlannerControls())["daily.today"];
    const created = createPlannerTab(initial, "new-id", "새 보기");

    expect(created?.tabs).toHaveLength(2);
    expect(created?.activeTabId).toBe("new-id");
    expect(created?.tabs[1]?.settings).toEqual(initial.draftSettings);
    expect(deletePlannerTab(initial, initial.activeTabId)).toBeNull();
    expect(deletePlannerTab(created!, "new-id")?.tabs).toHaveLength(1);
  });

  it("selects the saved settings for the requested tab", () => {
    const initial = buildPlannerTabsState(undefined, undefined, legacyPlannerControls())["daily.today"];
    const created = createPlannerTab(initial, "second", "Second")!;
    const selected = selectPlannerTab(created, initial.activeTabId);

    expect(selected.activeTabId).toBe(initial.activeTabId);
    expect(selected.draftSettings).toEqual(initial.draftSettings);
  });

  it("discards the active tab draft without changing its saved settings", () => {
    const initial = buildPlannerTabsState(undefined, undefined, legacyPlannerControls())["daily.today"];
    const edited = updatePlannerTabDraft(initial, {
      ...initial.draftSettings,
      filterMode: "or",
    });

    expect(discardPlannerTabDraft(edited).draftSettings).toEqual(initial.tabs[0]?.settings);
  });

  it("trims renamed tabs and resolves name collisions", () => {
    const initial = buildPlannerTabsState(undefined, undefined, legacyPlannerControls())["daily.today"];
    const created = createPlannerTab(initial, "second", "Second")!;
    const renamed = renamePlannerTab(created, initial.activeTabId, " second ")!;

    expect(renamed.tabs[0]?.name).toBe("second 2");
    expect(renamePlannerTab(renamed, "missing", "Other")).toBeNull();
  });

  it("activates the right neighbor, then the left neighbor, after deleting the active tab", () => {
    const initial = buildPlannerTabsState(undefined, undefined, legacyPlannerControls())["daily.today"];
    const withSecond = createPlannerTab(initial, "second", "Second")!;
    const withThird = createPlannerTab(withSecond, "third", "Third")!;
    const afterMiddle = deletePlannerTab(selectPlannerTab(withThird, "second"), "second")!;
    const afterLast = deletePlannerTab(selectPlannerTab(afterMiddle, "third"), "third")!;

    expect(afterMiddle.activeTabId).toBe("third");
    expect(afterLast.activeTabId).toBe(initial.activeTabId);
  });

  it("resets re-entry to the saved first tab", () => {
    const initial = buildPlannerTabsState(undefined, undefined, legacyPlannerControls())["daily.today"];
    const created = createPlannerTab(initial, "second", "Second")!;
    const edited = updatePlannerTabDraft(created, {
      ...created.draftSettings,
      filterMode: "or",
    });
    const reset = resetPlannerTabsToFirst(edited);

    expect(reset.activeTabId).toBe(reset.tabs[0]?.id);
    expect(reset.draftSettings).toEqual(reset.tabs[0]?.settings);
    expect(plannerTabIsDirty(reset)).toBe(false);
  });
});
