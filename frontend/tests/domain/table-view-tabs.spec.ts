import { describe, expect, it } from "vitest";

import {
  buildTableViewTabsState,
  createTableViewTab,
  deleteTableViewTab,
  discardTableViewTabDraft,
  renameTableViewTab,
  resetTableViewTabsToFirst,
  saveTableViewTabDraft,
  selectTableViewTab,
  tableViewTabIsDirty,
  updateTableViewTabDraft,
  type TableViewSettingsAdapter,
} from "@/features/workbench/model/table-view-tabs";

type Settings = { order: string[] };

const adapter: TableViewSettingsAdapter<"scope", Settings> = {
  defaultSettings: () => ({ order: ["default"] }),
  normalizeSettings: (_scope, candidate) => ({
    order: Array.isArray((candidate as { order?: unknown })?.order)
      ? [...(candidate as { order: string[] }).order]
      : ["default"],
  }),
  cloneSettings: (settings) => ({ order: [...settings.order] }),
};

describe("table view tabs", () => {
  it("normalizes persisted tabs into an independent first-active state", () => {
    const state = buildTableViewTabsState("scope", {
      tabs: [
        { id: " one ", name: " Table ", settings: { order: ["title"] } },
        { id: "one", name: "table", settings: { order: ["due"] } },
        { id: "", name: "Ignored", settings: { order: ["ignored"] } },
      ],
    }, adapter);

    expect(state.tabs).toEqual([
      { id: "one", name: "Table", settings: { order: ["title"] } },
      { id: "one-2", name: "table 2", settings: { order: ["due"] } },
    ]);
    expect(state.activeTabId).toBe("one");
    expect(state.draftSettings).toEqual({ order: ["title"] });

    state.draftSettings.order.push("mutated");
    expect(state.tabs[0]?.settings).toEqual({ order: ["title"] });
  });

  it("uses a default Table tab when persisted tabs are malformed or empty", () => {
    expect(buildTableViewTabsState("scope", { tabs: "invalid" }, adapter)).toEqual({
      tabs: [{ id: "scope-table", name: "Table", settings: { order: ["default"] } }],
      activeTabId: "scope-table",
      draftSettings: { order: ["default"] },
    });
  });

  it("selects, updates, saves, and compares the active draft", () => {
    const initial = buildTableViewTabsState("scope", {
      tabs: [
        { id: "one", name: "Table", settings: { order: ["title"] } },
        { id: "two", name: "Second", settings: { order: ["due"] } },
      ],
    }, adapter);
    const selected = selectTableViewTab(initial, "two", adapter.cloneSettings);
    const edited = updateTableViewTabDraft(selected, { order: ["status"] }, adapter.cloneSettings);
    const saved = saveTableViewTabDraft(edited, adapter.cloneSettings);

    expect(selected).toMatchObject({ activeTabId: "two", draftSettings: { order: ["due"] } });
    expect(tableViewTabIsDirty(edited, adapter.cloneSettings)).toBe(true);
    expect(saved.tabs[1]?.settings).toEqual({ order: ["status"] });
    expect(tableViewTabIsDirty(saved, adapter.cloneSettings)).toBe(false);
  });

  it("creates uniquely named tabs from the current draft and renames them deterministically", () => {
    const initial = buildTableViewTabsState("scope", undefined, adapter);
    const created = createTableViewTab(initial, " second ", " table ", adapter.cloneSettings)!;
    const renamed = renameTableViewTab(created, "second", " TABLE ")!;

    expect(created.tabs[1]).toEqual({ id: "second", name: "table 2", settings: { order: ["default"] } });
    expect(created.activeTabId).toBe("second");
    expect(renamed.tabs[1]?.name).toBe("TABLE 2");
    expect(createTableViewTab(initial, "scope-table", "Another", adapter.cloneSettings)).toBeNull();
    expect(renameTableViewTab(renamed, "missing", "Other")).toBeNull();
  });

  it("deletes from the active tab to its right neighbor then discards or resets drafts", () => {
    const initial = buildTableViewTabsState("scope", {
      tabs: [
        { id: "one", name: "Table", settings: { order: ["title"] } },
        { id: "two", name: "Second", settings: { order: ["due"] } },
        { id: "three", name: "Third", settings: { order: ["status"] } },
      ],
    }, adapter);
    const afterDelete = deleteTableViewTab(selectTableViewTab(initial, "two", adapter.cloneSettings), "two", adapter.cloneSettings)!;
    const edited = updateTableViewTabDraft(afterDelete, { order: ["changed"] }, adapter.cloneSettings);
    const discarded = discardTableViewTabDraft(edited, adapter.cloneSettings);
    const reset = resetTableViewTabsToFirst(edited, adapter.cloneSettings);

    expect(afterDelete.activeTabId).toBe("three");
    expect(discarded.draftSettings).toEqual({ order: ["status"] });
    expect(reset).toMatchObject({ activeTabId: "one", draftSettings: { order: ["title"] } });
    expect(deleteTableViewTab(buildTableViewTabsState("scope", undefined, adapter), "scope-table", adapter.cloneSettings)).toBeNull();
  });
});
