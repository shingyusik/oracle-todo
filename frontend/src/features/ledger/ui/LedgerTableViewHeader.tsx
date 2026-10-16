import React from "react";
import {
  IconPlus as Plus,
  IconSettings as Settings,
  IconTrash as Trash2,
  IconChartBar,
} from "@tabler/icons-react";

import { ledgerApi } from "@/features/ledger/api/ledger-api";
import type { LedgerController } from "@/features/ledger/hooks/useLedgerController";
import {
  defaultLedgerTableSettings,
  ledgerFilterFieldsForScope,
  ledgerGroupOptionsForScope,
  ledgerSortFieldsForScope,
  type LedgerTableScopeId,
} from "@/features/ledger/model/ledger-table-views";
import type { LedgerState } from "@/features/ledger/hooks/useLedgerController";
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
  addLabel,
  onSettings,
  settingsButtonRef,
  settingsLabel,
  onArchiveSelected,
  archiveDisabled = true,
  archiveSelectedLabel,
  onAnalyze,
  analysisOpen,
  analysisButtonRef,
}: {
  controller: LedgerController;
  scope: LedgerTableScopeId;
  title: string;
  headingId: string;
  onAdd?: () => void;
  addButtonRef?: React.RefObject<HTMLButtonElement>;
  addLabel?: string;
  onSettings?: () => void;
  settingsButtonRef?: React.RefObject<HTMLButtonElement | null>;
  settingsLabel?: string;
  onArchiveSelected?: () => void;
  archiveDisabled?: boolean;
  archiveSelectedLabel?: string;
  onAnalyze?: () => void;
  analysisOpen?: boolean;
  analysisButtonRef?: React.RefObject<HTMLButtonElement>;
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
    candidates: [],
    groupCandidatesKey: String(controller.tablePage?.(scope).generation ?? 0),
    filterOptions: ledgerFilterOptions(scope, controller.state),
    activeControlsAriaLabel: `Active ${title} controls`,
    dropdownIdPrefix: "ledger",
    isDefaultSort: (rules) => JSON.stringify(rules) === JSON.stringify(
      defaultLedgerTableSettings(scope).sortRules,
    ),
    update: (updater) => controller.updateTableSettings(scope, updater),
    loadGroupCandidates: async () => (await ledgerApi.tableGroups(scope, { ...settings, filterRules: [], sortRules: defaultLedgerTableSettings(scope).sortRules }))
      .map((candidate) => ({ ...candidate, label: scope === "ledger.transactions" && settings.groupSettings.groupBy === "month"
        ? new Date(`${candidate.key}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
        : scope === "ledger.transactions" && settings.groupSettings.groupBy === "entry_type"
          ? label(candidate.label) : candidate.label })),
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
            {onAnalyze ? <button ref={analysisButtonRef} className="items-toolbar-button ledger-analysis-toggle" type="button" onClick={onAnalyze}
              aria-expanded={analysisOpen} aria-controls="transaction-analysis" aria-label="Analyze transactions">
              <IconChartBar size={16} aria-hidden="true" /> Analyze
            </button> : null}
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
                className="items-toolbar-button button-primary"
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
  const lookupOptions = (
    key: "accounts" | "categories" | "currencies" | "accountTypes",
  ) => (state.tableLookups?.[scope][key] ?? [])
    .map(({ id, label }) => ({ value: id, label }));

  if (scope === "ledger.transactions") {
    return {
      tags: [],
      daily: {
        ...empty,
        areas: lookupOptions("accounts"),
        projects: lookupOptions("categories"),
        currencies: lookupOptions("currencies"),
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
        areas: lookupOptions("accountTypes"),
        projects: lookupOptions("currencies"),
        currencies: lookupOptions("currencies"),
      },
    };
  }
  return {
    tags: [],
    daily: {
      ...empty,
      statuses: ["expense", "income"].map((value) => ({ value, label: label(value) })),
      parents: lookupOptions("categories"),
    },
  };
}

function label(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (first) => first.toUpperCase());
}
