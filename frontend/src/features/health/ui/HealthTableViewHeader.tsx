import React from "react";
import { Plus, Trash2 } from "lucide-react";

import type { HealthController } from "@/features/health/hooks/useHealthController";
import {
  healthFilterFieldsForScope,
  healthGroupOptionsForScope,
  healthSortFieldsForScope,
  healthTableViewSettingsAdapter,
  type HealthTableScopeId,
} from "@/features/health/model/health-table-views";
import type { PlannerGroupCandidate } from "@/features/workbench/model/planner-group-settings";
import {
  TableViewActivePills,
  TableViewControls,
  type Option,
  type TableViewControlsAdapter,
} from "@/features/workbench/ui/TableViewControls";
import { TableViewTabs } from "@/features/workbench/ui/TableViewTabs";

const empty = {
  tags: [], areas: [], projects: [], currencies: [], routines: [], statuses: [],
  priorities: [], horizons: [], parents: [], materializationPolicies: [], participants: [],
};

export function HealthTableViewHeader({
  controller, scope, title, headingId, fieldLabels, fieldOptions, candidates,
  onAdd, addButtonRef, onArchiveSelected, archiveButtonRef, archiveDisabled,
}: {
  controller: HealthController;
  scope: HealthTableScopeId;
  title: string;
  headingId: string;
  fieldLabels: TableViewControlsAdapter["fieldLabels"];
  fieldOptions: Partial<Record<string, Option<string>[]>>;
  candidates: PlannerGroupCandidate[];
  onAdd(): void;
  addButtonRef: React.RefObject<HTMLButtonElement>;
  onArchiveSelected(): void;
  archiveButtonRef: React.RefObject<HTMLButtonElement>;
  archiveDisabled: boolean;
}) {
  const settings = controller.tableSettings(scope);
  const lookupTags = (controller.state.tableLookups?.[scope]?.tags ?? [])
    .map(({ id, label }) => ({ value: id, label }));
  const adapter: TableViewControlsAdapter = {
    scopeId: scope,
    title,
    settings,
    filterFields: healthFilterFieldsForScope(scope),
    fieldLabels,
    sortFields: healthSortFieldsForScope(scope),
    groupOptions: [...healthGroupOptionsForScope(scope)],
    candidates,
    filterOptions: { tags: lookupTags, daily: { ...empty, tags: lookupTags }, fieldOptions },
    activeControlsAriaLabel: `Active ${title} controls`,
    dropdownIdPrefix: "health",
    isDefaultSort: (rules) => JSON.stringify(rules) === JSON.stringify(
      healthTableViewSettingsAdapter.defaultSettings(scope).sortRules,
    ),
    update: (updater) => controller.updateTableSettings(scope, updater),
    prepareGroup: () => controller.ensureReferenceData(scope),
  };
  const noun = title.toLowerCase();
  const addLabel = `Add ${noun} entry`;
  const archiveLabel = `Archive selected ${noun} entries`;
  return (
    <header className="workspace-table-header">
      <h1 id={headingId}>{title}</h1>
      <div className="workspace-table-header-row ledger-table-header-row">
        <TableViewTabs
          scopeId={scope}
          title={title}
          controller={{
            tabs: controller.tableTabs(scope),
            isDirty: controller.tableIsDirty(scope),
            select: (id) => controller.selectTableTab(scope, id),
            save: () => controller.saveTableTab(scope),
            create: (name) => controller.createTableTab(scope, name),
            rename: (id, name) => controller.renameTableTab(scope, id, name),
            requestDelete: (id) => controller.requestDeleteTableTab(scope, id),
          }}
        />
        <div className="workspace-table-header-actions">
          <TableViewControls adapter={adapter} />
          <button ref={addButtonRef} className="items-toolbar-button" type="button"
            aria-label={addLabel} title={addLabel} aria-haspopup="dialog" onClick={onAdd}>
            <Plus size={16} aria-hidden="true" />
          </button>
          <button ref={archiveButtonRef} className="items-toolbar-button" type="button"
            aria-label={archiveLabel} title={archiveLabel} disabled={archiveDisabled}
            onClick={onArchiveSelected}>
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <TableViewActivePills adapter={adapter} />
    </header>
  );
}
