# Roadmap: todo-engine — Planning Layer

## Overview

This milestone grafts a hierarchical period-goal planning layer onto the existing clean/hexagonal `todo-engine` as a thin vertical slice across the four existing rings — no new ring, no new mutation path, no new schema column. The journey is dependency-driven bottom-up: first lock the one-way foundation decisions (the `Goal` item type, the period-anchor normalization LYNCHPIN, and additive indexes), then concentrate all planning policy in `TodoService` (goal create/link, validation, the list-filter read primitive), then build the two halves of Core Value as service-computed views (the cheap flat date view, then the recursive goal-tree period view), and finally expose the whole surface through parity-locked CLI and HTTP API adapters. Each phase compiles against a ready layer below, with tests following each step, so by the end a user can set a period goal, decompose it top-down into dated tasks, and see those tasks by date and by goal tree — all through the same policy-enforced engine.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Domain + Schema Foundation** - `Goal` item type, the period-anchor normalization helper (LYNCHPIN), and additive indexes — the one-way decisions (completed 2026-06-22)
- [x] **Phase 2: Service Policy — Goal Create, Link & Validation** - All planning mutations and the list read primitive routed through `TodoService` with strict validation (completed 2026-06-22)
- [x] **Phase 3: Date View** - Tasks grouped by `scheduled` date for a day or range, with explicit buckets for undated work (completed 2026-06-23)
- [ ] **Phase 4: Period View (goal-tree rollup)** - The goal at a `(horizon, period)` plus its descendant goal+task subtree, structure only
- [ ] **Phase 5: CLI + API Surface (parity-locked)** - Goal/link/view commands and mirrored HTTP endpoints over the same service methods

## Phase Details

### Phase 1: Domain + Schema Foundation

**Goal**: The engine recognizes a `Goal` item type and has one canonical, tested way to anchor any date to its period — the lowest-leverage code with the highest blast radius, locked before anything reads it.
**Depends on**: Nothing (first phase)
**Requirements**: GOAL-02, CORE-02
**Success Criteria** (what must be TRUE):

  1. The pure `Horizon` helper normalizes any valid date to its canonical period start — year → Jan 1, month → 1st, week → ISO Monday — and unit tests prove correctness at the year-boundary cases (W01, W53, Dec 31, Jan 1).
  2. The week-start convention is locked and documented as ISO Monday next to the helper (recorded as a Key Decision), so no view can later bucket the same period two ways.
  3. A `goal`-typed row round-trips through the SQLite mapping (write then read) without error on the current binary, and the `Horizon` enum exposes the coarser-than ordering the parent rules will use.
  4. `init_schema()` adds the planning indexes (`parent_id`, `scheduled`, `(type, horizon, scheduled)`) on an existing data-home copy with no dropped or rewritten columns and no new `period_key` column.

**Plans**: 3 plans

Plans:

- [x] 01-01-PLAN.md — Horizon enum + period-anchor normalization helper (LYNCHPIN) + boundary unit tests (SC1, SC2)
- [x] 01-02-PLAN.md — `ItemType::Goal` variant + SQLite round-trip test (SC3)
- [x] 01-03-PLAN.md — additive `init_schema()` planning indexes + migration-on-copy test (SC4)

### Phase 2: Service Policy — Goal Create, Link & Validation

**Goal**: A user (or agent) can create a period goal, nest goals, and link a dated task to a goal — every path validated and audited through the single `TodoService` mutation path, and the read primitive the views will compose exists.
**Depends on**: Phase 1
**Requirements**: GOAL-01, GOAL-03, GOAL-04, GOAL-05, LINK-01, LINK-02, VIEW-01, CORE-01
**Success Criteria** (what must be TRUE):

  1. A user can create a goal at year/month/week horizon; agent-created goals start `Proposed` and require approval, user-created start `Approved`, and every create writes a `TodoEvent` audit row.
  2. The service rejects an unparseable, sentinel (`"today"`), or non-canonical `scheduled` anchor with a clear policy/validation error instead of silently dropping it.
  3. The service rejects nesting that creates a cycle or inverts the horizon (a finer-horizon goal cannot parent a coarser one), and rejects a duplicate goal for the same `(horizon, normalized_scheduled, parent_id)`.
  4. A user can link an existing task to a goal via `parent_id` and set the task's `scheduled` date, both through the audited update path (no bespoke bypass).
  5. A user can list goals/tasks filtered by horizon, period, and parent, and the documented `ItemStatus` meaning for goals (no cascade to children in v1) is recorded.

**Plans**: 4 plans
Plans:

- [x] 02-01-PLAN.md — Additive plumbing: `UpdateItem.parent_id` + `ListFilter` horizon/parent/scheduled fields & `apply_list_filter` predicates (LINK-01, VIEW-01) — Wave 1
- [x] 02-02-PLAN.md — Goal create + anchor validation + nesting (cycle/inversion) + duplicate policy via `propose_goal`/`service/goal.rs` (GOAL-01/03/04/05, CORE-01) — Wave 1
- [x] 02-03-PLAN.md — Task→goal linking tests + persistent VIEW-01 list-filter parity test (LINK-01/02, VIEW-01) — Wave 2
- [x] 02-04-PLAN.md — SC5 docs deliverable: Goal item-type + ItemStatus-for-goals (no-cascade-in-v1) in README + ADR-0006 — Wave 2

### Phase 3: Date View

**Goal**: A user can see what is on a given day or date range, with nothing silently dropped — the cheaper, flat half of Core Value, computed in the service so CLI and API will agree.
**Depends on**: Phase 2
**Requirements**: VIEW-02, VIEW-05
**Success Criteria** (what must be TRUE):

  1. A user can see tasks grouped by `scheduled` date for a single day and for an arbitrary `[from, to]` range, with deterministic ordering.
  2. Tasks with no `scheduled` date appear in an explicit "unscheduled" bucket rather than being omitted.
  3. For a given date, the agenda surfaces both tasks scheduled for that day and tasks due that day (spanning `scheduled` + `due`).
  4. The view logic lives in `application/service/queries.rs` and is side-effect-free (no routine materialization), so it returns identical results regardless of caller.

**Plans**: 3 plans
Plans:
**Wave 1**

- [x] 03-01-PLAN.md — `agenda` + `date_range` pure date-view methods on `TodoService` in `queries.rs` (VIEW-02, VIEW-05, CORE-03) — Wave 1

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03-02-PLAN.md — In-memory unit tests: range ordering, unscheduled-never-dropped, agenda union+dedup, open-only, no-overdue-roll (VIEW-02, VIEW-05) — Wave 2
- [x] 03-03-PLAN.md — Persistent SQLite integration tests: store parity + side-effect-free (SC4/CORE-03) (VIEW-02, VIEW-05) — Wave 2

### Phase 4: Period View (goal-tree rollup)

**Goal**: A user can see a period's plan — the goal(s) for a `(horizon, period)` plus their decomposed goal+task subtree — the recursive, performance-sensitive other half of Core Value.
**Depends on**: Phase 3
**Requirements**: VIEW-03, VIEW-04
**Success Criteria** (what must be TRUE):

  1. A user can request a `(horizon, period)` and see the root goal(s) plus their descendant goals and linked tasks as a structured tree (structure only; no completion rollup).
  2. A user can see tasks linked under a goal that have no `scheduled` date (unscheduled-in-goal surfacing), so planned-but-undated work is never lost.
  3. The traversal loads the working set once and walks it in memory (no `list_items` inside the recursion) and terminates safely on cyclic or orphaned legacy data via a visited set and depth cap.
  4. The view logic lives in `application/service/queries.rs` returning a single shared `PeriodView` type both adapters will serialize.

**Plans**: 3 plans
**Research**: Completed (04-RESEARCH.md) — load strategy locked to a confined SQLite `WITH RECURSIVE` CTE in repo.rs (D-10), with an equivalent InMemory Rust loader and an explicit cross-store parity test (D-11). No new dependencies.

Plans:
**Wave 1**

- [x] 04-01-PLAN.md — Shared `PeriodView`/`GoalNode` type + `period_view` method + in-memory `assemble()` walk (visited-set + depth cap + anomaly) + InMemory loader + in-memory behavior tests (VIEW-03, VIEW-04) — Wave 1

**Wave 2** *(blocked on Wave 1)*

- [ ] 04-02-PLAN.md — Recursive-CTE `load_period_subtree` in repo.rs + `TodoRepository` trait method + Persistent arm of `period_view` (D-10 SQL pushdown) (VIEW-03, VIEW-04) — Wave 2

**Wave 3** *(blocked on Waves 1-2)*

- [ ] 04-03-PLAN.md — Persistent subtree test + `parity_in_memory_vs_persistent` (D-11) + SC3 store-level cycle/orphan/over-depth anomaly fixtures + side-effect-free (VIEW-03, VIEW-04) — Wave 3

### Phase 5: CLI + API Surface (parity-locked)

**Goal**: The whole planning layer is usable from both the CLI and the HTTP API, with the two surfaces provably in parity because they call the same service methods and never re-implement policy.
**Depends on**: Phase 4
**Requirements**: SURF-01, SURF-02, CORE-03
**Success Criteria** (what must be TRUE):

  1. A user can create goals, link tasks, and run every view (date/week/month/year) from the CLI, with both Markdown and JSON output per the existing convention.
  2. The HTTP API exposes mirrored endpoints for the same operations, calling the identical `TodoService` methods (no policy or view logic in handlers).
  3. Every new command/endpoint has a paired e2e CLI + API test asserting the two surfaces yield the same item state and the same rejections.
  4. Agent-created goals via either surface are verified to start `Proposed` and require approval, confirming approval gating is not bypassable from the API.

**Plans**: TBD

Plans:

- [ ] 05-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Domain + Schema Foundation | 3/3 | Complete    | 2026-06-22 |
| 2. Service Policy — Goal Create, Link & Validation | 4/4 | Complete    | 2026-06-22 |
| 3. Date View | 3/3 | Complete    | 2026-06-23 |
| 4. Period View (goal-tree rollup) | 1/3 | In Progress | - |
| 5. CLI + API Surface (parity-locked) | 0/TBD | Not started | - |
