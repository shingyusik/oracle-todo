# oracle-todo Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure oracle-todo into a test-locked clean architecture — split oversized src files into focused modules, organize tests into unit/integration/e2e layers, and populate docs/{architecture,conventions,operations} — with zero change to the public CLI/API/schema/output surface.

**Architecture:** Keep the existing 4 layers (domain → application → infrastructure/interfaces, dependencies inward). Split `service.rs`/`sqlite.rs`/`cli.rs`/`api.rs` into directory modules. Because Rust privacy is module-scoped, splitting `impl` blocks across files requires promoting shared struct fields and helpers to `pub(super)` — a crate-internal visibility widening, NOT a public-API change. Move `exports.rs` under `interfaces/` while preserving the public `oracle_todo::exports` path via a `lib.rs` re-export.

**Tech Stack:** Rust 2024, rusqlite (bundled SQLite), clap, axum, thiserror, time, tokio. Tests: cargo test, assert_cmd, tower (oneshot), tempfile, predicates.

**Spec:** `docs/superpowers/specs/2026-06-16-oracle-todo-refactor-design.md`

**Crate name in tests:** `oracle_todo` (package `oracle-todo`). Binary: `oracle-todo`.

---

## Cross-cutting rules (apply to every task)

1. **Verification gate after every src change:**
   ```bash
   cargo test
   cargo fmt --check
   cargo clippy --all-targets --all-features -- -D warnings
   ```
   All three must pass before committing. `-D warnings` means a stray unused import fails the build — each moved file must `use` only what it references.
2. **Behavior lock:** Do not change CLI args, HTTP routes, JSON shapes, SQLite schema/SQL text, exit codes, or Markdown output. Move raw SQL string literals byte-for-byte. Preserve `.expect()` panic sites verbatim. Do not change the ORDER of `next_now`/`next_id`/`next_event_id` calls (the in-memory deterministic clock seeds `datetime!(2026-05-31 12:00 UTC)` and counters that tests assert exactly).
3. **Real type names:** the repository struct is `SqliteTodoRepository` (not `SqliteRepository`). Never rename public symbols.
4. **Visibility widening only:** when splitting, promote private items to `pub(super)` (preferred) or `pub(crate)` — never `pub` (that would expand the public surface).
5. **Commit format:** `[TAG] English subject` + Korean bullet body (repo NFLOW convention). One logical commit per task.
6. **Behavior-change escape hatch:** if a step cannot preserve behavior, STOP and surface it for approval ("allow small fixes" policy) — do not silently change behavior.

---

# Phase 0 — Safety net (tests first, no src behavior change)

Goal: build the unit/integration/e2e structure and **add the missing pure-logic coverage BEFORE touching src**, so the refactor is behavior-locked. All steps here test the *current* public API; they must stay green through every later phase.

## Task 0.1: Confirm green baseline

**Files:** none (verification only)

- [ ] **Step 1: Run the full gate**

Run:
```bash
cargo test && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings
```
Expected: PASS (all existing tests green, no fmt/clippy issues). If anything fails on a clean checkout, STOP and report — do not start the refactor on a red baseline.

## Task 0.2: Add the unit test layer (new + relocated pure tests)

**Files:**
- Create: `tests/unit.rs` (dispatcher)
- Create: `tests/unit/recurrence.rs`
- Create: `tests/unit/status.rs`
- Create: `tests/unit/model.rs`
- Create: `tests/unit/filter.rs`
- Create: `tests/unit/error_mapping.rs`
- Create: `tests/unit/clock.rs`
- Create: `tests/unit/architecture.rs`

> Rust note: cargo compiles only top-level `tests/*.rs` as test binaries. `tests/unit.rs` is the binary; files under `tests/unit/` are its modules. Unit tests run as a separate crate, so they can call only the crate's **public** API (all symbols below are already `pub`).

- [ ] **Step 1: Create the dispatcher `tests/unit.rs`**

```rust
mod architecture;
mod clock;
mod error_mapping;
mod filter;
mod model;
mod recurrence;
mod status;
```

- [ ] **Step 2: Write `tests/unit/recurrence.rs`**

```rust
use oracle_todo::domain::{occurrences, RecurrenceError};
use time::Weekday;
use time::macros::date;

#[test]
fn daily_aliases_expand_each_day() {
    let want = vec![date!(2026 - 01 - 01), date!(2026 - 01 - 02), date!(2026 - 01 - 03)];
    for rule in ["daily", "매일", "every day"] {
        let got = occurrences(rule, date!(2026 - 01 - 01), date!(2026 - 01 - 03)).unwrap();
        assert_eq!(got, want, "rule {rule}");
    }
}

#[test]
fn weekdays_rule_excludes_weekend() {
    for rule in ["weekdays", "평일", "월-금"] {
        let got = occurrences(rule, date!(2026 - 06 - 01), date!(2026 - 06 - 30)).unwrap();
        assert!(!got.is_empty(), "rule {rule}");
        assert!(
            got.iter()
                .all(|d| !matches!(d.weekday(), Weekday::Saturday | Weekday::Sunday)),
            "rule {rule} leaked a weekend"
        );
    }
}

#[test]
fn weekend_rule_is_only_weekend() {
    for rule in ["weekend", "주말", "토-일"] {
        let got = occurrences(rule, date!(2026 - 06 - 01), date!(2026 - 06 - 30)).unwrap();
        assert!(!got.is_empty(), "rule {rule}");
        assert!(
            got.iter()
                .all(|d| matches!(d.weekday(), Weekday::Saturday | Weekday::Sunday)),
            "rule {rule} leaked a weekday"
        );
    }
}

#[test]
fn explicit_weekday_set_matches_listed_days() {
    for rule in ["월수금", "mon,wed,fri", "mon wed fri"] {
        let got = occurrences(rule, date!(2026 - 06 - 01), date!(2026 - 06 - 30)).unwrap();
        assert!(!got.is_empty(), "rule {rule}");
        assert!(
            got.iter().all(|d| matches!(
                d.weekday(),
                Weekday::Monday | Weekday::Wednesday | Weekday::Friday
            )),
            "rule {rule} produced an unexpected weekday"
        );
    }
}

#[test]
fn monthly_on_the_nth_is_exact() {
    let got = occurrences("every month on the 15th", date!(2026 - 01 - 01), date!(2026 - 03 - 31)).unwrap();
    assert_eq!(got, vec![date!(2026 - 01 - 15), date!(2026 - 02 - 15), date!(2026 - 03 - 15)]);
}

#[test]
fn monthly_on_the_last_clamps_to_month_length() {
    let got = occurrences("every month on the last", date!(2026 - 01 - 01), date!(2026 - 02 - 28)).unwrap();
    assert_eq!(got, vec![date!(2026 - 01 - 31), date!(2026 - 02 - 28)]);
}

#[test]
fn yearly_interval_skips_off_years() {
    let got = occurrences("every 2 years", date!(2026 - 01 - 01), date!(2030 - 12 - 31)).unwrap();
    assert_eq!(got, vec![date!(2026 - 01 - 01), date!(2028 - 01 - 01), date!(2030 - 01 - 01)]);
}

#[test]
fn unanchored_monthly_interval_defaults_to_first_of_month() {
    let got = occurrences("every 2 months", date!(2026 - 01 - 01), date!(2026 - 05 - 31)).unwrap();
    assert_eq!(got, vec![date!(2026 - 01 - 01), date!(2026 - 03 - 01), date!(2026 - 05 - 01)]);
}

#[test]
fn empty_window_returns_no_dates() {
    let got = occurrences("daily", date!(2026 - 01 - 03), date!(2026 - 01 - 01)).unwrap();
    assert!(got.is_empty());
}

#[test]
fn unsupported_rule_carries_original_string() {
    let err = occurrences("bogus rule", date!(2026 - 01 - 01), date!(2026 - 01 - 31)).unwrap_err();
    assert_eq!(err, RecurrenceError::unsupported("bogus rule"));
    assert_eq!(err.rule(), "bogus rule");
}

#[test]
fn interval_below_one_is_unsupported() {
    assert!(occurrences("every 0 days", date!(2026 - 01 - 01), date!(2026 - 01 - 31)).is_err());
}

#[test]
fn anchored_day_unit_is_unsupported() {
    assert!(occurrences("every 2 days on mon", date!(2026 - 01 - 01), date!(2026 - 01 - 31)).is_err());
}
```

- [ ] **Step 3: Write `tests/unit/status.rs`**

```rust
use oracle_todo::domain::{ItemStatus, hidden_by_default_status, terminal_status};

const ALL: [ItemStatus; 11] = [
    ItemStatus::Proposed,
    ItemStatus::Approved,
    ItemStatus::Active,
    ItemStatus::Waiting,
    ItemStatus::Paused,
    ItemStatus::Completed,
    ItemStatus::Cancelled,
    ItemStatus::Dropped,
    ItemStatus::Archived,
    ItemStatus::Someday,
    ItemStatus::Rejected,
];

#[test]
fn terminal_status_matches_terminal_set() {
    for s in [
        ItemStatus::Completed,
        ItemStatus::Cancelled,
        ItemStatus::Dropped,
        ItemStatus::Archived,
        ItemStatus::Someday,
        ItemStatus::Rejected,
    ] {
        assert!(terminal_status(s), "{} should be terminal", s.as_str());
    }
    for s in [
        ItemStatus::Proposed,
        ItemStatus::Approved,
        ItemStatus::Active,
        ItemStatus::Waiting,
        ItemStatus::Paused,
    ] {
        assert!(!terminal_status(s), "{} should not be terminal", s.as_str());
    }
}

#[test]
fn hidden_by_default_matches_hidden_set() {
    for s in [ItemStatus::Archived, ItemStatus::Dropped, ItemStatus::Cancelled] {
        assert!(hidden_by_default_status(s), "{} should be hidden", s.as_str());
    }
    for s in [
        ItemStatus::Proposed,
        ItemStatus::Approved,
        ItemStatus::Active,
        ItemStatus::Waiting,
        ItemStatus::Paused,
        ItemStatus::Completed,
        ItemStatus::Someday,
        ItemStatus::Rejected,
    ] {
        assert!(!hidden_by_default_status(s), "{} should be visible", s.as_str());
    }
}

#[test]
fn status_round_trips_every_variant() {
    for s in ALL {
        assert_eq!(s.as_str().parse::<ItemStatus>().unwrap(), s);
    }
    assert!("Active".parse::<ItemStatus>().is_err()); // case-sensitive lowercase only
    assert_eq!("  active  ".parse::<ItemStatus>().unwrap(), ItemStatus::Active); // trims
}
```

- [ ] **Step 4: Write `tests/unit/model.rs`** (absorbs the pure tests currently in `application_policy.rs`)

```rust
use oracle_todo::domain::{Actor, ItemStatus, ItemType, TodoItem};
use time::OffsetDateTime;
use time::macros::datetime;

const NOW: OffsetDateTime = datetime!(2026 - 05 - 31 12:00 UTC);

#[test]
fn user_item_is_auto_approved() {
    let item = TodoItem::new("t1", ItemType::Task, "X", Actor::User, NOW);
    assert_eq!(item.status, ItemStatus::Approved);
    assert_eq!(item.approved_by, Some(Actor::User));
    assert_eq!(item.approved_at, Some(NOW));
}

#[test]
fn oracle_item_starts_proposed() {
    let item = TodoItem::new("t1", ItemType::Task, "X", Actor::Oracle, NOW);
    assert_eq!(item.status, ItemStatus::Proposed);
    assert_eq!(item.approved_by, None);
    assert_eq!(item.approved_at, None);
    assert_eq!(item.proposed_by, Actor::Oracle);
}

#[test]
fn defaults_are_sane() {
    let item = TodoItem::new("t1", ItemType::Task, "X", Actor::User, NOW);
    assert_eq!(item.materialization_policy, "single_open");
    assert!(item.metadata.is_empty());
    assert!(item.second_brain_refs.is_empty());
    assert_eq!(item.created_at, NOW);
    assert_eq!(item.updated_at, NOW);
}

#[test]
fn new_task_is_a_task() {
    assert_eq!(TodoItem::new_task("t1", "X", Actor::User, NOW).item_type, ItemType::Task);
    assert_eq!(TodoItem::new_task("t1", "X", Actor::Oracle, NOW).status, ItemStatus::Proposed);
}

#[test]
fn item_type_round_trips_every_variant() {
    for t in [
        ItemType::Area,
        ItemType::Project,
        ItemType::Routine,
        ItemType::Task,
        ItemType::Event,
        ItemType::Review,
        ItemType::ArchiveItem,
    ] {
        assert_eq!(t.as_str().parse::<ItemType>().unwrap(), t);
    }
    assert!("folder".parse::<ItemType>().is_err());
}

#[test]
fn actor_round_trips_every_variant() {
    for a in [Actor::User, Actor::Oracle, Actor::System] {
        assert_eq!(a.as_str().parse::<Actor>().unwrap(), a);
    }
    assert!("robot".parse::<Actor>().is_err());
}

#[test]
fn timestamps_serialize_as_rfc3339() {
    let item = TodoItem::new_task("t1", "X", Actor::User, NOW);
    let json = serde_json::to_value(&item).unwrap();
    assert_eq!(json["created_at"], "2026-05-31T12:00:00Z");
    assert_eq!(json["updated_at"], "2026-05-31T12:00:00Z");
    assert_eq!(json["approved_at"], "2026-05-31T12:00:00Z");
}
```

- [ ] **Step 5: Write `tests/unit/filter.rs`**

```rust
use oracle_todo::application::ports::{ListFilter, apply_list_filter};
use oracle_todo::domain::{Actor, ItemStatus, ItemType, TodoItem};
use time::OffsetDateTime;
use time::macros::datetime;

const NOW: OffsetDateTime = datetime!(2026 - 05 - 31 12:00 UTC);

fn item(id: &str, item_type: ItemType, status: ItemStatus) -> TodoItem {
    let mut i = TodoItem::new(id, item_type, id, Actor::User, NOW);
    i.status = status;
    i
}

#[test]
fn archived_hidden_by_default_but_shown_with_status_filter() {
    let items = vec![
        item("a", ItemType::Task, ItemStatus::Active),
        item("b", ItemType::Task, ItemStatus::Archived),
    ];

    let visible = apply_list_filter(items.clone(), ListFilter::default());
    assert_eq!(visible.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), ["a"]);

    let archived = apply_list_filter(
        items,
        ListFilter { status: Some(ItemStatus::Archived), ..ListFilter::default() },
    );
    assert_eq!(archived.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), ["b"]);
}

#[test]
fn type_and_query_filters_select_expected_rows() {
    let mut p = item("p", ItemType::Project, ItemStatus::Active);
    p.title = "annual report".into();
    let items = vec![item("t", ItemType::Task, ItemStatus::Active), p];

    let projects = apply_list_filter(
        items.clone(),
        ListFilter { item_type: Some(ItemType::Project), ..ListFilter::default() },
    );
    assert_eq!(projects.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), ["p"]);

    let matched = apply_list_filter(
        items,
        ListFilter { query: Some("report".into()), ..ListFilter::default() },
    );
    assert_eq!(matched.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), ["p"]);
}
```

- [ ] **Step 6: Write `tests/unit/error_mapping.rs`** (absorbs `logging_errors.rs`)

```rust
use oracle_todo::application::error::TodoError;

#[test]
fn cli_exit_codes_map_by_variant() {
    assert_eq!(TodoError::Policy("x".into()).cli_exit_code(), 2);
    assert_eq!(TodoError::Validation("x".into()).cli_exit_code(), 2);
    assert_eq!(TodoError::NotFound("x".into()).cli_exit_code(), 4);
    assert_eq!(TodoError::Storage("x".into()).cli_exit_code(), 1);
    assert_eq!(TodoError::Migration("x".into()).cli_exit_code(), 1);
    assert_eq!(TodoError::Internal("x".into()).cli_exit_code(), 1);
}

#[test]
fn http_status_codes_map_by_variant() {
    assert_eq!(TodoError::Policy("x".into()).http_status_code(), 400);
    assert_eq!(TodoError::Validation("x".into()).http_status_code(), 400);
    assert_eq!(TodoError::NotFound("x".into()).http_status_code(), 404);
    assert_eq!(TodoError::Storage("x".into()).http_status_code(), 500);
    assert_eq!(TodoError::Migration("x".into()).http_status_code(), 500);
    assert_eq!(TodoError::Internal("x".into()).http_status_code(), 500);
}

#[test]
fn downcast_maps_only_todo_errors() {
    let wrapped = anyhow::Error::new(TodoError::NotFound("x".into()));
    assert_eq!(TodoError::cli_exit_code_from_error(&wrapped), Some(4));
    assert_eq!(TodoError::cli_exit_code_from_error(&anyhow::anyhow!("plain")), None);
}
```

- [ ] **Step 7: Write `tests/unit/clock.rs`** (absorbs `local_today_uses_configured_offset_not_utc_date`)

```rust
use oracle_todo::infrastructure::system::local_date_string_at;
use time::macros::{datetime, offset};

#[test]
fn local_date_rolls_forward_with_positive_offset() {
    let got = local_date_string_at(datetime!(2026 - 05 - 31 15:30 UTC), offset!(+9));
    assert_eq!(got, "2026-06-01");
}

#[test]
fn local_date_equals_utc_date_at_utc_offset() {
    let got = local_date_string_at(datetime!(2026 - 05 - 31 15:30 UTC), offset!(UTC));
    assert_eq!(got, "2026-05-31");
}
```

- [ ] **Step 8: Write `tests/unit/architecture.rs`** (the boundary guard)

```rust
use std::fs;
use std::path::Path;

/// The domain layer must stay pure: no references to outer layers or I/O crates.
#[test]
fn domain_has_no_outward_dependencies() {
    let forbidden = [
        "crate::application",
        "crate::infrastructure",
        "crate::interfaces",
        "rusqlite",
        "axum",
    ];
    let domain = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/domain");
    let mut checked = 0;
    for entry in fs::read_dir(&domain).expect("read src/domain") {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        let source = fs::read_to_string(&path).unwrap();
        for needle in forbidden {
            assert!(
                !source.contains(needle),
                "{} must not reference `{needle}` (domain stays pure)",
                path.display()
            );
        }
        checked += 1;
    }
    assert!(checked >= 2, "expected to scan domain modules, found {checked}");
}
```

- [ ] **Step 9: Run the unit binary**

Run: `cargo test --test unit`
Expected: PASS — all unit tests green; confirms the new layer compiles as its own binary and the boundary guard passes against current (already-pure) domain.

- [ ] **Step 10: Commit**

```bash
git add tests/unit.rs tests/unit
git commit
```
Message:
```
[TEST] Add unit test layer with boundary guard

- recurrence/status/model/filter/error-mapping/clock pure 단위 테스트 추가
- domain 경계 가드(architecture.rs)로 외부 의존 차단
- tests/unit.rs 디스패처로 하위폴더 모듈 컴파일
```

## Task 0.3: Reorganize integration tests into `tests/integration/`

**Files:**
- Create: `tests/integration.rs` (dispatcher)
- Create: `tests/integration/service_policy.rs` (from `tests/application_policy.rs`, minus the pure tests now in unit/)
- Create: `tests/integration/events.rs` (the `every_mutation_records_event` test from `application_policy.rs`)
- Create: `tests/integration/repository.rs` (from `tests/sqlite_repository.rs`)
- Create: `tests/integration/materialization.rs` (from `tests/routine_materialization.rs`, minus the pure recurrence test now in unit/)
- Create: `tests/integration/exports.rs` (from `tests/export_parity.rs`)
- Modify: `tests/support/mod.rs` (add a service factory)
- Delete: `tests/application_policy.rs`, `tests/sqlite_repository.rs`, `tests/routine_materialization.rs`, `tests/export_parity.rs`, `tests/logging_errors.rs`

> These tests exercise the library in-process (service + sqlite + exports), so they are **integration**, not e2e. `export_parity.rs` calls `TodoService` + exports functions directly → it belongs here (a refinement of the spec's directional naming; flagged in the spec self-review).

- [ ] **Step 1: Extend `tests/support/mod.rs` with a service factory**

Append to the existing file (keep `TestHome` as-is):

```rust
/// Shared in-memory service for integration tests. `#[allow(dead_code)]` because
/// each test binary that `mod`s this support file uses a different subset.
#[allow(dead_code)]
pub fn memory_service() -> oracle_todo::application::service::TodoService {
    oracle_todo::application::service::TodoService::in_memory()
}
```

- [ ] **Step 2: Create the dispatcher `tests/integration.rs`**

```rust
#[path = "support/mod.rs"]
mod support;

mod events;
mod exports;
mod materialization;
mod repository;
mod service_policy;
```

- [ ] **Step 3: Move `application_policy.rs` → `integration/service_policy.rs`**

Move the file content. Then:
- Remove the 5 pure tests now living in `tests/unit/model.rs` (`oracle_task_starts_proposed`, `user_task_starts_approved`, `actor_strings_round_trip_through_domain_parser`, `domain_enums_require_canonical_lowercase_names`, `json_timestamps_are_rfc3339_strings`).
- Remove `every_mutation_records_event` (moves to `events.rs`, Step 4).
- If the file declared `mod support;`, delete that line; reference shared helpers via `crate::support::…` if any are used (this file currently builds services inline — keep its inline construction or swap to `crate::support::memory_service()`; either is fine, keep behavior identical).
- Keep all remaining `use oracle_todo::…` imports; drop any that become unused (clippy gate).

- [ ] **Step 4: Create `integration/events.rs`**

Move `every_mutation_records_event` here verbatim with its imports:
```rust
use oracle_todo::application::service::{CreateArea, ProposeProject, ProposeTask, TodoService};
// …plus whatever the test body referenced (events(), domain types).
```
(Keep the exact assertions; this is the audit-event invariant test.)

- [ ] **Step 5: Move the remaining three files**

- `sqlite_repository.rs` → `integration/repository.rs` (verbatim; it already imports from `oracle_todo::infrastructure::sqlite` and `oracle_todo::application`).
- `routine_materialization.rs` → `integration/materialization.rs`, removing `unanchored_monthly_interval_uses_first_of_month_default` (now in `unit/recurrence.rs`). Keep its inline `occurrence_keys` helper.
- `export_parity.rs` → `integration/exports.rs` (verbatim; imports `oracle_todo::exports` and `oracle_todo::application::service`).

For each: if it declared `mod support;`, remove it (the dispatcher owns support).

- [ ] **Step 6: Delete the old flat files**

```bash
git rm tests/application_policy.rs tests/sqlite_repository.rs tests/routine_materialization.rs tests/export_parity.rs tests/logging_errors.rs
```

- [ ] **Step 7: Run the integration binary**

Run: `cargo test --test integration`
Expected: PASS — every relocated assertion still green (no behavior changed, only file location).

- [ ] **Step 8: Commit**

```bash
git add tests/integration.rs tests/integration tests/support/mod.rs
git commit
```
Message:
```
[TEST] Move integration tests into tests/integration

- service_policy/repository/materialization/events/exports로 재배치
- 순수 테스트는 unit 계층으로 이관, 중복 제거
- support에 memory_service 팩토리 추가
```

## Task 0.4: Reorganize e2e tests into `tests/e2e/`

**Files:**
- Create: `tests/e2e.rs` (dispatcher)
- Create: `tests/e2e/cli.rs` (from `tests/cli_parity.rs`, minus the pure `local_today_…` test now in unit/clock.rs)
- Create: `tests/e2e/api.rs` (from `tests/api_parity.rs`)
- Delete: `tests/cli_parity.rs`, `tests/api_parity.rs`

> e2e = the delivered interfaces end-to-end: `cli.rs` spawns the real `oracle-todo` binary (assert_cmd); `api.rs` drives the full axum HTTP stack (tower `oneshot`).

- [ ] **Step 1: Create the dispatcher `tests/e2e.rs`**

```rust
#[path = "support/mod.rs"]
mod support;

mod api;
mod cli;
```

- [ ] **Step 2: Move `cli_parity.rs` → `e2e/cli.rs`**

- Remove its `mod support;` line; replace any `support::TestHome` references with `crate::support::TestHome`.
- Remove `local_today_uses_configured_offset_not_utc_date` (now in `unit/clock.rs`).
- Keep the inline `read_jsonl_records` helper and all assert_cmd assertions verbatim.

- [ ] **Step 3: Move `api_parity.rs` → `e2e/api.rs`**

- Verbatim move; keep inline helpers (`body_json`, `json_request`, `empty_request`, `http_request`).
- If it used `mod support;`, switch references to `crate::support::…`.

- [ ] **Step 4: Delete the old flat files**

```bash
git rm tests/cli_parity.rs tests/api_parity.rs
```

- [ ] **Step 5: Run all three layers**

Run:
```bash
cargo test --test unit
cargo test --test integration
cargo test --test e2e
cargo test
```
Expected: PASS for each; `cargo test` runs all three binaries. Confirm three distinct test targets exist.

- [ ] **Step 6: Full gate + commit**

Run: `cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings`
Expected: PASS.
```bash
git add tests/e2e.rs tests/e2e
git commit
```
Message:
```
[TEST] Move e2e tests into tests/e2e

- cli(assert_cmd 바이너리) / api(axum HTTP) 계층으로 재배치
- 순수 clock 테스트는 unit 계층으로 이관
```

**Phase 0 exit check:** `cargo test` green; `tests/{unit,integration,e2e}.rs` are the three binaries; old flat test files gone; coverage strictly increased (new pure unit tests). The safety net is in place.

---

# Phase 1 — Split `domain/model.rs` → extract `status.rs`

Goal: move `ItemStatus` and its helpers into `domain/status.rs`, keeping `oracle_todo::domain::ItemStatus` and the free fns re-exported unchanged.

**Files:**
- Create: `src/domain/status.rs`
- Modify: `src/domain/model.rs` (remove moved items)
- Modify: `src/domain/mod.rs` (declare + re-export)

- [ ] **Step 1: Create `src/domain/status.rs`**

Move from `model.rs`: the `ItemStatus` enum (lines 18–32), `terminal_status` (42–52), `hidden_by_default_status` (54–59), `impl ItemStatus { as_str }` (208–224), and `impl FromStr for ItemStatus` (226–245). Add the imports the moved code needs:
```rust
use serde::{Deserialize, Serialize};
use std::str::FromStr;
// (paste the moved ItemStatus enum, terminal_status, hidden_by_default_status, impls verbatim)
```

- [ ] **Step 2: Trim `src/domain/model.rs`**

Delete the moved items from `model.rs`. `model.rs` still uses `ItemStatus` (in `TodoItem.status` and `TodoItem::new`), so add at the top:
```rust
use super::status::ItemStatus;
```
Keep `ItemType`, `Actor`, `TodoItem`, `TodoEvent` and their impls. Remove any now-unused imports (e.g. if `FromStr` is still needed for `ItemType`/`Actor`, keep it; otherwise drop).

- [ ] **Step 3: Update `src/domain/mod.rs`**

```rust
mod model;
pub mod recurrence;
mod status;

pub use model::{Actor, ItemType, TodoEvent, TodoItem};
pub use recurrence::{RecurrenceError, occurrences};
pub use status::{ItemStatus, hidden_by_default_status, terminal_status};
```
(`oracle_todo::domain::ItemStatus` etc. resolve exactly as before.)

- [ ] **Step 4: Verify + commit**

Run: `cargo test && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings`
Expected: PASS — including `unit/architecture.rs` (domain still pure: `status.rs` imports only serde/std) and `unit/status.rs`.
```bash
git add src/domain
git commit
```
Message:
```
[REFACTOR] Extract ItemStatus into domain/status.rs

- 상태 enum/전이 술어를 model에서 분리
- domain/mod에서 동일 경로로 재노출(공개 API 불변)
```

---

# Phase 2 — Split `application/service.rs` → `application/service/`

Goal: turn `service.rs` (1056 lines) into a directory module. **Central mechanical change:** struct fields and shared helpers become `pub(super)` so sibling submodules compile.

**Files:**
- Create: `src/application/service/mod.rs`
- Create: `src/application/service/creation.rs`
- Create: `src/application/service/transitions.rs`
- Create: `src/application/service/update.rs`
- Create: `src/application/service/materialization.rs`
- Create: `src/application/service/queries.rs`
- Delete: `src/application/service.rs`
- (No change to `src/application/mod.rs` — `pub mod service;` now resolves to the directory.)

> Source ranges below refer to the current `service.rs`. Move code blocks verbatim; only change visibility as specified. Do not reorder helper calls (deterministic-clock lock).

- [ ] **Step 1: Create `service/mod.rs` (struct + shared helpers, visibility-widened)**

Move into `mod.rs`:
- `struct TodoService` (102–108) and `enum ServiceStore` (110–113) — change all struct fields and the enum to `pub(super)` so sibling files can access `self.store`, counters, etc.
- ctors `in_memory` / `persistent` (115–134), `events` (675–677).
- shared helpers, each marked `pub(super)`: `next_id` (806–821), `next_now` (823–830), `next_event_id` (1020–1035), `find_area` (832–856), `ensure_relation` (995–1018), `store_item_and_event` (858–887), `set_terminal_status` (889–898), `set_terminal_status_from` (900–915).
- free fns, each `pub(super)`: `generated_by_routine` (1038–1043), `parse_day` (1045–1050), `format_time` (1052–1056).
- module wiring + re-exports:
```rust
mod creation;
mod materialization;
mod queries;
mod transitions;
mod update;

pub use creation::{CreateArea, ProposeEvent, ProposeProject, ProposeRoutine, ProposeTask};
pub use update::UpdateItem;
```
- the `use` lines `mod.rs` needs (subset of the original header): `TodoError/TodoResult`, `ports::{TodoStore, ListFilter}` as used by helpers, domain types, `time`, `uuid`, `serde_json`.

> `pub(super)` here means "visible within `application` module tree" — still crate-internal, NOT part of the public API.

- [ ] **Step 2: Create `service/creation.rs`**

Move request structs + their impls: `CreateArea` (13–18), `ProposeTask` (20–30), `impl Default for ProposeTask` (32–46), `ProposeProject` (48–56), `ProposeRoutine` (58–65), `ProposeEvent` (67–80) — keep these `pub` (they are re-exported and used by cli/api/tests). Move `impl TodoService { create_area, propose_task, propose_project, propose_routine, propose_event }` (136–265). Add header:
```rust
use super::TodoService;
use crate::application::error::{TodoError, TodoResult};
use crate::domain::{Actor, ItemType, TodoItem};
// + time/serde_json/uuid as the bodies use; keep only what compiles clean under -D warnings.
```

- [ ] **Step 3: Create `service/transitions.rs`**

Move `impl TodoService { approve(305–323), activate(325–361), pause(363–394), resume(396–438), complete(504–528), archive(530–545), drop(547–563), cancel(565–592) }` and the private cascade helpers `cascade_routine_generated_tasks` (760–780), `transition_generated_task` (782–804), `record_generated_task_occurrence` (917–993) — keep these three `pub(super)` (used within transitions, and they call mod.rs helpers + `generated_tasks_for_routine` from materialization). Header imports as needed (`TodoError`, domain `ItemStatus`/`Actor`, time, serde_json).

- [ ] **Step 4: Create `service/update.rs`**

Move `struct UpdateItem` + `#[derive(Default)]` (82–100) — keep `pub` (re-exported). Move `impl TodoService { update_item }` (594–673). Header: `use super::TodoService;` + error/domain/time imports as used.

- [ ] **Step 5: Create `service/materialization.rs`**

Move `impl TodoService { materialize_routines(440–502) }` (keep `pub`) and the private helpers `create_generated_task` (679–703), `mark_routine_materialized` (705–722), `open_generated_task_exists_for_routine` (724–734), `generated_task_exists_for_occurrence` (736–745), `generated_tasks_for_routine` (747–758). Mark `generated_tasks_for_routine` `pub(super)` (called by transitions.rs); the others can stay private to this file. Header imports include `crate::domain::occurrences` and `super::{parse_day, generated_by_routine}`.

- [ ] **Step 6: Create `service/queries.rs`**

Move `impl TodoService { get(267–277), list_items(279–292), archive_items(294–303) }` — keep `pub`. These match on `self.store` (the `pub(super)` `ServiceStore`). Header: `use super::TodoService; use crate::application::ports::{ListFilter, apply_list_filter}; use crate::domain::{TodoItem, terminal_status};` etc.

- [ ] **Step 7: Delete the old file**

```bash
git rm src/application/service.rs
```

- [ ] **Step 8: Verify + commit**

Run: `cargo test && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings`
Expected: PASS. Watch for: (a) cross-submodule privacy errors → the named item needs `pub(super)`; (b) unused-import warnings per file → trim. The integration `service_policy`/`materialization`/`events` tests and the deterministic-clock assertions in repository tests must stay green.
```bash
git add src/application
git commit
```
Message:
```
[REFACTOR] Split TodoService into service/ submodules

- creation/transitions/update/materialization/queries로 분리
- 공유 필드/헬퍼는 pub(super)로만 확대(공개 API 불변)
- 요청 구조체/공개 메서드 경로 그대로 재노출
```

---

# Phase 3 — Split `infrastructure/sqlite.rs` → `infrastructure/sqlite/`

Goal: `sqlite.rs` (841 lines) becomes a directory module; shared leaf helpers become `pub(super)`.

**Files:**
- Create: `src/infrastructure/sqlite/mod.rs`
- Create: `src/infrastructure/sqlite/schema.rs`
- Create: `src/infrastructure/sqlite/mapping.rs`
- Create: `src/infrastructure/sqlite/repo.rs`
- Create: `src/infrastructure/sqlite/migrate_legacy.rs`
- Delete: `src/infrastructure/sqlite.rs`
- (No change to `src/infrastructure/mod.rs` — `pub mod sqlite;` resolves to the directory.)

- [ ] **Step 1: Create `sqlite/mod.rs`**

Move: `connect` (15–17, `pub`), `struct SqliteTodoRepository { conn }` (498–500), inherent `impl` incl. `new` + `list_events_for_item` (502–524). Add wiring:
```rust
mod mapping;
mod migrate_legacy;
mod repo;
mod schema;

pub use migrate_legacy::{LegacyMigrationReport, migrate_legacy_storage};
pub use schema::{init_schema, user_version};
```
`list_events_for_item` references mapping helpers → `use mapping::{row_to_event, storage_error};`.

- [ ] **Step 2: Create `sqlite/mapping.rs`** (the shared-helper hub)

Move the conversion + leaf helpers (693–841): `item_type_sqlite_value`, `status_sqlite_value`, `actor_sqlite_value`, `item_select_sql`, `row_to_item`, `row_to_event`, `row_value`, `parse_item_type`, `parse_status`, `parse_actor`, `parse_optional_actor`, `parse_time`, `parse_optional_time`, `format_time`, `format_optional_time`, `parse_json`, `parse_json_object`, `parse_optional_json`, `storage_error`. **Mark every one `pub(super)`** (siblings depend on them). Header: domain types, rusqlite, serde_json, time.

- [ ] **Step 3: Create `sqlite/schema.rs`**

Move `init_schema` (19–27, `pub`), `init_schema_inner` (29–105), `const ITEM_COLUMN_ADDITIONS` (107–136), `ensure_item_columns` (138–157), `user_version` (159–162, `pub`). Keep the raw SQL DDL strings byte-for-byte. `use super::mapping::storage_error;` and `crate::application::error::TodoError`.

- [ ] **Step 4: Create `sqlite/repo.rs`**

Move the trait impls (526–570): `impl TodoRepository/EventRepository/TodoStore for SqliteTodoRepository`, and free fns `save_item_on` (572–657), `save_event_on` (659–691). Keep the INSERT…ON CONFLICT SQL verbatim. Header:
```rust
use super::SqliteTodoRepository;
use super::mapping::{ /* helpers used: row_to_item, item_select_sql, *_sqlite_value, format_time, format_optional_time, storage_error */ };
use crate::application::error::TodoResult;
use crate::application::ports::{EventRepository, ListFilter, TodoRepository, TodoStore, apply_list_filter};
use crate::domain::{TodoEvent, TodoItem};
```
(The struct field `conn` is parent-private; child module `repo` can access it.)

- [ ] **Step 5: Create `sqlite/migrate_legacy.rs`**

Move 164–496: `LegacyMigrationReport` (`pub`, with its `pub` fields), `migrate_legacy_storage` (`pub`), all `Legacy*`/`Normalized*` row structs, `load_*`, `normalize_*`, `NormalizedTimeValue`, `parse_legacy_time`. Preserve the `.expect("created_at is required")` / `.expect("updated_at is required")` panics verbatim. `use super::mapping::{storage_error, parse_time, format_time};` + domain `FromStr` enums + rusqlite + time format_description macros.

- [ ] **Step 6: Delete the old file**

```bash
git rm src/infrastructure/sqlite.rs
```

- [ ] **Step 7: Verify + commit**

Run: `cargo test && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings`
Expected: PASS. The integration `repository.rs` tests (schema init, upsert preserves created_at, atomic save, legacy migrate, canonical enum strings) are the guard. If a sibling can't see a helper → make it `pub(super)`.
```bash
git add src/infrastructure
git commit
```
Message:
```
[REFACTOR] Split sqlite repository into sqlite/ submodules

- schema/mapping/repo/migrate_legacy로 분리, mod에서 동일 심볼 재노출
- 공유 헬퍼는 pub(super)로 확대, 원시 SQL/패닉 지점 그대로 보존
- SqliteTodoRepository 타입명/공개 경로 불변
```

---

# Phase 4 — Split interfaces (`cli/`, `api/`) and move `exports.rs`

## Task 4.1: Move `exports.rs` under `interfaces/` (do this FIRST — cli/api import it)

**Files:**
- Create: `src/interfaces/exports.rs` (content identical to current `src/exports.rs`)
- Delete: `src/exports.rs`
- Modify: `src/interfaces/mod.rs` (add `pub mod exports;`)
- Modify: `src/lib.rs` (re-export to preserve `oracle_todo::exports`)

- [ ] **Step 1: Move the file**

```bash
git mv src/exports.rs src/interfaces/exports.rs
```
Its internal `use crate::application::… / crate::domain::…` lines are absolute and remain valid. Do not edit them.

- [ ] **Step 2: Update `src/interfaces/mod.rs`**

```rust
pub mod api;
pub mod cli;
pub mod exports;
```

- [ ] **Step 3: Update `src/lib.rs` to keep the public path stable**

```rust
pub mod application;
pub mod domain;
pub mod infrastructure;
pub mod interfaces;

pub use interfaces::exports;
```
This keeps `oracle_todo::exports::{render_items, today_tasks, write_exports, …}` working — required by `tests/integration/exports.rs`. **Highest-risk item in the refactor; verify this test compiles.**

- [ ] **Step 4: Repoint internal importers**

`src/interfaces/cli.rs` line 14 and `src/interfaces/api.rs` line 20 import `crate::exports::…`. With the `pub use interfaces::exports;` alias in `lib.rs`, `crate::exports::…` still resolves — leave these as-is for a minimal diff. (They will move into the split files in Tasks 4.2/4.3 with the same path.)

- [ ] **Step 5: Verify + commit**

Run: `cargo test && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings`
Expected: PASS, especially `cargo test --test integration` (exports path) and `cargo test --test e2e` (CLI writes `exports/today.md`, API `/exports/today.md`).
```bash
git add src/exports.rs src/interfaces/exports.rs src/interfaces/mod.rs src/lib.rs
git commit
```
Message:
```
[REFACTOR] Move exports into interfaces layer

- exports.rs를 interfaces/로 이동(출력 어댑터 계층화)
- lib.rs에서 pub use로 oracle_todo::exports 경로 보존
```

## Task 4.2: Split `api.rs` → `interfaces/api/`

**Files:**
- Create: `src/interfaces/api/mod.rs`, `src/interfaces/api/handlers.rs`, `src/interfaces/api/dto.rs`
- Delete: `src/interfaces/api.rs`

- [ ] **Step 1: Create `api/mod.rs`** (router + state + error boundary + shared helpers)

Move: imports + `struct ApiState` (1–27), `router` (123–146, `pub`), and the wiring block (441–539): `service`, `api_db_path`, `with_service`, `ApiResult` alias, `ApiError` + `impl From`/`impl IntoResponse`, helper fns `non_empty`, `non_empty_string`, `parse_actor_or_default`, `parse_bool`, `validation_rejection`. Mark `ApiState`, `ApiResult`, `ApiError`, `with_service`, `service`, and the helper fns `pub(super)` (handlers need them). Add:
```rust
mod dto;
mod handlers;
use handlers::*;
```
Keep `ApiError`'s NotFound→400 mapping intact (HTTP status behavior lock).

- [ ] **Step 2: Create `api/dto.rs`** (wire shapes)

Move the 8 `#[derive(Deserialize)]` structs (29–121): `AreaBody`, `TaskProposeBody`, `ProjectProposeBody`, `RoutineProposeBody`, `EventProposeBody`, `ReasonBody`, `UpdateBody`, `ItemsQuery`. Mark each `pub(super)`. Preserve `#[serde(rename = "type")]` on `ItemsQuery::item_type`. Header: `use serde::Deserialize;` (+ `Default` derives where present).

- [ ] **Step 3: Create `api/handlers.rs`** (18 endpoint fns)

Move 148–439: `health`, `create_area`, `propose_task`, `propose_project`, `propose_routine`, `propose_event`, `list_items`, `archive_items`, `update_item`, `approve_item`, `activate_item`, `pause_item`, `resume_item`, `complete_item`, `archive_item`, `drop_item`, `cancel_item`, `today_export`. Mark each `pub(super)`. Header imports:
```rust
use super::dto::{AreaBody, EventProposeBody, ItemsQuery, ProjectProposeBody, ReasonBody, RoutineProposeBody, TaskProposeBody, UpdateBody};
use super::{ApiResult, ApiState, non_empty, non_empty_string, parse_actor_or_default, parse_bool, validation_rejection, with_service};
use crate::application::ports::ListFilter;
use crate::application::service::{CreateArea, ProposeEvent, ProposeProject, ProposeRoutine, ProposeTask, TodoService, UpdateItem};
use crate::domain::{Actor, ItemStatus, ItemType, TodoItem};
use crate::exports::render_items; // today_export
// + axum extractors/Json/State, http header, serde_json as used.
```

- [ ] **Step 4: Delete + verify + commit**

```bash
git rm src/interfaces/api.rs
cargo test --test e2e
cargo test && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings
```
Expected: PASS — `e2e/api.rs` (HTTP 200/400/404, route table, `/exports/today.md`) is the guard. Every handler named in `router()` must be in scope via `use handlers::*`.
```bash
git add src/interfaces/api
git commit
```
Message:
```
[REFACTOR] Split axum api into api/ submodules

- mod(router/state/error) / handlers / dto로 분리
- 내부 항목은 pub(super)로만 확대, router 공개 경로 불변
- NotFound→400 매핑 등 HTTP 동작 그대로 보존
```

## Task 4.3: Split `cli.rs` → `interfaces/cli/`

**Files:**
- Create: `src/interfaces/cli/mod.rs`, `cli/create.rs`, `cli/lifecycle.rs`, `cli/views.rs`, `cli/output.rs`
- Delete: `src/interfaces/cli.rs`

> Decisions (from spec self-review): `routine_materialize` → `views.rs`; `init`/`health`/`migrate_legacy_db` → `mod.rs` (system/dispatch handlers); `output.rs` gets a small extracted `print_json` helper (the one non-pure extraction; "allow small fixes").

- [ ] **Step 1: Create `cli/output.rs`** (extract the shared JSON printer)

```rust
use anyhow::Result;
use serde::Serialize;

/// Print a value as a single JSON line to stdout (the CLI's machine-readable result).
pub(super) fn print_json<T: Serialize>(value: &T) -> Result<()> {
    println!("{}", serde_json::to_string(value)?);
    Ok(())
}
```
This replaces the repeated `println!("{}", serde_json::to_string(&item)?)` pattern (~17 sites). Behavior identical (same serializer, same single-line output).

- [ ] **Step 2: Create `cli/mod.rs`** (clap defs + dispatch + helpers + system handlers)

Move: imports (1–19), `struct Cli` (21–31), `enum Command` (33–96), sub-enums (98–128), all Args structs (130–288), `pub fn run` (290–348), `command_label` (350–388), `elapsed_millis` (390–392), the system handlers `init`/`health`/`migrate_legacy_db` (394–425), shared helpers `service` (650–655), `connect_path` (657–662), `today_string` (664–666), and `parse_actor`/`parse_status`/`parse_item_type` (668–687). Keep `parse_*` in this module (clap `value_parser` attributes reference them by bare path). Mark `service`, `connect_path`, `today_string` `pub(super)` (handlers in sibling files call them). Add wiring:
```rust
mod create;
mod lifecycle;
mod output;
mod views;
```
Update `run`'s match arms to call `create::…`, `lifecycle::…`, `views::…` for the relocated handlers.

- [ ] **Step 3: Create `cli/create.rs`**

Move handlers `task_propose` (427–444), `project_propose` (446–459), `area_create` (461–471), `routine_propose` (473–485), `event_propose` (501–519). Mark each `pub(super)`. Replace inline JSON printing with `super::output::print_json(&item)?`. Header:
```rust
use super::output::print_json;
use super::{service, AreaCreateArgs, EventProposeArgs, ProjectProposeArgs, RoutineProposeArgs, TaskProposeArgs};
use crate::application::service::{CreateArea, ProposeEvent, ProposeProject, ProposeRoutine, ProposeTask};
use anyhow::Result;
use std::path::Path;
```

- [ ] **Step 4: Create `cli/lifecycle.rs`**

Move `approve` (536–541), `activate` (543–548), `pause` (550–555), `resume` (557–562), `complete` (564–569), `archive` (571–576), `drop_item` (578–583), `cancel` (585–590), `update` (592–617). Mark each `pub(super)`. Use `print_json`. Header: `use super::{service, output::print_json, ItemTransitionArgs, UpdateArgs}; use crate::application::service::UpdateItem;` + anyhow/Path.

- [ ] **Step 5: Create `cli/views.rs`**

Move `list` (521–534), `routine_materialize` (487–499), `archive_list` (619–624), `pending` (626–631), `today` (633–639), `export` (641–648). Mark each `pub(super)`. Header pulls `crate::exports::{render_items, pending_items, current_today_items, write_current_exports}`, `super::{service, today_string, ListArgs, RoutineMaterializeArgs}`, `crate::infrastructure::paths` as used. Preserve `routine_materialize`'s default-`now`=`today_string()` behavior and `list`'s rendering exactly.

- [ ] **Step 6: Delete + verify + commit**

```bash
git rm src/interfaces/cli.rs
cargo test --test e2e
cargo test && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings
```
Expected: PASS — `e2e/cli.rs` (full CLI surface, exit codes, JSONL logs, rotation, `exports/today.md`) is the guard. `main.rs` still calls `oracle_todo::interfaces::cli::run()` unchanged.
```bash
git add src/interfaces/cli
git commit
```
Message:
```
[REFACTOR] Split cli into cli/ submodules

- mod(clap/dispatch/system) / create / lifecycle / views / output로 분리
- print_json 공유 헬퍼 추출로 중복 제거(출력 동일)
- run 공개 경로/모든 서브커맨드 동작 불변
```

**Phase 1–4 exit check:** every `src` file under ~400 lines; `exports` under `interfaces/`; `cargo test` green across all three layers; `unit/architecture.rs` green; public surface unchanged (proven by integration + e2e tests).

---

# Phase 5 — Docs: architecture / conventions / operations

Goal: populate the three doc folders with code-verified content, fold the two flat docs in, and fix the `CLAUDE.md` Docs Map. Author each doc against the *refactored* tree (verify every command, route, column, path before writing).

> No-placeholder rule applies to docs too: every file is real content, not a stub. Cross-link to `README.md` for the canonical column tables instead of duplicating them.

**Files (create):**
- `docs/architecture/overview.md`, `layers.md`, `data-model.md`
- `docs/architecture/decisions/adr-0001-sqlite-source-of-truth.md` … `adr-0005-recurrence-pattern-parsing.md`
- `docs/conventions/code-style.md`, `testing.md`, `error-handling.md`, `logging.md`, `git-commit.md`
- `docs/operations/setup.md`, `cli-reference.md`, `api-reference.md`, `data-home.md`, `logging-and-rotation.md`, `verification-and-smoke.md`, `migration.md`
**Files (modify/delete):** `CLAUDE.md` (Docs Map); delete `docs/design-v1.md`, `docs/rust-refactor.md` after folding.

- [ ] **Step 1: `docs/architecture/overview.md`**
Content: one-paragraph purpose; the canonical pipeline diagram from `design-v1.md` (Telegram/CLI/Oracle → TodoService → policy+state machine → SQLite+events → Markdown/JSON/API); the five core principles (SQLite source of truth, service-layer policy, approval gating, mandatory audit events, read-only Second_Brain refs). Link to `layers.md` and `data-model.md`.

- [ ] **Step 2: `docs/architecture/layers.md`**
Content: the table of layers and their files **as they exist after the refactor** (`domain/{model,status,recurrence}`, `application/{service/*,ports,error}`, `infrastructure/{sqlite/*,paths,system}`, `interfaces/{cli/*,api/*,exports}`, root `lib.rs`/`main.rs`). State the dependency rule (inward only) and that it is enforced by `tests/unit/architecture.rs`. Note the `pub(super)` convention used inside split modules and why (module-scoped privacy).

- [ ] **Step 3: `docs/architecture/data-model.md`**
Content: item types (area/project/routine/task/event/review/archive_item) and their invariants; the `ItemStatus` lifecycle (proposal → live → terminal) with the terminal set; the `events` audit table contract. Link to `README.md` for the full column tables (no duplication). Verify each status against `src/domain/status.rs`.

- [ ] **Step 4: `docs/architecture/decisions/adr-000{1..5}.md`**
One ADR per locked policy, each with Context / Decision / Consequences:
  - 0001 SQLite is the single source of truth (CLI/API/exports are views).
  - 0002 All mutations route through `TodoService` (policy + state machine + audit event).
  - 0003 Approval gates agent/Oracle-created work (`proposed` until user approval).
  - 0004 No hard delete in v1 (archive/cancel/drop instead).
  - 0005 Recurrence parsing is pattern-based (`every N <unit>` + weekday/monthly anchors), not one-rule-per-string. Verify against `src/domain/recurrence.rs`.

- [ ] **Step 5: `docs/conventions/code-style.md`**
Content: Rust 2024; the gate (`cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`); the ~400-line file guideline and "split by responsibility"; naming; the `pub(super)` visibility rule for intra-module splits; "never widen to `pub` just to compile."

- [ ] **Step 6: `docs/conventions/testing.md`**
Content: the three layers and what belongs in each (unit=pure no-I/O in `tests/unit/`; integration=library wired in-process in `tests/integration/`; e2e=binary via assert_cmd + axum via tower in `tests/e2e/`); the **dispatcher pattern** and the cargo subfolder gotcha; how to run one layer (`cargo test --test unit|integration|e2e`); `tests/support/mod.rs` usage and `#[allow(dead_code)]`; coverage ≥80% target.

- [ ] **Step 7: `docs/conventions/error-handling.md`**
Content: `TodoError` variants and the exit-code/HTTP mapping table (Policy/Validation→2/400, NotFound→4/404, Storage/Migration/Internal→1/500); `anyhow` at the binary boundary + `cli_exit_code_from_error` downcast; no-panic policy except documented `.expect()` invariants in the legacy migrator. Verify against `src/application/error.rs`.

- [ ] **Step 8: `docs/conventions/logging.md`**
Content: how to emit operational logs (`OperationalLogger`: `command_start`/`command_success`/`command_error`), record fields, levels. Cross-link to `operations/logging-and-rotation.md` for rotation behavior. Verify against `src/infrastructure/system.rs`.

- [ ] **Step 9: `docs/conventions/git-commit.md`**
Content: the `[TAG] English subject` + Korean bullet body format; fine-grained logical commits; tags in use (`[REFACTOR]`, `[TEST]`, `[DOCS]`, etc.).

- [ ] **Step 10: operations docs**
  - `setup.md`: `cargo build`, `cargo run -- init`, data-home default. From `README.md` Setup.
  - `cli-reference.md`: every subcommand (init/health/migrate-legacy-db/list/area/project/task/routine/event/approve/activate/pause/resume/complete/archive/drop/cancel/update/archive-list/pending/today/export). Verify names against `src/interfaces/cli/mod.rs`.
  - `api-reference.md`: every route. Verify against `src/interfaces/api/mod.rs` router table.
  - `data-home.md`: `ORACLE_TODO_HOME`/`--home`, layout (`todo.sqlite`, `exports/*.md`, `logs/*`), the "never target live home" rule (from `rust-refactor.md`).
  - `logging-and-rotation.md`: files, `ORACLE_TODO_LOG_MAX_BYTES`/`ORACLE_TODO_LOG_MAX_FILES`, rotation shift. From `README.md` + `system.rs`.
  - `verification-and-smoke.md`: the gate + copied-data smoke (from `rust-refactor.md`), coverage ≥80% note.
  - `migration.md`: `migrate-legacy-db` normalization + additive `init_schema`. From `README.md`.

- [ ] **Step 11: Fold + delete the flat docs, fix `CLAUDE.md` Docs Map**
Confirm `design-v1.md`/`rust-refactor.md` content is fully represented above, then:
```bash
git rm docs/design-v1.md docs/rust-refactor.md
```
Update the `CLAUDE.md` "Docs Map" table rows to point at the new paths:
  - data model / lifecycle / CLI/API surface → `README.md` + `docs/operations/cli-reference.md` + `docs/operations/api-reference.md`
  - design rationale / architecture → `docs/architecture/overview.md`, `layers.md`, `decisions/`
  - guardrails / smoke / verification → `docs/operations/verification-and-smoke.md`, `docs/operations/data-home.md`
Also update the `## Docs Map` and the `docs/design-v1.md` / `docs/rust-refactor.md` references elsewhere in `CLAUDE.md`.

- [ ] **Step 12: Verify links + commit**
Manually confirm no doc references a deleted path and all relative links resolve. (Build/tests unaffected by docs.)
```bash
git add docs CLAUDE.md
git commit
```
Message:
```
[DOCS] Restructure docs into architecture/conventions/operations

- design-v1/rust-refactor 내용을 3개 하위폴더로 흡수
- 코드(라우트/서브커맨드/컬럼/상태) 기준으로 검증해 작성
- CLAUDE.md Docs Map 경로 갱신
```

---

# Phase 6 — Final verification gate

**Files:** none (verification) — except recording coverage state.

- [ ] **Step 1: Full gate**
Run:
```bash
cargo build
cargo test
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
```
Expected: all PASS. Confirm three test binaries run: `cargo test --test unit`, `--test integration`, `--test e2e`.

- [ ] **Step 2: Coverage (if tooling available)**
Run (try in order, skip if uninstalled):
```bash
cargo llvm-cov --summary-only   # or: cargo tarpaulin --out Stdout
```
Expected: line coverage ≥80%. If neither tool is installed, note in `verification-and-smoke.md` that coverage was not measured (do not install tooling without approval).

- [ ] **Step 3: Copied-data smoke (never the live home)**
Run:
```bash
tmp_home="$(mktemp -d)"
cargo run -- --home "$tmp_home" init
cargo run -- --home "$tmp_home" pending
cargo run -- --home "$tmp_home" today
cargo run -- --home "$tmp_home" export
```
Expected: each command succeeds against the temp home; `~/.hermes/oracle-todo` untouched. (If a real legacy `todo.sqlite` is available, copy it to `$tmp_home` and also run `migrate-legacy-db` per `docs/operations/verification-and-smoke.md`.)

- [ ] **Step 4: Size + structure check**
Confirm no `src/**/*.rs` exceeds ~400 lines (`wc -l`), `src/exports.rs` no longer exists (now `src/interfaces/exports.rs`), and `docs/{architecture,conventions,operations}` are populated.

- [ ] **Step 5: Branch is ready**
Summarize: all gates green, behavior preserved (integration + e2e prove the public surface), coverage state recorded. Ready for PR/merge decision via `superpowers:finishing-a-development-branch`.

---

## Self-review (completed during planning)

- **Spec coverage:** src split (Phases 1–4) ✓; unit/integration/e2e layers (Phase 0) ✓; docs three folders (Phase 5) ✓; behavior-preserving + flag-on-change (cross-cutting rules) ✓; final gate + smoke (Phase 6) ✓.
- **Deviations from spec (allowed "small fixes", flagged):** (1) `export_parity` → `integration/exports.rs` not e2e (it is in-process). (2) `logging_errors` → `unit/error_mapping.rs` (pure mapping), no `integration/logging.rs`. (3) unit layer has 6 test files + guard (richer than the spec's 4). (4) `cli/output.rs` introduces a `print_json` helper (small DRY extraction). (5) real struct name `SqliteTodoRepository` retained.
- **Type consistency:** symbol names (`TodoService`, `SqliteTodoRepository`, `CreateArea`/`ProposeTask`/`ProposeProject`/`ProposeRoutine`/`ProposeEvent`, `UpdateItem`, `occurrences`, `RecurrenceError`, `terminal_status`, `hidden_by_default_status`, `apply_list_filter`/`ListFilter`, `local_date_string_at`, `init_schema`/`user_version`/`migrate_legacy_storage`/`LegacyMigrationReport`, `render_items`/`today_tasks`/`write_exports`) verified against source reads.
- **Placeholder scan:** none — move-steps cite exact source ranges; new-code steps show complete code; doc steps list concrete verified content.
