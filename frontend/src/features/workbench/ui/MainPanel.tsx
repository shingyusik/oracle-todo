import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownUp,
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Filter,
  GripVertical,
  Group,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";

import type { LeafTabId } from "@/domain/workbench/navigation";
import { TodoEngineApiError } from "@/features/workbench/hooks/useWorkbenchController";
import {
  buildPlannerGroupCandidates,
  type PlannerGroupCandidate,
  type PlannerGroupSettings,
} from "@/features/workbench/model/planner-group-settings";
import {
  buildDailyPlannerModel,
  buildMonthlyPeriodGoalCardsModel,
  buildWeeklyPlannerModel,
  buildYearlyPeriodGoalCardsModel,
  type DailyPlannerSection,
  filterPlannerItemsByRules,
  groupPlannerItems,
  type MonthlyPlannerWeekModel,
  type PeriodGoalBucketModel,
  type PeriodGoalCardModel,
  type PlannerFilterField,
  type PlannerFilterOperator,
  type PlannerFilterRule,
  type PlannerFilterType,
  type PlannerFilterValue,
  sortPlannerItems,
  type PlannerGroupBy,
  type PlannerSortBy,
  type PlannerSortRule,
} from "@/features/workbench/model/planner-model";
import type {
  WorkbenchController,
  WorkspaceItemModel,
  WorkspaceItemsModel,
  WorkspaceItemPatch,
  WorkspaceItemTransitionAction,
} from "@/features/workbench/model/workbench-model";
import { PlannerGroupPanel } from "@/features/workbench/ui/PlannerGroupPanel";

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
const workItemStatusOptions = ["active", "paused", "completed"];
const areaStatusOptions = ["active", "archived"];
const taskStatusOptions = ["active", "completed"];
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

    const transition = transitionActionForStatus(displayStatusForItem(detailItem), draft.status);
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
              tagOptions={controller.workspaceItems.tagOptions}
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

  return (
    <section
      className="items-section planner-panel"
      aria-label={`${panel.title} planner`}
    >
      <PlannerControlToolbar
        controller={controller}
        filterOptions={filterOptions}
      />
      {panel.id === "weekly" ? <WeeklyPlanner controller={controller} /> : null}
      {panel.id === "daily" ? <DailyPlanner controller={controller} /> : null}
      {panel.id === "yearly" ? <YearlyPeriodPlanner controller={controller} /> : null}
      {panel.id === "monthly" ? <MonthlyPeriodPlanner controller={controller} /> : null}
      {controller.creationDialogOpen ? <CreationDialog controller={controller} /> : null}
    </section>
  );
}

function YearlyPeriodPlanner({ controller }: MainPanelProps) {
  const items = filteredPlannerItems(controller);
  const model = buildYearlyPeriodGoalCardsModel(items, controller.planner.date);

  return (
    <div className="planner-period-panel">
      <PeriodGoalCarousel
        controller={controller}
        ariaLabel="Year goal carousel"
        previousLabel="Previous year"
        nextLabel="Next year"
        cards={model.carousel}
      />
      <div className="yearly-month-grid" aria-label="Month goals">
        {model.months.map((month) => (
          <PeriodGoalBucketCard
            controller={controller}
            bucket={month}
            testId="yearly-month-card"
            key={month.key}
          />
        ))}
      </div>
    </div>
  );
}

function MonthlyPeriodPlanner({ controller }: MainPanelProps) {
  const items = filteredPlannerItems(controller);
  const model = buildMonthlyPeriodGoalCardsModel(items, controller.planner.date);
  const [openOverflowDate, setOpenOverflowDate] = React.useState<string | null>(null);

  useEffect(() => {
    setOpenOverflowDate(null);
  }, [controller.planner.date]);

  return (
    <div className="planner-period-panel">
      <PeriodGoalCarousel
        controller={controller}
        ariaLabel="Month goal carousel"
        previousLabel="Previous month"
        nextLabel="Next month"
        cards={model.carousel}
      />
      <div className="monthly-calendar-planner" role="grid" aria-label="Monthly todo calendar">
        {model.weeks.map((week) => (
          <MonthlyPlannerWeekRow
            controller={controller}
            week={week}
            openOverflowDate={openOverflowDate}
            onOpenOverflowChange={setOpenOverflowDate}
            key={week.key}
          />
        ))}
      </div>
    </div>
  );
}

function MonthlyPlannerWeekRow({
  controller,
  week,
  openOverflowDate,
  onOpenOverflowChange,
}: {
  controller: WorkbenchController;
  week: MonthlyPlannerWeekModel;
  openOverflowDate: string | null;
  onOpenOverflowChange: (date: string | null) => void;
}) {
  return (
    <section className="monthly-week-row" role="row" data-testid="monthly-week-row">
      <div className="monthly-week-days">
        {week.days.map((day) => {
          const dayItems = sortPlannerItems(day.items, plannerSortRules(controller));

          return (
            <section
              className="monthly-day-card"
              role="gridcell"
              aria-label={`${day.date} todo`}
              data-selected-month={day.isSelectedMonth}
              data-testid="monthly-day-card"
              key={day.date}
            >
              <h3>{day.label}</h3>
              <MonthlyDayItems
                controller={controller}
                date={day.date}
                items={dayItems}
                open={openOverflowDate === day.date}
                onOpenChange={onOpenOverflowChange}
              />
            </section>
          );
        })}
      </div>
      <aside className="monthly-week-goal-rail" data-testid="monthly-week-goal-rail">
        <PeriodGoalBucketCard
          controller={controller}
          bucket={week}
          testId="monthly-week-card"
        />
      </aside>
    </section>
  );
}

function MonthlyDayItems({
  controller,
  date,
  items,
  open,
  onOpenChange,
}: {
  controller: WorkbenchController;
  date: string;
  items: WorkspaceItemModel[];
  open: boolean;
  onOpenChange: (date: string | null) => void;
}) {
  const visibleItems = items.slice(0, 2);
  const hiddenCount = items.length - visibleItems.length;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverStyle, setPopoverStyle] = React.useState<React.CSSProperties | null>(null);

  React.useLayoutEffect(() => {
    if (!open) return;

    function updatePopoverPosition() {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) {
        return;
      }

      setPopoverStyle(goalPeriodPopoverStyle(trigger, popover));
    }

    updatePopoverPosition();
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [date, open]);

  useEffect(() => {
    if (!open) return;

    function closeAndRestoreFocus() {
      onOpenChange(null);
      requestAnimationFrame(() => triggerRef.current?.focus());
    }

    function dismissOnOutsidePointer(event: MouseEvent) {
      if (!(event.target instanceof Node)) {
        return;
      }
      if (
        triggerRef.current?.contains(event.target) ||
        popoverRef.current?.contains(event.target)
      ) {
        return;
      }
      closeAndRestoreFocus();
    }

    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      closeAndRestoreFocus();
    }

    document.addEventListener("mousedown", dismissOnOutsidePointer);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("mousedown", dismissOnOutsidePointer);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [onOpenChange, open]);

  if (items.length === 0) {
    return <p className="items-message monthly-day-empty">No items.</p>;
  }

  return (
    <ul className="monthly-day-item-list">
      {visibleItems.map((item) => (
        <li key={item.id}>
          <PlannerItemRow controller={controller} item={item} compact />
        </li>
      ))}
      {hiddenCount > 0 ? (
        <li>
          <button
            ref={triggerRef}
            className="monthly-day-more"
            type="button"
            aria-label={`Show ${hiddenCount} more items`}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => onOpenChange(open ? null : date)}
          >
            +{hiddenCount} more
          </button>
        </li>
      ) : null}
      {open
        ? createPortal(
            <div
              ref={popoverRef}
              className="monthly-day-popover"
              style={popoverStyle ?? undefined}
              role="dialog"
              aria-label={`${date} items`}
            >
              <h3>{date}</h3>
              <ul className="monthly-day-popover-list">
                {items.map((item) => (
                  <li key={item.id}>
                    <PlannerItemRow controller={controller} item={item} compact />
                  </li>
                ))}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </ul>
  );
}

function PeriodGoalCarousel({
  controller,
  ariaLabel,
  previousLabel,
  nextLabel,
  cards,
}: {
  controller: WorkbenchController;
  ariaLabel: string;
  previousLabel: string;
  nextLabel: string;
  cards: PeriodGoalCardModel[];
}) {
  return (
    <section className="period-carousel" aria-label={ariaLabel}>
      <button
        className="period-carousel-arrow"
        type="button"
        aria-label={previousLabel}
        onClick={() => controller.movePlannerPeriod(-1)}
      >
        <ChevronLeft size={18} aria-hidden="true" />
      </button>
      <div className="period-carousel-track">
        {cards.map((card) => (
          <article className="period-carousel-card" data-position={card.position} key={card.key}>
            <div className="period-card-kicker">{card.label}</div>
            <GoalGroupContent controller={controller} goals={card.goals} emptyText="No goals found." />
          </article>
        ))}
      </div>
      <button
        className="period-carousel-arrow"
        type="button"
        aria-label={nextLabel}
        onClick={() => controller.movePlannerPeriod(1)}
      >
        <ChevronRight size={18} aria-hidden="true" />
      </button>
    </section>
  );
}

function PeriodGoalBucketCard({
  controller,
  bucket,
  testId,
}: {
  controller: WorkbenchController;
  bucket: PeriodGoalBucketModel;
  testId: string;
}) {
  return (
    <section
      className="period-bucket-card"
      aria-label={`${bucket.label} goals`}
      data-testid={testId}
    >
      <h3>{bucket.label}</h3>
      <GoalGroupContent controller={controller} goals={bucket.goals} emptyText="No goals found." />
    </section>
  );
}

function GoalGroupContent({
  controller,
  goals,
  emptyText,
}: {
  controller: WorkbenchController;
  goals: WorkspaceItemModel[];
  emptyText: string;
}) {
  const sortedGoals = sortPlannerItems(goals, plannerSortRules(controller));
  const groupedGoals = groupPlannerItems(
    sortedGoals,
    controller.workspaceItems.relatedItems,
    plannerGroupSettings(controller),
    plannerGroupCandidates(controller, sortedGoals),
  );

  return <>{renderPlannerGroups(controller, groupedGoals, emptyText)}</>;
}

function WeeklyPlanner({ controller }: MainPanelProps) {
  const model = buildWeeklyPlannerModel(
    filteredPlannerItems(controller),
    controller.planner.weekStart,
  );
  const settings = plannerGroupSettings(controller);
  const sortedMonthGoals = sortPlannerItems(model.monthGoals, plannerSortRules(controller));
  const sortedWeekGoals = sortPlannerItems(model.weekGoals, plannerSortRules(controller));
  const monthGoalGroups = groupPlannerItems(
    sortedMonthGoals,
    controller.workspaceItems.relatedItems,
    settings,
    plannerGroupCandidates(controller, sortedMonthGoals),
  );
  const weekGoalGroups = groupPlannerItems(
    sortedWeekGoals,
    controller.workspaceItems.relatedItems,
    settings,
    plannerGroupCandidates(controller, sortedWeekGoals),
  );

  return (
    <div className="planner-panel">
      <div className="planner-goal-grid">
        <section className="planner-section" aria-label="Weekly month goals">
          <h2>Goals for this month</h2>
          {renderPlannerGroups(controller, monthGoalGroups, "No goals found.")}
        </section>
        <section className="planner-section" aria-label="Weekly goals">
          <h2>Goals for this week</h2>
          {renderPlannerGroups(controller, weekGoalGroups, "No goals found.")}
        </section>
      </div>
      <div className="weekly-day-grid">
        {model.days.map((day) => {
          const sortedDayItems = sortPlannerItems(day.items, plannerSortRules(controller));
          const dayGroups = groupPlannerItems(
            sortedDayItems,
            controller.workspaceItems.relatedItems,
            settings,
            plannerGroupCandidates(controller, sortedDayItems),
          );

          return (
            <section
              className="planner-card"
              key={day.date}
              data-testid="weekly-day-card"
            >
              <h3>{day.label}</h3>
              {renderPlannerGroups(controller, dayGroups, "No scheduled items.")}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function DailyPlanner({ controller }: MainPanelProps) {
  const model = buildDailyPlannerModel(
    filteredPlannerItems(controller),
    controller.workspaceItems.relatedItems,
    {
      date: controller.planner.date,
      filters: emptyDailyFilters(),
      groupSettings: plannerGroupSettings(controller),
      groupCandidates: plannerGroupCandidates(controller, filteredPlannerItems(controller)),
      sortRules: controller.planner.dailySortRules,
    },
  );

  return (
    <div className="planner-panel daily-planner">
      <div className="daily-planner-scheduled-grid" aria-label="Scheduled daily work">
        <DailyPlannerSectionView
          controller={controller}
          section={model.sections.today}
        />
        <DailyPlannerSectionView
          controller={controller}
          section={model.sections.overdue}
        />
      </div>
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
}: {
  controller: WorkbenchController;
  filterOptions: PlannerFilterOptions;
}) {
  const [openDropdown, setOpenDropdown] =
    React.useState<PlannerDropdownKind | null>(null);
  const visibleFilterRules = visiblePlannerFilterRules(controller, filterOptions);
  const activeFilterCount = effectivePlannerFilterRules(controller).length;
  const sortRules = plannerSortRules(controller);
  const groupBy = plannerGroupValue(controller);
  const nowDisabled = plannerPeriodMatchesToday(controller);
  const showPeriodNavigation = controller.panel.id === "weekly" || controller.panel.id === "daily";
  const groupTriggerRef = useRef<HTMLButtonElement>(null);
  const groupPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openDropdown !== "group") return;
    function dismiss(event: MouseEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof MouseEvent && event.target instanceof Node && (groupPanelRef.current?.contains(event.target) || groupTriggerRef.current?.contains(event.target))) return;
      setOpenDropdown(null);
      groupTriggerRef.current?.focus();
    }
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => { document.removeEventListener("mousedown", dismiss); document.removeEventListener("keydown", dismiss); };
  }, [openDropdown]);

  function toggleDropdown(kind: PlannerDropdownKind) {
    setOpenDropdown((current) => (current === kind ? null : kind));
  }

  return (
    <div className="planner-view-controls">
      <div className="planner-view-control-bar">
        <div className="planner-view-leading">
          <div className="planner-view-pill">{controller.panel.title}</div>
          {showPeriodNavigation ? <PlannerPeriodNavigation controller={controller} /> : null}
        </div>
        <div className="planner-view-actions">
          <PlannerDropdownButton
            active={openDropdown === "filter" || activeFilterCount > 0}
            ariaLabel="Filter planner view"
            title="Filter"
            onClick={() => toggleDropdown("filter")}
          >
            <Filter size={16} aria-hidden="true" />
          </PlannerDropdownButton>
          <PlannerDropdownButton
            active={openDropdown === "sort" || !isDefaultPlannerSort(controller)}
            ariaLabel="Sort planner view"
            title="Sort"
            onClick={() => toggleDropdown("sort")}
          >
            <ArrowDownUp size={16} aria-hidden="true" />
          </PlannerDropdownButton>
          <PlannerDropdownButton
            active={openDropdown === "group" || groupBy !== "none"}
            ariaLabel="Group planner view"
            title="Group by"
            onClick={() => toggleDropdown("group")}
            buttonRef={groupTriggerRef}
            ariaExpanded={openDropdown === "group"}
            ariaControls="planner-group-dropdown"
          >
            <Group size={16} aria-hidden="true" />
          </PlannerDropdownButton>
          {showPeriodNavigation ? null : (
            <button
              className="items-toolbar-button"
              type="button"
              aria-label="Now"
              disabled={nowDisabled}
              onClick={controller.resetPlannerPeriodToToday}
            >
              Now
            </button>
          )}
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
        sortRules={sortRules}
        groupBy={groupBy}
        showSort={!isDefaultPlannerSort(controller)}
      />
      {openDropdown === "filter" ? (
        <PlannerControlDropdown title="Filter">
          <PlannerFilterRulePanel
            controller={controller}
            filterOptions={filterOptions}
            rules={visibleFilterRules}
          />
        </PlannerControlDropdown>
      ) : null}
      {openDropdown === "sort" ? (
        <PlannerControlDropdown title="Sort">
          <PlannerSortPanel controller={controller} filterOptions={filterOptions} />
        </PlannerControlDropdown>
      ) : null}
      {openDropdown === "group" ? (
        <div ref={groupPanelRef}>
          <PlannerControlDropdown id="planner-group-dropdown" title="Group" compact>
            <PlannerGroupPanel
              settings={plannerGroupSettings(controller)}
              candidates={plannerGroupCandidates(controller, plannerGroupUniverseItems(controller))}
              groupOptions={plannerGroupOptions(controller.panel.id)}
              onGroupByChange={(value) => setPlannerGroupValue(controller, value)}
              onSortChange={controller.setPlannerGroupSort}
              onHideEmptyChange={controller.setPlannerHideEmptyGroups}
              onVisibilityToggle={controller.togglePlannerGroupVisibility}
              onAllVisibilityChange={controller.setAllPlannerGroupsVisible}
              onManualOrderChange={controller.setPlannerManualGroupOrder}
              onRemove={controller.removePlannerGrouping}
              onRequestOuterClose={() => { setOpenDropdown(null); groupTriggerRef.current?.focus(); }}
            />
          </PlannerControlDropdown>
        </div>
      ) : null}
    </div>
  );
}

function PlannerPeriodNavigation({ controller }: { controller: WorkbenchController }) {
  if (controller.panel.id !== "weekly" && controller.panel.id !== "daily") {
    return null;
  }

  const isWeekly = controller.panel.id === "weekly";
  const previousLabel = isWeekly ? "Previous week" : "Previous day";
  const nextLabel = isWeekly ? "Next week" : "Next day";
  const dialogLabel = isWeekly ? "Choose Weekly date" : "Choose Daily date";

  return (
    <div className="planner-period-navigation">
      <button
        className="items-toolbar-button"
        type="button"
        aria-label={previousLabel}
        onClick={() => controller.movePlannerPeriod(-1)}
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <PlannerDatePicker controller={controller} dialogLabel={dialogLabel} />
      <button
        className="items-toolbar-button"
        type="button"
        aria-label={nextLabel}
        onClick={() => controller.movePlannerPeriod(1)}
      >
        <ChevronRight size={16} aria-hidden="true" />
      </button>
      <button
        className="items-toolbar-button"
        type="button"
        aria-label="Now"
        disabled={plannerPeriodMatchesToday(controller)}
        onClick={controller.resetPlannerPeriodToToday}
      >
        Now
      </button>
    </div>
  );
}

function PlannerDatePicker({
  controller,
  dialogLabel,
}: {
  controller: WorkbenchController;
  dialogLabel: string;
}) {
  const mode = controller.panel.id === "weekly" ? "week" : "day";
  const selectedDate = controller.planner.date;
  const triggerLabel =
    mode === "week"
      ? `${controller.planner.weekStart} to ${addLocalDays(controller.planner.weekStart, 6)}`
      : plannerDateLabel(selectedDate);
  const controlRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = React.useState(false);
  const [popoverStyle, setPopoverStyle] = React.useState<React.CSSProperties | null>(null);
  const shouldRestoreFocusRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;

    function dismissOnOutsidePointer(event: MouseEvent) {
      if (!(event.target instanceof Node)) {
        return;
      }
      if (
        controlRef.current?.contains(event.target) ||
        popoverRef.current?.contains(event.target)
      ) {
        return;
      }
      close(true);
    }

    document.addEventListener("mousedown", dismissOnOutsidePointer);
    return () => document.removeEventListener("mousedown", dismissOnOutsidePointer);
  }, [isOpen]);

  React.useLayoutEffect(() => {
    if (!isOpen) return;

    function updatePopoverPosition() {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) {
        return;
      }

      setPopoverStyle(goalPeriodPopoverStyle(trigger, popover));
    }

    updatePopoverPosition();
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [isOpen, mode, selectedDate]);

  useEffect(() => {
    if (!isOpen) {
      setPopoverStyle(null);
      if (shouldRestoreFocusRef.current) {
        shouldRestoreFocusRef.current = false;
        triggerRef.current?.focus();
      }
      return;
    }

    const activeChoice = popoverRef.current?.querySelector<HTMLElement>(
      "button[aria-pressed='true']",
    );
    const fallbackChoice = popoverRef.current?.querySelector<HTMLElement>(
      "button, input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    (activeChoice ?? fallbackChoice)?.focus();
  }, [isOpen, mode, selectedDate]);

  function close(restoreFocus: boolean) {
    shouldRestoreFocusRef.current = restoreFocus;
    setIsOpen(false);
  }

  return (
    <div ref={controlRef}>
      <button
        ref={triggerRef}
        type="button"
        className="planner-period-date-trigger"
        aria-label={dialogLabel}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => (isOpen ? close(false) : setIsOpen(true))}
      >
        <CalendarDays size={16} aria-hidden="true" />
        <span>{triggerLabel}</span>
      </button>

      {isOpen
        ? createPortal(
            <div
              ref={popoverRef}
              className="planner-period-popover"
              style={popoverStyle ?? undefined}
              role="dialog"
              aria-label={dialogLabel}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  close(true);
                }
              }}
            >
              <CalendarDateGrid
                mode={mode}
                selectedDate={selectedDate}
                onSelect={(date) => {
                  controller.selectPlannerPeriodDate(date);
                  close(true);
                }}
              />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function PlannerDropdownButton({
  active,
  ariaLabel,
  title,
  onClick,
  children,
  buttonRef,
  ariaExpanded,
  ariaControls,
}: {
  active: boolean;
  ariaLabel: string;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  buttonRef?: React.Ref<HTMLButtonElement>;
  ariaExpanded?: boolean;
  ariaControls?: string;
}) {
  return (
    <button
      ref={buttonRef}
      className="planner-view-icon-button"
      type="button"
      aria-label={ariaLabel}
      title={title}
      data-active={active}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function PlannerControlDropdown({
  id,
  title,
  compact = false,
  children,
}: {
  id?: string;
  title: string;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      id={id}
      className={`planner-control-dropdown${
        compact ? " planner-control-dropdown-compact" : ""
      }`}
      role="dialog"
      aria-label={title}
    >
      <div className="planner-control-dropdown-title">{title}</div>
      {children}
    </div>
  );
}

function PlannerActiveControlPills({
  filterCount,
  sortRules,
  groupBy,
  showSort,
}: {
  filterCount: number;
  sortRules: PlannerSortRule[];
  groupBy: string;
  showSort: boolean;
}) {
  if (filterCount === 0 && groupBy === "none" && !showSort) {
    return null;
  }

  return (
    <div className="planner-active-control-row" aria-label="Active planner controls">
      {filterCount > 0 ? (
        <span className="planner-active-pill">{filterCount} rules</span>
      ) : null}
      {showSort && sortRules.length > 0 ? (
        <span className="planner-active-pill">
          Sorted by {plannerControlLabel(sortRules[0].field)}
          {sortRules.length > 1 ? ` +${sortRules.length - 1}` : ""}
        </span>
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
  rules,
}: {
  controller: WorkbenchController;
  filterOptions: PlannerFilterOptions;
  rules: PlannerFilterRule[];
}) {
  const fields = plannerFilterFieldConfigs(controller, filterOptions);

  if (rules.length === 0) {
    return (
      <PlannerFilterFieldPicker
        fields={fields}
        onPick={(field) => addPlannerRule(controller, field)}
      />
    );
  }

  return (
    <div className="planner-filter-rule-panel">
      {rules.length > 1 ? <PlannerFilterModeControl controller={controller} /> : null}
      {rules.map((rule, index) => (
        <PlannerAdvancedFilterRuleRow
          key={rule.id}
          controller={controller}
          fields={fields}
          rule={rule}
          prefix={index === 0 ? "Where" : formatPlannerFilterMode(controller.planner.filterMode)}
        />
      ))}
      <button
        type="button"
        className="planner-filter-action"
        aria-label="Add filter rule"
        onClick={() => addPlannerRule(controller, fields[0])}
      >
        + Add filter rule
      </button>
      <button
        type="button"
        className="planner-filter-action planner-filter-action-danger"
        onClick={controller.clearPlannerFilterRules}
      >
        Delete filter
      </button>
    </div>
  );
}

type PlannerSortFieldOption = {
  value: PlannerSortBy;
  label: string;
};

function PlannerSortPanel({
  controller,
  filterOptions,
}: {
  controller: WorkbenchController;
  filterOptions: PlannerFilterOptions;
}) {
  const [addOpen, setAddOpen] = React.useState(false);
  const rules = plannerSortRules(controller);
  const fields = plannerSortFieldOptions(controller, filterOptions);

  if (rules.length === 0) {
    return (
      <PlannerSortFieldPicker
        fields={fields}
        onPick={(field) => {
          setPlannerSortRules(controller, [newPlannerSortRule(field.value)]);
          setAddOpen(false);
        }}
      />
    );
  }

  function addSort(field: PlannerSortFieldOption) {
    setPlannerSortRules(controller, [...rules, newPlannerSortRule(field.value)]);
    setAddOpen(false);
  }

  function updateRule(ruleId: string, patch: Partial<PlannerSortRule>) {
    setPlannerSortRules(
      controller,
      rules.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)),
    );
  }

  function removeRule(ruleId: string) {
    setPlannerSortRules(controller, rules.filter((rule) => rule.id !== ruleId));
  }

  function moveRule(fromId: string, toId: string) {
    const from = rules.findIndex((rule) => rule.id === fromId);
    const to = rules.findIndex((rule) => rule.id === toId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...rules];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setPlannerSortRules(controller, next);
  }

  return (
    <div className="planner-sort-panel">
      {rules.map((rule) => (
        <div
          className="planner-sort-row"
          draggable
          key={rule.id}
          onDragStart={(event) => event.dataTransfer.setData("text/plain", rule.id)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            moveRule(event.dataTransfer.getData("text/plain"), rule.id);
          }}
        >
          <span className="planner-sort-grip" aria-label="Drag sort rule">
            <GripVertical size={14} aria-hidden="true" />
          </span>
          <label className="planner-filter-select-label">
            <span>Sort field</span>
            <select
              aria-label="Sort field"
              value={rule.field}
              onChange={(event) =>
                updateRule(rule.id, { field: event.target.value as PlannerSortBy })
              }
            >
              {fields.map((field) => (
                <option value={field.value} key={field.value}>
                  {field.label}
                </option>
              ))}
            </select>
          </label>
          <label className="planner-filter-select-label">
            <span>Sort direction</span>
            <select
              aria-label="Sort direction"
              value={rule.direction}
              onChange={(event) =>
                updateRule(rule.id, {
                  direction: event.target.value as PlannerSortRule["direction"],
                })
              }
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>
          <button
            type="button"
            className="planner-sort-remove"
            aria-label="Remove sort rule"
            onClick={() => removeRule(rule.id)}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="planner-filter-action"
        aria-label="Add sort"
        aria-expanded={addOpen}
        onClick={() => setAddOpen((current) => !current)}
      >
        + Add sort
      </button>
      {addOpen ? <PlannerSortFieldOptions fields={fields} onPick={addSort} /> : null}
      <button
        type="button"
        className="planner-filter-action planner-filter-action-danger"
        onClick={() => setPlannerSortRules(controller, [])}
      >
        Delete sort
      </button>
    </div>
  );
}

function PlannerSortFieldPicker({
  fields,
  onPick,
}: {
  fields: PlannerSortFieldOption[];
  onPick: (field: PlannerSortFieldOption) => void;
}) {
  return (
    <div className="planner-sort-panel">
      <PlannerSortFieldOptions fields={fields} onPick={onPick} />
    </div>
  );
}

function PlannerSortFieldOptions({
  fields,
  onPick,
}: {
  fields: PlannerSortFieldOption[];
  onPick: (field: PlannerSortFieldOption) => void;
}) {
  return (
    <div className="planner-filter-field-options" role="listbox" aria-label="Sort fields">
      {fields.map((field) => (
        <button
          type="button"
          role="option"
          aria-selected="false"
          key={field.value}
          onClick={() => onPick(field)}
        >
          {field.label}
        </button>
      ))}
    </div>
  );
}

type DailyFilterOption = {
  value: string;
  label: string;
};

type PlannerFilterFieldConfig = {
  field: PlannerFilterField;
  label: string;
  type: PlannerFilterType;
  options: DailyFilterOption[];
};

function PlannerFilterFieldPicker({
  fields,
  onPick,
}: {
  fields: PlannerFilterFieldConfig[];
  onPick: (field: PlannerFilterFieldConfig) => void;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="planner-filter-field-picker">
      <button
        type="button"
        className="planner-filter-action"
        aria-label="Add filter rule"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        + Add filter rule
      </button>
      {open ? (
        <div className="planner-filter-field-options" role="listbox" aria-label="Filter fields">
          {fields.map((field) => (
            <button
              type="button"
              role="option"
              aria-selected="false"
              key={field.field}
              onClick={() => onPick(field)}
            >
              {field.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PlannerFilterModeControl({
  controller,
}: {
  controller: WorkbenchController;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="planner-filter-mode-menu">
      <button
        type="button"
        className="planner-filter-action"
        aria-label="Filter mode"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Mode: {formatPlannerFilterMode(controller.planner.filterMode)}
      </button>
      {open ? (
        <div className="planner-filter-field-options" role="listbox" aria-label="Filter mode options">
          {(["and", "or"] as const).map((mode) => (
            <button
              type="button"
              role="option"
              aria-selected={mode === controller.planner.filterMode}
              key={mode}
              onClick={() => {
                controller.setPlannerFilterMode(mode);
                setOpen(false);
              }}
            >
              {formatPlannerFilterMode(mode)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PlannerAdvancedFilterRuleRow({
  controller,
  fields,
  rule,
  prefix,
}: {
  controller: WorkbenchController;
  fields: PlannerFilterFieldConfig[];
  rule: PlannerFilterRule;
  prefix: string;
}) {
  const field = fields.find((option) => option.field === rule.field) ?? fields[0];

  return (
    <div className="planner-advanced-filter-row">
      <span className="planner-filter-token">{prefix}</span>
      <label className="planner-filter-select-label">
        <span>Field</span>
        <select
          aria-label="Filter field"
          value={field.field}
          onChange={(event) => {
            const nextField = fields.find((option) => option.field === event.target.value);
            if (nextField) updatePlannerRule(controller, rule.id, ruleForField(rule.id, nextField));
          }}
        >
          {fields.map((option) => (
            <option value={option.field} key={option.field}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="planner-filter-select-label">
        <span>Operator</span>
        <select
          aria-label={`Operator for ${field.label}`}
          value={rule.operator}
          onChange={(event) =>
            updatePlannerRule(controller, rule.id, {
              operator: event.target.value as PlannerFilterOperator,
              value: emptyOperators.has(event.target.value as PlannerFilterOperator)
                ? null
                : rule.value,
            })
          }
        >
          {operatorsForFilterType(field.type).map((operator) => (
            <option value={operator} key={operator}>
              {operatorLabel(operator)}
            </option>
          ))}
        </select>
      </label>
      <PlannerFilterValueEditor
        rule={rule}
        field={field}
        onChange={(value) => updatePlannerRule(controller, rule.id, { value })}
      />
    </div>
  );
}

function PlannerFilterValueEditor({
  rule,
  field,
  onChange,
}: {
  rule: PlannerFilterRule;
  field: PlannerFilterFieldConfig;
  onChange: (value: PlannerFilterValue) => void;
}) {
  if (rule.operator === "is_empty" || rule.operator === "is_not_empty") return null;
  if (field.type === "text") {
    return (
      <input
        aria-label="Filter value"
        value={String(rule.value ?? "")}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  if (field.type === "date") {
    return (
      <input
        aria-label="Filter date value"
        type="date"
        value={String(rule.value ?? "")}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  if (field.type === "number") {
    return (
      <input
        aria-label="Filter number value"
        type="number"
        value={String(rule.value ?? "")}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return <PlannerFilterOptionDropdown field={field} rule={rule} onChange={onChange} />;
}

function PlannerFilterOptionDropdown({
  field,
  rule,
  onChange,
}: {
  field: PlannerFilterFieldConfig;
  rule: PlannerFilterRule;
  onChange: (value: PlannerFilterValue) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const selectedValues = new Set(Array.isArray(rule.value) ? rule.value : []);
  const selectedOptions = field.options.filter((option) => selectedValues.has(option.value));

  function toggleValue(optionValue: string) {
    onChange(
      selectedValues.has(optionValue)
        ? [...selectedValues].filter((value) => value !== optionValue)
        : [...selectedValues, optionValue],
    );
  }

  return (
    <div className="planner-filter-value" role="group" aria-label={`Filter by ${field.label}`}>
      <button
        type="button"
        className="planner-filter-value-trigger"
        aria-label={`Select ${field.label} filter values`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {selectedOptions.length > 0 ? (
          selectedOptions.map((option) => (
            <span className="planner-filter-chip" key={option.value}>
              {option.label}
            </span>
          ))
        ) : (
          <span className="planner-filter-placeholder">Select...</span>
        )}
      </button>
      {open ? (
        <div className="planner-filter-option-list">
          {field.options.length > 0 ? (
            field.options.map((option) => (
              <label
                className="planner-filter-option"
                data-selected={selectedValues.has(option.value)}
                key={option.value}
              >
                <input
                  type="checkbox"
                  checked={selectedValues.has(option.value)}
                  onChange={() => toggleValue(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))
          ) : (
            <span className="planner-filter-empty">No options</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

const emptyOperators = new Set<PlannerFilterOperator>(["is_empty", "is_not_empty"]);

function plannerFilterFieldConfigs(
  controller: WorkbenchController,
  filterOptions: PlannerFilterOptions,
): PlannerFilterFieldConfig[] {
  const configs: Record<PlannerFilterField, PlannerFilterFieldConfig> = {
    title: { field: "title", label: "Title", type: "text", options: [] },
    status: {
      field: "status",
      label: "Status",
      type: "select",
      options: filterOptions.daily.statuses,
    },
    tags: {
      field: "tags",
      label: "Tags",
      type: "multiSelect",
      options: filterOptions.daily.tags,
    },
    area: {
      field: "area",
      label: "Area",
      type: "relation",
      options: filterOptions.daily.areas,
    },
    project: {
      field: "project",
      label: "Project",
      type: "relation",
      options: filterOptions.daily.projects,
    },
    routine: {
      field: "routine",
      label: "Routine",
      type: "relation",
      options: filterOptions.daily.routines,
    },
    scheduled: { field: "scheduled", label: "Scheduled", type: "date", options: [] },
    due: { field: "due", label: "Due", type: "date", options: [] },
    priority: {
      field: "priority",
      label: "Priority",
      type: "select",
      options: filterOptions.daily.priorities,
    },
    recurrence_rule: {
      field: "recurrence_rule",
      label: "Recurrence Rule",
      type: "text",
      options: [],
    },
    materialization_policy: {
      field: "materialization_policy",
      label: "Materialization Policy",
      type: "select",
      options: filterOptions.daily.materializationPolicies,
    },
    location: { field: "location", label: "Location", type: "text", options: [] },
    participants: {
      field: "participants",
      label: "Participants",
      type: "multiSelect",
      options: filterOptions.daily.participants,
    },
    commitment_type: {
      field: "commitment_type",
      label: "Commitment Type",
      type: "text",
      options: [],
    },
    description: { field: "description", label: "Description", type: "text", options: [] },
    note: { field: "note", label: "Note", type: "text", options: [] },
    horizon: {
      field: "horizon",
      label: "Horizon",
      type: "select",
      options: filterOptions.daily.horizons,
    },
    parent: {
      field: "parent",
      label: "Parent",
      type: "relation",
      options: filterOptions.daily.parents,
    },
  };

  if (controller.panel.id === "yearly" || controller.panel.id === "monthly") {
    return workspaceGoalFilterFields.map((field) => configs[field]);
  }
  if (controller.panel.id === "weekly") {
    return [...workspaceDailyFilterFields, ...workspaceGoalFilterFields].map(
      (field) => configs[field],
    );
  }
  return workspaceDailyFilterFields.map((field) => configs[field]);
}

const workspaceDailyFilterFields: PlannerFilterField[] = [
  "title",
  "status",
  "tags",
  "area",
  "project",
  "routine",
  "scheduled",
  "due",
  "priority",
  "recurrence_rule",
  "materialization_policy",
  "location",
  "participants",
  "commitment_type",
  "description",
  "note",
];

const workspaceGoalFilterFields: PlannerFilterField[] = [
  "title",
  "status",
  "tags",
  "horizon",
  "scheduled",
  "due",
  "parent",
  "note",
];

function addPlannerRule(
  controller: WorkbenchController,
  field: PlannerFilterFieldConfig | undefined,
) {
  if (!field) return;
  controller.setPlannerFilterRules([
    ...controller.planner.filterRules,
    ruleForField(
      `filter-${field.field}-${controller.planner.filterRules.length}-${Date.now()}`,
      field,
    ),
  ]);
}

function updatePlannerRule(
  controller: WorkbenchController,
  ruleId: string,
  patch: Partial<PlannerFilterRule>,
) {
  controller.setPlannerFilterRules(
    controller.planner.filterRules.map((rule) =>
      rule.id === ruleId ? { ...rule, ...patch } : rule,
    ),
  );
}

function ruleForField(
  id: string,
  field: PlannerFilterFieldConfig,
): PlannerFilterRule {
  return {
    id,
    field: field.field,
    type: field.type,
    operator: defaultOperatorForFilterType(field.type),
    value: defaultValueForFilterType(field.type),
  };
}

function defaultOperatorForFilterType(type: PlannerFilterType): PlannerFilterOperator {
  if (type === "text" || type === "multiSelect") return "contains";
  return "is";
}

function defaultValueForFilterType(type: PlannerFilterType): PlannerFilterValue {
  if (type === "select" || type === "multiSelect" || type === "relation") return [];
  return "";
}

function operatorsForFilterType(type: PlannerFilterType): PlannerFilterOperator[] {
  if (type === "date") {
    return ["is", "is_not", "is_before", "is_after", "is_on_or_before", "is_on_or_after", "is_empty", "is_not_empty"];
  }
  if (type === "number") {
    return ["is", "is_not", "greater_than", "less_than", "is_empty", "is_not_empty"];
  }
  if (type === "text") {
    return ["contains", "does_not_contain", "is", "is_not", "starts_with", "ends_with", "is_empty", "is_not_empty"];
  }
  return ["is", "is_not", "contains", "does_not_contain", "is_empty", "is_not_empty"];
}

function operatorLabel(operator: PlannerFilterOperator): string {
  return operator.replaceAll("_", " ");
}

function formatPlannerFilterMode(mode: WorkbenchController["planner"]["filterMode"]): string {
  return mode === "and" ? "And" : "Or";
}

function buildDailyFilterOptions(
  controller: WorkbenchController,
): {
  tags: DailyFilterOption[];
  areas: DailyFilterOption[];
  projects: DailyFilterOption[];
  routines: DailyFilterOption[];
  statuses: DailyFilterOption[];
  priorities: DailyFilterOption[];
  horizons: DailyFilterOption[];
  parents: DailyFilterOption[];
  materializationPolicies: DailyFilterOption[];
  participants: DailyFilterOption[];
} {
  const { items, relatedItems } = controller.workspaceItems;
  const dailyItems = items
    .filter(isDailyPlannerItem)
    .filter((item) => !isTerminalPlannerItem(item));

  return filterOptionsForItems(dailyItems, relatedItems);
}

function buildPlannerFilterOptions(
  controller: WorkbenchController,
): PlannerFilterOptions {
  if (controller.panel.id === "daily") {
    const daily = buildDailyFilterOptions(controller);
    return { tags: daily.tags, daily };
  }

  const daily = filterOptionsForItems(
    controller.workspaceItems.items.filter((item) =>
      isVisiblePlannerFilterItem(controller.panel.id, item, controller.planner),
    ),
    controller.workspaceItems.relatedItems,
  );
  return { tags: daily.tags, daily };
}

type PlannerFilterOptionSet = ReturnType<typeof buildDailyFilterOptions>;

function filterOptionsForItems(
  items: WorkspaceItemModel[],
  relatedItems: WorkspaceItemsModel["relatedItems"],
): PlannerFilterOptionSet {
  return {
    tags: toFilterOptions(items.flatMap((item) => item.tags ?? [])),
    areas: relationFilterOptions(items, relatedItems.areas, "area_id"),
    projects: relationFilterOptions(items, relatedItems.projects, "project_id"),
    routines: relationFilterOptions(items, relatedItems.routines, "routine_id"),
    statuses: toFilterOptions(items.map((item) => item.status)),
    priorities: priorityOptions.map((value) => ({ value, label: value })),
    horizons: ["week", "month", "year"].map((value) => ({ value, label: value })),
    parents: relationFilterOptions(items, relatedItems.goals, "parent_id"),
    materializationPolicies: materializationPolicyOptions.map((value) => ({
      value,
      label: displayMaterializationPolicy(value),
    })),
    participants: toFilterOptions(
      items.flatMap((item) => item.metadata_?.participants ?? []),
    ),
  };
}

function plannerSortRules(controller: WorkbenchController): PlannerSortRule[] {
  if (controller.panel.id === "daily") {
    return controller.planner.dailySortRules;
  }
  if (controller.panel.id === "weekly") {
    return controller.planner.weeklySortRules;
  }
  if (controller.panel.id === "monthly") {
    return controller.planner.monthlySortRules;
  }
  return controller.planner.yearlySortRules;
}

function defaultPlannerSortRules(controller: WorkbenchController): PlannerSortRule[] {
  return [
    newPlannerSortRule(controller.panel.id === "daily" ? "priority" : "scheduled"),
  ];
}

function isDefaultPlannerSort(controller: WorkbenchController): boolean {
  const current = plannerSortRules(controller);
  const defaults = defaultPlannerSortRules(controller);
  return current.length === defaults.length &&
    current.every((rule, index) =>
      rule.field === defaults[index].field &&
      rule.direction === defaults[index].direction,
    );
}

function setPlannerSortRules(
  controller: WorkbenchController,
  rules: PlannerSortRule[],
) {
  if (controller.panel.id === "daily") {
    controller.setDailySortRules(rules);
    return;
  }
  controller.setPlannerSortRules(rules);
}

function newPlannerSortRule(field: PlannerSortBy): PlannerSortRule {
  return {
    id: `sort-${field}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    field,
    direction: "asc",
  };
}

function plannerSortFieldOptions(
  controller: WorkbenchController,
  filterOptions: PlannerFilterOptions,
): PlannerSortFieldOption[] {
  const fields: PlannerSortFieldOption[] = plannerFilterFieldConfigs(
    controller,
    filterOptions,
  ).map((field) => ({
    value: field.field as PlannerSortBy,
    label: field.label,
  }));
  const seen = new Set<PlannerSortBy>();
  const allFields: PlannerSortFieldOption[] = [
    ...fields,
    { value: "updated", label: "Updated" },
  ];
  return allFields.filter((field) => {
    if (seen.has(field.value)) return false;
    seen.add(field.value);
    return true;
  });
}

function plannerGroupSettings(controller: WorkbenchController): PlannerGroupSettings {
  const settings = controller.planner.groupSettings[plannerViewId(controller)];
  return {
    ...settings,
    groupBy: effectivePlannerGroupValue(controller.panel.id, settings.groupBy),
  };
}

function plannerGroupCandidates(
  controller: WorkbenchController,
  _items: WorkspaceItemModel[],
): PlannerGroupCandidate[] {
  return buildPlannerGroupCandidates({
    view: plannerViewId(controller),
    groupBy: plannerGroupValue(controller),
    items: plannerGroupUniverseItems(controller),
    relatedItems: controller.workspaceItems.relatedItems,
  });
}

function plannerGroupUniverseItems(controller: WorkbenchController): WorkspaceItemModel[] {
  const items = filteredPlannerItems(controller);
  const view = plannerViewId(controller);
  let visible: WorkspaceItemModel[];
  if (view === "daily") {
    const model = buildDailyPlannerModel(items, controller.workspaceItems.relatedItems, {
      date: controller.planner.date,
      filters: emptyDailyFilters(),
      groupSettings: defaultUngroupedSettings(),
      groupCandidates: [],
      sortRules: controller.planner.dailySortRules,
    });
    visible = Object.values(model.sections).flatMap((section) =>
      section.groups.flatMap((group) => group.items),
    );
  } else if (view === "weekly") {
    const model = buildWeeklyPlannerModel(items, controller.planner.weekStart);
    visible = [...model.monthGoals, ...model.weekGoals, ...model.days.flatMap((day) => day.items)];
  } else if (view === "yearly") {
    const model = buildYearlyPeriodGoalCardsModel(items, controller.planner.date);
    const selectedGoals = model.carousel.find((card) => card.position === "selected")?.goals ?? [];
    visible = [...selectedGoals, ...model.months.flatMap((month) => month.goals)];
  } else {
    const model = buildMonthlyPeriodGoalCardsModel(items, controller.planner.date);
    const selectedGoals = model.carousel.find((card) => card.position === "selected")?.goals ?? [];
    visible = [...selectedGoals, ...model.weeks.flatMap((week) => week.goals)];
  }
  return [...new Map(visible.map((item) => [item.id, item])).values()];
}

function defaultUngroupedSettings(): PlannerGroupSettings {
  return { groupBy: "none", sort: "manual", hideEmpty: true, manualOrder: [], hiddenGroupKeys: [] };
}

function plannerViewId(
  controller: WorkbenchController,
): "yearly" | "monthly" | "weekly" | "daily" {
  return controller.panel.id === "yearly" ||
    controller.panel.id === "monthly" ||
    controller.panel.id === "weekly" ||
    controller.panel.id === "daily"
    ? controller.panel.id
    : "daily";
}

function plannerGroupValue(controller: WorkbenchController): PlannerGroupBy {
  return plannerGroupSettings(controller).groupBy;
}

function effectivePlannerGroupValue(
  panelId: WorkbenchController["panel"]["id"],
  value: PlannerGroupBy,
): PlannerGroupBy {
  return plannerGroupOptions(panelId).some((option) => option.value === value) ? value : "none";
}

function setPlannerGroupValue(
  controller: WorkbenchController,
  value: PlannerGroupBy,
) {
  if (controller.panel.id === "daily") {
    controller.setDailyGroupBy(value);
    return;
  }
  controller.setPlannerGroupBy(value);
}

function plannerGroupOptions(
  panelId: WorkbenchController["panel"]["id"],
): { value: PlannerGroupBy; label: string }[] {
  if (panelId === "yearly" || panelId === "monthly") {
    return [
      { value: "none", label: "None" },
      { value: "tag", label: "Tag" },
      { value: "status", label: "Status" },
    ];
  }

  return [
    { value: "none", label: "None" },
    { value: "area", label: "Area" },
    { value: "project", label: "Project" },
    { value: "routine", label: "Routine" },
    { value: "tag", label: "Tag" },
    { value: "item_type", label: "Item type" },
    { value: "status", label: "Status" },
  ];
}

function isDailyPlannerItem(item: WorkspaceItemModel): boolean {
  return item.type === "task" || item.type === "event" || item.type === "routine";
}

function filteredPlannerItems(controller: WorkbenchController): WorkspaceItemModel[] {
  return filterPlannerItemsByRules(
    controller.workspaceItems.items,
    controller.workspaceItems.relatedItems,
    effectivePlannerFilterRules(controller),
    controller.planner.filterMode,
    controller.planner.date,
  );
}

function effectivePlannerFilterRules(controller: WorkbenchController): PlannerFilterRule[] {
  const fields = plannerFilterFieldConfigs(controller, buildPlannerFilterOptions(controller));

  return controller.planner.filterRules.flatMap((rule) => {
    const field = fields.find((option) => option.field === rule.field);
    if (!field) return [];
    if (rule.operator === "is_empty" || rule.operator === "is_not_empty") return [rule];
    if (field.type === "select" || field.type === "multiSelect" || field.type === "relation") {
      const allowed = new Set(field.options.map((option) => option.value));
      const values = (Array.isArray(rule.value) ? rule.value : [String(rule.value ?? "")])
        .filter((value) => allowed.has(value));
      return values.length > 0 ? [{ ...rule, value: values }] : [];
    }
    return rule.value == null || rule.value === "" ? [] : [rule];
  });
}

function visiblePlannerFilterRules(
  controller: WorkbenchController,
  filterOptions: PlannerFilterOptions,
): PlannerFilterRule[] {
  const fields = plannerFilterFieldConfigs(controller, filterOptions);

  return controller.planner.filterRules.flatMap((rule) => {
    const field = fields.find((option) => option.field === rule.field);
    if (!field) return [];
    if (field.type !== "select" && field.type !== "multiSelect" && field.type !== "relation") {
      return [rule];
    }

    const allowed = new Set(field.options.map((option) => option.value));
    const ruleValues = Array.isArray(rule.value) ? rule.value : [String(rule.value ?? "")];
    const values = ruleValues.filter((value) => allowed.has(value));
    if (values.length > 0 || ruleValues.length === 0 || ruleValues[0] === "") {
      return [{ ...rule, value: values }];
    }
    return [];
  });
}

function emptyDailyFilters(): WorkbenchController["planner"]["dailyFilters"] {
  return {
    tags: [],
    areaIds: [],
    projectIds: [],
    routineIds: [],
    itemTypes: [],
    statuses: [],
  };
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
      (item.horizon === "year" || item.horizon === "month") &&
      goalMatchesPlannerPeriod(item, "year", planner.date)
    );
  }
  if (panelId === "monthly") {
    return (
      (item.type === "goal" &&
        ((item.horizon === "month" &&
          goalMatchesPlannerPeriod(item, "month", planner.date)) ||
          (item.horizon === "week" &&
            weekGoalIntersectsPlannerMonth(item, planner.date)))) ||
      (isDailyPlannerItem(item) && itemScheduledInPlannerMonthCalendar(item, planner.date))
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

function weekGoalIntersectsPlannerMonth(item: WorkspaceItemModel, plannerDate: string): boolean {
  const scheduled = item.scheduled?.slice(0, 10);
  if (!scheduled) {
    return false;
  }
  const plannerMonth = plannerDate.slice(0, 7);
  return scheduled.slice(0, 7) === plannerMonth || addDays(scheduled, 6).slice(0, 7) === plannerMonth;
}

function itemScheduledInPlannerMonthCalendar(
  item: WorkspaceItemModel,
  plannerDate: string,
): boolean {
  const scheduled = item.scheduled?.slice(0, 10);
  if (!scheduled) {
    return false;
  }
  const selectedMonth = `${plannerDate.slice(0, 7)}-01`;
  const firstWeekStart = weekStartForPlannerDate(selectedMonth);
  const monthEnd = plannerMonthEnd(selectedMonth);
  const lastWeekEnd = addDays(weekStartForPlannerDate(monthEnd), 6);
  return scheduled >= firstWeekStart && scheduled <= lastWeekEnd;
}

function weekStartForPlannerDate(date: string): string {
  const value = new Date(`${date}T00:00:00`);
  const day = value.getDay();
  value.setDate(value.getDate() + (day === 0 ? -6 : 1 - day));
  return formatDateForPlanner(value);
}

function plannerMonthEnd(monthStart: string): string {
  const value = new Date(`${monthStart}T00:00:00`);
  value.setMonth(value.getMonth() + 1);
  value.setDate(0);
  return formatDateForPlanner(value);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return formatDateForPlanner(value);
}

function formatDateForPlanner(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function relationFilterOptions(
  items: WorkspaceItemModel[],
  labels: Record<string, string>,
  field: "area_id" | "project_id" | "routine_id" | "parent_id",
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
      {renderPlannerGroups(controller, section.groups, "No items found.")}
    </section>
  );
}

function renderPlannerGroups(
  controller: WorkbenchController,
  groups: DailyPlannerSection["groups"],
  emptyMessage: string,
) {
  if (groups.length === 0) {
    return <p className="items-message">{emptyMessage}</p>;
  }

  return groups.map((group) => (
    <div className="planner-card-list" key={group.key}>
      {group.label !== "All" ? <h3>{group.label}</h3> : null}
      <ul className="planner-card-list">
        {group.items.map((item) => (
          <li key={item.id}>
            <PlannerItemRow controller={controller} item={item} />
          </li>
        ))}
      </ul>
    </div>
  ));
}

function PlannerItemRow({
  controller,
  item,
  compact = false,
}: {
  controller: WorkbenchController;
  item: WorkspaceItemModel;
  compact?: boolean;
}) {
  return (
    <div
      className={`planner-item-row${item.status === "completed" ? " is-completed" : ""}${compact ? " is-compact" : ""}`}
    >
      <PlannerTaskCompletionCheckbox controller={controller} item={item} />
      <button
        className={compact ? "monthly-day-item" : "planner-item"}
        type="button"
        title={compact ? item.title : undefined}
        onClick={() => controller.openDetailView(item)}
      >
        {item.title}
      </button>
    </div>
  );
}

function PlannerTaskCompletionCheckbox({
  controller,
  item,
}: {
  controller: WorkbenchController;
  item: WorkspaceItemModel;
}) {
  const visible = item.type === "task" &&
    (item.status === "active" || item.status === "completed");

  if (!visible) return null;

  const checked = item.status === "completed";
  const action: WorkspaceItemTransitionAction = checked ? "reopen" : "complete";
  const label = `${checked ? "Reopen" : "Complete"} ${item.title}`;
  const transitionState = controller.workspaceItemTransitionState(item.id);

  const transition = () => {
    if (transitionState.pending) return;
    void controller.transitionWorkspaceItem(item.id, action).catch(() => undefined);
  };

  return (
    <>
      <input
        aria-label={label}
        checked={checked}
        className="planner-task-checkbox"
        disabled={transitionState.pending}
        type="checkbox"
        onChange={transition}
      />
      {transitionState.error
        ? <span className="planner-task-error" role="alert">{transitionState.error}</span>
        : null}
    </>
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
        <div className="field-label">
          <span>Period</span>
          <GoalPeriodControl
            label="Period"
            horizon={draft.horizon}
            scheduled={draft.scheduled}
            onCommit={({ horizon, scheduled }) => {
              setField("horizon", horizon);
              setField("scheduled", scheduled);
            }}
          />
        </div>
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
      {item.type === "routine" ? (
        <div className="property-row">
          <span>Last Materialized</span>
          <span>{formatDate(item.last_materialized_at)}</span>
        </div>
      ) : null}
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
  tagOptions,
  onChange,
}: {
  value: string;
  tagOptions: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="field-label">
      <span>Tags</span>
      <TagsInput
        label="Tags"
        value={parseTagInput(value)}
        tagOptions={tagOptions}
        onCommit={(tags) => onChange(formatTags(tags))}
      />
    </div>
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

type GoalPeriodControlProps = {
  label: string;
  horizon: string | null | undefined;
  scheduled: string | null | undefined;
  onCommit: (period: { horizon: GoalHorizon; scheduled: string }) => void | Promise<void>;
};

type GoalPeriodCommitError = {
  code: string;
  attemptedHorizon: GoalHorizon;
  parentHorizon?: GoalHorizon;
  childHorizon?: GoalHorizon;
};

function GoalPeriodControl({
  label,
  horizon,
  scheduled,
  onCommit,
}: GoalPeriodControlProps) {
  const safeHorizon = isGoalHorizon(horizon) ? horizon : "year";
  const safeScheduled =
    formatDateValue(scheduled) || canonicalGoalScheduled(safeHorizon, todayValue());
  const controlRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = React.useState(false);
  const [candidateHorizon, setCandidateHorizon] = React.useState<GoalHorizon>(safeHorizon);
  const [popoverStyle, setPopoverStyle] = React.useState<React.CSSProperties | null>(null);
  const [commitError, setCommitError] = React.useState<GoalPeriodCommitError | null>(null);
  const shouldRestoreFocusRef = useRef(false);
  const errorConfirmButtonRef = useRef<HTMLButtonElement>(null);
  const candidateScheduled =
    safeHorizon === "year" && candidateHorizon !== "year" ? todayValue() : safeScheduled;
  const candidateRange = goalPeriodRange(candidateHorizon, candidateScheduled);

  useEffect(() => {
    if (!isOpen) return;

    function dismissOnOutsidePointer(event: MouseEvent) {
      if (!(event.target instanceof Node)) {
        return;
      }
      if (
        controlRef.current?.contains(event.target) ||
        popoverRef.current?.contains(event.target)
      ) {
        return;
      }
      close(true);
    }

    document.addEventListener("mousedown", dismissOnOutsidePointer);
    return () => document.removeEventListener("mousedown", dismissOnOutsidePointer);
  }, [isOpen]);

  React.useLayoutEffect(() => {
    if (!isOpen) return;

    function updatePopoverPosition() {
      const trigger = triggerRef.current;
      const popover = popoverRef.current;
      if (!trigger || !popover) {
        return;
      }

      setPopoverStyle(goalPeriodPopoverStyle(trigger, popover));
    }

    updatePopoverPosition();
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [isOpen, candidateHorizon, candidateScheduled]);

  useEffect(() => {
    if (commitError) {
      errorConfirmButtonRef.current?.focus();
      return;
    }

    if (!isOpen) {
      setPopoverStyle(null);
      if (shouldRestoreFocusRef.current) {
        shouldRestoreFocusRef.current = false;
        triggerRef.current?.focus();
      }
      return;
    }

    const activeChoice = popoverRef.current?.querySelector<HTMLElement>(
      "button[aria-pressed='true']",
    );
    const fallbackChoice = popoverRef.current?.querySelector<HTMLElement>(
      "button, input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    const focusTarget = activeChoice ?? fallbackChoice;
    focusTarget?.focus();
  }, [candidateHorizon, commitError, isOpen]);

  function close(restoreFocus: boolean) {
    shouldRestoreFocusRef.current = restoreFocus;
    setIsOpen(false);
  }

  function open() {
    setCandidateHorizon(safeHorizon);
    setIsOpen(true);
  }

  function closeCommitError() {
    setCommitError(null);
    triggerRef.current?.focus();
  }

  async function commit(date: string) {
    try {
      await onCommit({
        horizon: candidateHorizon,
        scheduled: canonicalGoalScheduled(candidateHorizon, date),
      });
      close(true);
    } catch (error) {
      if (error instanceof TodoEngineApiError) {
        close(false);
        setCommitError({
          code: error.code,
          attemptedHorizon: candidateHorizon,
          parentHorizon: isGoalHorizon(error.parentHorizon)
            ? error.parentHorizon
            : undefined,
          childHorizon: isGoalHorizon(error.childHorizon)
            ? error.childHorizon
            : undefined,
        });
        return;
      }

      throw error;
    }
  }

  const requestedHorizon = commitError?.childHorizon ?? commitError?.attemptedHorizon;
  const commitErrorTitle = requestedHorizon
    ? `${goalHorizonLabel(requestedHorizon)}로 변경할 수 없음`
    : "";
  const commitErrorMessage = goalPeriodCommitErrorMessage(commitError);

  return (
    <div
      ref={controlRef}
      className="goal-period-control"
      role="group"
      aria-label={label}
      onClick={stopRowEvent}
      onKeyDown={(event) => {
        if (event.key === "Escape" && isOpen) {
          event.stopPropagation();
          close(true);
          return;
        }
        stopRowKeyDown(event);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="goal-period-trigger"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => (isOpen ? close(false) : open())}
      >
        {goalPeriodTriggerLabel(safeHorizon, safeScheduled)}
      </button>

      {isOpen ? (
        createPortal(
          <div
            ref={popoverRef}
            className="goal-period-popover"
            style={popoverStyle ?? undefined}
            role="dialog"
            aria-label={label}
            onClick={stopRowEvent}
          >
            <div className="goal-period-types" aria-label="Period type">
              {goalHorizons.map((horizonOption) => (
                <button
                  type="button"
                  key={horizonOption}
                  aria-pressed={candidateHorizon === horizonOption}
                  onClick={() => setCandidateHorizon(horizonOption)}
                >
                  {capitalize(horizonOption)}
                </button>
              ))}
            </div>

            {candidateHorizon === "year" ? (
              <label className="field-label">
                <span>Goal year</span>
                <select
                  className="goal-period-year-select"
                  aria-label="Goal year"
                  value={candidateRange.start.slice(0, 4)}
                  onChange={(event) => void commit(`${event.target.value}-01-01`)}
                >
                  {goalYearOptions(yearValue(safeScheduled)).map((year) => (
                    <option value={year.toString()} key={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
            ) : candidateHorizon === "month" ? (
              <GoalMonthPicker scheduled={candidateScheduled} onSelect={commit} />
            ) : (
              <GoalPeriodCalendar scheduled={candidateScheduled} onSelect={commit} />
            )}

            <p className="goal-period-range">
              {candidateRange.start} to {candidateRange.end}
            </p>
          </div>,
          document.body,
        )
      ) : null}

      {commitError
        ? createPortal(
            <div className="confirmation-backdrop">
              <section
                className="confirmation-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={commitErrorTitle}
                onClick={stopRowEvent}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    closeCommitError();
                    return;
                  }

                  stopRowKeyDown(event);
                }}
              >
                <h2>{commitErrorTitle}</h2>
                <p>{commitErrorMessage}</p>
                <div className="dialog-actions">
                  <button
                    ref={errorConfirmButtonRef}
                    type="button"
                    onClick={closeCommitError}
                  >
                    확인
                  </button>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function goalPeriodCommitErrorMessage(
  commitError: GoalPeriodCommitError | null,
): string {
  if (!commitError) {
    return "";
  }

  if (
    commitError.code === "goal_parent_horizon_not_coarser" &&
    commitError.parentHorizon &&
    commitError.childHorizon
  ) {
    return `현재 Parent 기간은 ${goalHorizonLabel(commitError.parentHorizon)}이고, 요청한 Goal 기간은 ${goalHorizonLabel(commitError.childHorizon)}입니다. Goal은 Parent보다 더 작은 기간만 사용할 수 있습니다.`;
  }

  if (commitError.code === "goal_invalid_anchor") {
    return "선택한 기간과 맞지 않는 날짜입니다. 다시 선택해 주세요.";
  }

  return "기간을 변경하지 못했습니다. 다시 시도해 주세요.";
}

function GoalMonthPicker({
  scheduled,
  onSelect,
}: {
  scheduled: string;
  onSelect: (date: string) => void;
}) {
  const [viewYear, setViewYear] = React.useState(() => yearValue(scheduled));
  const currentYear = yearValue(todayValue());
  const selectedMonth = monthStart(scheduled);

  React.useEffect(() => {
    setViewYear(yearValue(scheduled));
  }, [scheduled]);

  return (
    <div className="goal-period-month-picker">
      <div className="goal-period-calendar-header">
        <button
          type="button"
          aria-label="Previous year"
          onClick={(event) => {
            stopRowEvent(event);
            setViewYear((current) => current - 1);
          }}
        >
          &lt;
        </button>
        <span>{viewYear}</span>
        <button
          type="button"
          aria-label="Next year"
          onClick={(event) => {
            stopRowEvent(event);
            setViewYear((current) => current + 1);
          }}
        >
          &gt;
        </button>
      </div>
      <button
        type="button"
        className="goal-period-view-reset"
        disabled={viewYear === currentYear}
        onClick={(event) => {
          stopRowEvent(event);
          setViewYear(currentYear);
        }}
      >
        This year
      </button>
      <div className="goal-period-month-grid" aria-label="Goal month">
        {Array.from({ length: 12 }, (_, monthIndex) => {
          const date = monthOptionDate(viewYear, monthIndex);
          const selected = date === selectedMonth;
          return (
            <button
              type="button"
              key={date}
              className="goal-period-month-button"
              aria-label={monthOptionLabel(date)}
              aria-pressed={selected}
              onClick={(event) => {
                stopRowEvent(event);
                onSelect(date);
              }}
            >
              {localDate(date).toLocaleDateString("en-US", { month: "short" })}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type CalendarSelectionMode = "week" | "day";

function CalendarDateGrid({
  mode,
  selectedDate,
  onSelect,
}: {
  mode: CalendarSelectionMode;
  selectedDate: string;
  onSelect: (date: string) => void;
}) {
  const [viewMonth, setViewMonth] = React.useState(() => monthStart(selectedDate));
  const currentMonth = monthStart(todayValue());
  const range = mode === "week" ? goalPeriodRange("week", selectedDate) : null;
  const cells = calendarMonthDays(viewMonth);
  const [previewedDate, setPreviewedDate] = React.useState<string | null>(null);
  const previewRange =
    mode === "week" && previewedDate ? goalPeriodRange("week", previewedDate) : null;

  React.useEffect(() => {
    setViewMonth(monthStart(selectedDate));
    setPreviewedDate(null);
  }, [selectedDate]);

  return (
    <div className="goal-period-calendar">
      <div className="goal-period-calendar-header">
        <button
          type="button"
          aria-label="Previous month"
          onClick={(event) => {
            stopRowEvent(event);
            setViewMonth((current) => addMonth(current, -1));
          }}
        >
          &lt;
        </button>
        <span>{monthLabel(viewMonth)}</span>
        <button
          type="button"
          aria-label="Next month"
          onClick={(event) => {
            stopRowEvent(event);
            setViewMonth((current) => addMonth(current, 1));
          }}
        >
          &gt;
        </button>
      </div>
      <button
        type="button"
        className="goal-period-view-reset"
        disabled={viewMonth === currentMonth}
        onClick={(event) => {
          stopRowEvent(event);
          setViewMonth(currentMonth);
        }}
      >
        This month
      </button>
      <div className="goal-period-calendar-grid">
        {dayLabels.map((day) => (
          <span className="goal-period-calendar-weekday" key={day}>
            {day}
          </span>
        ))}
        {cells.map((cell) => {
          const selected =
            mode === "week"
              ? cell.date >= (range?.start ?? "") && cell.date <= (range?.end ?? "")
              : cell.date === selectedDate;
          return (
            <button
              type="button"
              key={cell.date}
              className={goalPeriodCalendarDayClassName({
                cell,
                selected,
                previewed:
                  mode === "week"
                    ? previewRange !== null &&
                      cell.date >= previewRange.start &&
                      cell.date <= previewRange.end
                    : cell.date === previewedDate,
                rangeStart:
                  mode === "week" &&
                  (cell.date === range?.start || cell.date === previewRange?.start),
                rangeEnd:
                  mode === "week" &&
                  (cell.date === range?.end || cell.date === previewRange?.end),
              })}
              aria-label={calendarDayAriaLabel(mode, cell.date)}
              aria-pressed={selected}
              onFocus={() => setPreviewedDate(cell.date)}
              onBlur={() => setPreviewedDate(null)}
              onMouseEnter={() => {
                setPreviewedDate(cell.date);
              }}
              onMouseLeave={() => setPreviewedDate(null)}
              onClick={(event) => {
                stopRowEvent(event);
                onSelect(cell.date);
              }}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GoalPeriodCalendar({
  scheduled,
  onSelect,
}: {
  scheduled: string;
  onSelect: (date: string) => void;
}) {
  return <CalendarDateGrid mode="week" selectedDate={scheduled} onSelect={onSelect} />;
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
      <div className={`recurrence-fields recurrence-fields-${parsed.frequency}`}>
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
  const [submitError, setSubmitError] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const isGoal = controller.panel.id === "goals";
  const isPlannerGoal =
    itemType === "goal" &&
    (controller.panel.id === "weekly" ||
      controller.panel.id === "monthly" ||
      controller.panel.id === "yearly");
  const needsGoalPeriod = isGoal || isPlannerGoal;
  const needsScheduled =
    controller.panel.id === "events" ||
    ((controller.panel.id === "weekly" || controller.panel.id === "daily") &&
      (itemType === "task" || itemType === "event"));

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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError("");
    setIsSubmitting(true);
    try {
      await controller.createWorkspaceItem({
        title,
        itemType,
        scheduled,
        horizon,
      });
    } catch (error) {
      setSubmitError(
        error instanceof TodoEngineApiError
          ? error.detail
          : "항목을 생성하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setIsSubmitting(false);
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
        onSubmit={handleSubmit}
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
        {needsGoalPeriod ? (
          <GoalPeriodControl
            label="Period"
            horizon={horizon}
            scheduled={scheduled}
            onCommit={({ horizon, scheduled }) => {
              setHorizon(horizon);
              setScheduled(scheduled);
            }}
          />
        ) : null}
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
        {submitError ? (
          <p className="items-message" role="alert">
            {submitError}
          </p>
        ) : null}
        <div className="dialog-actions">
          <button type="button" onClick={controller.closeCreationDialog}>
            Cancel
          </button>
          <button type="submit" disabled={isSubmitting}>
            Create
          </button>
        </div>
      </form>
    </div>
  );
}

function defaultCreationScheduled(controller: WorkbenchController): string {
  if (controller.panel.id === "goals") {
    return `${new Date().getFullYear()}-01-01`;
  }
  if (controller.panel.id === "weekly") {
    return controller.planner.weekStart;
  }
  if (controller.panel.id === "monthly") {
    return monthStart(controller.planner.date);
  }
  if (controller.panel.id === "yearly") {
    return yearStart(controller.planner.date);
  }
  if (controller.panel.id === "daily") {
    return controller.planner.date;
  }

  return "";
}

function plannerPeriodMatchesToday(controller: WorkbenchController): boolean {
  const today = formatDateForPlanner(new Date());

  if (controller.panel.id === "yearly") {
    return yearStart(controller.planner.date) === yearStart(today);
  }
  if (controller.panel.id === "monthly") {
    return monthStart(controller.planner.date) === monthStart(today);
  }
  if (controller.panel.id === "weekly") {
    return isoWeekStart(controller.planner.weekStart) === isoWeekStart(today);
  }
  if (controller.panel.id === "daily") {
    return controller.planner.date === today;
  }

  return false;
}

function defaultCreationHorizon(controller: WorkbenchController): string {
  if (controller.panel.id === "goals") {
    return "year";
  }
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

function stopRowKeyDown(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key === "Escape") {
    return;
  }
  stopRowEvent(event);
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
  tagOptions,
  onCommit,
}: {
  label: string;
  value: string[] | null | undefined;
  tagOptions: string[];
  onCommit: (value: string[]) => void;
}) {
  const currentTags = React.useMemo(() => parseTagInput(formatTags(value)), [value]);
  const availableTags = React.useMemo(
    () => tagOptions.filter((tag) => !currentTags.includes(tag)),
    [currentTags, tagOptions],
  );
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);
  const normalizedDraft = draft.trim().toLowerCase();
  const filteredTags = availableTags.filter((tag) =>
    tag.toLowerCase().includes(normalizedDraft),
  );

  React.useEffect(() => {
    setDraft("");
  }, [currentTags]);

  React.useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

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

  function closeDropdown() {
    commitDraft();
    setOpen(false);
  }

  return (
    <div
      className="tag-combobox"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          closeDropdown();
        }
      }}
    >
      <div
        className="tag-input"
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-expanded={open}
        onClick={(event) => {
          stopRowEvent(event);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          stopRowEvent(event);
          if (event.key === "Enter" || event.key === " " || event.key === "Space") {
            event.preventDefault();
            setOpen(true);
          }
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
      </div>
      {open ? (
        <div className="tag-dropdown" onClick={stopRowEvent}>
          <input
            ref={inputRef}
            aria-label={label}
            placeholder="Search for an option..."
            value={draft}
            onKeyDown={(event) => {
              stopRowEvent(event);
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
              }
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                commitDraft();
              }
            }}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="tag-option-list" role="listbox" aria-label={`${label} options`}>
            {filteredTags.map((tag) => (
              <button
                key={tag}
                type="button"
                role="option"
                aria-selected="false"
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  stopRowEvent(event);
                  commitTags([...currentTags, tag]);
                  setDraft("");
                }}
              >
                <span className="tag-chip">{tag}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
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
  if (item.type === "area") {
    return areaStatusOptions;
  }
  if (item.type === "task") {
    return taskStatusOptions;
  }
  return workItemStatusOptions;
}

function detailStatusForItem(item: WorkspaceItemModel | null): string {
  return item ? displayStatusForItem(item) : "";
}

function displayStatusForItem(item: WorkspaceItemModel): string {
  if (item.type === "area") {
    return item.status === "archived" ? "archived" : "active";
  }
  if (item.type === "task") {
    return item.status === "completed" ? "completed" : "active";
  }
  if (item.status === "paused" || item.status === "completed") {
    return item.status;
  }
  return "active";
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

function goalPeriodColumn(): ItemColumn {
  return {
    label: "Period",
    value: (item, _items, controller) => (
      <GoalPeriodControl
        label={`Period for ${item.title}`}
        horizon={item.horizon}
        scheduled={item.scheduled}
        onCommit={({ horizon, scheduled }) =>
          controller.patchWorkspaceItem(item.id, { horizon, scheduled })
        }
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
    value: (item, workspaceItems, controller) => (
      <TagsInput
        label={`Tags for ${item.title}`}
        value={item.tags}
        tagOptions={workspaceItems.tagOptions}
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
    goalPeriodColumn(),
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

type GoalHorizon = "year" | "month" | "week";

const goalHorizons: GoalHorizon[] = ["year", "month", "week"];
const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type CalendarCell = {
  date: string;
  day: number;
  inMonth: boolean;
};

function isGoalHorizon(value: string | null | undefined): value is GoalHorizon {
  return value === "year" || value === "month" || value === "week";
}

function localDate(value: string): Date {
  const [year = "1970", month = "1", day = "1"] = value.split("-");
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function localDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addLocalDays(value: string, days: number): string {
  const date = localDate(value);
  date.setDate(date.getDate() + days);
  return localDateValue(date);
}

function addMonth(value: string, months: number): string {
  const date = localDate(value);
  date.setMonth(date.getMonth() + months, 1);
  return localDateValue(date);
}

function monthStart(value: string): string {
  const date = localDate(value);
  return localDateValue(new Date(date.getFullYear(), date.getMonth(), 1));
}

function monthEnd(value: string): string {
  const date = localDate(value);
  return localDateValue(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

function yearStart(value: string): string {
  return `${localDate(value).getFullYear()}-01-01`;
}

function yearEnd(value: string): string {
  return `${localDate(value).getFullYear()}-12-31`;
}

function isoWeekStart(value: string): string {
  const date = localDate(value);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return localDateValue(date);
}

function canonicalGoalScheduled(horizon: GoalHorizon, date: string): string {
  if (horizon === "year") return yearStart(date);
  if (horizon === "month") return monthStart(date);
  return isoWeekStart(date);
}

function goalHorizonLabel(horizon: GoalHorizon): string {
  return capitalize(horizon);
}

function goalPeriodRange(
  horizon: GoalHorizon,
  scheduled: string,
): { start: string; end: string } {
  const start = canonicalGoalScheduled(horizon, scheduled);
  if (horizon === "year") return { start, end: yearEnd(start) };
  if (horizon === "month") return { start, end: monthEnd(start) };
  return { start, end: addLocalDays(start, 6) };
}

function goalPeriodTriggerLabel(horizon: GoalHorizon, scheduled: string): string {
  const range = goalPeriodRange(horizon, scheduled);

  if (horizon === "year") {
    return `Year · ${range.start.slice(0, 4)}`;
  }
  if (horizon === "month") {
    return `Month · ${monthLabel(range.start)}`;
  }
  return `Week · ${range.start} to ${range.end}`;
}

function yearValue(value: string): number {
  return localDate(value).getFullYear();
}

function goalYearOptions(selectedYear: number): number[] {
  const currentYear = new Date().getFullYear();
  const defaultStart = currentYear - 50;
  const defaultEnd = currentYear + 50;
  const start = Math.min(defaultStart, selectedYear);
  const end = Math.max(defaultEnd, selectedYear);

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function goalPeriodPopoverStyle(
  trigger: HTMLElement,
  popover: HTMLElement,
): React.CSSProperties {
  const viewportMargin = 16;
  const offset = 4;
  const triggerRect = trigger.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  const width = Math.min(
    popoverRect.width || 320,
    Math.max(0, window.innerWidth - viewportMargin * 2),
  );
  const popoverHeight = popoverRect.height || popover.scrollHeight || 0;
  const belowSpace = Math.max(0, window.innerHeight - viewportMargin - triggerRect.bottom - offset);
  const aboveSpace = Math.max(0, triggerRect.top - viewportMargin - offset);
  const placeAbove = belowSpace < popoverHeight && aboveSpace > belowSpace;
  const availableHeight = placeAbove ? aboveSpace : belowSpace;
  const renderedHeight = Math.min(popoverHeight, Math.max(1, availableHeight || popoverHeight));
  const maxLeft = Math.max(viewportMargin, window.innerWidth - viewportMargin - width);
  const left = clampNumber(triggerRect.left, viewportMargin, maxLeft);
  const rawTop = placeAbove
    ? triggerRect.top - offset - renderedHeight
    : triggerRect.bottom + offset;
  const maxTop = Math.max(viewportMargin, window.innerHeight - viewportMargin - renderedHeight);
  const top = clampNumber(rawTop, viewportMargin, maxTop);

  return {
    position: "fixed",
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    width: `${Math.round(width)}px`,
    maxHeight: `${Math.max(0, Math.round(availableHeight))}px`,
    overflowY: "auto",
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function calendarMonthDays(anchor: string): CalendarCell[] {
  const first = localDate(monthStart(anchor));
  const startOffset = (first.getDay() || 7) - 1;
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - startOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return {
      date: localDateValue(date),
      day: date.getDate(),
      inMonth: date.getMonth() === first.getMonth(),
    };
  });
}

function goalPeriodCalendarDayClassName({
  cell,
  selected,
  previewed,
  rangeStart,
  rangeEnd,
}: {
  cell: CalendarCell;
  selected: boolean;
  previewed: boolean;
  rangeStart: boolean;
  rangeEnd: boolean;
}): string {
  return [
    "goal-period-calendar-day",
    cell.inMonth ? "" : "goal-period-calendar-day-muted",
    selected ? "goal-period-calendar-day-selected" : "",
    previewed ? "goal-period-calendar-day-preview" : "",
    rangeStart ? "goal-period-calendar-day-range-start" : "",
    rangeEnd ? "goal-period-calendar-day-range-end" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function monthLabel(value: string): string {
  return localDate(value).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function monthOptionDate(year: number, monthIndex: number): string {
  return localDateValue(new Date(year, monthIndex, 1));
}

function monthOptionLabel(value: string): string {
  return localDate(value).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function plannerDateLabel(value: string): string {
  return localDate(value).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function calendarDayAriaLabel(mode: CalendarSelectionMode, date: string): string {
  const formattedDate = plannerDateLabel(date);
  if (mode === "day") {
    return `${formattedDate}. Selects this day.`;
  }

  const range = goalPeriodRange("week", date);
  return `${formattedDate}. Selects the week containing this date, ${range.start} to ${range.end}.`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function todayValue(): string {
  return localDateValue(new Date());
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
