# Workspace Goal Period Picker Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve Workspace Goal period value selection for Year, Month, and Week while preserving existing canonical `horizon` plus `scheduled` storage.

**Architecture:** Keep the shared `GoalPeriodControl` popover, type selector, commit callback, dismissal behavior, and policy-error modal. Replace only the value picker rendered for each `GoalHorizon`, and add narrowly scoped helper functions/classes inside the existing workbench UI module.

**Tech Stack:** Next.js 14, React 18, TypeScript, Vitest, Testing Library, plain CSS in `frontend/src/styles/globals.css`.

## Global Constraints

- No API, service, or database changes.
- No new date-picker dependency.
- No free-form period parsing.
- Existing table/detail/create commit semantics remain unchanged.
- Stored values remain canonical: year = `YYYY-01-01`, month = `YYYY-MM-01`, week = ISO Monday.
- Do not change non-goal date controls.

---

## File Structure

- Modify `frontend/src/features/workbench/ui/MainPanel.tsx`
  - Keep `GoalPeriodControl` as the shared component.
  - Replace the year button list with a `<select>`.
  - Add `GoalMonthPicker`.
  - Extend `GoalPeriodCalendar` with hover-week preview classes.
  - Add helper functions: `goalYearOptions`, `yearValue`, `monthOptionDate`, `monthOptionLabel`, `goalPeriodCalendarDayClassName`.
- Modify `frontend/src/styles/globals.css`
  - Replace `.goal-period-year-list` button-grid styles with select styles.
  - Add month picker grid styles.
  - Add week preview/selected row highlight styles.
- Modify `frontend/tests/presentation/workbench-wireframe.spec.tsx`
  - Add focused presentation tests for year dropdown, month grid, and week row highlight.
  - Update existing year-button assertions to use the new `Goal year` select.

---

### Task 1: Replace Year Buttons With A Wide Year Dropdown

**Files:**
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/styles/globals.css`

**Interfaces:**
- Consumes: existing `GoalPeriodControl` props and `commit(date: string)`.
- Produces:
  - `goalYearOptions(selectedYear: number): number[]`
  - `yearValue(value: string): number`
  - Year UI with accessible label `Goal year`.

- [ ] **Step 1: Write the failing year dropdown tests**

Add these tests near the existing goal period popover tests in `frontend/tests/presentation/workbench-wireframe.spec.tsx`:

```tsx
  it("commits a goal year through a scrollable year dropdown", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/goal-1" && init?.method === "PATCH") {
        expect(init.body).toBe(
          JSON.stringify({ horizon: "year", scheduled: "2040-01-01" }),
        );

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "approved",
            horizon: "year",
            scheduled: "2040-01-01",
          }),
        });
      }

      return Promise.resolve({
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
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    await user.click(await screen.findByRole("button", { name: "Period for Goal" }));
    const picker = screen.getByRole("dialog", { name: "Period for Goal" });
    await user.click(within(picker).getByRole("button", { name: "Year" }));

    const yearSelect = within(picker).getByLabelText("Goal year");
    expect(yearSelect.tagName).toBe("SELECT");
    expect(within(yearSelect).getByRole("option", { name: "1976" })).toBeInTheDocument();
    expect(within(yearSelect).getByRole("option", { name: "2076" })).toBeInTheDocument();

    await user.selectOptions(yearSelect, "2040");

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Period for Goal" })).toBeNull(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/goal-1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("includes an out-of-range stored goal year in the dropdown", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: "goal-1",
              type: "goal",
              title: "Long Goal",
              status: "approved",
              horizon: "year",
              scheduled: "2120-01-01",
            },
          ],
        }),
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    await user.click(await screen.findByRole("button", { name: "Period for Long Goal" }));
    const picker = screen.getByRole("dialog", { name: "Period for Long Goal" });
    const yearSelect = within(picker).getByLabelText("Goal year");

    expect(within(yearSelect).getByRole("option", { name: "2120" })).toBeInTheDocument();
    expect(yearSelect).toHaveValue("2120");
  });
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
cd frontend && npx vitest run --no-file-parallelism tests/presentation/workbench-wireframe.spec.tsx -t "goal year"
```

Expected: FAIL because `Goal year` is currently rendered as a button group, not a `<select>`.

- [ ] **Step 3: Implement the year dropdown**

In `frontend/src/features/workbench/ui/MainPanel.tsx`, replace the `candidateHorizon === "year"` branch inside `GoalPeriodControl` with:

```tsx
            {candidateHorizon === "year" ? (
              <label className="field-label">
                <span>Goal year</span>
                <select
                  className="goal-period-year-select"
                  aria-label="Goal year"
                  value={candidateRange.start.slice(0, 4)}
                  onChange={(event) => void commit(`${event.target.value}-01-01`)}
                >
                  {goalYearOptions(yearValue(safeScheduled)).map((year) => (
                    <option value={year.toString()} key={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
```

Replace the existing `yearOptions` helper with:

```ts
function yearValue(value: string): number {
  return localDate(value).getFullYear();
}

function goalYearOptions(selectedYear: number): number[] {
  const currentYear = new Date().getFullYear();
  const defaultStart = currentYear - 50;
  const defaultEnd = currentYear + 50;
  const start = Math.min(defaultStart, selectedYear);
  const end = Math.max(defaultEnd, selectedYear);

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}
```

In `frontend/src/styles/globals.css`, replace `.goal-period-year-list` and `.goal-period-year-button[aria-pressed="true"]` with:

```css
.goal-period-year-select {
  width: 100%;
  min-height: 34px;
  border: 1px solid var(--color-shade-30);
  border-radius: var(--radius-xs);
  background: var(--color-canvas-light);
  padding: 0 8px;
  color: var(--color-ink);
  font: inherit;
}
```

- [ ] **Step 4: Update existing year tests that still click a year button**

In `frontend/tests/presentation/workbench-wireframe.spec.tsx`, replace both instances like:

```tsx
    await user.click(within(picker).getByRole("button", { name: "Year" }));
    await user.click(within(picker).getByRole("button", { name: "2026" }));
```

with:

```tsx
    await user.click(within(picker).getByRole("button", { name: "Year" }));
    await user.selectOptions(within(picker).getByLabelText("Goal year"), "2026");
```

This affects the tests named:

- `commits a same-year month goal to year exactly once and returns focus to the trigger`
- `shows a parent horizon error when an inline goal period change is rejected`

- [ ] **Step 5: Run the focused tests and verify they pass**

Run:

```bash
cd frontend && npx vitest run --no-file-parallelism tests/presentation/workbench-wireframe.spec.tsx -t "goal year|same-year month goal|parent horizon error"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add frontend/tests/presentation/workbench-wireframe.spec.tsx frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css
git commit -m "$(cat <<'EOF'
[UPDATE] Use dropdown for goal year selection

- Goal Period의 Year 선택을 넓은 범위의 select로 전환
- 기존 canonical year anchor와 inline period patch 흐름 유지
EOF
)"
```

---

### Task 2: Replace Month Calendar With Year Navigation And A 12-Month Grid

**Files:**
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/styles/globals.css`

**Interfaces:**
- Consumes: `candidateHorizon`, `candidateScheduled`, `commit(date: string)`, `monthLabel(value: string)`, `addMonth(value: string, months: number)`.
- Produces:
  - `GoalMonthPicker({ scheduled, onSelect })`
  - `monthOptionDate(year: number, monthIndex: number): string`
  - `monthOptionLabel(value: string): string`

- [ ] **Step 1: Write the failing month grid test**

Add this test near the goal period popover tests:

```tsx
  it("selects a goal month from a year-scoped month grid", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/todo-engine/items/goal-1" && init?.method === "PATCH") {
        expect(init.body).toBe(
          JSON.stringify({ horizon: "month", scheduled: "2027-03-01" }),
        );

        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: "goal-1",
            type: "goal",
            title: "Goal",
            status: "approved",
            horizon: "month",
            scheduled: "2027-03-01",
          }),
        });
      }

      return Promise.resolve({
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
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    await user.click(await screen.findByRole("button", { name: "Period for Goal" }));
    const picker = screen.getByRole("dialog", { name: "Period for Goal" });

    expect(within(picker).getByText("2026")).toBeInTheDocument();
    expect(within(picker).getByRole("button", { name: "June 2026" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(picker).queryByRole("button", { name: /June 10, 2026/ })).toBeNull();

    await user.click(within(picker).getByRole("button", { name: "Next year" }));
    expect(within(picker).getByText("2027")).toBeInTheDocument();
    await user.click(within(picker).getByRole("button", { name: "March 2027" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Period for Goal" })).toBeNull(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/goal-1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd frontend && npx vitest run --no-file-parallelism tests/presentation/workbench-wireframe.spec.tsx -t "year-scoped month grid"
```

Expected: FAIL because Month still renders `GoalPeriodCalendar`.

- [ ] **Step 3: Implement `GoalMonthPicker`**

In `frontend/src/features/workbench/ui/MainPanel.tsx`, change the `candidateHorizon` render branch to use the new month picker:

```tsx
            {candidateHorizon === "year" ? (
              <label className="field-label">
                <span>Goal year</span>
                <select
                  className="goal-period-year-select"
                  aria-label="Goal year"
                  value={candidateRange.start.slice(0, 4)}
                  onChange={(event) => void commit(`${event.target.value}-01-01`)}
                >
                  {goalYearOptions(yearValue(safeScheduled)).map((year) => (
                    <option value={year.toString()} key={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
            ) : candidateHorizon === "month" ? (
              <GoalMonthPicker scheduled={candidateScheduled} onSelect={commit} />
            ) : (
              <GoalPeriodCalendar
                horizon={candidateHorizon}
                scheduled={candidateScheduled}
                onSelect={commit}
              />
            )}
```

Add this component above `GoalPeriodCalendar`:

```tsx
function GoalMonthPicker({
  scheduled,
  onSelect,
}: {
  scheduled: string;
  onSelect: (date: string) => void;
}) {
  const [viewYear, setViewYear] = React.useState(() => yearValue(scheduled));
  const selectedMonth = monthStart(scheduled);

  React.useEffect(() => {
    setViewYear(yearValue(scheduled));
  }, [scheduled]);

  return (
    <div className="goal-period-month-picker">
      <div className="goal-period-calendar-header">
        <button
          type="button"
          aria-label="Previous year"
          onClick={(event) => {
            stopRowEvent(event);
            setViewYear((current) => current - 1);
          }}
        >
          &lt;
        </button>
        <span>{viewYear}</span>
        <button
          type="button"
          aria-label="Next year"
          onClick={(event) => {
            stopRowEvent(event);
            setViewYear((current) => current + 1);
          }}
        >
          &gt;
        </button>
      </div>
      <div className="goal-period-month-grid" aria-label="Goal month">
        {Array.from({ length: 12 }, (_, monthIndex) => {
          const date = monthOptionDate(viewYear, monthIndex);
          const selected = date === selectedMonth;
          return (
            <button
              type="button"
              key={date}
              className="goal-period-month-button"
              aria-label={monthOptionLabel(date)}
              aria-pressed={selected}
              onClick={(event) => {
                stopRowEvent(event);
                onSelect(date);
              }}
            >
              {localDate(date).toLocaleDateString("en-US", { month: "short" })}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

Add these helpers near `monthLabel`:

```ts
function monthOptionDate(year: number, monthIndex: number): string {
  return localDateValue(new Date(year, monthIndex, 1));
}

function monthOptionLabel(value: string): string {
  return localDate(value).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}
```

- [ ] **Step 4: Add month grid CSS**

In `frontend/src/styles/globals.css`, add:

```css
.goal-period-month-picker {
  display: grid;
  gap: 8px;
  width: 100%;
}

.goal-period-month-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
}

.goal-period-month-button {
  min-height: 34px;
  border: 1px solid var(--color-shade-30);
  border-radius: var(--radius-xs);
  background: transparent;
  color: var(--color-text);
  font: inherit;
}

.goal-period-month-button[aria-pressed="true"] {
  border-color: var(--color-ink);
  background: var(--color-ink);
  color: var(--color-on-dark);
}
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run:

```bash
cd frontend && npx vitest run --no-file-parallelism tests/presentation/workbench-wireframe.spec.tsx -t "year-scoped month grid"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add frontend/tests/presentation/workbench-wireframe.spec.tsx frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css
git commit -m "$(cat <<'EOF'
[UPDATE] Add month grid for goal period selection

- Goal Period의 Month 선택을 연도 이동 가능한 12개월 그리드로 전환
- 월 선택 시 기존 month canonical anchor와 단일 commit 흐름 유지
EOF
)"
```

---

### Task 3: Highlight Whole ISO Weeks On Hover And Selection

**Files:**
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/styles/globals.css`

**Interfaces:**
- Consumes: `GoalPeriodCalendar({ horizon: "week", scheduled, onSelect })`, `isoWeekStart(value)`, `goalPeriodRange(horizon, scheduled)`.
- Produces:
  - `goalPeriodCalendarDayClassName(...)`
  - CSS classes `.goal-period-calendar-day-preview`, `.goal-period-calendar-day-range-start`, `.goal-period-calendar-day-range-end`

- [ ] **Step 1: Write the failing week highlight test**

Add this test near `patches a goal period through the inline calendar with an ISO week anchor`:

```tsx
  it("previews and selects goal weeks as a full calendar row", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
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
      ),
    );

    render(<WorkbenchPageClient />);
    await user.click(screen.getByRole("button", { name: "ToDo" }));
    await user.click(screen.getByRole("button", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Goals" }));

    await user.click(await screen.findByRole("button", { name: "Period for Goal" }));
    const picker = screen.getByRole("dialog", { name: "Period for Goal" });
    const july10 = within(picker).getByRole("button", { name: /July 10, 2026/ });

    const selectedDays = within(picker)
      .getAllByRole("button")
      .filter((button) =>
        button.classList.contains("goal-period-calendar-day-selected"),
      );
    expect(selectedDays.map((button) => button.textContent)).toEqual([
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
    ]);

    fireEvent.mouseEnter(july10);

    const previewDays = within(picker)
      .getAllByRole("button")
      .filter((button) =>
        button.classList.contains("goal-period-calendar-day-preview"),
      );
    expect(previewDays.map((button) => button.textContent)).toEqual([
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
    ]);
    expect(previewDays[0]).toHaveClass("goal-period-calendar-day-range-start");
    expect(previewDays[6]).toHaveClass("goal-period-calendar-day-range-end");

    fireEvent.mouseLeave(july10);
    expect(
      within(picker)
        .getAllByRole("button")
        .filter((button) =>
          button.classList.contains("goal-period-calendar-day-preview"),
        ),
    ).toHaveLength(0);
  });
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
cd frontend && npx vitest run --no-file-parallelism tests/presentation/workbench-wireframe.spec.tsx -t "full calendar row"
```

Expected: FAIL because preview and range-edge classes do not exist.

- [ ] **Step 3: Implement week hover state and class generation**

In `GoalPeriodCalendar`, add hover state after `cells`:

```tsx
  const [hoveredDate, setHoveredDate] = React.useState<string | null>(null);
  const previewRange =
    horizon === "week" && hoveredDate ? goalPeriodRange("week", hoveredDate) : null;
```

Replace the current `className` expression for calendar day buttons with:

```tsx
              className={goalPeriodCalendarDayClassName({
                cell,
                selected,
                previewed:
                  previewRange !== null &&
                  cell.date >= previewRange.start &&
                  cell.date <= previewRange.end,
                rangeStart:
                  horizon === "week" &&
                  (cell.date === range.start || cell.date === previewRange?.start),
                rangeEnd:
                  horizon === "week" &&
                  (cell.date === range.end || cell.date === previewRange?.end),
              })}
```

Add mouse handlers to the same button:

```tsx
              onMouseEnter={() => {
                if (horizon === "week") {
                  setHoveredDate(cell.date);
                }
              }}
              onMouseLeave={() => {
                if (horizon === "week") {
                  setHoveredDate(null);
                }
              }}
```

Add this helper near `calendarMonthDays`:

```ts
function goalPeriodCalendarDayClassName({
  cell,
  selected,
  previewed,
  rangeStart,
  rangeEnd,
}: {
  cell: CalendarCell;
  selected: boolean;
  previewed: boolean;
  rangeStart: boolean;
  rangeEnd: boolean;
}): string {
  return [
    "goal-period-calendar-day",
    cell.inMonth ? "" : "goal-period-calendar-day-muted",
    selected ? "goal-period-calendar-day-selected" : "",
    previewed ? "goal-period-calendar-day-preview" : "",
    rangeStart ? "goal-period-calendar-day-range-start" : "",
    rangeEnd ? "goal-period-calendar-day-range-end" : "",
  ]
    .filter(Boolean)
    .join(" ");
}
```

- [ ] **Step 4: Add week row highlight CSS**

In `frontend/src/styles/globals.css`, change the base calendar day radius to `0`:

```css
.goal-period-calendar-day {
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--color-text);
}
```

Then replace the current selected-day style block with:

```css
.goal-period-calendar-day-selected,
.goal-period-calendar-day-preview {
  background: var(--color-accent-soft);
  color: var(--color-accent-strong);
}

.goal-period-calendar-day-preview:not(.goal-period-calendar-day-selected) {
  outline: 1px solid var(--color-accent-strong);
  outline-offset: -1px;
}

.goal-period-calendar-day-range-start {
  border-top-left-radius: var(--radius-xs);
  border-bottom-left-radius: var(--radius-xs);
}

.goal-period-calendar-day-range-end {
  border-top-right-radius: var(--radius-xs);
  border-bottom-right-radius: var(--radius-xs);
}
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run:

```bash
cd frontend && npx vitest run --no-file-parallelism tests/presentation/workbench-wireframe.spec.tsx -t "full calendar row|ISO week anchor"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add frontend/tests/presentation/workbench-wireframe.spec.tsx frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css
git commit -m "$(cat <<'EOF'
[UPDATE] Highlight goal weeks as calendar rows

- Goal Period의 Week 선택에서 hover와 선택 상태를 ISO 주 전체로 표시
- 기존 ISO Monday anchor 저장과 calendar commit 동작 유지
EOF
)"
```

---

### Task 4: Run Regression Gates

**Files:**
- Verify only.

**Interfaces:**
- Consumes: all changes from Tasks 1-3.
- Produces: verified frontend period picker behavior.

- [ ] **Step 1: Run the workbench presentation suite**

```bash
cd frontend && npx vitest run --no-file-parallelism tests/presentation/workbench-wireframe.spec.tsx
```

Expected: PASS.

- [ ] **Step 2: Run frontend typecheck**

```bash
npm --prefix frontend run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run frontend tests**

```bash
npm --prefix frontend test
```

Expected: PASS.

- [ ] **Step 4: Inspect final diff and status**

```bash
git status --short
git log --oneline -n 8
```

Expected: no uncommitted changes from the implementation tasks. The latest commits should be the three `[UPDATE]` commits from this plan.

---

## Self-Review

- Spec coverage: Year dropdown, out-of-range stored year, Month year navigation plus 12-month grid, Week hover/selected full-row highlight, canonical anchors, no backend/API/schema changes, and existing error flow are all covered by tasks.
- Placeholder scan: No `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: Planned helpers and component props all use existing `GoalHorizon`, `CalendarCell`, and `string` date values from `MainPanel.tsx`.
