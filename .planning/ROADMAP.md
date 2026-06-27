# Roadmap: todo-engine — Planning Layer

## Milestones

- ✅ **v1.0 Planning Layer** — Phases 1–5 (shipped 2026-06-26)
- ⏳ **v1.1 Frontend Planning Workbench MVP** — Phases 6–8 (planning)

## Phases

<details>
<summary>✅ v1.0 Planning Layer (Phases 1–5) — SHIPPED 2026-06-26</summary>

A hierarchical period-goal planning layer grafted onto the existing clean/hexagonal
`todo-engine` as a thin vertical slice across the four existing rings — no new ring, no new
mutation path, no new schema column. A user can set a period goal (year/month/week),
decompose it top-down into dated tasks, and see those tasks by date and by goal tree — all
through the same policy-enforced `TodoService` (validation, status state machine, audit
events, approval gating), with CLI and HTTP API parity-locked over identical service methods.

- [x] Phase 1: Domain + Schema Foundation (3/3 plans) — completed 2026-06-22
- [x] Phase 2: Service Policy — Goal Create, Link & Validation (4/4 plans) — completed 2026-06-22
- [x] Phase 3: Date View (3/3 plans) — completed 2026-06-23
- [x] Phase 4: Period View (goal-tree rollup) (3/3 plans) — completed 2026-06-25
- [x] Phase 4.1: Fix period-view code review findings (INSERTED) (3/3 plans) — completed 2026-06-25
- [x] Phase 5: CLI + API Surface (parity-locked) (3/3 plans) — completed 2026-06-26

Full archived detail: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)
Requirements: [milestones/v1.0-REQUIREMENTS.md](milestones/v1.0-REQUIREMENTS.md) ·
Audit: [milestones/v1.0-MILESTONE-AUDIT.md](milestones/v1.0-MILESTONE-AUDIT.md)

</details>

<details open>
<summary>⏳ v1.1 Frontend Planning Workbench MVP (Phases 6–8) — PLANNING</summary>

A frontend-first milestone that turns the shipped planning API into a usable browser workbench.
The slice stays deliberately narrow: Daily planner first, workspace table polish second, and only
thin API support where the existing API would force policy-shaped logic into React.

- [ ] Phase 6: Daily Planner Read Surface — date selection and agenda list
- [ ] Phase 7: Daily Planner Mutations — status/date edits and same-day create
- [ ] Phase 8: Workspace Table Polish — type-specific columns and inline edits

Requirements: [REQUIREMENTS.md](REQUIREMENTS.md)

</details>

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
| ----- | --------- | -------------- | -------- | ---------- |
| 1. Domain + Schema Foundation | v1.0 | 3/3 | Complete | 2026-06-22 |
| 2. Service Policy — Goal Create/Link/Validation | v1.0 | 4/4 | Complete | 2026-06-22 |
| 3. Date View | v1.0 | 3/3 | Complete | 2026-06-23 |
| 4. Period View (goal-tree rollup) | v1.0 | 3/3 | Complete | 2026-06-25 |
| 4.1. Fix period-view review findings (INSERTED) | v1.0 | 3/3 | Complete | 2026-06-25 |
| 5. CLI + API Surface (parity-locked) | v1.0 | 3/3 | Complete | 2026-06-26 |
| 6. Daily Planner Read Surface | v1.1 | 0/0 | Pending | — |
| 7. Daily Planner Mutations | v1.1 | 0/0 | Pending | — |
| 8. Workspace Table Polish | v1.1 | 0/0 | Pending | — |

## Phase Details

### Phase 6: Daily Planner Read Surface

**Goal:** The Daily planner tab loads a selected date and displays agenda items from the shipped API.

**Requirements:** DAILY-01, DAILY-02, QA-01

**Success criteria:**
1. Daily tab has a date selector defaulting to the current local date.
2. Changing the date calls `/todo-engine/views/agenda?date=YYYY-MM-DD`.
3. Agenda rows show enough item context to distinguish tasks, events, due-only items, and scheduled items.
4. Controller or presentation tests cover loading, loaded, empty, and error states.

### Phase 7: Daily Planner Mutations

**Goal:** The Daily planner supports the core actions needed to run the selected day.

**Requirements:** DAILY-03, DAILY-04, DAILY-05, API-01, QA-01

**Success criteria:**
1. Supported status transitions call existing item transition endpoints and update the visible row.
2. `scheduled` and `due` edits call the audited item update path.
3. Task creation creates a task for the selected date.
4. Event creation creates an event for the selected date.
5. Any API addition is covered by backend tests and keeps policy inside `TodoService`.

### Phase 8: Workspace Table Polish

**Goal:** Workspace tables expose the right columns and inline edits for each item type without a new table system.

**Requirements:** WORK-01, WORK-02, WORK-03, WORK-04, QA-01

**Success criteria:**
1. Areas, Projects, Routines, Tasks, Events, and Goals each have a purposeful column set.
2. Relation fields use inline selects where the backend supports updates.
3. Date and priority fields use existing inline controls.
4. Existing selection, archive, detail, loading, empty, and error behavior remains covered.
