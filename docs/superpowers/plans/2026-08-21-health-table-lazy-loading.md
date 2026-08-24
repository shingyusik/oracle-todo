# Health Journal Table Lazy Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load Diet, Bowel, Medication, and Health Metrics tables in exact 50-row pages without draining all Health records during navigation.

**Architecture:** Reuse `InfiniteTableFooter` from the Ledger plan. Add typed Health queries that project Diet records, categorized events, and logical daily metric rows in SQLite, then give each Health controller slice independent first/next-page state.

**Tech Stack:** Rust 2024, rusqlite, Axum, serde, React 18, TypeScript, Vitest, Testing Library

---

### Task 1: Add Health table queries and SQLite projection

**Files:**
- Create: `health-engine/src/application/table.rs`
- Modify: `health-engine/src/application/mod.rs`
- Modify: `health-engine/src/application/ports.rs`
- Create: `health-engine/src/infrastructure/sqlite/table_query.rs`
- Modify: `health-engine/src/infrastructure/sqlite/mod.rs`
- Modify: `health-engine/src/infrastructure/sqlite/repository.rs`
- Create: `health-engine/tests/integration/table_query.rs`
- Modify: `health-engine/tests/integration.rs`

- [ ] **Step 1: Write failing service/repository tests**

Seed 51 Diet records, Bowel and Medication events, and daily metrics. Assert first/second pages, complete-dataset `and|or` filters, two sort rules, group boundaries, multi-tag Diet occurrences, active-only rows, one Metrics row per local date, ID tie-breaking, and rejection of unknown fields or limit 51.

```rust
let first = service.query_table(HealthTableQuery::diet(0, 50))?;
assert_eq!((first.items.len(), first.next_offset), (50, Some(50)));
let second = service.query_table(HealthTableQuery::diet(50, 50))?;
assert_eq!((second.items.len(), second.next_offset), (1, None));
```

- [ ] **Step 2: Run RED**

Run `cargo test -p health-engine --test integration table_query`. Expected: missing table-query types.

- [ ] **Step 3: Define validated scope types**

Define `HealthTableScope::{Diet,Bowel,Medication,Metrics}`, scope-specific filter/sort/group enums, `HealthTableQuery`, `HealthTableRow`, and `TablePage`. Add `query_table` to `HealthReadRepository` and `HealthService`; limit construction to `1..=50`.

- [ ] **Step 4: Implement allowlisted SQLite reads**

Dispatch by scope:

```rust
match query.scope {
    HealthTableScope::Diet => query_diet(connection, query),
    HealthTableScope::Bowel => query_events(connection, query, "bowel"),
    HealthTableScope::Medication => query_events(connection, query, "medication"),
    HealthTableScope::Metrics => query_daily_metrics(connection, query),
}
```

Use enum-selected expressions and bound values only. Order group first, then user sorts, then record ID. Select 51 and truncate. Metrics SQL groups daily-upsert events by `local_date` before filtering/sorting/paging; it does not create a summary record. Diet tags expand to one occurrence per selected group.

- [ ] **Step 5: Run GREEN and commit**

Run `cargo test -p health-engine`. Expected: PASS.

```powershell
git add health-engine/src/application/table.rs health-engine/src/application/mod.rs health-engine/src/application/ports.rs health-engine/src/infrastructure/sqlite/table_query.rs health-engine/src/infrastructure/sqlite/mod.rs health-engine/src/infrastructure/sqlite/repository.rs health-engine/tests/integration.rs health-engine/tests/integration/table_query.rs
git commit -m "[ADD] Query Health tables by page"
```

### Task 2: Expose Health table and lookup reads

**Files:**
- Modify: `raven-api/src/routes/health.rs`
- Modify: `raven-api/tests/routes_health.rs`
- Modify: `docs/operations/api-reference.md`

- [ ] **Step 1: Write failing route tests**

Cover authenticated `POST /api/v1/health/table/query` for four scopes, strict field/context validation, safe errors, page limit, local-date Metrics projection, and `GET /api/v1/health/table/lookups?scope=health.diet` returning compact Diet tags. Assert legacy Diet/Event array responses are unchanged.

- [ ] **Step 2: Run RED**

Run `cargo test -p raven-api --test routes_health table_query`. Expected: 404.

- [ ] **Step 3: Add strict DTO mapping**

Add the two routes. Use `deny_unknown_fields`, require `{}` context, map only allowlisted enums, reuse the 128 KiB body limit and safe error adapter, and serialize `{items,next_offset}`. Lookup responses contain tags or fixed option labels only, never notes/media/audit data.

- [ ] **Step 4: Verify, document, and commit**

Run `cargo test -p raven-api --test routes_health` and `git diff --check`. Expected: PASS.

```powershell
git add raven-api/src/routes/health.rs raven-api/tests/routes_health.rs docs/operations/api-reference.md
git commit -m "[ADD] Serve Health table pages"
```

### Task 3: Page Health controller state

**Files:**
- Modify: `frontend/src/features/health/model/health-model.ts`
- Modify: `frontend/src/features/health/api/health-api.ts`
- Modify: `frontend/src/features/health/hooks/useHealthController.ts`
- Modify: `frontend/tests/domain/raven-api.spec.ts`
- Modify: `frontend/tests/presentation/health-panel.spec.tsx`

- [ ] **Step 1: Write failing frontend tests**

Assert every scope requests offset 0/limit 50 once; the four current `do...while` loops disappear; `loadMore(scope)` appends once; occurrence keys deduplicate; a view change or successful mutation resets only the affected scope; a next-page error retains rows; stale generations are ignored.

- [ ] **Step 2: Run RED**

Run `npm --prefix frontend test -- raven-api.spec.ts health-panel.spec.tsx`. Expected: missing `queryTable` and `loadMore` failures.

- [ ] **Step 3: Implement mapping and four page slices**

Map `{key,group_key,group_label,record}` to existing Diet/Event/DailyMetric models. Each slice gains:

```ts
nextOffset: number | null;
moreStatus: "idle" | "loading" | "error";
moreError: string | null;
generation: number;
```

Replace each draining refresh with one offset-0 query. Append only if the captured generation remains current. Leave Health Reports on its existing independent request path.

- [ ] **Step 4: Run GREEN and commit**

Run the focused tests and `npm --prefix frontend run typecheck`. Expected: PASS.

```powershell
git add frontend/src/features/health/model/health-model.ts frontend/src/features/health/api/health-api.ts frontend/src/features/health/hooks/useHealthController.ts frontend/tests/domain/raven-api.spec.ts frontend/tests/presentation/health-panel.spec.tsx
git commit -m "[UPDATE] Page Health table state"
```

### Task 4: Render the shared footer in every Health table

**Files:**
- Modify: `frontend/src/features/health/ui/DietTable.tsx`
- Modify: `frontend/src/features/health/ui/BowelTable.tsx`
- Modify: `frontend/src/features/health/ui/MedicationTable.tsx`
- Modify: `frontend/src/features/health/ui/HealthMetricsTable.tsx`
- Modify: `frontend/src/features/health/ui/DietPanel.tsx`
- Modify: `frontend/src/features/health/ui/BowelPanel.tsx`
- Modify: `frontend/src/features/health/ui/MedicationPanel.tsx`
- Modify: `frontend/src/features/health/ui/HealthMetricsPanel.tsx`
- Modify: `frontend/tests/presentation/diet-panel.spec.tsx`
- Modify: `frontend/tests/presentation/bowel-panel.spec.tsx`
- Modify: `frontend/tests/presentation/medication-panel.spec.tsx`
- Modify: `frontend/tests/presentation/health-metrics-panel.spec.tsx`

- [ ] **Step 1: Write failing table tests**

For each table, assert correct footer `colSpan`, Load more dispatch, pending text, Retry after failure, and no footer on `nextOffset=null`.

- [ ] **Step 2: Run RED**

Run the four focused panel specs. Expected: footer assertions fail.

- [ ] **Step 3: Append `InfiniteTableFooter`**

Pass paging state from each panel and render:

```tsx
<InfiniteTableFooter
  columnCount={columns.length + 1}
  nextOffset={page.nextOffset}
  status={page.moreStatus}
  error={page.moreError}
  loadMore={() => controller.loadMore(scope)}
/>
```

Use the actual table column count, including selection.

- [ ] **Step 4: Verify and commit**

Run the four specs, footer spec, typecheck, and build. Expected: PASS.

```powershell
git add frontend/src/features/health/ui/DietTable.tsx frontend/src/features/health/ui/BowelTable.tsx frontend/src/features/health/ui/MedicationTable.tsx frontend/src/features/health/ui/HealthMetricsTable.tsx frontend/src/features/health/ui/DietPanel.tsx frontend/src/features/health/ui/BowelPanel.tsx frontend/src/features/health/ui/MedicationPanel.tsx frontend/src/features/health/ui/HealthMetricsPanel.tsx frontend/tests/presentation/diet-panel.spec.tsx frontend/tests/presentation/bowel-panel.spec.tsx frontend/tests/presentation/medication-panel.spec.tsx frontend/tests/presentation/health-metrics-panel.spec.tsx
git commit -m "[UPDATE] Load Health tables on demand"
```

### Task 5: Run Health rollout gates

**Files:** Verify only

- [ ] **Step 1: Run all relevant checks**

```powershell
cargo fmt --check
cargo test -p health-engine
cargo test -p raven-api --test routes_health
cargo clippy -p health-engine -p raven-api --all-targets --all-features -- -D warnings
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
git diff --check
git status --short
```

Expected: PASS; only pre-existing user-owned changes may remain.
