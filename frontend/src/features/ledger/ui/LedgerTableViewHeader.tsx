import React from "react";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import {
  defaultLedgerTableSettings,
  ledgerFilterFieldsForScope,
  ledgerGroupOptionsForScope,
  ledgerSortFieldsForScope,
  type LedgerTableScopeId,
} from "@/features/ledger/model/ledger-table-views";
import type { LedgerState } from "@/features/ledger/hooks/useLedgerController";
import type { PlannerGroupCandidate } from "@/features/workbench/model/planner-group-settings";
import {
  TableViewActivePills,
  TableViewControls,
  type PlannerFilterOptions,
  type TableViewControlsAdapter,
} from "@/features/workbench/ui/TableViewControls";
import { TableViewTabs } from "@/features/workbench/ui/TableViewTabs";

export function LedgerTableViewHeader({
  controller,
  scope,
  title,
  headingId,
}: {
  controller: LedgerController;
  scope: LedgerTableScopeId;
  title: string;
  headingId: string;
}) {
  const tabs = controller.tableTabs(scope);
  const settings = controller.tableSettings(scope);
  const controlsAdapter: TableViewControlsAdapter = {
    scopeId: scope,
    title,
    settings,
    filterFields: ledgerFilterFieldsForScope(scope),
    sortFields: ledgerSortFieldsForScope(scope),
    groupOptions: [...ledgerGroupOptionsForScope(scope)],
    candidates: ledgerGroupCandidates(scope, settings.groupSettings.groupBy, controller.state),
    filterOptions: ledgerFilterOptions(scope, controller.state),
    activeControlsAriaLabel: `Active ${title} controls`,
    dropdownIdPrefix: "ledger",
    isDefaultSort: (rules) => JSON.stringify(rules) === JSON.stringify(
      defaultLedgerTableSettings(scope).sortRules,
    ),
    update: (updater) => controller.updateTableSettings(scope, updater),
  };

  return (
    <>
      <header className="workspace-table-header">
        <h1 id={headingId}>{title}</h1>
        <TableViewControls adapter={controlsAdapter} />
      </header>
      <TableViewTabs
        scopeId={scope}
        title={title}
        controller={{
          tabs,
          isDirty: controller.tableIsDirty(scope),
          select: (tabId) => controller.selectTableTab(scope, tabId),
          save: () => controller.saveTableTab(scope),
          create: (name) => controller.createTableTab(scope, name),
          rename: (tabId, name) => controller.renameTableTab(scope, tabId, name),
          requestDelete: (tabId) => controller.requestDeleteTableTab(scope, tabId),
        }}
      />
      <TableViewActivePills adapter={controlsAdapter} />
    </>
  );
}

function ledgerFilterOptions(
  scope: LedgerTableScopeId,
  state: LedgerState,
): PlannerFilterOptions {
  const options = (items: { id: string; name: string }[]) =>
    items.map(({ id, name }) => ({ value: id, label: name }));
  const empty = {
    tags: [],
    areas: [],
    projects: [],
    routines: [],
    statuses: [],
    priorities: [],
    horizons: [],
    parents: [],
    materializationPolicies: [],
    participants: [],
  };

  if (scope === "ledger.transactions") {
    return {
      tags: [],
      daily: {
        ...empty,
        areas: options(state.accounts),
        projects: options(state.categories),
        statuses: ["expense", "income", "transfer", "adjustment_out", "adjustment_in"]
          .map((value) => ({ value, label: label(value) })),
      },
    };
  }
  if (scope === "ledger.accounts") {
    return {
      tags: [],
      daily: {
        ...empty,
        areas: options(state.accountCategories),
        projects: state.currencies.map(({ id, code }) => ({ value: id, label: code })),
      },
    };
  }
  return {
    tags: [],
    daily: {
      ...empty,
      statuses: ["expense", "income"].map((value) => ({ value, label: label(value) })),
      parents: options(state.categories),
    },
  };
}

function ledgerGroupCandidates(
  scope: LedgerTableScopeId,
  groupBy: string,
  state: LedgerState,
): PlannerGroupCandidate[] {
  if (groupBy === "none") return [];
  if (scope === "ledger.transactions") {
    if (groupBy === "entry_type") return counted(
      state.entries.map(({ entry }) => entry.entryType),
    );
    const values = groupBy === "account"
      ? state.entries.map(({ entry }) => entry.accountId)
      : state.entries.map(({ entry }) => entry.transactionCategoryId ?? "uncategorized");
    const labels = groupBy === "account"
      ? new Map(state.accounts.map(({ id, name }) => [id, name]))
      : new Map(state.categories.map(({ id, name }) => [id, name]));
    return counted(values, labels);
  }
  if (scope === "ledger.accounts") {
    const values = groupBy === "account_type"
      ? state.accounts.map(({ categoryId }) => categoryId)
      : state.accounts.map(({ currencyId }) => currencyId);
    const labels = groupBy === "account_type"
      ? new Map(state.accountCategories.map(({ id, name }) => [id, name]))
      : new Map(state.currencies.map(({ id, code }) => [id, code]));
    return counted(values, labels);
  }
  const values = groupBy === "kind"
    ? state.categories.map(({ kind }) => kind)
    : state.categories.map(({ parentId }) => parentId ?? "none");
  const labels = new Map(state.categories.map(({ id, name }) => [id, name]));
  labels.set("none", "No parent");
  return counted(values, labels);
}

function counted(values: string[], labels = new Map<string, string>()) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([key, count]) => ({
    key,
    label: labels.get(key) ?? label(key),
    count,
  }));
}

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (first) => first.toUpperCase());
}
