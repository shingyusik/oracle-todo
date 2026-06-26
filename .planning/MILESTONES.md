# Milestones

## v1.0 Planning Layer (Shipped: 2026-06-26)

**Phases completed:** 6 phases, 19 plans, 35 tasks

**Key accomplishments:**

- The milestone lynchpin: one pure, tested, I/O-free way to anchor any `time::Date` to its canonical period start (year->Jan 1, month->1st, week->ISO Monday) plus a strict is-canonical check, with year-boundary correctness pinned by 13 unit tests.
- ItemType::Goal added via the as_str/FromStr/serde snake_case idiom; a goal-typed item with horizon/scheduled round-trips through SQLite (SC3) with zero schema change.
- Three additive planning indexes (parent_id, scheduled, composite type+horizon+scheduled) added to init_schema via CREATE INDEX IF NOT EXISTS, with an SC4 test proving the migration is additive-only on a populated copy.
- 1. [Rule 3 - Blocking] Add new fields to existing UpdateItem / ListFilter struct-literal call sites
- Policy-core goal create: `propose_goal` + `ProposeGoal` with strict anchor, horizon-inversion/cycle nesting, and duplicate-triple validation, all routed through the single audited `store_item_and_event` path.
- Two pure, side-effect-free `TodoService` date reads — `agenda` (scheduled||due union, deduped) and `date_range` (scheduled-only inclusive range) — composing `list_items` with a deterministic `scheduled -> created_at -> id` sort that is the CLI/API parity guarantee.
- Five fast in-memory behavior oracles in `tests/unit/date_view.rs` proving the date-view contract (range ordering, unscheduled-never-dropped, agenda union+dedup, open-only, no overdue roll) against the real `agenda`/`date_range` signatures shipped in 03-01, registered in the `unit` test binary.
- A persistent SQLite integration suite proving SC4 store parity (an explicit `parity_in_memory_vs_persistent` cross-store oracle comparing both stores by stable `(title, scheduled)` key) and side-effect-free behavior (`events().len()` unchanged across `agenda`/`date_range`, proving no routine materialization), with `agenda`/`date_range` re-proven over the real `list_items` SQLite path.
- Store-agnostic `PeriodView`/`GoalNode` nested tree plus `period_view(horizon, period)` and a shared `assemble()` walk (visited-set + depth-cap + anomaly count) proven against the InMemory store; persistent loader stubbed for Plan 02.
- The D-10 SQL-pushdown load path: a single indexed `WITH RECURSIVE` CTE (`load_period_subtree`) that returns the period-view working set from SQLite, applying the IDENTICAL D-07 visibility predicate as the InMemory loader (derived from one shared `OPEN_STATUSES`), wired into the Persistent arm of `period_view`.
- The final period-view plan: integration tests that lock the Persistent SQL CTE path, prove mandatory cross-store parity (D-11) by structure-capturing stable keys, and prove SC3 safety on cyclic/orphaned/over-depth legacy data that the validating service API cannot create — injected as raw SQLite rows. period_view is now proven side-effect-free and termination-safe on both stores.
- 1. [Rule 1 - Bug] Corrected `cycle_is_severed_no_error` fixture to assert the fixed WR-02 behavior
- Task 1 — CTE goal-parent descent (D-01 / WR-01), repo.rs
- Single-sourced MAX_GOAL_DEPTH on the public service path and added two raw-injection fixtures (goal->task->goal cross-store parity + valid sibling-root anomaly==0) that lock the Plan 01/02 production fixes against regression.
- Phase 5 CLI surface over the existing TodoService: `goal propose`, JSON-only `agenda`/`date-range`/`period` views, and `update --parent-id` task->goal linking — all thin adapters with zero new policy.
- Phase 5의 두 표면(CLI / HTTP API)이 동일한 TodoService 위에서 패리티임을 증명하는 페어드 e2e 테스트 8개 — goal-create 상태 패리티(proposed/agent, SC4), 세 뷰의 JSON 형태 패리티, task→goal 링크, 그리고 present-but-invalid 입력의 거부 패리티(exit 2 / HTTP 400, SC3) + Pitfall-1 non-null parent_id 회귀 가드.

---
