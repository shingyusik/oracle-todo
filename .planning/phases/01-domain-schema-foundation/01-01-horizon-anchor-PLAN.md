---
phase: 01-domain-schema-foundation
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - todo-engine/src/domain/horizon.rs
  - todo-engine/src/domain/mod.rs
  - todo-engine/tests/unit/horizon.rs
  - todo-engine/tests/unit.rs
autonomous: true
requirements: [GOAL-02]
must_haves:
  truths:
    - "A valid date normalizes to its canonical period start: year -> Jan 1, month -> 1st, week -> ISO Monday (GOAL-02, D-06)."
    - "Week normalization snaps to the TRUE ISO Monday and may land in the previous calendar year (2026-01-01 Thu -> 2025-12-29 Mon); it is NOT clamped to Jan 1 (D-06)."
    - "An is-canonical check answers whether a date already equals its normalized form, enabling Phase 2 to strict-reject without auto-snap (D-04, D-05)."
    - "Horizon exposes a STRICT coarser-than ordering (year > month > week) via a method, with no _or_equal variant and no Ord impl (D-02, D-07)."
    - "The ISO-Monday week-start convention is documented next to the helper as a Key Decision so no later view buckets a period two ways (SC2)."
  artifacts:
    - path: "todo-engine/src/domain/horizon.rs"
      provides: "Horizon enum (Year/Month/Week), is_coarser_than, the period-anchor normalize + is-canonical helper, ISO-Monday doc comment"
      contains: "pub enum Horizon"
      min_lines: 60
    - path: "todo-engine/src/domain/mod.rs"
      provides: "module wiring + public re-export of Horizon and the anchor helper"
      contains: "horizon"
    - path: "todo-engine/tests/unit/horizon.rs"
      provides: "boundary unit tests at year edges (W01, W53, Dec 31, Jan 1) + strict-reject is-canonical cases (SC1)"
      contains: "Horizon"
      min_lines: 40
    - path: "todo-engine/tests/unit.rs"
      provides: "registration of the new horizon unit-test module in the unit test binary"
      contains: "horizon"
  key_links:
    - from: "todo-engine/src/domain/mod.rs"
      to: "todo-engine/src/domain/horizon.rs"
      via: "mod horizon; pub use horizon::{Horizon, ...}"
      pattern: "pub use horizon"
    - from: "todo-engine/tests/unit/horizon.rs"
      to: "todo_engine::domain::Horizon"
      via: "use todo_engine::domain::..."
      pattern: "use todo_engine::domain"
    - from: "todo-engine/tests/unit.rs"
      to: "todo-engine/tests/unit/horizon.rs"
      via: "#[path = ...] mod horizon;"
      pattern: "unit/horizon.rs"
---

<objective>
Establish the LYNCHPIN of the entire planning milestone: one canonical, tested, pure way to anchor any date to its period. Add a `Horizon` enum (year/month/week) with a strict coarser-than ordering, and a pure period-anchor helper on `time::Date` that exposes BOTH a normalize operation (Date -> canonical period start) and an is-canonical check, with year-boundary correctness proven by unit tests.

This implements GOAL-02 (anchor normalization: year = Jan 1, month = 1st, week = ISO Monday) and locks D-01, D-02, D-04, D-05, D-06, D-07. It satisfies Phase 1 Success Criteria SC1 (boundary tests) and SC2 (documented ISO-Monday convention). Phase 2 consumes the is-canonical check to strict-reject non-canonical anchors (D-04) without auto-snapping.

Purpose: This is the lowest-leverage, highest-blast-radius code in the milestone. Every later view buckets periods through this one helper; if two callers disagree on the week start, the whole period model fractures. Lock and document it now, before anything reads it.
Output: `todo-engine/src/domain/horizon.rs` (new), wired in `domain/mod.rs`; boundary unit tests in `tests/unit/horizon.rs`, registered in `tests/unit.rs`.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
@$HOME/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/01-domain-schema-foundation/01-CONTEXT.md
@.planning/phases/01-domain-schema-foundation/01-PATTERNS.md

# Analogs to mirror exactly (read before writing):
@todo-engine/src/domain/recurrence.rs
@todo-engine/src/domain/model.rs
@todo-engine/src/domain/mod.rs
@todo-engine/tests/unit/recurrence.rs
@todo-engine/tests/unit.rs
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create the Horizon enum + period-anchor helper in domain/horizon.rs</name>
  <files>todo-engine/src/domain/horizon.rs, todo-engine/src/domain/mod.rs</files>
  <read_first>
    - todo-engine/src/domain/recurrence.rs — reuse the I/O-free date idioms: local `date(year, Month, day)` constructor (recurrence.rs:310-312), `first_of_month` (recurrence.rs:299-301), `weekday_index` via `number_from_monday() - 1` (recurrence.rs:241-243), imports `use time::{Date, Duration, Month};` (recurrence.rs:3). These helpers are private to recurrence.rs — re-implement them locally in horizon.rs rather than making them `pub`.
    - todo-engine/src/domain/model.rs:7-17,143-172 — the `ItemType` enum + `as_str` + `FromStr` string-mapping idiom to mirror for `Horizon`.
    - todo-engine/src/domain/mod.rs:1-7 — the `mod` + `pub use` wiring convention (`recurrence` is `pub mod`; `model`/`status` are private with re-exports).
  </read_first>
  <behavior>
    - normalize(date!(2027-03-15), Horizon::Year) == date!(2027-01-01)        # year -> Jan 1
    - normalize(date!(2027-03-15), Horizon::Month) == date!(2027-03-01)        # month -> 1st
    - normalize(date!(2026-06-24) /* Wed */, Horizon::Week) == date!(2026-06-22) /* Mon */  # week -> ISO Monday
    - normalize(date!(2026-01-01) /* Thu */, Horizon::Week) == date!(2025-12-29) /* Mon, PRIOR YEAR */  # NOT clamped to Jan 1 (D-06)
    - normalizing an already-canonical date is idempotent: normalize(normalize(d, h), h) == normalize(d, h)
    - is_canonical(date!(2025-12-29), Horizon::Week) == true   # already an ISO Monday
    - is_canonical(date!(2027-03-15), Horizon::Month) == false # 15th is not the 1st (D-04 strict)
    - Horizon::Year.is_coarser_than(Horizon::Month) == true; Horizon::Month.is_coarser_than(Horizon::Week) == true; Horizon::Year.is_coarser_than(Horizon::Week) == true
    - Horizon::Week.is_coarser_than(Horizon::Year) == false; Horizon::Month.is_coarser_than(Horizon::Month) == false  # strict, no equality (D-02)
    - "year".parse::<Horizon>().unwrap() == Horizon::Year; "folder".parse::<Horizon>() is Err
  </behavior>
  <action>
    Create `todo-engine/src/domain/horizon.rs` as a pure, I/O-free `domain/` module (precedent: recurrence.rs; the architecture test forbids any reference to `crate::application`, `crate::infrastructure`, `crate::interfaces`, `rusqlite`, `axum`).

    (1) Define `pub enum Horizon { Year, Month, Week }` with `#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]` and `#[serde(rename_all = "lowercase")]` per D-01 (mirrors `ItemStatus`). Add `as_str(self) -> &'static str` (exhaustive match: `Year => "year"`, `Month => "month"`, `Week => "week"` — NO wildcard arm, let the compiler enforce completeness) and `impl FromStr` mirroring model.rs:160-169 (`value.trim()`, lowercase keys, `Err(format!("unknown horizon: {value}"))`).

    (2) Add the STRICT coarser-than ordering per D-02 and D-07: a private `rank(self) -> u8` (Year=0, Month=1, Week=2) and `pub fn is_coarser_than(self, other: Horizon) -> bool { self.rank() < other.rank() }`. Do NOT implement `Ord`/`PartialOrd` and do NOT add an `_or_equal` variant — strict semantics only (D-02). Document on the method that year is coarser than month is coarser than week and that equality is NOT coarser (Phase 2's parent check is "parent strictly coarser than child", D-07).

    (3) Add the period-anchor helper operating on already-parsed `time::Date` (parsing is Phase 2's job). Expose BOTH operations required by D-05. Use free functions re-exported from the module (choose names; suggested `normalize_to_period_start(date: Date, horizon: Horizon) -> Date` and `is_period_start(date: Date, horizon: Horizon) -> bool`). Implement:
      - Year: `date(d.year(), Month::January, 1)` (copy recurrence.rs:282 + the local `date()` ctor recurrence.rs:310-312).
      - Month: `date(d.year(), d.month(), 1)` (mirror recurrence.rs:299-301 `first_of_month`).
      - Week: snap to the ISO Monday of the date's week. Re-implement `weekday_index(date) = date.weekday().number_from_monday() as i32 - 1` (recurrence.rs:241-243), then `monday = d - Duration::days(weekday_index(d) as i64)`. This may land in the prior calendar year — do NOT clamp to Jan 1 (D-06).
      - is-canonical: `is_period_start(d, h)` returns `normalize_to_period_start(d, h) == d` (D-05). Phase 2 uses this to strict-reject (D-04); it never auto-snaps.

    (4) SC2 documentation requirement: add a doc comment next to the week branch (and/or the helper) stating the locked convention: "Week start = ISO Monday. The Monday of a date's week may fall in the previous calendar year; the engine does NOT clamp to Jan 1. This is the single canonical period-start convention — no view may bucket a period two ways." This is a Key Decision (Roadmap SC2); also record it in the SUMMARY's decisions.

    (5) Wire the module in `todo-engine/src/domain/mod.rs`: add `mod horizon;` and `pub use horizon::{Horizon, normalize_to_period_start, is_period_start};` (match the actual fn names chosen). The existing `pub use model::{... ItemType ...}` line already re-exports `ItemType` and needs no change here.

    Re-implement (do NOT make pub) the borrowed recurrence.rs helpers locally in horizon.rs so the module is self-contained. Keep all logic side-effect-free.
  </action>
  <verify>
    <automated>cargo build -p todo-engine && cargo clippy --all-targets --all-features -- -D warnings</automated>
  </verify>
  <done>horizon.rs compiles, exports `Horizon` + the two anchor functions, clippy is clean (warnings-as-errors), and the module is re-exported from `domain/mod.rs` on the public `todo_engine::domain` path. The week branch carries the ISO-Monday doc comment (SC2).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Boundary unit tests for the anchor helper (SC1)</name>
  <files>todo-engine/tests/unit/horizon.rs, todo-engine/tests/unit.rs</files>
  <read_first>
    - todo-engine/tests/unit/recurrence.rs:1-16 — the unit-test idiom: separate test binary file, `use time::macros::date;`, import via `todo_engine::domain::...`, plain `#[test]` fns (NOT inline `#[cfg(test)] mod tests`).
    - todo-engine/tests/unit.rs — the `#[path = "unit/<file>.rs"] mod <name>;` registration list the new file must join.
  </read_first>
  <behavior>
    - Year boundary: normalize(date!(2026-12-31), Horizon::Year) == date!(2026-01-01); normalize(date!(2027-01-01), Horizon::Year) == date!(2027-01-01)
    - Month boundary: normalize(date!(2026-01-31), Horizon::Month) == date!(2026-01-01); normalize(date!(2026-12-01), Horizon::Month) == date!(2026-12-01)
    - ISO W01 / cross-year Monday: normalize(date!(2026-01-01) /* Thu */, Horizon::Week) == date!(2025-12-29) /* Mon, prior year */
    - ISO W53 region: normalize(date!(2026-12-31) /* Thu */, Horizon::Week) == date!(2026-12-28) /* Mon */
    - Jan 1 that IS a Monday stays put: normalize(date!(2024-01-01) /* Mon */, Horizon::Week) == date!(2024-01-01)
    - is-canonical strict-reject: is_period_start(date!(2026-03-15), Horizon::Month) == false; is_period_start(date!(2025-12-29), Horizon::Week) == true
    - coarser-than ordering: all 3 strict-true pairs hold; reflexive and reversed pairs are false
  </behavior>
  <action>
    Create `todo-engine/tests/unit/horizon.rs` mirroring `tests/unit/recurrence.rs`. Import `use time::macros::date;` and `use todo_engine::domain::{Horizon, normalize_to_period_start, is_period_start};` (match the fn names from Task 1). Write `#[test]` functions covering EVERY case in the behavior block above — the Roadmap SC1 boundary set is mandatory: ISO week W01, W53, Dec 31, Jan 1, PLUS the cross-year-Monday case (2026-01-01 Thu -> 2025-12-29 Mon) and the Jan-1-is-a-Monday case. Also cover year->Jan 1, month->1st, the is-canonical strict-reject (month 15th is NOT canonical), and the strict `is_coarser_than` ordering. Use `date!(YYYY-MM-DD)` literals so the expected ISO Monday is explicit and reviewable.

    Register the file in `tests/unit.rs`: add `#[path = "unit/horizon.rs"] mod horizon;` alongside the existing entries (keep the list alphabetically ordered to match the file's convention).
  </action>
  <verify>
    <automated>cargo test -p todo-engine --test unit horizon</automated>
  </verify>
  <done>The unit test binary builds with the new module registered, and every boundary/ordering test passes — proving year/month/week normalization (including the cross-year ISO Monday, D-06) and the strict is-canonical check (D-04/D-05) are correct. SC1 satisfied.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (none crossed in this plan) | Pure in-process `domain/` logic operating on already-parsed `time::Date`. No network, no untrusted external input, no I/O. String->Date parsing and the mutation boundary are Phase 2. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-01 | Tampering | `normalize_to_period_start` week branch | mitigate | A wrong ISO-Monday rule silently buckets periods two ways downstream. Boundary unit tests (Task 2) pin W01/W53/Dec-31/Jan-1 + the cross-year Monday; the convention is documented as a Key Decision (SC2). |
| T-01-02 | Information disclosure / Repudiation | `domain/horizon.rs` purity | accept | Domain layer does no I/O and logs nothing; the `domain_has_no_outward_dependencies` architecture test enforces no `rusqlite`/`axum`/outer-layer references. No surface to disclose. |
</threat_model>

<verification>
- `cargo build -p todo-engine` — compiles with the new `Horizon` exhaustive-match (no wildcard) enforcing completeness.
- `cargo clippy --all-targets --all-features -- -D warnings` — clean.
- `cargo test -p todo-engine --test unit` — all unit tests pass, including the new `horizon` module and the existing `architecture` purity test (confirms horizon.rs stays I/O-free).
- `cargo fmt --check` — formatted.
</verification>

<success_criteria>
- SC1: Boundary unit tests prove year/month/week normalization correct at W01, W53, Dec 31, Jan 1, including the cross-year ISO Monday (2026-01-01 -> 2025-12-29).
- SC2: The ISO-Monday week-start convention is documented next to the helper and recorded as a Key Decision in the SUMMARY.
- (SC3 ordering dependency): `Horizon::is_coarser_than` exposes the strict coarser-than ordering Phase 2's parent rules will use (D-02, D-07).
</success_criteria>

<output>
Create `.planning/phases/01-domain-schema-foundation/01-01-SUMMARY.md` when done. Record as a Key Decision: "Week start = ISO Monday; normalization may land in the prior calendar year; engine never clamps to Jan 1 and never auto-snaps (strict reject is Phase 2)." List artifacts: `Horizon` enum (Year/Month/Week), `Horizon::as_str`/`FromStr`, `Horizon::is_coarser_than`, and the two anchor fns (record their final names), the new module path `todo_engine::domain::horizon`.
</output>
