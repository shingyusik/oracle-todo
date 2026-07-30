# Dashboard Status Single Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Area status and Project status on one equal-width row above the mobile breakpoint and stack them only at `767px` and below.

**Architecture:** Reuse the existing nested Dashboard status grid and mobile media query. Replace the content-driven desktop columns with two fixed equal columns, then add a one-column mobile override; no component or data changes are needed.

**Tech Stack:** CSS Grid, Vitest

## Global Constraints

- Area status precedes Project status in DOM and keyboard order.
- Both cards use equal-width columns above `767px`.
- The cards stack into one column at `767px` and below.
- Existing horizontal table scrolling handles narrow card contents.
- No component, aggregation, navigation, backend, or dependency changes.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `frontend/src/styles/globals.css` | Define the two-column status row and mobile one-column override |
| `frontend/tests/architecture/design-boundaries.spec.ts` | Guard both responsive grid declarations |

### Task 1: Lock the responsive status card layout

**Files:**
- Modify: `frontend/tests/architecture/design-boundaries.spec.ts:228`
- Modify: `frontend/src/styles/globals.css:2838`

**Interfaces:**
- Consumes: existing `.dashboard-status-grid` and `.dashboard-status-skeleton-grid` selectors
- Produces: two equal columns above `767px` and one column at `767px` and below

- [ ] **Step 1: Write the failing CSS boundary test**

Add this test after the existing Dashboard donut layout test:

```ts
it("keeps Dashboard status cards on one row until the mobile breakpoint", async () => {
  const source = await readSource("src/styles/globals.css");

  expect(source).toContain(
    ".dashboard-status-grid,\n.dashboard-status-skeleton-grid {\n  grid-column: 1 / -1;\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));",
  );
  expect(source).toMatch(
    /@media \(max-width: 767px\)[\s\S]*?\.dashboard-status-grid,\n  \.dashboard-status-skeleton-grid \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/,
  );
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npm --prefix frontend test -- tests/architecture/design-boundaries.spec.ts
```

Expected: FAIL because the desktop grid still uses `auto-fit` with a `760px`
minimum and the mobile selector has no column override.

- [ ] **Step 3: Implement the minimal CSS change**

Change the existing desktop declaration:

```css
.dashboard-status-grid,
.dashboard-status-skeleton-grid {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
```

Add the column override to the existing mobile rule:

```css
  .dashboard-status-grid,
  .dashboard-status-skeleton-grid {
    grid-template-columns: minmax(0, 1fr);
  }
```

- [ ] **Step 4: Run verification**

Run:

```bash
npm --prefix frontend test -- tests/architecture/design-boundaries.spec.ts tests/presentation/dashboard-panel.spec.tsx
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: all tests, typecheck, and production build pass.

- [ ] **Step 5: Commit the implementation**

```bash
git add frontend/src/styles/globals.css frontend/tests/architecture/design-boundaries.spec.ts
git commit -m "[FIX] Keep dashboard status cards in one row" \
  -m "- Area와 Project 상태 카드를 모바일 구간 전까지 동일 너비의 두 열로 유지
- 767px 이하에서는 기존 순서를 보존하며 한 열로 전환
- 반응형 CSS 경계를 회귀 테스트로 고정"
```
