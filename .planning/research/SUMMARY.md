# Project Research Summary

**Project:** todo-engine - Planning Layer
**Domain:** Hierarchical period-goal planning layer (year/month/week goals -> top-down task decomposition -> date views) on an existing local-first Rust/SQLite ToDo engine
**Researched:** 2026-06-22
**Confidence:** HIGH

## Executive Summary

This is a brownfield, subsequent milestone: a planning layer grafted onto a mature clean/hexagonal Rust engine (`todo-engine`). The stack is fixed (Rust 2024, rusqlite/bundled SQLite, axum 0.7, clap 4.5, `time` 0.3) and the architecture is fixed - research did not re-litigate either. Instead all four dimensions converged on the same conclusion: the planning layer is a **thin vertical feature slice** across the four existing rings that introduces **no new ring, no new mutation path, and no new schema column**. The decided design is locked in PROJECT.md: a new `Goal` `ItemType` (not a separate table), period identity expressed as the `(horizon, scheduled)` pair over existing columns, flexible `parent_id` nesting with level-skipping allowed, task->goal linking via `parent_id` + a `scheduled` date, backend + CLI + API scope this milestone, and progress rollup deferred to v2. Goals reuse the existing `ItemStatus` lifecycle, approval gating, and mandatory audit events for free - the real differentiator versus OKR/consumer todo tools, at near-zero cost.

The single highest-leverage design detail, flagged independently by both Features and Architecture as the cross-cutting **LYNCHPIN**, is **period-anchor normalization**: there must be exactly one canonical `scheduled` value per period (week -> ISO Monday, month -> day 1, year -> Jan 1), and the **week-start convention (Monday vs Sunday) must be locked before any view is built**. Anchoring, period-uniqueness, list-filtering by period, and period views all silently break if "the month of June" can map to two different `scheduled` strings. This is low code but high blast radius, so it belongs in one domain helper (`domain/horizon.rs` / a `period_of` helper) used by every anchor and every view bucket.

The top risks (from Pitfalls) cluster at the two ends of the build: the **schema/model phase carries the one-way decisions** - `scheduled` is today an unvalidated free-form string (silent data loss in views if reused as-is), and adding `Goal` to the `ItemType` enum is a one-way *data*-format change that older/concurrent binaries cannot read (the `user_version` gate exists but is unread). The **period-view phase carries the performance risk** - recursive goal-tree rollup done the naive way (`list_items` per node) amplifies the pre-existing full-table-scan debt in CONCERNS.md into O(N x goals). Between them sit graph-validation hazards on `parent_id` (cycles, cross-period/wrong-horizon parents, orphans - no validation exists today), ISO-week year-boundary math (W53 years, Jan-1/Dec-31 cross-year week ownership), and the pre-existing today/pending CLI/API parity gap that the new views must not copy. Mitigation is consistent across all dimensions: keep **all** policy in `TodoService`, validate `scheduled` strictly at write time, centralize week math in one helper, carry a visited-set + depth cap on every tree walk, and add a paired e2e CLI+API test for every new command.

## Key Findings

### Recommended Stack

The stack is fixed and adequate - **no new crates**. Research prescribes the *techniques within the existing stack*: `time` 0.3 ISO-week-date round-trip for period math, `rusqlite` recursive CTEs (or single-load + in-memory tree) for goal-tree traversal over the existing `parent_id` adjacency list, and additive *indexes only* (no new column) via `init_schema()`. See [STACK.md](STACK.md).

**Core technologies:**
- `time` 0.3.45: all calendar-period math - use `to_iso_week_date()` / `from_iso_week_date()` (carries the ISO *year*, correct at boundaries), **never** `iso_week()` alone; reuse the existing `parse_day` / `[year]-[month]-[day]` path - do not add a second date format.
- `rusqlite` (bundled SQLite 3.46+): goal-tree descendant/ancestor queries via `WITH RECURSIVE`; mirror the same traversal in the in-memory test store for parity. Add additive indexes `idx_items_parent_id`, `idx_items_scheduled`, `idx_items_type_horizon_scheduled`.
- Existing `parent_id` adjacency list: the tree shape - no closure table / nested-set / materialized-path / `period_key` column (over-engineering for a small shallow personal-planner tree; would fork the mutation path).

### Expected Features

The feature set maps 1:1 to PROJECT.md Active requirements; OKR / GTD-Horizons / time-horizon-cascade methodologies all reduce to the same `(horizon, scheduled)` + `parent_id` model. See [FEATURES.md](FEATURES.md).

**Must have (table stakes - v1, all P1):**
- `Goal` ItemType + additive schema (cheapest feature; hooks already exist) - without it nothing else exists
- Period anchoring via `(horizon, scheduled)` + the **normalization rule** (LYNCHPIN) - makes a goal addressable by period
- Flexible goal nesting via `parent_id`, cycle-safe - the top-down decomposition structure
- Task->goal link via `parent_id` + `scheduled` - connects work to goals and to dates
- List filter by horizon / period / parent - the read primitive views compose
- Date view (group by `scheduled`, day + range) - half of Core Value; generalizes existing `today`
- Period view (goal tree for week/month/year, **structure only, no rollup**) - the other half
- CLI subcommands + HTTP API parity - the milestone's required surface (parity is an invariant, not optional)

**Should have (competitive - v1.x, ride entirely on v1 reads):**
- Unscheduled / "inbox" surfacing within a goal - surfaces planned-but-undated tasks
- Coverage view: goals in a period with zero linked tasks - flags the #1 period-planning failure mode
- Agenda spanning `scheduled` + `due` - richer day view over two existing columns

**Defer (v2+):**
- Progress rollup / completion-% - explicitly out of scope; design the tree-read so it's a pure additive computation later
- Numeric Key Results / metric targets; period rollover / carry-forward; health/at-risk derived signals; frontend calendar UI / NLP dates

### Architecture Approach

A vertical slice touching existing files in place plus exactly **one new domain file** (`domain/horizon.rs`, pure). Views are computed in `application/service/queries.rs` so CLI and API render identical results; interfaces only render. All goal create/link flows through `store_item_and_event` (single mutation path + mandatory audit). See [ARCHITECTURE.md](ARCHITECTURE.md).

**Major components:**
1. `domain/horizon.rs` (NEW, pure) - `Horizon{Year,Month,Week}` enum, `is_coarser_than`, `validate_period_start` / `period_of` (the normalization LYNCHPIN lives here), `from_item`/`from_str`.
2. `domain/model.rs` - `ItemType::Goal` variant + the two `as_str`/`FromStr` arms (keep in sync; no exhaustiveness guard beyond these).
3. `application/service/` - `ProposeGoal` + `propose_goal` (creation.rs), `ensure_parent` cross-item validation helper (mod.rs), `date_view`/`period_view` + `PeriodView` return type (queries.rs), `ListFilter` += `parent_id`/`horizon`/`scheduled` (ports.rs), `parent_id` on `UpdateItem` for linking.
4. `infrastructure/sqlite/schema.rs` - additive indexes only (no column); mapping likely unchanged.
5. `interfaces/cli/` + `interfaces/api/` - `goal` subcommand + `date`/`week`/`month`/`year` views; mirrored API routes calling the SAME service methods.

### Critical Pitfalls

1. **Unvalidated `scheduled` string** - today it is free-form `Option<String>`, never validated on write, and the one reader fails *closed* (silently drops unparseable values). Reused as a load-bearing period anchor this becomes silent data loss. Validate strictly with `parse_day` at the service write path; reject the `"today"` sentinel for goals; normalize to the canonical anchor per horizon.
2. **`Goal` enum as a one-way DB change (downgrade hazard)** - a `goal`-typed row makes any binary that doesn't know `goal` fail to load the *whole table* (strict `from_str` on the read path). Treat shipping the enum value as a real version bump: read/check `user_version`, fail loudly, and test loading a `goal` row through `mapping.rs`.
3. **`parent_id` graph validation** - no cycle, horizon-containment, or orphan checks exist. Add a `validate_parent`/`ensure_parent` service check (parent is a non-terminal coarser-horizon `Goal`, no cycle) and always carry a `visited` set + depth cap on every tree walk as a backstop against pre-existing bad data.
4. **Recursive rollup amplifying full-table-scan debt** - naive "`list_items` per goal" turns an O(N) view into O(N x goals). Load the period working set **once**, build the parent->children map, walk it in memory; push a `WHERE` predicate into SQL where possible.
5. **ISO-week year-boundary math + locked week-start** - W53 years and Jan-1/Dec-31 cross-year week ownership corrupt grouping if week is computed ad hoc. One `period_of`/`week_anchor` helper, ISO-Monday convention (matches existing Monday=0 weekday math), unit-tested at W01/W53/Dec31/Jan1. **Lock Monday vs Sunday before building views.**
6. **CLI/API parity drift + pre-existing today/pending gap** - the existing `today`/`pending` view logic lives in `cli/markdown.rs` where the API can't reach it. Do NOT copy that pattern: put `date_view`/`period_view` in the service, and add a paired e2e CLI+API test for every new command.

## Implications for Roadmap

Based on research, the suggested phase structure is the **bottom-up build order all four dimensions converged on**: domain -> schema -> service policy -> service views -> CLI -> API. Each layer compiles against a ready layer below; tests follow each step.

### Phase 1: Domain + Schema Foundation (the one-way decisions)
**Rationale:** Domain has no dependencies and unblocks everything; this phase carries the highest-leverage *one-way* decisions (Pitfalls 1, 2, 5). Get the LYNCHPIN and the version gate right here or pay later.
**Delivers:** `ItemType::Goal` (model.rs enum + both `as_str`/`FromStr` arms); new pure `domain/horizon.rs` with `Horizon` enum, `is_coarser_than`, and the `period_of`/`validate_period_start` normalization helper (**week-start = ISO Monday, locked**); additive indexes in `schema.rs` (no column); `user_version` read/check on load.
**Addresses:** Goal ItemType + additive schema; period-anchor normalization rule.
**Avoids:** Pitfall 2 (enum downgrade - `user_version` gate + `goal`-row load test), Pitfall 5 (ISO-week math - one helper, boundary unit tests), the foundation of Pitfall 1.

### Phase 2: Service Policy - Goal Create, Link, Validation
**Rationale:** Schema must exist before the service writes/reads goals; the service must exist before either adapter. This phase concentrates the policy that both adapters depend on.
**Delivers:** `ProposeGoal` + `propose_goal`; strict `scheduled` validation via `parse_day` (reject sentinels for goals, normalize to canonical anchor); `ensure_parent` (non-terminal coarser-horizon `Goal`, cycle-safe with visited set); period-uniqueness check on `(horizon, normalized_scheduled, parent_id)`; documented `ItemStatus` *meaning* for goals (no cascade to children in v1); `parent_id` on `UpdateItem` for task->goal linking; `ListFilter` += `horizon`/`parent_id`/`scheduled`.
**Uses:** existing `store_item_and_event`, `parse_day`, `ensure_relation` pattern, approval gating.
**Implements:** the single-mutation-path + audit invariant for the new surface.
**Avoids:** Pitfall 1 (unvalidated `scheduled`), Pitfall 3 (status semantics), Pitfall 4 (period uniqueness), Pitfall 5 (cycle/horizon-containment validation).

### Phase 3: Date View
**Rationale:** The cheaper, more directly testable half of Core Value; a flat range query, no recursion. Depends only on the link + filter primitives from Phase 2.
**Delivers:** `date_view(day | range)` in `service/queries.rs` - tasks grouped by `scheduled`, deterministic ordering, explicit buckets for `scheduled = null` and out-of-any-period tasks (never silently dropped).
**Avoids:** UX pitfalls (invisible undated/unplanned tasks), parity drift (logic in service, not CLI).

### Phase 4: Period View (goal-tree rollup, structure only)
**Rationale:** The other half of Core Value and the most complex read; depends on nesting + anchoring + linking + filter. **This is the phase most likely to need deeper performance research** because it collides with the pre-existing full-table-scan debt.
**Delivers:** `period_view(horizon, scheduled) -> PeriodView` - root goal at `(horizon, scheduled)` + descendant goals + their linked tasks, single-load + in-memory tree walk with visited set + depth cap; v1 ships structure only, no rollup.
**Avoids:** Pitfall 4/6 (per-node `list_items`), Pitfall 5 (safe traversal on cyclic/orphaned legacy data).

### Phase 5: CLI + API Surface (parity-locked)
**Rationale:** Adapters are independent siblings; build CLI first to validate the service shape, then mirror in the API. Parity is an enforced invariant.
**Delivers:** `goal` create/update + `date`/`week`/`month`/`year` view commands (Markdown/JSON); mirrored `POST /goals` + view `GET` endpoints calling the SAME service methods; paired e2e CLI+API tests for every command; agent-created goals verified to start `Proposed`.
**Avoids:** Pitfall 8 (parity drift - no policy in handlers, every command has both test twins).

### Phase Ordering Rationale
- **Dependency-driven bottom-up:** every dimension (STACK "where this runs", ARCHITECTURE "Suggested Build Order", PITFALLS "Roadmap flags") independently arrived at domain -> schema -> service policy -> views -> CLI -> API.
- **One-way decisions first:** schema/model decisions (enum value, `scheduled` validation, week-start) are hard to reverse once data exists, so they front-load into Phase 1.
- **Views split by cost/risk:** date view (cheap, flat) before period view (recursive, performance-sensitive), so the riskier rollup phase can absorb dedicated attention.
- **Parity as a constraint, not a phase:** CLI and API ship together in Phase 5 (or each feature carries its API twin) because the e2e suite goes red otherwise.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 4 (Period View):** flagged by Pitfalls - recursive rollup collides with the known in-memory full-table-scan debt (CONCERNS.md). Likely warrants `--research-phase` on the in-memory-tree vs. SQL-pushdown decision and index usage.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Domain + Schema):** `time` ISO-week APIs and additive-index pattern are verified and well-documented; the work is prescriptive.
- **Phase 2 (Service Policy):** mirrors existing `ensure_relation`/`Propose*`/`store_item_and_event` patterns already in the codebase.
- **Phase 3 (Date View):** flat range query over existing primitives; existing `today` is the template.
- **Phase 5 (CLI + API):** thin adapters over the service; existing subcommand/route patterns apply.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | `time` 0.3.45 and rusqlite APIs verified against current docs.rs; all cited methods confirmed; no new deps. |
| Features | HIGH | Methodology feature set corroborated across 4+ OKR vendors and multiple period-planning apps; maps 1:1 to PROJECT.md Active requirements. |
| Architecture | HIGH | Derived directly from reading the existing codebase; every pattern reuses an established in-repo precedent. |
| Pitfalls | HIGH | Grounded in actual engine source and cross-checked against `.planning/codebase/CONCERNS.md`; pitfalls are specific to this design on this codebase. |

**Overall confidence:** HIGH

### Gaps to Address

- **Week-start convention (Monday vs Sunday):** research strongly recommends ISO Monday (matches existing Monday=0 math) but it must be *explicitly locked* as a Key Decision in Phase 1 before any view is built. Handle: lock during Phase 1 planning, document next to the helper.
- **`ItemStatus` meaning for goals:** the lifecycle was designed for actionable items; "does a month-goal complete when the month ends?" has no current answer. Handle: write a one-paragraph semantics decision in Phase 2 (recommend: goal is `Active` for its period; `Completed`/`Dropped` are user-driven and do NOT cascade to children in v1).
- **Period-view performance ceiling:** acceptable at personal scale today; the SQL-pushdown vs. single-load-in-memory choice may need validation if data homes grow. Handle: Phase 4 research flag; add indexes now so a later pushdown lands cheaply.
- **Pre-existing today/pending parity gap:** lifting that logic into the service is optional (not required by this milestone) but recommended while adding the new views. Handle: judgment call at Phase 5 planning.
- **`Goal` row downgrade policy:** decide deliberately between "new binary required (documented + `user_version` bump)" vs. "skip/quarantine unknown rows." Handle: Phase 1 Key Decision.

## Sources

### Primary (HIGH confidence)
- docs.rs/time/0.3.45 - `to_iso_week_date`/`from_iso_week_date`, calendar-date helpers, date arithmetic (all `const`).
- docs.rs/rusqlite/0.32.1 + SQLite `WITH RECURSIVE` docs - arbitrary-SQL pass-through, bundled SQLite 3.46+, recursive CTE support.
- Local engine source - `domain/{model,status,recurrence}.rs`, `application/service/{mod,creation,update,queries}.rs`, `application/ports.rs`, `infrastructure/sqlite/{schema,mapping,repo}.rs`, `interfaces/cli/markdown.rs`, `interfaces/api/handlers.rs`.
- `.planning/PROJECT.md` and `.planning/codebase/{ARCHITECTURE,STRUCTURE,CONVENTIONS,TESTING,CONCERNS}.md` - locked decisions, layering, parity invariant, known concerns.

### Secondary (MEDIUM confidence)
- OKR cascading / goal-to-task models - Weekdone, Cascade, What Matters, Businessmap (corroborated across vendors).
- Period-planning apps (yearly/monthly/weekly decomposition) - Reclaim, Everhour, Day Designer, GoalMap, TickTick.
- Date/calendar view conventions - Todoist, Todo Cloud, Motion.
- GTD Horizons of Focus - established methodology.

### Tertiary (LOW confidence)
- None - all findings traced to verified docs, in-repo source, or multi-source consensus.

---
*Research completed: 2026-06-22*
*Ready for roadmap: yes*
