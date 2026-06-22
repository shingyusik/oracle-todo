# Stack Research

**Domain:** Hierarchical period-goal planning layer on an existing Rust local-first ToDo engine
**Researched:** 2026-06-22
**Confidence:** HIGH

> Brownfield / subsequent milestone. The stack is **fixed**: Rust 2024, rusqlite 0.32 (bundled SQLite), axum 0.7, clap 4.5, tokio, tracing, `time` 0.3, serde, uuid. This document does **not** re-litigate those choices. It prescribes the *techniques and APIs within that fixed stack* for (a) year/month/ISO-week period math and (b) hierarchical goal-tree storage and queries — plus what NOT to add.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `time` crate | 0.3.45 (already locked) | All calendar-period math: derive year/month/ISO-week boundaries, parse/format `scheduled` dates, ISO-8601 week labels (`2026-W25`) | Already the engine's date library (`domain/recurrence.rs`, `domain/model.rs`). Ships first-class ISO-8601 week support — no extra crate needed. Pure, `no_std`-friendly, `const` methods. |
| `rusqlite` (bundled SQLite) | 0.32.1 (`libsqlite3-sys` 0.30, SQLite 3.46+) | Goal-tree storage and rollup/descendant queries via **recursive CTEs** | Already the storage adapter. Bundled SQLite is modern; recursive CTEs (`WITH RECURSIVE`) have been stable since SQLite 3.8.3 (2014). `prepare`/`query_map` pass arbitrary SQL straight through. |
| Existing `parent_id` adjacency list | n/a (schema already present) | Represent the goal/sub-goal/task tree | `items.parent_id TEXT REFERENCES items(id)` already exists (`sqlite/schema.rs:29`). No schema migration for the tree shape. Level-skipping (month → task) is naturally expressible. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `time` features `parsing`/`formatting`/`macros` | already enabled | Parse `"2026-06-01"` into `Date`, format period keys | Already enabled in `Cargo.toml`. Reuse `format_description!` / `format_description::parse` (pattern `[year]-[month]-[day]`) exactly as `service/mod.rs:220` and `cli/markdown.rs:130` already do. |
| `serde` / `serde_json` | 1 | Serialize the new `Goal` item type + period DTOs through the existing API/CLI | Already the serialization path for all DTOs; the `Goal` variant rides existing infrastructure. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `cargo test` (layered unit/integration/e2e) | Lock period-math + tree-query behavior | Add unit tests for boundary helpers under `tests/unit/` (use `time::macros::date!` like `tests/unit/recurrence.rs`). Assert ISO-week edge cases (W53 years, Dec/Jan year-boundary weeks). |
| `cargo clippy -D warnings` | Lint gate | Period math has many `u8`/`i32` casts (see `recurrence.rs`); keep clippy green. |

## Period / Calendar Math — Prescriptive `time` 0.3 API Guide

All of the following are **verified against `docs.rs/time/0.3.45`** (current docs, not training data). All are `const fn`.

### Deriving period boundaries

**Year boundaries** — first day / last day of a year:
```rust
use time::{Date, Month};
let year_start = Date::from_calendar_date(year, Month::January, 1)?;   // YYYY-01-01
let year_end   = Date::from_calendar_date(year, Month::December, 31)?; // YYYY-12-31
```

**Month boundaries** — first/last day of a month (the engine already does this in `recurrence.rs:299-308`; reuse that pattern):
```rust
let month_start = Date::from_calendar_date(year, month, 1)?;
// last day: replace_day with the largest valid day, or the existing scan helper
let last = (28u8..=31).rev()
    .find(|d| Date::from_calendar_date(year, month, *d).is_ok())
    .unwrap();                       // matches existing last_day_of_month()
let month_end = Date::from_calendar_date(year, month, last)?;
```

**ISO-week boundaries** — this is the key new capability. Use the ISO-week-date round-trip:
```rust
use time::{Date, Weekday};
// From any date, get its ISO (year, week, weekday):
let (iso_year, iso_week, _wd) = some_date.to_iso_week_date();   // -> (i32, u8, Weekday)
// Monday that starts that ISO week:
let week_start = Date::from_iso_week_date(iso_year, iso_week, Weekday::Monday)?;
// Sunday that ends it:
let week_end   = Date::from_iso_week_date(iso_year, iso_week, Weekday::Sunday)?;
```
> **Critical:** use `to_iso_week_date()` / `from_iso_week_date()`, **not** `iso_week()` alone. `iso_week()` returns only the week number (`u8`, 1..=53) and loses the *ISO year*, which diverges from the calendar year near Jan 1 / Dec 31 (e.g. 2026-12-31 may belong to ISO week 53 of 2026, but 2027-01-01 may belong to ISO week 53 of 2026 as well). The ISO year from `to_iso_week_date()` is the correct key component.

### ISO-8601 week labels (`2026-W25`)

`time` has no built-in `2026-W25` formatter, but you compose it trivially and unambiguously from the ISO-week-date tuple:
```rust
let (iso_year, iso_week, _) = date.to_iso_week_date();
let label = format!("{iso_year:04}-W{iso_week:02}");          // "2026-W25"
```
Parse it back by splitting on `-W`, then `Date::from_iso_week_date(iso_year, week, Weekday::Monday)`. Keep this in one domain helper (e.g. `domain/period.rs`) so the format lives in exactly one place.

### Parsing / formatting `scheduled` dates

The engine **already** parses `scheduled`-style date-only strings with `[year]-[month]-[day]` (`service/mod.rs:220`, `cli/markdown.rs:130`). **Reuse that exact path** for goal anchoring and the date view — do not introduce a second date format. For the period key `(horizon, scheduled)`, normalize each goal's `scheduled` to the canonical period start (week → Monday `from_iso_week_date`, month → day 1, year → Jan 1) before storing, so identity comparisons are exact string matches.

### Date arithmetic

For stepping/range building, prefer `next_day()` / `previous_day()` (Option-returning, no overflow surprises) or the existing `Duration`-based arithmetic (`current += Duration::days(1)` as in `recurrence.rs:214`). `checked_add`/`saturating_add` with `time::Duration` are available if you want explicit overflow handling. Weekday math: `date.weekday().number_from_monday()` (1..=7) is already used (`recurrence.rs:242`); `number_days_from_monday()` (0..=6) is also available.

## Hierarchical Goal-Tree Storage & Queries — Prescriptive SQLite Guide

### Storage shape: keep the adjacency list

The existing `parent_id` adjacency list is the right model. **Do not add a closure table, nested-set, or materialized-path column** for v1:
- The tree is shallow and small (a personal planner: year → month → week → task, level-skipping allowed). Adjacency list + recursive CTE is more than fast enough.
- Closure tables and nested sets add write-time bookkeeping that would have to route through `TodoService` and the audit-event path — extra invariant surface for no measured benefit.
- Schema stays additive: only the `ItemType` enum gains `Goal`; no new tree column.

### Descendant query (goal subtree) — recursive CTE

Roll up a goal and everything decomposed under it (goals + tasks), with depth and a stable path for ordering. This pushes traversal into SQLite instead of the current in-memory filtering:
```sql
WITH RECURSIVE subtree(id, parent_id, depth, path) AS (
    SELECT id, parent_id, 0, printf('%08d/', rowid)
    FROM items
    WHERE id = ?1                       -- root goal id
  UNION ALL
    SELECT i.id, i.parent_id, s.depth + 1, s.path || printf('%08d/', i.rowid)
    FROM items i
    JOIN subtree s ON i.parent_id = s.id
)
SELECT i.*
FROM subtree s
JOIN items i ON i.id = s.id
ORDER BY s.path;                        -- pre-order (parents before children)
```

### Ancestor query (which period does this task roll up to?)

Walk *up* from a task to find its enclosing goals / horizon:
```sql
WITH RECURSIVE ancestors(id, parent_id, depth) AS (
    SELECT id, parent_id, 0 FROM items WHERE id = ?1   -- the task
  UNION ALL
    SELECT i.id, i.parent_id, a.depth + 1
    FROM items i
    JOIN ancestors a ON i.id = a.parent_id
)
SELECT i.* FROM ancestors a JOIN items i ON i.id = a.id
WHERE i.type = 'goal'
ORDER BY a.depth;
```

### Period view (week/month/year) — anchor + subtree

A period view starts from goals identified by `(horizon, scheduled)`, then expands each subtree. Two-step is clean:
1. Select root goals for the period:
   ```sql
   SELECT id FROM items
   WHERE type = 'goal' AND horizon = ?1 AND scheduled = ?2;  -- e.g. 'week', '2026-06-15'
   ```
2. Run the descendant CTE per root (or seed the CTE's base case with the whole set in one query using `IN (...)`).

### Date view (tasks by `scheduled`)

The date view is a flat range query — **no recursion needed**:
```sql
SELECT * FROM items
WHERE type = 'task' AND scheduled >= ?1 AND scheduled <= ?2
ORDER BY scheduled, created_at;
```
Because `scheduled` is stored as RFC-style `YYYY-MM-DD` TEXT, lexical `>=`/`<=` range comparison is correct (ISO date text sorts chronologically).

### Where this runs (architecture fit)

Put these CTE queries in `infrastructure/sqlite/` behind **new methods on the repository port** (`application/ports.rs`), exposed to `TodoService` query methods (`application/service/queries.rs`). The service stays the single read/mutation gateway; the CLI/API call the service, never the repo. This is consistent with the existing `list_items` port pattern. The in-memory test store (`ServiceStore::InMemory`) must implement the same traversal in Rust to keep CLI/API/service parity tests green — a simple `HashMap<parent_id, Vec<child>>` BFS mirrors the CTE.

### Indexing

Add an additive index on `items(parent_id)` (and optionally a composite `items(type, horizon, scheduled)`) to keep recursive joins and period lookups fast. `CREATE INDEX IF NOT EXISTS` fits the additive `init_schema()` convention (`sqlite/schema.rs`).

## Installation

No new crates. Confirm existing `time` features remain enabled in `todo-engine/Cargo.toml` (already present per `.planning/codebase/STACK.md`):
```toml
# todo-engine/Cargo.toml — already present, no change required
time = { version = "0.3", features = ["formatting", "parsing", "macros", "serde", "serde-well-known", "local-offset"] }
rusqlite = { version = "0.32", features = ["bundled"] }
```
Only additive schema/index changes via `init_schema()`:
```sql
CREATE INDEX IF NOT EXISTS idx_items_parent_id ON items(parent_id);
CREATE INDEX IF NOT EXISTS idx_items_period   ON items(type, horizon, scheduled);
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `time` 0.3 ISO-week-date round-trip | `chrono` crate | Never for this project — would duplicate the date library, bloat deps, and split formatting conventions. `time` already covers every period operation needed. |
| Adjacency list + recursive CTE | Closure table | Only if the tree grows large/deep AND descendant queries become a measured hot path AND you need O(1) subtree reads. Not v1. Adds write-path complexity. |
| Adjacency list + recursive CTE | Materialized path (`path` column) | Only if you need cheap prefix-range subtree reads without recursion. Not justified for a small personal-planner tree; adds a column to maintain on every move. |
| SQLite-side recursive CTE | App-side recursion in Rust | Acceptable for the **in-memory test store** (required for parity), and a fallback if a CTE proves awkward; but for the persistent store, push traversal into SQLite to avoid the existing in-memory-filtering concern at scale. |
| `format!("{y:04}-W{w:02}")` for week labels | `time` format-description string | `time` format descriptions don't expose ISO-week-year + week number as a single token cleanly; the explicit `format!` from `to_iso_week_date()` is clearer and verified-correct. Keep it in one helper. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `chrono` | Second date library = duplicated logic, larger build, inconsistent parsing/formatting vs. existing `time` code | `time` 0.3 (already in the stack) |
| `Date::iso_week()` alone for the week key | Drops the ISO *year*; wrong near Jan-1/Dec-31 week boundaries (W52/W53 spanning the calendar year) | `to_iso_week_date()` → `(iso_year, iso_week, weekday)` and `from_iso_week_date(iso_year, week, Weekday::Monday)` |
| New `period_key` schema column | Violates the locked decision; period identity is `(horizon, scheduled)` over existing fields | Normalize `scheduled` to the canonical period start and key on `(horizon, scheduled)` |
| Closure table / nested-set / `ltree`-style column | Over-engineering for a small shallow tree; adds write-path bookkeeping that must thread through `TodoService` + audit events | `parent_id` adjacency list + `WITH RECURSIVE` |
| A second date string format for goals | The engine already standardizes on `YYYY-MM-DD` (`[year]-[month]-[day]`); two formats = parse bugs | Reuse the existing `parse_date`/`format_description` path |
| Direct repo writes/reads for tree ops bypassing the service | Breaks the core invariant (validation, state machine, audit event) | New query methods on the repository port, called via `TodoService` |

## Stack Patterns by Variant

**If period views must be fast on large datasets:**
- Push descendant/ancestor traversal into SQLite via the recursive CTEs above + `idx_items_parent_id`.
- Because: avoids the existing in-memory-filtering concern; SQLite resolves the tree in one statement.

**If keeping CLI/API/service parity tests green (always):**
- Mirror each CTE with a small Rust BFS/DFS over a `HashMap<Option<parent_id>, Vec<child>>` in `ServiceStore::InMemory`.
- Because: the e2e/integration suites assert in-memory and persistent stores agree; the persistent CTE result and the in-memory traversal must return identical ordering (use the same pre-order rule).

**If a goal spans an ISO-year boundary (W52/W53 edge):**
- Always derive and store the week key from `to_iso_week_date()` (ISO year + week), never from `year()` + `iso_week()`.
- Because: the calendar year and ISO week-year differ around Jan 1 / Dec 31; mixing them produces duplicate or missing weeks.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `time` 0.3.45 | edition 2024, current stable Rust | ISO-week-date methods (`to_iso_week_date`, `from_iso_week_date`) are stable in all 0.3.x; verified on 0.3.45 docs. All cited methods are `const fn`. |
| `rusqlite` 0.32.1 | `libsqlite3-sys` 0.30 / bundled SQLite 3.46+ | Recursive CTEs supported since SQLite 3.8.3 (2014); fully available. `prepare`/`query_map` pass arbitrary SQL. |
| `parent_id` adjacency + recursive CTE | existing `items` schema | No migration for the tree shape; only additive `Goal` enum value + indexes. |

## Sources

- docs.rs/time/0.3.45/time/struct.Date.html — verified `iso_week`, `to_iso_week_date`, `from_iso_week_date`, `monday_based_week`, `sunday_based_week`, `weekday`, `to/from_calendar_date`, `replace_day/month`, `next_day/previous_day`, `checked_add/saturating_add` (all `const`). **HIGH**
- docs.rs/rusqlite/0.32.1/rusqlite/struct.Connection.html — `prepare`/`query_map` pass arbitrary SQL; bundled via `libsqlite3-sys` 0.30. **HIGH**
- SQLite docs (lang_with.html) — `WITH RECURSIVE` stable since 3.8.3; standard tree-traversal idiom. **HIGH** (well-established)
- Local codebase: `todo-engine/src/domain/recurrence.rs`, `domain/model.rs`, `application/service/mod.rs`, `application/service/queries.rs`, `infrastructure/sqlite/{schema,mapping,repo}.rs`, `Cargo.lock` — confirmed in-use `time`/`rusqlite` APIs, `parent_id`/`scheduled`/`horizon` columns, existing date-parse path. **HIGH**

---
*Stack research for: hierarchical period-goal planning layer (fixed Rust/SQLite/axum stack)*
*Researched: 2026-06-22*
