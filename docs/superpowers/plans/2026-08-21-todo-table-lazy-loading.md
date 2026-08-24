# ToDo Table Lazy Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Page ToDo Workspace, Planner, and linked-item tables without loading every full ToDo item during navigation.

**Architecture:** Add a ToDo application query with typed Workspace, Planner-period, or linked-parent context. SQLite performs complete-dataset filter/sort/group projection and returns 50 row occurrences; compact lookups replace the frontend's duplicate all-item fetch and the existing shared footer triggers subsequent pages.

**Tech Stack:** Rust 2024, rusqlite, Axum, serde, React 18, TypeScript, Vitest, Testing Library

---

### Task 1: Define ToDo table scopes and contexts

**Files:**
- Create: `todo-engine/src/application/table.rs`
- Modify: `todo-engine/src/application/mod.rs`
- Modify: `todo-engine/src/application/ports.rs`
- Create: `todo-engine/tests/integration/table_query.rs`
- Modify: `todo-engine/tests/integration.rs`

- [ ] **Step 1: Write failing contract tests**

Cover six Workspace scopes, yearly/monthly/weekly/daily Planner scopes, and linked-item scopes. Planner requires a local period; linked scope requires parent type/ID; Workspace requires empty context. Assert limit `1..=50` and that fields/operators/groups match `workspace-table-views.ts` and Planner settings.

```rust
assert!(TodoTableQuery::new(
    TodoTableScope::Linked { parent: ItemType::Area, child: ItemType::Project },
    TableContext::Workspace, 0, 50, default_view(),
).is_err());
```

- [ ] **Step 2: Run RED**

Run `cargo test -p todo-engine --test integration table_query`. Expected: missing types.

- [ ] **Step 3: Add the typed contract**

Define `TodoTableScope`, `TableContext`, scope-specific filter/sort/group enums, `TodoTableQuery`, `TodoTableRow`, `TodoTableLookup`, and `TablePage`:

```rust
pub enum TableContext {
    Workspace,
    Planner { from: Date, to: Date },
    Linked { parent_type: ItemType, parent_id: String },
}
```

Add `query_table` and `table_lookups` to `TodoStore`; leave existing `ListFilter` and mutation ports unchanged.

- [ ] **Step 4: Run GREEN and commit**

Run the focused test. Expected: PASS.

```powershell
git add todo-engine/src/application/table.rs todo-engine/src/application/mod.rs todo-engine/src/application/ports.rs todo-engine/tests/integration.rs todo-engine/tests/integration/table_query.rs
git commit -m "[ADD] Define ToDo table query contract"
```

### Task 2: Query row occurrences and lookups in both stores

**Files:**
- Create: `todo-engine/src/infrastructure/sqlite/table_query.rs`
- Modify: `todo-engine/src/infrastructure/sqlite/mod.rs`
- Modify: `todo-engine/src/infrastructure/sqlite/repo.rs`
- Create: `todo-engine/src/application/service/table.rs`
- Modify: `todo-engine/src/application/service/mod.rs`
- Modify: `todo-engine/tests/integration/table_query.rs`

- [ ] **Step 1: Add failing parity scenarios**

Seed 51 mixed items into persistent and in-memory services. Verify complete-dataset filters, two sort rules, status/date/tag grouping, multi-tag occurrences, Planner boundaries, linked-parent constraints, exact-limit probing, stable ID order, and compact lookups containing only IDs/types/titles/tags. Assert both stores return identical stable row keys.

- [ ] **Step 2: Run RED**

Run `cargo test -p todo-engine --test integration table_query`. Expected: store methods missing.

- [ ] **Step 3: Implement the SQLite dispatcher**

```rust
match &query.context {
    TableContext::Workspace => query_workspace(connection, query),
    TableContext::Planner { from, to } => query_planner(connection, query, *from, *to),
    TableContext::Linked { parent_type, parent_id } =>
        query_linked(connection, query, *parent_type, parent_id),
}
```

Use validated enum-selected expressions and bound values. Expand tag groups with SQLite `json_each`, order group then user rules then item ID, select 51, and truncate. Lookup SQL selects active `id`, `type`, `title`, and distinct tags only.

- [ ] **Step 4: Implement equivalent in-memory projection in the service**

Add the public service methods in `application/service/table.rs`. For `ServiceStore::Persistent`, delegate to the repository port. For `ServiceStore::InMemory`, apply the same typed predicates and comparators to the existing item map, expand multi-tag occurrences, sort with the same tie-breaker, then slice `offset..offset+50`. Do not create a second generic query abstraction.

- [ ] **Step 5: Run GREEN and commit**

Run `cargo test -p todo-engine`. Expected: PASS.

```powershell
git add todo-engine/src/infrastructure/sqlite/table_query.rs todo-engine/src/infrastructure/sqlite/mod.rs todo-engine/src/infrastructure/sqlite/repo.rs todo-engine/src/application/service/table.rs todo-engine/src/application/service/mod.rs todo-engine/tests/integration/table_query.rs
git commit -m "[ADD] Query ToDo tables by page"
```

### Task 3: Expose ToDo table and lookup routes

**Files:**
- Modify: `todo-engine/src/interfaces/api/mod.rs`
- Create: `todo-engine/src/interfaces/api/table.rs`
- Modify: `raven-api/src/routes/todo.rs`
- Modify: `raven-api/tests/routes_todo.rs`
- Modify: `docs/operations/api-reference.md`

- [ ] **Step 1: Write failing authenticated route tests**

Test `POST /api/v1/todo/table/query` for Workspace, Planner, and linked contexts; strict unknown-field rejection; mismatched context; limit 51; safe errors; and `GET /api/v1/todo/table/lookups?scope=workspace.task`. Assert `GET /api/v1/todo/items` remains a legacy array.

- [ ] **Step 2: Run RED**

Run `cargo test -p raven-api --test routes_todo table_query`. Expected: 404.

- [ ] **Step 3: Add DTOs and handlers**

Create strict `deny_unknown_fields` DTOs, map valid scope/context pairs, serialize row occurrences and lookup maps, reuse the ToDo safe-error adapter, and mount under the existing authenticated `/api/v1/todo` router.

- [ ] **Step 4: Verify, document, and commit**

Run `cargo test -p raven-api --test routes_todo` and `git diff --check`. Expected: PASS.

```powershell
git add todo-engine/src/interfaces/api/mod.rs todo-engine/src/interfaces/api/table.rs raven-api/src/routes/todo.rs raven-api/tests/routes_todo.rs docs/operations/api-reference.md
git commit -m "[ADD] Serve ToDo table pages"
```

### Task 4: Replace full-item frontend loads with pages and lookups

**Files:**
- Create: `frontend/src/features/workbench/api/table-api.ts`
- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Modify: `frontend/src/features/workbench/model/workspace-table-views.ts`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- Modify: `frontend/tests/domain/raven-api.spec.ts`
- Modify: `frontend/tests/domain/workspace-table-views.spec.ts`
- Modify: `frontend/tests/presentation/use-workbench-controller.spec.tsx`

- [ ] **Step 1: Write failing controller tests**

Assert navigation sends one table query with limit 50 and one lookup request; no call fetches all full items; `loadMore` appends unique keys; Planner passes its selected period; linked tables pass parent context; saved-view changes and successful mutations reset offset 0; next-page failure preserves rows; late pages are ignored.

- [ ] **Step 2: Run RED**

Run the three focused specs. Expected: missing table API/page-state failures.

- [ ] **Step 3: Add wire mapping and page state**

Map API records to `WorkspaceItemModel`. Extend `WorkspaceItemsModel` with projected occurrences and:

```ts
nextOffset: number | null;
moreStatus: "idle" | "loading" | "error";
moreError: string | null;
```

Replace `fetchWorkspaceItems` and `fetchAllWorkspaceItems` navigation loads with `queryTodoTable` and `loadTodoLookups`. Keep lookup maps for relation labels, detail navigation, and filter candidates. Use generation checks and occurrence-key deduplication.

- [ ] **Step 4: Consume server-projected groups**

Change `deriveWorkspaceViewGroups` to merge adjacent `{groupKey,groupLabel,item}` occurrences without re-filtering or re-sorting a partial page. Retain existing pure filter/sort/group helpers for non-table callers.

- [ ] **Step 5: Verify and commit**

Run focused specs and typecheck. Expected: PASS.

```powershell
git add frontend/src/features/workbench/api/table-api.ts frontend/src/features/workbench/model/workbench-model.ts frontend/src/features/workbench/model/workspace-table-views.ts frontend/src/features/workbench/hooks/useWorkbenchController.ts frontend/tests/domain/raven-api.spec.ts frontend/tests/domain/workspace-table-views.spec.ts frontend/tests/presentation/use-workbench-controller.spec.tsx
git commit -m "[UPDATE] Page ToDo table state"
```

### Task 5: Render lazy-load controls in all ToDo table surfaces

**Files:**
- Modify: `frontend/src/features/workbench/ui/WorkspaceGroupedRows.tsx`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

- [ ] **Step 1: Write failing integration tests**

Cover one Workspace table, one Planner table, and one linked table. Assert exact footer `colSpan`, Load more dispatch, pending state, Retry, final-page absence, and one group header when the same group spans appended pages.

- [ ] **Step 2: Run RED**

Run `npm --prefix frontend test -- workbench-wireframe.spec.tsx`. Expected: footer assertions fail.

- [ ] **Step 3: Append the shared footer**

Extend `WorkspaceGroupedRows` with optional paging props:

```tsx
{paging ? <InfiniteTableFooter
  columnCount={columnCount}
  nextOffset={paging.nextOffset}
  status={paging.moreStatus}
  error={paging.moreError}
  loadMore={paging.loadMore}
/> : null}
```

Supply paging state from Workspace, Planner, and linked callers while retaining existing empty rows, checkboxes, selection counts, and details.

- [ ] **Step 4: Verify and commit**

Run the Workbench/footer specs, typecheck, and build. Expected: PASS.

```powershell
git add frontend/src/features/workbench/ui/WorkspaceGroupedRows.tsx frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "[UPDATE] Load ToDo tables on demand"
```

### Task 6: Run complete lazy-loading gates

**Files:** Verify only

- [ ] **Step 1: Run all repository checks**

```powershell
cargo fmt --check
cargo test --workspace
cargo clippy --all-targets --all-features -- -D warnings
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm --prefix npm/raven test
git diff --check
git status --short
```

Expected: PASS; only pre-existing user-owned changes may remain.
