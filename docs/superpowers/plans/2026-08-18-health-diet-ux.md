# Health Diet UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline Health Diet form and recent-record list with an active-only saved-view table, Add dialog, and ToDo-style detail workflow.

**Architecture:** Keep diet records in the existing Health service and SQLite store. Add the missing atomic image replacement/removal HTTP adapters, load active Diet records through the existing paginated endpoint, derive table rows in a pure frontend model, and reuse the shared table-view and ToDo tag primitives. This plan also removes Timeline from Health navigation and makes Diet the default while leaving the existing Trends tab in place until the Reports plan replaces it.

**Tech Stack:** Rust 2024, Axum, React 18, TypeScript, Vitest, Testing Library, existing Raven API and table-view primitives.

---

## Scope and File Map

Create:

- `frontend/src/features/health/model/health-table-views.ts` — Diet view settings and normalization.
- `frontend/src/features/health/model/diet-table.ts` — active Diet row projection, filtering, sorting, and grouping.
- `frontend/src/features/health/ui/HealthTableViewHeader.tsx` — Health saved-view controls and header actions.
- `frontend/src/features/health/ui/DietTable.tsx` — accessible grouped Diet table.
- `frontend/src/features/health/ui/DietCreateDialog.tsx` — modal Diet creation.
- `frontend/src/features/health/ui/DietDetail.tsx` — Diet editing and lifecycle detail.
- `frontend/src/features/workbench/ui/TagsInput.tsx` — the existing ToDo tag input extracted without behavior changes.
- `frontend/tests/domain/health-table-views.spec.ts`
- `frontend/tests/domain/diet-table.spec.ts`
- `frontend/tests/presentation/diet-panel.spec.tsx`

Modify:

- `raven-api/src/dto/health.rs` — image removal field for Diet PATCH metadata.
- `raven-api/src/routes/health.rs` — atomic Diet update-with-image route and removal wiring.
- `raven-api/tests/routes_health.rs` — HTTP contract tests.
- `frontend/src/domain/workbench/navigation.ts` — Diet-first Health navigation without Timeline.
- `frontend/src/features/health/api/health-api.ts` — Diet update-image and remove-image requests.
- `frontend/src/features/health/hooks/useHealthController.ts` — Diet collection, mutations, and saved views.
- `frontend/src/features/health/model/health-model.ts` — Diet update media intent.
- `frontend/src/features/health/ui/DietPanel.tsx` — table/dialog/detail orchestration.
- `frontend/src/features/health/ui/HealthForms.tsx` — shared tag input and approved field order.
- `frontend/src/features/health/ui/HealthPanel.tsx` — Diet default.
- `frontend/src/features/workbench/ui/MainPanel.tsx` — import the extracted tag input.
- `frontend/src/features/workbench/model/planner-model.ts` — Health-specific filter/group field literals.
- `frontend/tests/presentation/health-forms.spec.tsx`
- `frontend/tests/presentation/health-panel.spec.tsx`
- `frontend/tests/presentation/quick-add.spec.tsx`
- `frontend/tests/presentation/workbench-wireframe.spec.tsx`
- `docs/operations/api-reference.md` — Diet image update contract.

Do not stage the pre-existing `frontend/package-lock.json` change.

### Task 1: Add atomic Diet image update adapters

**Files:**
- Modify: `raven-api/src/dto/health.rs`
- Modify: `raven-api/src/routes/health.rs`
- Modify: `raven-api/tests/routes_health.rs`
- Modify: `frontend/src/features/health/model/health-model.ts`
- Modify: `frontend/src/features/health/api/health-api.ts`
- Test: `frontend/tests/domain/health-model.spec.ts`

- [ ] **Step 1: Write failing API route tests**

Add route tests that create a Diet entry, then verify both supported media mutations:

```rust
let update_metadata = json!({ "food_name": "Updated salad" }).to_string();
let replaced = Request::patch(format!("/api/v1/health/diet/{id}/with-image"))
    .header(CONTENT_TYPE, "image/png")
    .header("x-raven-diet-metadata", update_metadata)
    .body(Body::from(PNG))
    .unwrap();
let replaced_response = app.clone().oneshot(replaced).await.unwrap();
assert_eq!(replaced_response.status(), StatusCode::OK);

let removed = Request::patch(format!("/api/v1/health/diet/{id}"))
    .header(CONTENT_TYPE, "application/json")
    .body(Body::from(json!({ "remove_image": true }).to_string()))
    .unwrap();
let removed_response = app.oneshot(removed).await.unwrap();
assert_eq!(removed_response.status(), StatusCode::OK);
let removed = body(removed_response).await;
assert!(removed["media_id"].is_null());
```

Also assert unsupported content types, empty bytes, oversized images, malformed metadata, and `remove_image: true` combined with a replacement upload are rejected without changing the entry.

- [ ] **Step 2: Run the route tests and verify RED**

Run: `cargo test -p raven-api --test routes_health diet_image_update -- --nocapture`

Expected: FAIL because `/diet/:id/with-image` and `remove_image` do not exist.

- [ ] **Step 3: Implement the minimum adapters**

Add this DTO field:

```rust
#[serde(default)]
pub remove_image: bool,
```

Route JSON PATCH media intent through the existing domain command:

```rust
media: if body.remove_image {
    DietMediaUpdate::Remove
} else {
    DietMediaUpdate::Preserve
},
```

Register `PATCH /diet/:id/with-image`. Parse `UpdateDietBody` from the existing ASCII metadata header, validate the same JPEG/PNG/WebP and size constraints as creation, reject `remove_image`, and call `service.update_diet` once with `DietMediaUpdate::Replace(MediaUpload::new(content_type, bytes))`. Do not write files in the HTTP adapter.

Extend the frontend update contract:

```ts
export type DietUpdate = Partial<DietInput> & {
  expectedUpdatedAt?: string;
  reason?: string | null;
  removeImage?: boolean;
};
```

Add a `dietUpdateBody` helper used by both update methods so `remove_image` and optimistic
concurrency metadata serialize identically, then add:

```ts
async updateDietWithImage(
  id: string,
  input: { image: Blob; metadata: DietUpdate },
): Promise<DietEntry> {
  return mapDietEntry(await requestJson(`${ROOT}/diet/${segment(id)}/with-image`, {
    method: "PATCH",
    body: input.image,
    headers: {
      "content-type": input.image.type,
      "x-raven-diet-metadata": asciiJson(dietUpdateBody(input.metadata)),
    },
  }));
}
```

- [ ] **Step 4: Run focused backend and wire tests**

Run:

```powershell
cargo test -p raven-api --test routes_health
npm --prefix frontend test -- health-model.spec.ts
```

Expected: both commands PASS.

- [ ] **Step 5: Commit the adapter boundary**

```powershell
git add raven-api/src/dto/health.rs raven-api/src/routes/health.rs raven-api/tests/routes_health.rs frontend/src/features/health/model/health-model.ts frontend/src/features/health/api/health-api.ts frontend/tests/domain/health-model.spec.ts
git diff --cached --check
git commit -m "[ADD] Support Health Diet image updates"
```

### Task 2: Define Diet saved views and pure table derivation

**Files:**
- Create: `frontend/src/features/health/model/health-table-views.ts`
- Create: `frontend/src/features/health/model/diet-table.ts`
- Modify: `frontend/src/features/workbench/model/planner-model.ts`
- Test: `frontend/tests/domain/health-table-views.spec.ts`
- Test: `frontend/tests/domain/diet-table.spec.ts`

- [ ] **Step 1: Write failing settings and derivation tests**

Cover these exact contracts:

```ts
expect(defaultHealthTableSettings("health.diet").sortRules).toEqual([
  { id: "health.diet-default-sort", field: "date", direction: "desc" },
]);
expect(healthFilterFieldsForScope("health.diet")).toEqual([
  "date", "meal_type", "food", "tags", "has_photo",
]);
expect(healthGroupOptionsForScope("health.diet").map(({ value }) => value)).toEqual([
  "none", "month", "week", "day", "meal_type", "tag", "has_photo",
]);
```

For `deriveDietGroups`, assert archived rows are absent; AND/OR filters work; tags match through the shared planner matcher; numeric timestamps sort newest first; multiple sorts use ID as the final tie-breaker; day/week/month use local calendar dates; meal, tag, and photo grouping honor hidden/manual/alphabetical settings; and an unmatched view returns one empty ungrouped group.

- [ ] **Step 2: Run model tests and verify RED**

Run: `npm --prefix frontend test -- health-table-views.spec.ts diet-table.spec.ts`

Expected: FAIL because the model modules and Health field literals are absent.

- [ ] **Step 3: Add Health table settings**

Append only `"meal_type"`, `"food"`, and `"has_photo"` to the existing
`PlannerFilterField` union. Append only `"meal_type"` and `"has_photo"` to the existing
`PlannerGroupBy` union.

Add matching field types (`meal_type` select, `food` text, `has_photo` select) and implement `health-table-views.ts` with:

```ts
export const healthTableScopeIds = ["health.diet"] as const;
export type HealthTableScopeId = (typeof healthTableScopeIds)[number];
export const healthTableViewSettingsAdapter = {
  defaultSettings: defaultHealthTableSettings,
  normalizeSettings: normalizeHealthTableSettings,
  cloneSettings: clonePlannerTableSettings,
} satisfies TableViewSettingsAdapter<HealthTableScopeId, PlannerTableSettings>;
```

Normalize persisted filter, sort, and group values against scope allowlists so Planner and Ledger cannot accept Health-only fields.

- [ ] **Step 4: Implement Diet row derivation**

Use this public model:

```ts
export type DietRow = {
  id: string;
  entry: DietEntry;
  date: string;
  timeLabel: string;
  mealType: MealType;
  mealLabel: string;
  food: string;
  tags: string[];
  hasPhoto: boolean;
  note: string;
};

export type DietRowGroup = { key: string; label: string | null; rows: DietRow[] };

export function deriveDietGroups(
  entries: readonly DietEntry[],
  settings: PlannerTableSettings,
  now = new Date(),
): DietRowGroup[];
```

Reuse `effectivePlannerFilterRules`, `matchesPlannerFilterValue`, `localCalendarDate`, and `orderVisiblePlannerGroups`. Do not add a second date matcher or group ordering implementation.

- [ ] **Step 5: Run model tests and typecheck**

Run:

```powershell
npm --prefix frontend test -- health-table-views.spec.ts diet-table.spec.ts planner-model.spec.ts ledger-table-views.spec.ts
npm --prefix frontend run typecheck
```

Expected: all selected tests and typecheck PASS.

- [ ] **Step 6: Commit the model**

```powershell
git add frontend/src/features/health/model/health-table-views.ts frontend/src/features/health/model/diet-table.ts frontend/src/features/workbench/model/planner-model.ts frontend/tests/domain/health-table-views.spec.ts frontend/tests/domain/diet-table.spec.ts
git diff --cached --check
git commit -m "[ADD] Derive Health Diet table views"
```

### Task 3: Add Diet collection, mutations, and saved-view state

**Files:**
- Modify: `frontend/src/features/health/hooks/useHealthController.ts`
- Test: `frontend/tests/presentation/health-panel.spec.tsx`
- Test: `frontend/tests/presentation/diet-panel.spec.tsx`

- [ ] **Step 1: Write failing controller tests**

Assert the controller drains `healthApi.listDiet` in 200-row pages, exposes only API-returned active entries, coalesces concurrent refreshes, ignores stale completions, and distinguishes blocking initial failure from non-blocking refresh failure.

Assert `createDiet`, `updateDiet`, `updateDietWithImage`, and `archiveDiet` perform exactly one mutation and then refresh Diet, Timeline, and Trends. If the mutation succeeds and refresh fails, assert a `HealthMutationRefreshError` is thrown and a retry calls reads only.

Add saved-view tests for load, normalization, queued pre-load commands, create/rename/save/delete/select confirmation, last-write-wins failure reporting, and persistence at `/api/v1/preferences/health.views.v1`.

- [ ] **Step 2: Run controller tests and verify RED**

Run: `npm --prefix frontend test -- health-panel.spec.tsx diet-panel.spec.tsx`

Expected: FAIL because Diet collection and view-controller methods are missing.

- [ ] **Step 3: Implement Diet state and refresh semantics**

Add to `HealthState`:

```ts
dietStatus: "idle" | "loading" | "loaded" | "error";
dietError: string | null;
dietEntries: DietEntry[];
```

Add controller methods:

```ts
refreshDiet(): Promise<boolean>;
createDiet(input: DietInput, image?: Blob): Promise<void>;
updateDiet(id: string, input: DietUpdate, image?: Blob): Promise<void>;
archiveDiet(id: string): Promise<void>;
```

Drain pages until a page contains fewer than 200 rows. Use the existing generation pattern and keep the last loaded Diet rows during refresh errors. Keep Timeline refreshes temporarily because Bowel, Medication, and Health Metrics still consume that collection.

- [ ] **Step 4: Implement Health saved-view state**

Expose the same controller surface used by Ledger, typed to `HealthTableScopeId`:

```ts
tableTabs(scope): TableViewTabsState<PlannerTableSettings>;
tableSettings(scope): PlannerTableSettings;
tableIsDirty(scope): boolean;
updateTableSettings(scope, updater): void;
selectTableTab(scope, tabId): void;
saveTableTab(scope): void;
createTableTab(scope, name): boolean;
renameTableTab(scope, tabId, name): boolean;
requestDeleteTableTab(scope, tabId): void;
confirmTableViewAction(): void;
cancelTableViewAction(): void;
```

Reuse functions from `table-view-tabs.ts`; do not duplicate their normalization or naming rules.

- [ ] **Step 5: Run controller tests and typecheck**

Run:

```powershell
npm --prefix frontend test -- health-panel.spec.tsx diet-panel.spec.tsx ledger-panel.spec.tsx
npm --prefix frontend run typecheck
```

Expected: selected suites and typecheck PASS.

- [ ] **Step 6: Commit controller behavior**

```powershell
git add frontend/src/features/health/hooks/useHealthController.ts frontend/tests/presentation/health-panel.spec.tsx frontend/tests/presentation/diet-panel.spec.tsx
git diff --cached --check
git commit -m "[UPDATE] Add Health Diet collection state"
```

### Task 4: Reuse ToDo tags and build the Diet Add dialog

**Files:**
- Create: `frontend/src/features/workbench/ui/TagsInput.tsx`
- Create: `frontend/src/features/health/ui/DietCreateDialog.tsx`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/features/health/ui/HealthForms.tsx`
- Test: `frontend/tests/presentation/health-forms.spec.tsx`
- Test: `frontend/tests/presentation/quick-add.spec.tsx`
- Test: `frontend/tests/presentation/diet-panel.spec.tsx`

- [ ] **Step 1: Write failing interaction tests**

Assert Diet tag input can select an existing Diet tag, create a comma-separated new tag, reject duplicates, remove a chip, and never show ToDo-only options. Assert the dialog field order is Time, Meal, Food, Tags, Photo, Note; image is optional; non-image files fail without closing; pending blocks Escape and duplicate submission; failure preserves every field; success closes and restores focus.

- [ ] **Step 2: Run form tests and verify RED**

Run: `npm --prefix frontend test -- health-forms.spec.tsx quick-add.spec.tsx diet-panel.spec.tsx`

Expected: FAIL for the comma input and inline form behavior.

- [ ] **Step 3: Extract the existing tag component without changing ToDo**

Move `TagsInput`, `parseTagInput`, and `formatTags` from `MainPanel.tsx` into `TagsInput.tsx` and export them:

```ts
export function parseTagInput(value: string): string[];
export function formatTags(tags: readonly string[]): string;
export function TagsInput(props: {
  label: string;
  value: string[];
  tagOptions: string[];
  onCommit(tags: string[]): void;
  portalDropdown?: boolean;
}): React.ReactNode;
```

Keep the existing keyboard, listbox, portal, chip, and focus behavior byte-for-byte where possible. Update `MainPanel.tsx` to import it and run its existing tests before changing Diet.

- [ ] **Step 4: Refine DietForm and wrap it in the modal**

Change `DietForm` to accept `tagOptions`, store `tags: string[]`, render `TagsInput`, and order Photo before Note. Keep `defaultLocalDateTime`, RFC3339 conversion, image MIME validation, and pending/error behavior.

`DietCreateDialog` uses `useModalIsolation`, a body portal, trapped Tab focus, Escape close only while idle, and `returnFocusRef`. It closes only after `controller.createDiet` and all required refreshes succeed.

- [ ] **Step 5: Run form, Quick Add, and ToDo regressions**

Run:

```powershell
npm --prefix frontend test -- health-forms.spec.tsx quick-add.spec.tsx workbench-wireframe.spec.tsx diet-panel.spec.tsx
npm --prefix frontend run typecheck
```

Expected: all selected suites and typecheck PASS.

- [ ] **Step 6: Commit the shared input and dialog**

```powershell
git add frontend/src/features/workbench/ui/TagsInput.tsx frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/features/health/ui/HealthForms.tsx frontend/src/features/health/ui/DietCreateDialog.tsx frontend/tests/presentation/health-forms.spec.tsx frontend/tests/presentation/quick-add.spec.tsx frontend/tests/presentation/diet-panel.spec.tsx
git diff --cached --check
git commit -m "[ADD] Build Health Diet creation dialog"
```

### Task 5: Build the saved-view Diet table

**Files:**
- Create: `frontend/src/features/health/ui/HealthTableViewHeader.tsx`
- Create: `frontend/src/features/health/ui/DietTable.tsx`
- Modify: `frontend/src/features/health/ui/DietPanel.tsx`
- Test: `frontend/tests/presentation/diet-panel.spec.tsx`

- [ ] **Step 1: Write failing table tests**

Assert exact columns, signed local time rendering, meal labels, tag chips, photo presence, note, active-only rows, grouped bodies, empty copies (`No diet entries yet.` and `No diet entries match this view.`), keyboard row activation, contextual checkbox names, visible select-all, selection persistence across filters, and right-aligned Filter/Sort/Group/Add/Delete controls.

Assert initial loading, blocking initial error with Retry, non-blocking refresh error with the
last complete table retained, and stale response protection.

Assert batch archive snapshots selected visible IDs, executes sequentially, removes successes, retains failed and unattempted IDs, preserves the target snapshot during rerender, and restores focus to Delete on cancel/failure or Add on success.

- [ ] **Step 2: Run Diet presentation tests and verify RED**

Run: `npm --prefix frontend test -- diet-panel.spec.tsx`

Expected: FAIL because the table/header components do not exist.

- [ ] **Step 3: Implement the Health table header**

Build `HealthTableViewHeader` around `TableViewTabs`, `TableViewControls`, and `TableViewActivePills`. Configure Diet labels and candidates from active logical rows, pass the current Health settings adapter, and expose Add and Delete buttons with the same accessible behavior as Ledger.

- [ ] **Step 4: Implement DietTable and panel orchestration**

`DietTable` accepts derived groups, active row count, selection, and row callbacks. Rows use `role="button"`, Enter/Space activation, checkbox event isolation, and an indeterminate select-all checkbox.

`DietPanel` derives visible rows from current settings and active rows from defaults, reconciles selection only against active truth, snapshots deletion targets before confirmation, and swaps list/detail without losing saved-view state.

- [ ] **Step 5: Run focused presentation and accessibility tests**

Run:

```powershell
npm --prefix frontend test -- diet-panel.spec.tsx health-panel.spec.tsx workbench-wireframe.spec.tsx
npm --prefix frontend run typecheck
```

Expected: all selected suites and typecheck PASS.

- [ ] **Step 6: Commit the Diet table**

```powershell
git add frontend/src/features/health/ui/HealthTableViewHeader.tsx frontend/src/features/health/ui/DietTable.tsx frontend/src/features/health/ui/DietPanel.tsx frontend/tests/presentation/diet-panel.spec.tsx
git diff --cached --check
git commit -m "[UPDATE] Replace Health Diet list workflow"
```

### Task 6: Build Diet detail editing and archive behavior

**Files:**
- Create: `frontend/src/features/health/ui/DietDetail.tsx`
- Modify: `frontend/src/features/health/ui/DietPanel.tsx`
- Test: `frontend/tests/presentation/diet-panel.spec.tsx`

- [ ] **Step 1: Write failing detail tests**

Assert Back/Undo/Redo/Save/Delete order, timestamps, approved field order, ToDo tag behavior, keyboard shortcuts, consecutive text-edit coalescing, dirty Back confirmation, unchanged Save disabling, optimistic-concurrency timestamp, image preserve/replace/remove payload selection, failed-save draft retention, refresh-only retry, delete confirmation, stale-row exit, and focus restoration.

- [ ] **Step 2: Run detail tests and verify RED**

Run: `npm --prefix frontend test -- diet-panel.spec.tsx`

Expected: FAIL because `DietDetail` is absent.

- [ ] **Step 3: Implement draft history and minimal update payloads**

Use one reducer with `past`, `present`, `future`, and an optional coalescing group. Build a `DietUpdate` containing only changed scalar/tag fields plus `expectedUpdatedAt`. Select exactly one media path:

```ts
if (draft.newImage) {
  await controller.updateDiet(row.id, patch, draft.newImage);
} else {
  await controller.updateDiet(row.id, {
    ...patch,
    removeImage: row.mediaId !== null && draft.removeImage,
  });
}
```

Never call a text PATCH followed by a separate image mutation.

- [ ] **Step 4: Implement detail lifecycle and focus**

Use the existing `DestructiveConfirmationDialog`. Confirm dirty navigation, archive active rows only, close detail when refreshed active truth no longer contains its ID, and keep a mutation tombstone until a successful Diet refresh confirms archival.

- [ ] **Step 5: Run detail and regression tests**

Run:

```powershell
npm --prefix frontend test -- diet-panel.spec.tsx health-forms.spec.tsx quick-add.spec.tsx workbench-wireframe.spec.tsx
npm --prefix frontend run typecheck
```

Expected: all selected suites and typecheck PASS.

- [ ] **Step 6: Commit the detail workflow**

```powershell
git add frontend/src/features/health/ui/DietDetail.tsx frontend/src/features/health/ui/DietPanel.tsx frontend/tests/presentation/diet-panel.spec.tsx
git diff --cached --check
git commit -m "[ADD] Build Health Diet detail workflow"
```

### Task 7: Make Diet the Health entry point and verify the slice

**Files:**
- Modify: `frontend/src/domain/workbench/navigation.ts`
- Modify: `frontend/src/features/health/ui/HealthPanel.tsx`
- Modify: `frontend/tests/presentation/health-panel.spec.tsx`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`
- Modify: `docs/operations/api-reference.md`

- [ ] **Step 1: Write failing navigation tests**

Assert Health navigation lists Diet first, omits Timeline, resolves the Health parent to Diet, preserves Bowel/Medication/Health Metrics/Trends until their later plans, and renders Diet when `HealthPanel` receives no leaf.

- [ ] **Step 2: Run navigation tests and verify RED**

Run: `npm --prefix frontend test -- health-panel.spec.tsx workbench-wireframe.spec.tsx`

Expected: FAIL because Health still defaults to Timeline.

- [ ] **Step 3: Update navigation and API reference**

Remove `timeline` from `HealthTabId`, `healthTabs`, and `healthLeafTabIds`; make `resolveSelection("health")` return Diet; and default `HealthPanel` to Diet. Keep the Timeline read model temporarily for unconverted record tabs.

Render `TableViewTabConfirmationDialog` once in `HealthPanel` and expose the Health view-save
error with `Retry view save`, matching the existing Ledger integration. Add presentation
coverage for dirty tab selection, delete confirmation, cancellation, confirmation, and retry.

Document `PATCH /api/v1/health/diet/:id/with-image`, its raw-body/header contract, and JSON `remove_image` behavior beside the existing creation endpoint. State the same size, MIME, and safe-error rules.

- [ ] **Step 4: Run all relevant verification gates**

Run sequentially:

```powershell
cargo fmt --check
cargo test -p health-engine
cargo test -p raven-api
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
git diff --check
```

Expected: every command exits 0. If a pre-existing unrelated gate fails, capture the exact command and failure without modifying unrelated code.

- [ ] **Step 5: Commit navigation and documentation**

```powershell
git add frontend/src/domain/workbench/navigation.ts frontend/src/features/health/ui/HealthPanel.tsx frontend/tests/presentation/health-panel.spec.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx docs/operations/api-reference.md
git diff --cached --check
git commit -m "[UPDATE] Open Health Journal on Diet"
```

- [ ] **Step 6: Final scope audit**

Run:

```powershell
git status --short
git log --oneline -n 10
git diff a1b65a2..HEAD --stat
```

Expected: only the planned Diet slice and the pre-existing unstaged `frontend/package-lock.json` change remain visible; Bowel, Medication, Health Metrics, and Reports behavior is otherwise unchanged.

## Follow-Up Plans

After this slice is accepted, write and execute separate plans in this order:

1. Bowel table, Add dialog, and detail workflow
2. Medication table, Add dialog, and detail workflow
3. Health Metrics daily projection and atomic daily mutation API
4. Health Reports engine, API, dashboard, and drilldown
