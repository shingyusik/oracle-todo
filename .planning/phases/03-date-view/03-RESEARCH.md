# Phase 3: Date View - Research

**Researched:** 2026-06-23
**Domain:** Pure service-layer date-view query logic (Rust 2024, `time` 0.3, clean/hexagonal `application/service`)
**Confidence:** HIGH

## Summary

Phase 3 adds two (or one unified) **pure, side-effect-free query method(s)** to `TodoService` in `todo-engine/src/application/service/queries.rs`: a single-date agenda (`scheduled == D OR due == D`) and an arbitrary `[from, to]` range view (`scheduled` only). They return a **flat `Vec<TodoItem>`** in a deterministic order; grouping and the unscheduled bucket are the adapter's job in Phase 5 (D-01). No CLI subcommand, no HTTP endpoint, no schema change — service methods + tests only.

Almost everything needed already exists. `list_items(ListFilter)` is the read primitive that works identically over `InMemory` and `Persistent` stores; the date-view methods layer date filtering and sorting on top of it. The ISO date parse idiom is `service::parse_day` (`mod.rs:222`, `[year]-[month]-[day]` → `time::Date`, returns `TodoResult`), already shared across the service module. Open-only status filtering reuses `hidden_by_default_status`/`terminal_status` plus an explicit `[Proposed, Approved, Active]` allowlist (the exact pattern `today_tasks` already uses at `markdown.rs:80-89`). The existing `created_at → id` tie-break sort lives inline in `list_items` (`queries.rs:23-28`) and must be reused for in-bucket ordering (D-08).

**Primary recommendation:** Add `agenda(&mut self, date: &str) -> TodoResult<Vec<TodoItem>>` and `date_range(&mut self, from: &str, to: &str) -> TodoResult<Vec<TodoItem>>` to `queries.rs`. Each calls `list_items(ListFilter { item_type: Some(Task), ..default })`, then filters in Rust on parsed `scheduled`/`due` dates, then applies a deterministic sort with unscheduled-last ordering. Parse `&str` params internally via `parse_day` (validation errors surface as `TodoError::Validation`). Test with both a fast in-memory unit-style suite AND a persistent SQLite parity test mirroring `goal_view.rs`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Date filtering (`scheduled`/`due` match) | `application/service` (`queries.rs`) | — | CORE-03: view logic is shared service code so CLI/API agree (D-01a parity guard) |
| ISO date parsing + validation | `application/service` (`parse_day`) | `domain` (`time::Date` math) | Parsing is service-input validation; `time::Date` comparison is pure value logic |
| Open-only status filtering | `application/service` | `domain` (`hidden_by_default_status`) | Status predicates are pure domain; the allowlist policy is service |
| Deterministic sort | `application/service` (`queries.rs`) | — | The sort IS the parity guarantee (D-01a); must be single-sourced in service |
| Grouping / unscheduled-bucket display | `interfaces` (adapter, Phase 5) | — | D-01: adapter's job, NOT this phase |
| Routine materialization | `application/service` (`materialization.rs`) | — | **Must NOT be called** by date-view (SC4) — it is the side-effect path to avoid |

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Date-view methods return a flat `Vec<TodoItem>` + deterministic sort. Grouping / unscheduled-split is the adapter's job (CLI/API at display time). No dedicated `DateView` struct type.
- **D-01a (parity guard):** Because the return is a flat Vec, the deterministic sort IS the CLI/API parity guarantee (CORE-03). If grouping logic ends up duplicated across both adapters in Phase 5, it must stay identical (consider a shared pure grouping helper — planner/Phase 5 judgment).
- **D-02:** Single-date `D` agenda = `scheduled == D` **OR** `due == D` union, deduped by `id` (single date dedups naturally — one occurrence per id).
- **D-03:** Range `[from, to]` view filters/groups by `scheduled` **only**. No due-spanning for ranges (due-spanning is single-date agenda only).
- **D-04:** No tag/marker on due-included tasks. The adapter discriminates via the `scheduled`/`due` fields already on `TodoItem`.
- **D-05:** Open-only states exposed: `Proposed` / `Approved` / `Active`. Terminal/hidden (`completed`/`dropped`/`cancelled`/etc.) excluded. Follows existing hidden-by-default rule.
- **D-06:** Exact-date bucketing only, NO overdue rolling. Each task appears only in its own `scheduled` date bucket. The legacy `today` `scheduled <= today` roll is explicitly NOT replicated.
- **D-07:** Non-ISO `scheduled` (None, legacy `"today"` sentinel, junk) → unscheduled bucket. ISO-parse success only enters a date bucket. NEVER drop (SC2).
- **D-08:** Sort = `scheduled` asc (unscheduled last), tie-break `created_at` → `id` (reuse existing `list_items` ordering). No new sort semantics.

### Claude's Discretion
- Exact method count/names/signatures: `agenda(date)` + `date_range(from, to)` separate vs unified method.
- Param type: `time::Date` vs `&str` with internal parse (where parsing lives).
- Return-type placement (flat `Vec<TodoItem>` → no new type needed); how unscheduled is represented within the flat Vec (sort position = end).
- Test placement (unit vs integration) — follow `tests/integration/goal_view.rs` persistent-store idiom.

### Deferred Ideas (OUT OF SCOPE)
- Completed/terminal history-review view — v1 excluded.
- Overdue rollup ("today" agenda pulling in past-incomplete) — v1 excluded; possible Phase 5 adapter option.
- Rewiring the existing `today` CLI to delegate to the pure date view — Phase 5 (SURF) scope, not this phase.
- Priority sorting — needs a new field; out of scope.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VIEW-02 | Date view: tasks grouped by `scheduled` for single day + arbitrary `[from,to]` range; unscheduled surfaced in explicit bucket, never dropped | `agenda` + `date_range` methods built on `list_items`; `parse_day` for ISO; D-07 unscheduled-last sort keeps non-ISO/None in the Vec. Service returns flat Vec; grouping/bucketing is Phase 5 adapter. |
| VIEW-05 | Agenda spanning scheduled + due: for a date, see both scheduled-for and due-that-day tasks | `agenda(date)` does the `scheduled == D OR due == D` union (D-02), deduped by id. Both `scheduled` and `due` are `Option<String>` ISO fields on `TodoItem` (`model.rs:49-50`). |
| CORE-03 | View logic in application/service layer (shared by CLI/API), not adapter code | Methods live in `queries.rs` (`application/service`); D-01a deterministic sort is the parity guarantee. No adapter logic added this phase. |

## Standard Stack

### Core (already in tree — no new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `time` | 0.3 (features: formatting, parsing, macros, serde) | `Date` parse + compare for `scheduled`/`due` bucketing | Already the project's date crate; `Date` is `Ord` so range/equality comparisons are free |
| `rusqlite` | 0.32 (bundled) | Persistent store path behind `list_items` | Existing repo; date view never touches SQL directly — it composes `list_items` |
| `tempfile` | 3.15 (dev) | Temp SQLite home for persistent parity tests | Exactly the `goal_view.rs` idiom |

**No new packages. No Package Legitimacy Audit required** — this phase installs nothing.

**Installation:** None.

## Architecture Patterns

### System Architecture Diagram

```
caller (test now / Phase 5 CLI+API later)
        │  agenda("2026-06-23")  |  date_range("2026-06-01","2026-06-30")
        ▼
┌─────────────────────────────────────────────────────────┐
│ TodoService::agenda / ::date_range   (queries.rs, PURE)   │
│                                                           │
│  1. parse_day(param) ───► time::Date   (Validation err)   │
│  2. list_items(ListFilter{ item_type: Task, .. })  ───────┼──► InMemory  ──┐
│         (already open-only via hidden-by-default;         │    Persistent ─┤  identical
│          add explicit [Proposed,Approved,Active] guard)   │                │  result set
│  3. filter in Rust:                                       │◄───────────────┘
│       agenda:  parse(scheduled)==D OR parse(due)==D       │
│       range:   from <= parse(scheduled) <= to             │
│       (non-ISO scheduled → excluded from date match,      │
│        kept for unscheduled bucket per D-07)              │
│  4. sort:  scheduled asc (None/junk last)                 │
│            then created_at then id   (D-08)               │
│  5. return Vec<TodoItem>  (flat, deterministic)           │
└─────────────────────────────────────────────────────────┘
        │
        ▼
  Phase 5 adapter (NOT this phase): group by date, render unscheduled bucket
```

Critical invariant shown by the diagram: **no arrow goes to `materialize_routines`** (SC4). The view reads through `list_items` only.

### Recommended Project Structure
```
todo-engine/src/application/service/
├── queries.rs          # ADD agenda() + date_range() here (alongside get/list_items/archive_items)
├── mod.rs              # parse_day() lives here — reuse, do not re-implement
└── materialization.rs  # DO NOT CALL from queries.rs (side-effect path)

todo-engine/tests/
├── unit/date_view.rs        # fast in-memory behavior (union/dedup, unscheduled, exact-date, ordering)
├── unit.rs                  # register: #[path="unit/date_view.rs"] mod date_view;
├── integration/date_view.rs # persistent SQLite parity (mirror goal_view.rs)
└── integration.rs           # register: #[path="integration/date_view.rs"] mod date_view;
```

### Pattern 1: Compose on `list_items`, filter the rest in Rust
**What:** The date methods do NOT add SQL. They call `list_items` (which already supports both stores identically) and apply date logic in Rust.
**When to use:** All Phase 3 view methods.
**Example (recommended shape — planner may adjust names/unification):**
```rust
// Source: todo-engine/src/application/service/queries.rs (new methods)
// parse_day: todo-engine/src/application/service/mod.rs:222
// sort: mirrors todo-engine/src/application/service/queries.rs:23-28
use super::parse_day;
use crate::application::ports::ListFilter;
use crate::domain::{ItemStatus, ItemType, TodoItem};
use time::Date;

const OPEN_STATUSES: [ItemStatus; 3] =
    [ItemStatus::Proposed, ItemStatus::Approved, ItemStatus::Active];

impl TodoService {
    /// Single-date agenda: scheduled == date OR due == date (D-02 / VIEW-05).
    pub fn agenda(&mut self, date: &str) -> TodoResult<Vec<TodoItem>> {
        let day = parse_day(date)?; // Validation error on junk
        let mut items = self.open_tasks()?;
        items.retain(|item| {
            iso_day(item.scheduled.as_deref()) == Some(day)
                || iso_day(item.due.as_deref()) == Some(day)
        });
        sort_date_view(&mut items); // single date => no dup possible by id
        Ok(items)
    }

    /// Range view: scheduled in [from, to] only (D-03 / SC1).
    pub fn date_range(&mut self, from: &str, to: &str) -> TodoResult<Vec<TodoItem>> {
        let (from, to) = (parse_day(from)?, parse_day(to)?);
        let mut items = self.open_tasks()?;
        items.retain(|item| {
            iso_day(item.scheduled.as_deref())
                .is_some_and(|d| from <= d && d <= to)
        });
        sort_date_view(&mut items);
        Ok(items)
    }

    fn open_tasks(&mut self) -> TodoResult<Vec<TodoItem>> {
        Ok(self
            .list_items(ListFilter { item_type: Some(ItemType::Task), ..Default::default() })?
            .into_iter()
            .filter(|item| OPEN_STATUSES.contains(&item.status))
            .collect())
    }
}

/// Parse the leading YYYY-MM-DD of an ISO date string; None on absent/non-ISO/"today".
fn iso_day(value: Option<&str>) -> Option<Date> {
    parse_day(value?.get(..10)?).ok() // mirrors markdown.rs:125 parse_scheduled_day
}

/// D-08: scheduled asc (None/unscheduled last), then created_at, then id.
fn sort_date_view(items: &mut [TodoItem]) {
    items.sort_by(|a, b| {
        let ka = iso_day(a.scheduled.as_deref());
        let kb = iso_day(b.scheduled.as_deref());
        // Some < None so unscheduled sorts last:
        ka.is_none().cmp(&kb.is_none())
            .then_with(|| ka.cmp(&kb))
            .then_with(|| a.created_at.cmp(&b.created_at))
            .then_with(|| a.id.cmp(&b.id))
    });
}
```
Note: `iso_day` uses `.get(..10)` like the existing `parse_scheduled_day` so a stored `"2026-06-23T..."` still matches; but **`parse_day` returns `TodoResult`** (not `Option` like the adapter's private `parse_day` in `markdown.rs:129`). Inside `iso_day` we discard the error with `.ok()` because non-ISO is a valid "unscheduled" signal, not a caller error — only the **method param** (`date`/`from`/`to`) propagates a validation error.

### Pattern 2: Reuse `parse_day` from the service module, do not re-implement
**What:** `service::parse_day` (`mod.rs:222`) already produces `time::Date` from `[year]-[month]-[day]` and maps failure to `TodoError::Validation`. It is `pub(super)`, visible to `queries.rs`.
**When to use:** Parsing the method's own date params. `time::Date` is `Ord`, so `from <= d && d <= to` and `== day` work directly.

### Anti-Patterns to Avoid
- **Calling `materialize_routines` (or anything in `materialization.rs`).** That is the side-effect path SC4 forbids. The view must be a pure read.
- **Adding a new sort.** D-08 says reuse `created_at → id`. Don't introduce priority or alpha sorting.
- **Replicating the legacy `today` `scheduled <= today` roll** (`markdown.rs:92`). D-06 is exact-date only; pulling overdue forward is explicitly out.
- **Introducing a `DateView` struct.** D-01 locks the flat `Vec<TodoItem>` return; grouping is adapter work.
- **Filtering by item_type loosely.** The legacy `today` view is Task-only (`markdown.rs:73,88`). Confirm with planner whether Events should appear; CONTEXT/legacy semantics point to Tasks only. Flagged as Open Question Q1.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ISO date parse | A new strptime/regex | `service::parse_day` (`mod.rs:222`) | Already returns `TodoResult<Date>` with the correct error variant; single source of the format string |
| Open-only status set | A new `is_open()` enum method | `OPEN_STATUSES` allowlist (matches `markdown.rs:80`) OR `!hidden_by_default_status` | The phase semantics are an explicit 3-status allowlist (D-05), already established in the legacy view |
| Both-stores parity | Branch on `InMemory`/`Persistent` in the new method | Just call `list_items` | `list_items` already abstracts both stores (`queries.rs:19-32`); building on it makes parity free |
| In-bucket tie-break | New comparator | The `created_at → id` `sort_by` from `queries.rs:23-28` | D-08; keeps `list` and date view consistent |

**Key insight:** This phase is almost entirely composition. The risk is NOT missing a library — it is accidentally re-implementing a primitive slightly differently (a different date-parse fallback, a different status set, a different tie-break) and thereby breaking the CLI/API parity guarantee (D-01a) when Phase 5 wires it up.

## Common Pitfalls

### Pitfall 1: The `"today"` sentinel and ISO-with-time suffix
**What goes wrong:** Materialized routine tasks set `scheduled = occurrence_key` which is a bare `"2026-06-23"` (`materialization.rs:88-89`), but other rows may carry `"today"` (legacy sentinel) or a full RFC3339 timestamp. A naive `item.scheduled == Some(date)` string compare misses timestamped values and crashes on nothing but silently mis-buckets.
**Why it happens:** `scheduled` is `Option<String>`, not `Option<Date>` — free-form storage.
**How to avoid:** Always go through `iso_day` (parse leading 10 chars). `"today"` and junk parse to `None` → unscheduled bucket (D-07), never dropped, never matched to a date.
**Warning signs:** A test with `scheduled = Some("today")` expecting it in a date bucket, or a timestamped `scheduled` not matching its day.

### Pitfall 2: Dropping unscheduled rows instead of bucketing them (SC2 violation)
**What goes wrong:** Using `ListFilter.scheduled = Some(date)` (the existing predicate, `ports.rs:79-84`) to filter — that is an exact string-equality predicate that excludes `None`/non-ISO rows entirely, so they vanish.
**Why it happens:** The `ListFilter.scheduled` predicate looks convenient but does string equality and gives no way to keep unmatched rows.
**How to avoid:** Filter in Rust after `list_items`, and for the agenda/range, keep the full open-task set, then for the flat-Vec sort push non-ISO/None to the end (unscheduled). The unscheduled rows stay in the returned Vec; the adapter renders them as the explicit bucket. Confirm the planner's chosen unscheduled representation is "present in Vec, sorted last" (D-08) — not "filtered out."

### Pitfall 3: Forgetting the open-only guard relies on hidden-by-default semantics
**What goes wrong:** `list_items` with no `status` filter hides only `Archived`/`Dropped`/`Cancelled` (`hidden_by_default_status`, `status.rs:32-37`). But `Completed`, `Someday`, `Rejected`, `Waiting`, `Paused` are NOT hidden by default — they'd leak into the view if you rely on `list_items` defaults alone.
**Why it happens:** `hidden_by_default` ≠ `terminal` ≠ `open`. They are three different sets.
**How to avoid:** Apply the explicit `[Proposed, Approved, Active]` allowlist (D-05) AFTER `list_items`, exactly as `today_tasks` does (`markdown.rs:80-89`). Do not assume the default hide covers it.
**Warning signs:** A `Completed` or `Waiting` task showing in the agenda.

### Pitfall 4: In-memory full-table scan debt (awareness only)
**What goes wrong:** `list_items` loads the entire `items` table and filters in Rust (CONCERNS.md tech debt). The date view adds another in-Rust pass on top.
**Why it happens:** Known deferred debt; SQL-side `WHERE` is a Phase 4 performance research item.
**How to avoid:** For Phase 3 (cheap/flat, personal-scale data) this is acceptable — do NOT prematurely push date filtering into SQL. Just be aware the view is O(table size). Flag in plan as "acceptable for v1; SQL-pushdown deferred."

## Code Examples

### Persistent-store parity test (mirror `goal_view.rs`)
```rust
// Source: todo-engine/tests/integration/goal_view.rs:20-27 (persistent_service idiom)
fn persistent_service() -> (tempfile::TempDir, TodoService) {
    let dir = tempfile::tempdir().expect("create test home");
    let db_path = dir.path().join("todo.sqlite");
    let conn = connect(db_path.to_str().expect("utf-8 db path")).unwrap();
    init_schema(&conn).unwrap();
    let repo = SqliteTodoRepository::new(conn);
    (dir, TodoService::persistent(repo))
}

#[test]
fn persistent_agenda_unions_scheduled_and_due_open_tasks() {
    let (_home, mut service) = persistent_service();
    // create tasks via ProposeTask + approve/activate transitions,
    // set scheduled/due via UpdateItem, then:
    let agenda = service.agenda("2026-06-23").unwrap();
    let ids: Vec<&str> = agenda.iter().map(|i| i.id.as_str()).collect();
    // assert union membership + deterministic order + no dropped unscheduled
}
```

### In-memory fast test (mirror `filter.rs` builder style)
```rust
// Source: todo-engine/tests/unit/filter.rs:8-12 (item builder over TodoService::in_memory or apply_list_filter)
// For service methods, use TodoService::in_memory() and the real Propose*/transition API,
// OR build TodoItems directly if testing a pure helper extracted from the method.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `today` view rolls `scheduled <= today` + materializes routines (`markdown.rs:65-96`) | Exact-date, side-effect-free service view (D-06, SC4) | Phase 3 | New view does NOT roll overdue and does NOT materialize; legacy `today` stays as-is until Phase 5 decides rewiring |
| Date logic in adapter (`markdown.rs`) | Date logic in `application/service` (CORE-03) | Phase 3 | Adapter becomes thin renderer; service owns the set + order |

**Deprecated/outdated:** Nothing removed this phase. The legacy `today_tasks`/`current_today_items` adapter functions remain untouched (rewiring is Phase 5, explicitly deferred).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Date view scopes to `ItemType::Task` only (matching legacy `today` + VIEW wording "tasks") | Anti-Patterns / Open Q1 | If Events should appear, agenda/range miss event rows; adapter shows incomplete day. Low risk — VIEW-02/05 say "tasks". |
| A2 | Storing `scheduled`/`due` as a leading-10-char ISO date (`.get(..10)`) is the right parse window for all rows | Pattern 1 / Pitfall 1 | If some rows store non-leading date formats, they'd mis-bucket. Mitigated: GOAL-03/Phase 1-2 moved engine to strict ISO; materialization writes bare `YYYY-MM-DD`. |
| A3 | `due` is stored in the same ISO format as `scheduled` | Pattern 1 (D-02 union) | If `due` uses a different format, the union half breaks. `model.rs` types both as `Option<String>`; README is authoritative — planner should confirm `due` format. |

## Open Questions

1. **Should the date view include `ItemType::Event` rows, or Tasks only?**
   - What we know: Legacy `today` is Task-only (`markdown.rs:73,88`); VIEW-02/05 say "tasks"; CONTEXT consistently says "task(s)".
   - What's unclear: Events also have `scheduled`/`due` and conceptually belong on an agenda.
   - Recommendation: Plan for **Tasks only** (matches locked semantics and legacy). If Events are wanted, that is a discuss-phase amendment, not a silent inclusion.

2. **Is `due` guaranteed to be the same `YYYY-MM-DD[...]` ISO shape as `scheduled`?**
   - What we know: Both are `Option<String>`; `scheduled` is written as bare ISO by materialization and validated by GOAL-03.
   - What's unclear: Whether any `due` writer uses a different format.
   - Recommendation: Use `iso_day` (leading-10 parse) for both — symmetric and tolerant. Planner should confirm against README's column spec.

## Environment Availability

> Skipped — this phase is pure code + tests with no new external dependencies. `cargo build`/`cargo test` and the existing `time`/`rusqlite`/`tempfile` crates are already in the workspace.

## Validation Architecture

Nyquist validation is ENABLED. The four Success Criteria map to observable behaviors, each provable at unit level and re-proven at persistent-store level for parity.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Rust built-in `#[test]` (no external harness); three test binaries `unit` / `integration` / `e2e` |
| Config file | None — declared via `tests/unit.rs` and `tests/integration.rs` with `#[path=...] mod` lines |
| Quick run command | `cargo test --test unit date_view` |
| Full suite command | `cargo test` (+ `cargo fmt --check` and `cargo clippy --all-targets --all-features -- -D warnings`) |

### Phase Requirements → Test Map
| Req / SC | Behavior (oracle) | Test Type | Automated Command | File Exists? |
|----------|-------------------|-----------|-------------------|-------------|
| SC1 / VIEW-02 | Range `[from,to]` groups by `scheduled`; deterministic order (scheduled asc, then created_at, then id) | unit | `cargo test --test unit date_view::range_orders` | ❌ Wave 0 |
| SC2 / VIEW-02 | Unscheduled (`None`, `"today"`, junk) present in returned Vec, sorted last — NOT dropped | unit | `cargo test --test unit date_view::unscheduled_never_dropped` | ❌ Wave 0 |
| SC3 / VIEW-05 | Single-date agenda = `scheduled==D` ∪ `due==D`, id-deduped (one row even if both match) | unit | `cargo test --test unit date_view::agenda_union_dedup` | ❌ Wave 0 |
| SC4 / CORE-03 | Identical result over `InMemory` vs persistent SQLite; no routine materialized (event log unchanged after `agenda`) | integration | `cargo test --test integration date_view` | ❌ Wave 0 |
| D-05 | `Completed`/`Waiting`/`Paused`/`Someday` excluded; `Proposed`/`Approved`/`Active` included | unit | `cargo test --test unit date_view::open_only` | ❌ Wave 0 |
| D-06 | A task scheduled in the past does NOT appear in today's agenda (no roll) | unit | `cargo test --test unit date_view::no_overdue_roll` | ❌ Wave 0 |
| D-08 | Same-day tasks tie-break by created_at then id | unit | (covered by `range_orders`) | ❌ Wave 0 |

### Key oracles / assertions
- **Union + dedup (SC3):** a task with `scheduled == D AND due == D` appears exactly once (assert `agenda.iter().filter(|i| i.id == x).count() == 1`).
- **Unscheduled never dropped (SC2):** create N open tasks, M with non-ISO/None `scheduled`; assert returned Vec length includes all M and they occupy the tail of the order.
- **Side-effect-free (SC4):** capture `service.events().len()` before and after `agenda(...)`/`date_range(...)`; assert unchanged (proves no materialization wrote an audit event). Optionally assert no new `routine`-generated tasks created.
- **Store parity (SC4):** run the same fixture through `TodoService::in_memory()` and a persistent SQLite service; assert identical ordered id sequences. (Note: in-memory uses deterministic seeded ids `task_000001`; persistent uses UUIDs — compare by a stable key like title+scheduled, or assert ordering invariants rather than raw ids across stores.)
- **No overdue roll (D-06):** task scheduled `2026-06-20`, agenda `2026-06-23` → task absent.

### Sampling Rate
- **Per task commit:** `cargo test --test unit date_view`
- **Per wave merge:** `cargo test` + `cargo clippy --all-targets --all-features -- -D warnings` + `cargo fmt --check`
- **Phase gate:** Full suite green before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `tests/unit/date_view.rs` — covers SC1, SC2, SC3, D-05, D-06 (in-memory, fast)
- [ ] register in `tests/unit.rs`: `#[path = "unit/date_view.rs"] mod date_view;`
- [ ] `tests/integration/date_view.rs` — covers SC4 parity + side-effect-free (persistent SQLite, mirror `goal_view.rs::persistent_service`)
- [ ] register in `tests/integration.rs`: `#[path = "integration/date_view.rs"] mod date_view;`
- [ ] No framework install needed — built-in `#[test]`.

## Security Domain

> Not applicable. This phase adds a pure read-only query path with no new input surface, no auth boundary, no crypto, no persistence change. The HTTP API surface is Phase 5. The existing local-first / no-network-auth posture (CONCERNS.md Security) is unchanged. ASVS V5 (input validation) is the only nominally relevant category and is already covered: date params parse through `parse_day`, which rejects junk with `TodoError::Validation`. No SQL is constructed in this phase (it composes `list_items`), so no injection vector is added.

## Sources

### Primary (HIGH confidence)
- `todo-engine/src/application/service/queries.rs` — existing `get`/`list_items`/`archive_items`, the `created_at → id` sort (lines 19-43)
- `todo-engine/src/application/service/mod.rs` — `parse_day` (222), `format_time`, `generated_by_routine`, store enum, deterministic in-memory id/clock
- `todo-engine/src/application/ports.rs` — `ListFilter` fields, `apply_list_filter`, hidden-by-default rule
- `todo-engine/src/domain/status.rs` — `terminal_status`, `hidden_by_default_status`, the 11 `ItemStatus` variants
- `todo-engine/src/domain/model.rs` — `TodoItem` (`scheduled`/`due`/`status`/`created_at` types), `ItemType`
- `todo-engine/src/domain/recurrence.rs` — `time::Date` parse/compare idiom, `Ord` usage in range loops
- `todo-engine/src/interfaces/cli/markdown.rs` — legacy `today_tasks`/`current_today_items`/`parse_scheduled_day` (CONTRAST reference: materializes, rolls, scheduled-only)
- `todo-engine/src/application/service/materialization.rs` — `materialize_routines` (the side-effect path to avoid, SC4)
- `todo-engine/tests/integration/goal_view.rs` — persistent-store test idiom
- `todo-engine/tests/unit/filter.rs` — in-memory item-builder test idiom
- `todo-engine/tests/{unit,integration}.rs` — `#[path]` module registration convention
- `todo-engine/Cargo.toml` — `time` 0.3, `rusqlite` 0.32, `tempfile` 3.15
- `.planning/codebase/CONCERNS.md` — in-memory full-table-scan tech debt (awareness)

### Secondary (MEDIUM confidence)
- `.planning/phases/03-date-view/03-CONTEXT.md` — locked decisions D-01..D-08
- `.planning/REQUIREMENTS.md` — VIEW-02, VIEW-05, CORE-03
- `CLAUDE.md` — service-layer single-path policy, layered tests, no domain I/O

### Tertiary (LOW confidence)
- None — all findings verified directly against source files in this session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all primitives read directly from source.
- Architecture: HIGH — composition over verified existing `list_items`/`parse_day`; pattern mirrors `today_tasks` and `goal_view.rs`.
- Pitfalls: HIGH — sentinel/format and unscheduled-drop pitfalls verified against `markdown.rs` and `ports.rs` actual code.
- Open questions (Task-only scope, `due` format): MEDIUM — depend on README column spec / planner confirmation, not blocking.

**Research date:** 2026-06-23
**Valid until:** 2026-07-23 (stable internal codebase; refresh if `list_items`/`ListFilter`/`parse_day` signatures change before planning)
