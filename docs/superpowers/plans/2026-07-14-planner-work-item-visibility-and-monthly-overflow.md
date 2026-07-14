# Planner Work Item Visibility and Monthly Overflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Show only tasks and events in Weekly, Daily, and Monthly work lists while keeping period Goal surfaces and adding an anchored Monthly day-overflow popover.

**Architecture:** Enforce the work-list invariant in the pure planner model so rendering, sorting, and overflow counts receive task/event-only collections. Keep one open date in MonthlyPeriodPlanner and render the complete sorted date list through the existing portal positioning helper and PlannerItemRow.

**Tech Stack:** TypeScript, React 18, Next.js 14, Vitest, Testing Library, CSS

## Global Constraints

- Weekly and Monthly Goal-only surfaces remain visible.
- Weekly day cards, all Daily sections, and Monthly calendar cells show only task and event items.
- Existing status, filtering, sorting, grouping, completion, and detail behavior remains unchanged.
- Monthly cells show two rows before +N more; the popover shows the complete ordered date list.
- Escape and outside pointer dismissal close the popover and restore trigger focus.
- No dependency, API, Rust service, or SQLite changes.
- Every production change follows an observed failing focused test.

---

## File Structure

- frontend/src/features/workbench/model/planner-model.ts: work-item type invariant.
- frontend/tests/domain/planner-model.spec.ts: model visibility regression coverage.
- frontend/src/features/workbench/ui/MainPanel.tsx: one open Monthly date and popover lifecycle.
- frontend/src/styles/globals.css: overflow trigger and popover presentation.
- frontend/tests/presentation/workbench-wireframe.spec.tsx: user interaction coverage.

### Task 1: Enforce Task/Event-Only Work Collections

**Files:**
- Modify: frontend/tests/domain/planner-model.spec.ts
- Modify: frontend/src/features/workbench/model/planner-model.ts:188-190

**Interfaces:**
- Consumes: buildDailyPlannerModel, buildWeeklyPlannerModel, buildMonthlyPeriodGoalCardsModel.
- Produces: unchanged model types with only task/event entries in work collections; unchanged Goal collections.

- [ ] **Step 1: Write the failing model test**

Add this test:

~~~ts
it("limits daily weekly and monthly work lists to tasks and events", () => {
  const workItems = [
    item("task", { type: "task", scheduled: "2026-07-06" }),
    item("event", { type: "event", scheduled: "2026-07-06" }),
    item("routine", { type: "routine", scheduled: "2026-07-06" }),
    item("month-goal", { type: "goal", horizon: "month", scheduled: "2026-07-01" }),
    item("week-goal", { type: "goal", horizon: "week", scheduled: "2026-07-06" }),
  ];
  const daily = buildDailyPlannerModel(workItems, relatedItems, {
    date: "2026-07-06",
    filters: {
      tags: [], areaIds: [], projectIds: [], routineIds: [], itemTypes: [], statuses: [],
    },
    groupSettings: defaultPlannerGroupSettings(),
    groupCandidates: [],
    sortRules: [],
  });
  const weekly = buildWeeklyPlannerModel(workItems, "2026-07-06");
  const monthly = buildMonthlyPeriodGoalCardsModel(workItems, "2026-07-01");

  expect(daily.sections.today.groups.flatMap((group) => group.items.map((entry) => entry.id)))
    .toEqual(["task", "event"]);
  expect(weekly.days[0]?.items.map((entry) => entry.id)).toEqual(["task", "event"]);
  expect(monthly.weeks[1]?.days[0]?.items.map((entry) => entry.id))
    .toEqual(["task", "event"]);
  expect(weekly.monthGoals.map((entry) => entry.id)).toEqual(["month-goal"]);
  expect(weekly.weekGoals.map((entry) => entry.id)).toEqual(["week-goal"]);
  expect(monthly.carousel[1]?.goals.map((entry) => entry.id)).toEqual(["month-goal"]);
  expect(monthly.weeks[1]?.goals.map((entry) => entry.id)).toEqual(["week-goal"]);
});
~~~

- [ ] **Step 2: Verify RED**

Run: cd frontend && npm test -- --run tests/domain/planner-model.spec.ts

Expected: FAIL because routine is present in the three work collections.

- [ ] **Step 3: Implement the shared invariant**

Replace dailyItemTypes, weeklyItemTypes, and monthlyItemTypes with:

~~~ts
const plannerWorkItemTypes = new Set(["task", "event"]);
~~~

Use plannerWorkItemTypes.has(item.type) in all three builders. Do not change Goal or status filtering.

- [ ] **Step 4: Verify GREEN**

Run: cd frontend && npm test -- --run tests/domain/planner-model.spec.ts

Expected: all tests PASS.

- [ ] **Step 5: Commit**

~~~bash
git add frontend/src/features/workbench/model/planner-model.ts frontend/tests/domain/planner-model.spec.ts
git commit -m "[FIX] Limit planner work lists to tasks and events" -m "- Weekly, Daily, Monthly 작업 컬렉션에서 routine과 Goal을 제외
- Goal 전용 컬렉션과 기존 상태 표시 규칙을 유지
- 세 planner 모델의 공통 타입 불변식을 테스트로 고정"
~~~

### Task 2: Add the Monthly Day Overflow Popover

**Files:**
- Modify: frontend/tests/presentation/workbench-wireframe.spec.tsx
- Modify: frontend/src/features/workbench/ui/MainPanel.tsx:284-385
- Modify: frontend/src/styles/globals.css:718-760

**Interfaces:**
- Consumes: sorted WorkspaceItemModel array, PlannerItemRow, createPortal, goalPeriodPopoverStyle.
- Produces: controlled MonthlyDayItems date/open/onOpenChange props, date-labeled dialog, accessible +N more trigger.

- [ ] **Step 1: Write the failing interaction test**

Add four same-date task/event items in sortable order and one same-date routine. Assert:

~~~ts
const dayCell = screen.getByRole("gridcell", { name: firstWeekStart + " todo" });
const moreButton = within(dayCell).getByRole("button", { name: "Show 2 more items" });
expect(moreButton).toHaveTextContent("+2 more");

await user.click(moreButton);
const overflow = screen.getByRole("dialog", { name: firstWeekStart + " items" });
expect(within(overflow).queryByText("Monthly routine")).toBeNull();
~~~

Assert the four unique titles appear in exact DOM order, proving the compact cell and popover share Monthly sorting.

- [ ] **Step 2: Verify RED**

Run: cd frontend && npm test -- --run tests/presentation/workbench-wireframe.spec.tsx -t "opens monthly day overflow"

Expected: FAIL because +N more is a span and no dialog exists.

- [ ] **Step 3: Lift one open date into MonthlyPeriodPlanner**

Add:

~~~tsx
const [openOverflowDate, setOpenOverflowDate] = React.useState<string | null>(null);

useEffect(() => {
  setOpenOverflowDate(null);
}, [controller.planner.date]);
~~~

Pass the state and setter through MonthlyPlannerWeekRow. MonthlyDayItems receives date, open, and onOpenChange.

- [ ] **Step 4: Add the accessible trigger**

Replace the span with:

~~~tsx
<button
  ref={triggerRef}
  className="monthly-day-more"
  type="button"
  aria-label={"Show " + hiddenCount + " more items"}
  aria-haspopup="dialog"
  aria-expanded={open}
  onClick={() => onOpenChange(open ? null : date)}
>
  +{hiddenCount} more
</button>
~~~

Keep the first two PlannerItemRow entries unchanged.

- [ ] **Step 5: Render and position all date items**

Add trigger/popover refs and popoverStyle. While open, calculate goalPeriodPopoverStyle in useLayoutEffect and recalculate on resize and capturing scroll. Render through createPortal:

~~~tsx
<div
  ref={popoverRef}
  className="monthly-day-popover"
  style={popoverStyle ?? undefined}
  role="dialog"
  aria-label={date + " items"}
>
  <h3>{date}</h3>
  <ul className="monthly-day-popover-list">
    {items.map((item) => (
      <li key={item.id}>
        <PlannerItemRow controller={controller} item={item} compact />
      </li>
    ))}
  </ul>
</div>
~~~

Map all items, including the first two compact rows.

- [ ] **Step 6: Implement dismissal and focus restoration**

Register document mousedown and keydown listeners only while open. Ignore pointers inside the trigger or popover. On outside press or Escape:

~~~ts
onOpenChange(null);
requestAnimationFrame(() => triggerRef.current?.focus());
~~~

Escape also prevents default and propagation. Remove all listeners during cleanup.

- [ ] **Step 7: Style the trigger and popover**

Reset monthly-day-more as a button and add hover/focus-visible feedback. Add:

~~~css
.monthly-day-popover {
  z-index: 50;
  width: min(320px, calc(100vw - 32px));
  border: 1px solid var(--color-hairline-light);
  border-radius: var(--radius-sm);
  background: var(--color-canvas-light);
  padding: 12px;
  box-shadow: 0 12px 30px rgb(0 0 0 / 14%);
}

.monthly-day-popover > h3 {
  margin-bottom: 10px;
  color: var(--color-shade-60);
  font-size: 12px;
}

.monthly-day-popover-list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
~~~

- [ ] **Step 8: Verify detail and dismissal behavior**

Assert clicking an overflow item opens its existing detail view:

~~~ts
await user.click(within(overflow).getByRole("button", { name: "Overflow task" }));
expect(await screen.findByRole("heading", { name: "Overflow task" })).toBeInTheDocument();
~~~

In separate render cycles, reopen and press Escape, then reopen and fire mousedown on document.body. In both cases assert the dialog disappears and the trigger regains focus.

- [ ] **Step 9: Verify GREEN and types**

Run: cd frontend && npm test -- --run tests/presentation/workbench-wireframe.spec.tsx -t "monthly day overflow" && npm run typecheck

Expected: focused tests PASS and TypeScript reports no diagnostics.

- [ ] **Step 10: Commit**

~~~bash
git add frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "[ADD] Show monthly day overflow in a popover" -m "- 날짜 셀의 숨겨진 task와 event 전체 목록을 팝오버로 제공
- 바깥 클릭과 Escape 닫기 및 트리거 포커스 복귀를 지원
- 기존 정렬, 상세 이동, task 완료 동작을 그대로 재사용"
~~~

### Task 3: Run Full Frontend Verification

**Files:**
- Verify only. Modify only a regression caused by Tasks 1 or 2.

**Interfaces:**
- Consumes: completed model invariant and popover.
- Produces: verified frontend with no test, type, or build regressions.

- [ ] **Step 1: Run all frontend tests**

Run: cd frontend && npm run test

Expected: all Vitest files PASS with no unhandled errors.

- [ ] **Step 2: Run type checking**

Run: cd frontend && npm run typecheck

Expected: exit code 0 with no diagnostics.

- [ ] **Step 3: Run the production build**

Run: cd frontend && npm run build

Expected: Next.js production build completes.

- [ ] **Step 4: Inspect final state**

Run:

~~~bash
git status --short
git diff --check
git log --oneline -n 5
~~~

Expected: no unstaged implementation changes, no whitespace errors, and separate model and popover commits.
