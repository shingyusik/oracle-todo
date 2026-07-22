# Shared Backend Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store Planner filter, group, and sort preferences in the local SQLite database through a reusable shared backend package.

**Architecture:** Add a `backend` Rust library that owns the additive workspace-preferences table and a small settings router. `todo-engine` merges that router but retains all Todo routes and policies. The frontend reads and writes one normalized planner-preferences document through the existing local API proxy.

**Tech Stack:** Rust 2024, rusqlite, axum, serde_json, Next.js, React, Vitest.

## Global Constraints

- `backend` is a library package; it never owns Todo routes or Todo policy.
- SQLite access stays server-side; the frontend only calls `/todo-engine/settings/planner`.
- The preference document is workspace-wide and versioned as `planner.v1`.
- Schema changes are additive and malformed settings must leave the UI usable.
- Do not add dependencies when the existing workspace dependencies suffice.

---

### Task 1: Create the shared backend preferences package

**Files:**
- Modify: `Cargo.toml`
- Create: `backend/Cargo.toml`
- Create: `backend/src/lib.rs`
- Create: `backend/src/preferences.rs`
- Test: `backend/tests/preferences.rs`

**Interfaces:**
- Produces: `backend::preferences::init_schema(&Connection) -> Result<(), PreferencesError>`
- Produces: `backend::preferences::get(&Connection, key: &str) -> Result<Option<Value>, PreferencesError>`
- Produces: `backend::preferences::put(&mut Connection, key: &str, value: &Value) -> Result<(), PreferencesError>`

- [ ] **Step 1: Write the failing repository round-trip test**

```rust
#[test]
fn planner_preferences_round_trip() {
    let mut connection = Connection::open_in_memory().unwrap();
    init_schema(&connection).unwrap();
    put(&mut connection, "planner.v1", &json!({"filterMode": "or"})).unwrap();
    assert_eq!(get(&connection, "planner.v1").unwrap(), Some(json!({"filterMode": "or"})));
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p backend --test preferences planner_preferences_round_trip`

Expected: FAIL because the `backend` package does not exist.

- [ ] **Step 3: Implement the smallest additive SQLite repository**

```rust
pub fn init_schema(connection: &Connection) -> Result<(), PreferencesError> {
    connection.execute_batch("CREATE TABLE IF NOT EXISTS workspace_preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);")?;
    Ok(())
}
```

Use `INSERT ... ON CONFLICT(key) DO UPDATE` for `put`; serialize and parse with `serde_json`.

- [ ] **Step 4: Run the package test to verify it passes**

Run: `cargo test -p backend --test preferences planner_preferences_round_trip`

Expected: PASS.

- [ ] **Step 5: Commit the package**

```bash
git add Cargo.toml backend
git commit -m "[ADD] Add shared backend preferences package"
```

### Task 2: Mount the shared settings router in todo-engine

**Files:**
- Modify: `todo-engine/Cargo.toml`
- Modify: `todo-engine/src/interfaces/api/mod.rs`
- Create: `backend/src/api.rs`
- Test: `todo-engine/tests/e2e/api.rs`

**Interfaces:**
- Consumes: `backend::preferences::{init_schema, get, put}`
- Produces: `backend::api::router(db_path: PathBuf) -> Router`
- Produces: `GET /settings/planner` and `PUT /settings/planner`

- [ ] **Step 1: Write the failing API persistence test**

```rust
#[tokio::test]
async fn planner_settings_round_trip_through_sqlite() {
    let response = json_request(router(&db_path).unwrap(), "PUT", "/settings/planner", json!({"value": {"filterMode": "or"}})).await;
    assert_eq!(response.status(), 200);
    let response = empty_request(router(&db_path).unwrap(), "GET", "/settings/planner").await;
    assert_eq!(body_json(response).await, json!({"filterMode": "or"}));
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p todo-engine --test e2e api::planner_settings_round_trip_through_sqlite`

Expected: FAIL with a missing route.

- [ ] **Step 3: Merge the shared router without moving Todo routes**

```rust
Router::new()
    .merge(backend::api::router(state.db_path.clone()))
    .route("/health", get(health))
```

Validate that PUT receives an object and use the `planner.v1` preference key.

- [ ] **Step 4: Run the focused API test**

Run: `cargo test -p todo-engine --test e2e api::planner_settings_round_trip_through_sqlite`

Expected: PASS.

- [ ] **Step 5: Commit the mounted API**

```bash
git add todo-engine/Cargo.toml todo-engine/src/interfaces/api/mod.rs backend todo-engine/tests/e2e/api.rs
git commit -m "[ADD] Persist planner preferences through shared backend"
```

### Task 3: Replace browser storage with the settings API

**Files:**
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- Modify: `frontend/tests/presentation/use-workbench-controller.spec.tsx`

**Interfaces:**
- Consumes: `GET /todo-engine/settings/planner` returning a value or `null`
- Consumes: `PUT /todo-engine/settings/planner` with `{ value: PlannerPreferences }`
- Produces: restored Planner filters, group settings, and sort rules after controller remount

- [ ] **Step 1: Write the failing controller remount test**

```tsx
it("restores planner preferences from the API after remounting", async () => {
  // Mock GET with saved settings, render the hook, and assert group/filter/sort state.
});
```

- [ ] **Step 2: Run the focused frontend test to verify it fails**

Run: `npm test --prefix frontend -- use-workbench-controller.spec.tsx`

Expected: FAIL because the controller only reads browser storage.

- [ ] **Step 3: Implement API hydration and best-effort writes**

```ts
void fetch("/todo-engine/settings/planner", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ value: settings }),
});
```

On mount, fetch once and normalize the returned document. Preserve defaults on a missing, malformed, or failed response. Remove all `localStorage` reads and writes for Planner preferences.

- [ ] **Step 4: Run focused frontend test**

Run: `npm test --prefix frontend -- use-workbench-controller.spec.tsx`

Expected: PASS.

- [ ] **Step 5: Commit frontend persistence**

```bash
git add frontend/src/features/workbench/hooks/useWorkbenchController.ts frontend/tests/presentation/use-workbench-controller.spec.tsx
git commit -m "[UPDATE] Restore planner preferences from local API"
```

### Task 4: Document and verify the final state

**Files:**
- Modify: `README.md`
- Modify: `docs/operations/api-reference.md`

- [ ] **Step 1: Document the shared preference table and two settings endpoints**

Add `workspace_preferences` to the SQLite data-model reference and add `GET`/`PUT /settings/planner` to the API reference. State that values are workspace-wide and malformed preference data falls back to frontend defaults.

- [ ] **Step 2: Run final verification**

Run: `cargo fmt --check && cargo test && cargo clippy --all-targets --all-features -- -D warnings && npm test --prefix frontend && npm run typecheck --prefix frontend && npm run build --prefix frontend`

Expected: every command exits `0`.

- [ ] **Step 3: Commit documentation**

```bash
git add README.md docs/operations/api-reference.md
git commit -m "[DOCS] Document workspace preference persistence"
```
