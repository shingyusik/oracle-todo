# Health Medication UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy inline Medication form/list with an active-only saved-view table, Add dialog, editable detail, reliable archive recovery, and browser history matching Health Diet and Bowel.

**Architecture:** Keep Medication as the existing `HealthEvent` category and load it through the existing paginated events endpoint. Add Medication-specific projection and UI files while reusing Health saved-view controls, modal isolation, archive recovery, bounded edit history, and the shared browser-detail coordinator. Do not add a schema, route, dependency, custom unit, or generic Health framework.

**Tech Stack:** React 18, TypeScript, Next.js 14, Vitest, Testing Library, existing Raven Health API and workbench table-view primitives.

---

## File Map

**Create:**

- `frontend/src/features/health/model/medication-table.ts` — pure active Medication projection, filtering, sorting, and grouping.
- `frontend/src/features/health/ui/MedicationCreateDialog.tsx` — isolated Add modal around the existing form.
- `frontend/src/features/health/ui/MedicationTable.tsx` — accessible table and logical-row selection.
- `frontend/src/features/health/ui/MedicationDetail.tsx` — immutable-baseline editor, bounded history, save, archive, and recovery.
- `frontend/tests/domain/medication-table.spec.ts` — Medication derivation contract.
- `frontend/tests/presentation/medication-panel.spec.tsx` — controller, Add, table, detail, history, archive, and recovery coverage.

**Modify:**

- `frontend/src/features/workbench/model/planner-model.ts` — add Medication-only view field/group literals.
- `frontend/src/features/workbench/ui/TableViewControls.tsx` — label and type the new view fields.
- `frontend/src/features/health/model/health-table-views.ts` — register the `health.medication` namespace and exact allowlists.
- `frontend/src/features/health/hooks/useHealthController.ts` — own the paginated Medication collection and mutation refresh boundary.
- `frontend/src/features/health/ui/HealthForms.tsx` — approved labels, unit labels, validation, and committed-refresh recovery.
- `frontend/src/features/health/ui/HealthTableViewHeader.tsx` — consume the third Health table scope without Diet/Bowel behavior changes.
- `frontend/src/features/health/ui/MedicationPanel.tsx` — replace the inline form/list with the full workflow.
- `frontend/src/features/health/ui/HealthPanel.tsx` — retain Medication recovery state across leaf tabs.
- `frontend/tests/domain/health-table-views.spec.ts` — scope normalization and leakage checks.
- `frontend/tests/domain/planner-model.spec.ts` — shared literal normalization.
- `frontend/tests/presentation/health-forms.spec.tsx` — Add dialog and unit/validation contract.
- `frontend/tests/presentation/health-panel.spec.tsx` — recovery lifetime and leaf cleanup.
- `frontend/tests/presentation/workbench-wireframe.spec.tsx` — shared control/history regression where affected.

## Task 1: Define Medication saved views and row projection

**Files:**

- Create: `frontend/src/features/health/model/medication-table.ts`
- Modify: `frontend/src/features/health/model/health-table-views.ts`
- Modify: `frontend/src/features/workbench/model/planner-model.ts`
- Modify: `frontend/src/features/workbench/ui/TableViewControls.tsx`
- Test: `frontend/tests/domain/medication-table.spec.ts`
- Test: `frontend/tests/domain/health-table-views.spec.ts`
- Test: `frontend/tests/domain/planner-model.spec.ts`

- [ ] **Step 1: Write failing scope and projection tests**

Require the exact scope contract:

```ts
expect(healthTableScopeIds).toEqual([
  "health.diet", "health.bowel", "health.medication",
]);
expect(healthFilterFieldsForScope("health.medication")).toEqual([
  "date", "medication_name", "medication_unit",
]);
expect(healthSortFieldsForScope("health.medication")).toEqual([
  "date", "medication_name", "dose", "created", "updated",
]);
expect(healthGroupOptionsForScope("health.medication").map(({ value }) => value)).toEqual([
  "none", "month", "week", "day", "medication_name", "medication_unit",
]);
```

Build active and archived Medication fixtures. Assert newest-first default ordering, final ID tie-break, AND/OR filters, local day/week/month groups, name/unit groups, numeric dose sorting, hidden groups, and alphabetical/reverse/manual ordering. Prove Medication-only fields are rejected by Diet, Bowel, Ledger, and Planner normalization.

- [ ] **Step 2: Run the model tests and verify RED**

```powershell
npm --prefix frontend test -- medication-table.spec.ts health-table-views.spec.ts planner-model.spec.ts
```

Expected: FAIL because `health.medication`, the Medication view literals, and `deriveMedicationGroups` do not exist.

- [ ] **Step 3: Add only the required shared literals and scope configuration**

Extend existing unions with `medication_name`, `medication_unit`, and `dose`; type name as text, unit as select, and dose as number. Add only the two group literals used by the approved design.

```ts
export const healthTableScopeIds = [
  "health.diet", "health.bowel", "health.medication",
] as const;

const medicationFilterFields = [
  "date", "medication_name", "medication_unit",
] as const satisfies readonly PlannerFilterField[];
const medicationSortFields = [
  "date", "medication_name", "dose", "created", "updated",
] as const satisfies readonly PlannerSortBy[];
const medicationGroupOptions = [
  { value: "none", label: "None" },
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
  { value: "medication_name", label: "Medication" },
  { value: "medication_unit", label: "Unit" },
] as const;
```

Expose select options for the fixed domain units only: `tablet`, `capsule`, `packet`, `mg`, `g`, `ml`, `drop`, and `dose`. Keep scope normalization explicit so a field accepted by one Health table cannot persist into another.

- [ ] **Step 4: Implement the pure Medication projection**

```ts
export type MedicationRow = {
  id: string;
  event: HealthEvent;
  date: string;
  takenAtLabel: string;
  medicationName: string;
  dose: number;
  unit: MedicationUnit;
  unitLabel: string;
  note: string;
};

export function deriveMedicationGroups(
  events: readonly HealthEvent[],
  settings: PlannerTableSettings,
  now = new Date(),
): MedicationRowGroup[] {
  const rows = events
    .filter((event) => event.category === "medication" && event.deletedAt === null)
    .map(projectMedicationRow)
    .filter((row) => matchesMedicationRules(row, settings, localCalendarDate(now)))
    .sort((left, right) => compareMedicationRows(left, right, settings.sortRules));
  return groupMedicationRows(rows, settings.groupSettings);
}
```

Read attributes only from `event.attributes.kind === "medication"`. Reuse `matchesPlannerFilterValue`, `isoWeekStart`, `orderVisiblePlannerGroups`, local-date helpers, and the deterministic comparison pattern already used by Bowel.

- [ ] **Step 5: Verify GREEN and shared-scope regressions**

```powershell
npm --prefix frontend test -- medication-table.spec.ts health-table-views.spec.ts planner-model.spec.ts bowel-table.spec.ts diet-table.spec.ts ledger-table-views.spec.ts
npm --prefix frontend run typecheck
```

Expected: all selected tests and typecheck PASS.

- [ ] **Step 6: Commit Task 1**

```powershell
git add frontend/src/features/workbench/model/planner-model.ts frontend/src/features/workbench/ui/TableViewControls.tsx frontend/src/features/health/model/health-table-views.ts frontend/src/features/health/model/medication-table.ts frontend/tests/domain/medication-table.spec.ts frontend/tests/domain/health-table-views.spec.ts frontend/tests/domain/planner-model.spec.ts
git commit -m "[ADD] Derive Health Medication table views"
```

## Task 2: Add the dedicated Medication controller collection

**Files:**

- Modify: `frontend/src/features/health/hooks/useHealthController.ts`
- Create: `frontend/tests/presentation/medication-panel.spec.tsx`
- Test: `frontend/tests/presentation/health-panel.spec.tsx`
- Test: `frontend/tests/presentation/health-forms.spec.tsx`

- [ ] **Step 1: Write failing controller tests**

Use `renderHook(useHealthController)` and prove paginated category reads:

```ts
expect(healthApi.listEvents).toHaveBeenCalledWith({
  category: "medication", limit: 200, offset: 0,
});
expect(result.current.state.medicationEntries).toEqual(events);
expect(result.current.state.medicationStatus).toBe("loaded");
```

Directly cover page draining, ordinary coalescing, stale success/error suppression, retained loaded rows on refresh failure, and newer-result supersession. For create, update, and archive assert one mutation followed by exactly one Medication, Timeline, and Trends read. If any related read fails after commit, require `HealthMutationRefreshError`; `refreshMedication()` must repeat reads only.

- [ ] **Step 2: Run controller tests and verify RED**

```powershell
npm --prefix frontend test -- medication-panel.spec.tsx health-panel.spec.tsx health-forms.spec.tsx
```

Expected: FAIL because dedicated Medication state and methods do not exist.

- [ ] **Step 3: Add Medication state and public methods**

```ts
export type HealthState = {
  // existing fields
  medicationStatus: LoadStatus;
  medicationError: string | null;
  medicationEntries: HealthEvent[];
};

export type HealthController = {
  // existing methods
  refreshMedication(): Promise<boolean>;
  updateMedication(id: string, input: EventUpdate): Promise<void>;
  archiveMedication(id: string): Promise<void>;
};
```

Initialize the collection as idle/null/empty. Keep `createMedication` but move it from the generic event refresh boundary to the Medication boundary.

- [ ] **Step 4: Implement concurrency by reusing the Bowel pattern**

Add Medication generation, ordinary in-flight coalescing, and retained latest-outcome refs. Drain `listEvents({ category: "medication", limit: 200, offset })`. Use one helper for all related reads:

```ts
const refreshMedicationRelated = useCallback(async (force = false) => {
  const [medicationOk, timeline, trends] = await Promise.all([
    startMedicationRefresh(force),
    refreshTimelineOutcome(),
    refreshTrendsOutcome(),
  ]);
  return medicationOk && timeline.ok && trends.ok;
}, [startMedicationRefresh, refreshTimelineOutcome, refreshTrendsOutcome]);

const refreshAfterMedicationMutation = useCallback(async () => {
  if (!await refreshMedicationRelated(true)) throw new HealthMutationRefreshError();
}, [refreshMedicationRelated]);
```

Include Medication in aggregate `refresh()`. Do not add Medication reads to Diet, Bowel, Metrics, or generic event mutations.

- [ ] **Step 5: Verify controller boundaries and regressions**

```powershell
npm --prefix frontend test -- medication-panel.spec.tsx bowel-panel.spec.tsx diet-panel.spec.tsx health-panel.spec.tsx health-forms.spec.tsx quick-add.spec.tsx
npm --prefix frontend run typecheck
```

Expected: all selected tests PASS; no sibling mutation gains an extra read or mutation.

- [ ] **Step 6: Commit Task 2**

```powershell
git add frontend/src/features/health/hooks/useHealthController.ts frontend/tests/presentation/medication-panel.spec.tsx frontend/tests/presentation/health-panel.spec.tsx frontend/tests/presentation/health-forms.spec.tsx frontend/tests/presentation/diet-panel.spec.tsx frontend/tests/presentation/bowel-panel.spec.tsx frontend/tests/presentation/quick-add.spec.tsx
git commit -m "[UPDATE] Add Health Medication collection state"
```

## Task 3: Build the Medication Add dialog

**Files:**

- Create: `frontend/src/features/health/ui/MedicationCreateDialog.tsx`
- Modify: `frontend/src/features/health/ui/HealthForms.tsx`
- Test: `frontend/tests/presentation/health-forms.spec.tsx`

- [ ] **Step 1: Write failing Add-dialog tests**

Assert body portal, modal isolation, exact field order `Taken at`, `Medication name`, `Dose`, `Unit`, `Note`, and fixed unit options. A valid submit must be exact:

```ts
expect(controller.createMedication).toHaveBeenCalledWith({
  occurredAt: expectedRfc3339,
  details: {
    kind: "medication",
    medicationName: "Vitamin D",
    dose: 1000,
    unit: "mg",
  },
  note: "With breakfast",
});
```

Cover empty/whitespace name, zero/negative/non-finite dose, DST-gap local time, forward/reverse Tab wrap, idle Escape/backdrop close, pending duplicate/close blocking, ordinary failure draft retention, success focus return, and committed-refresh reads-only Retry.

- [ ] **Step 2: Run the form tests and verify RED**

```powershell
npm --prefix frontend test -- health-forms.spec.tsx -t "Medication"
```

Expected: FAIL because the dedicated dialog and Medication refresh recovery are absent.

- [ ] **Step 3: Update the existing form minimally**

Keep `MedicationForm` and its current `EventInput`. Use visible labels from the design and present the fixed units as:

```ts
const medicationUnitOptions = [
  { value: "tablet", label: "정" },
  { value: "capsule", label: "캡슐" },
  { value: "packet", label: "포" },
  { value: "mg", label: "mg" },
  { value: "g", label: "g" },
  { value: "ml", label: "ml" },
  { value: "drop", label: "방울" },
  { value: "dose", label: "회" },
] satisfies { value: MedicationUnit; label: string }[];
```

On `HealthMutationRefreshError`, freeze the complete fieldset and expose Retry. Retry calls only `controller.refreshMedication()` and closes on true. Preserve every field after validation, mutation, or refresh failure.

- [ ] **Step 4: Add the modal using the existing Bowel lifecycle**

Create a body modal host, call `useModalIsolation(dialogRef, true, "body")`, set `role="dialog"`, `aria-modal="true"`, `aria-busy`, and label it `Add medication entry`. Trap Tab in both directions; allow idle Escape/backdrop close; block all close paths while pending; restore the enabled Add trigger on cleanup.

- [ ] **Step 5: Verify Add and sibling modal regressions**

```powershell
npm --prefix frontend test -- health-forms.spec.tsx bowel-panel.spec.tsx diet-panel.spec.tsx
npm --prefix frontend run typecheck
```

Expected: all selected tests PASS.

- [ ] **Step 6: Commit Task 3**

```powershell
git add frontend/src/features/health/ui/MedicationCreateDialog.tsx frontend/src/features/health/ui/HealthForms.tsx frontend/tests/presentation/health-forms.spec.tsx
git commit -m "[ADD] Build Health Medication creation dialog"
```

## Task 4: Replace the legacy list with the saved-view table

**Files:**

- Create: `frontend/src/features/health/ui/MedicationTable.tsx`
- Modify: `frontend/src/features/health/ui/MedicationPanel.tsx`
- Modify: `frontend/src/features/health/ui/HealthPanel.tsx`
- Modify: `frontend/src/features/health/ui/HealthTableViewHeader.tsx`
- Test: `frontend/tests/presentation/medication-panel.spec.tsx`
- Test: `frontend/tests/presentation/health-panel.spec.tsx`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

- [ ] **Step 1: Write failing table and archive tests**

Require columns `Taken At`, `Medication`, `Dose`, `Unit`, `Note`; active-only rows; exact initial/empty/no-match/error states; controls ordered Filter, Sort, Group, Add, Delete; `health.medication` saved views; visible-only selection; duplicate group occurrence deduplication; stable selection through filters; and sequential archive snapshots.

For partial failure, keep the failed and unattempted logical IDs selected. For a committed archive plus refresh failure, hide the committed row immediately, retain unattempted selection, show Retry, and prove Retry calls only `refreshMedication()`.

- [ ] **Step 2: Run presentation tests and verify RED**

```powershell
npm --prefix frontend test -- medication-panel.spec.tsx health-panel.spec.tsx workbench-wireframe.spec.tsx
```

Expected: FAIL against the inline form and generic timeline table.

- [ ] **Step 3: Implement the native Medication table**

Use one native table row per group occurrence. Put the real detail button in the Taken At cell and keep the checkbox isolated:

```tsx
<tr onClick={openUnlessInteractive}>
  <td><input type="checkbox" aria-label={`Select ${context}`} /></td>
  <td><button
    type="button"
    data-medication-row-id={row.id}
    data-medication-occurrence={occurrence}
    aria-label={`Open details for ${context}`}
    onClick={() => onOpen(row, occurrence)}
  >{row.takenAtLabel}</button></td>
  <td>{row.medicationName}</td>
  <td>{formatDose(row.dose)}</td>
  <td>{row.unitLabel}</td>
  <td>{row.note}</td>
</tr>
```

Deduplicate logical IDs for select-all/archive while keeping occurrence DOM keys unique. Empty copy is exactly `No medication entries yet.` or `No medication entries match this view.`.

- [ ] **Step 4: Implement MedicationPanel table and Add/archive flow**

Use `controller.state.medicationEntries`, `deriveMedicationGroups`, the existing `HealthTableViewHeader`, and `MedicationCreateDialog`. Derive group candidates from active logical rows only. Snapshot visible selected IDs before confirmation and archive sequentially through `controller.archiveMedication`.

On `HealthMutationRefreshError`, tombstone the committed current ID, deselect it, stop the batch, retain unattempted IDs, and show reads-only recovery. On ordinary failure, retain the failed and unattempted IDs.

- [ ] **Step 5: Hoist recovery lifetime to HealthPanel**

Add Medication tombstones, warning, pending state, and authoritative-array baselines next to Diet/Bowel. Reconcile tombstones only when a new loaded `medicationEntries` array proves authoritative truth. Preserve warning and Retry across Medication → another Health leaf → Medication.

- [ ] **Step 6: Verify table and recovery regressions**

```powershell
npm --prefix frontend test -- medication-panel.spec.tsx health-panel.spec.tsx bowel-panel.spec.tsx diet-panel.spec.tsx workbench-wireframe.spec.tsx
npm --prefix frontend run typecheck
```

Expected: all selected tests PASS.

- [ ] **Step 7: Commit Task 4**

```powershell
git add frontend/src/features/health/ui/MedicationTable.tsx frontend/src/features/health/ui/MedicationPanel.tsx frontend/src/features/health/ui/HealthPanel.tsx frontend/src/features/health/ui/HealthTableViewHeader.tsx frontend/tests/presentation/medication-panel.spec.tsx frontend/tests/presentation/health-panel.spec.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "[UPDATE] Replace Health Medication list workflow"
```

## Task 5: Build Medication detail editing and browser history

**Files:**

- Create: `frontend/src/features/health/ui/MedicationDetail.tsx`
- Modify: `frontend/src/features/health/ui/MedicationPanel.tsx`
- Modify only if a verified shared defect requires it: `frontend/src/features/workbench/hooks/useBrowserDetailHistory.ts`
- Test: `frontend/tests/presentation/medication-panel.spec.tsx`
- Test: `frontend/tests/presentation/health-panel.spec.tsx`
- Test shared hook only if modified: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

- [ ] **Step 1: Write failing detail tests**

Directly cover exact actions/labels/timestamps, immutable opened baseline/version, whitespace no-op, positive decimal dose, fixed units, minimal field patches, ordinary failure retention, committed-refresh recovery without resubmission, 50-step history, text coalescing, distinct select/number edits, redo invalidation, buttons, keyboard shortcuts, IME and pending/dialog guards, clean/dirty browser Back and Forward, no push loop, stale/tombstoned Forward normalization, archive recovery, and occurrence → row ID → Add focus fallback.

- [ ] **Step 2: Run detail tests and verify RED**

```powershell
npm --prefix frontend test -- medication-panel.spec.tsx health-panel.spec.tsx
```

Expected: FAIL because Medication rows do not open a dedicated detail editor.

- [ ] **Step 3: Implement one immutable draft reducer**

```ts
type MedicationDraft = {
  occurredAt: string;
  medicationName: string;
  dose: string;
  unit: MedicationUnit;
  note: string;
};

type CanonicalMedicationDraft = {
  occurredAt: string | null;
  medicationName: string;
  dose: number | null;
  unit: MedicationUnit;
  note: string | null;
};

const MEDICATION_HISTORY_LIMIT = 50;
```

Snapshot the opened row and `updatedAt` once. Canonicalize local time with `localDateTimeToRfc3339`, name with `trim()`, dose as a finite value greater than zero, and note as `trim() || null`. Coalesce Taken at, name, dose, and note text edits; keep unit edits distinct; cap every history push at 50.

- [ ] **Step 4: Build the minimal optimistic patch**

```ts
const patch: EventUpdate = { expectedUpdatedAt: opened.event.updatedAt };
if (present.occurredAt !== baseline.occurredAt) patch.occurredAt = present.occurredAt!;
if (
  present.medicationName !== baseline.medicationName ||
  present.dose !== baseline.dose ||
  present.unit !== baseline.unit
) {
  patch.details = {
    kind: "medication",
    medicationName: present.medicationName,
    dose: present.dose!,
    unit: present.unit,
  };
}
if (present.note !== baseline.note) patch.note = present.note;
```

Disable Save unless canonical data is valid and dirty. Send exactly one `updateMedication` call. Lock editing/navigation throughout mutation, archive confirmation, browser-pop restoration, and refresh recovery. Defer every save/archive success or failure settlement through `detailHistory.deferUntilRestored` when a pop repair is active.

- [ ] **Step 5: Connect browser history and stable focus**

Use state key `__ravenHealthMedicationDetailId`; leave Diet and Bowel keys unchanged.

```ts
const detailHistory = useBrowserDetailHistory({
  stateKey: "__ravenHealthMedicationDetailId",
  currentId: currentDetailRow?.id ?? null,
  resolve: (id) => activeRows.find((row) => row.id === id) ?? null,
  open: setDetailRow,
  close: closeDetailAndRestoreFocus,
  clearOnUnmount: true,
});
```

Track occurrence and stable row ID. Restore exact occurrence first, then another occurrence of the same ID, then Add. Clear dirty state before confirmed save/archive navigation. Test both Back and Forward directions with distinguishable history states.

- [ ] **Step 6: Verify detail and shared-history regressions**

```powershell
npm --prefix frontend test -- medication-panel.spec.tsx health-panel.spec.tsx bowel-panel.spec.tsx diet-panel.spec.tsx workbench-wireframe.spec.tsx
npm --prefix frontend run typecheck
```

Expected: all selected tests PASS, including ToDo, Diet, and Bowel history behavior.

- [ ] **Step 7: Commit Task 5**

```powershell
git add frontend/src/features/health/ui/MedicationDetail.tsx frontend/src/features/health/ui/MedicationPanel.tsx frontend/tests/presentation/medication-panel.spec.tsx frontend/tests/presentation/health-panel.spec.tsx
git commit -m "[ADD] Build Health Medication detail workflow"
```

If a demonstrated shared history defect required the shared hook and regression test, commit that independent fix separately with `[FIX]`.

## Task 6: Final scope and verification gate

**Files:**

- Verify: `docs/superpowers/specs/2026-08-18-health-journal-ux-design.md`
- Verify: `README.md`
- Verify: `frontend/README.md`
- Verify: `docs/operations/api-reference.md`
- Modify only a stable document proven stale by the implementation.

- [ ] **Step 1: Audit every approved Medication requirement**

Check exact table columns; filter/sort/group fields; fixed units; Add/detail field order; active-only rows; saved-view isolation; selection/archive semantics; optimistic updates; history/shortcuts; refresh-only recovery; focus and modal accessibility. Confirm no custom units, archived browser, restore/purge UI, schema/API/dependency, or generic Health abstraction was added.

- [ ] **Step 2: Run fresh frontend gates sequentially**

```powershell
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: every test file passes; typecheck and production build exit 0. Do not run typecheck concurrently with Next build because both access `.next/types`.

- [ ] **Step 3: Run existing Health API gates**

```powershell
cargo fmt --check
cargo test -p raven-api --test routes_health
```

Expected: formatting and all Health route tests PASS without backend edits.

- [ ] **Step 4: Check scope, docs, and user-owned files**

```powershell
git diff --check
git status --short
git diff -- frontend/package-lock.json Cargo.lock
```

Expected: only planned Medication/frontend/test files differ; `Cargo.lock` is untouched; the pre-existing user-owned `frontend/package-lock.json` change remains unstaged and unchanged. Stable docs already describe Medication events and the five Health tabs; update only a statement proven false.

- [ ] **Step 5: Request independent review and fix evidenced findings only**

Use `superpowers:requesting-code-review`. Validate each finding against code and a failing regression before editing. Use one NFLOW commit per independent fix and do not introduce speculative abstractions.

- [ ] **Step 6: Record final evidence**

Report exact test-file/test counts, typecheck/build/API results, commit list, changed files, worktree status, preserved user lockfile state, and any accepted external baseline warning.
