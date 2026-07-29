# Workspace Table Views and Linked List Overflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Planner-equivalent filter, sort, group, and saved-view tabs to every Workspace table and every detail linked-item type list, with linked lists collapsed to five rows by default.

**Architecture:** Extract Planner's saved-tab lifecycle and table-control shell into generic table-view units while keeping Planner field policy in the Planner model. Add a Workspace view model that defines stable `workspace.<item-type>` and `detail.<parent-type>.<child-type>` scopes, persists those scopes separately, and derives visible/grouped rows through the same filter → sort → group pipeline. Workspace tables and linked lists consume the shared controls through controller adapters; linked lists then apply a transient five-row cap across the grouped result.

**Tech Stack:** TypeScript 5, React 19, Next.js 15, Vitest, Testing Library, CSS

## Global Constraints

- SQLite and the Rust `TodoService` remain untouched; this is a frontend preference and presentation feature.
- Planner and Workspace saved views must persist independently.
- Workspace table scopes are `workspace.<item-type>`.
- Detail linked-list scopes are `detail.<parent-type>.<child-type>`.
- Linked-list settings are shared by scope, not by individual parent item ID.
- Linked lists render at most `5` matching rows while collapsed.
- `More (N)` reports the number of currently hidden rows; `Less` restores the five-row cap.
- Changing a linked-list tab, filter, sort, or group setting restores collapsed state.
- Filtering precedes sorting, sorting precedes grouping, and the linked-list cap applies across the whole grouped list.
- Existing linked-item unsaved-change confirmation and direct-child rules must not change.
- Invalid persisted settings reset only the affected Workspace scope.
- Expanded/collapsed state is transient and must not be persisted.
- Use TDD and keep Planner's existing behavior green throughout the refactor.

---

## File Structure

### New files

- `frontend/src/features/workbench/model/table-view-tabs.ts` — generic saved-view tab state and lifecycle.
- `frontend/src/features/workbench/model/workspace-table-views.ts` — Workspace scope IDs, field capabilities, defaults, normalization, row derivation, grouping, and linked-list overflow.
- `frontend/src/features/workbench/ui/TableViewTabs.tsx` — surface-neutral saved-view tab strip.
- `frontend/src/features/workbench/ui/TableViewControls.tsx` — surface-neutral filter/sort/group/add header controls.
- `frontend/src/features/workbench/ui/TableViewTabConfirmationDialog.tsx` — shared dirty-view and delete confirmation dialog.
- `frontend/src/features/workbench/ui/WorkspaceGroupedRows.tsx` — reusable grouped-row renderer for Workspace tables and linked lists.
- `frontend/tests/domain/table-view-tabs.spec.ts` — generic tab lifecycle coverage.
- `frontend/tests/domain/workspace-table-views.spec.ts` — scope, settings, derivation, grouping, and overflow coverage.

### Modified files

- `frontend/src/features/workbench/model/planner-tabs.ts` — adapt Planner IDs/defaults to the generic tab lifecycle.
- `frontend/src/features/workbench/model/planner-model.ts` — export shared field metadata and item filter/sort primitives without weakening Planner table restrictions.
- `frontend/src/features/workbench/model/workbench-model.ts` — expose Workspace view state and controller commands.
- `frontend/src/features/workbench/hooks/useWorkbenchController.ts` — load, normalize, queue, persist, and mutate Workspace views independently from Planner.
- `frontend/src/features/workbench/ui/PlannerTableTabs.tsx` — reduce to a Planner adapter around `TableViewTabs`.
- `frontend/src/features/workbench/ui/WorkbenchWireframe.tsx` — mount the shared table-view confirmation dialog.
- `frontend/src/features/workbench/ui/MainPanel.tsx` — adapt Planner to shared controls; integrate controls and grouped rows into Workspace tables and linked lists.
- `frontend/src/styles/globals.css` — shared control styles, Workspace grouping, linked-list overflow actions, and responsive layout.
- `frontend/tests/domain/planner-tabs.spec.ts` — prove the Planner adapter preserves existing behavior.
- `frontend/tests/presentation/use-workbench-controller.spec.tsx` — Workspace preference and controller isolation tests.
- `frontend/tests/presentation/workbench-wireframe.spec.tsx` — Workspace table controls, linked-list controls, overflow, grouping, and navigation tests.
- `docs/superpowers/specs/2026-07-29-workspace-table-views-and-linked-list-overflow-design.md` — update only if implementation reveals an approved contract correction.

### Deleted files

- `frontend/src/features/workbench/ui/PlannerTabConfirmationDialog.tsx` — replaced by the surface-neutral confirmation dialog after Planner parity tests pass.

---

### Task 1: Extract the generic saved-view tab lifecycle

**Files:**

- Create: `frontend/src/features/workbench/model/table-view-tabs.ts`
- Create: `frontend/tests/domain/table-view-tabs.spec.ts`
- Modify: `frontend/src/features/workbench/model/planner-tabs.ts`
- Modify: `frontend/tests/domain/planner-tabs.spec.ts`

**Interfaces:**

- Produces:

```ts
export type TableViewTab<TSettings> = {
  id: string;
  name: string;
  settings: TSettings;
};

export type TableViewTabsState<TSettings> = {
  tabs: TableViewTab<TSettings>[];
  activeTabId: string;
  draftSettings: TSettings;
};

export type TableViewSettingsAdapter<TScope extends string, TSettings> = {
  defaultSettings(scope: TScope): TSettings;
  normalizeSettings(scope: TScope, candidate: unknown): TSettings;
  cloneSettings(settings: TSettings): TSettings;
};

export function buildTableViewTabsState<TScope extends string, TSettings>(
  scope: TScope,
  candidate: unknown,
  adapter: TableViewSettingsAdapter<TScope, TSettings>,
): TableViewTabsState<TSettings>;

export function tableViewTabIsDirty<TSettings>(
  state: TableViewTabsState<TSettings>,
  cloneSettings: (settings: TSettings) => TSettings,
): boolean;
```

- Planner keeps its public `PlannerTableTab`, `PlannerTableTabsState`, and
  existing function names as wrappers so current consumers do not change in
  this task.

- [ ] **Step 1: Write failing generic lifecycle tests**

Add tests that construct an adapter with `{ order: string[] }` settings and
prove normalization, cloning, unique tab names, duplicate ID repair, select,
draft update, save, rename, delete, discard, reset-to-first, and dirty
comparison:

```ts
const adapter: TableViewSettingsAdapter<"scope", { order: string[] }> = {
  defaultSettings: () => ({ order: ["default"] }),
  normalizeSettings: (_scope, candidate) => ({
    order: Array.isArray((candidate as { order?: unknown })?.order)
      ? [...(candidate as { order: string[] }).order]
      : ["default"],
  }),
  cloneSettings: (settings) => ({ order: [...settings.order] }),
};

const state = buildTableViewTabsState(
  "scope",
  { tabs: [{ id: "one", name: "Table", settings: { order: ["title"] } }] },
  adapter,
);
expect(state.activeTabId).toBe("one");
expect(state.draftSettings).toEqual({ order: ["title"] });
```

- [ ] **Step 2: Run the new domain test and verify failure**

Run:

```bash
cd frontend
npm test -- --run tests/domain/table-view-tabs.spec.ts
```

Expected: FAIL because `table-view-tabs.ts` does not exist.

- [ ] **Step 3: Implement the generic tab model**

Move the lifecycle algorithms from `planner-tabs.ts` into the new generic
module. Accept clone/default/normalize behavior through the adapter and keep
IDs and names trimmed, nonempty, case-insensitively unique, and deterministic.
Export these exact lifecycle functions:

```ts
buildTableViewTabsState
tableViewTabIsDirty
selectTableViewTab
updateTableViewTabDraft
saveTableViewTabDraft
createTableViewTab
renameTableViewTab
deleteTableViewTab
discardTableViewTabDraft
resetTableViewTabsToFirst
```

- [ ] **Step 4: Rebuild Planner wrappers on the generic model**

In `planner-tabs.ts`, define a `plannerTableViewSettingsAdapter` using
`defaultPlannerTableSettings`, `normalizePlannerTableSettings`, and
`clonePlannerTableSettings`. Keep legacy `tableSettings` migration in
`buildPlannerTabsState`, but delegate each stored `tabs` value and all
lifecycle commands to the generic functions.

- [ ] **Step 5: Run generic and Planner tab tests**

Run:

```bash
cd frontend
npm test -- --run tests/domain/table-view-tabs.spec.ts tests/domain/planner-tabs.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the generic tab model**

```bash
git add frontend/src/features/workbench/model/table-view-tabs.ts frontend/src/features/workbench/model/planner-tabs.ts frontend/tests/domain/table-view-tabs.spec.ts frontend/tests/domain/planner-tabs.spec.ts
git commit -m "[REFACTOR] Extract generic table view tabs"
```

---

### Task 2: Add the Workspace table-view domain model

**Files:**

- Create: `frontend/src/features/workbench/model/workspace-table-views.ts`
- Create: `frontend/tests/domain/workspace-table-views.spec.ts`
- Modify: `frontend/src/features/workbench/model/planner-model.ts`

**Interfaces:**

- Consumes: `TableViewTabsState`, `TableViewSettingsAdapter`,
  `PlannerTableSettings`, `PlannerFilterField`, `PlannerSortBy`,
  `PlannerGroupSettings`, and `WorkspaceItemModel`.
- Produces:

```ts
export const workspaceTableScopeIds = [
  "workspace.area",
  "workspace.project",
  "workspace.goal",
  "workspace.routine",
  "workspace.task",
  "workspace.event",
] as const;

export type WorkspaceTableScopeId =
  | (typeof workspaceTableScopeIds)[number]
  | `detail.${WorkspaceItemModel["type"]}.${WorkspaceItemModel["type"]}`;

export type WorkspaceTableViewsState =
  Partial<Record<WorkspaceTableScopeId, TableViewTabsState<PlannerTableSettings>>>;

export type WorkspaceViewGroup = {
  key: string;
  label: string;
  items: WorkspaceItemModel[];
};

export type CollapsedWorkspaceGroups = {
  groups: WorkspaceViewGroup[];
  visibleCount: number;
  hiddenCount: number;
};

export function workspaceScopeForPanel(
  panelId: "areas" | "projects" | "goals" | "routines" | "tasks" | "events",
): WorkspaceTableScopeId;

export function detailWorkspaceScope(
  parentType: WorkspaceItemModel["type"],
  childType: WorkspaceItemModel["type"],
): WorkspaceTableScopeId;

export function workspaceFilterFieldsForScope(
  scope: WorkspaceTableScopeId,
): readonly PlannerFilterField[];

export function workspaceSortFieldsForScope(
  scope: WorkspaceTableScopeId,
): readonly PlannerSortBy[];

export function deriveWorkspaceViewGroups(
  scope: WorkspaceTableScopeId,
  items: WorkspaceItemModel[],
  settings: PlannerTableSettings,
  relatedItems: WorkspaceItemsModel["relatedItems"],
): WorkspaceViewGroup[];

export function collapseWorkspaceGroups(
  groups: WorkspaceViewGroup[],
  limit?: number,
): CollapsedWorkspaceGroups;
```

- [ ] **Step 1: Write failing scope and capability tests**

Cover all six Workspace scopes, representative detail scopes, and exact field
restrictions. For example, Tasks allow `routine`, `priority`, `scheduled`, and
`due`; Areas do not allow those fields; Goals allow `horizon` and `parent`.

```ts
expect(workspaceScopeForPanel("tasks")).toBe("workspace.task");
expect(detailWorkspaceScope("area", "task")).toBe("detail.area.task");
expect(workspaceFilterFieldsForScope("workspace.goal")).toContain("horizon");
expect(workspaceFilterFieldsForScope("workspace.area")).not.toContain("routine");
```

- [ ] **Step 2: Write failing derivation and overflow tests**

Use six tasks with mixed titles, priorities, statuses, tags, and relations.
Assert:

```ts
const groups = deriveWorkspaceViewGroups(
  "detail.area.task",
  tasks,
  settings,
  relatedItems,
);
const collapsed = collapseWorkspaceGroups(groups);
expect(collapsed.visibleCount).toBe(5);
expect(collapsed.hiddenCount).toBe(1);
expect(collapsed.groups.flatMap((group) => group.items)).toHaveLength(5);
```

Also prove filtering changes `hiddenCount`, tag grouping can duplicate an item
across groups before capping, the cap counts rendered rows consistently, and
groups with zero retained rows are omitted.

- [ ] **Step 3: Run the Workspace model test and verify failure**

Run:

```bash
cd frontend
npm test -- --run tests/domain/workspace-table-views.spec.ts
```

Expected: FAIL because the Workspace model does not exist.

- [ ] **Step 4: Export shared Planner field primitives**

In `planner-model.ts`, export the existing field-type lookup, operator lookup,
rule validation helper, `filterPlannerItemsByRules`, `sortPlannerItems`, and
grouping primitives needed by Workspace. Rename only private helpers when
necessary; preserve all existing Planner exports and behavior.

- [ ] **Step 5: Implement Workspace scope policy and settings normalization**

Define exact field lists by item type and build a
`TableViewSettingsAdapter<WorkspaceTableScopeId, PlannerTableSettings>`.
Defaults are:

```ts
{
  filterMode: "and",
  filterRules: [],
  sortRules: [{ id: "workspace-default-sort", field: "updated", direction: "desc" }],
  groupSettings: defaultPlannerGroupSettings(),
}
```

Normalize rules against the scope's allowed filter, sort, and group fields.
Ignore invalid rules while preserving valid sibling rules.

- [ ] **Step 6: Implement derivation and five-row collapse**

Reuse the Planner item matching and sorting semantics. Group with stable keys
and labels, then flatten groups in display order while taking at most five
rendered rows. Rebuild groups from retained rows so an empty trailing group is
not rendered. Return the total rendered-row difference as `hiddenCount`.

- [ ] **Step 7: Run Workspace and Planner model tests**

Run:

```bash
cd frontend
npm test -- --run tests/domain/workspace-table-views.spec.ts tests/domain/planner-model.spec.ts tests/domain/planner-group-settings.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Commit the Workspace view model**

```bash
git add frontend/src/features/workbench/model/workspace-table-views.ts frontend/src/features/workbench/model/planner-model.ts frontend/tests/domain/workspace-table-views.spec.ts
git commit -m "[ADD] Model Workspace table views"
```

---

### Task 3: Add independent Workspace view persistence and controller commands

**Files:**

- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- Modify: `frontend/tests/presentation/use-workbench-controller.spec.tsx`

**Interfaces:**

- Consumes: Workspace settings adapter and generic tab lifecycle from Tasks 1
  and 2.
- Produces these `WorkbenchController` members:

```ts
workspaceTableTabs: (
  scope: WorkspaceTableScopeId,
) => TableViewTabsState<PlannerTableSettings>;
workspaceTableSettings: (
  scope: WorkspaceTableScopeId,
) => PlannerTableSettings;
workspaceTableIsDirty: (scope: WorkspaceTableScopeId) => boolean;
updateWorkspaceTableSettings: (
  scope: WorkspaceTableScopeId,
  updater: (settings: PlannerTableSettings) => PlannerTableSettings,
) => void;
selectWorkspaceTableTab: (
  scope: WorkspaceTableScopeId,
  tabId: string,
) => void;
saveWorkspaceTableTab: (scope: WorkspaceTableScopeId) => void;
createWorkspaceTableTab: (
  scope: WorkspaceTableScopeId,
  name: string,
) => boolean;
renameWorkspaceTableTab: (
  scope: WorkspaceTableScopeId,
  tabId: string,
  name: string,
) => boolean;
requestDeleteWorkspaceTableTab: (
  scope: WorkspaceTableScopeId,
  tabId: string,
) => void;
setVisibleWorkspaceItemIds: (itemIds: string[]) => void;
toggleVisibleSelection: () => void;
```

`setVisibleWorkspaceItemIds` stores the currently derived Workspace-table row
IDs in a ref; `toggleVisibleSelection` reads that ref instead of raw
`workspaceItems.items`.

Replace Planner-only confirmation state with:

```ts
export type TableViewTarget =
  | { surface: "planner"; scope: PlannerTableId }
  | { surface: "workspace"; scope: WorkspaceTableScopeId };

export type TableViewTabConfirmation =
  | { kind: "select" | "delete"; target: TableViewTarget; targetTabId: string }
  | {
      kind: "navigate";
      dirtyTargets: TableViewTarget[];
      targetSelection: WorkbenchSelection;
    };
```

The controller exposes `tableViewTabConfirmation`,
`confirmTableViewTabAction`, and `cancelTableViewTabAction`. Planner's existing
select/delete/navigation behavior moves to this shared confirmation state.

- [ ] **Step 1: Write failing load, save, and isolation tests**

Stub both preference endpoints:

```ts
expect(fetchMock).toHaveBeenCalledWith("/todo-engine/settings/planner");
expect(fetchMock).toHaveBeenCalledWith("/todo-engine/settings/workspace-views");
```

Prove a stored `workspace.task` tab loads, updating it writes only
`/settings/workspace-views`, Planner commands write only `/settings/planner`,
and a malformed `workspace.project` entry does not reset a valid
`detail.area.task` entry. Reject both Workspace preference requests in a
separate case and prove item loading, table rendering state, and local default
views still work.

- [ ] **Step 2: Write failing command and visible-selection tests**

Exercise create, select, rename, save, delete confirmation, dirty select
confirmation, dirty navigation confirmation, dirty state, and settings update
for `workspace.task`. Set visible IDs to `["task-2"]`, call
`toggleVisibleSelection`, and assert only `task-2` becomes selected.

- [ ] **Step 3: Run focused controller tests and verify failure**

Run:

```bash
cd frontend
npm test -- --run tests/presentation/use-workbench-controller.spec.tsx
```

Expected: FAIL because Workspace view controller members do not exist.

- [ ] **Step 4: Add Workspace view state with queued startup commands**

Mirror Planner's load-race protection with separate refs:

```ts
type PendingWorkspaceViewCommand = {
  apply: (state: WorkspaceTableViewsState) => WorkspaceTableViewsState;
  persist: boolean;
};

const workspaceViewsLoaded = useRef(false);
const pendingWorkspaceViewCommands = useRef<PendingWorkspaceViewCommand[]>([]);
```

Load `GET /todo-engine/settings/workspace-views`, normalize each present scope,
replay commands made before loading finishes, and serialize writes through a
dedicated `workspaceViewsWrite` promise.

- [ ] **Step 5: Implement Workspace tab commands**

Use the generic lifecycle functions with the Workspace adapter. Persist saved
tab mutations immediately. Keep draft filter/sort/group edits local until the
active tab is saved, matching Planner. Return `false` for invalid names,
unknown tabs, and deleting the last tab. Route Planner and Workspace select,
delete, and dirty-navigation confirmations through
`TableViewTabConfirmation`; confirm/cancel must dispatch to the target
surface's state without mutating the other surface.

- [ ] **Step 6: Make visible selection derived-view aware**

Add a `visibleWorkspaceItemIds` ref, update it through
`setVisibleWorkspaceItemIds`, and remove IDs no longer present when the active
Workspace panel changes. Keep archive behavior based on the selected IDs.

- [ ] **Step 7: Run controller tests**

Run:

```bash
cd frontend
npm test -- --run tests/presentation/use-workbench-controller.spec.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Workspace controller state**

```bash
git add frontend/src/features/workbench/model/workbench-model.ts frontend/src/features/workbench/hooks/useWorkbenchController.ts frontend/tests/presentation/use-workbench-controller.spec.tsx
git commit -m "[ADD] Persist Workspace table views"
```

---

### Task 4: Extract reusable table-view tabs and controls

**Files:**

- Create: `frontend/src/features/workbench/ui/TableViewTabs.tsx`
- Create: `frontend/src/features/workbench/ui/TableViewControls.tsx`
- Create: `frontend/src/features/workbench/ui/TableViewTabConfirmationDialog.tsx`
- Delete: `frontend/src/features/workbench/ui/PlannerTabConfirmationDialog.tsx`
- Modify: `frontend/src/features/workbench/ui/PlannerTableTabs.tsx`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/features/workbench/ui/WorkbenchWireframe.tsx`
- Modify: `frontend/src/styles/globals.css`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**

- Produces:

```ts
export type TableViewTabController<TSettings> = {
  tabs: TableViewTabsState<TSettings>;
  isDirty: boolean;
  select(tabId: string): void;
  save(): void;
  create(name: string): boolean;
  rename(tabId: string, name: string): boolean;
  requestDelete(tabId: string): void;
};

export function TableViewTabs<TSettings>(props: {
  scopeId: string;
  title: string;
  controller: TableViewTabController<TSettings>;
}): React.ReactElement;

export type TableViewControlsAdapter = {
  scopeId: string;
  title: string;
  settings: PlannerTableSettings;
  filterFields: readonly PlannerFilterField[];
  sortFields: readonly PlannerSortBy[];
  groupOptions: Option<PlannerGroupBy>[];
  candidates: PlannerGroupCandidate[];
  filterOptions: PlannerFilterOptions;
  update(
    updater: (settings: PlannerTableSettings) => PlannerTableSettings,
  ): void;
  add(): void;
};
```

- [ ] **Step 1: Add Planner regression tests before extraction**

Add focused assertions that the existing Daily Today table still exposes
Filter, Sort, Group, Add, saved tabs, active pills, popover dismissal, and
keyboard tab navigation after the component split.

- [ ] **Step 2: Run the Planner presentation tests as a green baseline**

Run:

```bash
cd frontend
npm test -- --run tests/presentation/workbench-wireframe.spec.tsx
```

Expected: PASS before refactoring.

- [ ] **Step 3: Extract `TableViewTabs`**

Move the generic rendering, focus refs, rename/create editor, menu, and
keyboard navigation from `PlannerTableTabs.tsx`. Replace Planner-specific
controller calls with the `TableViewTabController` callbacks. Keep
`PlannerTableTabs` as a small adapter:

```tsx
return (
  <TableViewTabs
    scopeId={tableId}
    title={title}
    controller={{
      tabs: controller.plannerTableTabs(tableId),
      isDirty: controller.plannerTableIsDirty(tableId),
      select: (tabId) => controller.selectPlannerTableTab(tableId, tabId),
      save: () => controller.savePlannerTableTab(tableId),
      create: (name) => controller.createPlannerTableTab(tableId, name),
      rename: (tabId, name) =>
        controller.renamePlannerTableTab(tableId, tabId, name),
      requestDelete: (tabId) =>
        controller.requestDeletePlannerTableTab(tableId, tabId),
    }}
  />
);
```

- [ ] **Step 4: Extract `TableViewControls`**

Move dropdown state, trigger/panel refs, filter/sort/group buttons, portals,
active pills, and group callbacks out of `PlannerTableHeader`. Pass
surface-specific fields, options, settings, candidates, update, and add
callbacks through the adapter. Keep the existing filter-rule and group-panel
components reusable by accepting allowed-field arrays rather than requiring a
`PlannerTableId`.

- [ ] **Step 5: Keep Planner as an adapter**

`PlannerTableHeader` derives the existing Planner field restrictions and
creation context, then renders `TableViewControls` and `PlannerTableTabs`.
No Planner persistence, copy, or behavior changes are allowed.

- [ ] **Step 6: Generalize the confirmation dialog**

Move focus trapping, return-focus behavior, delete copy, and discard copy into
`TableViewTabConfirmationDialog`. Find the active tab with
`[data-table-view-scope]` rather than `[data-planner-table-id]`. For navigation
copy, use `Discard unsaved view changes?`; for select and delete, retain the
existing user-facing copy. Mount the new dialog from `WorkbenchWireframe` and
remove `PlannerTabConfirmationDialog.tsx`.

- [ ] **Step 7: Consolidate CSS selectors**

Introduce `.table-view-controls`, `.table-view-tabs`, and
`.table-view-active-pills` base selectors. Keep compatibility selectors for
existing `.planner-*` classes only where tests or layout still require them.

- [ ] **Step 8: Run presentation, controller, and type checks**

Run:

```bash
cd frontend
npm test -- --run tests/presentation/workbench-wireframe.spec.tsx tests/presentation/use-workbench-controller.spec.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit shared controls**

```bash
git add frontend/src/features/workbench/ui/TableViewTabs.tsx frontend/src/features/workbench/ui/TableViewControls.tsx frontend/src/features/workbench/ui/TableViewTabConfirmationDialog.tsx frontend/src/features/workbench/ui/PlannerTableTabs.tsx frontend/src/features/workbench/ui/PlannerTabConfirmationDialog.tsx frontend/src/features/workbench/ui/WorkbenchWireframe.tsx frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "[REFACTOR] Share table view controls"
```

---

### Task 5: Apply table views to Workspace tables

**Files:**

- Create: `frontend/src/features/workbench/ui/WorkspaceGroupedRows.tsx`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/styles/globals.css`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`
- Modify: `frontend/tests/presentation/use-workbench-controller.spec.tsx`

**Interfaces:**

- Consumes: `deriveWorkspaceViewGroups`, `workspaceScopeForPanel`,
  `TableViewControls`, `TableViewTabs`, and Workspace controller commands.
- Produces:

```ts
export function WorkspaceGroupedRows(props: {
  groups: WorkspaceViewGroup[];
  renderRow(item: WorkspaceItemModel): React.ReactNode;
  emptyMessage: string;
}): React.ReactElement;
```

- [ ] **Step 1: Write failing Workspace table presentation tests**

Loop through Areas, Projects, Goals, Routines, Tasks, and Events and assert
each panel exposes Filter, Sort, Group, Add, and a saved-view tablist. For the
Tasks panel, additionally assert:

```ts
expect(screen.getByRole("button", { name: "Filter Tasks" })).toBeVisible();
expect(screen.getByRole("button", { name: "Sort Tasks" })).toBeVisible();
expect(screen.getByRole("button", { name: "Group Tasks" })).toBeVisible();
expect(screen.getByRole("tablist", { name: "Tasks views" })).toBeVisible();
```

Add interactions proving a status filter removes a row, descending title sort
changes row order, status grouping renders stable headings, a second saved tab
is independent, and select-all selects only filtered rows.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
cd frontend
npm test -- --run tests/presentation/workbench-wireframe.spec.tsx tests/presentation/use-workbench-controller.spec.tsx
```

Expected: FAIL because Workspace tables do not render view controls.

- [ ] **Step 3: Derive Workspace table rows from the active scope**

In `WorkspaceItemsTable`, map the active panel to its stable scope, obtain
draft settings from the controller, and call `deriveWorkspaceViewGroups`.
Memoize by raw items, settings, related items, and scope.

Use an effect to publish the unique derived item IDs:

```ts
const visibleItems = uniqueItems(groups.flatMap((group) => group.items));
useEffect(() => {
  controller.setVisibleWorkspaceItemIds(visibleItems.map(({ id }) => id));
}, [controller.setVisibleWorkspaceItemIds, visibleItems]);
```

- [ ] **Step 4: Render shared controls and tabs**

Replace the current two-button toolbar with a Workspace table header containing
`TableViewControls`, `TableViewTabs`, Add, and Archive selected. Add continues
to call `openCreationDialog`; Archive remains a Workspace-only adjacent action.

- [ ] **Step 5: Render grouped rows without breaking table semantics**

Implement `WorkspaceGroupedRows` so ungrouped data remains a single `<tbody>`.
Grouped data uses one `<tbody aria-label="… group">` per visible group with a
full-width group-heading row followed by existing item rows. Preserve row
activation, inline editors, checkboxes, and column visibility.

- [ ] **Step 6: Update empty and selection states**

Show `No items match this view.` when raw items exist but the derived view is
empty. Keep the existing panel-specific empty message when raw items are empty.
Calculate header checkbox checked/indeterminate values from unique derived
rows.

- [ ] **Step 7: Run Workspace presentation and controller tests**

Run:

```bash
cd frontend
npm test -- --run tests/presentation/workbench-wireframe.spec.tsx tests/presentation/use-workbench-controller.spec.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit Workspace table integration**

```bash
git add frontend/src/features/workbench/ui/WorkspaceGroupedRows.tsx frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css frontend/tests/presentation/workbench-wireframe.spec.tsx frontend/tests/presentation/use-workbench-controller.spec.tsx
git commit -m "[ADD] Apply saved views to Workspace tables"
```

---

### Task 6: Apply independent views and overflow to linked-item lists

**Files:**

- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/features/workbench/ui/WorkspaceGroupedRows.tsx`
- Modify: `frontend/src/styles/globals.css`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**

- Consumes: `detailWorkspaceScope`, `deriveWorkspaceViewGroups`,
  `collapseWorkspaceGroups`, shared controls/tabs, and
  `WorkspaceGroupedRows`.
- Produces an internal component:

```ts
function LinkedItemTable(props: {
  parentItem: WorkspaceItemModel;
  childType: WorkspaceItemModel["type"];
  childLabel: string;
  items: WorkspaceItemModel[];
  controller: WorkbenchController;
  onOpen(item: WorkspaceItemModel): void;
}): React.ReactElement;
```

- [ ] **Step 1: Add six-child fixture and failing overflow test**

Extend the linked-area fixture with six Tasks. Assert only five task buttons
render initially, `More (1)` is visible, clicking it renders six, `Less`
appears, and clicking `Less` restores five.

- [ ] **Step 2: Add failing independent-control tests**

Assert Projects and Tasks each have their own Filter, Sort, Group, and tablist
labels. Apply a Tasks filter and prove Projects remain unchanged. Change the
Tasks tab and prove the list collapses from six rows back to five.

- [ ] **Step 3: Add failing group-cap and navigation regression tests**

Group Tasks by status and prove the combined rendered task-row count is five,
not five per status. Filter until two rows match and prove `More` disappears.
Open a retained child and rerun the existing clean and dirty-detail navigation
assertions.

- [ ] **Step 4: Run linked-item tests and verify failure**

Run:

```bash
cd frontend
npm test -- --run tests/presentation/workbench-wireframe.spec.tsx
```

Expected: FAIL because linked groups have no controls or overflow.

- [ ] **Step 5: Implement `LinkedItemTable`**

For each direct-child type group:

1. Build `detail.<parent-type>.<child-type>`.
2. Read that scope's draft settings and tabs.
3. Derive groups from only that type's direct children.
4. Collapse with `collapseWorkspaceGroups(groups, 5)` unless expanded.
5. Render shared controls, tabs, grouped rows, and count-aware overflow action.

The group heading continues to show the unfiltered direct-child total. The
empty active view renders `No linked items match this view.` with controls
still available.

- [ ] **Step 6: Reset expanded state on view changes**

Store `expanded` inside each mounted `LinkedItemTable`. Compute a stable
view-version string from `activeTabId` and cloned draft settings:

```ts
const viewVersion = JSON.stringify({
  activeTabId: tabs.activeTabId,
  settings,
});

useEffect(() => setExpanded(false), [viewVersion]);
```

Do not include the parent item ID in persisted scope state. Component remount
on a different child type or detail item naturally starts collapsed.

- [ ] **Step 7: Preserve linked navigation and accessible copy**

Rows call the existing `openLinkedItem` callback. Keep
`aria-label="Open <title> details"`. Label overflow actions
`More (N) <Child label>` and `Less <Child label>` so multiple lists are
unambiguous to assistive technology.

- [ ] **Step 8: Style compact linked tables**

Add compact spacing and responsive wrapping for controls and tabs inside
`.linked-items-group`. Keep touch targets at least the existing toolbar-button
size and ensure group headings and overflow actions do not resemble editable
detail fields.

- [ ] **Step 9: Run linked-item and type checks**

Run:

```bash
cd frontend
npm test -- --run tests/presentation/workbench-wireframe.spec.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit linked-item views and overflow**

```bash
git add frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/features/workbench/ui/WorkspaceGroupedRows.tsx frontend/src/styles/globals.css frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "[ADD] Control and collapse linked item lists"
```

---

### Task 7: Verify the complete frontend feature

**Files:**

- Modify only files required to correct failures caused by Tasks 1–6.

**Interfaces:**

- Consumes all preceding tasks.
- Produces a release-ready, fully verified frontend change.

- [ ] **Step 1: Run domain and presentation tests**

```bash
cd frontend
npm test
```

Expected: all Vitest suites PASS.

- [ ] **Step 2: Run static type checking**

```bash
cd frontend
npm run typecheck
```

Expected: exit code `0`.

- [ ] **Step 3: Run the production build**

```bash
cd frontend
npm run build
```

Expected: Next.js production build completes successfully.

- [ ] **Step 4: Run repository formatting and lint gates**

From the repository root:

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
```

Expected: both commands exit `0`; no Rust files should require changes.

- [ ] **Step 5: Inspect the final diff**

```bash
git status --short
git diff --check
git diff --stat HEAD~6..HEAD
```

Expected: no whitespace errors, no generated frontend artifacts, and only
planned source/test/style/doc files changed.

- [ ] **Step 6: Commit verification-only corrections if needed**

If Steps 1–5 required source corrections, stage only those corrections:

```bash
git add frontend/src frontend/tests frontend/src/styles/globals.css
git commit -m "[FIX] Complete Workspace view verification"
```

If no corrections were required, do not create an empty commit.
