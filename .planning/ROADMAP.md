# Roadmap: todo-engine — Planning Layer

## Milestones

- ✅ **v1.0 Planning Layer** — Phases 1–5 (shipped 2026-06-26)

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

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
| ----- | --------- | -------------- | -------- | ---------- |
| 1. Domain + Schema Foundation | v1.0 | 3/3 | Complete | 2026-06-22 |
| 2. Service Policy — Goal Create/Link/Validation | v1.0 | 4/4 | Complete | 2026-06-22 |
| 3. Date View | v1.0 | 3/3 | Complete | 2026-06-23 |
| 4. Period View (goal-tree rollup) | v1.0 | 3/3 | Complete | 2026-06-25 |
| 4.1. Fix period-view review findings (INSERTED) | v1.0 | 3/3 | Complete | 2026-06-25 |
| 5. CLI + API Surface (parity-locked) | v1.0 | 3/3 | Complete | 2026-06-26 |
