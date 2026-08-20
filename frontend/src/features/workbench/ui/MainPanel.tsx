import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Redo2,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";

import type {
  HealthTabId,
  LeafTabId,
  LedgerTabId,
  WorkspaceChildTabId,
} from "@/domain/workbench/navigation";
import { DashboardPanel } from "@/features/dashboard/ui/DashboardPanel";
import { useHealthController } from "@/features/health/hooks/useHealthController";
import {
  applyHealthReportDrilldown,
  type HealthReportDrilldown,
} from "@/features/health/model/health-reports";
import type { HealthTableScopeId } from "@/features/health/model/health-table-views";
import { HealthPanel } from "@/features/health/ui/HealthPanel";
import { useLedgerController } from "@/features/ledger/hooks/useLedgerController";
import {
  applyReportDrilldown,
  type ReportDrilldownTarget,
} from "@/features/ledger/model/ledger-reports";
import { LedgerPanel } from "@/features/ledger/ui/LedgerPanel";
import { RavenApiError } from "@/lib/raven-api";
import { linkedItemGroups } from "@/features/workbench/model/linked-items";
import {
  useBrowserDetailHistory,
  type BrowserDetailHistory,
} from "@/features/workbench/hooks/useBrowserDetailHistory";
import {
  buildPlannerGroupCandidates,
  type PlannerGroupCandidate,
  type PlannerGroupSettings,
} from "@/features/workbench/model/planner-group-settings";
import {
  buildDailyPlannerSections,
  buildMonthlyPeriodGoalCardsModel,
  buildWeeklyPlannerModel,
  buildYearlyPeriodGoalCardsModel,
  clonePlannerTableSettings,
  type DailyPlannerSection,
  effectivePlannerFilterRules,
  filterPlannerItemsByRules,
  groupPlannerItems,
  type MonthlyPlannerWeekModel,
  type PeriodGoalBucketModel,
  type PeriodGoalCardModel,
  type PlannerFilterRule,
  plannerFilterFieldsForTable,
  plannerSortFieldsForTable,
  plannerWeekdayLabels,
  sortPlannerItems,
  type PlannerGroupBy,
  type PlannerTableId,
} from "@/features/workbench/model/planner-model";
import {
  DEFAULT_FUTURE_OCCURRENCES,
  MAX_FUTURE_OCCURRENCES,
  type CreateWorkspaceItemForm,
  type MaterializeRoutineTarget,
  type PlannerCreationContext,
  type PlannerCreationItemType,
  type WorkbenchController,
  type WorkspaceItemModel,
  type WorkspaceItemsModel,
  type WorkspaceItemPatch,
  type WorkspaceItemTransitionAction,
} from "@/features/workbench/model/workbench-model";
import {
  collapseWorkspaceGroups,
  detailWorkspaceScope,
  deriveWorkspaceViewGroups,
  workspaceFilterFieldsForScope,
  workspaceScopeForPanel,
  workspaceSortFieldsForScope,
} from "@/features/workbench/model/workspace-table-views";
import { PlannerTableTabs } from "@/features/workbench/ui/PlannerTableTabs";
import { MarkdownNoteEditor } from "@/features/workbench/ui/MarkdownNoteEditor";
import {
  type PlannerFilterOptionSet,
  type PlannerFilterOptions,
  TableViewActivePills,
  TableViewControls,
  type TableViewControlsAdapter,
} from "@/features/workbench/ui/TableViewControls";
import { TableViewTabs } from "@/features/workbench/ui/TableViewTabs";
import { WorkspaceGroupedRows } from "@/features/workbench/ui/WorkspaceGroupedRows";
import { DestructiveConfirmationDialog } from "@/features/workbench/ui/DestructiveConfirmationDialog";
import {
  formatTags,
  parseTagInput,
  TagsInput,
} from "@/features/workbench/ui/TagsInput";

type MainPanelProps = {
  controller: WorkbenchController;
};

type DetailHistoryController = BrowserDetailHistory;

type PlannerCreationSourceContext = Omit<PlannerCreationContext, "tableSettings">;

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

function sameTags(left: string[] | null | undefined, right: string[] | null | undefined): boolean {
  return formatTags(left) === formatTags(right);
}

export function MainPanel({ controller }: MainPanelProps) {
  const detailHistory = useBrowserDetailHistory({
    stateKey: "__ravenDetailItemId",
    currentId: controller.detailItem?.id ?? null,
    resolve: (id) => controller.workspaceItems.allItems.find((item) => item.id === id) ?? null,
    open: controller.openDetailView,
    close: controller.closeDetailView,
  });

  if (controller.detailItem) {
    return (
      <main className="main-panel">
        <DetailView
          key={controller.detailItem.id}
          controller={controller}
          detailHistory={detailHistory}
        />
      </main>
    );
  }

  if (controller.selection.leafTabId === "dashboard") {
    return (
      <main className="main-panel">
        <DashboardPanel controller={controller} />
      </main>
    );
  }

  if (controller.selection.mainTabId === "ledger" && isLedgerPanel(controller.selection.leafTabId)) {
    return (
      <main className="main-panel">
        <LedgerWorkspace
          leafTabId={controller.selection.leafTabId}
          workbench={controller}
        />
      </main>
    );
  }

  if (controller.selection.mainTabId === "health" && isHealthPanel(controller.selection.leafTabId)) {
    return (
      <main className="main-panel">
        <HealthWorkspace leafTabId={controller.selection.leafTabId} workbench={controller} />
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

function LedgerWorkspace({
  leafTabId,
  workbench,
}: {
  leafTabId: LedgerTabId;
  workbench: WorkbenchController;
}) {
  const controller = useLedgerController();
  function drilldown(target: ReportDrilldownTarget) {
    controller.updateTableSettings("ledger.transactions", (settings) =>
      applyReportDrilldown(settings, target));
    workbench.selectTab("transactions");
  }
  return (
    <LedgerPanel
      controller={controller}
      leafTabId={leafTabId}
      onReportDrilldown={drilldown}
    />
  );
}

function HealthWorkspace({
  leafTabId,
  workbench,
}: {
  leafTabId: HealthTabId;
  workbench: WorkbenchController;
}) {
  const controller = useHealthController();
  function drilldown(target: HealthReportDrilldown) {
    const scope = (
      `health.${target.tab === "health-metrics" ? "metrics" : target.tab}`
    ) as HealthTableScopeId;
    controller.updateTableSettings(scope, (settings) =>
      applyHealthReportDrilldown(settings, target));
    controller.selectTableTab(scope, controller.tableTabs(scope).activeTabId);
    workbench.selectTab(target.tab);
  }
  return (
    <HealthPanel
      controller={controller}
      leafTabId={leafTabId}
      onReportDrilldown={drilldown}
    />
  );
}

function DetailView({
  controller,
  detailHistory,
}: MainPanelProps & { detailHistory: DetailHistoryController }) {
  const item = controller.detailItem;
  const [draftHistory, dispatchDraft] = React.useReducer(
    detailDraftHistoryReducer,
    item,
    (initialItem) => initialDetailDraftHistory(initialItem),
  );
  const draft = draftHistory.present;
  const [isSaving, setIsSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [archiveDialogOpen, setArchiveDialogOpen] = React.useState(false);
  const [archiveError, setArchiveError] = React.useState<string | null>(null);
  const [archiveActionLocked, setArchiveActionLocked] = React.useState(false);
  const archiveActionLockedRef = React.useRef(false);
  const archiveButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const savePendingRef = React.useRef(false);
  const saveGenerationRef = React.useRef(0);
  const activeItemIdRef = React.useRef(item?.id ?? null);
  const suppressedSyncRef = React.useRef<{ itemId: string; generation: number } | null>(null);
  const pendingSaveRebaseRef = React.useRef<{
    itemId: string;
    generation: number;
    submittedDraft: DetailDraft;
  } | null>(null);
  const saveDraftRef = React.useRef<() => Promise<void>>(async () => {});
  const pendingNavigationRef = React.useRef(false);
  const [pendingLinkedItem, setPendingLinkedItem] = React.useState<WorkspaceItemModel | null>(
    null,
  );
  const cancelLinkedItemNavigationRef = useRef<HTMLButtonElement | null>(null);
  const discardLinkedItemNavigationRef = useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (suppressedSyncRef.current?.itemId === item?.id) {
      return;
    }
    const pendingRebase = pendingSaveRebaseRef.current;
    if (
      pendingRebase &&
      item &&
      pendingRebase.itemId === item.id &&
      pendingRebase.generation === saveGenerationRef.current
    ) {
      pendingSaveRebaseRef.current = null;
      dispatchDraft({
        type: "rebase-saved-item",
        itemId: item.id,
        itemType: item.type,
        submittedDraft: pendingRebase.submittedDraft,
        canonicalDraft: detailDraftForItem(item),
      });
      return;
    }
    dispatchDraft({
      type: "sync-item",
      itemId: item?.id ?? null,
      draft: detailDraftForItem(item),
    });
  }, [isSaving, item]);

  React.useEffect(() => {
    setSaveError(null);
    setIsSaving(false);
  }, [item?.id]);

  React.useEffect(() => {
    activeItemIdRef.current = item?.id ?? null;
    return () => {
      activeItemIdRef.current = null;
      saveGenerationRef.current += 1;
      savePendingRef.current = false;
      suppressedSyncRef.current = null;
      pendingSaveRebaseRef.current = null;
    };
  }, [item?.id]);

  const hasDraftChanges = item ? hasDetailChanges(item, draft) : false;
  const transitionState = item
    ? controller.workspaceItemTransitionState(item.id)
    : { pending: false, error: null };
  const pendingNavigation = pendingLinkedItem !== null || detailHistory.pendingBack;
  const detailDialogOpen = pendingNavigation || archiveDialogOpen;
  pendingNavigationRef.current = detailDialogOpen;

  React.useEffect(() => {
    detailHistory.setDirty(hasDraftChanges);
    return () => detailHistory.setDirty(false);
  }, [detailHistory.setDirty, hasDraftChanges]);

  React.useEffect(() => {
    detailHistory.setDialogOpen(detailDialogOpen);
    return () => detailHistory.setDialogOpen(false);
  }, [detailDialogOpen, detailHistory.setDialogOpen]);

  React.useEffect(() => {
    if (pendingNavigation) {
      cancelLinkedItemNavigationRef.current?.focus();
    }
  }, [pendingNavigation]);

  function setField(field: keyof DetailDraft, value: string) {
    dispatchDraft({
      type: "update",
      fields: { [field]: value },
      group: continuousDetailDraftFields.includes(field) ? field : null,
    });
  }

  function setFields(fields: Partial<DetailDraft>) {
    dispatchDraft({ type: "update", fields, group: null });
  }

  async function saveDraft() {
    if (savePendingRef.current || !item || !hasDraftChanges || transitionState.pending) {
      return;
    }

    savePendingRef.current = true;
    const saveGeneration = ++saveGenerationRef.current;
    setIsSaving(true);
    setSaveError(null);
    dispatchDraft({ type: "close-group" });
    const detailItem = item;
    const submittedDraft = draft;
    suppressedSyncRef.current = { itemId: detailItem.id, generation: saveGeneration };
    const isCurrentSave = () =>
      activeItemIdRef.current === detailItem.id &&
      saveGenerationRef.current === saveGeneration;
    const patch = detailPatchForItem(detailItem, draft);
    try {
      if (Object.keys(patch).length > 0) {
        await controller.saveDetailItem(patch);
      }
      if (!isCurrentSave()) {
        return;
      }

      const transition = transitionActionForStatus(
        detailItem.status,
        draft.status,
        detailItem.type,
      );
      if (transition) {
        await controller.transitionWorkspaceItem(detailItem.id, transition);
      }
      if (isCurrentSave()) {
        pendingSaveRebaseRef.current = {
          itemId: detailItem.id,
          generation: saveGeneration,
          submittedDraft,
        };
        suppressedSyncRef.current = null;
      }
    } catch (cause) {
      if (isCurrentSave()) {
        setSaveError(
          cause instanceof RavenApiError
            ? cause.message
            : "Could not save detail.",
        );
      }
    } finally {
      if (isCurrentSave()) {
        savePendingRef.current = false;
        setIsSaving(false);
      }
    }
  }

  saveDraftRef.current = saveDraft;

  React.useEffect(() => {
    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (
        event.isComposing ||
        pendingNavigationRef.current ||
        event.altKey ||
        (!event.ctrlKey && !event.metaKey)
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "s" && !event.shiftKey) {
        event.preventDefault();
        void saveDraftRef.current();
      } else if (key === "z" && event.shiftKey) {
        event.preventDefault();
        dispatchDraft({ type: "redo" });
      } else if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        dispatchDraft({ type: "undo" });
      } else if (key === "y" && event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        dispatchDraft({ type: "redo" });
      }
    }

    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => document.removeEventListener("keydown", handleDocumentKeyDown);
  }, []);

  if (!item) {
    return null;
  }

  const detailItem = item;
  const groups = linkedItemGroups(detailItem, controller.workspaceItems.allItems);

  function cancelArchive() {
    if (archiveActionLockedRef.current) {
      return;
    }
    const cancelArchiveDialog = () => {
      archiveActionLockedRef.current = false;
      setArchiveActionLocked(false);
      setArchiveError(null);
      detailHistory.setDialogOpen(false);
      setArchiveDialogOpen(false);
    };
    if (detailHistory.deferUntilRestored(cancelArchiveDialog)) {
      archiveActionLockedRef.current = true;
      setArchiveActionLocked(true);
    } else {
      cancelArchiveDialog();
    }
  }

  function closeAfterArchive() {
    const closeArchivedDetail = () => {
      archiveActionLockedRef.current = false;
      setArchiveActionLocked(false);
      detailHistory.setDirty(false);
      detailHistory.setDialogOpen(false);
      setArchiveDialogOpen(false);
      controller.closeDetailView();
    };
    if (detailHistory.deferUntilRestored(closeArchivedDetail)) {
      archiveActionLockedRef.current = true;
      setArchiveActionLocked(true);
    } else {
      closeArchivedDetail();
    }
  }

  async function confirmArchive() {
    if (archiveActionLockedRef.current) {
      return;
    }
    setArchiveError(null);
    try {
      await controller.transitionWorkspaceItem(detailItem.id, "archive");
    } catch (cause) {
      setArchiveError(
        cause instanceof RavenApiError
          ? cause.message
          : "Could not archive item.",
      );
      return;
    }

    closeAfterArchive();
  }

  function openLinkedItem(nextItem: WorkspaceItemModel) {
    if (hasDraftChanges) {
      setPendingLinkedItem(nextItem);
      return;
    }

    controller.openDetailView(nextItem);
  }

  function discardPendingNavigation() {
    if (pendingLinkedItem) {
      const nextItem = pendingLinkedItem;
      const discardLinkedNavigation = () => {
        detailHistory.setDirty(false);
        detailHistory.setDialogOpen(false);
        controller.openDetailView(nextItem);
        setPendingLinkedItem(null);
      };
      if (!detailHistory.deferUntilRestored(discardLinkedNavigation)) {
        discardLinkedNavigation();
      }
    } else {
      detailHistory.discardBack();
    }
  }

  function cancelPendingNavigation() {
    if (pendingLinkedItem) {
      const cancelLinkedNavigation = () => {
        detailHistory.setDialogOpen(false);
        setPendingLinkedItem(null);
      };
      if (!detailHistory.deferUntilRestored(cancelLinkedNavigation)) {
        cancelLinkedNavigation();
      }
    } else {
      detailHistory.cancelBack();
    }
  }

  function handleLinkedItemNavigationDialogKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelPendingNavigation();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const activeElement = document.activeElement;
    const isCancelFocused = activeElement === cancelLinkedItemNavigationRef.current;
    const isDiscardFocused = activeElement === discardLinkedItemNavigationRef.current;

    if (event.shiftKey && isCancelFocused) {
      event.preventDefault();
      discardLinkedItemNavigationRef.current?.focus();
    } else if (!event.shiftKey && isDiscardFocused) {
      event.preventDefault();
      cancelLinkedItemNavigationRef.current?.focus();
    }
  }

  return (
    <section
      className="detail-view"
      aria-label={`${item.title} details`}
      onBlurCapture={() => dispatchDraft({ type: "close-group" })}
    >
      <header className="detail-header">
        <button
          type="button"
          className="detail-back"
          aria-label="< Back"
          onClick={detailHistory.requestBack}
        >
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <div className="detail-actions">
          <button
            type="button"
            aria-label="Undo"
            title="Undo (Ctrl/Cmd+Z)"
            disabled={draftHistory.past.length === 0}
            onClick={() => dispatchDraft({ type: "undo" })}
          >
            <Undo2 size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Redo"
            title="Redo (Ctrl/Cmd+Shift+Z or Ctrl+Y)"
            disabled={draftHistory.future.length === 0}
            onClick={() => dispatchDraft({ type: "redo" })}
          >
            <Redo2 size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Save"
            title="Save (Ctrl/Cmd+S)"
            disabled={!hasDraftChanges || isSaving || transitionState.pending}
            onClick={() => void saveDraft()}
          >
            <Save size={16} aria-hidden="true" />
          </button>
          {detailItem.status !== "archived" ? (
            <button
              ref={archiveButtonRef}
              type="button"
              aria-label="Archive"
              title="Archive"
              disabled={isSaving || transitionState.pending}
              onClick={() => {
                archiveActionLockedRef.current = false;
                setArchiveActionLocked(false);
                setArchiveError(null);
                setArchiveDialogOpen(true);
              }}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>
      {saveError ? <p role="alert">{saveError}</p> : null}
      <div className="detail-layout">
        <div className="detail-heading">
          <div className="detail-kicker">
            <span>{item.type}</span>
            <span>{item.status}</span>
          </div>
          <h1>{item.title}</h1>
        </div>
        <section className="detail-editor" aria-label="Edit properties">
          <div className="detail-properties">
            <h2 className="sr-only">Properties</h2>
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
                setFields={setFields}
                workspaceItems={controller.workspaceItems}
                controller={controller}
              />
            </div>
          </div>
        </section>
        {groups.length > 0 ? (
          <section className="linked-items" aria-label="Linked items">
            <h2>Linked items</h2>
            {groups.map((group) => (
              <LinkedItemTable
                key={`${detailItem.id}.${group.type}`}
                parentItem={detailItem}
                childType={group.type}
                childLabel={group.label}
                items={group.items}
                controller={controller}
                onOpen={openLinkedItem}
              />
            ))}
          </section>
        ) : null}
        <section className="detail-note" aria-label="Markdown note editor">
          <MarkdownNoteEditor
            value={draft.note}
            onChange={(value) => setField("note", value)}
          />
        </section>
      </div>
      {pendingNavigation ? (
        <div className="confirmation-backdrop">
          <section
            className="confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Discard unsaved changes?"
            onKeyDown={handleLinkedItemNavigationDialogKeyDown}
          >
            <h2>Discard unsaved changes?</h2>
            <p>Your changes will be lost if you leave this detail.</p>
            <div className="dialog-actions">
              <button
                ref={cancelLinkedItemNavigationRef}
                type="button"
                onClick={cancelPendingNavigation}
              >
                Cancel
              </button>
              <button
                ref={discardLinkedItemNavigationRef}
                type="button"
                onClick={discardPendingNavigation}
              >
                Discard changes
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {archiveDialogOpen ? (
        <DestructiveConfirmationDialog
          title={`Archive ${detailItem.title}?`}
          description={hasDraftChanges
            ? "Move this item to Archive? Unsaved changes will be discarded."
            : "Move this item to Archive?"}
          confirmLabel="Archive"
          error={archiveError}
          disabled={archiveActionLocked}
          fallbackFocusRef={archiveButtonRef}
          onCancel={cancelArchive}
          onConfirm={confirmArchive}
        />
      ) : null}
    </section>
  );
}

function LinkedItemTable({
  parentItem,
  childType,
  childLabel,
  items,
  controller,
  onOpen,
}: {
  parentItem: WorkspaceItemModel;
  childType: WorkspaceItemModel["type"];
  childLabel: string;
  items: WorkspaceItemModel[];
  controller: WorkbenchController;
  onOpen(item: WorkspaceItemModel): void;
}): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false);
  const scope = detailWorkspaceScope(parentItem.type, childType);
  const tabs = controller.workspaceTableTabs(scope);
  const settings = controller.workspaceTableSettings(scope);
  const groups = React.useMemo(
    () => deriveWorkspaceViewGroups(
      scope,
      items,
      settings,
      controller.workspaceItems.relatedItems,
    ),
    [
      controller.workspaceItems.relatedItems,
      items,
      scope,
      settings,
    ],
  );
  const collapsed = React.useMemo(
    () => collapseWorkspaceGroups(
      groups,
      expanded ? Number.MAX_SAFE_INTEGER : 5,
    ),
    [expanded, groups],
  );
  const filterOptions: PlannerFilterOptions = {
    ...plannerFilterOptionsForItems(
      items,
      controller.workspaceItems.relatedItems,
    ),
    storedRelationLabels: {
      area: controller.workspaceItems.relatedItems.areas,
      project: controller.workspaceItems.relatedItems.projects,
      routine: controller.workspaceItems.relatedItems.routines,
      parent: controller.workspaceItems.relatedItems.goals,
    },
  };
  const groupOptions = workspaceGroupOptionsForLinkedType(childType);
  const controlsAdapter: TableViewControlsAdapter = {
    scopeId: scope,
    title: childLabel,
    settings,
    filterFields: workspaceFilterFieldsForScope(scope),
    sortFields: workspaceSortFieldsForScope(scope),
    groupOptions,
    candidates: buildPlannerGroupCandidates({
      view: "daily",
      groupBy: settings.groupSettings.groupBy,
      items,
      relatedItems: controller.workspaceItems.relatedItems,
    }),
    filterOptions,
    activeControlsAriaLabel: `Active ${childLabel} controls`,
    dropdownIdPrefix: "linked",
    isDefaultSort: (rules) =>
      rules.length === 1 &&
      rules[0]?.field === "updated" &&
      rules[0]?.direction === "desc",
    update: (updater) => controller.updateWorkspaceTableSettings(scope, updater),
  };
  const viewVersion = JSON.stringify({
    activeTabId: tabs.activeTabId,
    settings: clonePlannerTableSettings(settings),
  });

  useEffect(() => setExpanded(false), [viewVersion]);

  return (
    <section className="linked-items-group">
      <header className="linked-items-group-header">
        <h3>
          {childLabel} · {items.length}
        </h3>
        <TableViewControls adapter={controlsAdapter} />
      </header>
      <TableViewTabs
        scopeId={scope}
        title={childLabel}
        controller={{
          tabs,
          isDirty: controller.workspaceTableIsDirty(scope),
          select: (tabId) => controller.selectWorkspaceTableTab(scope, tabId),
          save: () => controller.saveWorkspaceTableTab(scope),
          create: (name) => controller.createWorkspaceTableTab(scope, name),
          rename: (tabId, name) =>
            controller.renameWorkspaceTableTab(scope, tabId, name),
          requestDelete: (tabId) =>
            controller.requestDeleteWorkspaceTableTab(scope, tabId),
        }}
      />
      <TableViewActivePills adapter={controlsAdapter} />
      <table className="linked-items-table" aria-label={`${childLabel} linked items`}>
        <WorkspaceGroupedRows
          groups={collapsed.groups}
          bodyClassName="linked-items-table-body"
          emptyMessage="No linked items match this view."
          renderRow={(linkedItem) => (
            <tr key={linkedItem.id}>
              <td>
                <button
                  className="linked-items-row-button"
                  type="button"
                  aria-label={`Open ${linkedItem.title} details`}
                  onClick={() => onOpen(linkedItem)}
                >
                  <span>{linkedItem.title}</span>
                  <span>{linkedItem.status}</span>
                </button>
              </td>
            </tr>
          )}
        />
      </table>
      {collapsed.hiddenCount > 0 ? (
        <button
          className="linked-items-overflow-action"
          type="button"
          aria-label={`More (${collapsed.hiddenCount}) ${childLabel}`}
          onClick={() => setExpanded(true)}
        >
          More ({collapsed.hiddenCount})
        </button>
      ) : expanded && collapsed.visibleCount > 5 ? (
        <button
          className="linked-items-overflow-action"
          type="button"
          aria-label={`Less ${childLabel}`}
          onClick={() => setExpanded(false)}
        >
          Less
        </button>
      ) : null}
    </section>
  );
}

function isPlannerPanel(leafTabId: LeafTabId): boolean {
  return ["yearly", "monthly", "weekly", "daily"].includes(leafTabId);
}

function isLedgerPanel(leafTabId: LeafTabId): leafTabId is LedgerTabId {
  return ["transactions", "accounts", "categories", "reports"].includes(leafTabId);
}

function isHealthPanel(leafTabId: LeafTabId): leafTabId is HealthTabId {
  return [
    "diet",
    "bowel",
    "medication",
    "health-metrics",
    "reports",
  ].includes(leafTabId);
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
          Could not load ToDo items.
        </p>
      </section>
    );
  }

  return (
    <section
      className="items-section planner-panel"
      aria-label={`${panel.title} planner`}
    >
      <PlannerControlToolbar controller={controller} />
      {panel.id === "weekly" ? (
        <WeeklyPlanner controller={controller} />
      ) : null}
      {panel.id === "daily" ? (
        <DailyPlanner controller={controller} />
      ) : null}
      {panel.id === "yearly" ? (
        <YearlyPeriodPlanner controller={controller} />
      ) : null}
      {panel.id === "monthly" ? (
        <MonthlyPeriodPlanner controller={controller} />
      ) : null}
      {controller.creationDialogOpen ? (
        <CreationDialog controller={controller} />
      ) : null}
    </section>
  );
}

function YearlyPeriodPlanner({
  controller,
}: MainPanelProps) {
  const model = buildYearlyPeriodGoalCardsModel(
    controller.workspaceItems.items,
    controller.planner.date,
  );
  const periodGoalItems = model.carousel.flatMap((card) => card.goals);
  const monthGoalItems = model.months.flatMap((month) => month.goals);

  return (
    <div className="planner-period-panel">
      <section className="planner-section" aria-label="Yearly period goals">
        <PlannerTableHeader
          controller={controller}
          tableId="yearly.period-goals"
          title="Year Goals"
          heading="Year Goals"
          rawItems={periodGoalItems}
          creationContext={{
            tableId: "yearly.period-goals",
            itemTypes: ["goal"],
            scheduled: yearStart(controller.planner.date),
            horizon: "year",
            editableDate: false,
          }}
        />
        <PeriodGoalCarousel
          controller={controller}
          tableId="yearly.period-goals"
          groupUniverseItems={periodGoalItems}
          ariaLabel="Year goal carousel"
          previousLabel="Previous year"
          nextLabel="Next year"
          cards={model.carousel}
        />
      </section>
      <section className="planner-section" aria-label="Yearly month goals">
        <PlannerTableHeader
          controller={controller}
          tableId="yearly.month-goals"
          title="Month Goals"
          heading="Month Goals"
          rawItems={monthGoalItems}
          creationContext={{
            tableId: "yearly.month-goals",
            itemTypes: ["goal"],
            scheduled: `${model.selectedYear}-01-01`,
            horizon: "month",
            editableDate: true,
          }}
        />
        <div className="yearly-month-grid" aria-label="Month goals">
          {model.months.map((month) => (
            <PeriodGoalBucketCard
              controller={controller}
              tableId="yearly.month-goals"
              groupUniverseItems={monthGoalItems}
              bucket={month}
              testId="yearly-month-card"
              key={month.key}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function MonthlyPeriodPlanner({
  controller,
}: MainPanelProps) {
  const model = buildMonthlyPeriodGoalCardsModel(
    controller.workspaceItems.items,
    controller.planner.date,
  );
  const periodGoalItems = model.carousel.flatMap((card) => card.goals);
  const calendarItems = model.weeks.flatMap((week) =>
    week.days.flatMap((day) => day.items),
  );
  const weekGoalItems = model.weeks.flatMap((week) => week.goals);
  const [openOverflowDate, setOpenOverflowDate] = React.useState<string | null>(null);

  useEffect(() => {
    setOpenOverflowDate(null);
  }, [controller.planner.date]);

  return (
    <div className="planner-period-panel">
      <section className="planner-section" aria-label="Monthly period goals">
        <PlannerTableHeader
          controller={controller}
          tableId="monthly.period-goals"
          title="Month Goals"
          heading="Month Goals"
          rawItems={periodGoalItems}
          creationContext={{
            tableId: "monthly.period-goals",
            itemTypes: ["goal"],
            scheduled: model.selectedMonth,
            horizon: "month",
            editableDate: false,
          }}
        />
        <PeriodGoalCarousel
          controller={controller}
          tableId="monthly.period-goals"
          groupUniverseItems={periodGoalItems}
          ariaLabel="Month goal carousel"
          previousLabel="Previous month"
          nextLabel="Next month"
          cards={model.carousel}
        />
      </section>
      <div className="monthly-calendar-planner">
        <div className="monthly-calendar-table-headers">
          <section className="planner-section" aria-label="Monthly calendar controls">
            <PlannerTableHeader
              controller={controller}
              tableId="monthly.calendar"
              title="Calendar"
              heading="Calendar"
              rawItems={calendarItems}
              groupUniverseItems={calendarItems}
              creationContext={{
                tableId: "monthly.calendar",
                itemTypes: ["task", "event"],
                scheduled: model.selectedMonth,
                editableDate: true,
              }}
            />
          </section>
          <section className="planner-section" aria-label="Monthly week goal controls">
            <PlannerTableHeader
              controller={controller}
              tableId="monthly.week-goals"
              title="Week Goals"
              heading="Week Goals"
              rawItems={weekGoalItems}
              groupUniverseItems={weekGoalItems}
              creationContext={{
                tableId: "monthly.week-goals",
                itemTypes: ["goal"],
                scheduled: model.weeks[0]?.periodStart ?? model.selectedMonth,
                horizon: "week",
                editableDate: true,
              }}
            />
          </section>
        </div>
        <div className="monthly-calendar-grid" role="grid" aria-label="Monthly todo calendar">
          <div className="monthly-week-row monthly-weekday-row" role="row" aria-label="Monthly weekdays">
            <div className="monthly-week-days">
              {plannerWeekdayLabels.map((day) => (
                <span className="monthly-weekday" role="columnheader" key={day}>
                  {day}
                </span>
              ))}
            </div>
          </div>
          {model.weeks.map((week) => (
            <MonthlyPlannerWeekRow
              controller={controller}
              week={week}
              calendarUniverseItems={calendarItems}
              weekGoalUniverseItems={weekGoalItems}
              openOverflowDate={openOverflowDate}
              onOpenOverflowChange={setOpenOverflowDate}
              key={week.key}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function MonthlyPlannerWeekRow({
  controller,
  week,
  calendarUniverseItems,
  weekGoalUniverseItems,
  openOverflowDate,
  onOpenOverflowChange,
}: {
  controller: WorkbenchController;
  week: MonthlyPlannerWeekModel;
  calendarUniverseItems: WorkspaceItemModel[];
  weekGoalUniverseItems: WorkspaceItemModel[];
  openOverflowDate: string | null;
  onOpenOverflowChange: (date: string | null) => void;
}) {
  return (
    <section className="monthly-week-row" role="row" data-testid="monthly-week-row">
      <div className="monthly-week-days">
        {week.days.map((day) => {
          const dayGroups = applyPlannerTableSettings(
            day.items,
            "monthly.calendar",
            controller,
            controller.workspaceItems.relatedItems,
            controller.planner.date,
            calendarUniverseItems,
          );

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
                groups={dayGroups}
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
          tableId="monthly.week-goals"
          groupUniverseItems={weekGoalUniverseItems}
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
  groups,
  open,
  onOpenChange,
}: {
  controller: WorkbenchController;
  date: string;
  groups: DailyPlannerSection["groups"];
  open: boolean;
  onOpenChange: (date: string | null) => void;
}) {
  const entries = groups.flatMap((group) =>
    group.items.map((item, index) => ({
      groupKey: group.key,
      groupLabel: group.label !== "All" && index === 0 ? group.label : null,
      item,
    })),
  );
  const visibleEntries = entries.slice(0, 2);
  const hiddenCount = entries.length - visibleEntries.length;
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

    const firstInteractiveItem =
      popoverRef.current?.querySelector<HTMLElement>(".monthly-day-item") ??
      popoverRef.current?.querySelector<HTMLElement>(
        "button, input, select, textarea, [tabindex]:not([tabindex='-1'])",
      );
    firstInteractiveItem?.focus();

    function closeAndRestoreFocus() {
      onOpenChange(null);
      requestAnimationFrame(() => triggerRef.current?.focus());
    }

    function dismissOnOutsidePointer(event: MouseEvent) {
      if (!(event.target instanceof Node)) {
        return;
      }
      const targetElement = event.target instanceof Element
        ? event.target
        : event.target.parentElement;
      if (
        triggerRef.current?.contains(event.target) ||
        popoverRef.current?.contains(event.target) ||
        targetElement?.closest(".monthly-day-more")
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

  if (entries.length === 0) {
    return <p className="items-message monthly-day-empty">No items.</p>;
  }

  return (
    <ul className="monthly-day-item-list">
      {visibleEntries.map(({ groupKey, groupLabel, item }) => (
        <li key={`${groupKey}-${item.id}`}>
          {groupLabel ? <h4 className="monthly-day-group-heading">{groupLabel}</h4> : null}
          <PlannerItemRow controller={controller} item={item} tableId="monthly.calendar" compact />
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
                {entries.map(({ groupKey, groupLabel, item }) => (
                  <li key={`${groupKey}-${item.id}`}>
                    {groupLabel ? <h4 className="monthly-day-group-heading">{groupLabel}</h4> : null}
                    <PlannerItemRow controller={controller} item={item} tableId="monthly.calendar" compact />
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
  tableId,
  groupUniverseItems,
  ariaLabel,
  previousLabel,
  nextLabel,
  cards,
}: {
  controller: WorkbenchController;
  tableId: PlannerTableId;
  groupUniverseItems: WorkspaceItemModel[];
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
            <GoalGroupContent
              controller={controller}
              tableId={tableId}
              groupUniverseItems={groupUniverseItems}
              goals={card.goals}
              emptyText="No goals found."
            />
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
  tableId,
  groupUniverseItems,
  bucket,
  testId,
}: {
  controller: WorkbenchController;
  tableId: PlannerTableId;
  groupUniverseItems: WorkspaceItemModel[];
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
      <GoalGroupContent
        controller={controller}
        tableId={tableId}
        groupUniverseItems={groupUniverseItems}
        goals={bucket.goals}
        emptyText="No goals found."
      />
    </section>
  );
}

function GoalGroupContent({
  controller,
  tableId,
  groupUniverseItems,
  goals,
  emptyText,
}: {
  controller: WorkbenchController;
  tableId: PlannerTableId;
  groupUniverseItems: WorkspaceItemModel[];
  goals: WorkspaceItemModel[];
  emptyText: string;
}) {
  const groupedGoals = applyPlannerTableSettings(
    goals,
    tableId,
    controller,
    controller.workspaceItems.relatedItems,
    controller.planner.date,
    groupUniverseItems,
  );

  return <>{renderPlannerGroups(controller, tableId, groupedGoals, emptyText)}</>;
}

function WeeklyPlanner({
  controller,
}: MainPanelProps) {
  const model = buildWeeklyPlannerModel(
    controller.workspaceItems.items,
    controller.planner.weekStart,
  );
  const dayGridItems = model.days.flatMap((day) => day.items);
  const monthGoalGroups = applyPlannerTableSettings(
    model.monthGoals,
    "weekly.month-goals",
    controller,
    controller.workspaceItems.relatedItems,
    controller.planner.date,
  );
  const weekGoalGroups = applyPlannerTableSettings(
    model.weekGoals,
    "weekly.week-goals",
    controller,
    controller.workspaceItems.relatedItems,
    controller.planner.date,
  );

  return (
    <div className="planner-panel">
      <div className="planner-goal-grid">
        <section className="planner-section" aria-label="Weekly month goals">
          <PlannerTableHeader
            controller={controller}
            tableId="weekly.month-goals"
            title="Month Goals"
            heading="Goals for this month"
            rawItems={model.monthGoals}
            creationContext={{
              tableId: "weekly.month-goals",
              itemTypes: ["goal"],
              scheduled: monthStart(controller.planner.weekStart),
              horizon: "month",
              editableDate: false,
            }}
          />
          {renderPlannerGroups(controller, "weekly.month-goals", monthGoalGroups, "No goals found.")}
        </section>
        <section className="planner-section" aria-label="Weekly goals">
          <PlannerTableHeader
            controller={controller}
            tableId="weekly.week-goals"
            title="Week Goals"
            heading="Goals for this week"
            rawItems={model.weekGoals}
            creationContext={{
              tableId: "weekly.week-goals",
              itemTypes: ["goal"],
              scheduled: controller.planner.weekStart,
              horizon: "week",
              editableDate: false,
            }}
          />
          {renderPlannerGroups(controller, "weekly.week-goals", weekGoalGroups, "No goals found.")}
        </section>
      </div>
      <section className="planner-section" aria-label="Weekly weekday grid">
        <PlannerTableHeader
          controller={controller}
          tableId="weekly.day-grid"
          title="Weekday grid"
          heading="Weekday grid"
          rawItems={dayGridItems}
          groupUniverseItems={dayGridItems}
          creationContext={{
            tableId: "weekly.day-grid",
            itemTypes: ["task", "event"],
            scheduled: controller.planner.weekStart,
            editableDate: true,
          }}
        />
        <div className="weekly-day-grid">
          {model.days.map((day) => {
            const dayGroups = applyPlannerTableSettings(
              day.items,
              "weekly.day-grid",
              controller,
              controller.workspaceItems.relatedItems,
              controller.planner.date,
              dayGridItems,
            );

            return (
              <section
                className="planner-card"
                key={day.date}
                data-testid="weekly-day-card"
              >
                <h3>{day.label}</h3>
                {renderPlannerGroups(controller, "weekly.day-grid", dayGroups, "No scheduled items.")}
              </section>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function DailyPlanner({
  controller,
}: MainPanelProps) {
  const rawSections = buildDailyPlannerSections(
    controller.workspaceItems.items,
    controller.planner.date,
  );
  const dateTitle = plannerDateLabel(controller.planner.date);

  return (
    <div className="planner-panel daily-planner">
      <div className="daily-planner-scheduled-grid" aria-label="Scheduled daily work">
        <DailyPlannerSectionView
          controller={controller}
          tableId="daily.today"
          controlTitle="Today"
          title={dateTitle}
          rawItems={rawSections.today}
          creationContext={{
            tableId: "daily.today",
            itemTypes: ["task", "event"],
            scheduled: controller.planner.date,
            editableDate: false,
          }}
        />
        <DailyPlannerSectionView
          controller={controller}
          tableId="daily.overdue"
          controlTitle="Before"
          title={`Before ${dateTitle}`}
          rawItems={rawSections.overdue}
          creationContext={{
            tableId: "daily.overdue",
            itemTypes: ["task", "event"],
            scheduled: addLocalDays(controller.planner.date, -1),
            editableDate: false,
          }}
        />
      </div>
      <DailyPlannerSectionView
        controller={controller}
        tableId="daily.unscheduled"
        controlTitle="Unscheduled"
        title="Unscheduled"
        rawItems={rawSections.unscheduled}
        creationContext={{
          tableId: "daily.unscheduled",
          itemTypes: ["task"],
          scheduled: "",
          editableDate: false,
        }}
      />
    </div>
  );
}

function PlannerControlToolbar({
  controller,
}: {
  controller: WorkbenchController;
}) {
  const nowDisabled = plannerPeriodMatchesToday(controller);
  const showPeriodNavigation =
    controller.panel.id === "monthly" ||
    controller.panel.id === "weekly" ||
    controller.panel.id === "daily";

  return (
    <div className="planner-view-controls">
      <div className="planner-view-control-bar">
        <div className="planner-view-leading">
          <div className="planner-view-pill">{controller.panel.title}</div>
          {showPeriodNavigation ? <PlannerPeriodNavigation controller={controller} /> : null}
        </div>
        <div className="planner-view-actions">
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
        </div>
      </div>
    </div>
  );
}

function PlannerTableHeader({
  controller,
  tableId,
  title,
  heading,
  rawItems,
  groupUniverseItems = rawItems,
  creationContext,
}: {
  controller: WorkbenchController;
  tableId: PlannerTableId;
  title: string;
  heading: string;
  rawItems: WorkspaceItemModel[];
  groupUniverseItems?: WorkspaceItemModel[];
  creationContext: PlannerCreationSourceContext;
}) {
  const settings = controller.plannerTableSettings(tableId);
  const filterOptions: PlannerFilterOptions = {
    ...plannerFilterOptionsForItems(
      rawItems,
      controller.workspaceItems.relatedItems,
    ),
    storedRelationLabels: {
      area: controller.workspaceItems.relatedItems.areas,
      project: controller.workspaceItems.relatedItems.projects,
      routine: controller.workspaceItems.relatedItems.routines,
      parent: controller.workspaceItems.relatedItems.goals,
    },
  };
  const filterFields = plannerFilterFieldsForTable(tableId);
  const sortFields = plannerSortFieldsForTable(tableId);
  const groupOptions = plannerGroupOptionsForTable(tableId);
  const candidates = plannerTableGroupCandidates(
    tableId,
    settings.groupSettings,
    groupUniverseItems,
    controller.workspaceItems.relatedItems,
  );
  const effectiveFilterRules = effectivePlannerFilterRules(
    settings.filterRules,
    filterFields,
  );
  const controlsAdapter: TableViewControlsAdapter = {
    scopeId: tableId,
    title,
    settings,
    filterFields,
    sortFields,
    groupOptions,
    candidates,
    filterOptions,
    activeControlsAriaLabel: "Active planner controls",
    dropdownIdPrefix: "planner",
    isDefaultSort: (rules) => {
      const defaultField = tableId.startsWith("daily.") ? "priority" : "scheduled";
      return rules.length === 1 &&
        rules[0]?.field === defaultField &&
        rules[0]?.direction === "asc";
    },
    missSuccessFocusTarget: tableId,
    update: (updater) => controller.updatePlannerTableSettings(tableId, updater),
    add: () => controller.openPlannerCreationDialog({
      ...creationContext,
      tableSettings: {
        ...settings,
        filterRules: effectiveFilterRules,
      },
    }),
  };

  return (
    <header className="planner-table-header">
      <div className="planner-table-header-row">
        <h2>{heading}</h2>
        <TableViewControls adapter={controlsAdapter} />
      </div>
      <PlannerTableTabs controller={controller} tableId={tableId} title={title} />
      <TableViewActivePills adapter={controlsAdapter} />
    </header>
  );
}

function PlannerPeriodNavigation({ controller }: { controller: WorkbenchController }) {
  const isMonthly = controller.panel.id === "monthly";
  if (!isMonthly && controller.panel.id !== "weekly" && controller.panel.id !== "daily") {
    return null;
  }

  const isWeekly = controller.panel.id === "weekly";
  const previousLabel = isMonthly ? "Previous month" : isWeekly ? "Previous week" : "Previous day";
  const nextLabel = isMonthly ? "Next month" : isWeekly ? "Next week" : "Next day";
  const dialogLabel = isMonthly
    ? "Choose Monthly date"
    : isWeekly
      ? "Choose Weekly date"
      : "Choose Daily date";

  return (
    <div className="planner-period-navigation" role="group" aria-label="Planner period navigation">
      <button
        className="items-toolbar-button"
        type="button"
        aria-label={previousLabel}
        onClick={() => controller.movePlannerPeriod(-1)}
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      {isMonthly ? (
        <PlannerMonthPicker controller={controller} dialogLabel={dialogLabel} />
      ) : (
        <PlannerDatePicker controller={controller} dialogLabel={dialogLabel} />
      )}
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

function PlannerMonthPicker({
  controller,
  dialogLabel,
}: {
  controller: WorkbenchController;
  dialogLabel: string;
}) {
  const selected = monthStart(controller.planner.date);
  const [year, month] = selected.slice(0, 7).split("-");
  const controlRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = React.useState(false);
  const [popoverStyle, setPopoverStyle] = React.useState<React.CSSProperties | null>(null);
  const shouldRestoreFocusRef = useRef(false);

  useEffect(() => {
    if (!isOpen) return;

    function dismissOnOutsidePointer(event: MouseEvent) {
      if (!(event.target instanceof Node)) return;
      if (controlRef.current?.contains(event.target) || popoverRef.current?.contains(event.target)) {
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
      if (!trigger || !popover) return;
      setPopoverStyle(goalPeriodPopoverStyle(trigger, popover));
    }

    updatePopoverPosition();
    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
    };
  }, [isOpen, selected]);

  useEffect(() => {
    if (!isOpen) {
      setPopoverStyle(null);
      if (shouldRestoreFocusRef.current) {
        shouldRestoreFocusRef.current = false;
        triggerRef.current?.focus();
      }
      return;
    }

    popoverRef.current?.querySelector<HTMLElement>("select")?.focus();
  }, [isOpen]);

  function close(restoreFocus: boolean) {
    shouldRestoreFocusRef.current = restoreFocus;
    setIsOpen(false);
  }

  function commit(nextYear: string, nextMonth: string) {
    controller.selectPlannerPeriodDate(`${nextYear}-${nextMonth}-01`);
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
        <span>{monthLabel(selected)}</span>
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
              <div className="planner-month-picker-fields">
                <label className="field-label">
                  Year
                  <select value={year} onChange={(event) => commit(event.target.value, month)}>
                    {goalYearOptions(Number(year)).map((option) => (
                      <option value={option} key={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-label">
                  Month
                  <select value={month} onChange={(event) => commit(year, event.target.value)}>
                    {Array.from({ length: 12 }, (_, index) => {
                      const value = String(index + 1).padStart(2, "0");
                      return (
                        <option value={value} key={value}>
                          {value}
                        </option>
                      );
                    })}
                  </select>
                </label>
              </div>
            </div>,
            document.body,
          )
        : null}
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

type DailyFilterOption = {
  value: string;
  label: string;
};

function filterOptionsForItems(
  items: WorkspaceItemModel[],
  relatedItems: WorkspaceItemsModel["relatedItems"],
): PlannerFilterOptionSet {
  return {
    tags: toFilterOptions(items.flatMap((item) => item.tags ?? [])),
    areas: relationFilterOptions(items, relatedItems.areas, "area_id"),
    projects: relationFilterOptions(items, relatedItems.projects, "project_id"),
    currencies: [],
    routines: relationFilterOptions(items, relatedItems.routines, "routine_id"),
    statuses: toFilterOptions([...items.map((item) => item.status), "missed"]),
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

function plannerGroupOptionsForTable(
  tableId: PlannerTableId,
): { value: PlannerGroupBy; label: string }[] {
  if (tableId.endsWith("goals")) {
    return goalPlannerGroupOptions;
  }

  return plannerGroupOptions(tableId.split(".")[0] as WorkbenchController["panel"]["id"]);
}

function effectivePlannerTableGroupValue(
  tableId: PlannerTableId,
  value: PlannerGroupBy,
): PlannerGroupBy {
  return plannerGroupOptionsForTable(tableId).some((option) => option.value === value)
    ? value
    : "none";
}

function plannerTableGroupCandidates(
  tableId: PlannerTableId,
  settings: PlannerGroupSettings,
  items: WorkspaceItemModel[],
  relatedItems: WorkspaceItemsModel["relatedItems"],
): PlannerGroupCandidate[] {
  return buildPlannerGroupCandidates({
    view: tableId.split(".")[0] as "yearly" | "monthly" | "weekly" | "daily",
    groupBy: effectivePlannerTableGroupValue(tableId, settings.groupBy),
    items,
    relatedItems,
  });
}

function plannerGroupOptions(
  panelId: WorkbenchController["panel"]["id"],
): { value: PlannerGroupBy; label: string }[] {
  if (panelId === "yearly" || panelId === "monthly") {
    return goalPlannerGroupOptions;
  }

  return workPlannerGroupOptions;
}

const goalPlannerGroupOptions: { value: PlannerGroupBy; label: string }[] = [
  { value: "none", label: "None" },
  { value: "tag", label: "Tag" },
  { value: "status", label: "Status" },
];

const workPlannerGroupOptions: { value: PlannerGroupBy; label: string }[] = [
  { value: "none", label: "None" },
  { value: "area", label: "Area" },
  { value: "project", label: "Project" },
  { value: "routine", label: "Routine" },
  { value: "tag", label: "Tag" },
  { value: "item_type", label: "Item type" },
  { value: "status", label: "Status" },
];

function effectivePlannerTableFilterRules(
  controller: WorkbenchController,
  tableId: PlannerTableId,
): PlannerFilterRule[] {
  const settings = controller.plannerTableSettings(tableId);

  return effectivePlannerFilterRules(
    settings.filterRules,
    plannerFilterFieldsForTable(tableId),
  );
}

function plannerFilterOptionsForItems(
  items: WorkspaceItemModel[],
  relatedItems: WorkspaceItemsModel["relatedItems"],
): PlannerFilterOptions {
  const daily = filterOptionsForItems(items, relatedItems);
  return { tags: daily.tags, daily };
}

function applyPlannerTableSettings(
  rawItems: WorkspaceItemModel[],
  tableId: PlannerTableId,
  controller: WorkbenchController,
  relatedItems: WorkspaceItemsModel["relatedItems"],
  date: string,
  tableUniverseItems: WorkspaceItemModel[] = rawItems,
): DailyPlannerSection["groups"] {
  const settings = controller.plannerTableSettings(tableId);
  const filtered = filterPlannerItemsByRules(
    rawItems,
    relatedItems,
    effectivePlannerTableFilterRules(controller, tableId),
    settings.filterMode,
    date,
  );
  const sorted = sortPlannerItems(filtered, settings.sortRules);
  const groupSettings = {
    ...settings.groupSettings,
    groupBy: effectivePlannerTableGroupValue(tableId, settings.groupSettings.groupBy),
  };

  return groupPlannerItems(
    sorted,
    relatedItems,
    groupSettings,
    plannerTableGroupCandidates(tableId, groupSettings, tableUniverseItems, relatedItems),
  );
}

function isTerminalPlannerItem(item: WorkspaceItemModel): boolean {
  return (
    item.status === "completed" ||
    item.status === "missed" ||
    item.status === "archived" ||
    item.status === "dropped" ||
    item.status === "cancelled"
  );
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
  tableId,
  controlTitle,
  title,
  rawItems,
  creationContext,
}: {
  controller: WorkbenchController;
  tableId: PlannerTableId;
  controlTitle: string;
  title: string;
  rawItems: WorkspaceItemModel[];
  creationContext: PlannerCreationSourceContext;
}) {
  const groups = applyPlannerTableSettings(
    rawItems,
    tableId,
    controller,
    controller.workspaceItems.relatedItems,
    controller.planner.date,
  );

  return (
    <section className="planner-section" aria-label={title}>
      <PlannerTableHeader
        controller={controller}
        tableId={tableId}
        title={controlTitle}
        heading={title}
        rawItems={rawItems}
        creationContext={creationContext}
      />
      {renderPlannerGroups(controller, tableId, groups, "No items found.")}
    </section>
  );
}

function renderPlannerGroups(
  controller: WorkbenchController,
  tableId: PlannerTableId,
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
            <PlannerItemRow controller={controller} item={item} tableId={tableId} />
          </li>
        ))}
      </ul>
    </div>
  ));
}

function PlannerItemRow({
  controller,
  item,
  tableId,
  compact = false,
}: {
  controller: WorkbenchController;
  item: WorkspaceItemModel;
  tableId: PlannerTableId;
  compact?: boolean;
}) {
  const transitionState = controller.workspaceItemTransitionState(item.id);
  const usesSingleLineTitle = tableId.startsWith("weekly.") && !compact;

  return (
    <div
      className={`planner-item-row${item.status === "completed" ? " is-completed" : ""}${compact ? " is-compact" : ""}`}
    >
      <PlannerCompletionCheckbox controller={controller} item={item} />
      <PlannerMissButton controller={controller} item={item} tableId={tableId} />
      <button
        className={`${compact ? "monthly-day-item" : "planner-item"}${
          usesSingleLineTitle ? " weekly-single-line-title" : ""
        }`}
        type="button"
        title={compact ? item.title : undefined}
        onMouseEnter={usesSingleLineTitle
          ? (event) => syncOverflowTitle(event, item.title)
          : undefined}
        onClick={() => controller.openDetailView(item)}
      >
        {item.title}
      </button>
      {transitionState.error
        ? <span className="planner-task-error" role="alert">{transitionState.error}</span>
        : null}
    </div>
  );
}

function syncOverflowTitle(
  event: React.MouseEvent<HTMLButtonElement>,
  title: string,
): void {
  const button = event.currentTarget;
  if (button.scrollWidth > button.clientWidth) {
    button.title = title;
  } else {
    button.removeAttribute("title");
  }
}

function PlannerCompletionCheckbox({
  controller,
  item,
}: {
  controller: WorkbenchController;
  item: WorkspaceItemModel;
}) {
  const checkableType = item.type === "task" || item.type === "event";
  const visible = checkableType &&
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
    <input
      aria-label={label}
      checked={checked}
      className="planner-task-checkbox"
      disabled={transitionState.pending}
      type="checkbox"
      onChange={transition}
    />
  );
}

function PlannerMissButton({
  controller,
  item,
  tableId,
}: {
  controller: WorkbenchController;
  item: WorkspaceItemModel;
  tableId: PlannerTableId;
}) {
  const [open, setOpen] = React.useState(false);
  const [postponeDate, setPostponeDate] = React.useState(browserTomorrow);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const postponeDateRef = useRef<HTMLInputElement>(null);
  const markMissedRef = useRef<HTMLButtonElement>(null);
  const postponeRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const visible =
    (item.type === "task" || item.type === "event") &&
    item.status === "active";
  const transitionState = controller.workspaceItemTransitionState(item.id);
  const minimumPostponeDate = browserTomorrow();
  const canPostpone = postponeDate >= minimumPostponeDate;

  useEffect(() => {
    if (open) markMissedRef.current?.focus();
  }, [open]);

  if (!visible) return null;

  function openDialog() {
    setPostponeDate(browserTomorrow());
    setOpen(true);
  }

  function closeDialog() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  async function submit(action: "miss" | "postpone") {
    if (transitionState.pending) return;
    try {
      if (action === "miss") {
        await controller.missWorkspaceItem(item.id);
      } else {
        await controller.postponeWorkspaceItem(item.id, postponeDate);
      }
      setOpen(false);
      requestAnimationFrame(() => {
        document
          .querySelector<HTMLButtonElement>(
            `[data-planner-miss-success-focus="${tableId}"]`,
          )
          ?.focus();
      });
    } catch {
      // The shared transition state renders the API error inside the dialog.
    }
  }

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!transitionState.pending) closeDialog();
      return;
    }
    if (event.key !== "Tab") return;

    const controls = [
      postponeDateRef.current,
      markMissedRef.current,
      postponeRef.current,
      cancelRef.current,
    ].filter(
      (control): control is HTMLInputElement | HTMLButtonElement => control !== null,
    );
    if (controls.length === 0) return;
    const currentIndex = controls.indexOf(
      document.activeElement as HTMLInputElement | HTMLButtonElement,
    );
    if (event.shiftKey && currentIndex === 0) {
      event.preventDefault();
      controls.at(-1)?.focus();
    } else if (!event.shiftKey && currentIndex === controls.length - 1) {
      event.preventDefault();
      controls[0]?.focus();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="planner-miss-button"
        aria-label={`Miss ${item.title}`}
        title={`Miss ${item.title}`}
        disabled={transitionState.pending}
        onClick={openDialog}
      >
        Miss
      </button>
      {open
        ? createPortal(
            <div className="confirmation-backdrop planner-miss-backdrop">
              <section
                className="confirmation-dialog planner-miss-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={`Miss ${item.title}?`}
                aria-busy={transitionState.pending}
                onKeyDown={handleDialogKeyDown}
              >
                <h2>Miss {item.title}?</h2>
                <p>Mark this scheduled work as missed, or create a follow-up for the chosen date.</p>
                <label className="field-label">
                  Postpone date
                  <input
                    ref={postponeDateRef}
                    type="date"
                    value={postponeDate}
                    min={minimumPostponeDate}
                    disabled={transitionState.pending}
                    onChange={(event) => setPostponeDate(event.target.value)}
                  />
                </label>
                {transitionState.pending
                  ? <p className="planner-miss-progress" role="status">Updating missed work…</p>
                  : null}
                {transitionState.error
                  ? <p className="planner-miss-error" role="alert">{transitionState.error}</p>
                  : null}
                <div className="dialog-actions">
                  <button
                    ref={markMissedRef}
                    type="button"
                    disabled={transitionState.pending}
                    onClick={() => void submit("miss")}
                  >
                    Mark missed
                  </button>
                  <button
                    ref={postponeRef}
                    type="button"
                    disabled={transitionState.pending || !canPostpone}
                    onClick={() => void submit("postpone")}
                  >
                    Miss and postpone
                  </button>
                  <button
                    ref={cancelRef}
                    type="button"
                    disabled={transitionState.pending}
                    onClick={closeDialog}
                  >
                    Cancel
                  </button>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function browserTomorrow(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return formatDateForPlanner(tomorrow);
}

type DetailDraft = {
  title: string;
  status: string;
  tags: string;
  area: string;
  project_id: string;
  routine_id: string;
  parent_id: string;
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

type DetailDraftHistory = {
  itemId: string | null;
  past: DetailDraft[];
  present: DetailDraft;
  future: DetailDraft[];
  activeGroup: keyof DetailDraft | null;
};

type DetailDraftHistoryAction =
  | { type: "sync-item"; itemId: string | null; draft: DetailDraft }
  | {
      type: "rebase-saved-item";
      itemId: string;
      itemType: WorkspaceItemModel["type"];
      submittedDraft: DetailDraft;
      canonicalDraft: DetailDraft;
    }
  | {
      type: "update";
      fields: Partial<DetailDraft>;
      group: keyof DetailDraft | null;
    }
  | { type: "close-group" }
  | { type: "undo" }
  | { type: "redo" };

const continuousDetailDraftFields: (keyof DetailDraft)[] = [
  "title",
  "note",
  "outcome",
  "definition_of_done",
  "location",
  "participants",
  "commitment_type",
  "standard",
];

function initialDetailDraftHistory(item: WorkspaceItemModel | null): DetailDraftHistory {
  return {
    itemId: item?.id ?? null,
    past: [],
    present: detailDraftForItem(item),
    future: [],
    activeGroup: null,
  };
}

function detailDraftHistoryReducer(
  state: DetailDraftHistory,
  action: DetailDraftHistoryAction,
): DetailDraftHistory {
  if (action.type === "sync-item") {
    if (action.itemId === state.itemId) {
      return { ...state, present: action.draft, activeGroup: null };
    }
    return {
      itemId: action.itemId,
      past: [],
      present: action.draft,
      future: [],
      activeGroup: null,
    };
  }

  if (action.type === "rebase-saved-item") {
    if (action.itemId !== state.itemId) {
      return state;
    }
    const rebase = (snapshot: DetailDraft) =>
      rebaseDetailDraft(
        snapshot,
        action.submittedDraft,
        action.canonicalDraft,
        action.itemType,
      );
    return {
      ...state,
      past: state.past.map(rebase),
      present: rebase(state.present),
      future: state.future.map(rebase),
    };
  }

  if (action.type === "update") {
    const present = { ...state.present, ...action.fields };
    if (sameDetailDraft(state.present, present)) {
      return state;
    }
    if (action.group !== null && action.group === state.activeGroup) {
      return { ...state, present, future: [] };
    }
    return {
      ...state,
      past: [...state.past, state.present],
      present,
      future: [],
      activeGroup: action.group,
    };
  }

  if (action.type === "close-group") {
    return state.activeGroup === null ? state : { ...state, activeGroup: null };
  }

  if (action.type === "undo") {
    const present = state.past.at(-1);
    return present
      ? {
          ...state,
          past: state.past.slice(0, -1),
          present,
          future: [state.present, ...state.future],
          activeGroup: null,
        }
      : state;
  }

  const present = state.future[0];
  return present
    ? {
        ...state,
        past: [...state.past, state.present],
        present,
        future: state.future.slice(1),
        activeGroup: null,
      }
    : state;
}

function sameDetailDraft(left: DetailDraft, right: DetailDraft): boolean {
  return (Object.keys(left) as (keyof DetailDraft)[]).every(
    (field) => left[field] === right[field],
  );
}

function rebaseDetailDraft(
  snapshot: DetailDraft,
  submitted: DetailDraft,
  canonical: DetailDraft,
  itemType: WorkspaceItemModel["type"],
): DetailDraft {
  const rebased = (Object.keys(snapshot) as (keyof DetailDraft)[]).reduce(
    (rebased, field) => ({
      ...rebased,
      [field]: snapshot[field] === submitted[field] ? canonical[field] : snapshot[field],
    }),
    {} as DetailDraft,
  );
  if (
    rebased.status !== canonical.status &&
    !canPersistDetailStatusHistory(canonical.status, rebased.status, itemType)
  ) {
    rebased.status = canonical.status;
  }
  return rebased;
}

function canPersistDetailStatusHistory(
  canonicalStatus: string,
  historicalStatus: string,
  itemType: WorkspaceItemModel["type"],
): boolean {
  if (canonicalStatus === "completed") {
    return historicalStatus === "active" && (itemType === "task" || itemType === "event");
  }
  if (
    canonicalStatus === "missed" ||
    canonicalStatus === "archived" ||
    canonicalStatus === "dropped" ||
    canonicalStatus === "cancelled" ||
    canonicalStatus === "rejected"
  ) {
    return false;
  }
  return transitionActionForStatus(canonicalStatus, historicalStatus, itemType) !== null;
}

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
    note: item?.note ?? "",
    outcome: item?.outcome ?? "",
    horizon: item?.horizon ?? "month",
    definition_of_done: item?.definition_of_done ?? "",
    review_cycle: item?.review_cycle ?? "",
    standard: item?.standard ?? "",
    recurrence_rule:
      item?.type === "routine" ? item.recurrence_rule ?? "RRULE:FREQ=DAILY" : "",
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
    addPriorityPatch(patch, draft.priority, item.priority);
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
    transitionActionForStatus(detailStatusForItem(item), draft.status, item.type) !== null
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

function relatedItemsForDetail(
  items: WorkspaceItemModel[],
  relatedItems: WorkspaceItemsModel["relatedItems"],
): WorkspaceItemsModel["relatedItems"] {
  return {
    areas: { ...relatedItems.areas, ...detailTitlesByType(items, "area") },
    goals: { ...relatedItems.goals, ...detailTitlesByType(items, "goal") },
    projects: { ...relatedItems.projects, ...detailTitlesByType(items, "project") },
    routines: { ...relatedItems.routines, ...detailTitlesByType(items, "routine") },
  };
}

function detailTitlesByType(items: WorkspaceItemModel[], type: string): Record<string, string> {
  return Object.fromEntries(
    items
      .filter((item) => item.type === type)
      .map((item) => [item.id, item.title]),
  );
}

function DetailTypeFields({
  item,
  draft,
  setField,
  setFields,
  workspaceItems,
  controller,
}: {
  item: WorkspaceItemModel;
  draft: DetailDraft;
  setField: (field: keyof DetailDraft, value: string) => void;
  setFields: (fields: Partial<DetailDraft>) => void;
  workspaceItems: WorkspaceItemsModel;
  controller: WorkbenchController;
}) {
  const detailRelatedItems = relatedItemsForDetail(
    workspaceItems.allItems,
    workspaceItems.relatedItems,
  );

  if (item.type === "project") {
    return (
      <>
        <DetailRelationField
          label="Area"
          controlLabel={`Area for ${item.title}`}
          value={draft.area}
          options={detailRelatedItems.areas}
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
          options={detailRelatedItems.areas}
          onChange={(area) => setField("area", area)}
        />
        <DetailRelationField
          label="Project"
          controlLabel={`Project for ${item.title}`}
          value={draft.project_id}
          options={detailRelatedItems.projects}
          allowNone
          onChange={(project_id) => setField("project_id", project_id)}
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
        <RoutineMaterializeField item={item} controller={controller} />
        <DetailPriorityField
          label="Priority"
          value={draft.priority}
          onChange={(value) => setField("priority", value)}
        />
        <DetailTimestamps item={item} />
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
          options={detailRelatedItems.areas}
          onChange={(area) => setField("area", area)}
        />
        <DetailRelationField
          label="Project"
          controlLabel={`Project for ${item.title}`}
          value={draft.project_id}
          options={detailRelatedItems.projects}
          allowNone
          onChange={(project_id) => setField("project_id", project_id)}
        />
        <div className="property-row">
          <span>Routine</span>
          <span>{relatedTitle(detailRelatedItems.routines, item.routine_id)}</span>
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
          options={detailRelatedItems.areas}
          onChange={(area) => setField("area", area)}
        />
        <DetailRelationField
          label="Project"
          controlLabel={`Project for ${item.title}`}
          value={draft.project_id}
          options={detailRelatedItems.projects}
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
              setFields({ horizon, scheduled });
            }}
          />
        </div>
        <DetailRelationField
          label="Parent"
          controlLabel={`Parent for ${item.title}`}
          value={draft.parent_id}
          options={detailRelatedItems.goals}
          allowNone
          onChange={(parent_id) => setField("parent_id", parent_id)}
        />
        <DetailTimestamps item={item} />
      </>
    );
  }

  return null;
}

function validFutureOccurrences(value: string): boolean {
  const count = Number(value);
  return (
    value.trim() !== "" &&
    Number.isInteger(count) &&
    count >= 1 &&
    count <= MAX_FUTURE_OCCURRENCES
  );
}

function RoutineMaterializeField({
  item,
  controller,
}: {
  item: WorkspaceItemModel;
  controller: WorkbenchController;
}) {
  const [futureOccurrences, setFutureOccurrences] = React.useState(
    (item.future_occurrences ?? DEFAULT_FUTURE_OCCURRENCES).toString(),
  );
  const [pending, setPending] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setFutureOccurrences(
      (item.future_occurrences ?? DEFAULT_FUTURE_OCCURRENCES).toString(),
    );
    setStatus(null);
    setError(null);
  }, [item.id]);

  const targetReady = validFutureOccurrences(futureOccurrences);

  async function materialize() {
    const target: MaterializeRoutineTarget = {
      future_occurrences: Number(futureOccurrences),
    };
    setPending(true);
    setStatus(null);
    setError(null);
    try {
      const created = await controller.materializeRoutine(item.id, target);
      setStatus(
        created.length === 0
          ? "No new tasks for this window"
          : `Created ${created.length} task${created.length === 1 ? "" : "s"}`,
      );
    } catch (cause) {
      setError(
        cause instanceof RavenApiError
          ? cause.message
          : "Could not materialize routine.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="property-row">
      <span>Materialize</span>
      <div className="materialize-fields">
        <label className="field-label materialize-field">
          Future occurrences
          <input
            type="number"
            min={1}
            max={MAX_FUTURE_OCCURRENCES}
            step={1}
            value={futureOccurrences}
            onChange={(event) => setFutureOccurrences(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="materialize-button"
          disabled={pending || !targetReady}
          onClick={() => void materialize()}
        >
          {pending ? "Materializing…" : "Materialize"}
        </button>
        {error ? (
          <span className="materialize-error" role="alert">
            {error}
          </span>
        ) : status ? (
          <span className="materialize-status">{status}</span>
        ) : null}
      </div>
    </div>
  );
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
  parentHorizon?: string | null;
  onCommit: (period: { horizon: GoalHorizon; scheduled: string }) => void | Promise<void>;
  editable?: boolean;
  lockHorizon?: boolean;
};

type GoalPeriodCommitError = {
  attemptedHorizon: GoalHorizon;
  parentHorizon?: GoalHorizon;
};

function GoalPeriodControl({
  label,
  horizon,
  scheduled,
  parentHorizon,
  onCommit,
  editable = true,
  lockHorizon = false,
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
      if (error instanceof RavenApiError) {
        close(false);
        setCommitError({
          attemptedHorizon: candidateHorizon,
          parentHorizon: isGoalHorizon(parentHorizon) ? parentHorizon : undefined,
        });
        return;
      }

      throw error;
    }
  }

  const requestedHorizon = commitError?.attemptedHorizon;
  const commitErrorTitle = requestedHorizon
    ? `${goalHorizonLabel(requestedHorizon)}로 변경할 수 없음`
    : "";
  const commitErrorMessage = goalPeriodCommitErrorMessage(commitError);

  if (!editable) {
    const range = goalPeriodRange(safeHorizon, safeScheduled);
    return (
      <div className="goal-period-control" role="group" aria-label={label}>
        <span className="goal-period-trigger">
          {goalPeriodTriggerLabel(safeHorizon, safeScheduled)}
        </span>
        <p className="goal-period-range">
          {range.start} to {range.end}
        </p>
      </div>
    );
  }

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
            {!lockHorizon ? (
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
            ) : null}

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

  if (commitError.parentHorizon) {
    return `현재 Parent 기간은 ${goalHorizonLabel(commitError.parentHorizon)}이고, 요청한 Goal 기간은 ${goalHorizonLabel(commitError.attemptedHorizon)}입니다. Goal은 Parent보다 더 작은 기간만 사용할 수 있습니다.`;
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
              } else if (interval === "") {
                onChange("");
              }
            }}
            onBlur={() => {
              if (!validRecurrenceInterval(intervalDraft)) {
                setIntervalDraft("1");
                if (intervalDraft !== "") {
                  onChange(formatRecurrenceRule({ ...parsed, interval: "1" }));
                }
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
  const panelId = controller.panel.id;
  if (!isWorkspacePanel(panelId)) {
    return null;
  }

  return (
    <WorkspaceItemsTableContent
      key={workspaceScopeForPanel(panelId)}
      controller={controller}
    />
  );
}

function WorkspaceItemsTableContent({ controller }: MainPanelProps) {
  const { panel, workspaceItems } = controller;
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const archiveButtonRef = useRef<HTMLButtonElement | null>(null);
  const selectAllCheckboxRef = useRef<HTMLInputElement | null>(null);
  const scope = workspaceScopeForPanel(panel.id as WorkspaceChildTabId);
  const settings = controller.workspaceTableSettings(scope);
  const groups = React.useMemo(
    () => deriveWorkspaceViewGroups(
      scope,
      workspaceItems.items,
      settings,
      workspaceItems.relatedItems,
    ),
    [scope, settings, workspaceItems.items, workspaceItems.relatedItems],
  );
  const visibleItems = React.useMemo(
    () => uniqueWorkspaceItems(groups.flatMap((group) => group.items)),
    [groups],
  );
  const columns = columnsForPanel(panel.id);
  const filterOptions: PlannerFilterOptions = {
    ...plannerFilterOptionsForItems(
      workspaceItems.items,
      workspaceItems.relatedItems,
    ),
    storedRelationLabels: {
      area: workspaceItems.relatedItems.areas,
      project: workspaceItems.relatedItems.projects,
      routine: workspaceItems.relatedItems.routines,
      parent: workspaceItems.relatedItems.goals,
    },
  };
  const groupOptions = workspaceGroupOptionsForPanel(panel.id as WorkspaceChildTabId);
  const controlsAdapter: TableViewControlsAdapter = {
    scopeId: scope,
    title: panel.title,
    settings,
    filterFields: workspaceFilterFieldsForScope(scope),
    sortFields: workspaceSortFieldsForScope(scope),
    groupOptions,
    candidates: buildPlannerGroupCandidates({
      view: "daily",
      groupBy: settings.groupSettings.groupBy,
      items: workspaceItems.items,
      relatedItems: workspaceItems.relatedItems,
    }),
    filterOptions,
    activeControlsAriaLabel: "Active Workspace controls",
    dropdownIdPrefix: "workspace",
    isDefaultSort: (rules) =>
      rules.length === 1 &&
      rules[0]?.field === "updated" &&
      rules[0]?.direction === "desc",
    update: (updater) => controller.updateWorkspaceTableSettings(scope, updater),
    add: controller.openCreationDialog,
  };

  const visibleSelectionCount = visibleItems.reduce(
    (count, item) => count + Number(controller.selectedItemIds.includes(item.id)),
    0,
  );
  const allVisibleSelected =
    visibleItems.length > 0 &&
    visibleSelectionCount === visibleItems.length;
  const partiallySelected =
    visibleSelectionCount > 0 && visibleSelectionCount < visibleItems.length;

  useEffect(() => {
    controller.setVisibleWorkspaceItemIds(visibleItems.map(({ id }) => id));
  }, [controller.setVisibleWorkspaceItemIds, visibleItems]);

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
          Could not load ToDo items.
        </p>
      </section>
    );
  }

  return (
    <section className="items-section">
      <header className="workspace-table-header">
        <div className="workspace-table-header-row">
          <TableViewControls adapter={controlsAdapter} />
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
        <TableViewTabs
          scopeId={scope}
          title={panel.title}
          controller={{
            tabs: controller.workspaceTableTabs(scope),
            isDirty: controller.workspaceTableIsDirty(scope),
            select: (tabId) => controller.selectWorkspaceTableTab(scope, tabId),
            save: () => controller.saveWorkspaceTableTab(scope),
            create: (name) => controller.createWorkspaceTableTab(scope, name),
            rename: (tabId, name) =>
              controller.renameWorkspaceTableTab(scope, tabId, name),
            requestDelete: (tabId) =>
              controller.requestDeleteWorkspaceTableTab(scope, tabId),
          }}
        />
        <TableViewActivePills adapter={controlsAdapter} />
      </header>
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
            {columns.map((column) => (
              <th scope="col" key={column.label}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <WorkspaceGroupedRows
          groups={groups}
          emptyMessage={workspaceItems.items.length > 0
            ? "No items match this view."
            : `No ${panel.title.toLowerCase()} found.`}
          renderRow={(item) => (
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
              {columns.map((column) => (
                <td key={column.label}>{column.value(item, workspaceItems, controller)}</td>
              ))}
            </tr>
          )}
        />
      </table>
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

function isWorkspacePanel(panelId: LeafTabId): panelId is WorkspaceChildTabId {
  return (
    panelId === "areas" ||
    panelId === "projects" ||
    panelId === "goals" ||
    panelId === "routines" ||
    panelId === "tasks" ||
    panelId === "events"
  );
}

function uniqueWorkspaceItems(items: WorkspaceItemModel[]): WorkspaceItemModel[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function workspaceGroupOptionsForPanel(
  panelId: WorkspaceChildTabId,
): { value: PlannerGroupBy; label: string }[] {
  const common = {
    none: { value: "none" as const, label: "None" },
    area: { value: "area" as const, label: "Area" },
    project: { value: "project" as const, label: "Project" },
    routine: { value: "routine" as const, label: "Routine" },
    tag: { value: "tag" as const, label: "Tag" },
    status: { value: "status" as const, label: "Status" },
  };
  const options: Record<WorkspaceChildTabId, { value: PlannerGroupBy; label: string }[]> = {
    areas: [common.none, common.tag, common.status],
    projects: [common.none, common.area, common.tag, common.status],
    goals: [common.none, common.tag, common.status],
    routines: [
      common.none,
      common.area,
      common.project,
      common.tag,
      common.status,
    ],
    tasks: [
      common.none,
      common.area,
      common.project,
      common.routine,
      common.tag,
      common.status,
    ],
    events: [common.none, common.area, common.project, common.tag, common.status],
  };
  return options[panelId];
}

function workspaceGroupOptionsForLinkedType(
  itemType: WorkspaceItemModel["type"],
): { value: PlannerGroupBy; label: string }[] {
  const panelByType: Record<
    WorkspaceItemModel["type"],
    WorkspaceChildTabId
  > = {
    area: "areas",
    project: "projects",
    goal: "goals",
    routine: "routines",
    task: "tasks",
    event: "events",
  };
  return workspaceGroupOptionsForPanel(panelByType[itemType]);
}

function CreationDialog({ controller }: { controller: WorkbenchController }) {
  const creationContext = controller.plannerCreationContext;
  const creationPrefills = controller.plannerCreationAnalysis.prefills;
  const plannerScheduled = defaultCreationScheduled(controller, creationContext);
  const plannerHorizon = defaultCreationHorizon(controller, creationContext);
  const plannerItemType = defaultCreationItemType(controller, creationContext);
  const plannerTypeOptions = plannerCreationTypeOptions(controller, creationContext);
  const [title, setTitle] = React.useState("");
  const [itemType, setItemType] = React.useState<CreateWorkspaceItemForm["itemType"]>(
    plannerItemType,
  );
  const [scheduled, setScheduled] = React.useState(plannerScheduled);
  const [horizon, setHorizon] = React.useState(plannerHorizon);
  const [definitionOfDone, setDefinitionOfDone] = React.useState("");
  const [recurrenceRule, setRecurrenceRule] = React.useState("RRULE:FREQ=DAILY");
  const [areaId, setAreaId] = React.useState(creationPrefills.area_id ?? "");
  const [projectId, setProjectId] = React.useState(creationPrefills.project_id ?? "");
  const [priority, setPriority] = React.useState(
    creationPrefills.priority?.toString() ?? "",
  );
  const [tags, setTags] = React.useState<string[]>(creationPrefills.tags ?? []);
  const [submitError, setSubmitError] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const isGoal = controller.panel.id === "goals";
  const isPlannerGoal =
    itemType === "goal" &&
    (creationContext != null ||
      controller.panel.id === "weekly" ||
      controller.panel.id === "monthly" ||
      controller.panel.id === "yearly");
  const needsGoalPeriod = isGoal || isPlannerGoal;
  const isProject = controller.panel.id === "projects";
  const isRoutine =
    controller.panel.id === "routines" ||
    (creationContext == null &&
      (controller.panel.id === "weekly" || controller.panel.id === "daily") &&
      itemType === "routine");
  const needsScheduled =
    controller.panel.id === "events" ||
    (creationContext != null
      ? creationContext.scheduled !== "" && (itemType === "task" || itemType === "event")
      : (controller.panel.id === "weekly" || controller.panel.id === "daily") &&
        (itemType === "task" || itemType === "event"));
  const showsDateWorkMetadata = creationContext != null && itemType !== "goal";

  useEffect(() => {
    const returnFocusTarget = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    titleInputRef.current?.focus();
    return () => {
      if (returnFocusTarget?.isConnected) returnFocusTarget.focus();
    };
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
    const trimmedDefinitionOfDone = definitionOfDone.trim();
    const trimmedRecurrenceRule = recurrenceRule.trim();
    if (isProject && !trimmedDefinitionOfDone) {
      setSubmitError("Project requires definition_of_done");
      return;
    }
    if (isRoutine && !trimmedRecurrenceRule) {
      setSubmitError("Routine requires recurrence_rule");
      return;
    }
    setIsSubmitting(true);
    try {
      await controller.createWorkspaceItem({
        title,
        itemType,
        scheduled,
        horizon,
        ...(creationContext
          ? {
              area_id: areaId || undefined,
              project_id: projectId || undefined,
              priority: priority ? Number(priority) : undefined,
              tags: tags.length > 0 ? tags : undefined,
            }
          : {}),
        definition_of_done: isProject ? trimmedDefinitionOfDone : undefined,
        recurrence_rule: isRoutine ? trimmedRecurrenceRule : undefined,
      });
    } catch (error) {
      setSubmitError(
        error instanceof RavenApiError
          ? error.message
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
        {controller.plannerCreationAnalysis.visibilityWarning ? (
          <p className="items-message" role="alert">
            This item may not appear in the current table because its filters cannot be
            applied automatically.
          </p>
        ) : null}
        {creationContext?.tableId !== "daily.unscheduled" &&
        (creationContext != null || plannerTypeOptions.length > 1) ? (
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
        {creationContext ? (
          <>
            {showsDateWorkMetadata ? (
              <>
                <label className="field-label">
                  Area
                  <select value={areaId} onChange={(event) => setAreaId(event.target.value)}>
                    <option value="">None</option>
                    {plannerCreationRelationOptions(
                      controller.workspaceItems.relatedItems.areas,
                      areaId,
                    ).map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="field-label">
                  Project
                  <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                    <option value="">None</option>
                    {plannerCreationRelationOptions(
                      controller.workspaceItems.relatedItems.projects,
                      projectId,
                    ).map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="field-label">
                  Priority
                  <select value={priority} onChange={(event) => setPriority(event.target.value)}>
                    <option value="">None</option>
                    {priorityOptions.map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            <label className="field-label">
              Tags
              <TagsInput
                label="Tags"
                value={tags}
                tagOptions={controller.workspaceItems.tagOptions}
                onCommit={setTags}
                propagateEscape
                portalDropdown
              />
            </label>
          </>
        ) : null}
        {isProject ? (
          <label className="field-label">
            Definition of Done
            <input
              value={definitionOfDone}
              onChange={(event) => setDefinitionOfDone(event.target.value)}
            />
          </label>
        ) : null}
        {isRoutine ? (
          <RecurrenceRuleField value={recurrenceRule} onChange={setRecurrenceRule} />
        ) : null}
        {needsGoalPeriod ? (
          <GoalPeriodControl
            label="Period"
            horizon={horizon}
            scheduled={scheduled}
            editable={creationContext?.editableDate ?? true}
            lockHorizon={creationContext != null}
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
              readOnly={creationContext != null && !creationContext.editableDate}
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

function plannerCreationRelationOptions(
  labels: Record<string, string>,
  selectedValue: string,
): Array<{ value: string; label: string }> {
  const options = Object.entries(labels).map(([value, label]) => ({ value, label }));
  if (selectedValue && !labels[selectedValue]) {
    options.push({ value: selectedValue, label: selectedValue });
  }
  return options.sort((left, right) => left.label.localeCompare(right.label));
}

function defaultCreationScheduled(
  controller: WorkbenchController,
  creationContext: PlannerCreationContext | null = null,
): string {
  if (creationContext) {
    return creationContext.scheduled;
  }
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

function defaultCreationHorizon(
  controller: WorkbenchController,
  creationContext: PlannerCreationContext | null = null,
): string {
  if (creationContext?.horizon) {
    return creationContext.horizon;
  }
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

function defaultCreationItemType(
  controller: WorkbenchController,
  creationContext: PlannerCreationContext | null = null,
): PlannerCreationItemType | undefined {
  if (creationContext) {
    return creationContext.itemTypes[0];
  }
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
  creationContext: PlannerCreationContext | null = null,
): Array<{ value: PlannerCreationItemType; label: string }> {
  if (creationContext) {
    return creationContext.itemTypes.map((value) => ({
      value,
      label: value[0]?.toUpperCase() + value.slice(1),
    }));
  }
  if (controller.panel.id === "weekly") {
    return [
      { value: "goal", label: "Goal" },
      { value: "task", label: "Task" },
      { value: "event", label: "Event" },
    ];
  }
  if (controller.panel.id === "daily") {
    return [
      { value: "task", label: "Task" },
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
      value={item.status}
      disabled={item.status === "missed"}
      onClick={stopRowEvent}
      onKeyDown={stopRowEvent}
      onChange={(event) => {
        const status = event.target.value;
        const action = transitionActionForStatus(item.status, status, item.type);

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
        disabled={item.status === "missed"}
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
  const options = item.type === "area"
    ? areaStatusOptions
    : item.type === "task"
      ? taskStatusOptions
      : workItemStatusOptions;
  return options.includes(item.status) ? options : [item.status, ...options];
}

function detailStatusForItem(item: WorkspaceItemModel | null): string {
  return item?.status ?? "";
}

function transitionActionForStatus(
  currentStatus: string,
  nextStatus: string,
  itemType: WorkspaceItemModel["type"],
): WorkspaceItemTransitionAction | null {
  if (nextStatus === currentStatus) {
    return null;
  }
  if (nextStatus === "active") {
    if (
      currentStatus === "completed" &&
      (itemType === "task" || itemType === "event")
    ) {
      return "reopen";
    }
    return currentStatus === "paused" ? "resume" : null;
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
    value: (item, workspaceItems, controller) => (
      <GoalPeriodControl
        label={`Period for ${item.title}`}
        horizon={item.horizon}
        scheduled={item.scheduled}
        parentHorizon={workspaceItems.allItems.find(
          (candidate) => candidate.id === item.parent_id && candidate.type === "goal",
        )?.horizon}
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
    projectColumn(),
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
    priorityColumn(),
    { label: "Description", value: (item) => displayValue(itemDescription(item)) },
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
