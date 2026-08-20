import React from "react";
import { Plus, Settings, Trash2 } from "lucide-react";

import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import {
  defaultLedgerTableSettings,
  ledgerFilterFieldsForScope,
  ledgerGroupOptionsForScope,
  ledgerSortFieldsForScope,
  type LedgerTableScopeId,
} from "@/features/ledger/model/ledger-table-views";
import type { LedgerState } from "@/features/ledger/hooks/useLedgerController";
import type { LedgerEntryView } from "@/features/ledger/model/ledger-model";
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
  transactionEntries,
  onAdd,
  addButtonRef,
  addLabel,
  onSettings,
  settingsButtonRef,
  settingsLabel,
  onArchiveSelected,
  archiveDisabled = true,
  archiveSelectedLabel,
}: {
  controller: LedgerController;
  scope: LedgerTableScopeId;
  title: string;
  headingId: string;
  transactionEntries?: LedgerEntryView[];
  onAdd?: () => void;
  addButtonRef?: React.RefObject<HTMLButtonElement>;
  addLabel?: string;
  onSettings?: () => void;
  settingsButtonRef?: React.RefObject<HTMLButtonElement | null>;
  settingsLabel?: string;
  onArchiveSelected?: () => void;
  archiveDisabled?: boolean;
  archiveSelectedLabel?: string;
}) {
  const tabs = controller.tableTabs(scope);
  const settings = controller.tableSettings(scope);
  const controlsAdapter: TableViewControlsAdapter = {
    scopeId: scope,
    title,
    settings,
    filterFields: ledgerFilterFieldsForScope(scope),
    ...(scope === "ledger.categories"
      ? { fieldLabels: { kind: "Type", parent: "Parent category" } }
      : {}),
    sortFields: ledgerSortFieldsForScope(scope),
    groupOptions: [...ledgerGroupOptionsForScope(scope)],
    candidates: ledgerGroupCandidates(
      scope,
      settings.groupSettings.groupBy,
      controller.state,
      transactionEntries,
    ),
    filterOptions: ledgerFilterOptions(scope, controller.state),
    activeControlsAriaLabel: `Active ${title} controls`,
    dropdownIdPrefix: "ledger",
    isDefaultSort: (rules) => JSON.stringify(rules) === JSON.stringify(
      defaultLedgerTableSettings(scope).sortRules,
    ),
    update: (updater) => controller.updateTableSettings(scope, updater),
  };

  const tableTabs = (
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
  );

  const isAccounts = scope === "ledger.accounts";
  const resolvedSettingsLabel = settingsLabel ?? "Account settings";
  const resolvedAddLabel = addLabel ?? "Add transaction";
  const resolvedArchiveLabel = archiveSelectedLabel ?? "Archive selected transactions";

  return (
    <>
      <header className="workspace-table-header">
        <h1 id={headingId}>{title}</h1>
        <div className="workspace-table-header-row ledger-table-header-row">
          {tableTabs}
          <div className="workspace-table-header-actions">
            <TableViewControls adapter={controlsAdapter} />
            {isAccounts && onSettings ? (
              <button
                ref={settingsButtonRef as React.RefObject<HTMLButtonElement> | undefined}
                className="items-toolbar-button"
                type="button"
                aria-haspopup="dialog"
                aria-label={resolvedSettingsLabel}
                title={resolvedSettingsLabel}
                onClick={onSettings}
              >
                <Settings size={16} aria-hidden="true" />
              </button>
            ) : null}
            {onAdd ? (
              <button
                ref={addButtonRef}
                className="items-toolbar-button"
                type="button"
                aria-haspopup="dialog"
                aria-label={resolvedAddLabel}
                title={resolvedAddLabel}
                onClick={onAdd}
              >
                <Plus size={16} aria-hidden="true" />
              </button>
            ) : null}
            {onArchiveSelected ? (
              <button
                className="items-toolbar-button"
                type="button"
                aria-label={resolvedArchiveLabel}
                title={resolvedArchiveLabel}
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
    currencies: [],
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
        currencies: state.currencies
          .filter(({ active }) => active)
          .map(({ id, code }) => ({ value: id, label: code })),
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
        currencies: state.currencies.map(({ id, code }) => ({ value: id, label: code })),
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
  transactionEntries?: LedgerEntryView[],
): PlannerGroupCandidate[] {
  if (groupBy === "none") return [];
  if (scope === "ledger.transactions") {
    const settings = defaultLedgerTableSettings(scope);
    return deriveTransactionGroups(transactionEntries ?? state.entries, {
      ...settings,
      groupSettings: {
        ...settings.groupSettings,
        groupBy: groupBy as typeof settings.groupSettings.groupBy,
        hideEmpty: false,
        manualOrder: [],
        hiddenGroupKeys: [],
      },
    }, undefined, state.currencies).map((group) => ({
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
  const activeCategories = state.categories.filter(({ active }) => active);
  const values = groupBy === "kind"
    ? activeCategories.map(({ kind }) => kind)
    : activeCategories.map(({ parentId }) => parentId ?? "none");
  const labels = new Map(activeCategories.map(({ id, name }) => [id, name]));
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
