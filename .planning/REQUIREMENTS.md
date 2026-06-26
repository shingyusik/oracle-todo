# Requirements: todo-engine — Planning Layer

**Defined:** 2026-06-22
**Core Value:** A user can set a big goal for a period (year/month/week), break it top-down into tasks, and see those tasks by date — all through the same policy-enforced engine.

## v1 Requirements

Requirements for this milestone. Each maps to a roadmap phase. All P1 items derive 1:1 from PROJECT.md Active requirements; VIEW-04 and VIEW-05 are P2 differentiators pulled into v1.

### Goals (GOAL)

- [x] **GOAL-01**: User can create a period goal at a year / month / week horizon via a new `Goal` item type (reusing the existing status lifecycle, approval gating, and audit events).
- [x] **GOAL-02**: A goal is anchored to a specific period via `(horizon, scheduled)`, with `scheduled` normalized to the canonical period start — year = Jan 1, month = 1st of month, week = ISO Monday.
- [x] **GOAL-03**: The service validates a goal's `scheduled` anchor (rejects unparseable or non-canonical dates) instead of silently dropping it.
- [x] **GOAL-04**: User can nest goals via `parent_id` with level-skipping allowed; the service rejects cycles and inverted nesting (a finer-horizon goal cannot parent a coarser-horizon goal).
- [x] **GOAL-05**: The service rejects creating a duplicate goal for the same `(horizon, scheduled, parent_id)`.

### Task Linking (LINK)

- [x] **LINK-01**: User can link an existing task to a goal via `parent_id`.
- [x] **LINK-02**: User can set a task's `scheduled` date, which anchors it in the date view.

### Views (VIEW)

- [x] **VIEW-01**: User can list goals/tasks filtered by horizon, period, and parent (the read primitive the views compose).
- [x] **VIEW-02**: Date view — user can see tasks grouped by `scheduled` date for a single day and for an arbitrary `[from, to]` range; tasks with no `scheduled` date are surfaced in an explicit bucket, not dropped.
- [x] **VIEW-03**: Period view — user can see the goal(s) for a given `(horizon, period)` plus their descendant goal+task subtree (structure only; no completion rollup).
- [x] **VIEW-04**: Unscheduled-in-goal surfacing — user can see tasks linked under a goal that have no `scheduled` date.
- [x] **VIEW-05**: Agenda spanning scheduled + due — for a given date, user can see both tasks scheduled for that day and tasks due that day.

### Surface (SURF)

- [x] **SURF-01**: CLI subcommands for creating goals, linking tasks, and every view (JSON output; new views emit JSON only — see Phase 5 CONTEXT D-01/D-02; legacy Markdown views unchanged).
- [x] **SURF-02**: HTTP API endpoints mirroring the new CLI surface, reusing `TodoService` (CLI/API parity preserved, asserted by paired e2e tests).

### Invariants (CORE)

- [x] **CORE-01**: All planning mutations route through `TodoService` (validation, status state machine, audit event) — no direct repository writes.
- [x] **CORE-02**: Schema changes are additive only — `Goal` enum variant plus indexes; no dropped/rewritten columns and no new `period_key` column (period derives from `(horizon, scheduled)`).
- [x] **CORE-03**: New date/period view logic lives in the application/service layer shared by CLI and API (not in adapter code), so CLI and API stay in parity.

## v2 Requirements

Deferred to a future release. Tracked, not in this roadmap.

### Planning Enhancements

- **COVER-01**: Coverage view — surface goals in a period that have zero linked tasks (P2, deferred to v1.x once core views are proven).
- **ROLL-01**: Progress rollup — completion %/counts aggregated up the goal tree in period views.
- **ROLL-02**: Health / at-risk derived signals (computed, not stored) — depends on rollup.
- **KR-01**: Numeric Key Results / metric targets on goals (current value, target, unit).
- **CARRY-01**: Period rollover / carry-forward of incomplete tasks into the next period.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Frontend / calendar UI | Backend milestone (DB + service + CLI + API); UI is a later milestone. Engine emits views as Markdown/JSON. |
| Natural-language date parsing ("next Friday") | Non-deterministic, locale/week-start ambiguity collides with period-anchor normalization; engine takes explicit ISO dates. |
| Separate `goals` table / new `period_key` column | Locked decision: `Goal` is an `ItemType`; period derives from `(horizon, scheduled)`. Keeps free reuse of status/audit/approval. |
| New goal-specific status states (`on_track`, `at_risk`) | Reuse the single `ItemStatus` lifecycle; health is a v2 derived signal, not a stored status. |
| Backward/forward compatibility for old binaries reading `Goal` rows | Decision: always assume the latest binary; no downgrade handling or `user_version` gating built. Avoids over-engineering. |
| Auto-decomposition (engine auto-creates tasks under a goal) | Would bypass approval gating; agents instead *propose* tasks via the normal `proposed` path for user approval. |
| Second_Brain write-back | Existing invariant: `second_brain_refs` are read-only reference input. |

## Traceability

Populated during roadmap creation (gsd-roadmapper). Each requirement maps to exactly one phase.

| Requirement | Phase | Status |
|-------------|-------|--------|
| GOAL-01 | Phase 2 | Complete |
| GOAL-02 | Phase 1 | Complete |
| GOAL-03 | Phase 2 | Complete |
| GOAL-04 | Phase 2 | Complete |
| GOAL-05 | Phase 2 | Complete |
| LINK-01 | Phase 2 | Complete |
| LINK-02 | Phase 2 | Complete |
| VIEW-01 | Phase 2 | Complete |
| VIEW-02 | Phase 3 | Complete |
| VIEW-03 | Phase 4 | Complete |
| VIEW-04 | Phase 4 | Complete |
| VIEW-05 | Phase 3 | Complete |
| SURF-01 | Phase 5 | Complete |
| SURF-02 | Phase 5 | Complete |
| CORE-01 | Phase 2 | Complete |
| CORE-02 | Phase 1 | Complete |
| CORE-03 | Phase 5 | Complete |

**Coverage:**

- v1 requirements: 17 total
- Mapped to phases: 17 ✓
- Unmapped: 0

---
*Requirements defined: 2026-06-22*
*Last updated: 2026-06-22 after roadmap creation (traceability mapped)*
