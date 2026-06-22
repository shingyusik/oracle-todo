# Phase 1: Domain + Schema Foundation - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning

<domain>
## Phase Boundary

The engine recognizes a `Goal` item type and gains **one** canonical, tested way to anchor any date to its period (year / month / week). This is the lowest-leverage, highest-blast-radius code — locked before any view reads it.

**In scope:**
- New `Goal` variant on the `ItemType` enum (`as_str` / `FromStr` / serde, mirroring existing variants), round-tripping through the SQLite `type` column.
- A pure `Horizon` enum (year/month/week) with `as_str` / `FromStr` and a coarser-than ordering method, living in `domain/` (no I/O).
- A pure period-anchor normalization helper (the LYNCHPIN): given a `time::Date`, return the canonical period-start date for a horizon, plus a way to tell whether a date is already canonical.
- Additive `init_schema()` indexes for planning: `parent_id`, `scheduled`, and `(type, horizon, scheduled)`.

**Out of scope (this phase):**
- Goal creation / linking / validation policy — Phase 2 (`TodoService`).
- Rejecting non-canonical / unparseable input at the mutation boundary — Phase 2 consumes this phase's helper to do so.
- Any view (date / period) — Phases 3–4.
- A new `period_key` column, a separate `goals` table, `user_version` gating / backward-compat handling — locked OUT upstream.

</domain>

<decisions>
## Implementation Decisions

### Horizon levels
- **D-01:** `Horizon` enum has exactly three variants — `year`, `month`, `week` (stored as the strings `"year"` / `"month"` / `"week"` in the existing `horizon` TEXT column). Mirrors the `ItemType` `as_str` / `FromStr` pattern in `domain/model.rs`.
- **D-02:** Coarser-than ordering is **strict**: `year > month > week`. The enum exposes a strict comparison (e.g. `is_coarser_than` / `is_finer_than`) — NOT an inclusive (`_or_equal`) variant. See D-07 for why strict.
- **D-03:** `quarter` and `day` are deferred. Adding an enum variant later is additive and non-breaking, so no need to reserve them now. (See Deferred Ideas.)

### Period-anchor normalization (the LYNCHPIN helper)
- **D-04:** Behavior on a non-canonical date is **strict reject**, not auto-snap. A month goal dated the 15th is NOT silently snapped to the 1st.
- **D-05:** Because of D-04, the Phase 1 helper must expose **both** a normalize operation (`Date` → canonical period-start `Date`) **and** an is-canonical check (does the input already equal its normalized form?). Phase 2's service uses the is-canonical check to reject non-canonical anchors with a validation error; it does not silently rewrite the date.
- **D-06:** Week normalization snaps to the **true ISO Monday** of the date's week — "the Monday of the week this date falls in." This Monday may land in the **previous calendar year** (e.g. `2026-01-01` (Thu) → `2025-12-29` (Mon)). Do NOT clamp to Jan 1. This is the convention the W01 / W53 / Dec-31 / Jan-1 boundary unit tests (Roadmap SC1) must assert. Year → Jan 1; month → 1st of month.

### Parent-horizon rule (defined here, enforced in Phase 2)
- **D-07:** A goal may only nest under a **strictly coarser** horizon. Same-horizon nesting (month under month, week under week) is **forbidden**. Level-skipping remains allowed (year → week directly, skipping month). This is why D-02's ordering method is strict: Phase 2's parent check is "parent horizon is strictly coarser than child horizon." (Tasks are not goals and carry no horizon, so a task may link under a goal at any level — that is a Phase 2 LINK concern, not constrained by this ordering.)

### Schema (additive only — locked, restated for the planner)
- **D-08:** Add indexes only: `idx_items_parent_id` on `parent_id`, `idx_items_scheduled` on `scheduled`, and a composite `(type, horizon, scheduled)`. No dropped/rewritten columns, no `period_key` column. The `horizon` column already exists (reserved/unused) — no `ALTER TABLE` needed for it. Verify on a copied data home (never the live `~/.todo-engine/todo.sqlite`).

### Claude's Discretion
- Exact helper module location/name (e.g. `domain/horizon.rs` vs. extending `model.rs`), exact method names, and whether the helper takes/returns `time::Date` vs. a thin wrapper — implementation detail for the planner. Note `domain/recurrence.rs` already operates on `time::Date` and computes `weekday_index` via `number_from_monday()` — reuse that idiom for the ISO-Monday snap.
- String→`Date` parsing location: parsing (and rejecting unparseable input) lives at the Phase 2 mutation boundary; the Phase 1 helper operates on an already-parsed `time::Date`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` § "Phase 1: Domain + Schema Foundation" — Goal, depends-on, the 4 Success Criteria (W01/W53/Dec-31/Jan-1 boundary tests, additive index list).
- `.planning/REQUIREMENTS.md` — **GOAL-02** (anchor normalization: year=Jan 1, month=1st, week=ISO Monday) and **CORE-02** (additive only; no `period_key`). These two requirements map to this phase.
- `.planning/PROJECT.md` § "Key Decisions" + § "Constraints" — `Goal` as `ItemType`, period identity `(horizon, scheduled)`, additive schema, data-home safety, period-anchor LYNCHPIN.

### Data model & architecture (locked invariants)
- `README.md` — authoritative data model: item types, `items` columns, status lifecycle. Read before touching the schema or the `ItemType` enum.
- `docs/architecture/layers.md` — per-file layer breakdown + `pub(super)` visibility convention (the `Horizon` helper is pure `domain/`, no I/O).
- `docs/operations/data-home.md` + `docs/operations/verification-and-smoke.md` — data-home resolution and the copy-to-temp-home smoke procedure for the index migration check (SC4).

### Existing code this phase extends
- `todo-engine/src/domain/model.rs` — `ItemType` enum + `as_str`/`FromStr` pattern to mirror for `Goal`; `TodoItem.horizon: Option<String>` field (reserved consumer).
- `todo-engine/src/domain/recurrence.rs` — existing pure date-math idioms (`weekday_index` via `number_from_monday()`, month/year helpers) to reuse for the anchor helper.
- `todo-engine/src/infrastructure/sqlite/schema.rs` — `init_schema_inner` index block + `ensure_item_columns` additive pattern; add the new indexes here.
- `todo-engine/src/infrastructure/sqlite/mapping.rs` — `parse_item_type` / `item_type_sqlite_value` round-trip path the `goal` row must pass (SC3).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`ItemType` enum + `as_str`/`FromStr`/serde** (`domain/model.rs:9-17,143-172`): exact template for adding `Goal` and for the new `Horizon` enum's string mapping.
- **`domain/recurrence.rs` date math**: `weekday_index(date) = number_from_monday() - 1`, `first_of_month`, `last_day_of_month`, `date(...)` constructors — pure, `time::Date`-based; reuse for ISO-Monday / month-1st / Jan-1 anchoring.
- **`init_schema` index block** (`schema.rs:72-89`): `CREATE INDEX IF NOT EXISTS` pattern + `ensure_item_columns` additive backfill — add planning indexes alongside, no destructive change.

### Established Patterns
- **Pure domain, no I/O**: `domain/` does no I/O (`recurrence.rs` is the precedent). The `Horizon` enum + anchor helper belong here and stay side-effect-free.
- **`horizon` is `Option<String>` in storage, typed at domain boundary**: keep the SQLite column as TEXT; convert to/from `Horizon` enum in domain logic. No schema column type change.
- **Round-trip via `mapping.rs`**: `type` column ↔ `ItemType` through `parse_item_type` / `item_type_sqlite_value`; adding `Goal` to both enum mappings makes the `goal` row round-trip for free.

### Integration Points
- `ItemType::Goal` → `as_str`/`FromStr` (`model.rs`) → SQLite `type` column via `mapping.rs` (SC3 round-trip).
- New indexes → `init_schema_inner` (`schema.rs`); idempotent `IF NOT EXISTS`, applies to existing data homes (SC4).
- `Horizon` enum + helper → consumed in Phase 2 (`TodoService` validation) and Phases 3–4 (views); nothing in Phase 1 mutates state.

</code_context>

<specifics>
## Specific Ideas

- Week-start convention (ISO Monday) must be **documented next to the helper** and recorded as a Key Decision (Roadmap SC2) so no later view can bucket the same period two ways.
- Boundary unit tests are explicitly required at year edges: ISO week W01 and W53, Dec 31, Jan 1 (Roadmap SC1).

</specifics>

<deferred>
## Deferred Ideas

- **`quarter` horizon** — OKR-style quarterly planning. Adding a `Horizon` variant later is additive; revisit as its own scope if quarterly goals are wanted. (Out of v1 requirements.)
- **`day` horizon for goals** — day-level granularity is already served by task `scheduled` dates + the date view (Phase 3); a `day` goal horizon would overlap in meaning. Deferred / likely unnecessary.
- **Auto-snap (forgiving) date input** — explicitly rejected for v1 (D-04). If user-experience friction emerges, a CLI/API "snap with warning" affordance could be reconsidered later, but the engine stays strict.

</deferred>

---

*Phase: 1-Domain + Schema Foundation*
*Context gathered: 2026-06-22*
