# Health Metrics UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy Health Metrics inline form/list with one active logical row per local date, fixed measurements, saved views, atomic daily creation/edit/archive, and browser-backed detail navigation.

**Architecture:** Keep the existing independent Health events and SQLite source of truth. Extend the existing paginated events endpoint with a daily-only filter and extend the existing daily-metrics service mutation so upserts and explicit archives for one local date share one transaction and audit request ID. Build the UI as a deterministic projection over those active daily events, reusing the Health table-view, modal, recovery, bounded-history, and browser-detail primitives already proven by Diet, Bowel, and Medication.

**Tech Stack:** Rust 2024, rusqlite, axum/serde, TypeScript, React 18, Next.js 14, Vitest, Testing Library

---

## File map

**New files**

- `frontend/src/features/health/model/health-metrics-table.ts` — fixed metric identities, one-row-per-local-date projection, filtering, sorting, and grouping.
- `frontend/src/features/health/ui/HealthMetricsCreateDialog.tsx` — isolated Add modal around the fixed daily form.
- `frontend/src/features/health/ui/HealthMetricsTable.tsx` — accessible logical-row table and selection.
- `frontend/src/features/health/ui/HealthMetricsDetail.tsx` — immutable daily snapshot editor, bounded history, atomic save/archive, and browser navigation.
- `frontend/tests/domain/health-metrics-table.spec.ts` — projection and saved-view contract.
- `frontend/tests/presentation/health-metrics-panel.spec.tsx` — collection, dialog, table, detail, history, archive, and recovery contract.

**Modified files**

- `health-engine/src/application/commands.rs` — optional optimistic timestamp for daily writes and explicit daily archive targets.
- `health-engine/src/application/events.rs` — one transactional daily save containing upserts and archives.
- `health-engine/src/application/ports.rs` — daily-only event query flag.
- `health-engine/src/infrastructure/sqlite/repository.rs` — apply the daily-only query predicate.
- `health-engine/tests/integration/daily_upsert.rs` — atomic clear/archive, conflict, rollback, and query coverage.
- `raven-api/src/dto/health.rs` — backward-compatible daily write/archive JSON fields.
- `raven-api/src/routes/health.rs` — parse `daily_only` and the extended daily mutation.
- `raven-api/tests/routes_health.rs` — HTTP round-trip and atomicity contract.
- `docs/operations/api-reference.md` — document the current daily-only query and atomic daily mutation.
- `frontend/src/features/health/api/health-api.ts` — daily-only query and atomic mutation request types.
- `frontend/src/features/health/model/health-table-views.ts` — register `health.metrics` and exact fields/groups.
- `frontend/src/features/workbench/model/planner-model.ts` — add fixed Health Metrics view literals.
- `frontend/src/features/workbench/ui/TableViewControls.tsx` — labels and number/select filter types for those literals.
- `frontend/src/features/health/hooks/useHealthController.ts` — dedicated paginated Metrics collection and mutation refresh boundary.
- `frontend/src/features/health/ui/HealthForms.tsx` — fixed Date/Weight/Sleep/CRP/Calprotectin/Condition/Note form and preload support.
- `frontend/src/features/health/ui/HealthMetricsPanel.tsx` — replace inline form/list with the full workflow.
- `frontend/src/features/health/ui/HealthPanel.tsx` — retain Metrics archive recovery across Health leaf switches.
- `frontend/tests/domain/health-table-views.spec.ts` — scope isolation.
- `frontend/tests/domain/planner-model.spec.ts` — literal normalization boundaries.
- `frontend/tests/domain/health-model.spec.ts` — request serialization and fixed identity mapping.
- `frontend/tests/presentation/health-forms.spec.tsx` — fixed form/dialog contract.
- `frontend/tests/presentation/health-panel.spec.tsx` — leaf lifetime and saved-view confirmation wiring.
- `frontend/tests/presentation/diet-panel.spec.tsx`, `bowel-panel.spec.tsx`, `medication-panel.spec.tsx`, `quick-add.spec.tsx` — controller fixture and non-leak boundaries only.

Do not add a summary table, schema migration, new route family, chart library, custom metric, restore/purge UI, or generic Health record framework. Reports remains the next independent plan; this plan does not relabel the legacy Trends implementation as Reports.

---

### Task 1: Make one daily mutation atomic

**Files:**

- Modify: `health-engine/src/application/commands.rs`
- Modify: `health-engine/src/application/events.rs`
- Modify: `health-engine/src/application/ports.rs`
- Modify: `health-engine/src/infrastructure/sqlite/repository.rs`
- Modify: `health-engine/tests/integration/daily_upsert.rs`
- Modify: `raven-api/src/dto/health.rs`
- Modify: `raven-api/src/routes/health.rs`
- Modify: `raven-api/tests/routes_health.rs`
- Modify: `docs/operations/api-reference.md`

- [ ] **Step 1: Write failing service tests for the complete daily contract**

Add tests that create Weight, Sleep, CRP, Fecal calprotectin, and Overall condition for one local date, then submit a second mutation that updates Weight, leaves Sleep unchanged, archives CRP, and creates Condition. Assert one transaction produces the final four active identities, archived CRP remains available only through archived reads, unchanged Sleep gets no new audit, and every changed audit shares one request ID.

Add direct cases for:

```rust
DailyMetricInput {
    occurred_at: datetime!(2026-08-20 09:00:00 +09:00),
    details,
    note: None,
    actor: "tester".into(),
    expected_updated_at: Some(opened.updated_at()),
}

DailyMetricArchive {
    id: crp.id().as_str().to_string(),
    expected_updated_at: Some(crp.updated_at()),
}
```

Assert stale write and stale archive versions reject the entire batch, upsert/archive identity overlap is rejected, mixed local dates are rejected, an audit/storage failure rolls back every update/archive/audit, and an empty mutation is rejected.

- [ ] **Step 2: Run the service tests and verify RED**

Run:

```powershell
cargo test -p health-engine --test integration daily_upsert -- --nocapture
```

Expected: FAIL because `DailyMetricArchive`, optimistic daily versions, atomic archives, and the daily-only query do not exist.

- [ ] **Step 3: Add the minimum command and query surface**

Use these public application shapes:

```rust
pub struct DailyMetricInput {
    pub occurred_at: OffsetDateTime,
    pub details: HealthEventDetails,
    pub note: Option<String>,
    pub actor: String,
    pub expected_updated_at: Option<OffsetDateTime>,
}

pub struct DailyMetricArchive {
    pub id: String,
    pub expected_updated_at: Option<OffsetDateTime>,
}
```

Keep `upsert_daily_metrics(inputs)` as a compatibility wrapper over:

```rust
pub fn save_daily_metrics(
    &mut self,
    inputs: Vec<DailyMetricInput>,
    archives: Vec<DailyMetricArchive>,
) -> HealthResult<Vec<HealthEvent>>
```

Validate all input actors/details/identities and all archive IDs/versions before the first write. Resolve archive targets inside the same immediate transaction, prove each target is the active `daily_upsert` row for its local date/category/metric key through `get_daily_event`, require exactly one local date across the mutation, reject an input/archive identity collision, then update/create/archive with one request ID. Reuse the existing event rehydration, version, next-update-time, audit, rollback, and transaction helpers; do not call the public lifecycle method from inside a second transaction.

Extend `EventQuery` with:

```rust
pub const fn daily_only(mut self, daily_only: bool) -> Self {
    self.daily_only = daily_only;
    self
}
```

and add `AND (?4 = 0 OR daily_upsert = 1)` to the existing event-list SQL before limit/offset. Existing queries keep `daily_only = false`.

- [ ] **Step 4: Add failing HTTP tests and implement the backward-compatible JSON contract**

The existing endpoint remains `POST /api/v1/health/metrics/daily` and accepts:

```json
{
  "metrics": [{
    "occurred_at": "2026-08-20T09:00:00+09:00",
    "details": {"kind":"weight","value":68.2,"unit":"kg"},
    "expected_updated_at": "2026-08-20T01:00:00Z"
  }],
  "archives": [{
    "id": "00000000-0000-4000-8000-000000000001",
    "expected_updated_at": "2026-08-20T01:00:00Z"
  }]
}
```

`archives` and each `expected_updated_at` default to absent so existing clients remain valid. Require `1..=366` combined operations. Permit an empty `metrics` array only when `archives` is non-empty. Parse `daily_only=true` on the existing events list route and reject unknown query/body fields as before.

- [ ] **Step 5: Run backend gates and commit**

Run:

```powershell
cargo fmt --check
cargo test -p health-engine --test integration daily_upsert
cargo test -p raven-api --test routes_health
```

Expected: PASS, including rollback and conflict cases.

Commit only the files in this task:

```powershell
git commit -m "[UPDATE] Make Health daily metrics atomic"
```

---

### Task 2: Define the daily row and saved-view model

**Files:**

- Create: `frontend/src/features/health/model/health-metrics-table.ts`
- Create: `frontend/tests/domain/health-metrics-table.spec.ts`
- Modify: `frontend/src/features/health/model/health-table-views.ts`
- Modify: `frontend/src/features/workbench/model/planner-model.ts`
- Modify: `frontend/src/features/workbench/ui/TableViewControls.tsx`
- Modify: `frontend/tests/domain/health-table-views.spec.ts`
- Modify: `frontend/tests/domain/planner-model.spec.ts`

- [ ] **Step 1: Write failing scope and projection tests**

Require this exact scope contract:

```ts
expect(healthTableScopeIds).toContain("health.metrics");
expect(healthFilterFieldsForScope("health.metrics")).toEqual([
  "date", "weight", "sleep", "crp", "calprotectin", "condition",
]);
expect(healthSortFieldsForScope("health.metrics")).toEqual([
  "date", "weight", "sleep", "crp", "calprotectin", "condition",
]);
expect(healthGroupOptionsForScope("health.metrics").map(({ value }) => value)).toEqual([
  "none", "month", "week",
]);
```

Build fixtures for the five fixed identities and assert one row per local date, fixed units, newest-date default, numeric sorts with missing values consistently last, AND/OR presence/value filters, local week/month grouping, hidden/manual/reverse group ordering, and a final ascending date/ID identity tie. Archived, non-daily, arbitrary lab, and ordinary symptom events must not enter the projection.

Prove Metrics-only fields/groups are rejected by Diet, Bowel, Medication, Ledger, and Planner normalizers.

- [ ] **Step 2: Run the model tests and verify RED**

Run:

```powershell
npm --prefix frontend test -- health-metrics-table.spec.ts health-table-views.spec.ts planner-model.spec.ts
```

Expected: FAIL because `health.metrics`, the fixed view literals, and the row projection do not exist.

- [ ] **Step 3: Implement the fixed projection**

Use these exact identities:

```ts
export const healthMetricIdentities = {
  weight: { category: "weight", metricKey: "body_weight", name: "Body weight", unit: "kg" },
  sleep: { category: "sleep", metricKey: "sleep_duration", name: "Sleep", unit: "hours" },
  crp: { category: "lab", metricKey: "crp", name: "CRP", unit: "mg/L" },
  calprotectin: {
    category: "lab", metricKey: "fecal_calprotectin",
    name: "Fecal calprotectin", unit: "µg/g",
  },
  condition: {
    category: "symptom", metricKey: "overall_condition",
    name: "Overall condition", unit: null,
  },
} as const;
```

Define:

```ts
export type HealthMetricsRow = {
  id: string;                 // local date
  date: string;
  events: Partial<Record<HealthMetricField, HealthEvent>>;
  weight: number | null;
  sleep: number | null;
  crp: number | null;
  calprotectin: number | null;
  condition: number | null;
  note: string;
  createdAt: string;
  updatedAt: string;
};
```

Group active, daily-only fixed events by `localCalendarDate(new Date(event.occurredAt))`. Condition note comes from the Overall condition event. `createdAt` is the earliest member timestamp and `updatedAt` the latest. Derive filtering, deterministic multi-sort, and month/week grouping by reusing `matchesPlannerFilterValue`, `isoWeekStart`, and `orderVisiblePlannerGroups`.

- [ ] **Step 4: Register exact controls without leaking fields**

Add the six number/date literals only once to the existing shared unions and exhaustive control maps. Do not expose date as a `day` group: Metrics permits only `none`, `month`, and `week`.

- [ ] **Step 5: Run frontend model gates and commit**

Run:

```powershell
npm --prefix frontend test -- health-metrics-table.spec.ts health-table-views.spec.ts planner-model.spec.ts bowel-table.spec.ts medication-table.spec.ts diet-table.spec.ts ledger-table-views.spec.ts
npm --prefix frontend run typecheck
```

Expected: PASS with no scope leakage.

Commit:

```powershell
git commit -m "[ADD] Derive Health Metrics daily views"
```

---

### Task 3: Add the dedicated Metrics controller collection

**Files:**

- Modify: `frontend/src/features/health/api/health-api.ts`
- Modify: `frontend/src/features/health/hooks/useHealthController.ts`
- Create: `frontend/tests/presentation/health-metrics-panel.spec.tsx`
- Modify fixture surfaces only in: `health-forms.spec.tsx`, `health-panel.spec.tsx`, `diet-panel.spec.tsx`, `bowel-panel.spec.tsx`, `medication-panel.spec.tsx`, `quick-add.spec.tsx`
- Modify: `frontend/tests/domain/health-model.spec.ts`

- [ ] **Step 1: Write failing API/controller tests**

Assert initial mount drains `listEvents({ dailyOnly: true, limit: 200, offset })`, stores raw API-validated events unfiltered, coalesces ordinary refreshes, retains loaded rows on failure, ignores stale success/error completions, and lets a forced post-mutation refresh supersede an older request.

Assert `saveMetrics({ metrics, archives })` performs exactly one mutation followed by exactly one Metrics, Timeline, and Trends read. A committed mutation followed by any failed read throws `HealthMutationRefreshError`; `refreshMetrics()` repeats only those reads and never repeats the mutation. Diet/Bowel/Medication/generic event mutations must perform zero daily-only reads.

- [ ] **Step 2: Run the controller tests and verify RED**

Run:

```powershell
npm --prefix frontend test -- health-metrics-panel.spec.tsx health-panel.spec.tsx health-forms.spec.tsx
```

Expected: FAIL because dedicated Metrics state and methods do not exist.

- [ ] **Step 3: Add the API request types**

Use:

```ts
export type DailyMetricInput = Omit<EventInput, "details"> & {
  details: DailyMetricDetailsInput;
  expectedUpdatedAt?: string;
};
export type DailyMetricArchiveInput = { id: string; expectedUpdatedAt?: string };
export type DailyMetricsMutation = {
  metrics: DailyMetricInput[];
  archives: DailyMetricArchiveInput[];
};
```

Serialize `daily_only` in `listEvents` and send the mutation to the existing `/metrics/daily` endpoint. Keep response parsing through `mapHealthEvent`.

- [ ] **Step 4: Add Metrics state and concurrency using the existing collection pattern**

Add:

```ts
metricsStatus: LoadStatus;
metricsError: string | null;
metricsEntries: HealthEvent[];
refreshMetrics(): Promise<boolean>;
saveMetrics(input: DailyMetricsMutation): Promise<void>;
```

Use generation, ordinary in-flight coalescing, retained latest outcome, and 200-row page draining. Include Metrics in aggregate `refresh()`. Mount one initial Metrics read without adding another child-panel mount effect. The mutation refresh boundary is Metrics + Timeline + Trends until the separate Reports plan removes the legacy Trends read model.

- [ ] **Step 5: Run controller regressions and commit**

Run:

```powershell
npm --prefix frontend test -- health-metrics-panel.spec.tsx health-panel.spec.tsx health-forms.spec.tsx diet-panel.spec.tsx bowel-panel.spec.tsx medication-panel.spec.tsx quick-add.spec.tsx
npm --prefix frontend run typecheck
```

Expected: PASS with exact read counts and no category leakage.

Commit:

```powershell
git commit -m "[UPDATE] Add Health Metrics collection state"
```

---

### Task 4: Build the fixed Add dialog with date preload

**Files:**

- Create: `frontend/src/features/health/ui/HealthMetricsCreateDialog.tsx`
- Modify: `frontend/src/features/health/ui/HealthForms.tsx`
- Modify: `frontend/tests/presentation/health-forms.spec.tsx`
- Modify: `frontend/tests/presentation/health-metrics-panel.spec.tsx`

- [ ] **Step 1: Write failing form and dialog tests**

Assert the exact visible field order:

```ts
["Date", "Weight", "Sleep", "CRP", "Calprotectin", "Condition", "Note"]
```

Date defaults to the local calendar date. Changing Date preloads the current row values from the dedicated Metrics collection. Weight is positive kg; Sleep is greater than 0 and at most 24 hours; CRP and Calprotectin are non-negative finite values; Condition is an optional dropdown with values 1 through 10; Note is available only with Condition. At least one measurement is required.

Submit this exact fixed payload for entered values and no archives on Add:

```ts
{
  metrics: [
    { occurredAt, details: { kind: "weight", value: 68.2, unit: "kg" } },
    { occurredAt, details: { kind: "sleep", value: 7.5 } },
    { occurredAt, details: { kind: "lab", key: "crp", name: "CRP", value: 0.4, unit: "mg/L" } },
    { occurredAt, details: { kind: "lab", key: "fecal_calprotectin", name: "Fecal calprotectin", value: 80, unit: "µg/g" } },
    { occurredAt, details: { kind: "overall_condition", score: 8, conditionNote: "Good" } },
  ],
  archives: [],
}
```

Directly cover local midnight and DST-gap rejection, pending duplicate blocking, mutation failure draft retention, `HealthMutationRefreshError` frozen recovery with reads-only Retry, unmount settlement, body portal, modal isolation, both Tab wraps, idle Escape/backdrop close, pending close locks, SSR safety, cleanup, and focus restoration.

- [ ] **Step 2: Run dialog tests and verify RED**

Run:

```powershell
npm --prefix frontend test -- health-forms.spec.tsx health-metrics-panel.spec.tsx
```

Expected: FAIL because the fixed form and Add dialog do not exist.

- [ ] **Step 3: Replace the generic Lab editor with fixed fields**

Make `MetricsForm` accept `initialRow?: HealthMetricsRow`, `mode: "create" | "edit"`, and the existing pending/saved callbacks. Use one local-date input and convert local noon for that date through the existing strict local-time helper so each event shares one stable date without a DST midnight assumption. Build canonical values before dirty/payload comparison; preserve the original event `expectedUpdatedAt` when preloading an existing date.

Do not keep metric key, name, or unit text inputs. The five identities and units are fixed constants from the projection model.

- [ ] **Step 4: Build the dedicated modal using existing lifecycle primitives**

Portal to an owned body host, call `useModalIsolation(dialogRef, true, "body")`, label the dialog `Add health metrics`, trap focus, block all dismissal while pending, and restore the Add trigger. On committed-refresh failure freeze the complete fieldset and expose only Retry; Retry calls `controller.refreshMetrics()`.

- [ ] **Step 5: Run form regressions and commit**

Run:

```powershell
npm --prefix frontend test -- health-forms.spec.tsx health-metrics-panel.spec.tsx bowel-panel.spec.tsx medication-panel.spec.tsx diet-panel.spec.tsx quick-add.spec.tsx
npm --prefix frontend run typecheck
```

Expected: PASS without changing Diet/Bowel/Medication forms.

Commit:

```powershell
git commit -m "[ADD] Build Health Metrics creation dialog"
```

---

### Task 5: Replace the legacy list with the saved-view table

**Files:**

- Create: `frontend/src/features/health/ui/HealthMetricsTable.tsx`
- Modify: `frontend/src/features/health/ui/HealthMetricsPanel.tsx`
- Modify: `frontend/src/features/health/ui/HealthPanel.tsx`
- Modify: `frontend/tests/presentation/health-metrics-panel.spec.tsx`
- Modify: `frontend/tests/presentation/health-panel.spec.tsx`
- Modify: `frontend/tests/presentation/health-forms.spec.tsx`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx` only if the real navigation composition needs a fixture update

- [ ] **Step 1: Write failing table and lifecycle tests**

Require columns `Date`, `Weight`, `Sleep`, `CRP`, `Calprotectin`, `Condition`, and `Note`; fixed unit labels in cells; active daily rows only; exact loading, blocking-error, empty, and no-match copy; controls ordered Filter, Sort, Group, Add, Delete; `health.metrics` saved views; native table/rowgroup semantics; row button keyboard activation; checkbox isolation; visible-only selection; stable hidden selection; and sequential date archive snapshots.

For a selected date, one `saveMetrics({ metrics: [], archives: [...] })` call must contain every active fixed event in that logical row with its optimistic timestamp. Multiple selected dates execute sequentially in visible selection order. On ordinary failure retain failed/unattempted dates. On committed refresh failure tombstone every committed member ID, keep unattempted selection, show Retry, and prove Retry calls only `refreshMetrics()`.

- [ ] **Step 2: Run table tests and verify RED**

Run:

```powershell
npm --prefix frontend test -- health-metrics-panel.spec.tsx health-panel.spec.tsx workbench-wireframe.spec.tsx
```

Expected: FAIL against the legacy inline form/list.

- [ ] **Step 3: Implement the native table and logical selection**

Render one native `<tr>` per date occurrence. Keep the `<tr>` noninteractive and use a native Date-cell button for detail. Contextual checkbox names include the date. Deduplicate logical dates across grouped occurrences for select-all and archive while keeping occurrence DOM keys unique.

Empty copy is exactly `No health metrics yet.` or `No health metrics match this view.`.

- [ ] **Step 4: Implement panel flow and always-mounted recovery ownership**

Use `HealthTableViewHeader`, `deriveHealthMetricsGroups`, and `HealthMetricsCreateDialog`. Derive group candidates from unfiltered active truth. Snapshot selected visible dates before confirmation.

Keep committed member tombstones, warning, pending state, and authoritative `metricsEntries` array baselines in always-mounted `HealthPanel`. Preserve them through Metrics → another Health leaf → Metrics. Reconcile only when a new loaded, error-free array proves authoritative truth. Successful archive returns focus to Add; cancel/failure returns focus to enabled Delete.

- [ ] **Step 5: Run table regressions and commit**

Run:

```powershell
npm --prefix frontend test -- health-metrics-panel.spec.tsx health-panel.spec.tsx health-forms.spec.tsx bowel-panel.spec.tsx medication-panel.spec.tsx diet-panel.spec.tsx workbench-wireframe.spec.tsx
npm --prefix frontend run typecheck
```

Expected: PASS with no inline Metrics form remaining.

Commit:

```powershell
git commit -m "[UPDATE] Replace Health Metrics list workflow"
```

---

### Task 6: Build daily detail editing and browser history

**Files:**

- Create: `frontend/src/features/health/ui/HealthMetricsDetail.tsx`
- Modify: `frontend/src/features/health/ui/HealthMetricsPanel.tsx`
- Modify: `frontend/src/features/health/ui/HealthMetricsTable.tsx`
- Modify: `frontend/tests/presentation/health-metrics-panel.spec.tsx`
- Modify: `frontend/tests/presentation/health-panel.spec.tsx`

- [ ] **Step 1: Write failing detail tests**

Directly cover exact header/actions/labels/timestamps; immutable opened member IDs and versions; canonical whitespace/numeric/date no-op; minimal atomic payload; partial clear as archives; ordinary failure retention; committed-refresh recovery without resubmission; 50-step history; text/number coalescing; distinct dropdown edits; redo invalidation; buttons; Cmd/Ctrl+S, Cmd/Ctrl+Z, Ctrl+Y, Shift+Z; IME; invalid/pending/dialog/recovery locks; clean and dirty browser Back/Forward; no push loop; stale/tombstoned Forward normalization; archive recovery; and occurrence → date row → Add focus fallback.

The critical partial-clear expectation is:

```ts
expect(controller.saveMetrics).toHaveBeenCalledWith({
  metrics: [{
    occurredAt,
    details: { kind: "weight", value: 67.9, unit: "kg" },
    expectedUpdatedAt: openedWeight.updatedAt,
  }],
  archives: [{ id: openedCrp.id, expectedUpdatedAt: openedCrp.updatedAt }],
});
```

Unchanged identities are absent from both arrays. Clearing every stored value is handled by Delete/archive semantics, not an empty Save.

- [ ] **Step 2: Run detail tests and verify RED**

Run:

```powershell
npm --prefix frontend test -- health-metrics-panel.spec.tsx health-panel.spec.tsx
```

Expected: FAIL because daily rows do not open the dedicated detail editor.

- [ ] **Step 3: Implement one reducer and immutable daily baseline**

Snapshot the opened row, each member ID, and each member `updatedAt` once. Reuse the fixed `MetricsForm` field order and validation. Use one reducer with bounded `past/present/future`, coalesce consecutive edits to the same text/number field, and keep Condition dropdown edits distinct. Canonicalize before dirty comparison and build exactly one `saveMetrics` call.

Disable Save unless canonical data is valid and dirty. Lock all editing/navigation through mutation, archive confirmation, browser-pop restoration, and refresh recovery. Defer every save/archive success or failure settlement through `detailHistory.deferUntilRestored` while a pop repair is active.

- [ ] **Step 4: Add isolated browser history and stable focus**

Use:

```ts
useBrowserDetailHistory({
  stateKey: "__ravenHealthMetricsDetailDate",
  currentId: currentDetailRow?.date ?? null,
  resolve: (date) => activeRows.find((row) => row.date === date) ?? null,
  open: setDetailRow,
  close: closeDetail,
  clearOnUnmount: true,
});
```

Preserve Diet, Bowel, and Medication state keys. Restore the exact grouped occurrence when it still exists, otherwise the same date row, otherwise Add. A view filter hiding the row must not close detail; only authoritative active truth removal does.

- [ ] **Step 5: Run detail regressions and commit**

Run:

```powershell
npm --prefix frontend test -- health-metrics-panel.spec.tsx health-panel.spec.tsx health-forms.spec.tsx bowel-panel.spec.tsx medication-panel.spec.tsx diet-panel.spec.tsx workbench-wireframe.spec.tsx
npm --prefix frontend run typecheck
```

Expected: PASS with one mutation per Save/Delete and no browser-history cross-talk.

Commit:

```powershell
git commit -m "[ADD] Build Health Metrics detail workflow"
```

---

### Task 7: Final scope, documentation, and verification gate

**Files to verify:**

- `docs/superpowers/specs/2026-08-18-health-journal-ux-design.md`
- `README.md`
- `frontend/README.md`
- `docs/architecture/data-model.md`
- `docs/operations/api-reference.md`
- `AGENTS.md`
- `CLAUDE.md`

- [ ] **Step 1: Audit every approved Health Metrics requirement**

Check the exact fixed columns and units; date/value filters; numeric sorts; week/month groups; local-date projection; existing-date preload; active daily-only source; saved-view isolation; visible selection; atomic upsert/partial clear/daily archive; optimistic versions; history/shortcuts/browser navigation; refresh-only recovery; focus; modal isolation; and the absence of custom metrics, summary records, restore/purge UI, schema/dependency/chart work, or speculative generic Health abstractions.

Do not claim Reports is implemented. The current transitional Trends tab is replaced only by the separate Reports plan; this plan must not rename the legacy Trends surface.

- [ ] **Step 2: Run fresh frontend gates sequentially**

```powershell
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: every test passes and the production build exits 0. Do not run typecheck concurrently with Next build because both access `.next/types`.

- [ ] **Step 3: Run Rust workspace gates**

```powershell
cargo fmt --check
cargo test --workspace
cargo clippy --all-targets --all-features -- -D warnings
```

Expected: PASS, except an independently reproduced pre-existing host-specific baseline must be reported rather than hidden or changed outside scope.

- [ ] **Step 4: Check scope and user-owned files**

```powershell
git diff --check
git status --short
git diff -- frontend/package-lock.json Cargo.lock
```

Expected: only planned Health Metrics/API/test/docs files differ; `Cargo.lock` is unchanged; the pre-existing user-owned `frontend/package-lock.json` modification remains unstaged and unchanged.

- [ ] **Step 5: Request independent review and fix evidenced findings only**

Use `superpowers:requesting-code-review`. Validate each finding against the live code and a failing regression before editing. Use one NFLOW commit per independent fix and do not add a generic daily-record framework.

- [ ] **Step 6: Record final evidence**

Report exact frontend and Rust test counts, typecheck/build/clippy results, commit list, changed files, worktree status, preserved lockfile state, docs updates, and accepted external baseline warnings.
