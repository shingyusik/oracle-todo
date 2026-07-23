# Dashboard Active Work Composite Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace three separate active-work summary cards with one composite card containing direct Task, Event, and Routine links.

**Architecture:** Preserve the three independent snapshot metrics and combine them only in the widget presentation model. Extend the generic stat model and renderer with a composite variant so future grouped summary metrics do not require feature-specific UI branches.

**Tech Stack:** TypeScript, React, CSS, Vitest, Testing Library

## Global Constraints

- Keep four top-level summary cards.
- Do not give the composite card an ambiguous default destination.
- Keep Task, Event, and Routine calculations independent.
- Use native buttons for the three direct navigation actions.

---

### Task 1: Define the composite stat model

**Files:**
- Modify: `frontend/tests/domain/dashboard-widgets.spec.ts`
- Modify: `frontend/src/features/dashboard/model/dashboard-widgets.ts`

**Interfaces:**
- Consumes: `DashboardSnapshot.summary.activeTasks`, `activeEvents`, and `activeRoutines`
- Produces: exported `DashboardStatModel` union containing linked and composite stat variants

- [ ] **Step 1: Write the failing widget-model test**

Assert that the summary widget exposes exactly four top-level stats and that
`Active Work` contains the summed total plus Task, Event, and Routine actions
with their typed destinations.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --run tests/domain/dashboard-widgets.spec.ts`

Expected: FAIL because the current widget exposes six flat stats.

- [ ] **Step 3: Implement the minimal model change**

Add discriminated `linked` and `composite` stat variants. Build `Active Work`
as a composite value whose children use the existing `tasks`, `events`, and
`routines` destinations.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- --run tests/domain/dashboard-widgets.spec.ts`

Expected: PASS.

### Task 2: Render and navigate the composite card

**Files:**
- Modify: `frontend/tests/presentation/dashboard-panel.spec.tsx`
- Modify: `frontend/src/features/dashboard/ui/DashboardPanel.tsx`
- Modify: `frontend/src/styles/globals.css`

**Interfaces:**
- Consumes: `DashboardStatModel`
- Produces: four summary cards with a non-interactive composite container and three interactive sub-actions

- [ ] **Step 1: Write the failing presentation test**

Assert that Workspace summary renders four top-level cards, exposes one
`Active Work` group, and navigates Task, Event, and Routine actions to the
corresponding Workspace views.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --run tests/presentation/dashboard-panel.spec.tsx`

Expected: FAIL because the summary currently renders six independent buttons.

- [ ] **Step 3: Implement the generic composite renderer and styles**

Render linked stats with the existing button presentation. Render composite
stats as a semantic group with a primary total and three compact buttons.
Update the summary grid to four columns and add responsive focus, hover, and
wrapping styles.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- --run tests/domain/dashboard-widgets.spec.ts tests/presentation/dashboard-panel.spec.tsx`

Expected: PASS.

### Task 3: Verify the frontend

**Files:**
- Verify only

**Interfaces:**
- Consumes: completed Dashboard implementation
- Produces: passing regression, type, and production-build evidence

- [ ] **Step 1: Run the full frontend test suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 2: Run the TypeScript gate**

Run: `npm run typecheck`

Expected: exit code 0.

- [ ] **Step 3: Run the production build**

Run: `npm run build`

Expected: exit code 0.
