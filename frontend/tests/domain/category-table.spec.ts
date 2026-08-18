import { describe, expect, it } from "vitest";

import type {
  TransactionCategory,
  TransactionCategoryKind,
} from "@/features/ledger/model/ledger-model";
import {
  categoryParentOptions,
  deriveCategoryGroups,
} from "@/features/ledger/model/category-table";
import { defaultLedgerTableSettings } from "@/features/ledger/model/ledger-table-views";
import type { PlannerTableSettings } from "@/features/workbench/model/planner-model";

function category(
  id: string,
  overrides: Partial<TransactionCategory> = {},
): TransactionCategory {
  return {
    id,
    name: id,
    parentId: null,
    kind: "expense",
    active: true,
    ...overrides,
  };
}

function categorySettings(
  patch: Omit<Partial<PlannerTableSettings>, "groupSettings"> & {
    groupSettings?: Partial<PlannerTableSettings["groupSettings"]>;
  } = {},
): PlannerTableSettings {
  const defaults = defaultLedgerTableSettings("ledger.categories");
  const { groupSettings, ...settings } = patch;
  return {
    ...defaults,
    ...settings,
    groupSettings: {
      ...defaults.groupSettings,
      ...groupSettings,
    },
  };
}

const categories: TransactionCategory[] = [
  category("category-expenses", { name: "Expenses" }),
  category("category-food", {
    name: "Food",
    parentId: "category-expenses",
  }),
  category("category-dining", {
    name: "Dining",
    parentId: "category-food",
  }),
  category("category-salary", {
    name: "Salary",
    kind: "income",
  }),
  category("category-bonus", {
    name: "Bonus",
    parentId: "category-salary",
    kind: "income",
  }),
  category("category-archived", {
    name: "Archived",
    active: false,
  }),
];

function rowIds(settings = categorySettings()): string[] {
  return deriveCategoryGroups(categories, settings)
    .flatMap((group) => group.rows.map((row) => row.id));
}

describe("deriveCategoryGroups", () => {
  it("projects only active categories with type and parent labels", () => {
    const [group] = deriveCategoryGroups(categories, categorySettings());

    expect(group).toEqual({
      key: "all",
      label: null,
      rows: [
        expect.objectContaining({
          id: "category-bonus",
          name: "Bonus",
          kind: "income",
          kindLabel: "Income",
          parentId: "category-salary",
          parentLabel: "Salary",
        }),
        expect.objectContaining({ id: "category-dining", parentLabel: "Food" }),
        expect.objectContaining({ id: "category-expenses", parentLabel: "No parent" }),
        expect.objectContaining({ id: "category-food", parentLabel: "Expenses" }),
        expect.objectContaining({ id: "category-salary", parentLabel: "No parent" }),
      ],
    });
  });

  it.each([
    [
      "name",
      { id: "name", field: "name", type: "text", operator: "contains", value: "food" },
      ["category-food"],
    ],
    [
      "type value",
      { id: "kind", field: "kind", type: "select", operator: "is", value: ["income"] },
      ["category-bonus", "category-salary"],
    ],
    [
      "type label",
      { id: "kind-label", field: "kind", type: "select", operator: "is", value: ["Expense"] },
      ["category-dining", "category-expenses", "category-food"],
    ],
    [
      "parent id",
      { id: "parent", field: "parent", type: "relation", operator: "is", value: ["category-expenses"] },
      ["category-food"],
    ],
    [
      "parent label",
      { id: "parent-label", field: "parent", type: "relation", operator: "is", value: ["Salary"] },
      ["category-bonus"],
    ],
  ] as const)("filters by %s", (_name, filterRule, expected) => {
    expect(rowIds(categorySettings({
      filterRules: [filterRule as PlannerTableSettings["filterRules"][number]],
    }))).toEqual(expected);
  });

  it("combines category filters with AND and OR semantics", () => {
    const filterRules: PlannerTableSettings["filterRules"] = [{
      id: "name",
      field: "name",
      type: "text",
      operator: "contains",
      value: "food",
    }, {
      id: "kind",
      field: "kind",
      type: "select",
      operator: "is",
      value: ["income"],
    }];

    expect(rowIds(categorySettings({ filterMode: "or", filterRules })))
      .toEqual(["category-bonus", "category-food", "category-salary"]);
    expect(rowIds(categorySettings({ filterMode: "and", filterRules }))).toEqual([]);
  });

  it("sorts category fields with deterministic multi-rule and id ties", () => {
    const ties = [
      category("zulu", { name: "Zulu", kind: "income" }),
      category("alpha-b", { name: "Alpha", parentId: "parent-b" }),
      category("alpha-a", { name: "Alpha", parentId: "parent-b" }),
      category("parent-b", { name: "Beta" }),
    ];
    const ids = (field: "name" | "kind" | "parent") =>
      deriveCategoryGroups(ties, categorySettings({
        sortRules: [{ id: field, field, direction: "asc" }],
      })).flatMap((group) => group.rows.map((row) => row.id));

    expect(ids("name")).toEqual(["alpha-a", "alpha-b", "parent-b", "zulu"]);
    expect(ids("kind")).toEqual(["alpha-a", "alpha-b", "parent-b", "zulu"]);
    expect(ids("parent")).toEqual(["alpha-a", "alpha-b", "parent-b", "zulu"]);
    expect(deriveCategoryGroups(ties, categorySettings({
      sortRules: [
        { id: "kind", field: "kind", direction: "asc" },
        { id: "name", field: "name", direction: "desc" },
      ],
    })).flatMap((group) => group.rows.map((row) => row.id)))
      .toEqual(["parent-b", "alpha-a", "alpha-b", "zulu"]);
  });

  it("groups by type and parent with saved ordering and visibility", () => {
    const byType = deriveCategoryGroups(categories, categorySettings({
      groupSettings: {
        groupBy: "kind",
        manualOrder: ["income", "expense"],
        hiddenGroupKeys: ["expense"],
      },
    }));
    const byParent = deriveCategoryGroups(categories, categorySettings({
      groupSettings: {
        groupBy: "parent",
        sort: "reverse_alphabetical",
        hideEmpty: false,
      },
    }));

    expect(byType.map(({ key, label, rows }) => ({ key, label, ids: rows.map(({ id }) => id) })))
      .toEqual([{
        key: "income",
        label: "Income",
        ids: ["category-bonus", "category-salary"],
      }]);
    expect(byParent.map(({ label }) => label))
      .toEqual(["Salary", "No parent", "Food", "Expenses"]);
  });
});

describe("categoryParentOptions", () => {
  it("returns active same-type choices while excluding self and every descendant", () => {
    expect(categoryParentOptions(categories, "expense", "category-food").map(({ id }) => id))
      .toEqual(["category-expenses"]);
    expect(categoryParentOptions(categories, "income").map(({ id }) => id))
      .toEqual(["category-bonus", "category-salary"]);
  });

  it.each<TransactionCategoryKind>(["expense", "income"])(
    "returns only %s choices",
    (kind) => {
      expect(categoryParentOptions(categories, kind).every((item) => item.kind === kind))
        .toBe(true);
    },
  );
});
