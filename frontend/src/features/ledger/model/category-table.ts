import type {
  TransactionCategory,
  TransactionCategoryKind,
} from "@/features/ledger/model/ledger-model";
import {
  ledgerFilterFieldsForScope,
  ledgerSortFieldsForScope,
} from "@/features/ledger/model/ledger-table-views";
import {
  orderVisiblePlannerGroups,
  type PlannerGroupSettings,
} from "@/features/workbench/model/planner-group-settings";
import {
  effectivePlannerFilterRules,
  matchesPlannerFilterValue,
  type PlannerFilterField,
  type PlannerFilterRule,
  type PlannerGroupBy,
  type PlannerSortBy,
  type PlannerSortRule,
  type PlannerTableSettings,
} from "@/features/workbench/model/planner-model";

export type CategoryRow = {
  id: string;
  category: TransactionCategory;
  name: string;
  kind: TransactionCategoryKind;
  kindLabel: "Expense" | "Income";
  parentId: string | null;
  parentLabel: string;
};

export type CategoryRowGroup = {
  key: string;
  label: string | null;
  rows: CategoryRow[];
};

export function deriveCategoryGroups(
  categories: readonly TransactionCategory[],
  settings: PlannerTableSettings,
): CategoryRowGroup[] {
  const parentById = new Map(categories.map((category) => [category.id, category]));
  const rules = effectivePlannerFilterRules(
    settings.filterRules,
    ledgerFilterFieldsForScope("ledger.categories"),
  );
  const rows = categories
    .filter(({ active }) => active)
    .map((category) => projectCategoryRow(category, parentById.get(category.parentId ?? "")))
    .filter((row) => matchesCategoryRules(row, rules, settings.filterMode))
    .sort((left, right) => compareCategoryRows(left, right, settings.sortRules));

  return groupCategoryRows(rows, settings.groupSettings);
}

export function categoryParentOptions(
  categories: readonly TransactionCategory[],
  kind: TransactionCategoryKind,
  editingId?: string,
): TransactionCategory[] {
  const blocked = new Set<string>();
  if (editingId) {
    blocked.add(editingId);
    let changed = true;
    while (changed) {
      changed = false;
      for (const category of categories) {
        if (category.parentId && blocked.has(category.parentId) && !blocked.has(category.id)) {
          blocked.add(category.id);
          changed = true;
        }
      }
    }
  }
  return categories
    .filter((category) => category.active && category.kind === kind && !blocked.has(category.id))
    .sort((left, right) => compareString(left.name, right.name) || compareString(left.id, right.id));
}

function projectCategoryRow(
  category: TransactionCategory,
  parent: TransactionCategory | undefined,
): CategoryRow {
  return {
    id: category.id,
    category,
    name: category.name,
    kind: category.kind,
    kindLabel: kindLabel(category.kind),
    parentId: category.parentId,
    parentLabel: category.parentId === null ? "No parent" : parent?.name ?? "Unknown parent",
  };
}

function matchesCategoryRules(
  row: CategoryRow,
  rules: readonly PlannerFilterRule[],
  mode: PlannerTableSettings["filterMode"],
): boolean {
  if (rules.length === 0) return true;
  const matches = rules.map((rule) =>
    matchesPlannerFilterValue(categoryFilterValue(row, rule.field), rule, ""),
  );
  return mode === "and" ? matches.every(Boolean) : matches.some(Boolean);
}

function categoryFilterValue(
  row: CategoryRow,
  field: PlannerFilterField,
): string | string[] | number | null {
  if (field === "name") return row.name;
  if (field === "kind") return [row.kind, row.kindLabel];
  if (field === "parent") return [row.parentId ?? "none", row.parentLabel];
  return null;
}

function compareCategoryRows(
  left: CategoryRow,
  right: CategoryRow,
  rules: readonly PlannerSortRule[],
): number {
  const activeRules = rules.filter((rule) =>
    ledgerSortFieldsForScope("ledger.categories").includes(rule.field),
  );
  const effectiveRules: readonly PlannerSortRule[] = activeRules.length > 0
    ? activeRules
    : [{ id: "category-default-sort", field: "name", direction: "asc" }];
  for (const rule of effectiveRules) {
    const result = compareString(
      categorySortValue(left, rule.field),
      categorySortValue(right, rule.field),
    );
    if (result !== 0) return rule.direction === "asc" ? result : -result;
  }
  return compareString(left.id, right.id);
}

function categorySortValue(row: CategoryRow, field: PlannerSortBy): string {
  if (field === "name") return row.name;
  if (field === "kind") return row.kindLabel;
  if (field === "parent") return row.parentLabel;
  return "";
}

function groupCategoryRows(
  rows: CategoryRow[],
  settings: PlannerGroupSettings,
): CategoryRowGroup[] {
  if (settings.groupBy === "none") return [{ key: "all", label: null, rows }];
  const groups = new Map<string, CategoryRowGroup>();
  for (const row of rows) {
    const { key, label } = categoryGroup(row, settings.groupBy);
    const group = groups.get(key) ?? { key, label, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return orderVisiblePlannerGroups(
    [...groups.values()].map(({ key, label, rows: groupRows }) => ({
      key,
      label: label ?? key,
      count: groupRows.length,
    })),
    settings,
  ).map(({ key }) => groups.get(key)!);
}

function categoryGroup(
  row: CategoryRow,
  groupBy: PlannerGroupBy,
): Pick<CategoryRowGroup, "key" | "label"> {
  if (groupBy === "kind") return { key: row.kind, label: row.kindLabel };
  if (groupBy === "parent") {
    return { key: row.parentId ?? "none", label: row.parentLabel };
  }
  return { key: "all", label: null };
}

function kindLabel(kind: TransactionCategoryKind): "Expense" | "Income" {
  return kind === "expense" ? "Expense" : "Income";
}

function compareString(left: string, right: string): number {
  return left.localeCompare(right);
}
