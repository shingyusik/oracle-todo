# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — Planning Layer

**Shipped:** 2026-06-26
**Phases:** 6 (incl. inserted 4.1) | **Plans:** 19 | **Tasks:** 35

### What Was Built
- A `Goal` item type + pure period-anchor normalization (year→Jan 1, month→1st, week→ISO Monday), grafted onto the existing engine with zero schema-column additions.
- Goal create / nest / link policy concentrated in `TodoService` (strict anchor + horizon-inversion + cycle + duplicate validation), all through the single audited `store_item_and_event` path.
- Service-computed views: flat `agenda`/`date_range` and a recursive `period_view` goal-tree rollup over both InMemory and SQLite (recursive CTE) stores, with proven cross-store parity.
- A parity-locked CLI + HTTP API surface over identical service methods, with 8 paired e2e parity tests as the contract.

### What Worked
- **Bottom-up dependency ordering.** Locking the one-way foundation (item type, period-anchor lynchpin, additive indexes) in Phase 1 before any consumer meant later phases compiled against a ready layer with no rework of foundational decisions.
- **Store-parity oracle pattern.** A single seed run through both InMemory and SQLite stores, compared by stable structural keys (not raw ids), caught divergence cheaply and became the reusable parity guarantee across Phases 3/4.
- **Inserted gap-closure phase (4.1).** Code-review findings on Phase 4 were closed by a dedicated decimal phase with regression fixtures, rather than silently patched — the anomaly-count over-count fix is now regression-locked.
- **CLI/API parity by construction.** Putting all view/policy logic in the service layer (CORE-03) meant the adapters stayed thin and parity fell out for free, asserted by paired e2e.

### What Was Inefficient
- **A deferred bug rode along for three phases.** `cli::init_loads_todo_engine_home_from_dotenv` was flagged in Phase 3 and re-deferred in 4/4.1/5 instead of being fixed or formally backlogged early; it kept forcing per-phase "out of scope" caveats and split test runs.
- **Parallel branch reinvented the same surface.** `feature/workspace-item-table-editing` was developed off pre-Phase-5 main and independently added a `/goals/propose` API route + parent_id wiring. The merge conflicted on dto.rs/handlers.rs and — worse — git auto-kept BOTH route registrations, which panicked axum at router build and failed every API e2e until the duplicate was removed.
- **Nyquist validation recording lagged.** Phases 01/02/03/04.1 shipped with partial/missing VALIDATION.md even though their real test suites were green — the formal coverage record drifted behind the actual tests.

### Patterns Established
- Cross-store parity test (`parity_in_memory_vs_persistent`) comparing by stable keys — the standard for any feature with two storage backends.
- Single-source shared constants/predicates across rings (`OPEN_STATUSES`, `MAX_GOAL_DEPTH`, `apply_list_filter`) so InMemory and SQLite paths cannot drift.
- Decimal gap-closure phase (X.1) for code-review findings, with explicit regression fixtures asserting the fixed behavior.
- Post-merge integration gate: build + full test suite after any merge — it caught the duplicate-route panic that per-file conflict resolution missed.

### Key Lessons
1. **Auto-merge can keep semantically-conflicting duplicates that aren't textual conflicts.** Two branches adding the same router route land as two `.route()` calls in different positions; git sees no conflict but the framework panics. Always build + run the integration suite after a merge, never trust a clean `git merge`.
2. **Coordinate parallel branches that touch a shared surface.** The frontend branch and Phase 5 both built the goal-propose API independently. A shared-surface lock (or sequencing) would have avoided the conflict + duplicate entirely.
3. **Fix-or-formally-backlog deferred bugs at first sighting.** A bug deferred "just for this phase" tends to persist; record it as a tracked item with an owner/phase, or fix it, instead of re-deferring each phase.

### Cost Observations
- Model: Opus-primary (orchestrator + executor/verifier/reviewer subagents).
- Execution: wave-based, sequential-on-main (worktree isolation auto-degraded because local HEAD had diverged from origin/HEAD).
- Sessions: not separately tracked this milestone.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Key Change |
|-----------|--------|------------|
| v1.0 | 6 | Established wave-based execution, store-parity oracles, decimal gap-closure phases, and post-merge integration gating. |

### Cumulative Quality

| Milestone | Backend Tests (unit/integration/e2e) | Zero-Dep Additions |
|-----------|--------------------------------------|--------------------|
| v1.0 | 49 / 62 / 38 passing (1 e2e deferred) | Goal item type + views added with no new schema column and no new heavy deps |

### Top Lessons (Verified Across Milestones)

1. *(first milestone — trends accumulate from v1.1 onward)*
