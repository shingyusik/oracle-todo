import React from "react";
import { Trash2 } from "lucide-react";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import {
  defaultLedgerTableSettings,
  ledgerFilterFieldsForScope,
  ledgerGroupOptionsForScope,
  ledgerSortFieldsForScope,
  type LedgerTableScopeId,
} from "@/features/ledger/model/ledger-table-views";
import type { LedgerState } from "@/features/ledger/hooks/useLedgerController";
import { deriveTransactionGroups } from "@/features/ledger/model/transaction-table";
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
  onAdd,
  addButtonRef,
  onArchiveSelected,
  archiveDisabled = true,
}: {
  controller: LedgerController;
  scope: LedgerTableScopeId;
  title: string;
  headingId: string;
  onAdd?: () => void;
  addButtonRef?: React.RefObject<HTMLButtonElement>;
  onArchiveSelected?: () => void;
  archiveDisabled?: boolean;
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
        <div className="workspace-table-header-row ledger-table-header-row">
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
          <div className="workspace-table-header-actions">
            <TableViewControls adapter={controlsAdapter} />
            {onAdd ? (
              <button
                ref={addButtonRef}
                className="items-toolbar-button"
                type="button"
                aria-haspopup="dialog"
                onClick={onAdd}
              >
                Add transaction
              </button>
            ) : null}
            {onArchiveSelected ? (
              <button
                className="items-toolbar-button"
                type="button"
                aria-label="Archive selected transactions"
                disabled={archiveDisabled}
                onClick={onArchiveSelected}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
        <TableViewActivePills adapter={controlsAdapter} />
      </header>
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
        statuses: ["expense", "income", "transfer"]
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
    const settings = defaultLedgerTableSettings(scope);
    return deriveTransactionGroups(state.entries, {
      ...settings,
      groupSettings: {
        ...settings.groupSettings,
        groupBy: groupBy as typeof settings.groupSettings.groupBy,
        hideEmpty: false,
        manualOrder: [],
        hiddenGroupKeys: [],
      },
    }).map((group) => ({
      key: group.key,
      label: groupBy === "entry_type"
        ? label(group.label ?? group.key)
        : group.label ?? label(group.key),
      count: group.rows.length,
    }));
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
