# Goal Period Current View Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add non-committing current-period view reset buttons to the Workspace Goal Month and Week period pickers.

**Architecture:** Keep `GoalPeriodControl` as the shared commit boundary. Add view-only reset buttons inside `GoalMonthPicker` and `GoalPeriodCalendar`; these buttons change only local view state and never call `onSelect` or `commit`.

**Tech Stack:** Next.js 14, React 18, TypeScript, Vitest, Testing Library, plain CSS in `frontend/src/styles/globals.css`.

## Global Constraints

- No API, service, or database changes.
- No new date-picker dependency.
- No free-form period parsing.
- Existing table/detail/create commit semantics remain unchanged.
- Stored values remain canonical: year = `YYYY-01-01`, month = `YYYY-MM-01`, week = ISO Monday.
- Do not change non-goal date controls.
- `This year` and `This month` change only the visible picker view; they do not commit a period.

---

## File Structure

- Modify `frontend/src/features/workbench/ui/MainPanel.tsx`
  - Add a `This year` button to `GoalMonthPicker`.
  - Add a `This month` button to `GoalPeriodCalendar`.
  - Reuse existing date helpers: `todayValue`, `yearValue`, `monthStart`.
- Modify `frontend/src/styles/globals.css`
  - Add compact styling for the reset buttons using existing period picker classes/tokens.
- Modify `frontend/tests/presentation/workbench-wireframe.spec.tsx`
  - Add tests proving reset buttons return the visible view without PATCH/commit.

---

### Task 1: Add Month And Week View Reset Buttons

**Files:**
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/styles/globals.css`

**Interfaces:**
- Consumes:
  - `todayValue(): string`
  - `yearValue(value: string): number`
  - `monthStart(value: string): string`
  - existing `GoalMonthPicker({ scheduled, onSelect })`
  - existing `GoalPeriodCalendar({ horizon, scheduled, onSelect })`
- Produces:
  - `This year` button in `GoalMonthPicker`
  - `This month` button in `GoalPeriodCalendar`
  - `.goal-period-view-reset` CSS class

- [ ] **Step 1: Write failing presentation tests**

Add these tests near the existing period picker tests in `frontend/tests/presentation/workbench-wireframe.spec.tsx`:

```tsx
  it("returns the month picker to this year without committing a period", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "approved",
            horizon: "month",
            scheduled: "2026-06-01",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    await user.click(await screen.findByRole("button", { name: "Period for Goal" }));
    const picker = screen.getByRole("dialog", { name: "Period for Goal" });
    const currentYear = new Date().getFullYear();

    await user.click(within(picker).getByRole("button", { name: "Next year" }));
    expect(within(picker).getByText(String(2027))).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: "This year" })).toBeEnabled();

    await user.click(within(picker).getByRole("button", { name: "This year" }));

    expect(within(picker).getByText(String(currentYear))).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: "This year" })).toBeDisabled();
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(0);
    expect(screen.getByRole("dialog", { name: "Period for Goal" })).toBeInTheDocument();
  });

  it("returns the week calendar to this month without committing a period", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => [
          {
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "approved",
            horizon: "week",
            scheduled: "2026-07-06",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    await user.click(await screen.findByRole("button", { name: "Period for Goal" }));
    const picker = screen.getByRole("dialog", { name: "Period for Goal" });

    await user.click(within(picker).getByRole("button", { name: "Next month" }));
    expect(within(picker).getByText("August 2026")).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: "This month" })).toBeEnabled();

    await user.click(within(picker).getByRole("button", { name: "This month" }));

    expect(within(picker).getByText(monthLabelForDate(new Date()))).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: "This month" })).toBeDisabled();
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH"),
    ).toHaveLength(0);
    expect(screen.getByRole("dialog", { name: "Period for Goal" })).toBeInTheDocument();
  });
```

Add this helper near the existing test date helpers:

```tsx
function monthLabelForDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run:

```bash
cd frontend && npx vitest run --no-file-parallelism tests/presentation/workbench-wireframe.spec.tsx -t "returns the month picker|returns the week calendar"
```

Expected: FAIL because `This year` and `This month` buttons do not exist.

- [ ] **Step 3: Implement `This year` in `GoalMonthPicker`**

In `GoalMonthPicker`, add a current-year value:

```tsx
  const currentYear = yearValue(todayValue());
```

Then render this button after the year header and before the month grid:

```tsx
      <button
        type="button"
        className="goal-period-view-reset"
        disabled={viewYear === currentYear}
        onClick={(event) => {
          stopRowEvent(event);
          setViewYear(currentYear);
        }}
      >
        This year
      </button>
```

The button must not call `onSelect`.

- [ ] **Step 4: Implement `This month` in `GoalPeriodCalendar`**

In `GoalPeriodCalendar`, add a current-month value:

```tsx
  const currentMonth = monthStart(todayValue());
```

Then render this button after the month header and before the calendar grid:

```tsx
      <button
        type="button"
        className="goal-period-view-reset"
        disabled={viewMonth === currentMonth}
        onClick={(event) => {
          stopRowEvent(event);
          setViewMonth(currentMonth);
        }}
      >
        This month
      </button>
```

The button must not call `onSelect`.

- [ ] **Step 5: Add compact reset button CSS**

In `frontend/src/styles/globals.css`, add near the period picker styles:

```css
.goal-period-view-reset {
  justify-self: center;
  min-height: 28px;
  border: 1px solid var(--color-shade-30);
  border-radius: var(--radius-xs);
  background: var(--color-canvas-light);
  padding: 0 8px;
  color: var(--color-ink);
  font-size: 12px;
}

.goal-period-view-reset:disabled {
  cursor: not-allowed;
  color: var(--color-text-muted);
}
```

- [ ] **Step 6: Run focused tests and verify they pass**

Run:

```bash
cd frontend && npx vitest run --no-file-parallelism tests/presentation/workbench-wireframe.spec.tsx -t "returns the month picker|returns the week calendar"
```

Expected: PASS.

- [ ] **Step 7: Run frontend verification**

Run:

```bash
npm --prefix frontend run typecheck
npm --prefix frontend test
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/tests/presentation/workbench-wireframe.spec.tsx frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css
git commit -m "$(cat <<'EOF'
[UPDATE] Add goal period current view reset buttons

- Month picker에서 현재 연도 보기로 복귀하는 버튼 추가
- Week picker에서 현재 월 보기로 복귀하는 버튼 추가
- 복귀 버튼이 period commit 없이 view 상태만 바꾸도록 테스트 추가
EOF
)"
```

---

## Self-Review

- Spec coverage: Month `This year` and Week `This month` view-only reset behavior, disabled current-view states, and no commit behavior are covered.
- Placeholder scan: No `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: Planned changes use existing `string` date helpers and local React state already present in `MainPanel.tsx`.
