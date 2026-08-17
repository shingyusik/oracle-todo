import type {
  Account,
  AccountBalance,
  AccountCategory,
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

export type AccountRow = {
  id: string;
  account: Account;
  name: string;
  accountTypeId: string;
  accountTypeLabel: string;
  currencyId: string;
  currencyCode: string;
  decimalPlaces: number;
  currentBalanceMinor: number;
};

export type AccountRowGroup = {
  key: string;
  label: string | null;
  rows: AccountRow[];
};

export function deriveAccountGroups(
  accounts: readonly Account[],
  balances: readonly AccountBalance[],
  accountTypes: readonly AccountCategory[],
  settings: PlannerTableSettings,
): AccountRowGroup[] {
  const balanceByAccountId = new Map(balances.map((balance) => [balance.account.id, balance]));
  const accountTypeById = new Map(accountTypes.map((accountType) => [accountType.id, accountType]));
  const rules = effectivePlannerFilterRules(
    settings.filterRules,
    ledgerFilterFieldsForScope("ledger.accounts"),
  );
  const rows = accounts
    .flatMap((account) => projectAccountRow(
      account,
      balanceByAccountId.get(account.id),
      accountTypeById.get(account.categoryId),
    ))
    .filter((row) => matchesAccountRules(row, rules, settings.filterMode))
    .sort((left, right) => compareAccountRows(left, right, settings.sortRules));

  return groupAccountRows(rows, settings.groupSettings);
}

function projectAccountRow(
  account: Account,
  balance: AccountBalance | undefined,
  accountType: AccountCategory | undefined,
): AccountRow[] {
  if (!account.active || !balance) return [];
  return [{
    id: account.id,
    account,
    name: account.name,
    accountTypeId: account.categoryId,
    accountTypeLabel: accountType?.active ? accountType.name : "Unknown account type",
    currencyId: account.currencyId,
    currencyCode: balance.currencyCode,
    decimalPlaces: balance.decimalPlaces,
    currentBalanceMinor: balance.currentBalanceMinor,
  }];
}

function matchesAccountRules(
  row: AccountRow,
  rules: readonly PlannerFilterRule[],
  mode: PlannerTableSettings["filterMode"],
): boolean {
  if (rules.length === 0) return true;
  const matches = rules.map((rule) =>
    matchesPlannerFilterValue(accountFilterValue(row, rule.field), rule, ""),
  );
  return mode === "and" ? matches.every(Boolean) : matches.some(Boolean);
}

function accountFilterValue(
  row: AccountRow,
  field: PlannerFilterField,
): string | string[] | number | null {
  if (field === "name") return row.name;
  if (field === "account_type") return [row.accountTypeId, row.accountTypeLabel];
  if (field === "currency") return [row.currencyId, row.currencyCode];
  if (field === "current_balance") return displayedCurrentBalance(row);
  return null;
}

function compareAccountRows(
  left: AccountRow,
  right: AccountRow,
  rules: readonly PlannerSortRule[],
): number {
  const activeRules = rules.filter((rule) =>
    ledgerSortFieldsForScope("ledger.accounts").includes(rule.field),
  );
  const effectiveRules: readonly PlannerSortRule[] = activeRules.length > 0
    ? activeRules
    : [{ id: "account-default-sort", field: "name", direction: "asc" }];
  for (const rule of effectiveRules) {
    const result = compareAccountValue(
      accountSortValue(left, rule.field),
      accountSortValue(right, rule.field),
    );
    if (result !== 0) return rule.direction === "asc" ? result : -result;
  }
  return compareString(left.id, right.id);
}

function accountSortValue(row: AccountRow, field: PlannerSortBy): string | number {
  if (field === "name") return row.name;
  if (field === "account_type") return row.accountTypeLabel;
  if (field === "currency") return row.currencyCode;
  if (field === "current_balance") return displayedCurrentBalance(row);
  return "";
}

function compareAccountValue(left: string | number, right: string | number): number {
  return typeof left === "number" && typeof right === "number"
    ? left - right
    : compareString(String(left), String(right));
}

function compareString(left: string, right: string): number {
  return left.localeCompare(right);
}

function displayedCurrentBalance(row: AccountRow): number {
  return row.currentBalanceMinor / 10 ** row.decimalPlaces;
}

function groupAccountRows(
  rows: AccountRow[],
  settings: PlannerGroupSettings,
): AccountRowGroup[] {
  if (settings.groupBy === "none") return [{ key: "all", label: null, rows }];
  const groups = new Map<string, AccountRowGroup>();
  for (const row of rows) {
    const { key, label } = accountGroup(row, settings.groupBy);
    const group = groups.get(key) ?? { key, label, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return orderVisiblePlannerGroups(
    [...groups.values()].map(({ key, label, rows }) => ({
      key,
      label: label ?? key,
      count: rows.length,
    })),
    settings,
  ).map(({ key }) => groups.get(key)!);
}

function accountGroup(
  row: AccountRow,
  groupBy: PlannerGroupBy,
): Pick<AccountRowGroup, "key" | "label"> {
  if (groupBy === "account_type") {
    return { key: row.accountTypeId, label: row.accountTypeLabel };
  }
  if (groupBy === "currency") return { key: row.currencyId, label: row.currencyCode };
  return { key: "all", label: null };
}
