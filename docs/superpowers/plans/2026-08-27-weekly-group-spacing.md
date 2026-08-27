# Weekly Group Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Weekly day-card group headings the same `7px` clearance above and below.

**Architecture:** Keep the existing grouped planner markup. Add one direct-child sibling CSS rule scoped to Weekly day cards, with one source-level architecture test that prevents the spacing from drifting.

**Tech Stack:** CSS, Vitest

---

### Task 1: Equalize Weekly Group Heading Spacing

**Files:**
- Modify: `frontend/tests/architecture/design-boundaries.spec.ts`
- Modify: `frontend/src/styles/globals.css`

- [ ] **Step 1: Write the failing boundary test**

Add this assertion to the existing `keeps weekly item rows inside day cards` test:

```ts
expect(source).toContain(
  ".weekly-day-grid .planner-card > .planner-card-list + .planner-card-list {\n  margin-top: 7px;\n}",
);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm --prefix frontend test -- design-boundaries.spec.ts`

Expected: FAIL because the scoped sibling rule is absent.

- [ ] **Step 3: Add the minimum scoped style**

Add after the existing Weekly `.planner-card-list` containment rule in `frontend/src/styles/globals.css`:

```css
.weekly-day-grid .planner-card > .planner-card-list + .planner-card-list {
  margin-top: 7px;
}
```

- [ ] **Step 4: Verify the change**

Run: `npm --prefix frontend test -- design-boundaries.spec.ts`

Expected: PASS.

Run: `npm --prefix frontend run typecheck`

Expected: exit code 0.

- [ ] **Step 5: Commit the implementation**

```powershell
git add -- frontend/tests/architecture/design-boundaries.spec.ts frontend/src/styles/globals.css docs/superpowers/plans/2026-08-27-weekly-group-spacing.md
git commit -m "[FIX] Equalize weekly group spacing"
```
