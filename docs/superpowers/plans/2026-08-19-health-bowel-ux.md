# Health Bowel UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy inline Bowel form/list with an active-only saved-view table, Add dialog, editable detail, reliable archive recovery, and browser history matching Health Diet.

**Architecture:** Keep Bowel as the existing `HealthEvent` category and load it through the existing paginated events endpoint. Add one Bowel-specific table projection and UI components while reusing saved-view primitives, modal lifecycle, destructive confirmations, and browser-detail history; do not add a schema, route, dependency, or generic Health framework.

**Tech Stack:** React 18, TypeScript, Next.js 14, Vitest, Testing Library, existing Raven Health API and workbench table-view primitives.

---

## File Map

**Create:**

- `frontend/src/features/health/model/bowel-table.ts` — pure Bowel row projection, filtering, sorting, and grouping.
- `frontend/src/features/health/ui/BowelCreateDialog.tsx` — isolated Add modal around the existing Bowel form.
- `frontend/src/features/health/ui/BowelTable.tsx` — accessible active-record table and selection UI.
- `frontend/src/features/health/ui/BowelDetail.tsx` — immutable-baseline editor, history, save, and archive actions.
- `frontend/tests/domain/bowel-table.spec.ts` — Bowel derivation contract.
- `frontend/tests/presentation/bowel-panel.spec.tsx` — controller, Add, table, detail, history, archive, and recovery coverage.

**Modify:**

- `frontend/src/features/workbench/model/planner-model.ts` — add Bowel-only filter/sort/group field literals.
- `frontend/src/features/workbench/ui/TableViewControls.tsx` — define labels and input types for the new literals.
- `frontend/src/features/health/model/health-table-views.ts` — add `health.bowel` scope and its exact allowlists/options.
- `frontend/src/features/health/hooks/useHealthController.ts` — own the paginated Bowel collection and Bowel-specific mutation refresh semantics.
- `frontend/src/features/health/ui/HealthForms.tsx` — make Bowel creation use approved labels and committed-refresh recovery.
- `frontend/src/features/health/ui/HealthTableViewHeader.tsx` — make the existing Health header accept Diet/Bowel scope-specific inputs.
- `frontend/src/features/health/ui/DietPanel.tsx` — supply Diet-specific values to the scope-driven Health header without behavior changes.
- `frontend/src/features/health/ui/BowelPanel.tsx` — replace the legacy form/list with the complete workflow.
- `frontend/src/features/health/ui/HealthPanel.tsx` — keep Bowel tombstones and refresh warnings alive across leaf tabs.
- `frontend/tests/domain/health-table-views.spec.ts` — scope isolation and normalization.
- `frontend/tests/domain/planner-model.spec.ts` — shared model literal normalization without ToDo/Ledger leakage.
- `frontend/tests/presentation/health-forms.spec.tsx` — Bowel modal and recovery contract.
- `frontend/tests/presentation/health-panel.spec.tsx` — always-mounted recovery and saved-view wiring.
- `frontend/tests/presentation/workbench-wireframe.spec.tsx` — shared control regression only where literal exhaustiveness changes assertions.

## Task 1: Define the Bowel saved-view and row model

**Files:**

- Create: `frontend/src/features/health/model/bowel-table.ts`
- Modify: `frontend/src/features/health/model/health-table-views.ts`
- Modify: `frontend/src/features/workbench/model/planner-model.ts`
- Modify: `frontend/src/features/workbench/ui/TableViewControls.tsx`
- Test: `frontend/tests/domain/bowel-table.spec.ts`
- Test: `frontend/tests/domain/health-table-views.spec.ts`
- Test: `frontend/tests/domain/planner-model.spec.ts`

- [ ] **Step 1: Write failing scope and derivation tests**

Add table-driven assertions that require:

```ts
expect(healthTableScopeIds).toEqual(["health.diet", "health.bowel"]);
expect(healthFilterFieldsForScope("health.bowel")).toEqual([
  "date", "bristol_scale", "blood_visible",
]);
expect(healthSortFieldsForScope("health.bowel")).toEqual([
  "date", "bristol_scale", "created", "updated",
]);
expect(healthGroupOptionsForScope("health.bowel").map(({ value }) => value)).toEqual([
  "none", "month", "week", "day", "bristol_scale", "blood_visible",
]);
```

Create Bowel fixtures with active and archived `HealthEvent` values and assert `deriveBowelGroups` covers:

```ts
expect(deriveBowelGroups(events, defaults)[0]!.rows.map(({ id }) => id))
  .toEqual(["newer-id", "older-id"]);
expect(filtered[0]!.rows.map(({ id }) => id)).toEqual(["blood-id"]);
expect(grouped.map(({ key, label }) => ({ key, label }))).toEqual([
  { key: "yes", label: "Yes" },
  { key: "no", label: "No" },
]);
```

Also prove ID tie-breaking, local day/week/month grouping, AND/OR filters, every Bristol value,
Yes/No filtering, hidden groups, alphabetical/reverse/manual ordering, and no Planner/Ledger/Diet
acceptance of Bowel-only fields.

- [ ] **Step 2: Run the domain tests and verify RED**

Run:

```powershell
npm --prefix frontend test -- health-table-views.spec.ts planner-model.spec.ts bowel-table.spec.ts
```

Expected: FAIL because `health.bowel`, `bristol_scale`, `blood_visible`, and
`deriveBowelGroups` do not exist.

- [ ] **Step 3: Add only the required shared literals and Bowel scope configuration**

Append the two literals to the existing shared unions:

```ts
  | "note"
  | "bristol_scale"
  | "blood_visible";

  | "status"
  | "bristol_scale"
  | "blood_visible";
```

Register both fields as `select` fields in `plannerFilterFieldTypes` and the exhaustive
control configuration, labelled `Bristol Scale` and `Blood Visible`.

Make Health scope lookups explicit rather than sharing one allowlist:

```ts
export const healthTableScopeIds = ["health.diet", "health.bowel"] as const;

const scopeFields = {
  "health.diet": {
    filters: ["date", "meal_type", "food", "tags", "has_photo"],
    sorts: ["date", "meal_type", "food", "created", "updated"],
  },
  "health.bowel": {
    filters: ["date", "bristol_scale", "blood_visible"],
    sorts: ["date", "bristol_scale", "created", "updated"],
  },
} as const;

export const healthBowelFilterSelectOptions = {
  bristol_scale: Array.from({ length: 7 }, (_, index) => ({
    value: String(index + 1), label: `Type ${index + 1}`,
  })),
  blood_visible: [
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
  ],
};
```

Return the exact group options per scope and keep normalization allowlisted by the requested
scope so persisted Bowel fields cannot leak into another table.

- [ ] **Step 4: Implement the pure Bowel projection**

Define the row types and public derivation:

```ts
export type BowelRow = {
  id: string;
  event: HealthEvent;
  date: string;
  timeLabel: string;
  bristolScale: number;
  bloodVisible: boolean;
  bloodLabel: "Yes" | "No";
  note: string;
};

export function deriveBowelGroups(
  events: readonly HealthEvent[],
  settings: PlannerTableSettings,
  now = new Date(),
): BowelRowGroup[] {
  const rows = events
    .filter((event) => event.category === "bowel" && event.deletedAt === null)
    .map(projectBowelRow)
    .filter((row) => matchesBowelRules(row, effectivePlannerFilterRules(
      settings.filterRules,
      healthFilterFieldsForScope("health.bowel"),
    ), settings.filterMode, localCalendarDate(now)))
    .sort((left, right) => compareBowelRows(left, right, settings.sortRules));
  return groupBowelRows(rows, settings.groupSettings);
}
```

Read Bristol and blood values only from the already-validated `event.attributes.kind ===
"bowel"` branch. Reuse `matchesPlannerFilterValue`, `isoWeekStart`,
`orderVisiblePlannerGroups`, and the same locale/numeric comparison pattern as Diet.

- [ ] **Step 5: Run the domain tests and verify GREEN**

Run:

```powershell
npm --prefix frontend test -- health-table-views.spec.ts planner-model.spec.ts bowel-table.spec.ts diet-table.spec.ts ledger-table-views.spec.ts
npm --prefix frontend run typecheck
```

Expected: all selected suites PASS and TypeScript reports no errors.

- [ ] **Step 6: Commit Task 1**

```powershell
git add frontend/src/features/workbench/model/planner-model.ts frontend/src/features/workbench/ui/TableViewControls.tsx frontend/src/features/health/model/health-table-views.ts frontend/src/features/health/model/bowel-table.ts frontend/tests/domain/health-table-views.spec.ts frontend/tests/domain/planner-model.spec.ts frontend/tests/domain/bowel-table.spec.ts
git commit -m "[ADD] Derive Health Bowel table views"
```

## Task 2: Add the dedicated Bowel controller collection

**Files:**

- Modify: `frontend/src/features/health/hooks/useHealthController.ts`
- Create: `frontend/tests/presentation/bowel-panel.spec.tsx`
- Test: `frontend/tests/presentation/health-panel.spec.tsx`
- Test: `frontend/tests/presentation/health-forms.spec.tsx`

- [ ] **Step 1: Write failing controller tests**

Use `renderHook(useHealthController)` and mock `healthApi.listEvents` to prove:

```ts
expect(healthApi.listEvents).toHaveBeenCalledWith({
  category: "bowel", limit: 200, offset: 0,
});
expect(result.current.state.bowelEntries).toEqual(bowelEvents);
expect(result.current.state.bowelStatus).toBe("loaded");
```

Add exact tests for page draining, ordinary refresh coalescing, stale success and error
rejection, retained loaded data on refresh failure, and mutation supersession. For each of
`createBowel`, `updateBowel`, and `archiveBowel`, assert one mutation plus exactly one Bowel,
Timeline, and Trends read. For each read family failing after a committed mutation, assert
`HealthMutationRefreshError`, then assert `refreshBowel()` repeats the Bowel, Timeline, and
Trends reads only.

- [ ] **Step 2: Run controller tests and verify RED**

Run:

```powershell
npm --prefix frontend test -- bowel-panel.spec.tsx health-panel.spec.tsx health-forms.spec.tsx
```

Expected: FAIL because Bowel collection state, `refreshBowel`, `updateBowel`, and
`archiveBowel` do not exist.

- [ ] **Step 3: Add Bowel state and public controller methods**

Extend the types and initial state:

```ts
export type HealthState = {
  // existing Diet fields
  bowelStatus: LoadStatus;
  bowelError: string | null;
  bowelEntries: HealthEvent[];
  // existing Timeline and Trends fields
};

export type HealthController = {
  // existing methods
  refreshBowel(): Promise<boolean>;
  updateBowel(id: string, input: EventUpdate): Promise<void>;
  archiveBowel(id: string): Promise<void>;
};
```

Import `EventUpdate` and `HealthEvent`; initialize Bowel with `idle`, null error, and an empty
array.

- [ ] **Step 4: Implement Bowel refresh concurrency and mutation refresh**

Mirror the proven Diet generation/outcome ownership, changing only the read source:

```ts
const EVENT_PAGE_SIZE = 200;

const startBowelRefresh = useCallback((force = false): Promise<boolean> => {
  if (!force && inFlightBowelRefresh.current) return inFlightBowelRefresh.current;
  const generation = ++bowelGeneration.current;
  setState((current) => current.bowelStatus === "loaded"
    ? { ...current, bowelError: null }
    : { ...current, bowelStatus: "loading", bowelError: null });
  const request = (async () => {
    try {
      const bowelEntries: HealthEvent[] = [];
      let offset = 0;
      let page: HealthEvent[];
      do {
        page = await healthApi.listEvents({
          category: "bowel", limit: EVENT_PAGE_SIZE, offset,
        });
        bowelEntries.push(...page);
        offset += page.length;
      } while (page.length === EVENT_PAGE_SIZE);
      if (generation !== bowelGeneration.current) {
        return latestBowelOutcome.current ?? false;
      }
      setState((current) => ({
        ...current,
        bowelStatus: "loaded",
        bowelError: null,
        bowelEntries,
      }));
      return true;
    } catch (error) {
      if (generation !== bowelGeneration.current) {
        return latestBowelOutcome.current ?? false;
      }
      setState((current) => current.bowelStatus === "loaded"
        ? { ...current, bowelError: errorMessage(error, "Bowel request failed") }
        : {
          ...current,
          bowelStatus: "error",
          bowelError: errorMessage(error, "Bowel request failed"),
        });
      return false;
    }
  })();
  latestBowelOutcome.current = request;
  inFlightBowelRefresh.current = request;
  void request.finally(() => {
    if (inFlightBowelRefresh.current === request) inFlightBowelRefresh.current = null;
  });
  return request;
}, []);
```

Include Bowel in aggregate `refresh()`. Define one related-read helper used by public
`refreshBowel()` and every Bowel mutation:

```ts
const refreshBowelRelated = useCallback(async (force = false) => {
  const [bowelOk, timeline, trend] = await Promise.all([
    startBowelRefresh(force),
    refreshTimelineOutcome(),
    refreshTrendsOutcome(),
  ]);
  return bowelOk && timeline.ok && trend.ok;
}, [startBowelRefresh, refreshTimelineOutcome, refreshTrendsOutcome]);

const refreshBowel = useCallback(
  () => refreshBowelRelated(),
  [refreshBowelRelated],
);

const refreshAfterBowelMutation = useCallback(async () => {
  if (!await refreshBowelRelated(true)) throw new HealthMutationRefreshError();
}, [refreshBowelRelated]);

useEffect(() => {
  void startBowelRefresh();
}, [startBowelRefresh]);

const refresh = useCallback(async () => {
  const [existingOk, bowelOk] = await Promise.all([
    refreshAll(),
    startBowelRefresh(),
  ]);
  return existingOk && bowelOk;
}, [refreshAll, startBowelRefresh]);

createBowel: (input) => mutate(() => healthApi.createEvent(input), refreshAfterBowelMutation),
updateBowel: (id, input) => mutate(
  () => healthApi.updateEvent(id, input), refreshAfterBowelMutation,
),
archiveBowel: (id) => mutate(
  () => healthApi.archiveEvent(id), refreshAfterBowelMutation,
),
```

Keep Medication and Metrics on their existing Timeline/Trends refresh boundary.

- [ ] **Step 5: Run controller and existing Health regressions**

Run:

```powershell
npm --prefix frontend test -- bowel-panel.spec.tsx health-panel.spec.tsx health-forms.spec.tsx quick-add.spec.tsx diet-panel.spec.tsx
npm --prefix frontend run typecheck
```

Expected: all selected tests PASS; no existing Diet mutation gains an extra mutation call.

- [ ] **Step 6: Commit Task 2**

```powershell
git add frontend/src/features/health/hooks/useHealthController.ts frontend/tests/presentation/bowel-panel.spec.tsx frontend/tests/presentation/health-panel.spec.tsx frontend/tests/presentation/health-forms.spec.tsx
git commit -m "[UPDATE] Add Health Bowel collection state"
```

## Task 3: Build the Bowel Add dialog

**Files:**

- Create: `frontend/src/features/health/ui/BowelCreateDialog.tsx`
- Modify: `frontend/src/features/health/ui/HealthForms.tsx`
- Test: `frontend/tests/presentation/health-forms.spec.tsx`

- [ ] **Step 1: Write failing creation-dialog tests**

Assert the dialog renders in a body modal host with exact field order `Time`, `Bristol Scale`,
`Blood Visible`, `Note`; defaults to Type 4 and unchecked; submits:

```ts
expect(controller.createBowel).toHaveBeenCalledWith({
  occurredAt: expectedRfc3339,
  details: { kind: "bowel", bristolScale: 6, bloodVisible: true },
  note: "Urgent",
});
```

Also cover local-time validation, forward/reverse Tab wrapping, idle Escape/backdrop close,
pending close/duplicate blocking, failure preservation, focus return, and committed-refresh
failure followed by reads-only Retry.

- [ ] **Step 2: Run the form test and verify RED**

Run:

```powershell
npm --prefix frontend test -- health-forms.spec.tsx -t "Bowel"
```

Expected: FAIL because `BowelCreateDialog` and refresh-recovery behavior are absent.

- [ ] **Step 3: Update the existing Bowel form minimally**

Keep `BowelForm` in `HealthForms.tsx`, rename visible labels, default to `4`, and handle a
committed refresh exactly like Diet:

```ts
const [refreshRecovery, setRefreshRecovery] = useState(false);

try {
  await controller.createBowel(input);
} catch (cause) {
  if (cause instanceof HealthMutationRefreshError) {
    setRefreshRecovery(true);
    return;
  }
  throw cause;
}
```

Wrap the fields in `<fieldset disabled={refreshRecovery || action.pending}>`; use visible
labels `Time`, `Bristol Scale`, `Blood Visible`, and `Note`. The Retry button calls
`controller.refreshBowel()` and invokes `onSaved` only when it returns true.

- [ ] **Step 4: Add the modal by reusing the established lifecycle**

Implement the same host and isolation contract as `DietCreateDialog`, with Bowel-specific
labels:

```tsx
return host ? createPortal(
  <div className="confirmation-backdrop" onMouseDown={closeIdleBackdrop}>
    <div
      ref={dialogRef}
      className="confirmation-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Add bowel entry"
      aria-busy={pending}
      onKeyDown={handleDialogKeyDown}
    >
      <header className="dashboard-widget-header">
        <h2>Add bowel entry</h2>
        <button type="button" disabled={pending} onClick={onClose}>Close</button>
      </header>
      <BowelForm controller={controller} onSaved={onClose} onPendingChange={setPending} />
    </div>
  </div>,
  host,
) : null;
```

Use `useModalIsolation(dialogRef, true, "body")`, the same focusable selector and Tab wrap,
and restore `returnFocusRef` during cleanup.

- [ ] **Step 5: Verify the Add dialog and Diet modal regression**

Run:

```powershell
npm --prefix frontend test -- health-forms.spec.tsx diet-panel.spec.tsx
npm --prefix frontend run typecheck
```

Expected: both suites PASS.

- [ ] **Step 6: Commit Task 3**

```powershell
git add frontend/src/features/health/ui/BowelCreateDialog.tsx frontend/src/features/health/ui/HealthForms.tsx frontend/tests/presentation/health-forms.spec.tsx
git commit -m "[ADD] Build Health Bowel creation dialog"
```

## Task 4: Replace the Bowel list with the saved-view table

**Files:**

- Create: `frontend/src/features/health/ui/BowelTable.tsx`
- Modify: `frontend/src/features/health/ui/HealthTableViewHeader.tsx`
- Modify: `frontend/src/features/health/ui/DietPanel.tsx`
- Modify: `frontend/src/features/health/ui/BowelPanel.tsx`
- Modify: `frontend/src/features/health/ui/HealthPanel.tsx`
- Test: `frontend/tests/presentation/bowel-panel.spec.tsx`
- Test: `frontend/tests/presentation/health-panel.spec.tsx`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

- [ ] **Step 1: Write failing table, view, selection, and archive tests**

Assert exact columns and Yes/No rendering, active-only records, initial/empty/no-match/error
messages, Filter/Sort/Group/Add/Delete order, Bowel saved-view controls, visible-only selection,
group duplicate deduplication, row activation, and sequential archive order.

For partial failure:

```ts
expect(controller.archiveBowel.mock.calls.map(([id]) => id)).toEqual(["first", "second"]);
expect(screen.getByRole("checkbox", { name: /second/i })).toBeChecked();
expect(screen.getByRole("checkbox", { name: /third/i })).toBeChecked();
```

For `HealthMutationRefreshError`, assert the committed current ID disappears immediately,
unattempted selection remains, Retry calls `controller.refreshBowel` only, and the warning/tombstone
survive Bowel → Diet → Bowel.

- [ ] **Step 2: Run presentation tests and verify RED**

Run:

```powershell
npm --prefix frontend test -- bowel-panel.spec.tsx health-panel.spec.tsx workbench-wireframe.spec.tsx
```

Expected: FAIL against the legacy inline form and `HealthRecordTable`.

- [ ] **Step 3: Make the existing Health header scope-driven**

Replace Diet-specific inputs with explicit props; do not introduce generics or a factory:

```ts
type HealthTableViewHeaderProps = {
  controller: HealthController;
  scope: HealthTableScopeId;
  title: string;
  headingId: string;
  fieldLabels: Partial<Record<PlannerFilterField, string>>;
  fieldOptions: Partial<Record<PlannerFilterField, Option<string>[]>>;
  candidates: PlannerGroupCandidate[];
  onAdd(): void;
  addButtonRef: React.RefObject<HTMLButtonElement>;
  onArchiveSelected(): void;
  archiveButtonRef: React.RefObject<HTMLButtonElement>;
  archiveDisabled: boolean;
};
```

Build the existing `TableViewTabs` and `TableViewControlsAdapter` from these values. Update
DietPanel to compute its candidate groups/tags before calling the header, preserving every
existing Diet label and option.

- [ ] **Step 4: Implement the accessible Bowel table**

Use a native table with one real detail button in the Time cell:

```tsx
<tr onClick={openUnlessInteractive}>
  <td><input type="checkbox" aria-label={`Select ${context}`} /></td>
  <td><button
    type="button"
    data-bowel-row-id={row.id}
    data-bowel-occurrence={occurrence}
    aria-label={`Open details for ${context}`}
    onClick={() => onOpen(row, occurrence)}
  >{row.timeLabel}</button></td>
  <td>Type {row.bristolScale}</td>
  <td>{row.bloodLabel}</td>
  <td>{row.note}</td>
</tr>
```

Deduplicate logical IDs for select-all and batch operations while keeping occurrence keys
unique across groups. Empty copy is exactly `No bowel entries yet.` or `No bowel entries
match this view.`.

- [ ] **Step 5: Implement BowelPanel table and archive flow**

Follow DietPanel's local UI state with Bowel names and `controller.state.bowelEntries`.
Compute active rows using default settings, visible groups using current settings, and
selected visible IDs once. Open `BowelCreateDialog` from Add. Snapshot selected visible IDs
before confirmation and call `controller.archiveBowel` sequentially.

On committed-refresh failure:

```ts
if (error instanceof HealthMutationRefreshError) {
  if (currentId) markArchived(currentId, error.message);
} else {
  setArchiveError(errorMessage(error));
}
setArchiveTargets(null);
```

- [ ] **Step 6: Hoist Bowel recovery state to HealthPanel**

Add Bowel counterparts to the Diet recovery state, keyed against the `bowelEntries` array
identity:

```ts
const [bowelTombstonedIds, setBowelTombstonedIds] = useState<Set<string>>(() => new Set());
const [bowelRefreshWarning, setBowelRefreshWarning] = useState<string | null>(null);
const [bowelRefreshPending, setBowelRefreshPending] = useState(false);
const bowelRecoveryBaselines = useRef(new Map<
  string, HealthController["state"]["bowelEntries"]
>());

async function retryBowelRefresh() {
  for (const id of bowelTombstonedIds) {
    bowelRecoveryBaselines.current.set(id, controller.state.bowelEntries);
  }
  setBowelRefreshPending(true);
  try {
    if (await controller.refreshBowel()) setBowelRefreshWarning(null);
  } finally {
    setBowelRefreshPending(false);
  }
}
```

Reconcile only a new authoritative loaded Bowel array, preserve recovery state through leaf
unmounts, and pass the same four recovery props used by Diet into BowelPanel.

- [ ] **Step 7: Verify table/UI regressions**

Run:

```powershell
npm --prefix frontend test -- bowel-panel.spec.tsx health-panel.spec.tsx diet-panel.spec.tsx workbench-wireframe.spec.tsx
npm --prefix frontend run typecheck
```

Expected: all selected suites PASS.

- [ ] **Step 8: Commit Task 4**

```powershell
git add frontend/src/features/health/ui/BowelTable.tsx frontend/src/features/health/ui/HealthTableViewHeader.tsx frontend/src/features/health/ui/BowelPanel.tsx frontend/src/features/health/ui/HealthPanel.tsx frontend/src/features/health/ui/DietPanel.tsx frontend/tests/presentation/bowel-panel.spec.tsx frontend/tests/presentation/health-panel.spec.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "[UPDATE] Replace Health Bowel list workflow"
```

## Task 5: Build Bowel detail editing and browser history

**Files:**

- Create: `frontend/src/features/health/ui/BowelDetail.tsx`
- Modify: `frontend/src/features/health/ui/BowelPanel.tsx`
- Test: `frontend/tests/presentation/bowel-panel.spec.tsx`
- Test: `frontend/tests/presentation/health-panel.spec.tsx`

- [ ] **Step 1: Write failing detail tests**

Cover exact properties and timestamps, immutable opened baseline, canonical no-op whitespace,
minimal patches, optimistic conflict token, Type 1/7 boundaries, invalid local time, 50-step
Undo history, Redo, Ctrl/Cmd+S, Ctrl/Cmd+Z, Ctrl+Y, pending locks, failure retention,
committed-refresh Retry without resubmission, detail archive/tombstone exit, and stable row-ID
focus after editing Time/Bristol/blood.

Assert a real patch:

```ts
expect(controller.updateBowel).toHaveBeenCalledWith("bowel-1", {
  details: { kind: "bowel", bristolScale: 7, bloodVisible: true },
  expectedUpdatedAt: originalUpdatedAt,
});
```

Assert clean browser Back/Forward, dirty cancel/confirm repair, no popstate push loop, stale or
tombstoned Forward normalization, save without duplicate push, and listener cleanup on Bowel
leaf unmount.

- [ ] **Step 2: Run detail tests and verify RED**

Run:

```powershell
npm --prefix frontend test -- bowel-panel.spec.tsx health-panel.spec.tsx
```

Expected: FAIL because Bowel rows do not open an editor or browser-history state.

- [ ] **Step 3: Implement an immutable Bowel draft and bounded reducer**

Use these exact shapes:

```ts
type BowelDraft = {
  occurredAt: string;
  bristolScale: number;
  bloodVisible: boolean;
  note: string;
};

type CanonicalBowelDraft = {
  occurredAt: string | null;
  bristolScale: number;
  bloodVisible: boolean;
  note: string | null;
};

const BOWEL_HISTORY_LIMIT = 50;
```

Snapshot the row once with `useState`, initialize one reducer, coalesce Time/Note text edits,
and cap every past push with `.slice(-BOWEL_HISTORY_LIMIT)`. Canonicalize Time through
`localDateTimeToRfc3339`, Note through `trim() || null`, and leave Bristol/blood typed.

- [ ] **Step 4: Send a minimal optimistic update**

Construct one update with the original version:

```ts
function bowelPatch(
  baseline: CanonicalBowelDraft,
  present: CanonicalBowelDraft,
  row: BowelRow,
): EventUpdate {
  const patch: EventUpdate = { expectedUpdatedAt: row.event.updatedAt };
  if (present.occurredAt !== baseline.occurredAt) patch.occurredAt = present.occurredAt!;
  if (
    present.bristolScale !== baseline.bristolScale ||
    present.bloodVisible !== baseline.bloodVisible
  ) {
    patch.details = {
      kind: "bowel",
      bristolScale: present.bristolScale,
      bloodVisible: present.bloodVisible,
    };
  }
  if (present.note !== baseline.note) patch.note = present.note;
  return patch;
}
```

Disable Save unless the canonical draft is dirty and valid. Lock all navigation and mutation
actions while pending or in committed-refresh recovery. Render Created and Updated using the
same timestamp formatter contract verified by Diet tests.

- [ ] **Step 5: Connect shared browser detail history and stable focus**

In BowelPanel:

```ts
const detailHistory = useBrowserDetailHistory({
  stateKey: "__ravenHealthBowelDetailId",
  currentId: currentDetailRow?.id ?? null,
  resolve: (id) => activeRows.find((row) => row.id === id) ?? null,
  open: (row) => setDetailRow(row),
  close: () => {
    setDetailRow(null);
    restoreDetailFocus();
  },
  clearOnUnmount: true,
});
```

Track `{ occurrence, rowId }`, restore the exact occurrence first, then any matching stable
row ID, then Add. Pass `detailHistory` and `onArchived` into `BowelDetail`; clear dirty state
before committed save/archive navigation.

- [ ] **Step 6: Verify detail and shared-history regressions**

Run:

```powershell
npm --prefix frontend test -- bowel-panel.spec.tsx health-panel.spec.tsx diet-panel.spec.tsx workbench-wireframe.spec.tsx
npm --prefix frontend run typecheck
```

Expected: all selected suites PASS, including existing ToDo and Diet browser history.

- [ ] **Step 7: Commit Task 5**

```powershell
git add frontend/src/features/health/ui/BowelDetail.tsx frontend/src/features/health/ui/BowelPanel.tsx frontend/tests/presentation/bowel-panel.spec.tsx frontend/tests/presentation/health-panel.spec.tsx
git commit -m "[ADD] Build Health Bowel detail workflow"
```

## Task 6: Final scope and verification gate

**Files:**

- Modify only if a verified Bowel regression requires it: files already listed in Tasks 1–5
- Verify: `docs/superpowers/specs/2026-08-19-health-bowel-ux-design.md`
- Verify: `docs/operations/api-reference.md`
- Verify: `README.md`
- Verify: `frontend/README.md`

- [ ] **Step 1: Audit the implementation against every design section**

Check Table, View Configuration, Creation, Detail, Archive, Data Flow, Loading and Recovery,
Verification, and Non-Goals. Confirm no schema/API route/dependency/package-lock change and no
archived browser, restore, purge, symptoms, or generic Health framework was introduced.

- [ ] **Step 2: Run fresh frontend verification sequentially**

Run:

```powershell
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: every frontend test file passes; typecheck exits 0; Next production build exits 0.

- [ ] **Step 3: Run the existing Health API boundary test**

Run:

```powershell
cargo fmt --check
cargo test -p raven-api --test routes_health
```

Expected: formatting passes and all Health route tests pass without backend changes.

- [ ] **Step 4: Check diffs and documentation truth**

Run:

```powershell
git diff --check
git status --short
git diff -- frontend/package-lock.json Cargo.lock
```

Expected: no whitespace errors; only planned Bowel/frontend/test files differ; the pre-existing
user-owned `frontend/package-lock.json` change remains unstaged and unchanged by this work;
`Cargo.lock` is untouched. Stable docs remain accurate because routes and schemas did not
change. If code proves a stable-doc statement false, update only that statement under the
docs skills and commit it separately.

- [ ] **Step 5: Request code review and resolve only evidenced findings**

Use `superpowers:requesting-code-review`. Verify each finding against code and tests before
changing anything. Apply fixes with TDD and one NFLOW commit per independent issue; do not add
speculative abstractions.

- [ ] **Step 6: Record final evidence**

Report exact test-file/test counts, typecheck/build/API results, commit list, changed files,
worktree status, preserved user-owned lockfile state, and any known external baseline failure.
