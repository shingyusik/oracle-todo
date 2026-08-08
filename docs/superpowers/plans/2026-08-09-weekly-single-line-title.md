# Weekly Single-Line Titles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Weekly planner item titles on one line and expose the complete title through a native tooltip only when the rendered text is truncated.

**Architecture:** `PlannerItemRow` already knows its planner table identifier, so it will opt Weekly rows into a dedicated CSS class and perform an overflow check on mouse entry. The title remains the button's full text; the handler only adds or removes the native `title` attribute based on `scrollWidth > clientWidth`.

**Tech Stack:** React 18, TypeScript, CSS, Vitest, Testing Library, Next.js 14

## Global Constraints

- Apply the behavior only to item buttons rendered inside the Weekly planner.
- Preserve the complete title as the button text and accessible name.
- Do not introduce a custom tooltip component or new dependency.
- Show a native tooltip only when the title is actually truncated.

## File Structure

- `frontend/src/features/workbench/ui/MainPanel.tsx`: mark Weekly item buttons and update their native tooltip on hover.
- `frontend/src/styles/globals.css`: constrain Weekly item titles to one line with ellipsis.
- `frontend/tests/presentation/workbench-wireframe.spec.tsx`: verify Weekly-only styling and overflow-sensitive tooltip behavior.

---

### Task 1: Weekly title truncation and overflow tooltip

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx:1960-1990`
- Modify: `frontend/src/styles/globals.css:1446-1460`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx:1932-2000`

**Interfaces:**
- Consumes: `PlannerItemRow`'s existing `tableId: PlannerTableId` and `item.title: string`.
- Produces: the `weekly-single-line-title` CSS class and an `onMouseEnter` handler that synchronizes the button's `title` attribute with its current overflow state.

- [ ] **Step 1: Write the failing Weekly class test**

Extend the existing `renders weekly planner goals and seven day cards` test after Weekly renders:

```tsx
const weeklyTask = screen.getByRole("button", { name: "Active task" });
expect(weeklyTask).toHaveClass("weekly-single-line-title");
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm --prefix frontend test -- -t "renders weekly planner goals and seven day cards"
```

Expected: FAIL because the Weekly task button does not have `weekly-single-line-title`.

- [ ] **Step 3: Add the minimal Weekly-only class and CSS**

In `PlannerItemRow`, derive the Weekly scope and append its class only to non-compact Weekly item buttons:

```tsx
const usesSingleLineTitle = tableId.startsWith("weekly.") && !compact;

className={`${compact ? "monthly-day-item" : "planner-item"}${
  usesSingleLineTitle ? " weekly-single-line-title" : ""
}`}
```

Add the CSS rule:

```css
.weekly-single-line-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Write failing overflow-sensitive tooltip tests**

After obtaining `weeklyTask`, make its dimensions deterministic and verify both states:

```tsx
Object.defineProperties(weeklyTask, {
  clientWidth: { configurable: true, value: 100 },
  scrollWidth: { configurable: true, value: 180 },
});
fireEvent.mouseEnter(weeklyTask);
expect(weeklyTask).toHaveAttribute("title", "Active task");

Object.defineProperty(weeklyTask, "scrollWidth", {
  configurable: true,
  value: 80,
});
fireEvent.mouseEnter(weeklyTask);
expect(weeklyTask).not.toHaveAttribute("title");
```

- [ ] **Step 6: Run the focused test and verify RED**

Run the command from Step 2. Expected: FAIL because hover does not add the complete title for an overflowing button.

- [ ] **Step 7: Implement the minimal hover measurement**

Add a focused helper next to `PlannerItemRow`:

```tsx
function syncOverflowTitle(
  event: React.MouseEvent<HTMLButtonElement>,
  title: string,
): void {
  const button = event.currentTarget;
  if (button.scrollWidth > button.clientWidth) {
    button.title = title;
  } else {
    button.removeAttribute("title");
  }
}
```

Attach it only to Weekly single-line buttons:

```tsx
onMouseEnter={usesSingleLineTitle
  ? (event) => syncOverflowTitle(event, item.title)
  : undefined}
```

- [ ] **Step 8: Run the focused test and verify GREEN**

Run the command from Step 2. Expected: PASS with no warnings.

- [ ] **Step 9: Run frontend verification**

Run:

```bash
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: all tests pass, TypeScript reports no errors, and Next.js creates the static production build.

- [ ] **Step 10: Inspect documentation impact**

Run the project `docs-change-updater` workflow against the final diff. This narrowly scoped visual behavior should not require README or operations-reference changes; record that conclusion unless the diff exposes a stable user-facing contract missing from existing docs.

- [ ] **Step 11: Commit the implementation**

```bash
git add frontend/src/features/workbench/ui/MainPanel.tsx \
  frontend/src/styles/globals.css \
  frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "[UPDATE] Truncate weekly planner titles" \
  -m "- Weekly 항목 제목을 한 줄 말줄임으로 표시\n- 실제로 잘린 제목에만 호버 전체 제목을 제공\n- 프런트엔드 회귀 테스트로 표시 조건을 검증"
```

- [ ] **Step 12: Complete SHI-54 after verification**

Re-read SHI-54, confirm the implementation satisfies all completion criteria, and update its Linear state to `Done` only after Steps 8-11 succeed.

