# Workspace Goal Period Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace separate Workspace Goal `Horizon`, `Scheduled`, and `Due` inputs with one `Period` UI that stores the existing `horizon` and canonical `scheduled` fields.

**Architecture:** Keep the backend API and model unchanged. Add a small dependency-free period control inside `frontend/src/features/workbench/ui/MainPanel.tsx`; it converts user selections into `{ horizon, scheduled }` patches and creation payloads. Use CSS in `frontend/src/styles/globals.css` only for the calendar range highlight.

**Tech Stack:** React 18, Next.js 14, TypeScript, Testing Library, Vitest, existing CSS.

## Global Constraints

- No schema changes.
- No service-layer changes.
- No new API endpoint.
- No new date picker dependency.
- No `due` field for goals in table, detail, or creation.
- Month and week goals do not ask users to type `YYYY-MM-DD`.
- Month calendar clicks store the first day of that month.
- Week calendar clicks store the ISO Monday of that week.
- The UI highlights the full selected month or Monday-Sunday week range.

---

## File Structure

- Modify `frontend/src/features/workbench/ui/MainPanel.tsx`
  - Add goal period date helpers near existing date helpers.
  - Add `GoalPeriodControl` and `GoalPeriodCalendar` near other field controls.
  - Replace goal detail fields and goal table columns.
  - Replace goal creation `Scheduled`/`Horizon` controls with the same period control.
- Modify `frontend/src/styles/globals.css`
  - Add compact calendar grid styles and selected-range highlight classes.
- Modify `frontend/tests/presentation/workbench-wireframe.spec.tsx`
  - Update existing goal field tests.
  - Add creation and inline patch coverage for month/week canonicalization.

---

### Task 1: Lock Goal Period UI Contract In Tests

**Files:**
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes: existing `WorkbenchPageClient`.
- Produces: failing tests that require `Period` controls and reject goal `Due`.

- [ ] **Step 1: Update the creation dialog focus test**

Replace the goal-specific expectations in `focuses and traps the creation dialog through every control, and closes it on escape`:

```tsx
await user.tab();
expect(screen.getByLabelText("Period type")).toHaveFocus();

await user.tab();
expect(screen.getByLabelText("Goal year")).toHaveFocus();

await user.tab();
expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

await user.tab();
expect(screen.getByRole("button", { name: "Create" })).toHaveFocus();
```

- [ ] **Step 2: Replace the horizon/scheduled creation test**

Rename `shows only supported goal horizons and requires a scheduled date` to `creates workspace goals through one period control`.

Use this test body:

```tsx
const user = userEvent.setup();
const fetchMock = vi.fn((url: string, init?: RequestInit) => {
  if (url === "/todo-engine/goals/propose" && init?.method === "POST") {
    expect(init.body).toBe(
      JSON.stringify({
        title: "July goal",
        horizon: "month",
        scheduled: "2026-07-01",
        actor: "user",
      }),
    );
    return Promise.resolve({
      ok: true,
      json: async () => ({
        id: "goal-new",
        type: "goal",
        title: "July goal",
        status: "approved",
        horizon: "month",
        scheduled: "2026-07-01",
      }),
    });
  }

  return Promise.resolve({ ok: true, json: async () => [] });
});
vi.stubGlobal("fetch", fetchMock);

render(<WorkbenchPageClient />);
await user.click(screen.getByRole("button", { name: "ToDo" }));
await user.click(screen.getByRole("button", { name: "Workspace" }));
await user.click(screen.getByRole("button", { name: "Goals" }));
await user.click(screen.getByRole("button", { name: "Add item" }));

expect(screen.getByLabelText("Period type")).toHaveValue("year");
expect(screen.queryByLabelText("Scheduled")).toBeNull();
expect(screen.queryByLabelText("Horizon")).toBeNull();
expect(screen.queryByLabelText("Due")).toBeNull();

await user.type(screen.getByLabelText("Title"), "July goal");
await user.selectOptions(screen.getByLabelText("Period type"), "month");
await user.click(screen.getByRole("button", { name: "July 15, 2026" }));
expect(screen.getByText("2026-07-01 to 2026-07-31")).toBeInTheDocument();

await user.click(screen.getByRole("button", { name: "Create" }));
expect(fetchMock).toHaveBeenCalledWith(
  "/todo-engine/goals/propose",
  expect.objectContaining({ method: "POST" }),
);
```

- [ ] **Step 3: Update the table/detail field test**

In `shows the same goal fields in the table and detail`:

- Remove `due` from goal fixtures.
- Replace table assertions for horizon/scheduled/due with:

```tsx
expect(screen.getByLabelText("Period for June outcome")).toHaveTextContent(
  "Month: 2026-06-01 to 2026-06-30",
);
expect(screen.queryByLabelText("Due for June outcome")).toBeNull();
expect(screen.queryByLabelText("Horizon for June outcome")).toBeNull();
expect(screen.queryByLabelText("Scheduled for June outcome")).toBeNull();
```

- Replace detail assertions with:

```tsx
expect(screen.getByLabelText("Period type")).toHaveValue("month");
expect(screen.getByText("2026-06-01 to 2026-06-30")).toBeInTheDocument();
expect(screen.queryByLabelText("Due")).toBeNull();
expect(screen.queryByLabelText("Horizon")).toBeNull();
expect(screen.queryByLabelText("Scheduled")).toBeNull();
expect(screen.getByLabelText("Parent")).toHaveValue("goal-root");
expect(screen.getByLabelText("Note")).toHaveValue("Ship the monthly target");
```

- [ ] **Step 4: Add inline week patch coverage**

Append this test near existing inline patch tests:

```tsx
it("patches a goal period through the inline calendar with an ISO week anchor", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (String(url).includes("/items/goal-1") && init?.method === "PATCH") {
      expect(init.body).toBe(
        JSON.stringify({ horizon: "week", scheduled: "2026-07-06" }),
      );
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: "goal-1",
          type: "goal",
          title: "Goal",
          status: "approved",
          horizon: "week",
          scheduled: "2026-07-06",
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

  await user.selectOptions(await screen.findByLabelText("Period type for Goal"), "week");
  await user.click(screen.getByRole("button", { name: "July 10, 2026" }));

  expect(fetchMock).toHaveBeenCalledWith(
    "/todo-engine/items/goal-1",
    expect.objectContaining({ method: "PATCH" }),
  );
  expect(screen.queryByRole("heading", { name: "Goal" })).not.toBeInTheDocument();
});
```

- [ ] **Step 5: Run the targeted test and confirm failure**

Run:

```bash
cd frontend && npm test -- workbench-wireframe.spec.tsx
```

Expected: FAIL because `Period type`, `Goal year`, and calendar day buttons do not exist yet.

---

### Task 2: Add Goal Period Helpers And Display Formatting

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`

**Interfaces:**
- Produces:
  - `type GoalHorizon = "year" | "month" | "week"`
  - `canonicalGoalScheduled(horizon: GoalHorizon, date: string): string`
  - `goalPeriodRange(horizon: GoalHorizon, scheduled: string): { start: string; end: string }`
  - `displayGoalPeriod(item: WorkspaceItemModel): string`

- [ ] **Step 1: Add the helper types and functions near `formatDateValue`**

Add:

```tsx
type GoalHorizon = "year" | "month" | "week";

const goalHorizons: GoalHorizon[] = ["year", "month", "week"];
const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function isGoalHorizon(value: string | null | undefined): value is GoalHorizon {
  return value === "year" || value === "month" || value === "week";
}

function localDate(value: string): Date {
  const [year = "1970", month = "1", day = "1"] = value.split("-");
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function localDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addLocalDays(value: string, days: number): string {
  const date = localDate(value);
  date.setDate(date.getDate() + days);
  return localDateValue(date);
}

function monthStart(value: string): string {
  const date = localDate(value);
  return localDateValue(new Date(date.getFullYear(), date.getMonth(), 1));
}

function monthEnd(value: string): string {
  const date = localDate(value);
  return localDateValue(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

function yearStart(value: string): string {
  return `${localDate(value).getFullYear()}-01-01`;
}

function yearEnd(value: string): string {
  return `${localDate(value).getFullYear()}-12-31`;
}

function isoWeekStart(value: string): string {
  const date = localDate(value);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return localDateValue(date);
}

function canonicalGoalScheduled(horizon: GoalHorizon, date: string): string {
  if (horizon === "year") return yearStart(date);
  if (horizon === "month") return monthStart(date);
  return isoWeekStart(date);
}

function goalPeriodRange(
  horizon: GoalHorizon,
  scheduled: string,
): { start: string; end: string } {
  const start = canonicalGoalScheduled(horizon, scheduled);
  if (horizon === "year") return { start, end: yearEnd(start) };
  if (horizon === "month") return { start, end: monthEnd(start) };
  return { start, end: addLocalDays(start, 6) };
}

function displayGoalPeriod(item: WorkspaceItemModel): string {
  const horizon = isGoalHorizon(item.horizon) ? item.horizon : "month";
  const scheduled = formatDateValue(item.scheduled) || canonicalGoalScheduled(horizon, todayValue());
  const range = goalPeriodRange(horizon, scheduled);
  return `${capitalize(horizon)}: ${range.start} to ${range.end}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function todayValue(): string {
  return localDateValue(new Date());
}
```

- [ ] **Step 2: Run typecheck to verify helper syntax**

Run:

```bash
cd frontend && npm run typecheck
```

Expected: PASS or only failures unrelated to this file. If `noUnusedLocals` flags a helper, keep the helper only if the next task uses it.

---

### Task 3: Implement The Reusable Goal Period Control

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`

**Interfaces:**
- Consumes: helpers from Task 2.
- Produces:
  - `GoalPeriodControl`
  - `GoalPeriodCalendar`
  - `calendarMonthDays`

- [ ] **Step 1: Add control props and component near other detail field controls**

Add:

```tsx
type GoalPeriodControlProps = {
  label: string;
  horizon: string | null | undefined;
  scheduled: string | null | undefined;
  onCommit: (period: { horizon: GoalHorizon; scheduled: string }) => void;
  commitOnChange?: boolean;
};

function GoalPeriodControl({
  label,
  horizon,
  scheduled,
  onCommit,
  commitOnChange = true,
}: GoalPeriodControlProps) {
  const safeHorizon = isGoalHorizon(horizon) ? horizon : "year";
  const safeScheduled =
    formatDateValue(scheduled) || canonicalGoalScheduled(safeHorizon, todayValue());
  const range = goalPeriodRange(safeHorizon, safeScheduled);

  function commit(nextHorizon: GoalHorizon, date: string) {
    onCommit({
      horizon: nextHorizon,
      scheduled: canonicalGoalScheduled(nextHorizon, date),
    });
  }

  return (
    <div className="goal-period-control" aria-label={label}>
      <label className="field-label">
        Period type
        <select
          aria-label={label.includes(" for ") ? label.replace("Period", "Period type") : "Period type"}
          value={safeHorizon}
          onChange={(event) => {
            const nextHorizon = event.target.value as GoalHorizon;
            if (commitOnChange) {
              commit(nextHorizon, safeScheduled);
            } else {
              onCommit({
                horizon: nextHorizon,
                scheduled: canonicalGoalScheduled(nextHorizon, safeScheduled),
              });
            }
          }}
        >
          {goalHorizons.map((option) => (
            <option key={option} value={option}>
              {capitalize(option)}
            </option>
          ))}
        </select>
      </label>

      {safeHorizon === "year" ? (
        <label className="field-label">
          Goal year
          <select
            aria-label={label.includes(" for ") ? label.replace("Period", "Goal year") : "Goal year"}
            value={range.start.slice(0, 4)}
            onChange={(event) => commit("year", `${event.target.value}-01-01`)}
          >
            {yearOptions(Number(range.start.slice(0, 4))).map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <GoalPeriodCalendar
          horizon={safeHorizon}
          scheduled={safeScheduled}
          onSelect={(date) => commit(safeHorizon, date)}
        />
      )}

      <p className="goal-period-range">{range.start} to {range.end}</p>
    </div>
  );
}
```

- [ ] **Step 2: Add year options and calendar grid helpers**

Add:

```tsx
function yearOptions(selectedYear: number): number[] {
  const currentYear = new Date().getFullYear();
  const start = Math.min(selectedYear, currentYear) - 2;
  const end = Math.max(selectedYear, currentYear) + 5;
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

type CalendarCell = {
  date: string;
  day: number;
  inMonth: boolean;
};

function calendarMonthDays(anchor: string): CalendarCell[] {
  const first = localDate(monthStart(anchor));
  const startOffset = (first.getDay() || 7) - 1;
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - startOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return {
      date: localDateValue(date),
      day: date.getDate(),
      inMonth: date.getMonth() === first.getMonth(),
    };
  });
}

function monthLabel(value: string): string {
  return localDate(value).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}
```

- [ ] **Step 3: Add the calendar component**

Add:

```tsx
function GoalPeriodCalendar({
  horizon,
  scheduled,
  onSelect,
}: {
  horizon: Exclude<GoalHorizon, "year">;
  scheduled: string;
  onSelect: (date: string) => void;
}) {
  const range = goalPeriodRange(horizon, scheduled);
  const cells = calendarMonthDays(scheduled);

  return (
    <div className="goal-period-calendar">
      <div className="goal-period-calendar-header">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => onSelect(addMonth(scheduled, -1))}
        >
          &lt;
        </button>
        <span>{monthLabel(scheduled)}</span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => onSelect(addMonth(scheduled, 1))}
        >
          &gt;
        </button>
      </div>
      <div className="goal-period-calendar-grid">
        {dayLabels.map((day) => (
          <span className="goal-period-calendar-weekday" key={day}>
            {day}
          </span>
        ))}
        {cells.map((cell) => {
          const selected = cell.date >= range.start && cell.date <= range.end;
          return (
            <button
              type="button"
              key={cell.date}
              className={[
                "goal-period-calendar-day",
                cell.inMonth ? "" : "goal-period-calendar-day-muted",
                selected ? "goal-period-calendar-day-selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-label={localDate(cell.date).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
              aria-pressed={selected}
              onClick={() => onSelect(cell.date)}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function addMonth(value: string, months: number): string {
  const date = localDate(value);
  date.setMonth(date.getMonth() + months, 1);
  return localDateValue(date);
}
```

- [ ] **Step 4: Run typecheck**

Run:

```bash
cd frontend && npm run typecheck
```

Expected: PASS.

---

### Task 4: Replace Goal Detail, Creation, And Table Inputs

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`

**Interfaces:**
- Consumes: `GoalPeriodControl`.
- Produces: goal `Period` table/detail/create UI.

- [ ] **Step 1: Remove `due` from goal patches**

Change the goal branch in `detailPatchForItem` to:

```tsx
if (item.type === "goal") {
  addStringPatch(patch, "horizon", draft.horizon, item.horizon);
  addStringPatch(patch, "scheduled", draft.scheduled, item.scheduled);
}
```

- [ ] **Step 2: Replace goal detail fields**

Replace the `if (item.type === "goal")` field block's horizon/scheduled/due fields with:

```tsx
<GoalPeriodControl
  label="Period"
  horizon={draft.horizon}
  scheduled={draft.scheduled}
  commitOnChange={false}
  onCommit={({ horizon, scheduled }) => {
    setField("horizon", horizon);
    setField("scheduled", scheduled);
  }}
/>
```

Keep `Parent`, timestamps, and `Note` unchanged.

- [ ] **Step 3: Add an inline goal period column**

Replace `horizonColumn()` with:

```tsx
function goalPeriodColumn(): ItemColumn {
  return {
    label: "Period",
    value: (item, _items, controller) => (
      <GoalPeriodControl
        label={`Period for ${item.title}`}
        horizon={item.horizon}
        scheduled={item.scheduled}
        onCommit={({ horizon, scheduled }) =>
          void controller.patchWorkspaceItem(item.id, { horizon, scheduled })
        }
      />
    ),
  };
}
```

- [ ] **Step 4: Remove `Horizon`, `Scheduled`, and `Due` from goal columns**

Change the `goals` column list to:

```tsx
goals: [
  ...sharedColumns,
  tagsColumn(),
  goalPeriodColumn(),
  parentGoalColumn(),
  { label: "Note", value: (item) => displayValue(item.note) },
  { label: "Created", value: (item) => formatDate(item.created_at) },
  { label: "Updated", value: (item) => formatDate(item.updated_at) },
],
```

- [ ] **Step 5: Replace goal creation controls**

In `CreationDialog`, replace `needsScheduled`/`needsHorizon` for workspace goals with a single goal-period condition:

```tsx
const needsGoalPeriod = isGoal || isPlannerGoal;
const needsScheduled =
  controller.panel.id === "events" ||
  ((controller.panel.id === "weekly" || controller.panel.id === "daily") &&
    (itemType === "task" || itemType === "event"));
```

Then render:

```tsx
{needsGoalPeriod ? (
  <GoalPeriodControl
    label="Period"
    horizon={horizon}
    scheduled={scheduled}
    commitOnChange={false}
    onCommit={({ horizon, scheduled }) => {
      setHorizon(horizon);
      setScheduled(scheduled);
    }}
  />
) : null}
```

Remove the old `Horizon` select from creation.

- [ ] **Step 6: Make workspace goal default to the current year**

Change `defaultCreationScheduled`/`defaultCreationHorizon` only if needed so Workspace Goals open as:

```tsx
horizon = "year"
scheduled = `${new Date().getFullYear()}-01-01`
```

Keep planner screen defaults (`yearly`, `monthly`, `weekly`) unchanged.

- [ ] **Step 7: Run targeted tests**

Run:

```bash
cd frontend && npm test -- workbench-wireframe.spec.tsx
```

Expected: tests added in Task 1 PASS.

---

### Task 5: Style The Goal Calendar Without New Dependencies

**Files:**
- Modify: `frontend/src/styles/globals.css`
- Modify: `frontend/tests/architecture/design-boundaries.spec.ts`

**Interfaces:**
- Consumes: class names from `GoalPeriodControl`.
- Produces: compact grid and range highlight.

- [ ] **Step 1: Add CSS**

Append near existing detail/input styles:

```css
.goal-period-control {
  display: grid;
  gap: 8px;
  min-width: 220px;
}

.goal-period-range {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

.goal-period-calendar {
  display: grid;
  gap: 6px;
}

.goal-period-calendar-header {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) 28px;
  align-items: center;
  gap: 4px;
}

.goal-period-calendar-header span {
  text-align: center;
  font-size: 12px;
  font-weight: 600;
}

.goal-period-calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 28px);
  gap: 2px;
}

.goal-period-calendar-weekday,
.goal-period-calendar-day {
  min-height: 28px;
  font-size: 11px;
}

.goal-period-calendar-weekday {
  display: grid;
  place-items: center;
  color: var(--color-text-muted);
}

.goal-period-calendar-day {
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text);
}

.goal-period-calendar-day-muted {
  color: var(--color-text-muted);
}

.goal-period-calendar-day-selected {
  background: var(--color-accent-soft);
  color: var(--color-accent-strong);
}
```

- [ ] **Step 2: Extend architecture CSS boundary test**

Add to `frontend/tests/architecture/design-boundaries.spec.ts`:

```ts
it("keeps goal period calendar dependency-free", async () => {
  const source = await readSource("src/features/workbench/ui/MainPanel.tsx");

  expect(source).toContain("GoalPeriodCalendar");
  expect(source).not.toContain("react-datepicker");
  expect(source).not.toContain("@fullcalendar");
});
```

- [ ] **Step 3: Run architecture tests**

Run:

```bash
cd frontend && npm test -- design-boundaries.spec.ts
```

Expected: PASS.

---

### Task 6: Final Verification

**Files:**
- No edits unless verification exposes a failure.

- [ ] **Step 1: Run frontend typecheck**

Run:

```bash
cd frontend && npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run frontend tests**

Run:

```bash
cd frontend && npm test
```

Expected: PASS.

- [ ] **Step 3: Inspect diff**

Run:

```bash
git diff -- frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css frontend/tests/presentation/workbench-wireframe.spec.tsx frontend/tests/architecture/design-boundaries.spec.ts
```

Expected:

- No goal `Due` UI remains.
- Goal table uses `goalPeriodColumn()`.
- Goal detail and creation use `GoalPeriodControl`.
- Tests assert canonical `scheduled` values.

- [ ] **Step 4: Commit implementation**

Run:

```bash
git add frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css frontend/tests/presentation/workbench-wireframe.spec.tsx frontend/tests/architecture/design-boundaries.spec.ts
git commit -m "[UPDATE] Simplify workspace goal period input

- Goals 워크스페이스에서 horizon/scheduled를 단일 Period 입력으로 통합
- 월/주 목표 선택 시 달력 범위를 하이라이트하고 canonical scheduled 값을 전송
- goal due 입력을 제거해 기간 목표 입력 표면을 단순화"
```

Expected: commit succeeds with only implementation files staged.

---

## Self-Review

- Spec coverage: covered table, detail, creation, due removal, no API/schema changes, no dependency.
- Placeholder scan: no placeholders remain.
- Type consistency: `GoalHorizon`, `GoalPeriodControl`, and patch payload fields match existing `WorkspaceItemPatch`.
