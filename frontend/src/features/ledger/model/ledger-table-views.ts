import {
  defaultPlannerGroupSettings,
  normalizePlannerGroupSettings,
} from "@/features/workbench/model/planner-group-settings";
import {
  clonePlannerTableSettings,
  normalizePlannerFilterRule,
  normalizePlannerSortRule,
  type PlannerFilterField,
  type PlannerFilterMode,
  type PlannerGroupBy,
  type PlannerSortBy,
  type PlannerTableSettings,
} from "@/features/workbench/model/planner-model";
import {
  buildTableViewTabsState,
  type TableViewSettingsAdapter,
  type TableViewTabsState,
} from "@/features/workbench/model/table-view-tabs";

export const ledgerTableScopeIds = [
  "ledger.transactions",
  "ledger.accounts",
  "ledger.categories",
] as const;

export type LedgerTableScopeId = (typeof ledgerTableScopeIds)[number];
export type LedgerTableViewsState = Record<
  LedgerTableScopeId,
  TableViewTabsState<PlannerTableSettings>
>;

const filterFields: Record<LedgerTableScopeId, readonly PlannerFilterField[]> = {
  "ledger.transactions": [
    "date",
    "content",
    "entry_type",
    "account",
    "category",
    "currency",
    "amount",
  ],
  "ledger.accounts": ["name", "account_type", "currency", "current_balance"],
  "ledger.categories": ["name", "kind", "parent"],
};

const transactionSortFields: readonly PlannerSortBy[] = [
  "date", "content", "account", "category", "amount", "updated",
];

const groupOptions: Record<
  LedgerTableScopeId,
  readonly { value: PlannerGroupBy; label: string }[]
> = {
  "ledger.transactions": [
    { value: "none", label: "None" },
    { value: "month", label: "Month" },
    { value: "week", label: "Week" },
    { value: "day", label: "Day" },
    { value: "account", label: "Account" },
    { value: "category", label: "Category" },
    { value: "entry_type", label: "Type" },
  ],
  "ledger.accounts": [
    { value: "none", label: "None" },
    { value: "account_type", label: "Type" },
    { value: "currency", label: "Currency" },
  ],
  "ledger.categories": [
    { value: "none", label: "None" },
    { value: "kind", label: "Kind" },
    { value: "parent", label: "Parent" },
  ],
};

export const ledgerTableViewSettingsAdapter: TableViewSettingsAdapter<
  LedgerTableScopeId,
  PlannerTableSettings
> = {
  defaultSettings: defaultLedgerTableSettings,
  normalizeSettings: normalizeLedgerTableSettings,
  cloneSettings: clonePlannerTableSettings,
};

export function createLedgerTableViews(candidate?: unknown): LedgerTableViewsState {
  const stored = isRecord(candidate) ? candidate : {};
  return Object.fromEntries(ledgerTableScopeIds.map((scope) => [
    scope,
    buildTableViewTabsState(
      scope,
      stored[scope],
      ledgerTableViewSettingsAdapter,
    ),
  ])) as LedgerTableViewsState;
}

export function ledgerFilterFieldsForScope(
  scope: LedgerTableScopeId,
): readonly PlannerFilterField[] {
  return filterFields[scope];
}

export function ledgerSortFieldsForScope(
  scope: LedgerTableScopeId,
): readonly PlannerSortBy[] {
  return scope === "ledger.transactions" ? transactionSortFields : filterFields[scope];
}

export function ledgerGroupOptionsForScope(scope: LedgerTableScopeId) {
  return groupOptions[scope];
}

export function defaultLedgerTableSettings(
  scope: LedgerTableScopeId,
): PlannerTableSettings {
  const sortField = scope === "ledger.transactions" ? "date" : "name";
  return {
    filterMode: "and",
    filterRules: [],
    sortRules: [{
      id: `${scope}-default-sort`,
      field: sortField,
      direction: scope === "ledger.transactions" ? "desc" : "asc",
    }],
    groupSettings: defaultPlannerGroupSettings(),
  };
}

export function normalizeLedgerTableSettings(
  scope: LedgerTableScopeId,
  candidate: unknown,
): PlannerTableSettings {
  const defaults = defaultLedgerTableSettings(scope);
  if (!isRecord(candidate)) return defaults;
  const allowedFields = ledgerFilterFieldsForScope(scope);
  const filterRules = Array.isArray(candidate.filterRules)
    ? candidate.filterRules.flatMap((rule) => {
        const normalized = normalizePlannerFilterRule(rule, allowedFields);
        return normalized ? [normalized] : [];
      })
    : defaults.filterRules;
  const sortRules = Array.isArray(candidate.sortRules)
    ? candidate.sortRules.flatMap((rule) => {
        const normalized = normalizePlannerSortRule(rule, ledgerSortFieldsForScope(scope));
        return normalized ? [normalized] : [];
      })
    : defaults.sortRules;
  const normalizedGroup = normalizePlannerGroupSettings(candidate.groupSettings);
  const allowedGroups = new Set(
    ledgerGroupOptionsForScope(scope).map(({ value }) => value),
  );
  const requestedGroup = isRecord(candidate.groupSettings) &&
      typeof candidate.groupSettings.groupBy === "string"
    ? candidate.groupSettings.groupBy as PlannerGroupBy
    : "none";

  return {
    filterMode: normalizeFilterMode(candidate.filterMode),
    filterRules,
    sortRules,
    groupSettings: {
      ...normalizedGroup,
      groupBy: allowedGroups.has(requestedGroup) ? requestedGroup : "none",
    },
  };
}

function normalizeFilterMode(value: unknown): PlannerFilterMode {
  return value === "or" ? "or" : "and";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
