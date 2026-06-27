# Requirements: todo-engine v1.1 Frontend Planning Workbench MVP

**Defined:** 2026-06-27
**Core Value:** A user can run daily planning from the browser while every mutation still goes through the policy-enforced todo-engine service.

## v1.1 Requirements

### Daily Planner

- [ ] **DAILY-01**: User can open the Daily planner and choose the agenda date.
- [ ] **DAILY-02**: User can see the selected date's agenda items from `GET /views/agenda`.
- [ ] **DAILY-03**: User can transition visible agenda items through supported status actions.
- [ ] **DAILY-04**: User can edit `scheduled` and `due` fields for visible agenda items.
- [ ] **DAILY-05**: User can create a task or event for the selected date from the Daily planner.

### Workspace Tables

- [ ] **WORK-01**: User can scan item-type-specific columns for Areas, Projects, Routines, Tasks, Events, and Goals.
- [ ] **WORK-02**: User can inline-edit supported relation fields: area, project, routine, and parent goal.
- [ ] **WORK-03**: User can inline-edit supported date and priority fields from workspace tables.
- [ ] **WORK-04**: User can use table selection, archive, loading, empty, and error states after column changes.

### API and Quality

- [ ] **API-01**: Any API support added for v1.1 is thin, service-backed, and covered by matching frontend behavior.
- [ ] **QA-01**: Frontend tests cover Daily planner behavior and workspace table polish at controller or presentation level.

## Future Requirements

### Planner Expansion

- **PLAN-01**: User can use Weekly planner UI over date-range or period views.
- **PLAN-02**: User can use Monthly planner UI over period views.
- **PLAN-03**: User can use Yearly planner UI over period views.
- **PLAN-04**: User can browse and edit a dedicated goal tree UI.

### Advanced Scheduling

- **SCHED-01**: User can drag tasks between days in a calendar-style planner.
- **SCHED-02**: User can see derived progress rollups for goals and periods.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Weekly / Monthly / Yearly planner UI | Daily workflow is the first usable frontend slice. |
| Dedicated goal tree UI | Goal relationships can be exposed through workspace fields first. |
| Drag-and-drop calendar scheduling | Native date inputs and existing PATCH paths are enough for v1.1. |
| New frontend design system | Existing workbench patterns are sufficient. |
| New goal status semantics | Existing `ItemStatus` lifecycle remains the policy source. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DAILY-01 | Phase 6 | Pending |
| DAILY-02 | Phase 6 | Pending |
| DAILY-03 | Phase 7 | Pending |
| DAILY-04 | Phase 7 | Pending |
| DAILY-05 | Phase 7 | Pending |
| WORK-01 | Phase 8 | Pending |
| WORK-02 | Phase 8 | Pending |
| WORK-03 | Phase 8 | Pending |
| WORK-04 | Phase 8 | Pending |
| API-01 | Phase 7 | Pending |
| QA-01 | Phases 6-8 | Pending |

**Coverage:**
- v1.1 requirements: 11 total
- Mapped to phases: 11
- Unmapped: 0

---
*Requirements defined: 2026-06-27*
*Last updated: 2026-06-27 after v1.1 milestone start*
