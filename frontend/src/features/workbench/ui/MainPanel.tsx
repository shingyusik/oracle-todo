import React, { useEffect, useRef } from "react";
import {
  ArrowDownUp,
  ArrowLeft,
  Filter,
  Group,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";

import type { LeafTabId } from "@/domain/workbench/navigation";
import {
  buildDailyPlannerModel,
  buildWeeklyPlannerModel,
  type DailyGroupBy,
  type DailyPlannerSection,
  type DailySortBy,
} from "@/features/workbench/model/planner-model";
import type {
  WorkbenchController,
  WorkspaceItemModel,
  WorkspaceItemsModel,
  WorkspaceItemPatch,
  WorkspaceItemTransitionAction,
} from "@/features/workbench/model/workbench-model";

type MainPanelProps = {
  controller: WorkbenchController;
};

type PlannerDropdownKind = "filter" | "sort" | "group";

type ItemColumn = {
  label: string;
  value: (
    item: WorkspaceItemModel,
    workspaceItems: WorkspaceItemsModel,
    controller: WorkbenchController,
  ) => React.ReactNode;
};

const reviewCycleOptions = ["daily", "weekly", "monthly", "quarterly"];
const statusOptions = [
  "proposed",
  "approved",
  "active",
  "paused",
  "completed",
  "archived",
];
const areaStatusOptions = ["active", "archived"];
const taskStatusOptions = ["active", "completed"];
const eventStatusOptions = ["active", "paused", "completed"];
const materializationPolicyOptions = ["single_open", "per_occurrence"];
const priorityOptions = Array.from({ length: 10 }, (_, index) => (index + 1).toString());

function parseTagInput(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag, index, tags) => tags.indexOf(tag) === index);
}

function formatTags(tags: string[] | null | undefined): string {
  return (tags ?? []).join(", ");
}

function sameTags(left: string[] | null | undefined, right: string[] | null | undefined): boolean {
  return formatTags(left) === formatTags(right);
}

export function MainPanel({ controller }: MainPanelProps) {
  if (controller.detailItem) {
    return (
      <main className="main-panel">
        <DetailView controller={controller} />
      </main>
    );
  }

  if (isPlannerPanel(controller.selection.leafTabId)) {
    return (
      <main className="main-panel">
        <PlannerPanel controller={controller} />
      </main>
    );
  }

  return (
    <main className="main-panel">
      <WorkspaceItemsTable controller={controller} />
    </main>
  );
}

function DetailView({ controller }: MainPanelProps) {
  const item = controller.detailItem;
  const [draft, setDraft] = React.useState(() => detailDraftForItem(item));

  React.useEffect(() => {
    setDraft(detailDraftForItem(item));
  }, [item]);

  if (!item) {
    return null;
  }

  const detailItem = item;
  const hasDraftChanges = hasDetailChanges(detailItem, draft);

  function setField(field: keyof DetailDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function saveDraft() {
    const patch = detailPatchForItem(detailItem, draft);
    if (Object.keys(patch).length > 0) {
      await controller.saveDetailItem(patch);
    }

    const transition = transitionActionForStatus(detailItem.status, draft.status);
    if (transition) {
      await controller.transitionWorkspaceItem(detailItem.id, transition);
    }
  }

  return (
    <section className="detail-view" aria-label={`${item.title} details`}>
      <div className="detail-shell">
        <header className="detail-header">
          <button
            type="button"
            className="detail-back"
            aria-label="< Back"
            onClick={controller.closeDetailView}
          >
            <ArrowLeft size={16} aria-hidden="true" />
          </button>
          <div className="detail-heading">
            <div className="detail-kicker">
              <span>{item.type}</span>
              <span>{displayStatusForItem(item)}</span>
            </div>
            <h1>{item.title}</h1>
          </div>
          <div className="detail-actions">
            <button
              type="button"
              aria-label="Save"
              disabled={!hasDraftChanges}
              onClick={() => void saveDraft()}
            >
              <Save size={16} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="detail-properties">
          <h2>Properties</h2>
          <div className="detail-properties-list">
            <label className="field-label">
              Title
              <input
                value={draft.title}
                onChange={(event) => setField("title", event.target.value)}
              />
            </label>
            <DetailStatusField
              item={item}
              value={draft.status}
              onChange={(value) => setField("status", value)}
            />
            <DetailTagsField
              value={draft.tags}
              onChange={(value) => setField("tags", value)}
            />
            <DetailTypeFields
              item={item}
              draft={draft}
              setField={setField}
              workspaceItems={controller.workspaceItems}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function isPlannerPanel(leafTabId: LeafTabId): boolean {
  return ["yearly", "monthly", "weekly", "daily"].includes(leafTabId);
}

function PlannerPanel({ controller }: MainPanelProps) {
  const { panel, workspaceItems } = controller;

  if (workspaceItems.status === "idle") {
    return null;
  }

  if (workspaceItems.status === "loading") {
    return (
      <section className="items-section" aria-label={`${panel.title} planner`}>
        <p className="items-message" role="status">
          Loading {panel.title.toLowerCase()} planner...
        </p>
      </section>
    );
  }

  if (workspaceItems.status === "error") {
    return (
      <section className="items-section" aria-label={`${panel.title} planner`}>
        <p className="items-message" role="alert">
          Could not load todo-engine items.
        </p>
      </section>
    );
  }

  const filterOptions = buildPlannerFilterOptions(controller);
  const effectiveFilters =
    panel.id === "daily"
      ? effectiveDailyFilters(controller.planner.dailyFilters, filterOptions.daily)
      : {
          ...controller.planner.dailyFilters,
          tags: filterValuesByOptions(
            controller.planner.dailyFilters.tags,
            filterOptions.tags,
          ),
        };

  return (
    <section
      className="items-section planner-panel"
      aria-label={`${panel.title} planner`}
    >
      <PlannerControlToolbar
        controller={controller}
        filterOptions={filterOptions}
        effectiveFilters={effectiveFilters}
      />
      {panel.id === "weekly" ? <WeeklyPlanner controller={controller} /> : null}
      {panel.id === "daily" ? <DailyPlanner controller={controller} /> : null}
      {panel.id === "yearly" ? (
        <GoalPlannerList controller={controller} horizon="year" />
      ) : null}
      {panel.id === "monthly" ? (
        <GoalPlannerList controller={controller} horizon="month" />
      ) : null}
      {controller.creationDialogOpen ? <CreationDialog controller={controller} /> : null}
    </section>
  );
}

function GoalPlannerList({
  controller,
  horizon,
}: {
  controller: WorkbenchController;
  horizon: "year" | "month";
}) {
  const tags = effectivePlannerTags(
    controller.panel.id,
    controller.workspaceItems.items,
    controller.planner,
  );
  const goals = filterPlannerItemsByTags(
    controller.workspaceItems.items,
    tags,
  ).filter(
    (item) =>
      item.type === "goal" &&
      !isTerminalPlannerItem(item) &&
      item.horizon === horizon &&
      goalMatchesPlannerPeriod(item, horizon, controller.planner.date),
  );

  return (
    <section className="planner-section" aria-label={`${horizon} goals`}>
      <h2>{horizon === "year" ? "Year goals" : "Month goals"}</h2>
      {goals.length === 0 ? (
        <p className="items-message">No goals found.</p>
      ) : (
        <ul className="planner-card-list">
          {goals.map((item) => (
            <li key={item.id}>
              <button
                className="planner-item"
                type="button"
                onClick={() => controller.openDetailView(item)}
              >
                {item.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function WeeklyPlanner({ controller }: MainPanelProps) {
  const tags = effectivePlannerTags(
    controller.panel.id,
    controller.workspaceItems.items,
    controller.planner,
  );
  const items = filterPlannerItemsByTags(
    controller.workspaceItems.items,
    tags,
  );
  const model = buildWeeklyPlannerModel(
    items,
    controller.planner.weekStart,
  );

  return (
    <div className="planner-panel">
      <div className="planner-goal-grid">
        <section className="planner-section" aria-label="Weekly month goals">
          <h2>Goals for this month</h2>
          {model.monthGoals.length === 0 ? (
            <p className="items-message">No goals found.</p>
          ) : (
            <ul className="planner-card-list">
              {model.monthGoals.map((item) => (
                <li key={item.id}>
                  <button
                    className="planner-item"
                    type="button"
                    onClick={() => controller.openDetailView(item)}
                  >
                    {item.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="planner-section" aria-label="Weekly goals">
          <h2>Goals for this week</h2>
          {model.weekGoals.length === 0 ? (
            <p className="items-message">No goals found.</p>
          ) : (
            <ul className="planner-card-list">
              {model.weekGoals.map((item) => (
                <li key={item.id}>
                  <button
                    className="planner-item"
                    type="button"
                    onClick={() => controller.openDetailView(item)}
                  >
                    {item.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <div className="weekly-day-grid">
        {model.days.map((day) => (
          <section
            className="planner-card"
            key={day.date}
            data-testid="weekly-day-card"
          >
            <h3>{day.label}</h3>
            {day.items.length === 0 ? (
              <p className="items-message">No scheduled items.</p>
            ) : (
              <ul className="planner-card-list">
                {day.items.map((item) => (
                  <li key={item.id}>
                    <button
                      className="planner-item"
                      type="button"
                      onClick={() => controller.openDetailView(item)}
                    >
                      {item.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function DailyPlanner({ controller }: MainPanelProps) {
  const filterOptions = buildDailyFilterOptions(controller);
  const filters = effectiveDailyFilters(
    controller.planner.dailyFilters,
    filterOptions,
  );
  const model = buildDailyPlannerModel(
    controller.workspaceItems.items,
    controller.workspaceItems.relatedItems,
    {
      date: controller.planner.date,
      filters,
      groupBy: controller.planner.dailyGroupBy,
      sortBy: controller.planner.dailySortBy,
    },
  );

  return (
    <div className="planner-panel">
      <div className="items-toolbar planner-control-row">
        <DailyFilterSelect
          label="Filter daily items by tags"
          displayLabel="Tags"
          options={filterOptions.tags}
          value={filters.tags}
          onChange={(values) => controller.setDailyFilter("tags", values)}
        />
        <DailyFilterSelect
          label="Filter daily items by area"
          displayLabel="Area"
          options={filterOptions.areas}
          value={filters.areaIds}
          onChange={(values) => controller.setDailyFilter("areaIds", values)}
        />
        <DailyFilterSelect
          label="Filter daily items by project"
          displayLabel="Project"
          options={filterOptions.projects}
          value={filters.projectIds}
          onChange={(values) => controller.setDailyFilter("projectIds", values)}
        />
        <DailyFilterSelect
          label="Filter daily items by routine"
          displayLabel="Routine"
          options={filterOptions.routines}
          value={filters.routineIds}
          onChange={(values) => controller.setDailyFilter("routineIds", values)}
        />
        <DailyFilterSelect
          label="Filter daily items by item type"
          displayLabel="Item"
          options={filterOptions.itemTypes}
          value={filters.itemTypes}
          onChange={(values) => controller.setDailyFilter("itemTypes", values)}
        />
        <DailyFilterSelect
          label="Filter daily items by status"
          displayLabel="Status"
          options={filterOptions.statuses}
          value={filters.statuses}
          onChange={(values) => controller.setDailyFilter("statuses", values)}
        />
      </div>
      <div className="items-toolbar planner-control-row">
        <label>
          Group by
          <select
            aria-label="Group daily items by"
            value={controller.planner.dailyGroupBy}
            onChange={(event) =>
              controller.setDailyGroupBy(event.target.value as DailyGroupBy)
            }
          >
            <option value="none">No grouping</option>
            <option value="area">Area</option>
            <option value="project">Project</option>
            <option value="routine">Routine</option>
            <option value="tag">Tag</option>
            <option value="item_type">Item type</option>
            <option value="status">Status</option>
          </select>
        </label>
        <label>
          Sort by
          <select
            aria-label="Sort daily items by"
            value={controller.planner.dailySortBy}
            onChange={(event) =>
              controller.setDailySortBy(event.target.value as DailySortBy)
            }
          >
            <option value="priority">Priority</option>
            <option value="scheduled">Scheduled</option>
            <option value="updated">Updated</option>
            <option value="title">Title</option>
          </select>
        </label>
      </div>
      <DailyPlannerSectionView
        controller={controller}
        section={model.sections.today}
      />
      <DailyPlannerSectionView
        controller={controller}
        section={model.sections.overdue}
      />
      <DailyPlannerSectionView
        controller={controller}
        section={model.sections.upcoming}
      />
      <DailyPlannerSectionView
        controller={controller}
        section={model.sections.unscheduled}
      />
    </div>
  );
}

type PlannerFilterOptions = {
  tags: DailyFilterOption[];
  daily: ReturnType<typeof buildDailyFilterOptions>;
};

function PlannerControlToolbar({
  controller,
  filterOptions,
  effectiveFilters,
}: {
  controller: WorkbenchController;
  filterOptions: PlannerFilterOptions;
  effectiveFilters: WorkbenchController["planner"]["dailyFilters"];
}) {
  const [openDropdown, setOpenDropdown] =
    React.useState<PlannerDropdownKind | null>(null);
  const activeFilterCount = plannerFilterRuleCount(controller.panel.id, effectiveFilters);
  const sortBy = plannerSortValue(controller);
  const groupBy = plannerGroupValue(controller);

  function toggleDropdown(kind: PlannerDropdownKind) {
    setOpenDropdown((current) => (current === kind ? null : kind));
  }

  return (
    <div className="planner-view-controls">
      <div className="planner-view-control-bar">
        <div className="planner-view-pill">{controller.panel.title}</div>
        <div className="planner-view-actions">
          <PlannerDropdownButton
            active={activeFilterCount > 0}
            ariaLabel="Filter planner view"
            title="Filter"
            onClick={() => toggleDropdown("filter")}
          >
            <Filter size={16} aria-hidden="true" />
          </PlannerDropdownButton>
          <PlannerDropdownButton
            active={sortBy !== defaultPlannerSortValue(controller)}
            ariaLabel="Sort planner view"
            title="Sort"
            onClick={() => toggleDropdown("sort")}
          >
            <ArrowDownUp size={16} aria-hidden="true" />
          </PlannerDropdownButton>
          <PlannerDropdownButton
            active={groupBy !== "none"}
            ariaLabel="Group planner view"
            title="Group by"
            onClick={() => toggleDropdown("group")}
          >
            <Group size={16} aria-hidden="true" />
          </PlannerDropdownButton>
          <button
            className="items-toolbar-button"
            type="button"
            aria-label="Add planner item"
            onClick={controller.openCreationDialog}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <PlannerActiveControlPills
        filterCount={activeFilterCount}
        sortBy={sortBy}
        groupBy={groupBy}
      />
      {openDropdown === "filter" ? (
        <PlannerControlDropdown title="Filter">
          <PlannerFilterRulePanel
            controller={controller}
            filterOptions={filterOptions}
            effectiveFilters={effectiveFilters}
          />
        </PlannerControlDropdown>
      ) : null}
      {openDropdown === "sort" ? (
        <PlannerControlDropdown title="Sort">
          <PlannerSortPanel controller={controller} />
        </PlannerControlDropdown>
      ) : null}
      {openDropdown === "group" ? (
        <PlannerControlDropdown title="Group by">
          <PlannerGroupPanel controller={controller} />
        </PlannerControlDropdown>
      ) : null}
    </div>
  );
}

function PlannerDropdownButton({
  active,
  ariaLabel,
  title,
  onClick,
  children,
}: {
  active: boolean;
  ariaLabel: string;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="planner-view-icon-button"
      type="button"
      aria-label={ariaLabel}
      title={title}
      data-active={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function PlannerControlDropdown({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="planner-control-dropdown" role="dialog" aria-label={title}>
      <div className="planner-control-dropdown-title">{title}</div>
      {children}
    </div>
  );
}

function PlannerActiveControlPills({
  filterCount,
  sortBy,
  groupBy,
}: {
  filterCount: number;
  sortBy: string;
  groupBy: string;
}) {
  void sortBy;

  if (filterCount === 0 && groupBy === "none") {
    return null;
  }

  return (
    <div className="planner-active-control-row" aria-label="Active planner controls">
      {filterCount > 0 ? (
        <span className="planner-active-pill">{filterCount} rules</span>
      ) : null}
      {groupBy !== "none" ? (
        <span className="planner-active-pill">Grouped by {plannerControlLabel(groupBy)}</span>
      ) : null}
    </div>
  );
}

function plannerControlLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function PlannerFilterRulePanel({
  controller,
  filterOptions,
  effectiveFilters,
}: {
  controller: WorkbenchController;
  filterOptions: PlannerFilterOptions;
  effectiveFilters: WorkbenchController["planner"]["dailyFilters"];
}) {
  if (controller.panel.id !== "daily") {
    return (
      <DailyFilterSelect
        label="Filter planner items by tags"
        options={filterOptions.tags}
        value={effectiveFilters.tags}
        onChange={(values) => controller.setDailyFilter("tags", values)}
      />
    );
  }

  return (
    <div className="planner-control-row">
      <DailyFilterSelect
        label="Filter daily items by tags"
        displayLabel="Tags"
        options={filterOptions.daily.tags}
        value={effectiveFilters.tags}
        onChange={(values) => controller.setDailyFilter("tags", values)}
      />
      <DailyFilterSelect
        label="Filter daily items by area"
        displayLabel="Area"
        options={filterOptions.daily.areas}
        value={effectiveFilters.areaIds}
        onChange={(values) => controller.setDailyFilter("areaIds", values)}
      />
      <DailyFilterSelect
        label="Filter daily items by project"
        displayLabel="Project"
        options={filterOptions.daily.projects}
        value={effectiveFilters.projectIds}
        onChange={(values) => controller.setDailyFilter("projectIds", values)}
      />
      <DailyFilterSelect
        label="Filter daily items by routine"
        displayLabel="Routine"
        options={filterOptions.daily.routines}
        value={effectiveFilters.routineIds}
        onChange={(values) => controller.setDailyFilter("routineIds", values)}
      />
      <DailyFilterSelect
        label="Filter daily items by item type"
        displayLabel="Item"
        options={filterOptions.daily.itemTypes}
        value={effectiveFilters.itemTypes}
        onChange={(values) => controller.setDailyFilter("itemTypes", values)}
      />
      <DailyFilterSelect
        label="Filter daily items by status"
        displayLabel="Status"
        options={filterOptions.daily.statuses}
        value={effectiveFilters.statuses}
        onChange={(values) => controller.setDailyFilter("statuses", values)}
      />
    </div>
  );
}

function PlannerSortPanel({ controller }: { controller: WorkbenchController }) {
  if (controller.panel.id === "daily") {
    return (
      <label className="planner-filter-label">
        <span>Sort</span>
        <select
          aria-label="Sort daily items by"
          value={controller.planner.dailySortBy}
          onChange={(event) =>
            controller.setDailySortBy(event.target.value as DailySortBy)
          }
        >
          <option value="priority">Priority</option>
          <option value="scheduled">Scheduled</option>
          <option value="updated">Updated</option>
          <option value="title">Title</option>
        </select>
      </label>
    );
  }

  return (
    <label className="planner-filter-label">
      <span>Sort</span>
      <select
        aria-label="Sort planner items by"
        value={controller.planner.plannerSortBy}
        onChange={(event) => controller.setPlannerSortBy(event.target.value as DailySortBy)}
      >
        <option value="scheduled">Scheduled</option>
        <option value="priority">Priority</option>
        <option value="updated">Updated</option>
        <option value="title">Title</option>
      </select>
    </label>
  );
}

function PlannerGroupPanel({ controller }: { controller: WorkbenchController }) {
  if (controller.panel.id === "daily") {
    return (
      <label className="planner-filter-label">
        <span>Group by</span>
        <select
          aria-label="Group daily items by"
          value={controller.planner.dailyGroupBy}
          onChange={(event) =>
            controller.setDailyGroupBy(event.target.value as DailyGroupBy)
          }
        >
          <option value="none">No grouping</option>
          <option value="area">Area</option>
          <option value="project">Project</option>
          <option value="routine">Routine</option>
          <option value="tag">Tag</option>
          <option value="item_type">Item type</option>
          <option value="status">Status</option>
        </select>
      </label>
    );
  }

  return (
    <label className="planner-filter-label">
      <span>Group by</span>
      <select
        aria-label="Group planner items by"
        value={controller.planner.plannerGroupBy}
        onChange={(event) => controller.setPlannerGroupBy(event.target.value as DailyGroupBy)}
      >
        <option value="none">No grouping</option>
        <option value="area">Area</option>
        <option value="project">Project</option>
        <option value="routine">Routine</option>
        <option value="tag">Tag</option>
        <option value="item_type">Item type</option>
        <option value="status">Status</option>
      </select>
    </label>
  );
}

type DailyFilterOption = {
  value: string;
  label: string;
};

function DailyFilterSelect({
  label,
  displayLabel = label,
  options,
  value,
  onChange,
}: {
  label: string;
  displayLabel?: string;
  options: DailyFilterOption[];
  value: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <label className="planner-filter-label">
      <span>{displayLabel}</span>
      <select
        multiple
        aria-label={label}
        value={value}
        size={Math.min(Math.max(options.length, 2), 4)}
        onChange={(event) =>
          onChange(
            Array.from(event.target.selectedOptions, (option) => option.value),
          )
        }
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function buildDailyFilterOptions(
  controller: WorkbenchController,
): {
  tags: DailyFilterOption[];
  areas: DailyFilterOption[];
  projects: DailyFilterOption[];
  routines: DailyFilterOption[];
  itemTypes: DailyFilterOption[];
  statuses: DailyFilterOption[];
} {
  const { items, relatedItems } = controller.workspaceItems;
  const dailyItems = items
    .filter(isDailyPlannerItem)
    .filter((item) => !isTerminalPlannerItem(item));

  return {
    tags: toFilterOptions(dailyItems.flatMap((item) => item.tags ?? [])),
    areas: relationFilterOptions(dailyItems, relatedItems.areas, "area_id"),
    projects: relationFilterOptions(dailyItems, relatedItems.projects, "project_id"),
    routines: relationFilterOptions(dailyItems, relatedItems.routines, "routine_id"),
    itemTypes: toFilterOptions(dailyItems.map((item) => item.type)),
    statuses: toFilterOptions(dailyItems.map((item) => item.status)),
  };
}

function buildPlannerFilterOptions(
  controller: WorkbenchController,
): PlannerFilterOptions {
  return {
    tags:
      controller.panel.id === "daily"
        ? []
        : buildPlannerTagFilterOptions(
            controller.panel.id,
            controller.workspaceItems.items,
            controller.planner,
          ),
    daily: buildDailyFilterOptions(controller),
  };
}

function buildPlannerTagFilterOptions(
  panelId: WorkbenchController["panel"]["id"],
  items: WorkspaceItemModel[],
  planner: WorkbenchController["planner"],
): DailyFilterOption[] {
  return toFilterOptions(
    items
      .filter((item) => isVisiblePlannerFilterItem(panelId, item, planner))
      .flatMap((item) => item.tags ?? []),
  );
}

function effectivePlannerTags(
  panelId: WorkbenchController["panel"]["id"],
  items: WorkspaceItemModel[],
  planner: WorkbenchController["planner"],
): string[] {
  return filterValuesByOptions(
    planner.dailyFilters.tags,
    buildPlannerTagFilterOptions(panelId, items, planner),
  );
}

function effectiveDailyFilters(
  filters: WorkbenchController["planner"]["dailyFilters"],
  options: ReturnType<typeof buildDailyFilterOptions>,
): WorkbenchController["planner"]["dailyFilters"] {
  return {
    tags: filterValuesByOptions(filters.tags, options.tags),
    areaIds: filterValuesByOptions(filters.areaIds, options.areas),
    projectIds: filterValuesByOptions(filters.projectIds, options.projects),
    routineIds: filterValuesByOptions(filters.routineIds, options.routines),
    itemTypes: filterValuesByOptions(filters.itemTypes, options.itemTypes),
    statuses: filterValuesByOptions(filters.statuses, options.statuses),
  };
}

function plannerFilterRuleCount(
  panelId: WorkbenchController["panel"]["id"],
  filters: WorkbenchController["planner"]["dailyFilters"],
): number {
  if (panelId !== "daily") {
    return filters.tags.length > 0 ? 1 : 0;
  }

  return [
    filters.tags,
    filters.areaIds,
    filters.projectIds,
    filters.routineIds,
    filters.itemTypes,
    filters.statuses,
  ].filter((values) => values.length > 0).length;
}

function plannerSortValue(controller: WorkbenchController): string {
  return controller.panel.id === "daily"
    ? controller.planner.dailySortBy
    : controller.planner.plannerSortBy;
}

function plannerGroupValue(controller: WorkbenchController): string {
  return controller.panel.id === "daily"
    ? controller.planner.dailyGroupBy
    : controller.planner.plannerGroupBy;
}

function defaultPlannerSortValue(controller: WorkbenchController): string {
  return controller.panel.id === "daily" ? "priority" : "scheduled";
}

function filterValuesByOptions(
  values: string[],
  options: DailyFilterOption[],
): string[] {
  const allowed = new Set(options.map((option) => option.value));
  return values.filter((value) => allowed.has(value));
}

function filterPlannerItemsByTags(
  items: WorkspaceItemModel[],
  tags: string[],
): WorkspaceItemModel[] {
  if (tags.length === 0) {
    return items;
  }
  return items.filter((item) => tags.some((tag) => item.tags?.includes(tag)));
}

function isDailyPlannerItem(item: WorkspaceItemModel): boolean {
  return item.type === "task" || item.type === "event" || item.type === "routine";
}

function isVisiblePlannerFilterItem(
  panelId: WorkbenchController["panel"]["id"],
  item: WorkspaceItemModel,
  planner: WorkbenchController["planner"],
): boolean {
  if (isTerminalPlannerItem(item)) {
    return false;
  }
  if (panelId === "yearly") {
    return (
      item.type === "goal" &&
      item.horizon === "year" &&
      goalMatchesPlannerPeriod(item, "year", planner.date)
    );
  }
  if (panelId === "monthly") {
    return (
      item.type === "goal" &&
      item.horizon === "month" &&
      goalMatchesPlannerPeriod(item, "month", planner.date)
    );
  }
  if (panelId === "weekly") {
    const scheduled = item.scheduled?.slice(0, 10);
    const weekDates = Array.from({ length: 7 }, (_, offset) =>
      addDays(planner.weekStart, offset),
    );
    return (
      (item.type === "goal" &&
        ((item.horizon === "month" &&
          scheduled?.startsWith(planner.weekStart.slice(0, 7))) ||
          (item.horizon === "week" &&
            scheduled != null &&
            weekDates.includes(scheduled)))) ||
      (isDailyPlannerItem(item) &&
        scheduled != null &&
        weekDates.includes(scheduled))
    );
  }
  if (panelId === "daily") {
    return isDailyPlannerItem(item);
  }
  return true;
}

function isTerminalPlannerItem(item: WorkspaceItemModel): boolean {
  return (
    item.status === "completed" ||
    item.status === "archived" ||
    item.status === "dropped" ||
    item.status === "cancelled"
  );
}

function goalMatchesPlannerPeriod(
  item: WorkspaceItemModel,
  horizon: "year" | "month",
  plannerDate: string,
): boolean {
  const scheduled = item.scheduled?.slice(0, 10);
  if (!scheduled) {
    return false;
  }
  if (horizon === "year") {
    return scheduled.slice(0, 4) === plannerDate.slice(0, 4);
  }
  return scheduled.slice(0, 7) === plannerDate.slice(0, 7);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function relationFilterOptions(
  items: WorkspaceItemModel[],
  labels: Record<string, string>,
  field: "area_id" | "project_id" | "routine_id",
): DailyFilterOption[] {
  return toFilterOptions(
    items
      .map((item) => item[field])
      .filter((value): value is string => Boolean(value)),
    (value) => labels[value] ?? value,
  );
}

function toFilterOptions(
  values: string[],
  labelForValue?: (value: string) => string,
): DailyFilterOption[] {
  return [...new Set(values)].sort().map((value) => ({
    value,
    label: labelForValue ? labelForValue(value) : value,
  }));
}

function DailyPlannerSectionView({
  controller,
  section,
}: {
  controller: WorkbenchController;
  section: DailyPlannerSection;
}) {
  return (
    <section className="planner-section" aria-label={section.title}>
      <h2>{section.title}</h2>
      {section.groups.length === 0 ? (
        <p className="items-message">No items found.</p>
      ) : (
        section.groups.map((group) => (
          <div className="planner-card-list" key={group.key}>
            {group.label !== "All" ? <h3>{group.label}</h3> : null}
            <ul className="planner-card-list">
              {group.items.map((item) => (
                <li key={item.id}>
                  <button
                    className="planner-item"
                    type="button"
                    onClick={() => controller.openDetailView(item)}
                  >
                    {item.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

type DetailDraft = {
  title: string;
  status: string;
  tags: string;
  area: string;
  project_id: string;
  routine_id: string;
  parent_id: string;
  description: string;
  note: string;
  outcome: string;
  horizon: string;
  definition_of_done: string;
  review_cycle: string;
  standard: string;
  recurrence_rule: string;
  materialization_policy: string;
  location: string;
  participants: string;
  commitment_type: string;
  due: string;
  scheduled: string;
  priority: string;
};

type StringWorkspaceItemPatchField = {
  [Key in keyof WorkspaceItemPatch]: WorkspaceItemPatch[Key] extends string | undefined
    ? Key
    : never;
}[keyof WorkspaceItemPatch] & string;

function detailDraftForItem(item: WorkspaceItemModel | null): DetailDraft {
  return {
    title: item?.title ?? "",
    status: detailStatusForItem(item),
    tags: formatTags(item?.tags),
    area: item?.area_id ?? "",
    project_id: item?.project_id ?? "",
    routine_id: item?.routine_id ?? "",
    parent_id: item?.parent_id ?? "",
    description: itemDescription(item) ?? "",
    note: item?.note ?? "",
    outcome: item?.outcome ?? "",
    horizon: item?.horizon ?? "month",
    definition_of_done: item?.definition_of_done ?? "",
    review_cycle: item?.review_cycle ?? "",
    standard: item?.standard ?? "",
    recurrence_rule: item?.recurrence_rule ?? "",
    materialization_policy: item?.materialization_policy ?? "single_open",
    location: item?.metadata_?.location ?? "",
    participants: item?.metadata_?.participants?.join(", ") ?? "",
    commitment_type: item?.metadata_?.commitment_type ?? "",
    due: item?.due ?? "",
    scheduled:
      item?.type === "event"
        ? formatDateTimeLocalValue(item.scheduled)
        : formatDateValue(item?.scheduled),
    priority: item?.priority?.toString() ?? "",
  };
}

function detailPatchForItem(
  item: WorkspaceItemModel,
  draft: DetailDraft,
): WorkspaceItemPatch {
  const patch: WorkspaceItemPatch = {};

  addStringPatch(patch, "title", draft.title, item.title);
  addStringPatch(patch, "note", draft.note, item.note);
  addStringPatch(patch, "description", draft.description, itemDescription(item));
  const draftTags = parseTagInput(draft.tags);
  if (!sameTags(draftTags, item.tags)) {
    patch.tags = draftTags;
  }
  if (draft.area !== (item.area_id ?? "")) {
    patch.area = draft.area;
  }
  if (draft.project_id !== (item.project_id ?? "")) {
    patch.project_id = draft.project_id;
  }
  if (draft.routine_id !== (item.routine_id ?? "")) {
    patch.routine_id = draft.routine_id;
  }
  if (draft.parent_id !== (item.parent_id ?? "")) {
    patch.parent_id = draft.parent_id;
  }

  if (item.type === "project") {
    addStringPatch(patch, "outcome", draft.outcome, item.outcome);
    addStringPatch(
      patch,
      "definition_of_done",
      draft.definition_of_done,
      item.definition_of_done,
    );
    addStringPatch(patch, "due", draft.due, item.due);
  }
  if (item.type === "routine") {
    addStringPatch(
      patch,
      "recurrence_rule",
      draft.recurrence_rule,
      item.recurrence_rule,
    );
    addStringPatch(
      patch,
      "materialization_policy",
      draft.materialization_policy,
      item.materialization_policy,
    );
  }
  if (item.type === "task") {
    addStringPatch(patch, "due", draft.due, item.due);
    addStringPatch(patch, "scheduled", draft.scheduled, item.scheduled);
    addPriorityPatch(patch, draft.priority, item.priority);
  }
  if (item.type === "event") {
    const participants = draft.participants
      .split(",")
      .map((participant) => participant.trim())
      .filter(Boolean);
    const currentParticipants = item.metadata_?.participants?.join(", ") ?? "";

    addStringPatch(
      patch,
      "scheduled",
      formatDateTimeCommitValue(draft.scheduled),
      item.scheduled,
    );
    addStringPatch(patch, "due", draft.due, item.due);
    addPriorityPatch(patch, draft.priority, item.priority);
    addStringPatch(patch, "location", draft.location, item.metadata_?.location);
    if (draft.participants !== currentParticipants) {
      patch.participants = participants;
    }
    addStringPatch(
      patch,
      "commitment_type",
      draft.commitment_type,
      item.metadata_?.commitment_type,
    );
  }
  if (item.type === "area") {
    addStringPatch(patch, "review_cycle", draft.review_cycle, item.review_cycle);
    addStringPatch(patch, "standard", draft.standard, item.standard);
  }
  if (item.type === "goal") {
    addStringPatch(patch, "horizon", draft.horizon, item.horizon);
    addStringPatch(patch, "scheduled", draft.scheduled, item.scheduled);
    addStringPatch(patch, "due", draft.due, item.due);
  }

  return patch;
}

function hasDetailChanges(item: WorkspaceItemModel, draft: DetailDraft): boolean {
  return (
    Object.keys(detailPatchForItem(item, draft)).length > 0 ||
    transitionActionForStatus(detailStatusForItem(item), draft.status) !== null
  );
}

function addStringPatch(
  patch: WorkspaceItemPatch,
  field: StringWorkspaceItemPatchField,
  value: string,
  currentValue: string | null | undefined,
) {
  if (value !== (currentValue ?? "")) {
    patch[field] = value;
  }
}

function addPriorityPatch(
  patch: WorkspaceItemPatch,
  priority: string,
  currentPriority?: number | null,
) {
  const value = Number(normalizePriorityDraft(priority));
  if (priority.trim() !== "" && validPriority(value) && value !== currentPriority) {
    patch.priority = value;
  }
}

function validPriority(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 10;
}

function normalizePriorityDraft(value: string): string {
  const priority = Number(digitsOnly(value));
  if (!Number.isFinite(priority)) {
    return "";
  }

  return Math.min(10, Math.max(1, Math.trunc(priority))).toString();
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function blockNonDigitKey(event: React.KeyboardEvent<HTMLInputElement>) {
  const allowedKeys = [
    "Backspace",
    "Delete",
    "Tab",
    "Escape",
    "Enter",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
  ];

  if (
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    allowedKeys.includes(event.key)
  ) {
    return;
  }

  if (!/^\d$/.test(event.key)) {
    event.preventDefault();
  }
}

function blockNonDigitPaste(event: React.ClipboardEvent<HTMLInputElement>) {
  if (!/^\d*$/.test(event.clipboardData.getData("text"))) {
    event.preventDefault();
  }
}

function itemDescription(item: WorkspaceItemModel | null | undefined): string | null | undefined {
  return (item as WorkspaceItemModel & { description?: string | null } | null | undefined)
    ?.description;
}

function DetailTypeFields({
  item,
  draft,
  setField,
  workspaceItems,
}: {
  item: WorkspaceItemModel;
  draft: DetailDraft;
  setField: (field: keyof DetailDraft, value: string) => void;
  workspaceItems: WorkspaceItemsModel;
}) {
  if (item.type === "project") {
    return (
      <>
        <DetailRelationField
          label="Area"
          controlLabel={`Area for ${item.title}`}
          value={draft.area}
          options={workspaceItems.relatedItems.areas}
          onChange={(area) => setField("area", area)}
        />
        <DetailTextField
          label="Due"
          type="date"
          value={draft.due}
          onChange={(value) => setField("due", value)}
        />
        <DetailTextField
          label="Outcome"
          value={draft.outcome}
          onChange={(value) => setField("outcome", value)}
        />
        <DetailTextField
          label="Definition of Done"
          value={draft.definition_of_done}
          onChange={(value) => setField("definition_of_done", value)}
        />
        <DetailTimestamps item={item} />
        <DetailTextAreaField
          label="Note"
          value={draft.note}
          onChange={(value) => setField("note", value)}
        />
      </>
    );
  }
  if (item.type === "routine") {
    return (
      <>
        <DetailRelationField
          label="Area"
          controlLabel={`Area for ${item.title}`}
          value={draft.area}
          options={workspaceItems.relatedItems.areas}
          onChange={(area) => setField("area", area)}
        />
        <RecurrenceRuleField
          value={draft.recurrence_rule}
          onChange={(value) => setField("recurrence_rule", value)}
        />
        <label className="field-label">
          Materialization Policy
          <select
            value={draft.materialization_policy}
            onChange={(event) => setField("materialization_policy", event.target.value)}
          >
            {materializationPolicyOptions.map((option) => (
              <option key={option} value={option}>
                {displayMaterializationPolicy(option)}
              </option>
            ))}
          </select>
        </label>
        <DetailTimestamps item={item} />
        <DetailTextAreaField
          label="Note"
          value={draft.note}
          onChange={(value) => setField("note", value)}
        />
        <div className="property-row">
          <span>Last Materialized</span>
          <span>{formatDate(item.last_materialized_at)}</span>
        </div>
      </>
    );
  }
  if (item.type === "task") {
    return (
      <>
        <DetailRelationField
          label="Area"
          controlLabel={`Area for ${item.title}`}
          value={draft.area}
          options={workspaceItems.relatedItems.areas}
          onChange={(area) => setField("area", area)}
        />
        <DetailRelationField
          label="Project"
          controlLabel={`Project for ${item.title}`}
          value={draft.project_id}
          options={workspaceItems.relatedItems.projects}
          allowNone
          onChange={(project_id) => setField("project_id", project_id)}
        />
        <div className="property-row">
          <span>Routine</span>
          <span>{relatedTitle(workspaceItems.relatedItems.routines, item.routine_id)}</span>
        </div>
        <DetailTextField
          label="Scheduled"
          type="date"
          value={draft.scheduled}
          onChange={(value) => setField("scheduled", value)}
        />
        <DetailTextField
          label="Due"
          type="date"
          value={draft.due}
          onChange={(value) => setField("due", value)}
        />
        <DetailPriorityField
          label="Priority"
          value={draft.priority}
          onChange={(value) => setField("priority", value)}
        />
        <DetailTimestamps item={item} />
        <DetailTextAreaField
          label="Description"
          value={draft.description}
          onChange={(value) => setField("description", value)}
        />
        <DetailTextAreaField
          label="Note"
          value={draft.note}
          onChange={(value) => setField("note", value)}
        />
      </>
    );
  }
  if (item.type === "event") {
    return (
      <>
        <DetailRelationField
          label="Area"
          controlLabel={`Area for ${item.title}`}
          value={draft.area}
          options={workspaceItems.relatedItems.areas}
          onChange={(area) => setField("area", area)}
        />
        <DetailRelationField
          label="Project"
          controlLabel={`Project for ${item.title}`}
          value={draft.project_id}
          options={workspaceItems.relatedItems.projects}
          allowNone
          onChange={(project_id) => setField("project_id", project_id)}
        />
        <DetailTextField
          label="Starts At"
          type="datetime-local"
          value={draft.scheduled}
          onChange={(value) => setField("scheduled", value)}
        />
        <DetailTextField
          label="Due"
          type="date"
          value={draft.due}
          onChange={(value) => setField("due", value)}
        />
        <DetailPriorityField
          label="Priority"
          value={draft.priority}
          onChange={(value) => setField("priority", value)}
        />
        <DetailTextField
          label="Location"
          value={draft.location}
          onChange={(value) => setField("location", value)}
        />
        <DetailTextField
          label="Participants"
          value={draft.participants}
          onChange={(value) => setField("participants", value)}
        />
        <DetailTextField
          label="Commitment Type"
          value={draft.commitment_type}
          onChange={(value) => setField("commitment_type", value)}
        />
        <DetailTimestamps item={item} />
        <DetailTextAreaField
          label="Description"
          value={draft.description}
          onChange={(value) => setField("description", value)}
        />
        <DetailTextAreaField
          label="Note"
          value={draft.note}
          onChange={(value) => setField("note", value)}
        />
      </>
    );
  }
  if (item.type === "area") {
    return (
      <>
        <label className="field-label">
          Review Cycle
          <select
            value={draft.review_cycle}
            onChange={(event) => setField("review_cycle", event.target.value)}
          >
            <option value="">-</option>
            {reviewCycleOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <DetailTextField
          label="Standard"
          value={draft.standard}
          onChange={(value) => setField("standard", value)}
        />
        <DetailTimestamps item={item} />
        <DetailTextAreaField
          label="Note"
          value={draft.note}
          onChange={(value) => setField("note", value)}
        />
      </>
    );
  }
  if (item.type === "goal") {
    return (
      <>
        <label className="field-label">
          Horizon
          <select value={draft.horizon} onChange={(event) => setField("horizon", event.target.value)}>
            <option value="week">week</option>
            <option value="month">month</option>
            <option value="year">year</option>
          </select>
        </label>
        <DetailTextField
          label="Scheduled"
          type="date"
          value={draft.scheduled}
          onChange={(value) => setField("scheduled", value)}
        />
        <DetailTextField
          label="Due"
          type="date"
          value={draft.due}
          onChange={(value) => setField("due", value)}
        />
        <DetailRelationField
          label="Parent"
          controlLabel={`Parent for ${item.title}`}
          value={draft.parent_id}
          options={workspaceItems.relatedItems.goals}
          allowNone
          onChange={(parent_id) => setField("parent_id", parent_id)}
        />
        <DetailTimestamps item={item} />
        <DetailTextAreaField
          label="Note"
          value={draft.note}
          onChange={(value) => setField("note", value)}
        />
      </>
    );
  }

  return null;
}

function DetailTimestamps({ item }: { item: WorkspaceItemModel }) {
  return (
    <>
      <div className="property-row">
        <span>Created</span>
        <span>{formatDate(item.created_at)}</span>
      </div>
      <div className="property-row">
        <span>Updated</span>
        <span>{formatDate(item.updated_at)}</span>
      </div>
    </>
  );
}

function DetailInlineField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={className ? `field-label ${className}` : "field-label"}>
      {label}
      {children}
    </label>
  );
}

function DetailTextField({
  label,
  type = "text",
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  type?: "text" | "date" | "datetime-local" | "number";
  min?: number;
  max?: number;
  step?: number;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <DetailInlineField label={label}>
      <input
        type={type}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </DetailInlineField>
  );
}

function DetailTagsField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <DetailInlineField label="Tags">
      <TagsInput
        label="Tags"
        value={parseTagInput(value)}
        onCommit={(tags) => onChange(formatTags(tags))}
      />
    </DetailInlineField>
  );
}

function DetailTextAreaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <DetailInlineField label={label} className="field-label-wide">
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
    </DetailInlineField>
  );
}

function DetailPriorityField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <DetailInlineField label={label}>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">-</option>
        {priorityOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </DetailInlineField>
  );
}

type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

type ParsedRecurrenceRule = {
  interval: string;
  frequency: RecurrenceFrequency;
  weekdays: string[];
  monthDay: string;
  lastDayOfMonth: boolean;
  month: string;
};

const weekdayOptions = [
  ["MO", "Monday"],
  ["TU", "Tuesday"],
  ["WE", "Wednesday"],
  ["TH", "Thursday"],
  ["FR", "Friday"],
  ["SA", "Saturday"],
  ["SU", "Sunday"],
] as const;

const recurrenceFrequencyOptions: [RecurrenceFrequency, string][] = [
  ["daily", "Daily"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
  ["yearly", "Yearly"],
];

function RecurrenceRuleField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const parsed = parseRecurrenceRule(value);
  const [intervalDraft, setIntervalDraft] = React.useState(parsed.interval);

  React.useEffect(() => {
    setIntervalDraft(parsed.interval);
  }, [parsed.interval]);

  function commit(next: Partial<ParsedRecurrenceRule>) {
    onChange(formatRecurrenceRule({ ...parsed, interval: intervalDraft, ...next }));
  }

  function toggleWeekday(day: string) {
    const selected = parsed.weekdays.includes(day)
      ? parsed.weekdays.filter((current) => current !== day)
      : [...parsed.weekdays, day];
    commit({
      weekdays: weekdayOptions
        .map(([value]) => value)
        .filter((value) => selected.includes(value)),
    });
  }

  const preview = formatRecurrenceRule({ ...parsed, interval: intervalDraft });

  return (
    <div className="recurrence-row">
      <span className="recurrence-row-label">Recurrence Rule</span>
      <div className="recurrence-fields">
        <label className="field-label recurrence-field recurrence-field-short">
          Every
          <input
            type="number"
            min={1}
            max={365}
            step={1}
            value={intervalDraft}
            onChange={(event) => {
              const interval = event.target.value;
              setIntervalDraft(interval);
              if (validRecurrenceInterval(interval)) {
                onChange(formatRecurrenceRule({ ...parsed, interval }));
              }
            }}
            onBlur={() => {
              if (!validRecurrenceInterval(intervalDraft)) {
                setIntervalDraft("1");
                onChange(formatRecurrenceRule({ ...parsed, interval: "1" }));
              }
            }}
          />
        </label>
        <label className="field-label recurrence-field recurrence-field-medium">
          Frequency
          <select
            value={parsed.frequency}
            onChange={(event) =>
              commit({ frequency: event.target.value as RecurrenceFrequency })
            }
          >
            {recurrenceFrequencyOptions.map(([optionValue, label]) => (
              <option key={optionValue} value={optionValue}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {parsed.frequency === "weekly" ? (
          <div className="recurrence-weekdays">
            {weekdayOptions.map(([day, label]) => (
              <label key={day} className="recurrence-checkbox-label">
                <input
                  type="checkbox"
                  aria-label={label}
                  checked={parsed.weekdays.includes(day)}
                  onChange={() => toggleWeekday(day)}
                />
                <span>{label.slice(0, 3)}</span>
              </label>
            ))}
          </div>
        ) : null}
        {parsed.frequency === "monthly" || parsed.frequency === "yearly" ? (
          <>
            <label className="field-label recurrence-field recurrence-field-short">
              Month day
              <input
                type="number"
                min={1}
                max={31}
                step={1}
                value={parsed.monthDay}
                disabled={parsed.lastDayOfMonth}
                onChange={(event) =>
                  commit({
                    monthDay: clampRecurrenceNumber(event.target.value, 1, 31),
                    lastDayOfMonth: false,
                  })
                }
              />
            </label>
            <label className="recurrence-checkbox-label recurrence-last-day">
              <input
                type="checkbox"
                checked={parsed.lastDayOfMonth}
                onChange={(event) =>
                  commit({ lastDayOfMonth: event.target.checked })
                }
              />
              <span>Last day</span>
            </label>
          </>
        ) : null}
        {parsed.frequency === "yearly" ? (
          <label className="field-label recurrence-field recurrence-field-short">
            Month
            <select
              value={parsed.month}
              onChange={(event) => commit({ month: event.target.value })}
            >
              {Array.from({ length: 12 }, (_, index) => (index + 1).toString()).map(
                (month) => (
                  <option key={month} value={month}>
                    {month}
                  </option>
                ),
              )}
            </select>
          </label>
        ) : null}
        <div className="recurrence-preview">
          <span>Preview</span>
          <output aria-label="Recurrence Rule Preview">{preview}</output>
        </div>
      </div>
    </div>
  );
}

function validRecurrenceInterval(value: string): boolean {
  const interval = Number(value);
  return Number.isInteger(interval) && interval >= 1 && interval <= 365;
}

function clampRecurrenceNumber(value: string, min: number, max: number): string {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return min.toString();
  }
  return Math.min(max, Math.max(min, number)).toString();
}

function defaultRecurrenceRule(): ParsedRecurrenceRule {
  return {
    interval: "1",
    frequency: "daily",
    weekdays: [],
    monthDay: "1",
    lastDayOfMonth: false,
    month: "1",
  };
}

function parseRecurrenceRule(value: string): ParsedRecurrenceRule {
  const rule = defaultRecurrenceRule();
  const normalized = value.trim().toUpperCase();
  if (!normalized.startsWith("RRULE:")) {
    return parseLegacyRecurrenceRule(value, rule);
  }

  for (const part of normalized.slice("RRULE:".length).split(";")) {
    const [key, fieldValue = ""] = part.split("=");
    if (key === "FREQ") {
      const frequency = fieldValue.toLowerCase();
      if (
        frequency === "daily" ||
        frequency === "weekly" ||
        frequency === "monthly" ||
        frequency === "yearly"
      ) {
        rule.frequency = frequency;
      }
    }
    if (key === "INTERVAL") {
      rule.interval = clampRecurrenceNumber(fieldValue, 1, 365);
    }
    if (key === "BYDAY") {
      rule.weekdays = fieldValue
        .split(",")
        .filter((day) => weekdayOptions.some(([value]) => value === day));
    }
    if (key === "BYMONTHDAY") {
      rule.lastDayOfMonth = fieldValue === "-1";
      rule.monthDay = rule.lastDayOfMonth
        ? "1"
        : clampRecurrenceNumber(fieldValue, 1, 31);
    }
    if (key === "BYMONTH") {
      rule.month = clampRecurrenceNumber(fieldValue, 1, 12);
    }
  }

  return rule;
}

function parseLegacyRecurrenceRule(
  value: string,
  rule: ParsedRecurrenceRule,
): ParsedRecurrenceRule {
  const normalized = value.trim().toLowerCase();
  if (normalized === "") {
    return rule;
  }

  const directWeekdays = legacyWeekdays(normalized);
  if (directWeekdays) {
    rule.frequency = "weekly";
    rule.weekdays = directWeekdays;
    return rule;
  }

  const directMonthDay = legacyMonthDay(normalized);
  if (directMonthDay) {
    rule.frequency = "monthly";
    rule.monthDay = directMonthDay.monthDay;
    rule.lastDayOfMonth = directMonthDay.lastDayOfMonth;
    return rule;
  }

  const aliasFrequency = {
    daily: "daily",
    "every day": "daily",
    "매일": "daily",
    weekly: "weekly",
    "every week": "weekly",
    "매주": "weekly",
    monthly: "monthly",
    "every month": "monthly",
    "매월": "monthly",
    yearly: "yearly",
    "every year": "yearly",
    "매년": "yearly",
  }[normalized] as RecurrenceFrequency | undefined;
  if (aliasFrequency) {
    rule.frequency = aliasFrequency;
    return rule;
  }

  const every = normalized.match(
    /^every (?:(\d+) )?(days?|weeks?|months?|years?)(?: on (.+))?$/,
  );
  if (!every) {
    return rule;
  }

  rule.interval = every[1] ? clampRecurrenceNumber(every[1], 1, 365) : "1";
  const unit = every[2];
  const anchor = every[3]?.trim();
  if (unit.startsWith("day")) {
    rule.frequency = "daily";
  }
  if (unit.startsWith("week")) {
    rule.frequency = "weekly";
    rule.weekdays = anchor ? legacyWeekdays(anchor) ?? [] : [];
  }
  if (unit.startsWith("month")) {
    rule.frequency = "monthly";
    const monthDay = anchor ? legacyMonthDay(anchor) : null;
    if (monthDay) {
      rule.monthDay = monthDay.monthDay;
      rule.lastDayOfMonth = monthDay.lastDayOfMonth;
    }
  }
  if (unit.startsWith("year")) {
    rule.frequency = "yearly";
  }

  return rule;
}

function legacyWeekdays(value: string): string[] | null {
  if (value === "weekday" || value === "weekdays" || value === "평일") {
    return ["MO", "TU", "WE", "TH", "FR"];
  }
  if (value === "weekend" || value === "weekends" || value === "주말") {
    return ["SA", "SU"];
  }

  const aliases: Record<string, string> = {
    mon: "MO",
    monday: "MO",
    "월": "MO",
    tue: "TU",
    tuesday: "TU",
    "화": "TU",
    wed: "WE",
    wednesday: "WE",
    "수": "WE",
    thu: "TH",
    thursday: "TH",
    "목": "TH",
    fri: "FR",
    friday: "FR",
    "금": "FR",
    sat: "SA",
    saturday: "SA",
    "토": "SA",
    sun: "SU",
    sunday: "SU",
    "일": "SU",
  };
  const rangeParts = value.split(/[-~]/);
  if (rangeParts.length === 2) {
    const start = aliases[rangeParts[0].trim()];
    const end = aliases[rangeParts[1].trim()];
    const orderedDays: string[] = weekdayOptions.map(([day]) => day);
    const startIndex = orderedDays.indexOf(start);
    const endIndex = orderedDays.indexOf(end);
    if (startIndex >= 0 && endIndex >= 0) {
      return startIndex <= endIndex
        ? orderedDays.slice(startIndex, endIndex + 1)
        : [...orderedDays.slice(startIndex), ...orderedDays.slice(0, endIndex + 1)];
    }
  }
  if ([...value].every((char) => aliases[char])) {
    return [...new Set([...value].map((char) => aliases[char]))];
  }

  const parts = value
    .replace(/\band\b/g, " ")
    .split(/[,\s/]+/)
    .filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  const days = parts.map((part) => aliases[part]);
  if (days.some((day) => !day)) {
    return null;
  }

  return weekdayOptions
    .map(([day]) => day)
    .filter((day) => days.includes(day));
}

function legacyMonthDay(
  value: string,
): { monthDay: string; lastDayOfMonth: boolean } | null {
  if (value === "the last" || value === "last") {
    return { monthDay: "1", lastDayOfMonth: true };
  }

  const match = value.match(/^the (\d+)(?:st|nd|rd|th)?$/);
  if (!match) {
    return null;
  }

  return {
    monthDay: clampRecurrenceNumber(match[1], 1, 31),
    lastDayOfMonth: false,
  };
}

function formatRecurrenceRule(rule: ParsedRecurrenceRule): string {
  const interval = Number(rule.interval);
  const safeInterval = Number.isInteger(interval) && interval > 0 ? interval : 1;
  const parts = [`RRULE:FREQ=${rule.frequency.toUpperCase()}`];

  if (safeInterval !== 1) {
    parts.push(`INTERVAL=${safeInterval}`);
  }
  if (rule.frequency === "weekly" && rule.weekdays.length > 0) {
    parts.push(`BYDAY=${rule.weekdays.join(",")}`);
  }
  if (rule.frequency === "monthly") {
    parts.push(`BYMONTHDAY=${rule.lastDayOfMonth ? "-1" : rule.monthDay || "1"}`);
  }
  if (rule.frequency === "yearly") {
    parts.push(`BYMONTH=${rule.month || "1"}`);
    parts.push(`BYMONTHDAY=${rule.lastDayOfMonth ? "-1" : rule.monthDay || "1"}`);
  }

  return parts.join(";");
}

function DetailRelationField({
  label,
  controlLabel,
  value,
  options,
  allowNone = false,
  onChange,
}: {
  label: string;
  controlLabel: string;
  value: string;
  options: Record<string, string>;
  allowNone?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <DetailInlineField label={label}>
      <select
        className="inline-cell-control"
        aria-label={controlLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="" disabled={!allowNone}>
          {allowNone ? "None" : "-"}
        </option>
        {Object.entries(options).map(([id, title]) => (
          <option key={id} value={id}>
            {title}
          </option>
        ))}
      </select>
    </DetailInlineField>
  );
}

function WorkspaceItemsTable({ controller }: MainPanelProps) {
  const { panel, workspaceItems } = controller;
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const archiveButtonRef = useRef<HTMLButtonElement | null>(null);
  const selectAllCheckboxRef = useRef<HTMLInputElement | null>(null);

  const visibleSelectionCount = workspaceItems.items.reduce(
    (count, item) => count + Number(controller.selectedItemIds.includes(item.id)),
    0,
  );
  const allVisibleSelected =
    workspaceItems.items.length > 0 &&
    visibleSelectionCount === workspaceItems.items.length;
  const partiallySelected =
    visibleSelectionCount > 0 && visibleSelectionCount < workspaceItems.items.length;

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = partiallySelected;
    }
  }, [partiallySelected]);

  useEffect(() => {
    if (controller.archiveConfirmationOpen) {
      cancelButtonRef.current?.focus();
    }
  }, [controller.archiveConfirmationOpen]);

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      controller.cancelArchiveSelected();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const activeElement = document.activeElement;
    const isCancelFocused = activeElement === cancelButtonRef.current;
    const isArchiveFocused = activeElement === archiveButtonRef.current;

    if (event.shiftKey && isCancelFocused) {
      event.preventDefault();
      archiveButtonRef.current?.focus();
    } else if (!event.shiftKey && isArchiveFocused) {
      event.preventDefault();
      cancelButtonRef.current?.focus();
    }
  }

  if (workspaceItems.status === "idle") {
    return null;
  }

  if (workspaceItems.status === "loading") {
    return (
      <section className="items-section" aria-label={`${panel.title} items`}>
        <p className="items-message" role="status">
          Loading {panel.title.toLowerCase()}...
        </p>
      </section>
    );
  }

  if (workspaceItems.status === "error") {
    return (
      <section className="items-section" aria-label={`${panel.title} items`}>
        <p className="items-message" role="alert">
          Could not load todo-engine items.
        </p>
      </section>
    );
  }

  return (
    <section className="items-section">
      <div className="items-toolbar">
        <button
          className="items-toolbar-button"
          type="button"
          aria-label="Add item"
          onClick={controller.openCreationDialog}
        >
          <Plus size={16} aria-hidden="true" />
        </button>
        <button
          className="items-toolbar-button"
          type="button"
          aria-label="Archive selected items"
          disabled={controller.selectedItemIds.length === 0}
          onClick={controller.requestArchiveSelected}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
      {workspaceItems.items.length === 0 ? (
        <p className="items-message">No {panel.title.toLowerCase()} found.</p>
      ) : (
        <table className="items-table" aria-label={`${panel.title} items`}>
          <thead>
            <tr>
              <th scope="col" className="selection-column">
                <input
                  ref={selectAllCheckboxRef}
                  type="checkbox"
                  aria-label="Select all visible items"
                  checked={allVisibleSelected}
                  onChange={controller.toggleVisibleSelection}
                />
              </th>
              {columnsForPanel(panel.id).map((column) => (
                <th scope="col" key={column.label}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {workspaceItems.items.map((item) => (
              <tr
                key={item.id}
                role="button"
                tabIndex={0}
                aria-label={`Open details for ${item.title}`}
                onClick={() => controller.openDetailView(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " " || event.key === "Space") {
                    event.preventDefault();
                    controller.openDetailView(item);
                  }
                }}
              >
                <td className="selection-column">
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.title}`}
                    checked={controller.selectedItemIds.includes(item.id)}
                    onKeyDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => controller.toggleItemSelection(item.id)}
                  />
                </td>
                {columnsForPanel(panel.id).map((column) => (
                  <td key={column.label}>{column.value(item, workspaceItems, controller)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {controller.archiveConfirmationOpen ? (
        <div className="confirmation-backdrop">
          <section
            className="confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Archive selected items?"
            onKeyDown={handleDialogKeyDown}
          >
            <h2>Archive selected items?</h2>
            <p>
              {controller.selectedItemIds.length} items will be moved to archive.
              You can still find them in Archive.
            </p>
            <div className="dialog-actions">
              <button
                ref={cancelButtonRef}
                type="button"
                onClick={controller.cancelArchiveSelected}
              >
                Cancel
              </button>
              <button
                ref={archiveButtonRef}
                type="button"
                onClick={controller.confirmArchiveSelected}
              >
                Archive
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {controller.creationDialogOpen ? (
        <CreationDialog
          controller={controller}
        />
      ) : null}
    </section>
  );
}

type CreationDialogProps = {
  controller: WorkbenchController;
};

function CreationDialog({ controller }: CreationDialogProps) {
  const plannerScheduled = defaultCreationScheduled(controller);
  const plannerHorizon = defaultCreationHorizon(controller);
  const plannerItemType = defaultCreationItemType(controller);
  const plannerTypeOptions = plannerCreationTypeOptions(controller);
  const [title, setTitle] = React.useState("");
  const [itemType, setItemType] = React.useState(plannerItemType);
  const [scheduled, setScheduled] = React.useState(plannerScheduled);
  const [horizon, setHorizon] = React.useState(plannerHorizon);
  const formRef = useRef<HTMLFormElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const isGoal = controller.panel.id === "goals";
  const isPlannerGoal =
    itemType === "goal" &&
    (controller.panel.id === "weekly" ||
      controller.panel.id === "monthly" ||
      controller.panel.id === "yearly");
  const needsScheduled =
    controller.panel.id === "events" ||
    isGoal ||
    isPlannerGoal ||
    ((controller.panel.id === "weekly" || controller.panel.id === "daily") &&
      (itemType === "task" || itemType === "event"));
  const needsHorizon = isGoal;

  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  useEffect(() => {
    setItemType(plannerItemType);
    setScheduled(plannerScheduled);
    setHorizon(plannerHorizon);
  }, [plannerHorizon, plannerItemType, plannerScheduled]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      controller.closeCreationDialog();
      return;
    }

    if (event.key !== "Tab" || !formRef.current) {
      return;
    }

    const focusables = Array.from(
      formRef.current.querySelectorAll<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const activeIndex = focusables.indexOf(document.activeElement as HTMLElement);

    if (!event.shiftKey && activeIndex === focusables.length - 1) {
      event.preventDefault();
      focusables[0]?.focus();
    } else if (event.shiftKey && activeIndex === 0) {
      event.preventDefault();
      focusables[focusables.length - 1]?.focus();
    }
  }

  return (
    <div className="confirmation-backdrop">
      <form
        ref={formRef}
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Create ${controller.panel.title} item`}
        onKeyDown={handleKeyDown}
        onSubmit={(event) => {
          event.preventDefault();
          void controller.createWorkspaceItem({
            title,
            itemType,
            scheduled,
            horizon,
          });
        }}
      >
        <h2>Create {controller.panel.title} item</h2>
        {plannerTypeOptions.length > 1 ? (
          <label className="field-label">
            Type
            <select
              value={itemType}
              onChange={(event) =>
                setItemType(event.target.value as typeof itemType)
              }
            >
              {plannerTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="field-label">
          Title
          <input
            ref={titleInputRef}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </label>
        {needsScheduled ? (
          <label className="field-label">
            Scheduled
            <input
              type="date"
              value={scheduled}
              onChange={(event) => setScheduled(event.target.value)}
              required={needsScheduled}
            />
          </label>
        ) : null}
        {needsHorizon ? (
          <label className="field-label">
            Horizon
            <select
              value={horizon}
              onChange={(event) => setHorizon(event.target.value)}
            >
              <option value="week">week</option>
              <option value="month">month</option>
              <option value="year">year</option>
            </select>
          </label>
        ) : null}
        <div className="dialog-actions">
          <button type="button" onClick={controller.closeCreationDialog}>
            Cancel
          </button>
          <button type="submit">Create</button>
        </div>
      </form>
    </div>
  );
}

function defaultCreationScheduled(controller: WorkbenchController): string {
  if (controller.panel.id === "weekly") {
    return controller.planner.weekStart;
  }
  if (
    controller.panel.id === "daily" ||
    controller.panel.id === "monthly" ||
    controller.panel.id === "yearly"
  ) {
    return controller.planner.date;
  }

  return "";
}

function defaultCreationHorizon(controller: WorkbenchController): string {
  if (controller.panel.id === "weekly") {
    return "week";
  }
  if (controller.panel.id === "monthly") {
    return "month";
  }
  if (controller.panel.id === "yearly") {
    return "year";
  }

  return "month";
}

type PlannerCreationItemType = "task" | "goal" | "routine" | "event";

function defaultCreationItemType(
  controller: WorkbenchController,
): PlannerCreationItemType | undefined {
  if (controller.panel.id === "weekly") {
    return "goal";
  }
  if (controller.panel.id === "daily") {
    return "task";
  }
  if (controller.panel.id === "yearly" || controller.panel.id === "monthly") {
    return "goal";
  }
  return undefined;
}

function plannerCreationTypeOptions(
  controller: WorkbenchController,
): Array<{ value: PlannerCreationItemType; label: string }> {
  if (controller.panel.id === "weekly") {
    return [
      { value: "goal", label: "Goal" },
      { value: "task", label: "Task" },
      { value: "routine", label: "Routine" },
      { value: "event", label: "Event" },
    ];
  }
  if (controller.panel.id === "daily") {
    return [
      { value: "task", label: "Task" },
      { value: "routine", label: "Routine" },
      { value: "event", label: "Event" },
    ];
  }
  return [];
}

function stopRowEvent(event: React.SyntheticEvent<HTMLElement>) {
  event.stopPropagation();
}

function InlineTextInput({
  label,
  type = "text",
  value,
  onCommit,
}: {
  label: string;
  type?: "text" | "date" | "datetime-local";
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = React.useState(value);

  React.useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <input
      className="inline-cell-control"
      type={type}
      aria-label={label}
      value={draft}
      onClick={stopRowEvent}
      onKeyDown={stopRowEvent}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) {
          onCommit(draft);
        }
      }}
    />
  );
}

function InlinePrioritySelect({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number | null | undefined;
  onCommit: (value: number) => void;
}) {
  const selectedValue = value?.toString() ?? "";

  return (
    <select
      className="inline-cell-control"
      aria-label={label}
      value={selectedValue}
      onClick={stopRowEvent}
      onKeyDown={stopRowEvent}
      onChange={(event) => {
        stopRowEvent(event);
        const priority = Number(event.target.value);
        if (validPriority(priority) && event.target.value !== selectedValue) {
          onCommit(priority);
        }
      }}
    >
      <option value="">-</option>
      {priorityOptions.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function InlineRelationSelect({
  label,
  value,
  options,
  allowNone = false,
  onCommit,
}: {
  label: string;
  value: string | null | undefined;
  options: Record<string, string>;
  allowNone?: boolean;
  onCommit: (value: string) => void;
}) {
  const selectedValue = value ?? "";

  return (
    <select
      className="inline-cell-control"
      aria-label={label}
      value={selectedValue}
      onClick={stopRowEvent}
      onKeyDown={stopRowEvent}
      onChange={(event) => {
        const nextValue = event.target.value;

        if (nextValue === selectedValue || (!allowNone && !nextValue)) {
          return;
        }

        onCommit(nextValue);
      }}
    >
      <option value="" disabled={!allowNone}>
        {allowNone ? "None" : "-"}
      </option>
      {Object.entries(options).map(([id, title]) => (
        <option key={id} value={id}>
          {title}
        </option>
      ))}
    </select>
  );
}

function InlineSelect({
  label,
  value,
  options,
  formatOption = (option) => option,
  onCommit,
}: {
  label: string;
  value: string | null | undefined;
  options: string[];
  formatOption?: (option: string) => string;
  onCommit: (value: string) => void;
}) {
  const selectedValue = value ?? "";

  return (
    <select
      className="inline-cell-control"
      aria-label={label}
      value={selectedValue}
      onClick={stopRowEvent}
      onKeyDown={stopRowEvent}
      onChange={(event) => {
        const nextValue = event.target.value;

        if (nextValue === selectedValue) {
          return;
        }

        onCommit(nextValue);
      }}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {formatOption(option)}
        </option>
      ))}
    </select>
  );
}

function TagsInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string[] | null | undefined;
  onCommit: (value: string[]) => void;
}) {
  const currentTags = React.useMemo(() => parseTagInput(formatTags(value)), [value]);
  const [draft, setDraft] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    setDraft("");
  }, [currentTags]);

  function commitTags(tags: string[]) {
    const normalizedTags = parseTagInput(formatTags(tags));
    if (!sameTags(normalizedTags, value)) {
      onCommit(normalizedTags);
    }
  }

  function commitDraft() {
    const draftTags = parseTagInput(draft);
    setDraft("");
    if (draftTags.length > 0) {
      commitTags([...currentTags, ...draftTags]);
    }
  }

  return (
    <div
      className="tag-input"
      onClick={(event) => {
        stopRowEvent(event);
        inputRef.current?.focus();
      }}
    >
      {currentTags.map((tag) => (
        <span className="tag-chip" key={tag}>
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag} tag`}
            onClick={(event) => {
              stopRowEvent(event);
              commitTags(currentTags.filter((currentTag) => currentTag !== tag));
            }}
          >
            <X aria-hidden="true" size={14} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        aria-label={label}
        data-empty={draft === ""}
        value={draft}
        onKeyDown={(event) => {
          stopRowEvent(event);
          if (event.key === "Enter") {
            event.preventDefault();
            commitDraft();
          }
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitDraft}
      />
    </div>
  );
}

function StatusSelect({
  item,
  controller,
}: {
  item: WorkspaceItemModel;
  controller: WorkbenchController;
}) {
  const visibleStatuses = statusOptionsForItem(item);

  return (
    <select
      className="inline-cell-control"
      aria-label={`Status for ${item.title}`}
      value={displayStatusForItem(item)}
      onClick={stopRowEvent}
      onKeyDown={stopRowEvent}
      onChange={(event) => {
        const status = event.target.value;
        const action = transitionActionForStatus(item.status, status);

        if (!action) {
          return;
        }

        void controller.transitionWorkspaceItem(item.id, action);
      }}
    >
      {visibleStatuses.map((status) => (
        <option key={status} value={status}>
          {status}
        </option>
      ))}
    </select>
  );
}

function DetailStatusField({
  item,
  value,
  onChange,
}: {
  item: WorkspaceItemModel;
  value: string;
  onChange: (value: string) => void;
}) {
  const visibleStatuses = statusOptionsForItem(item);

  return (
    <DetailInlineField label="Status">
      <select
        className="inline-cell-control"
        aria-label={`Status for ${item.title}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {visibleStatuses.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
    </DetailInlineField>
  );
}

function statusOptionsForItem(item: WorkspaceItemModel): string[] {
  if (item.type === "task" || item.type === "event") {
    return visibleStatusOptionsForItem(item);
  }

  const baseOptions = visibleStatusOptionsForItem(item);
  const enabledStatuses = enabledStatusOptionsForItem(item);
  return uniqueStatuses([item.status, ...enabledStatuses]).filter((status) =>
    baseOptions.includes(status) || status === item.status,
  );
}

function detailStatusForItem(item: WorkspaceItemModel | null): string {
  return item ? displayStatusForItem(item) : "";
}

function displayStatusForItem(item: WorkspaceItemModel): string {
  if (
    (item.type === "task" && item.status !== "completed") ||
    (item.type === "event" && !eventStatusOptions.includes(item.status))
  ) {
    return "active";
  }

  return item.status;
}

function uniqueStatuses(statuses: string[]): string[] {
  return [...new Set(statuses)];
}

function visibleStatusOptionsForItem(item: WorkspaceItemModel): string[] {
  if (item.type === "area") {
    return areaStatusOptions;
  }
  if (item.type === "task") {
    return taskStatusOptions;
  }
  if (item.type === "event") {
    return eventStatusOptions;
  }
  return statusOptions;
}

function enabledStatusOptionsForItem(item: WorkspaceItemModel): string[] {
  const options = [item.status];
  const canRun = item.type !== "area";
  const canActivate =
    canRun &&
    (item.type !== "project" || hasText(item.definition_of_done)) &&
    (item.type !== "routine" || hasText(item.recurrence_rule));

  if (item.status === "proposed") {
    options.push("approved");
  }
  if (item.status === "approved" && canActivate) {
    options.push("active");
  }
  if (item.status === "paused" && canActivate) {
    options.push("active");
  }
  if (item.status === "active" && canRun) {
    options.push("paused", "completed");
  }
  if (item.status === "active" && item.type === "area") {
    options.push("archived");
  }

  return options;
}

function transitionActionForStatus(
  currentStatus: string,
  nextStatus: string,
): WorkspaceItemTransitionAction | null {
  if (nextStatus === currentStatus) {
    return null;
  }
  if (nextStatus === "approved") {
    return "approve";
  }
  if (nextStatus === "active") {
    return currentStatus === "paused" ? "resume" : "activate";
  }
  if (nextStatus === "paused") {
    return "pause";
  }
  if (nextStatus === "completed") {
    return "complete";
  }
  if (nextStatus === "archived") {
    return "archive";
  }

  return null;
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

const sharedColumns: ItemColumn[] = [
  { label: "Title", value: (item) => item.title },
  {
    label: "Status",
    value: (item, _items, controller) => (
      <StatusSelect item={item} controller={controller} />
    ),
  },
];

function areaColumn(): ItemColumn {
  return {
    label: "Area",
    value: (item, items, controller) => (
      <InlineRelationSelect
        label={`Area for ${item.title}`}
        value={item.area_id}
        options={items.relatedItems.areas}
        onCommit={(area) => void controller.patchWorkspaceItem(item.id, { area })}
      />
    ),
  };
}

function projectColumn(): ItemColumn {
  return {
    label: "Project",
    value: (item, items, controller) => (
      <InlineRelationSelect
        label={`Project for ${item.title}`}
        value={item.project_id}
        options={items.relatedItems.projects}
        allowNone
        onCommit={(project_id) =>
          void controller.patchWorkspaceItem(item.id, { project_id })
        }
      />
    ),
  };
}

function routineColumn(): ItemColumn {
  return {
    label: "Routine",
    value: (item, items) => relatedTitle(items.relatedItems.routines, item.routine_id),
  };
}

function dueColumn(): ItemColumn {
  return {
    label: "Due",
    value: (item, _items, controller) => (
      <InlineTextInput
        label={`Due for ${item.title}`}
        type="date"
        value={item.due ?? ""}
        onCommit={(due) => void controller.patchWorkspaceItem(item.id, { due })}
      />
    ),
  };
}

function scheduledDateColumn(): ItemColumn {
  return {
    label: "Scheduled",
    value: (item, _items, controller) => (
      <InlineTextInput
        label={`Scheduled for ${item.title}`}
        type="date"
        value={formatDateValue(item.scheduled)}
        onCommit={(scheduled) =>
          void controller.patchWorkspaceItem(item.id, { scheduled })
        }
      />
    ),
  };
}

function startsAtColumn(): ItemColumn {
  return {
    label: "Starts At",
    value: (item, _items, controller) => (
      <InlineTextInput
        label={`Starts At for ${item.title}`}
        type="datetime-local"
        value={formatDateTimeLocalValue(item.scheduled)}
        onCommit={(scheduled) =>
          void controller.patchWorkspaceItem(item.id, {
            scheduled: formatDateTimeCommitValue(scheduled),
          })
        }
      />
    ),
  };
}

function priorityColumn(): ItemColumn {
  return {
    label: "Priority",
    value: (item, _items, controller) => (
      <InlinePrioritySelect
        label={`Priority for ${item.title}`}
        value={item.priority}
        onCommit={(priority) =>
          void controller.patchWorkspaceItem(item.id, { priority })
        }
      />
    ),
  };
}

function horizonColumn(): ItemColumn {
  return {
    label: "Horizon",
    value: (item, _items, controller) => (
      <InlineSelect
        label={`Horizon for ${item.title}`}
        value={item.horizon}
        options={["week", "month", "year"]}
        onCommit={(horizon) => void controller.patchWorkspaceItem(item.id, { horizon })}
      />
    ),
  };
}

function parentGoalColumn(): ItemColumn {
  return {
    label: "Parent",
    value: (item, items, controller) => (
      <InlineRelationSelect
        label={`Parent for ${item.title}`}
        value={item.parent_id}
        options={items.relatedItems.goals}
        allowNone
        onCommit={(parent_id) =>
          void controller.patchWorkspaceItem(item.id, { parent_id })
        }
      />
    ),
  };
}

function locationColumn(): ItemColumn {
  return {
    label: "Location",
    value: (item, _items, controller) => (
      <InlineTextInput
        label={`Location for ${item.title}`}
        value={item.metadata_?.location ?? ""}
        onCommit={(location) =>
          void controller.patchWorkspaceItem(item.id, { location })
        }
      />
    ),
  };
}

function commitmentTypeColumn(): ItemColumn {
  return {
    label: "Commitment Type",
    value: (item, _items, controller) => (
      <InlineTextInput
        label={`Commitment Type for ${item.title}`}
        value={item.metadata_?.commitment_type ?? ""}
        onCommit={(commitment_type) =>
          void controller.patchWorkspaceItem(item.id, { commitment_type })
        }
      />
    ),
  };
}

function tagsColumn(): ItemColumn {
  return {
    label: "Tags",
    value: (item, _workspaceItems, controller) => (
      <TagsInput
        label={`Tags for ${item.title}`}
        value={item.tags}
        onCommit={(tags) => void controller.patchWorkspaceItem(item.id, { tags })}
      />
    ),
  };
}

const itemColumns: Partial<Record<LeafTabId, ItemColumn[]>> = {
  areas: [
    ...sharedColumns,
    tagsColumn(),
    {
      label: "Review Cycle",
      value: (item, _items, controller) => (
        <InlineSelect
          label={`Review Cycle for ${item.title}`}
          value={item.review_cycle ?? ""}
          options={reviewCycleOptions}
          onCommit={(review_cycle) =>
            void controller.patchWorkspaceItem(item.id, { review_cycle })
          }
        />
      ),
    },
    { label: "Standard", value: (item) => displayValue(item.standard) },
    { label: "Note", value: (item) => displayValue(item.note) },
    { label: "Created", value: (item) => formatDate(item.created_at) },
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ],
  projects: [
    ...sharedColumns,
    tagsColumn(),
    areaColumn(),
    dueColumn(),
    { label: "Outcome", value: (item) => displayValue(item.outcome) },
    { label: "Definition of Done", value: (item) => displayValue(item.definition_of_done) },
    { label: "Note", value: (item) => displayValue(item.note) },
    { label: "Created", value: (item) => formatDate(item.created_at) },
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ],
  tasks: [
    ...sharedColumns,
    tagsColumn(),
    areaColumn(),
    projectColumn(),
    routineColumn(),
    scheduledDateColumn(),
    dueColumn(),
    priorityColumn(),
    { label: "Description", value: (item) => displayValue(itemDescription(item)) },
    { label: "Note", value: (item) => displayValue(item.note) },
    { label: "Created", value: (item) => formatDate(item.created_at) },
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ],
  routines: [
    ...sharedColumns,
    tagsColumn(),
    areaColumn(),
    { label: "Recurrence Rule", value: (item) => displayValue(item.recurrence_rule) },
    {
      label: "Materialization Policy",
      value: (item, _items, controller) => (
        <InlineSelect
          label={`Materialization Policy for ${item.title}`}
          value={item.materialization_policy}
          options={materializationPolicyOptions}
          formatOption={displayMaterializationPolicy}
          onCommit={(materialization_policy) =>
            void controller.patchWorkspaceItem(item.id, { materialization_policy })
          }
        />
      ),
    },
    { label: "Note", value: (item) => displayValue(item.note) },
    {
      label: "Last Materialized",
      value: (item) => formatDate(item.last_materialized_at),
    },
    { label: "Created", value: (item) => formatDate(item.created_at) },
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ],
  events: [
    ...sharedColumns,
    tagsColumn(),
    areaColumn(),
    projectColumn(),
    startsAtColumn(),
    dueColumn(),
    priorityColumn(),
    locationColumn(),
    {
      label: "Participants",
      value: (item) => displayValue(item.metadata_?.participants?.join(", ")),
    },
    commitmentTypeColumn(),
    { label: "Description", value: (item) => displayValue(itemDescription(item)) },
    { label: "Note", value: (item) => displayValue(item.note) },
    { label: "Created", value: (item) => formatDate(item.created_at) },
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ],
  goals: [
    ...sharedColumns,
    tagsColumn(),
    horizonColumn(),
    scheduledDateColumn(),
    dueColumn(),
    parentGoalColumn(),
    { label: "Note", value: (item) => displayValue(item.note) },
    { label: "Created", value: (item) => formatDate(item.created_at) },
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ],
};

function columnsForPanel(panelId: LeafTabId): ItemColumn[] {
  return itemColumns[panelId] ?? [
    ...sharedColumns,
    { label: "Updated", value: (item) => formatDate(item.updated_at) },
  ];
}

function relatedTitle(
  titlesById: Record<string, string>,
  id: string | null | undefined,
): string {
  return id ? (titlesById[id] ?? id) : "-";
}

function displayValue(value: string | number | null | undefined): string {
  return value?.toString() || "-";
}

function displayMaterializationPolicy(value: string): string {
  return value
    .split("_")
    .map((part, index) =>
      index === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part,
    )
    .join(" ");
}

function formatDateValue(value: string | null | undefined): string {
  return value?.slice(0, 10) || "";
}

function formatDateTimeLocalValue(value: string | null | undefined): string {
  const match = value?.trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);

  return match ? `${match[1]}T${match[2]}` : "";
}

function formatDateTimeCommitValue(value: string): string {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?/);

  return match ? `${match[1]}T${match[2]}:${match[3] ?? "00"}Z` : value;
}

function formatDate(value: string | null | undefined): string {
  return value?.slice(0, 10) || "-";
}
