# Ledger Table Lazy Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load Ledger transactions, accounts, and categories in 50-row pages while applying saved-view rules to the complete dataset.

**Architecture:** Add a typed table query to the Ledger service and SQLite repository, expose it through Raven API, and replace frontend page draining with per-scope page state. This rollout also adds the single shared `InfiniteTableFooter` reused by Health and ToDo.

**Tech Stack:** Rust 2024, rusqlite, Axum, serde, React 18, TypeScript, Vitest, Testing Library

---

### Task 1: Define the Ledger table-query contract

**Files:**
- Create: `ledger-engine/src/application/table.rs`
- Modify: `ledger-engine/src/application/mod.rs`
- Modify: `ledger-engine/src/application/ports.rs`
- Create: `ledger-engine/tests/integration/table_query.rs`
- Modify: `ledger-engine/tests/integration.rs`

- [ ] **Step 1: Write failing contract tests**

Test the three scopes, the `1..=50` limit, scope-specific field allowlists, `and|or`, at least one sort rule, and stable occurrence keys. Use this exact boundary assertion:

```rust
assert!(LedgerTableQuery::new(
    LedgerTableScope::Transactions, 0, 51, FilterMode::And,
    vec![], vec![TableSort::desc(TransactionSortField::Date)],
    TransactionGroup::None,
).is_err());
```

- [ ] **Step 2: Run RED**

Run `cargo test -p ledger-engine --test integration table_query`. Expected: compile failure because the types do not exist.

- [ ] **Step 3: Add the typed contract**

Define `TABLE_PAGE_LIMIT`, `LedgerTableScope`, scope-specific filter/sort/group enums, `FilterMode`, `LedgerTableQuery`, `LedgerTableRow`, and `TablePage<T>`. The response shape is:

```rust
pub struct LedgerTableRow {
    pub key: String,
    pub group_key: Option<String>,
    pub group_label: Option<String>,
    pub record: LedgerTableRecord,
}
pub struct TablePage<T> { pub items: Vec<T>, pub next_offset: Option<u32> }
```

Add `query_table(&self, &LedgerTableQuery)` to `LedgerReadRepository` and `LedgerService`. Constructors reject mismatched fields before repository access.

- [ ] **Step 4: Run GREEN and commit**

Run `cargo test -p ledger-engine --test integration table_query`. Expected: PASS.

```powershell
git add ledger-engine/src/application/table.rs ledger-engine/src/application/mod.rs ledger-engine/src/application/ports.rs ledger-engine/tests/integration.rs ledger-engine/tests/integration/table_query.rs
git commit -m "[ADD] Define Ledger table query contract"
```

### Task 2: Execute table queries in SQLite

**Files:**
- Create: `ledger-engine/src/infrastructure/sqlite/table_query.rs`
- Modify: `ledger-engine/src/infrastructure/sqlite/mod.rs`
- Modify: `ledger-engine/src/infrastructure/sqlite/repository.rs`
- Modify: `ledger-engine/tests/integration/table_query.rs`

- [ ] **Step 1: Add failing repository cases**

Seed 51 entries and multiple accounts/categories. Assert full-dataset `and`/`or` filters, two sort rules, month/account/category grouping, computed account-balance sorting, parent-category grouping, exact-limit probing, and ID ordering when displayed values tie. First page must contain 50 rows and `next_offset=50`; second must contain one row and `next_offset=null`.

- [ ] **Step 2: Run RED**

Run `cargo test -p ledger-engine --test integration table_query`. Expected: repository method failure.

- [ ] **Step 3: Implement one allowlisted builder per scope**

Create `query_transactions`, `query_accounts`, and `query_categories`, dispatched by:

```rust
match query.scope {
    LedgerTableScope::Transactions => query_transactions(connection, query),
    LedgerTableScope::Accounts => query_accounts(connection, query),
    LedgerTableScope::Categories => query_categories(connection, query),
}
```

SQL identifiers and expressions come only from validated enums; all values stay bound parameters. Order by group expression, then user sort priority, then canonical record ID ascending. Select 51, truncate to 50, and set `next_offset` only when the probe row exists. Preserve the existing logical transfer-row projection.

- [ ] **Step 4: Run GREEN and commit**

Run `cargo test -p ledger-engine`. Expected: PASS.

```powershell
git add ledger-engine/src/infrastructure/sqlite/table_query.rs ledger-engine/src/infrastructure/sqlite/mod.rs ledger-engine/src/infrastructure/sqlite/repository.rs ledger-engine/tests/integration/table_query.rs
git commit -m "[ADD] Query Ledger tables by page"
```

### Task 3: Expose Ledger table and lookup reads

**Files:**
- Modify: `raven-api/src/routes/ledger.rs`
- Modify: `raven-api/tests/routes_ledger.rs`
- Modify: `docs/operations/api-reference.md`

- [ ] **Step 1: Write failing route tests**

Cover authenticated `POST /api/v1/ledger/table/query`, all scopes, strict unknown-field rejection, limit 51, safe errors, and `GET /api/v1/ledger/table/lookups?scope=ledger.transactions`. Assert legacy list-route response shapes remain unchanged.

- [ ] **Step 2: Run RED**

Run `cargo test -p raven-api --test routes_ledger table_query`. Expected: 404.

- [ ] **Step 3: Add strict DTOs and handlers**

Use `#[serde(deny_unknown_fields)]` on the body and `{}` context. Map DTO enums to validated application enums, call `LedgerService::query_table`, and serialize `{items,next_offset}`. Reuse the 128 KiB body limit and shared error mapping. Lookups contain only active currency/account/category IDs and labels required by the scope.

- [ ] **Step 4: Verify, document, and commit**

Run `cargo test -p raven-api --test routes_ledger` and `git diff --check`. Expected: PASS.

```powershell
git add raven-api/src/routes/ledger.rs raven-api/tests/routes_ledger.rs docs/operations/api-reference.md
git commit -m "[ADD] Serve Ledger table pages"
```

### Task 4: Add the shared infinite-table footer

**Files:**
- Create: `frontend/src/features/workbench/ui/InfiniteTableFooter.tsx`
- Create: `frontend/tests/presentation/infinite-table-footer.spec.tsx`
- Modify: `frontend/src/styles/globals.css`

- [ ] **Step 1: Write failing UI tests**

Stub `IntersectionObserver`. Repeated intersections call `loadMore` once while loading; click and keyboard activate Load more; an error changes the action to Retry; `nextOffset=null` renders nothing; the cell uses the provided `columnCount`.

- [ ] **Step 2: Run RED**

Run `npm --prefix frontend test -- infinite-table-footer.spec.tsx`. Expected: missing module failure.

- [ ] **Step 3: Implement the native footer**

```tsx
export function InfiniteTableFooter(props: InfiniteTableFooterProps) {
  const row = React.useRef<HTMLTableRowElement>(null);
  React.useEffect(() => {
    if (props.nextOffset === null || props.status === "loading" || !row.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) props.loadMore();
    }, { rootMargin: "240px" });
    observer.observe(row.current);
    return () => observer.disconnect();
  }, [props.loadMore, props.nextOffset, props.status]);
  if (props.nextOffset === null) return null;
  return <tbody><tr ref={row}><td colSpan={props.columnCount}>
    {props.status === "loading" ? "Loading more…" :
      <button type="button" onClick={props.loadMore}>{props.error ? "Retry" : "Load more"}</button>}
  </td></tr></tbody>;
}
```

- [ ] **Step 4: Run GREEN and commit**

Run the focused test and `npm --prefix frontend run typecheck`. Expected: PASS.

```powershell
git add frontend/src/features/workbench/ui/InfiniteTableFooter.tsx frontend/tests/presentation/infinite-table-footer.spec.tsx frontend/src/styles/globals.css
git commit -m "[ADD] Add infinite table footer"
```

### Task 5: Page Ledger frontend state

**Files:**
- Modify: `frontend/src/features/ledger/model/ledger-model.ts`
- Modify: `frontend/src/features/ledger/api/ledger-api.ts`
- Modify: `frontend/src/features/ledger/hooks/useLedgerController.ts`
- Modify: `frontend/src/features/ledger/ui/TransactionsTable.tsx`
- Modify: `frontend/src/features/ledger/ui/AccountsTable.tsx`
- Modify: `frontend/src/features/ledger/ui/CategoriesTable.tsx`
- Modify: `frontend/tests/domain/ledger-api.spec.ts`
- Modify: `frontend/tests/presentation/ledger-panel.spec.tsx`

- [ ] **Step 1: Write failing API/controller tests**

Assert offset 0 and limit 50 on entry, no `drainPages`, one appended request from `loadMore(scope)`, occurrence-key deduplication, settings reset, stale-response rejection, row preservation on next-page failure, and offset-0 reload after successful mutation.

- [ ] **Step 2: Run RED**

Run `npm --prefix frontend test -- ledger-api.spec.ts ledger-panel.spec.tsx`. Expected: missing `queryTable`/`loadMore` failures.

- [ ] **Step 3: Implement wire mapping and page state**

Add `LedgerTableOccurrence` and `ledgerApi.queryTable`. Replace rendered-record page draining with per-scope `{items,nextOffset,moreStatus,moreError,generation}`. Compact lookups remain separate. `loadMore` captures the generation, ignores late pages, and deduplicates by occurrence key.

- [ ] **Step 4: Render the footer in all three tables**

Pass each page state into its table and append `InfiniteTableFooter` with the actual visible column count. Keep existing empty rows, selection, details, and saved views.

- [ ] **Step 5: Verify and commit**

Run focused tests, typecheck, and build. Expected: PASS.

```powershell
git add frontend/src/features/ledger/model/ledger-model.ts frontend/src/features/ledger/api/ledger-api.ts frontend/src/features/ledger/hooks/useLedgerController.ts frontend/src/features/ledger/ui/TransactionsTable.tsx frontend/src/features/ledger/ui/AccountsTable.tsx frontend/src/features/ledger/ui/CategoriesTable.tsx frontend/tests/domain/ledger-api.spec.ts frontend/tests/presentation/ledger-panel.spec.tsx
git commit -m "[UPDATE] Load Ledger tables on demand"
```

### Task 6: Run Ledger rollout gates

**Files:** Verify only

- [ ] **Step 1: Run all relevant checks**

```powershell
cargo fmt --check
cargo test -p ledger-engine
cargo test -p raven-api --test routes_ledger
cargo clippy -p ledger-engine -p raven-api --all-targets --all-features -- -D warnings
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
git diff --check
git status --short
```

Expected: PASS; status may retain only the pre-existing user-owned `frontend/package-lock.json` change.
