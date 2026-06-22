# Phase 1: Domain + Schema Foundation - Pattern Map

**Mapped:** 2026-06-22
**Files analyzed:** 5 (3 modified, 1 new, 1 new test) + module wiring
**Analogs found:** 5 / 5 (all exact, in-repo)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `todo-engine/src/domain/model.rs` (MODIFY: add `Goal`) | domain model (enum) | transform (string ↔ enum) | self — existing `ItemType` block | exact |
| `todo-engine/src/domain/horizon.rs` (NEW) — `Horizon` enum + anchor helper | domain model + pure date math | transform (`Date` → canonical `Date`) | `domain/recurrence.rs` (date math) + `model.rs::ItemType` (enum strings) | exact (two analogs) |
| `todo-engine/src/domain/mod.rs` (MODIFY: wire module) | module wiring | n/a | self — existing `pub use` lines | exact |
| `todo-engine/src/infrastructure/sqlite/mapping.rs` (MODIFY) | infrastructure adapter | transform (round-trip) | self — `parse_item_type` / `item_type_sqlite_value` | exact (no edit likely needed — see note) |
| `todo-engine/src/infrastructure/sqlite/schema.rs` (MODIFY: add 3 indexes) | infrastructure (migration) | batch DDL | self — `init_schema_inner` index block | exact |
| `todo-engine/tests/unit/horizon.rs` (NEW) — boundary tests | test | n/a | `tests/unit/recurrence.rs`, `tests/unit/model.rs` | exact |

## Pattern Assignments

### `todo-engine/src/domain/model.rs` — add `ItemType::Goal` (domain model, transform)

**Analog:** self. Mirror the existing `ItemType` enum + `as_str` + `FromStr` exactly.

**Enum variant** (model.rs:7-17) — add `Goal` to the variant list. `#[serde(rename_all = "snake_case")]` already on the enum makes serde emit/accept `"goal"` for free:
```rust
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemType {
    Area,
    Project,
    Routine,
    Task,
    Event,
    Review,
    ArchiveItem,
    // add: Goal,
}
```

**`as_str` arm** (model.rs:143-155) — add `ItemType::Goal => "goal",`:
```rust
impl ItemType {
    pub fn as_str(self) -> &'static str {
        match self {
            ItemType::Area => "area",
            // ... existing arms ...
            ItemType::ArchiveItem => "archive_item",
            // add: ItemType::Goal => "goal",
        }
    }
}
```

**`FromStr` arm** (model.rs:157-172) — add `"goal" => Ok(ItemType::Goal),`. Note `value.trim()` is already applied; keep the lowercase string contract:
```rust
impl FromStr for ItemType {
    type Err = String;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim() {
            "area" => Ok(ItemType::Area),
            // ... existing arms ...
            "archive_item" => Ok(ItemType::ArchiveItem),
            // add: "goal" => Ok(ItemType::Goal),
            _ => Err(format!("unknown item type: {value}")),
        }
    }
}
```

**Caution:** `as_str` and `FromStr` are `match` (no wildcard on `as_str`). Adding a variant forces the `as_str` arm — the compiler enforces completeness. Do NOT add a `_ =>` to `as_str`.

---

### `todo-engine/src/domain/horizon.rs` — NEW: `Horizon` enum + anchor helper (domain, pure date transform)

This file has TWO analogs: the `ItemType` string-mapping idiom (for the enum) and `recurrence.rs` date math (for the anchor helper). Lives in `domain/` — pure, no I/O (precedent: `recurrence.rs`).

**Enum + string mapping** — copy the `ItemType` shape (model.rs:7-17, 143-172). Three variants `Year`/`Month`/`Week`, stored as `"year"`/`"month"`/`"week"` in the existing `horizon` TEXT column (D-01). Use `#[serde(rename_all = "lowercase")]` (matches `ItemStatus` at status.rs:4-5, since all three are already lowercase single words):
```rust
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use time::Date;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Horizon {
    Year,
    Month,
    Week,
}

impl Horizon {
    pub fn as_str(self) -> &'static str { /* year/month/week — mirror model.rs:144 */ }
}

impl FromStr for Horizon {
    type Err = String;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim() { /* mirror model.rs:160-169, Err: "unknown horizon: {value}" */ }
    }
}
```

**Strict coarser-than ordering** (D-02, D-07) — strict only, no `_or_equal`. Implement as an explicit method (not `Ord`, to keep the "strict" semantics unambiguous and avoid implying a total order callers might misuse). Coarseness rank: `Year` coarsest, `Week` finest:
```rust
impl Horizon {
    /// year is coarser than month is coarser than week. Strict (no equality).
    pub fn is_coarser_than(self, other: Horizon) -> bool {
        self.rank() < other.rank() // year=0, month=1, week=2
    }
}
```

**Anchor helper (THE LYNCHPIN)** — reuse `recurrence.rs` date idioms exactly. Operates on already-parsed `time::Date` (parsing is Phase 2). Must expose BOTH `normalize(Date, Horizon) -> Date` AND an is-canonical check (D-05):

- **Year → Jan 1** (D-06): copy `recurrence.rs:282` `date(year, Month::January, 1)` and the local `date()` constructor at recurrence.rs:310-312.
- **Month → 1st** (D-06): copy `recurrence.rs:299-301` `first_of_month(year, month)` = `date(year, month, 1)`.
- **Week → ISO Monday** (D-06) — the boundary-critical case. Reuse the weekday index idiom at recurrence.rs:241-243:
```rust
// from recurrence.rs:241-243 — number_from_monday() is 1..=7, so -1 gives Mon=0..Sun=6
fn weekday_index(date: Date) -> i32 {
    date.weekday().number_from_monday() as i32 - 1
}
// Monday-of-week = date - weekday_index days. Uses time::Duration (recurrence.rs:3 import).
// e.g. 2026-01-01 (Thu, idx 3) -> 2025-12-29 (Mon). Do NOT clamp to Jan 1.
let monday = date - time::Duration::days(weekday_index(date) as i64);
```
- **is-canonical** (D-05): `normalize(d, h) == d`. Used by Phase 2 to strict-reject (D-04), never to auto-snap.

**Doc requirement (Roadmap SC2):** put a doc comment next to the week helper stating the ISO-Monday convention (and that Monday may fall in the prior calendar year).

**Borrow these recurrence.rs helpers** (copy or factor — they are private to recurrence.rs, so re-implement locally in `horizon.rs` rather than making them `pub`):
- `date(year, Month, day)` constructor — recurrence.rs:310-312
- `first_of_month` — recurrence.rs:299-301
- `weekday_index` via `number_from_monday()` — recurrence.rs:241-243
- imports `use time::{Date, Duration, Month};` — recurrence.rs:3

---

### `todo-engine/src/domain/mod.rs` — wire the new module (module wiring)

**Analog:** self (mod.rs:1-7). Follow the existing `mod` + `pub use` convention. `recurrence` is `pub mod`; `model`/`status` are private `mod` with re-exports. Match the re-export style:
```rust
mod horizon;            // (or `pub mod horizon;` — match recurrence if helper consumed cross-layer)
pub use horizon::Horizon;
// plus the anchor helper fn(s) if free functions, or just Horizon if methods
```
Add `Goal` is already covered by the existing `pub use model::{... ItemType ...}` — no change to that line.

---

### `todo-engine/src/infrastructure/sqlite/mapping.rs` — round-trip wiring (infrastructure adapter, transform)

**Analog:** self. The round-trip is already generic over `ItemType`:
- `item_type_sqlite_value` (mapping.rs:10-12) calls `item_type.as_str()` — works for `Goal` automatically once the enum arm exists.
- `parse_item_type` (mapping.rs:107-109) calls `ItemType::from_str` — works for `"goal"` automatically once the `FromStr` arm exists.

**Likely NO edit needed in this file** — adding `Goal` to `model.rs` makes the SQLite `type`-column round-trip (SC3) pass for free, carried by `as_str`/`FromStr` through this adapter (NOT serde — serde's `snake_case` rename governs only the separate JSON path). Verify with a round-trip assertion in the test binary rather than changing mapping.rs. (Flag this to the planner: this is a "confirm, don't edit" file.)

---

### `todo-engine/src/infrastructure/sqlite/schema.rs` — add 3 planning indexes (infrastructure migration, batch DDL)

**Analog:** self — the existing index `execute_batch` block (schema.rs:72-89). Additive only (D-08, CORE-02). Add three `CREATE INDEX IF NOT EXISTS` lines INSIDE the existing batch (between the routine-occurrence index at line 81 and the events indexes at 83), keeping the trailing `PRAGMA user_version = 1; COMMIT;` last:
```rust
CREATE INDEX IF NOT EXISTS idx_items_parent_id ON items(parent_id);
CREATE INDEX IF NOT EXISTS idx_items_scheduled ON items(scheduled);
CREATE INDEX IF NOT EXISTS idx_items_type_horizon_scheduled
    ON items(type, horizon, scheduled);
```
**Constraints (locked):**
- No `ALTER TABLE` — `horizon` column already exists (schema.rs:42, and in `ITEM_COLUMN_ADDITIONS` at :113). Do NOT touch `ensure_item_columns` or `ITEM_COLUMN_ADDITIONS`.
- Do NOT bump `PRAGMA user_version` (no `user_version` gating this phase — locked OUT upstream). Leave it at `1`.
- `IF NOT EXISTS` makes this idempotent on existing data homes (SC4).
- Error path already handled: the batch is wrapped by `init_schema` rollback (schema.rs:5-13) and maps errors via `TodoError::Migration` (schema.rs:90).

---

### `todo-engine/tests/unit/horizon.rs` — NEW boundary tests (test)

**Analog:** `tests/unit/recurrence.rs:1-16` and `tests/unit/model.rs:1-13`. Tests are a separate test binary under `todo-engine/tests/unit/` (NOT inline `#[cfg(test)] mod tests`). Use the `time::macros::date!` literal idiom and import from the crate's public path:
```rust
use time::macros::date;
use todo_engine::domain::Horizon; // + anchor helper export

#[test]
fn week_anchor_snaps_to_iso_monday_across_year_boundary() {
    // Roadmap SC1 boundary cases — D-06
    // 2026-01-01 (Thu) -> 2025-12-29 (Mon)  [W01 / Jan-1 / prior-year Monday]
    // assert normalize(date!(2026-01-01), Horizon::Week) == date!(2025-12-29)
    // also assert is-canonical(date!(2025-12-29)) == true
}
```
**Required boundary cases (Roadmap SC1):** ISO week W01 and W53, Dec 31, Jan 1. Also cover Year→Jan 1, Month→1st, and the strict-reject is-canonical check (non-canonical month-15th is NOT canonical).
Register the new file in the unit test binary the same way `recurrence.rs`/`model.rs` are (check `tests/unit/main.rs` or the harness `mod` list).

## Shared Patterns

### String ↔ enum round-trip (the project's universal idiom)
**Source:** `model.rs:143-172` (`ItemType`), `status.rs:39-...` (`ItemStatus`).
**Apply to:** `ItemType::Goal`, `Horizon`.
- `as_str(self) -> &'static str` via exhaustive `match` (no wildcard — compiler enforces new variants).
- `impl FromStr` with `value.trim()`, lowercase string keys, `Err(format!("unknown ...: {value}"))`.
- `#[serde(rename_all = "...")]` on the enum so JSON matches the SQLite string (`snake_case` for `ItemType`, `lowercase` for `Horizon`/`ItemStatus`).

### Pure date math on `time::Date`
**Source:** `recurrence.rs` (entire file is the precedent for I/O-free `domain/` date logic).
**Apply to:** `horizon.rs` anchor helper.
- `use time::{Date, Duration, Month};`
- Local `date(year, Month, day)` constructor wrapping `Date::from_calendar_date(...).expect(...)` (recurrence.rs:310-312).
- `weekday_index` via `number_from_monday() - 1` (recurrence.rs:241-243) for Monday snapping.
- Day arithmetic via `date +/- Duration::days(n)`.

### Additive-only schema migration
**Source:** `schema.rs:72-91` (index batch) + `ensure_item_columns` (schema.rs:124-143).
**Apply to:** the 3 new indexes.
- `CREATE INDEX IF NOT EXISTS` (idempotent, safe on existing data homes).
- Errors mapped to `TodoError::Migration`; whole `init_schema` is rollback-wrapped.
- Verify on a COPIED data home, never live `~/.todo-engine/todo.sqlite` (D-08, data-home safety).

### Unit test idiom
**Source:** `tests/unit/recurrence.rs:1-3`, `tests/unit/model.rs:1-5`.
**Apply to:** `tests/unit/horizon.rs`.
- Separate test binary under `tests/unit/`, not inline modules.
- `use time::macros::date!` / `datetime!` literals; import via `todo_engine::domain::...`.

## No Analog Found

None. Every new/modified file maps to an exact in-repo analog.

## Metadata

**Analog search scope:** `todo-engine/src/domain/`, `todo-engine/src/infrastructure/sqlite/`, `todo-engine/tests/unit/`
**Files scanned:** model.rs, recurrence.rs, status.rs, mapping.rs, schema.rs, domain/mod.rs, tests/unit/{recurrence,model}.rs
**Pattern extraction date:** 2026-06-22
