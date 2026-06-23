# Phase 3: Date View - Pattern Map

**Mapped:** 2026-06-23
**Files analyzed:** 5 (1 modify service, 1 create unit test, 1 modify unit registry, 1 create integration test, 1 modify integration registry)
**Analogs found:** 5 / 5

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `todo-engine/src/application/service/queries.rs` (MODIFY: add `agenda`/`date_range`) | service (pure query) | request-response (read) | `archive_items` in same file (`queries.rs:34-43`) — composes `list_items` + Rust filter; plus `today_tasks` (`markdown.rs:77-96`) for status/scheduled semantics | exact (role) + role-match (semantics) |
| `todo-engine/tests/unit/date_view.rs` (CREATE) | test (unit) | request-response | `tests/unit/filter.rs` (in-memory `TodoItem` builder + `apply_list_filter` assertions) | role-match (helper test vs service test — see note) |
| `todo-engine/tests/unit.rs` (MODIFY: register module) | config (test registry) | n/a | existing `#[path]` lines in same file (`unit.rs:7-8`) | exact |
| `todo-engine/tests/integration/date_view.rs` (CREATE) | test (integration) | request-response (persistent parity) | `tests/integration/goal_view.rs` (`persistent_service` idiom, `queries.rs` over SQLite) | exact |
| `todo-engine/tests/integration.rs` (MODIFY: register module) | config (test registry) | n/a | existing `#[path]` lines in same file (`integration.rs:7-8`) | exact |

## Pattern Assignments

### `todo-engine/src/application/service/queries.rs` (service, pure read)

**Analog:** same file — `list_items` (the read primitive) and `archive_items` (the "compose `list_items` + filter in Rust" shape). Status/scheduled semantics from `markdown.rs::today_tasks` (contrast reference — copy the allowlist, NOT the roll/materialize).

**Imports pattern** — current head of `queries.rs` (lines 1-4); the new methods need to add `parse_day` (from `super`), `ListFilter`, `ItemStatus`/`ItemType`, and `time::Date`:
```rust
use super::{ServiceStore, TodoService};
use crate::application::error::{TodoError, TodoResult};
use crate::application::ports::{ListFilter, apply_list_filter};
use crate::domain::{TodoItem, terminal_status};
```
- `parse_day` is declared `pub(super)` in the sibling module (`mod.rs:222`), so add `use super::parse_day;`.
- `ItemStatus`/`ItemType` are re-exported from `crate::domain` (used as `crate::domain::{ItemStatus, ItemType}`); `mod.rs:9` already imports them at the module root, but `queries.rs` has its own `use` list — add what it needs.
- `time::Date` for the parsed-day comparison type.

**Compose-on-`list_items` + filter-in-Rust pattern** — copy this shape exactly from `archive_items` (`queries.rs:34-43`):
```rust
pub fn archive_items(&mut self) -> TodoResult<Vec<TodoItem>> {
    Ok(self
        .list_items(ListFilter {
            include_archived: true,
            ..Default::default()
        })?
        .into_iter()
        .filter(|item| terminal_status(item.status))
        .collect())
}
```
The new `agenda`/`date_range` methods follow the identical structure: call `list_items(ListFilter { item_type: Some(ItemType::Task), ..Default::default() })`, then `.filter(...)` / `.retain(...)` in Rust. **Do NOT branch on `InMemory`/`Persistent`** — `list_items` already abstracts both (`queries.rs:19-32`), which is what makes SC4 parity free.

**In-bucket tie-break sort (D-08)** — reuse this exact comparator from `list_items` (`queries.rs:23-27`); the date-view sort prepends a scheduled-day key, then falls back to this:
```rust
items.sort_by(|left, right| {
    left.created_at
        .cmp(&right.created_at)
        .then_with(|| left.id.cmp(&right.id))
});
```

**ISO date parse — reuse, do not re-implement** (`mod.rs:222-227`):
```rust
pub(super) fn parse_day(value: &str) -> TodoResult<Date> {
    let format = parse_format_description("[year]-[month]-[day]")
        .map_err(|error| TodoError::Internal(format!("failed to prepare date parser: {error}")))?;
    Date::parse(value, &format)
        .map_err(|error| TodoError::Validation(format!("Invalid date {value}: {error}")))
}
```
- Use this for the **method's own param** (`date`/`from`/`to`) — its `TodoError::Validation` is the correct error for caller junk.
- For filtering `item.scheduled`/`item.due` (free-form `Option<String>`), parse the **leading 10 chars** so timestamped values still match, and discard the error (non-ISO is a valid "unscheduled" signal, not an error). Mirror `parse_scheduled_day` (`markdown.rs:125-127`):
```rust
fn parse_scheduled_day(value: &str) -> Option<Date> {
    parse_day(value.get(..10)?)
}
```
  i.e. inside the date view: `parse_day(item.scheduled.as_deref()?.get(..10)?).ok()` → `Option<Date>`. `"today"` sentinel, `None`, and junk all collapse to `None` → unscheduled (D-07, never dropped).

**Open-only status allowlist (D-05)** — copy the exact `[Proposed, Approved, Active]` allowlist from `today_tasks` (`markdown.rs:80-89`). Do NOT rely on `list_items` hidden-by-default alone — `hidden_by_default_status` (`status.rs:32-37`) only hides `Archived`/`Dropped`/`Cancelled`, so `Completed`/`Waiting`/`Paused`/`Someday`/`Rejected` would leak (Pitfall 3):
```rust
let visible_statuses = [
    ItemStatus::Proposed,
    ItemStatus::Approved,
    ItemStatus::Active,
];
// ...
.filter(|item| visible_statuses.contains(&item.status))
```
The full 11-variant `ItemStatus` enum and the `terminal_status`/`hidden_by_default_status` predicates are in `status.rs:6-37`.

**CONTRAST — what NOT to copy from `today_tasks`** (`markdown.rs:69, 90-92`): the new view must NOT call `materialize_routines` (SC4) and must NOT replicate the `scheduled <= today` overdue roll (D-06). The legacy view does both:
```rust
service.materialize_routines(today, ROUTINE_LOOKAHEAD_DAYS, ROUTINE_CATCHUP_DAYS)?; // <-- SC4 forbids
// ...
.filter(|item| match item.scheduled.as_deref() {
    None | Some("today") => true,                                  // <-- D-06: exact-date only, no roll
    Some(value) => parse_scheduled_day(value).is_some_and(|s| s <= today), // <-- D-06 forbids the roll
})
```

**`TodoItem` fields used** (`model.rs:30-66`): `scheduled: Option<String>` (line 50), `due: Option<String>` (line 49), `status: ItemStatus` (line 34), `created_at: OffsetDateTime` (line 66), `id: String` (line 30), `item_type: ItemType` (line 32). `scheduled`/`due` are both free-form `Option<String>` — symmetric `iso_day` parse applies to both (RESEARCH A3).

**Recommended method shape:** see RESEARCH.md Pattern 1 (lines 121-185) for the full `agenda`/`date_range`/`open_tasks`/`iso_day`/`sort_date_view` sketch. Planner may unify or rename per Claude's Discretion (CONTEXT D-49/50).

---

### `todo-engine/tests/unit/date_view.rs` (test, unit — fast in-memory)

**Analog:** `tests/unit/filter.rs` for the builder idiom; but note: `filter.rs` tests the pure `apply_list_filter` free function by hand-building `TodoItem`s. The date-view methods are `TodoService` methods, so the fixture must go through the **real service API** (`TodoService::in_memory()` + `propose_task` + transitions + `update_item`), as `goal_policy.rs` does in-memory.

**`TodoItem` builder idiom** (`filter.rs:8-12`) — useful if a pure helper (`sort_date_view`/`iso_day`) is extracted and tested directly:
```rust
const NOW: OffsetDateTime = datetime!(2026 - 05 - 31 12:00 UTC);

fn item(id: &str, item_type: ItemType, status: ItemStatus) -> TodoItem {
    let mut i = TodoItem::new(id, item_type, id, Actor::User, NOW);
    i.status = status;
    i
}
```
Then set `i.scheduled = Some("2026-06-23".into());` / `i.due = ...` directly. Assertion idiom (`filter.rs:22-25`):
```rust
assert_eq!(
    visible.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
    ["a"]
);
```

**Service-API fixture idiom** (`goal_policy.rs:138-166`) — for end-to-end method tests (`agenda`/`date_range` are `&mut self` methods, so use a `mut service`):
```rust
let mut service = TodoService::in_memory();
let task = service
    .propose_task(
        "decomposed task",
        todo_engine::application::service::ProposeTask {
            actor: Actor::User,
            ..Default::default()
        },
    )
    .unwrap();
let linked = service
    .update_item(
        &task.id,
        UpdateItem {
            scheduled: Some("2026-06-08".to_string()),
            ..Default::default()
        },
    )
    .unwrap();
```
- `ProposeTask` fields (`creation.rs:12-22`): `actor`, `area`, `project_id`, `routine_id`, `due`, `scheduled`, `priority`, `description`, `note` — all settable at create time (or via `UpdateItem`, `update.rs:6-24`, which also carries `due`/`scheduled`).
- To exercise open statuses: `Actor::User` tasks can be `approve`/`activate`d (`transitions.rs:6,26`). To prove exclusion of terminal/hidden statuses, drive a task to `Completed`/`Waiting`/etc.

**Coverage required** (RESEARCH Wave 0): SC1 range ordering, SC2 unscheduled-never-dropped (incl. `"today"` sentinel + junk + `None`), SC3 agenda union+dedup, D-05 open-only, D-06 no-overdue-roll. See RESEARCH "Key oracles" (lines 321-326) for exact assertions.

---

### `todo-engine/tests/unit.rs` (config, test registry)

**Analog:** the existing `#[path]` lines in the same file (`unit.rs:1-16`). Insert alphabetically (after `clock`, before `error_mapping` — module name `date_view`):
```rust
#[path = "unit/date_view.rs"]
mod date_view;
```

---

### `todo-engine/tests/integration/date_view.rs` (test, integration — persistent SQLite parity)

**Analog:** `tests/integration/goal_view.rs` — exact idiom to mirror.

**Persistent-service setup** (`goal_view.rs:20-27`) — copy verbatim:
```rust
fn persistent_service() -> (tempfile::TempDir, TodoService) {
    let dir = tempfile::tempdir().expect("create test home");
    let db_path = dir.path().join("todo.sqlite");
    let conn = connect(db_path.to_str().expect("utf-8 db path")).unwrap();
    init_schema(&conn).unwrap();
    let repo = SqliteTodoRepository::new(conn);
    (dir, TodoService::persistent(repo))
}
```

**Imports** (`goal_view.rs:1-4`) — adapt the `ProposeGoal` import to `ProposeTask`/`UpdateItem`:
```rust
use todo_engine::application::ports::ListFilter;
use todo_engine::application::service::{ProposeTask, TodoService, UpdateItem};
use todo_engine::domain::Actor;
use todo_engine::infrastructure::sqlite::{SqliteTodoRepository, connect, init_schema};
```

**Test body + id-collection assertion idiom** (`goal_view.rs:32-93`):
```rust
let weeks = service.list_items(ListFilter { /* ... */ }).unwrap();
let mut week_ids: Vec<&str> = weeks.iter().map(|item| item.id.as_str()).collect();
```
Apply to `service.agenda("2026-06-23")` / `service.date_range("2026-06-01","2026-06-30")`.

**Side-effect-free assertion (SC4)** — capture event count before/after via `service.events()` (`mod.rs:57-59`, returns `&[TodoEvent]`; used as `service.events().len()` and `.last().unwrap().action`, see `goal_policy.rs:166`, `materialization.rs:268`):
```rust
let before = service.events().len();
let _ = service.agenda("2026-06-23").unwrap();
assert_eq!(service.events().len(), before); // no materialization wrote an audit event
```

**Store-parity note** (RESEARCH line 325): in-memory ids are deterministic (`task_000001`) but persistent uses UUIDs — compare by a stable key (title+scheduled) or assert ordering invariants, NOT raw id equality across stores.

---

### `todo-engine/tests/integration.rs` (config, test registry)

**Analog:** existing `#[path]` lines (`integration.rs:1-16`). Insert alphabetically (after `service_policy`? no — `date_view` sorts before `events`; place first or alphabetically near top):
```rust
#[path = "integration/date_view.rs"]
mod date_view;
```

---

## Shared Patterns

### ISO date parsing
**Source:** `service::parse_day` (`mod.rs:222-227`, `pub(super)`) for method params; `parse_scheduled_day`'s leading-10 trick (`markdown.rs:125-127`) for free-form `scheduled`/`due` fields.
**Apply to:** the new `agenda`/`date_range` methods. Single source of the format string — never hand-roll a second date parser.

### Open-only status allowlist
**Source:** `today_tasks` (`markdown.rs:80-89`); enum + predicates in `status.rs:6-37`.
**Apply to:** every date-view method (D-05). Explicit `[Proposed, Approved, Active]` AFTER `list_items` — do not trust hidden-by-default.

### Compose on `list_items`, never branch on store
**Source:** `archive_items` (`queries.rs:34-43`).
**Apply to:** all Phase 3 view methods — this is what makes SC4 in-memory/persistent parity free.

### `#[path]` module registration
**Source:** `tests/unit.rs:1-16`, `tests/integration.rs:1-16`.
**Apply to:** both test-registry modifications.

### Deterministic tie-break sort
**Source:** `list_items` inline comparator (`queries.rs:23-27`): `created_at.cmp().then_with(id.cmp())`.
**Apply to:** the date-view sort's fallback after the scheduled-day key (D-08). This IS the CLI/API parity guarantee (D-01a).

## No Analog Found

None. Every file maps to a close existing analog. The single nuance: the unit test's *subject* (a `&mut TodoService` method) differs from `filter.rs`'s subject (the pure `apply_list_filter` free function) — use the service-API fixture idiom from `goal_policy.rs` for method-level tests, and the `filter.rs` builder only if a pure helper is extracted.

## Metadata

**Analog search scope:** `todo-engine/src/application/service/`, `todo-engine/src/domain/`, `todo-engine/src/interfaces/cli/markdown.rs`, `todo-engine/tests/{unit,integration}/`
**Files scanned:** queries.rs, mod.rs, update.rs, creation.rs, transitions.rs, status.rs, model.rs, markdown.rs, goal_view.rs, filter.rs, goal_policy.rs, unit.rs, integration.rs
**Pattern extraction date:** 2026-06-23
