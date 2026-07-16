# Planner Weekday Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show English weekday abbreviations in weekly planner card titles and as a Monday-to-Sunday header in the monthly planner.

**Architecture:** Keep weekday display data in the existing planner model so weekly labels and the monthly header share one ordered constant. Reuse the current weekly card title and monthly seven-column grid; add only the header markup and its presentation styles.

**Tech Stack:** TypeScript, React 18, CSS, Vitest, Testing Library

## Global Constraints

- Use English abbreviations exactly as `Mon`, `Tue`, `Wed`, `Thu`, `Fri`, `Sat`, and `Sun`.
- Keep planner periods, item grouping, sorting, navigation, and monthly day-number titles unchanged.
- Add no dependency and no new component abstraction.

## File Structure

- Modify `frontend/src/features/workbench/model/planner-model.ts`: own the ordered weekday labels and build weekly card titles.
- Modify `frontend/src/features/workbench/ui/MainPanel.tsx`: render the monthly weekday header using the shared labels.
- Modify `frontend/src/styles/globals.css`: align and style the monthly header within the existing calendar grid.
- Modify `frontend/tests/domain/planner-model.spec.ts`: verify weekly title labels.
- Modify `frontend/tests/presentation/workbench-wireframe.spec.tsx`: verify monthly header semantics and order.

---

### Task 1: Add weekdays to weekly card titles

**Files:**
- Modify: `frontend/src/features/workbench/model/planner-model.ts`
- Test: `frontend/tests/domain/planner-model.spec.ts`

**Interfaces:**
- Consumes: `buildWeeklyPlannerModel(items: WorkspaceItemModel[], weekStart: string)` and its Monday-first seven-day sequence.
- Produces: `plannerWeekdayLabels` and weekly `WeeklyPlannerDay.label` values such as `Mon · 2026-07-06`.

- [ ] **Step 1: Write the failing model assertion**

Add this assertion to `builds weekly goals and seven day columns` after the existing length assertion:

```ts
expect(weekly.days.map((day) => day.label)).toEqual([
  "Mon · 2026-07-06",
  "Tue · 2026-07-07",
  "Wed · 2026-07-08",
  "Thu · 2026-07-09",
  "Fri · 2026-07-10",
  "Sat · 2026-07-11",
  "Sun · 2026-07-12",
]);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- tests/domain/planner-model.spec.ts -t "builds weekly goals and seven day columns"
```

Expected: FAIL because labels are still raw ISO dates.

- [ ] **Step 3: Add the shared labels and weekly title format**

Add near `monthLabels` in `planner-model.ts`:

```ts
export const plannerWeekdayLabels = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;
```

Change the weekly days mapping to use its existing Monday-first offset:

```ts
days: weekDates.map((date, index) => ({
  date,
  label: `${plannerWeekdayLabels[index]} · ${date}`,
  items: items.filter(
    (item) =>
      plannerWorkItemTypes.has(item.type) &&
      isVisiblePlannerWorkItem(item) &&
      datePart(item.scheduled) === date,
  ),
})),
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit the weekly behavior**

```bash
git add frontend/src/features/workbench/model/planner-model.ts frontend/tests/domain/planner-model.spec.ts
git commit -m "[UPDATE] Show weekdays in weekly planner titles" -m $'- 주간 카드 날짜 제목에 월요일부터 일요일까지 영문 약어를 병기\n- 공유 요일 순서를 모델에 정의하고 정확한 7일 레이블을 검증'
```

---

### Task 2: Add the monthly weekday header

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/styles/globals.css`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes: `plannerWeekdayLabels` from `planner-model.ts`.
- Produces: one accessible `Monthly weekdays` row with seven `columnheader` elements in Monday-to-Sunday order.

- [ ] **Step 1: Write the failing presentation assertion**

In the existing monthly planner presentation test, immediately after the `Monthly todo calendar` assertion, add:

```ts
const weekdayHeader = screen.getByRole("row", { name: "Monthly weekdays" });
expect(
  within(weekdayHeader).getAllByRole("columnheader").map((header) => header.textContent),
).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- tests/presentation/workbench-wireframe.spec.tsx -t "renders monthly period carousel and ISO Monday week goal cards"
```

Expected: FAIL because the named weekday row does not exist.

- [ ] **Step 3: Render the monthly header**

Import `plannerWeekdayLabels` from `planner-model.ts`, then add this markup inside `monthly-calendar-planner` before `model.weeks.map(...)`:

```tsx
<div className="monthly-week-row monthly-weekday-row" role="row" aria-label="Monthly weekdays">
  <div className="monthly-week-days">
    {plannerWeekdayLabels.map((day) => (
      <span className="monthly-weekday" role="columnheader" key={day}>
        {day}
      </span>
    ))}
  </div>
</div>
```

- [ ] **Step 4: Style the header with the existing seven-column layout**

Add after `.monthly-week-days` in `globals.css`:

```css
.monthly-weekday-row {
  align-items: end;
}

.monthly-weekday {
  color: var(--color-shade-60);
  font-size: 12px;
  font-weight: 700;
  text-align: center;
  text-transform: uppercase;
}
```

- [ ] **Step 5: Run the focused presentation test and verify GREEN**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 6: Run frontend verification**

```bash
npm test
npm run typecheck
```

Expected: all tests PASS and TypeScript exits with code 0.

- [ ] **Step 7: Commit the monthly behavior**

```bash
git add frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "[UPDATE] Add monthly planner weekday header" -m $'- 월간 달력 위에 월요일부터 일요일까지 7열 헤더를 표시\n- 기존 날짜 그리드와 goal rail 폭을 유지하고 접근 가능한 열 머리글로 검증'
```
