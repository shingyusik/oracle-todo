# Phase 2: Service Policy — Goal Create, Link & Validation - Research

**Researched:** 2026-06-22
**Domain:** Internal Rust service-layer policy (clean/hexagonal `todo-engine`) — goal creation, anchor validation, nesting rules, task linking, and the list-filter read primitive
**Confidence:** HIGH (all findings grounded in the actual current source; no external dependencies)

## Summary

This phase concentrates all period-goal planning *policy* in the existing `TodoService`. Phase 1 already shipped the three one-way foundations this phase consumes: `ItemType::Goal` (a string-mapped enum variant, zero schema), the pure `Horizon` helper with `normalize_to_period_start` / `is_period_start` / `is_coarser_than`, and the three additive planning indexes. Nothing new about the schema, ring structure, or mutation path is introduced — every goal create, every task link, and every anchor rejection routes through the *single shared* `TodoService::store_item_and_event` helper that already enforces the audit-event invariant (`[VERIFIED: todo-engine/src/application/service/mod.rs:110-139]`).

The work is almost entirely additive Rust inside `application/service/` plus two small additions to the read port. A new `propose_goal`/`create_goal` request + method goes in `creation.rs` (mirroring `propose_project`); a new validation helper parses and strict-checks the `(horizon, scheduled)` anchor using the Phase 1 domain functions; cycle / horizon-inversion / duplicate checks walk the repository via the existing `get` and `list_items` reads. Task linking reuses `update_item` but needs a new `parent_id` field plumbed through `UpdateItem` (it is currently absent — `[VERIFIED: todo-engine/src/application/service/update.rs:5-23]`). The VIEW-01 read primitive needs two new optional filter fields (`horizon`, `parent_id`) on `ListFilter` and matching predicates in `apply_list_filter`.

**Primary recommendation:** Add `propose_goal` to `creation.rs` and a private `validate_goal_anchor` + `validate_goal_nesting` pair to a new `service/goal.rs` module; extend `UpdateItem` with `parent_id` and `horizon`; extend `ListFilter` + `apply_list_filter` with `horizon` and `parent_id`. Introduce exactly **one** new `TodoError` variant decision (reuse `Validation` for anchor parse/canonical failures, reuse `Policy` for nesting/duplicate rejections — both already map to CLI exit 2 / HTTP 400). Do NOT touch interfaces (CLI/API surface is Phase 5) except possibly a thin internal wiring; this phase is service-layer + tests only.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Goal create (Proposed/Approved gating, audit) | application/service (`creation.rs`) | domain (`TodoItem::new`) | Policy + state machine + audit live in service; `TodoItem::new` already sets status from actor `[VERIFIED: model.rs:95-141]` |
| Anchor parse + canonical check | application/service (new `goal.rs`) | domain (`horizon.rs`) | Service owns string→Date parse (`parse_day` already exists, mod.rs:219); domain owns the pure `is_period_start` canonical check |
| Horizon string→enum parse | application/service | domain (`Horizon::from_str`) | `Horizon` is a domain enum with `FromStr` `[VERIFIED: horizon.rs:47-58]`; service calls it |
| Cycle / inversion / duplicate detection | application/service (new `goal.rs`) | application/ports (reads) | Pure policy walking repository reads via `get`/`list_items` |
| Task→goal linking | application/service (`update.rs`) | — | Reuse the audited `update_item` path; add `parent_id` field |
| List filter by horizon/period/parent | application/ports (`ListFilter` + `apply_list_filter`) | application/service (`queries.rs`) | The read primitive; `list_items` already delegates to `apply_list_filter` for in-memory and to the store for persistent |
| ItemStatus-for-goals semantics | docs (README + a decision doc) | — | A documentation deliverable, not code (SC5) |

## Standard Stack

This is internal codebase work. **No new external packages.** The phase uses only crates already in the workspace.

### Core (already present — verify nothing new is added)
| Crate | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `time` | (workspace pinned) | `Date` parse/normalize for anchors | Already used by `parse_day` (mod.rs:219) and `horizon.rs` `[VERIFIED: service/mod.rs:3, domain/horizon.rs:3]` |
| `thiserror` | (workspace pinned) | `TodoError` variants | Error type already defined `[VERIFIED: error.rs:1]` |
| `serde` / `serde_json` | (workspace pinned) | event before/after snapshots, JSON | Already used throughout service |
| `uuid` | (workspace pinned) | persistent id generation | `next_id` already uses it (mod.rs:58-73) |

**Installation:** None. Adding external dependencies for this phase would violate the "no new ring, no new mutation path" constraint and is out of scope.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reusing `update_item` for linking | A bespoke `link_task` method | A separate method risks bypassing the shared audit path; CORE-01 forbids bypass. Add `parent_id` to `UpdateItem` and reuse the audited path instead. `[ASSUMED]` — confirm with planner whether a thin typed `link_task` wrapper that *delegates* to update is preferred for surface clarity |
| New `TodoError::Validation` usage for nesting | A new dedicated error variant | Unnecessary — `Validation` and `Policy` both already map to exit 2 / 400 `[VERIFIED: error.rs:21-36]`. Adding a variant is non-additive churn |

## Package Legitimacy Audit

Not applicable — this phase installs **no external packages**. All code uses crates already vendored in the workspace `Cargo.toml`. No registry verification needed.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GOAL-01 | Create a period goal via `Goal` item type, reusing status/approval/audit | New `propose_goal` in `creation.rs` mirroring `propose_project`; `TodoItem::new(.., ItemType::Goal, ..)` sets Proposed/Approved from actor `[VERIFIED: model.rs:102-113]`; `store_item_and_event` writes the audit row `[VERIFIED: mod.rs:110-139]` |
| GOAL-03 | Service validates goal `scheduled` anchor (rejects unparseable/non-canonical) | New `validate_goal_anchor`: `parse_day` (mod.rs:219) → `is_period_start` (horizon.rs:90) strict check; reject `"today"` sentinel explicitly before parse |
| GOAL-04 | Nest goals via `parent_id`, level-skipping allowed; reject cycles + inverted nesting | New `validate_goal_nesting`: walk ancestors via `get` with visited set; `Horizon::is_coarser_than` for inversion `[VERIFIED: horizon.rs:42-45]` |
| GOAL-05 | Reject duplicate goal for same `(horizon, scheduled, parent_id)` | Duplicate check via `list_items(ListFilter{ item_type: Goal, .. })` then filter on normalized `(horizon, scheduled, parent_id)` |
| LINK-01 | Link existing task to goal via `parent_id` | Add `parent_id` to `UpdateItem` (currently absent — update.rs:5-23); validate parent is a non-terminal `Goal` via a new `ensure_relation`-style check |
| LINK-02 | Set task `scheduled` date (anchors in date view) | `update_item` already sets `scheduled` `[VERIFIED: update.rs:89-91]`; no new code, but add a test |
| VIEW-01 | List goals/tasks filtered by horizon, period, parent | Add `horizon` + `parent_id` to `ListFilter` (ports.rs:18-27) and predicates to `apply_list_filter` (ports.rs:29-78) |
| CORE-01 | All planning mutations route through `TodoService` (no direct repo writes) | Every new path calls `store_item_and_event`; no `save_item` is ever called directly from interfaces. Architecture test guards domain purity `[VERIFIED: tests/unit/architecture.rs]` |

## Architecture Patterns

### System Architecture Diagram

```
                       ┌─────────────────────────────────────────────┐
   CLI / API           │  Phase 5 wires these; Phase 2 leaves them    │
   (NOT this phase) ───▶│  alone except internal request structs.      │
                       └───────────────────┬─────────────────────────┘
                                           │ (request struct e.g. ProposeGoal)
                                           ▼
   ┌───────────────────────────────────────────────────────────────────┐
   │  TodoService  (application/service/)                              │
   │                                                                   │
   │  propose_goal(req) ──┐                                            │
   │    1. parse+validate │  validate_goal_anchor(horizon, scheduled) │
   │       anchor ────────┼──▶ parse_day ──▶ is_period_start (domain) │
   │    2. validate ──────┤  validate_goal_nesting(parent_id, horizon)│
   │       nesting ───────┼──▶ get(ancestor) loop + is_coarser_than   │
   │    3. duplicate ─────┼──▶ list_items(type=Goal) filter on triple │
   │       check          │                                            │
   │    4. build TodoItem │  TodoItem::new(ItemType::Goal) → status    │
   │       (status from   │  from actor (Proposed/Approved)            │
   │       actor)         │                                            │
   │    5. store ─────────┴──▶ store_item_and_event  ◀── SINGLE shared │
   │                              │   path (audit invariant)           │
   │  update_item(+parent_id) ────┘                                    │
   │  list_items(filter+horizon/parent) ──▶ apply_list_filter / store  │
   └───────────────────────────────┬───────────────────────────────────┘
                                    ▼
   ┌───────────────────────────────────────────────────────────────────┐
   │  ports (TodoStore) → infrastructure/sqlite  (unchanged for writes) │
   │  list_items filter gains horizon/parent_id predicates              │
   └───────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| File | Change | Responsibility |
|------|--------|----------------|
| `application/service/creation.rs` | ADD `ProposeGoal` struct + `propose_goal` method | Goal create entry; mirrors `propose_project` (creation.rs:112-128) |
| `application/service/goal.rs` (NEW) | ADD `validate_goal_anchor`, `validate_goal_nesting`, `ensure_goal_parent`, duplicate check | All goal-specific policy; `pub(super)` helpers on `impl TodoService` |
| `application/service/mod.rs` | ADD `mod goal;` + `pub use creation::ProposeGoal;` | Wire the new module/export |
| `application/service/update.rs` | ADD `parent_id: Option<String>` to `UpdateItem` + apply block | Task→goal linking via the audited update path |
| `application/ports.rs` | ADD `horizon: Option<String>` + `parent_id: Option<String>` to `ListFilter`; ADD predicates to `apply_list_filter` | VIEW-01 read primitive |
| `application/error.rs` | NO CHANGE (reuse `Validation`/`Policy`) | Both already map to 2/400 |

### Pattern 1: Mirror `propose_project` for `propose_goal`
**What:** A create method that resolves relations, builds the item via `TodoItem::new`, sets type-specific fields, and stores through the shared audit helper.
**When to use:** GOAL-01.
**Example (model — adapt; this is the real `propose_project` shape):**
```rust
// Source: todo-engine/src/application/service/creation.rs:112-128 (VERIFIED current code)
pub fn propose_project(&mut self, request: ProposeProject) -> TodoResult<TodoItem> {
    let area_id = self.find_area(request.area)?;
    let now = self.next_now();
    let mut item = TodoItem::new(
        self.next_id("project"),
        ItemType::Project,
        request.title,
        request.actor,
        now,
    );
    item.area_id = area_id;
    item.definition_of_done = request.definition_of_done;
    // ...
    self.store_item_and_event(item.proposed_by, "propose_project", None, item, None)
}
```
For `propose_goal`: validate anchor & nesting & duplicate FIRST (return early on rejection), then `TodoItem::new(next_id("goal"), ItemType::Goal, ...)`, set `item.horizon`, `item.scheduled` (normalized-or-rejected canonical string), `item.parent_id`, then `store_item_and_event(item.proposed_by, "propose_goal", None, item, None)`.

### Pattern 2: Actor-driven status (no special goal code needed)
**What:** `TodoItem::new` already derives `Proposed` (agent) vs `Approved` (user) from the actor and sets `approved_by`/`approved_at` accordingly.
**Source:** `[VERIFIED: model.rs:102-113, 130-132]`
```rust
let approved = actor == Actor::User;
status: if approved { ItemStatus::Approved } else { ItemStatus::Proposed },
```
SC1's "agent → Proposed, user → Approved" is satisfied for free by passing `request.actor` into `TodoItem::new`. No goal-specific status branch is needed.

### Pattern 3: Anchor validation (parse → strict canonical)
**What:** Parse the `scheduled` string to `time::Date`, then assert it equals its canonical period start for the goal's horizon.
**Building blocks (both exist):** `parse_day` (service/mod.rs:219-224, returns `TodoError::Validation` on parse failure) + `is_period_start` (domain/horizon.rs:90-92).
```rust
// Recommended new helper in service/goal.rs (composed from VERIFIED existing fns)
fn validate_goal_anchor(horizon: Horizon, scheduled: &str) -> TodoResult<String> {
    let trimmed = scheduled.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("today") {
        return Err(TodoError::Validation(format!(
            "Goal scheduled anchor must be an explicit ISO date, not '{trimmed}'"
        )));
    }
    let date = parse_day(trimmed)?; // returns Validation on unparseable
    if !is_period_start(date, horizon) {
        return Err(TodoError::Validation(format!(
            "scheduled {trimmed} is not the canonical {} start", horizon.as_str()
        )));
    }
    Ok(trimmed.to_string())
}
```
**Note on the sentinel:** `"today"` is a real CLI/view sentinel for *tasks* (README task section: "scheduled is empty, today, or a date"; `today_string()` at cli/mod.rs:468 resolves the real date). Goals must reject it because a goal anchor must be canonical and stable, not relative. SC2 calls this out explicitly.

### Pattern 4: Cycle + horizon-inversion nesting check
**What:** Walk the `parent_id` chain upward; reject if the new child would close a cycle, and reject if the parent's horizon is not strictly coarser than the child's.
```rust
// Recommended new helper in service/goal.rs
fn validate_goal_nesting(&mut self, parent_id: &str, child_horizon: Horizon)
    -> TodoResult<()> {
    let parent = self.get(parent_id)?;                 // NotFound → 404
    if parent.item_type != ItemType::Goal {
        return Err(TodoError::Policy(format!("Goal parent must be goal: {parent_id}")));
    }
    let parent_h = parent.horizon.as_deref()
        .ok_or_else(|| TodoError::Policy("Goal parent missing horizon".into()))?
        .parse::<Horizon>().map_err(TodoError::Validation)?;
    if !parent_h.is_coarser_than(child_horizon) {       // strict; equal is rejected
        return Err(TodoError::Policy(format!(
            "Goal parent horizon {} must be strictly coarser than {}",
            parent_h.as_str(), child_horizon.as_str())));
    }
    // cycle guard: walk ancestors with a visited set + depth cap
    let mut visited = std::collections::HashSet::new();
    let mut cursor = Some(parent.id.clone());
    let mut depth = 0;
    while let Some(id) = cursor {
        if !visited.insert(id.clone()) {
            return Err(TodoError::Policy(format!("Goal nesting cycle at {id}")));
        }
        depth += 1;
        if depth > MAX_GOAL_DEPTH { /* e.g. 64 */
            return Err(TodoError::Policy("Goal nesting too deep".into()));
        }
        cursor = self.get(&id)?.parent_id;
    }
    Ok(())
}
```
Note: at *create* time the new goal has no id yet, so a self-cycle is impossible; the visited-set walk guards against pre-existing cyclic/legacy data and is reused defensively. `MAX_GOAL_DEPTH` should be a named constant (the `constants-config-audit` skill exists — keep magic numbers out).

### Pattern 5: Duplicate detection on `(horizon, normalized_scheduled, parent_id)`
**What:** After computing the canonical scheduled string, list existing goals and reject an exact triple match.
```rust
let existing = self.list_items(ListFilter {
    item_type: Some(ItemType::Goal),
    ..Default::default()
})?;
let dup = existing.iter().any(|g|
    g.horizon.as_deref() == Some(horizon.as_str())
    && g.scheduled.as_deref() == Some(canonical.as_str())
    && g.parent_id == parent_id          // both Option<String>, top-level goals share None
);
if dup { return Err(TodoError::Policy(format!(
    "Duplicate goal for ({}, {}, {:?})", horizon.as_str(), canonical, parent_id))); }
```
Because the canonical string is what gets stored, comparing stored `scheduled` to the canonical value is correct. The `idx_items_type_horizon_scheduled` composite index pre-paves this access path for the persistent store `[VERIFIED: 01-03-SUMMARY.md]`, but the current in-memory and persistent `list_items` both materialize and filter in memory (queries.rs:19-32) — acceptable for v1 (the full-scan debt is flagged for Phase 4, not here).

### Anti-Patterns to Avoid
- **Bypassing `store_item_and_event`.** Never call `store.save_item` directly from a goal path — it skips the audit event and breaks CORE-01. Every mutation goes through `store_item_and_event` (mod.rs:110) which writes the `TodoEvent` atomically (`save_item_and_event` for persistent).
- **Auto-snapping a non-canonical anchor.** Phase 1 locked "never auto-snap; strict reject is Phase 2." Do NOT call `normalize_to_period_start` to silently fix a bad anchor — call `is_period_start` and reject. (You *may* normalize for the duplicate-comparison key, but the stored value for a valid create equals the user's already-canonical input.)
- **Adding a new error variant for nesting/duplicate.** `Policy` and `Validation` already exist and map correctly. Adding variants is non-additive churn.
- **Adding goal create/link to CLI or API in this phase.** That surface is Phase 5 (SURF-01/02). Keep this phase service-layer + tests.
- **Putting parsing in the domain.** `horizon.rs` operates on already-parsed `time::Date`; string parsing stays in the service (locked in 01-01-SUMMARY decisions).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Period-start normalization | A new week/month/year math | `normalize_to_period_start` / `is_period_start` (horizon.rs) | LYNCHPIN already tested at boundaries (W01/W53/Dec31/Jan1) `[VERIFIED: 01-01-SUMMARY.md]` |
| Horizon coarseness comparison | Manual rank ints | `Horizon::is_coarser_than` (horizon.rs:42) | Strict ordering, no `Ord`, equality-not-coarser is exactly the parent rule |
| Date string parsing | Hand-rolled split/validate | `parse_day` (service/mod.rs:219) | Already returns `TodoError::Validation` with a clear message |
| Audit event writing | Manual `TodoEvent` build per path | `store_item_and_event` (mod.rs:110) | Single shared path; builds before/after snapshots and pushes/persists atomically |
| Relation-type guard | Inline type checks | `ensure_relation` pattern (mod.rs:169) | Existing pattern rejects wrong-type and terminal parents with consistent `Policy` messages |
| Status-from-actor | Manual Proposed/Approved branch | `TodoItem::new` (model.rs:95) | Already sets status, approved_by, approved_at from actor |

**Key insight:** Phase 1 deliberately pre-built every primitive this phase needs. Phase 2 is *composition of existing verified helpers* plus three small additive struct extensions — not new machinery.

## Runtime State Inventory

This is a **greenfield additive feature within an existing engine**, not a rename/refactor/migration. There is no string-rename or data-migration dimension. Explicitly:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — goals are new rows in the existing `items` table; no existing data keys/ids change. Verified: `Goal` reuses the `type` column, no `period_key` (`[VERIFIED: CORE-02, 01-02/01-03 SUMMARYs]`). | None |
| Live service config | None — no external service holds goal state; SQLite is the sole store. | None |
| OS-registered state | None — no scheduler/daemon registration touched. | None |
| Secrets/env vars | None — `TODO_ENGINE_HOME`/log env vars unaffected. | None |
| Build artifacts | None — pure additive Rust; `cargo build` recompiles. No package rename. | None |

**Nothing requires data migration.** The only "schema" surface is the already-shipped additive indexes and enum variant from Phase 1.

## Common Pitfalls

### Pitfall 1: Treating `"today"` as a valid goal anchor
**What goes wrong:** A goal created with `scheduled="today"` would be non-canonical and relative, breaking period bucketing.
**Why it happens:** `"today"` is a legitimate sentinel for *tasks* (README task section; `today_string()` resolves it at view time, cli/mod.rs:468). It is easy to assume goals inherit that.
**How to avoid:** Reject `"today"` (and empty) explicitly in `validate_goal_anchor` before parsing (SC2). Tasks keep their sentinel; goals do not.
**Warning signs:** A goal row with `scheduled="today"` in SQLite; a period view that can't bucket it.

### Pitfall 2: Horizon inversion passing because of equality
**What goes wrong:** Allowing a week-goal to parent a week-goal, or finer to parent equal/coarser.
**Why it happens:** Using a `<=` style check or `Ord`. Phase 1 intentionally provides only `is_coarser_than` (strict) and no `Ord` (`[VERIFIED: horizon.rs:9-17, 38-45]`).
**How to avoid:** Require `parent_horizon.is_coarser_than(child_horizon)` to be `true`; equality returns `false` and is correctly rejected.
**Warning signs:** A month-goal nested under another month-goal.

### Pitfall 3: Duplicate check comparing raw vs normalized scheduled
**What goes wrong:** Two goals for the same period slip through because one stored a differently-formatted (but same-period) date.
**Why it happens:** Comparing user-input strings instead of the canonical value.
**How to avoid:** Since valid creates store the canonical (already `is_period_start`-true) string, compare stored `scheduled` against the canonical value computed for the new goal. All valid goals for a period share the identical canonical string. (Top-level goals share `parent_id = None` — `Option<String>` equality handles this.)
**Warning signs:** Two `goal` rows with the same horizon and equivalent period but both accepted.

### Pitfall 4: `UpdateItem` silently lacks `parent_id`
**What goes wrong:** LINK-01 "link via parent_id" has no field to carry the parent today.
**Why it happens:** `UpdateItem` currently has no `parent_id` field (`[VERIFIED: update.rs:5-23]`).
**How to avoid:** Add `parent_id: Option<String>` to `UpdateItem` and an apply block that validates the parent is a non-terminal `Goal` (reuse the `ensure_relation` pattern, mod.rs:169) before setting `item.parent_id`. Setting `scheduled` already works (update.rs:89).
**Warning signs:** Test for LINK-01 won't compile / no way to pass the parent.

### Pitfall 5: Forgetting the dispatcher `mod` line for new test files
**What goes wrong:** A new `tests/integration/goal_policy.rs` silently never runs.
**Why it happens:** Cargo only compiles top-level `tests/*.rs`; subfolder files must be `mod`-declared in the dispatcher (`[VERIFIED: docs/conventions/testing.md:35-50]`).
**How to avoid:** Add `mod goal_policy;` to `tests/integration.rs` (alphabetical), matching how `goal_roundtrip`/`schema_indexes` were registered.
**Warning signs:** New tests "pass" because they never executed.

## Code Examples

### Resolving + validating a goal parent (reuse the ensure_relation pattern)
```rust
// Source: todo-engine/src/application/service/mod.rs:169-192 (VERIFIED — adapt expected type to Goal)
pub(super) fn ensure_relation(
    &mut self, item_id: Option<String>, expected: ItemType, label: &str,
) -> TodoResult<Option<String>> {
    let Some(item_id) = item_id else { return Ok(None); };
    let item = self.get(&item_id)?;
    if item.item_type != expected {
        return Err(TodoError::Policy(format!("{label} must be {}: {item_id}", expected.as_str())));
    }
    if terminal_status(item.status) {
        return Err(TodoError::Policy(format!("{label} is terminal: {}", item.status.as_str())));
    }
    Ok(Some(item.id))
}
```

### Extending the list filter (VIEW-01)
```rust
// Source: todo-engine/src/application/ports.rs:18-27 + 29-78 (VERIFIED current; add two fields + two predicates)
#[derive(Clone, Debug, Default)]
pub struct ListFilter {
    pub status: Option<ItemStatus>,
    pub item_type: Option<ItemType>,
    pub area_id: Option<String>,
    pub project_id: Option<String>,
    pub routine_id: Option<String>,
    pub horizon: Option<String>,      // NEW
    pub parent_id: Option<String>,    // NEW
    pub query: Option<String>,
    pub include_archived: bool,
}
// in apply_list_filter, add:
.filter(|item| filter.horizon.as_ref().is_none_or(|h| item.horizon.as_ref() == Some(h)))
.filter(|item| filter.parent_id.as_ref().is_none_or(|p| item.parent_id.as_ref() == Some(p)))
```
**"Period" filtering:** VIEW-01 says "filter by horizon, period, and parent." A *period* is `(horizon, scheduled)`. The simplest v1 implementation: filter by `horizon` AND by exact canonical `scheduled` (add the existing-but-currently-unused ability to match `scheduled` — there is no `scheduled` field on `ListFilter` today, so add `scheduled: Option<String>` too, or treat "period" = `horizon` + a `scheduled` equality). `[ASSUMED]` Recommend adding `scheduled: Option<String>` to `ListFilter` so "period" = exact `(horizon, scheduled)` match; confirm with planner whether range filtering is deferred to Phase 3 (Date View). The persistent `SqliteTodoRepository::list_items` impl must mirror any new predicate — locate it in `infrastructure/sqlite/repo.rs` (`list_items`) and add matching SQL/in-memory filtering.

### Persistent store predicate parity
The persistent path delegates to `store.list_items(filter)` (queries.rs:30). `[ASSUMED — VERIFY]` The SQLite `list_items` in `infrastructure/sqlite/repo.rs` likely loads-then-filters in memory (matching the flagged full-scan debt in CONCERNS.md). Confirm by reading `repo.rs::list_items`; if it filters in Rust by reusing `apply_list_filter`, the two new fields work for free — if it builds SQL `WHERE` clauses, add `horizon`/`parent_id`/`scheduled` clauses there too. **Planner must add a task to update the persistent impl and an integration test that exercises it (not just in-memory).**

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Goals as separate table / `period_key` column | `Goal` ItemType + `(horizon, scheduled)` derived period | Locked at project start, shipped Phase 1 | Free reuse of status/approval/audit; no migration |
| Auto-snap non-canonical dates | Strict reject via `is_period_start` | Phase 1 decision, enforced Phase 2 | Deterministic period bucketing |

**Deprecated/outdated:** None relevant. The codebase is current and internally consistent.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Reuse `update_item` (with new `parent_id` field) for linking rather than a bespoke `link_task` method | Alternatives / LINK-01 | If a typed `link_task` wrapper is preferred for surface clarity, planner adds a thin delegating method — low risk, still routes through audited path |
| A2 | Add `scheduled: Option<String>` to `ListFilter` so "period" = exact `(horizon, scheduled)` match; range filtering deferred to Phase 3 | VIEW-01 | If VIEW-01 needs range now, planner pulls minimal range support forward; medium risk to scope |
| A3 | Persistent `SqliteTodoRepository::list_items` filters in memory (so new fields work by reusing `apply_list_filter`) | Persistent store parity | If it builds SQL WHERE clauses, planner must add SQL predicates + a persistent integration test — VERIFY by reading repo.rs::list_items before planning |
| A4 | `MAX_GOAL_DEPTH` constant value (suggest 64) | Nesting check | Wrong cap only affects pathological depth; low risk; pick a named constant |
| A5 | Reuse `Validation` for anchor errors and `Policy` for nesting/duplicate (no new error variant) | Error type | Both map to 2/400 already; if a distinct variant is wanted for messaging, it's additive — low risk |

## Open Questions (RESOLVED)

1. **Does the persistent `list_items` filter in Rust or in SQL?**
   - What we know: in-memory path reuses `apply_list_filter` (queries.rs:21-29); persistent path delegates to `store.list_items` (queries.rs:30).
   - What's unclear: whether `infrastructure/sqlite/repo.rs::list_items` reuses `apply_list_filter` or builds SQL. Not read in this pass.
   - Recommendation: planner's first task reads `repo.rs::list_items`; add the two/three new filter fields to whichever mechanism it uses, and a persistent integration test for VIEW-01.
   - **RESOLVED (02-PATTERNS.md):** `repo.rs::list_items` loads all rows then delegates to the shared `apply_list_filter` (repo.rs:39) — it filters in Rust, not SQL. The new `ListFilter` fields work for both the in-memory and persistent backends from a single `ports.rs` edit; `repo.rs` needs no code change (verify-only). Bound-param SQLi note applies only to writes (`save_item_on`), which are untouched.

2. **Typed `link_task` wrapper vs. plain `update_item` with `parent_id`?**
   - What we know: `update_item` is the single audited update path; adding `parent_id` is additive.
   - What's unclear: surface preference for Phase 5.
   - Recommendation: implement `parent_id` on `UpdateItem` now (required regardless); a thin `link_task(task_id, goal_id, scheduled)` that delegates can be added if the planner wants clearer intent — it must NOT bypass `update_item`.
   - **RESOLVED (plans 02-01/02-03):** chose plain `update_item` + additive `UpdateItem.parent_id` (no bespoke `link_task` wrapper); both the parent link and the `scheduled` set route through the single audited `update_item` path.

3. **Where exactly to record the ItemStatus-for-goals semantics (SC5)?**
   - What we know: STATE.md flags it as a Phase 2 documentation blocker; recommendation is "goal is `Active` for its period; `Completed`/`Dropped` are user-driven; no cascade to children in v1."
   - Recommendation: record in `README.md` (add a short "Goal" item-type subsection mirroring the existing Task/Project subsections, README:104+) AND in `docs/architecture/decisions/` as a decision record. Use the `docs-tools` skill for the doc sync.
   - **RESOLVED (plan 02-04):** recorded in README `### Goal` subsection + `## Status lifecycle` goal note, plus `docs/architecture/decisions/adr-0006-goal-itemstatus-semantics.md`, via the `docs-tools` skill.

## ItemStatus-for-Goals Decision (SC5 deliverable)

**Recommended documented semantics (confirmed against the actual lifecycle):**
- A `Goal` reuses the existing `ItemStatus` lifecycle unchanged (no new states — out of scope per REQUIREMENTS.md "New goal-specific status states ... OUT OF SCOPE").
- Agent-created goal → `Proposed` (requires approval). User-created goal → `Approved`. Both derive from actor via `TodoItem::new` `[VERIFIED: model.rs:102-113]`.
- A goal is meaningfully `Active` for its period once activated through the normal `activate` path. **Note:** `activate` currently special-cases `Project`/`Routine`/`Area` (transitions.rs:36-50) but has no `Goal` branch, so a goal activates with no extra precondition — acceptable for v1. The agent-approval gate at transitions.rs:31-35 still applies.
- `Completed`/`Dropped`/`Cancelled` are **user-driven and terminal** (status.rs:20-30); a goal reaching terminal status does **NOT cascade to children** in v1 (no rollup, no auto-complete of linked tasks). The only existing cascade is routine→generated-tasks (transitions.rs:231), which does not apply to goals.
- Record this in README (new Goal subsection) + a decision doc. This is a **documentation task**, not code.

## Environment Availability

No external runtime dependencies for this phase. It is pure Rust compiled and tested with the existing toolchain.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `cargo` / rustc (2024 edition) | build + test | ✓ (project builds today) | workspace-pinned | — |
| SQLite (`rusqlite` bundled) | persistent tests | ✓ | bundled crate | in-memory `TodoService::in_memory()` for unit/most integration |

**Missing dependencies:** None.

## Validation Architecture

`workflow.nyquist_validation` was not found disabled — treat as enabled. Each success criterion maps to a concrete test layer and assertion. Tests follow the three-layer convention (`[VERIFIED: docs/conventions/testing.md]`): **unit** (pure, public API, no I/O), **integration** (`TodoService` policy + audit + SQLite repo), **e2e** (binary/HTTP — **deferred to Phase 5**, which owns the surface).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Rust built-in `#[test]` + `assert_cmd`/`tower` for e2e (e2e not used this phase) |
| Config file | none — cargo test binaries via dispatchers (`tests/unit.rs`, `tests/integration.rs`) |
| Quick run command | `cargo test --test integration` |
| Full suite command | `cargo test` (then `cargo fmt --check` + `cargo clippy --all-targets --all-features -- -D warnings`) |

### Phase Requirements → Test Map
| SC / Req | Behavior | Test Type | Automated Command | File |
|----------|----------|-----------|-------------------|------|
| SC1 / GOAL-01 | Agent goal → `Proposed`; user goal → `Approved`; audit `TodoEvent` written | integration | `cargo test --test integration goal_policy` | `tests/integration/goal_policy.rs` (NEW) — assert `status`, `proposed_by`, and `service.events().last().action == "propose_goal"` (pattern: service_policy.rs:143) |
| SC2 / GOAL-03 | Reject unparseable, `"today"`, and non-canonical anchor with `Validation` | integration + unit | `cargo test --test integration goal_policy` ; `cargo test --test unit horizon` | integration asserts `propose_goal` returns `Err(TodoError::Validation(..))`; unit can directly test a pure `validate_goal_anchor` if extracted, plus `is_period_start` already covered (unit/horizon.rs) |
| SC3a / GOAL-04 | Reject cycle and reject horizon inversion (equal or finer parent) | integration | `cargo test --test integration goal_policy` | assert `Err(TodoError::Policy(..))` for week-parents-month and for a manufactured cycle |
| SC3b / GOAL-05 | Reject duplicate `(horizon, scheduled, parent_id)` | integration | `cargo test --test integration goal_policy` | create one goal, assert the second identical create returns `Err(Policy(..))` |
| SC4 / LINK-01,02 | Link task to goal via `parent_id` + set `scheduled` through `update_item`; audit row written | integration | `cargo test --test integration goal_policy` | create goal + task, `update_item{ parent_id, scheduled }`, assert `item.parent_id`, `item.scheduled`, and event `action == "update_item"` |
| SC4 (negative) | Linking to a non-Goal/terminal parent rejected | integration | same | assert `Err(Policy("Goal parent must be goal: .."))` |
| SC5 / VIEW-01 | List goals filtered by horizon, period (`scheduled`), and parent | integration + unit | `cargo test --test integration` ; `cargo test --test unit filter` | integration: persistent `list_items` honors new fields (use `TestHome`/SQLite, support/mod.rs); unit: extend `tests/unit/filter.rs` for `apply_list_filter` horizon/parent predicates |
| CORE-01 | No mutation bypasses the service | integration | covered implicitly — every assertion goes through `TodoService`; the `tests/unit/architecture.rs` boundary guard stays green | existing |

### Sampling Rate
- **Per task commit:** `cargo test --test integration goal_policy` (the new policy file) + `cargo build`.
- **Per wave merge:** `cargo test` (all three binaries).
- **Phase gate:** `cargo test && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings` all green before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `tests/integration/goal_policy.rs` — new file covering SC1–SC4; register `mod goal_policy;` in `tests/integration.rs` (alphabetical, after `goal_roundtrip`).
- [ ] `tests/unit/filter.rs` — extend (already exists) for new `apply_list_filter` predicates; no new dispatcher line needed.
- [ ] No framework install needed — `#[test]`, `assert_cmd`, `tower`, `tempfile` already in dev-deps (support/mod.rs uses `tempfile`).

*(If a pure `validate_goal_anchor` is extracted as a free fn, a `tests/unit/goal.rs` could unit-test it directly and would need a `mod goal;` line in `tests/unit.rs`.)*

## Security Domain

`security_enforcement` is not configured `false`; treat as enabled. This is a local-first, single-user engine with no network auth surface in this phase (the HTTP API is Phase 5 and binds `127.0.0.1`). The relevant ASVS category is input validation.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Local single-user engine; no auth in v1 |
| V3 Session Management | no | No sessions |
| V4 Access Control | no | No multi-tenant boundary |
| V5 Input Validation | **yes** | `parse_day` + `is_period_start` for anchors; `Horizon::from_str`/`ItemType` strict parse; `ensure_relation`-style type guards; reject `"today"` sentinel for goals |
| V6 Cryptography | no | None handled |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed/relative date anchor silently stored | Tampering | Strict `Validation` reject (GOAL-03); never auto-snap |
| Cyclic `parent_id` causing infinite traversal (esp. Phase 4 rollup) | Denial of Service | Visited-set + depth-cap guard in `validate_goal_nesting` (defensive for legacy data too) |
| SQL injection via filter strings | Tampering | `rusqlite` parameterized queries (existing repo convention — verify any new WHERE clause uses bound params, not string interpolation) |
| Mutation bypassing audit | Repudiation | CORE-01: all writes via `store_item_and_event`; architecture boundary test enforces ring rules |

## Project Constraints (from CLAUDE.md)

These are directives extracted from `D:\02_Area\oracle-todo\CLAUDE.md` and treated with locked-decision authority:
- **Do NOT bypass `TodoService`.** Every goal/link mutation routes through the service (CORE-01).
- **Audit events are mandatory.** Every mutation writes a `TodoEvent` — use `store_item_and_event`.
- **Schema changes additive only.** This phase adds NO schema (no column, no table) — only Rust + struct fields.
- **Layering: dependencies point inward.** Domain does no I/O (string parsing stays in service, not `horizon.rs`); `interfaces`/`infrastructure` depend on `application`/`domain`, never reverse. Enforced by `tests/unit/architecture.rs`.
- **`second_brain_refs` read-only.** Not touched this phase.
- **`pub(super)` visibility convention** for split-layer module internals (see docs/architecture/layers.md); new `goal.rs` helpers should be `pub(super)` on `impl TodoService`.
- **Project skills available for downstream steps:** `docs-tools` (README/docs sync for the ItemStatus-for-goals + Goal item-type docs), `code-audits` (`constants-config-audit` for `MAX_GOAL_DEPTH`, `architecture-boundary-audit`), `git-workflow` (`structured-commit`). These are under `.claude/plugins/` (source) and mirrored to `.codex/skills/`.

## Sources

### Primary (HIGH confidence — read this session)
- `todo-engine/src/application/service/mod.rs` — `store_item_and_event`, `ensure_relation`, `parse_day`, `find_area`, id/clock helpers
- `todo-engine/src/application/service/creation.rs` — `propose_project`/`propose_task`/`propose_event` create patterns + request structs
- `todo-engine/src/application/service/update.rs` — `UpdateItem` (no `parent_id` today), apply blocks, terminal guard
- `todo-engine/src/application/service/transitions.rs` — approve/activate/complete state machine, routine cascade (only existing cascade)
- `todo-engine/src/application/service/queries.rs` — `get`, `list_items` (in-memory vs persistent delegation)
- `todo-engine/src/application/ports.rs` — `ListFilter`, `apply_list_filter`, repository traits
- `todo-engine/src/application/error.rs` — `TodoError` variants + exit/HTTP mapping
- `todo-engine/src/domain/model.rs` — `TodoItem` fields (parent_id, scheduled, horizon), `ItemType::Goal`, actor-driven status in `new`
- `todo-engine/src/domain/status.rs` — `ItemStatus`, `terminal_status`, `hidden_by_default_status`
- `todo-engine/src/domain/horizon.rs` — `Horizon`, `is_coarser_than`, `normalize_to_period_start`, `is_period_start`
- `todo-engine/src/domain/mod.rs` — public re-exports
- `todo-engine/src/interfaces/cli/create.rs`, `api/handlers.rs`, `cli/views.rs`, `cli/markdown.rs` — confirmed NO goal/horizon/parent surface exists yet (Phase 5 scope); `"today"` sentinel resolution
- `todo-engine/tests/integration/service_policy.rs` — service-policy test patterns to extend
- `todo-engine/tests/support/mod.rs` — `TestHome`/temp data-home helper
- `docs/conventions/testing.md` — three-layer test convention + dispatcher gotcha
- `.planning/REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, `01-0{1,2,3}-SUMMARY.md` — phase scope, locked decisions, Phase 1 deliverables
- `README.md`, `CLAUDE.md` — data model, status lifecycle, project constraints

### Secondary (MEDIUM confidence)
- `infrastructure/sqlite/repo.rs::list_items` — referenced but NOT read this pass; flagged in Open Question 1 / A3 for the planner to verify.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all primitives verified in source.
- Architecture: HIGH — exact signatures and file locations read directly.
- Pitfalls: HIGH — derived from actual code (sentinel handling, strict ordering, missing `parent_id` field).
- Persistent `list_items` filtering mechanism: MEDIUM — repo.rs::list_items not yet read (Open Question 1).

**Research date:** 2026-06-22
**Valid until:** ~2026-07-22 (stable internal codebase; revalidate only if `application/service/` or `ports.rs` change before planning)

---

## RESEARCH COMPLETE

**Phase:** 2 - Service Policy — Goal Create, Link & Validation
**Confidence:** HIGH

### Key Findings
- Phase 1 pre-built every primitive: `ItemType::Goal`, `Horizon::is_coarser_than`, `normalize_to_period_start`/`is_period_start`, additive indexes. Phase 2 is composition of verified helpers, not new machinery.
- The single audited mutation path is `TodoService::store_item_and_event` (mod.rs:110); `TodoItem::new` already sets Proposed/Approved from actor — SC1 is nearly free.
- `UpdateItem` currently has **no `parent_id` field** (update.rs:5-23) — it must be added additively for LINK-01. `ListFilter` needs `horizon` + `parent_id` (and recommended `scheduled`) added for VIEW-01, with matching `apply_list_filter` predicates AND a persistent-store update.
- No new `TodoError` variant needed — reuse `Validation` (anchor parse/canonical) and `Policy` (nesting/duplicate/parent-type), both already map to CLI 2 / HTTP 400.
- The `"today"` sentinel is valid for tasks but must be **rejected** for goal anchors (SC2). Strict reject, never auto-snap (Phase 1 lock).

### File Created
`.planning/phases/02-service-policy-goal-create-link-validation/02-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | No external deps; all crates already vendored and used |
| Architecture | HIGH | Exact signatures/files read directly from source |
| Pitfalls | HIGH | Grounded in actual code (missing parent_id, strict ordering, sentinel) |

### Open Questions
1. Does persistent `SqliteTodoRepository::list_items` filter in Rust (free reuse) or build SQL WHERE clauses (needs new predicates + integration test)? — planner reads `repo.rs::list_items` first.
2. Typed `link_task` wrapper vs. `update_item` + `parent_id` (both route through the audited path).
3. Exact `scheduled`/period filtering shape for VIEW-01 (exact match now, range deferred to Phase 3?).

### Ready for Planning
Research complete. Planner can create PLAN.md files for: (1) goal create + anchor validation, (2) nesting + duplicate policy, (3) task linking + ListFilter read primitive, (4) ItemStatus-for-goals docs. Verify `repo.rs::list_items` before finalizing the VIEW-01 plan.
