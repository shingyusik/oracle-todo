# Planner Weekly And Daily Date Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add direct date selection, adjacent period navigation, and selected-date labels to Planner Weekly and Daily views.

**Architecture:** Independent `PlannerControls` dates remain the source of truth. One controller method selects the active tab date, and a local toolbar popover sends calendar selection to it. A generic internal calendar grid shares the existing goal-week visual behavior without new dependencies or backend work.

**Tech Stack:** Next.js 14, React 18, TypeScript, Lucide React, Vitest, React Testing Library.

## Global Constraints

- `weeklyDate` stores ISO Monday; `dailyDate` stores the exact local `YYYY-MM-DD` date.
- Selection, arrows, and `Now` update only the active Planner tab.
- No date-picker package, free-form date input, Rust, API, SQLite, or schema changes.
- Support pointer and keyboard previews, Escape/outside-click dismissal, focus restoration, and NFLOW commits.

## File Structure

| File | Responsibility |
| --- | --- |
| `frontend/src/features/workbench/model/workbench-model.ts` | Public selection action contract. |
| `frontend/src/features/workbench/hooks/useWorkbenchController.ts` | Active-tab date canonicalization and storage. |
| `frontend/src/features/workbench/model/planner-model.ts` | Date-relative Daily titles. |
| `frontend/src/features/workbench/ui/MainPanel.tsx` | Period navigator, popover, shared calendar grid. |
| `frontend/src/styles/globals.css` | Navigator/popover layout. |
| `frontend/tests/presentation/use-workbench-controller.spec.tsx` | Controller selection and isolation. |
| `frontend/tests/domain/planner-model.spec.ts` | Dynamic Daily labels and buckets. |
| `frontend/tests/presentation/workbench-wireframe.spec.tsx` | UI interactions and accessible labels. |
| `frontend/tests/architecture/design-boundaries.spec.ts` | Dependency guard. |

## Task 1: Add Active-Panel Date Selection And Daily Labels

**Files:**

- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- Modify: `frontend/src/features/workbench/model/planner-model.ts`
- Test: `frontend/tests/presentation/use-workbench-controller.spec.tsx`
- Test: `frontend/tests/domain/planner-model.spec.ts`

**Produces:** `selectPlannerPeriodDate(date: string): void` and Daily titles relative to `DailyPlannerOptions.date`.

- [ ] **Step 1: Write failing controller coverage**

Declare the action after the existing period commands:

```ts
selectPlannerPeriodDate: (date: string) => void;
```

Add this test:

```ts
it("selects weekly and daily dates without sharing periods", async () => {
  const { result } = renderHook(() => useWorkbenchController());
  act(() => result.current.selectTab("weekly"));
  await waitFor(() => expect(result.current.panel.id).toBe("weekly"));
  act(() => result.current.selectPlannerPeriodDate("2026-07-09"));
  expect(result.current.planner.weeklyDate).toBe("2026-07-06");
  act(() => result.current.selectTab("daily"));
  await waitFor(() => expect(result.current.panel.id).toBe("daily"));
  act(() => result.current.selectPlannerPeriodDate("2026-07-09"));
  expect(result.current.planner.dailyDate).toBe("2026-07-09");
  act(() => result.current.selectTab("weekly"));
  expect(result.current.planner.date).toBe("2026-07-06");
});
```

Run `cd frontend && npm run test -- tests/presentation/use-workbench-controller.spec.tsx`.

Expected: FAIL because the action is absent.

- [ ] **Step 2: Implement through the existing canonical write boundary**

Add next to `movePlannerPeriod` in `useWorkbenchController.ts`:

```ts
selectPlannerPeriodDate: (date) =>
  setPlanner((current) =>
    setPlannerDateForPanel(current, selection.leafTabId, date),
  ),
```

Do not duplicate per-tab branches: `setPlannerDateForPanel` already normalizes Weekly to Monday and leaves inactive fields untouched.

- [ ] **Step 3: Write failing Daily label coverage**

Allow `buildDaily` in `planner-model.spec.ts` to receive its reference date, then add:

```ts
it("labels daily sections from the selected reference date", () => {
  const result = buildDaily({}, "none", "2026-07-06");
  expect(result.sections.today.title).toBe("July 6, 2026");
  expect(result.sections.overdue.title).toBe("Before July 6, 2026");
  expect(result.sections.upcoming.title).toBe("After July 6, 2026");
  expect(result.sections.unscheduled.title).toBe("Unscheduled");
  expect(result.sections.today.groups[0]?.items.map((item) => item.id)).toContain("task-focus");
  expect(result.sections.overdue.groups[0]?.items.map((item) => item.id)).toContain("task-overdue");
  expect(result.sections.upcoming.groups[0]?.items.map((item) => item.id)).toContain("task-upcoming");
});
```

Run `cd frontend && npm run test -- tests/domain/planner-model.spec.ts`.

Expected: FAIL because the model emits static `Today`, `Overdue`, and `Upcoming` titles.

- [ ] **Step 4: Implement labels without altering bucket membership**

Add a local formatter near `datePart`:

```ts
function dailySectionDateLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });
}
```

In `buildDailyPlannerModel`, derive `const dateLabel = dailySectionDateLabel(options.date);` and replace only titles:

```ts
today: section("today", dateLabel, today, relatedItems, options.groupBy),
overdue: section("overdue", `Before ${dateLabel}`, overdue, relatedItems, options.groupBy),
upcoming: section("upcoming", `After ${dateLabel}`, upcoming, relatedItems, options.groupBy),
unscheduled: section("unscheduled", "Unscheduled", unscheduled, relatedItems, options.groupBy),
```

- [ ] **Step 5: Verify and commit Task 1**

Run:

```bash
cd frontend && npm run test -- tests/presentation/use-workbench-controller.spec.tsx tests/domain/planner-model.spec.ts && npm run typecheck
cd .. && git add frontend/src/features/workbench/model/workbench-model.ts frontend/src/features/workbench/hooks/useWorkbenchController.ts frontend/src/features/workbench/model/planner-model.ts frontend/tests/presentation/use-workbench-controller.spec.tsx frontend/tests/domain/planner-model.spec.ts && git diff --cached --check
git commit -m "[UPDATE] Add planner date selection state" -m "- 활성 Planner 탭의 날짜를 선택하는 controller 동작 추가
- Weekly는 ISO 월요일로 정규화하고 Daily는 선택 날짜를 유지
- Daily 목록의 기준일과 전후 섹션 제목을 선택 기간에 맞춤"
```

Expected: tests/typecheck pass and one focused state/model commit is created.

## Task 2: Render The Navigator And Shared Calendar Popover

**Files:**

- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/styles/globals.css`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`
- Test: `frontend/tests/architecture/design-boundaries.spec.ts`

**Consumes:** `movePlannerPeriod`, `resetPlannerPeriodToToday`, `selectPlannerPeriodDate`, `planner.date`, and `planner.weekStart`.

**Produces:** `PlannerPeriodNavigation`, `PlannerDatePicker`, and `CalendarDateGrid`; keeps `GoalPeriodCalendar` as a wrapper.

- [ ] **Step 1: Write failing toolbar and popup tests**

Assert only Weekly/Daily have date triggers. Add this Weekly interaction core:

```tsx
const weeklyTrigger = screen.getByRole("button", { name: "Choose Weekly date" });
expect(
  weeklyTrigger.compareDocumentPosition(screen.getByRole("button", { name: "Now" })) &
    Node.DOCUMENT_POSITION_FOLLOWING,
).toBeTruthy();
await user.click(weeklyTrigger);
const picker = screen.getByRole("dialog", { name: "Choose Weekly date" });
const candidate = within(picker).getAllByRole("button").find((button) =>
  button.classList.contains("goal-period-calendar-day") &&
  !button.classList.contains("goal-period-calendar-day-selected"),
);
fireEvent.mouseEnter(candidate!);
expect(
  within(picker).getAllByRole("button").filter((button) =>
    button.classList.contains("goal-period-calendar-day-preview"),
  ),
).toHaveLength(7);
```

Add Daily coverage that expects one preview cell. In both views, select a date and assert the dialog closes; reopen, press Escape, and assert focus returns to the trigger. Assert `Previous week`/`Next week` and `Previous day`/`Next day` names.

Run `cd frontend && npm run test -- tests/presentation/workbench-wireframe.spec.tsx`.

Expected: FAIL because date triggers do not exist.

- [ ] **Step 2: Extract the internal calendar grid**

Keep `GoalPeriodCalendar` for the existing architecture guard, but move its calendar cells into:

```tsx
type CalendarSelectionMode = "week" | "day";

function CalendarDateGrid({ mode, selectedDate, onSelect }: {
  mode: CalendarSelectionMode;
  selectedDate: string;
  onSelect: (date: string) => void;
}) {
  // Own viewMonth and previewedDate.
  // Keep the Monday-first 42-cell grid, month controls, and This month reset.
  // Week mode uses ISO Monday-Sunday; day mode highlights one cell.
}

function GoalPeriodCalendar({ scheduled, onSelect }: {
  scheduled: string;
  onSelect: (date: string) => void;
}) {
  return <CalendarDateGrid mode="week" selectedDate={scheduled} onSelect={onSelect} />;
}
```

Keep `goal-period-calendar-day-*` classes. Apply `setPreviewedDate(cell.date)` on `onMouseEnter` and `onFocus`, and clear it on `onMouseLeave` and `onBlur`. Week mode applies range-start/range-end to its first and last cells; day mode does not.

- [ ] **Step 3: Implement navigator and local date picker**

Insert this after `planner-view-pill` in `PlannerControlToolbar`:

```tsx
{controller.panel.id === "weekly" || controller.panel.id === "daily" ? (
  <PlannerPeriodNavigation controller={controller} />
) : null}
```

Use Lucide `ChevronLeft`, `ChevronRight`, and `CalendarDays`. Render previous, date trigger, next, then `Now` as one group. Name controls as follows:

```ts
const isWeekly = controller.panel.id === "weekly";
const previousLabel = isWeekly ? "Previous week" : "Previous day";
const nextLabel = isWeekly ? "Next week" : "Next day";
const dialogLabel = isWeekly ? "Choose Weekly date" : "Choose Daily date";
```

Use the Monday-Sunday range for Weekly trigger text and the selected day for Daily. Reuse `plannerPeriodMatchesToday(controller)` for `Now` disabled state.

Implement `PlannerDatePicker` with `createPortal`, local open state, refs, and the same outside-pointer, Escape, resize/scroll, positioning, and focus-restoration lifecycle as `GoalPeriodControl`. Reuse `goalPeriodPopoverStyle(trigger, popover)`. Commit calendar choice with:

```tsx
<CalendarDateGrid
  mode={controller.panel.id === "weekly" ? "week" : "day"}
  selectedDate={controller.planner.date}
  onSelect={(date) => {
    controller.selectPlannerPeriodDate(date);
    close(true);
  }}
/>
```

- [ ] **Step 4: Add scoped CSS and extend the dependency guard**

Add near the current Planner toolbar CSS:

```css
.planner-period-navigation { display: inline-flex; align-items: center; gap: 2px; }
.planner-period-date-trigger {
  min-height: 32px; border: 1px solid var(--color-hairline-light);
  border-radius: var(--radius-xs); background: var(--color-canvas-light);
  padding: 0 9px; color: var(--color-ink); font: inherit; font-size: 12px; white-space: nowrap;
}
.planner-period-popover {
  z-index: 20; width: min(320px, calc(100vw - 32px)); border: 1px solid var(--color-shade-30);
  border-radius: var(--radius-xs); background: var(--color-canvas-light); padding: 12px;
  box-shadow: 0 10px 24px rgb(0 0 0 / 12%);
}
```

Keep the existing guard and add `expect(source).toContain("CalendarDateGrid");` while retaining `GoalPeriodCalendar`, `react-datepicker`, and `@fullcalendar` assertions.

- [ ] **Step 5: Verify and commit Task 2**

Run:

```bash
cd frontend && npm run test -- tests/presentation/workbench-wireframe.spec.tsx tests/architecture/design-boundaries.spec.ts && npm run typecheck
cd .. && git add frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css frontend/tests/presentation/workbench-wireframe.spec.tsx frontend/tests/architecture/design-boundaries.spec.ts && git diff --cached --check
git commit -m "[ADD] Add planner weekly and daily date picker" -m "- Weekly와 Daily 헤더에 기간 이동, 날짜 선택, Now 제어를 배치
- Goal 기간 캘린더를 공용 그리드로 확장해 주간 및 일간 미리보기 제공
- 팝오버 접근성과 선택 동작을 화면 테스트로 보장"
```

Expected: Weekly has seven preview cells, Daily has one, focus restores on dismissal, and one UI-focused commit is created.

## Final Verification

- [ ] Run `cd frontend && npm run test && npm run typecheck && npm run build`.
- [ ] Run `git diff --check HEAD~2..HEAD && git status && git log --oneline -n 10`.
- [ ] Expect all frontend gates to pass, no whitespace errors, a clean worktree, and two focused implementation commits after the design-document commit.

## Plan Self-Review

- Spec coverage: Task 1 covers independent state, canonical values, and Daily labels. Task 2 covers placement, selection, weekly/daily previews, accessibility, dismissal, responsive layout, and dependency boundaries.
- Placeholder scan: no deferred or unspecified implementation/test steps remain.
- Type consistency: Task 1 defines `selectPlannerPeriodDate(date: string)` and Task 2 is its only UI consumer.
