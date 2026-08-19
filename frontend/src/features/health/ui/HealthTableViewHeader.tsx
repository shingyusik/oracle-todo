import React from "react";

import type { HealthController } from "@/features/health/hooks/useHealthController";
import { deriveDietGroups } from "@/features/health/model/diet-table";
import {
  defaultHealthTableSettings,
  healthDietFilterSelectOptions,
  healthFilterFieldsForScope,
  healthGroupOptionsForScope,
  healthSortFieldsForScope,
  healthTableViewSettingsAdapter,
} from "@/features/health/model/health-table-views";
import type { DietEntry } from "@/features/health/model/health-model";
import {
  TableViewActivePills,
  TableViewControls,
  type TableViewControlsAdapter,
} from "@/features/workbench/ui/TableViewControls";
import { TableViewTabs } from "@/features/workbench/ui/TableViewTabs";

export function HealthTableViewHeader({
  controller,
  entries,
  onAdd,
  addButtonRef,
  onArchiveSelected,
  archiveButtonRef,
  archiveDisabled,
}: {
  controller: HealthController;
  entries: DietEntry[];
  onAdd(): void;
  addButtonRef: React.RefObject<HTMLButtonElement>;
  onArchiveSelected(): void;
  archiveButtonRef: React.RefObject<HTMLButtonElement>;
  archiveDisabled: boolean;
}) {
  const scope = "health.diet" as const;
  const settings = controller.tableSettings(scope);
  const empty = {
    tags: [], areas: [], projects: [], currencies: [], routines: [], statuses: [],
    priorities: [], horizons: [], parents: [], materializationPolicies: [], participants: [],
  };
  const candidates = deriveDietGroups(entries, {
    ...defaultHealthTableSettings(scope),
    groupSettings: {
      ...settings.groupSettings,
      hideEmpty: false,
      manualOrder: [],
      hiddenGroupKeys: [],
    },
  }).filter(({ label }) => label !== null).map(({ key, label, rows }) => ({
    key, label: label!, count: rows.length,
  }));
  const adapter: TableViewControlsAdapter = {
    scopeId: scope,
    title: "Diet",
    settings,
    filterFields: healthFilterFieldsForScope(scope),
    fieldLabels: { meal_type: "Meal", has_photo: "Photo" },
    sortFields: healthSortFieldsForScope(scope),
    groupOptions: [...healthGroupOptionsForScope(scope)],
    candidates,
    filterOptions: {
      tags: [...new Set(entries.flatMap(({ tags }) => tags))].map((tag) => ({
        value: tag, label: tag,
      })),
      daily: empty,
      fieldOptions: healthDietFilterSelectOptions,
    },
    activeControlsAriaLabel: "Active Diet controls",
    dropdownIdPrefix: "health",
    isDefaultSort: (rules) => JSON.stringify(rules) === JSON.stringify(
      healthTableViewSettingsAdapter.defaultSettings(scope).sortRules,
    ),
    update: (updater) => controller.updateTableSettings(scope, updater),
  };
  return (
    <header className="workspace-table-header">
      <h1 id="health-diet-heading">Diet</h1>
      <div className="workspace-table-header-row ledger-table-header-row">
        <TableViewTabs
          scopeId={scope}
          title="Diet"
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
          <button ref={addButtonRef} className="items-toolbar-button" type="button" aria-label="Add diet entry" aria-haspopup="dialog" onClick={onAdd}>Add</button>
          <button
            ref={archiveButtonRef}
            className="items-toolbar-button"
            type="button"
            aria-label="Archive selected diet entries"
            disabled={archiveDisabled}
            onClick={onArchiveSelected}
          >Delete</button>
        </div>
      </div>
      <TableViewActivePills adapter={adapter} />
    </header>
  );
}
