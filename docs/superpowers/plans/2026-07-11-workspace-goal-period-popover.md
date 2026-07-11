# Workspace Goal Period Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the always-visible Goal period controls with a compact trigger and a single popover that selects both horizon and period value.

**Architecture:** Keep `GoalPeriodControl` as the shared boundary for the goals table, detail view, and creation dialog. The control owns only transient popover and candidate state; consumers keep their existing `onCommit` behavior, so the table patches once after a value selection while detail and creation update their existing drafts. The control is also used by Planner's Goal creation dialog, so that dialog receives the same presentation without a separate variant.

**Tech Stack:** React 18, TypeScript, Next.js 14, Testing Library, Vitest, existing CSS, lucide-react.

## Global Constraints

- Support only the existing Goal horizons: `year`, `month`, and `week`.
- Do not change API endpoints, API payload shapes, database schema, Rust domain behavior, or service behavior.
- Do not add a date-picker dependency or free-form period parsing.
- The closed trigger shows the current type and period; the calendar is not rendered until the trigger is opened.
- Type changes remain local while the popover is open. A year or calendar-day selection commits `{ horizon, scheduled }` together and closes the popover.
- Escape and outside pointer interaction dismiss an uncommitted candidate without changing the current period.
- Preserve canonical Goal anchors: Jan 1 for year, first of month for month, ISO Monday for week.
- Do not add Apply or Cancel controls, daily Goal horizons, or changes to non-Goal period controls.

---

## File Structure

- Modify `frontend/src/features/workbench/ui/MainPanel.tsx`
  - Replace the open-by-default `GoalPeriodControl` layout with a trigger, popover state, and candidate commit boundary.
  - Keep `GoalPeriodCalendar` as the month/week value picker.
  - Add a compact `goalPeriodTriggerLabel` helper beside the existing Goal period helpers.
- Modify `frontend/src/styles/globals.css`
  - Turn the period control into a positioned popover owner.
  - Add trigger, type button, and popover styles while retaining the existing calendar grid and range styles.
- Modify `frontend/tests/presentation/workbench-wireframe.spec.tsx`
  - Replace open calendar/select expectations with closed trigger and popover interaction coverage.
  - Preserve creation, detail draft, table PATCH, Planner Goal creation, and ISO-week assertions.

### Task 1: Define The Popover Contract In Presentation Tests

**Files:**
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx:540-580,2390-2445,2960-3060`

**Interfaces:**
- Consumes: existing `WorkbenchPageClient`, `within`, `fireEvent`, and Goal API fetch mocks.
- Produces: failing tests for a button named by the existing `Period` label and a popover with `role="dialog"`.

- [ ] **Step 1: Update the creation-dialog focus assertion to target the closed trigger**

In `focuses and traps the creation dialog through every control, and closes it on escape`, replace the two select focus assertions with the compact control and dialog action order:

```tsx
await user.tab();
expect(screen.getByRole("button", { name: "Period" })).toHaveFocus();

await user.tab();
expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

await user.tab();
expect(screen.getByRole("button", { name: "Create" })).toHaveFocus();
```

- [ ] **Step 2: Replace the Workspace Goal creation test with closed, cancel, and commit coverage**

Keep the existing proposal fetch mock, then make `creates workspace goals through one period control` exercise this interaction before submitting the form:

```tsx
const trigger = screen.getByRole("button", { name: "Period" });
expect(trigger).toHaveAttribute("aria-expanded", "false");
expect(screen.queryByRole("dialog", { name: "Period" })).toBeNull();

await user.click(trigger);
const picker = screen.getByRole("dialog", { name: "Period" });
expect(within(picker).getByRole("button", { name: "Year" })).toHaveAttribute(
  "aria-pressed",
  "true",
);
expect(within(picker).getByRole("button", { name: "Month" })).toHaveAttribute(
  "aria-pressed",
  "false",
);

await user.click(within(picker).getByRole("button", { name: "Month" }));
expect(screen.getByRole("dialog", { name: "Period" })).toBeInTheDocument();
expect(trigger).toHaveTextContent("Year");

await user.keyboard("{Escape}");
expect(screen.queryByRole("dialog", { name: "Period" })).toBeNull();
expect(trigger).toHaveTextContent("Year");

await user.click(trigger);
const committedPicker = screen.getByRole("dialog", { name: "Period" });
await user.click(within(committedPicker).getByRole("button", { name: "Month" }));
await user.click(within(committedPicker).getByRole("button", { name: /July 15, 2026/ }));
expect(screen.queryByRole("dialog", { name: "Period" })).toBeNull();
expect(trigger).toHaveTextContent("Month");
```

Keep the existing `Create` click and request-body assertion for `horizon: "month"` and `scheduled: "2026-07-01"`. Add an outside-dismiss assertion in the same test after opening the picker again:

```tsx
await user.click(trigger);
fireEvent.mouseDown(document.body);
expect(screen.queryByRole("dialog", { name: "Period" })).toBeNull();
expect(trigger).toHaveTextContent("Month");
```

- [ ] **Step 3: Update the detail/table field test to assert the closed state**

In `shows the same goal fields in the table and detail`, replace the visible range assertions with these trigger assertions:

```tsx
expect(screen.getByRole("button", { name: "Period for June outcome" })).toHaveTextContent(
  "Month",
);
expect(screen.queryByRole("dialog", { name: "Period for June outcome" })).toBeNull();
```

Make the test fetch stub a named `fetchMock` before installing it with `vi.stubGlobal("fetch", fetchMock)`. After opening the detail row, assert the same compact control rather than `Period type` or the visible calendar:

```tsx
expect(screen.getByRole("button", { name: "Period" })).toHaveTextContent("Month");
expect(screen.queryByRole("dialog", { name: "Period" })).toBeNull();
```

Then verify a detail selection changes the draft and does not PATCH before the user presses the existing Save button:

```tsx
const detailTrigger = screen.getByRole("button", { name: "Period" });
await user.click(detailTrigger);
const detailPicker = screen.getByRole("dialog", { name: "Period" });
await user.click(within(detailPicker).getByRole("button", { name: "Week" }));
await user.click(within(detailPicker).getByRole("button", { name: /June 10, 2026/ }));

expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
expect(
  fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH"),
).toHaveLength(0);
```

Keep the existing `Due`, `Horizon`, `Scheduled`, parent, note, and timestamp assertions unchanged.

- [ ] **Step 4: Change the inline PATCH test so type selection alone has no side effect**

In `patches a goal period through the inline calendar with an ISO week anchor`, replace `selectOptions` with the popover interaction and assert that PATCH has not been sent before the day selection:

```tsx
const trigger = await screen.findByRole("button", { name: "Period for Goal" });
await user.click(trigger);
const picker = screen.getByRole("dialog", { name: "Period for Goal" });
await user.click(within(picker).getByRole("button", { name: "Week" }));

expect(
  fetchMock.mock.calls.filter(
    ([url, init]) => String(url).includes("/items/goal-1") && init?.method === "PATCH",
  ),
).toHaveLength(0);

await user.click(within(picker).getByRole("button", { name: /July 10, 2026/ }));
expect(screen.queryByRole("dialog", { name: "Period for Goal" })).toBeNull();
```

Keep the existing PATCH body assertion for `{ horizon: "week", scheduled: "2026-07-06" }`.

- [ ] **Step 5: Update the Planner Goal creation expectations for the shared trigger**

In `submits canonical yearly and monthly planner goal anchors from the creation dialog`, replace direct `Period type` and `Goal year` queries with:

```tsx
const yearlyTrigger = screen.getByRole("button", { name: "Period" });
expect(yearlyTrigger).toHaveTextContent("Year");
await user.click(yearlyTrigger);
expect(
  within(screen.getByRole("dialog", { name: "Period" })).getByLabelText("Goal year"),
).toHaveValue(yearStart.slice(0, 4));
await user.keyboard("{Escape}");
```

For the monthly dialog, assert `screen.getByRole("button", { name: "Period" })` contains `Month` before submitting. Keep the existing proposal-body assertions to guard canonical anchors.

- [ ] **Step 6: Run the focused presentation test to confirm the expected failure**

Run:

```bash
cd frontend && npm test -- workbench-wireframe.spec.tsx
```

Expected: FAIL because the current implementation still renders `Period type`, `Goal year`, and an always-visible calendar instead of the trigger and dialog roles.

### Task 2: Implement The Shared Candidate Popover

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx:2416-2585,4273-4385`

**Interfaces:**
- Consumes: `GoalPeriodControlProps`, `goalHorizons`, `goalPeriodRange`, `canonicalGoalScheduled`, `GoalPeriodCalendar`, `stopRowEvent`, and `stopRowKeyDown`.
- Produces: `GoalPeriodControl` with `button[aria-haspopup="dialog"]`, `div[role="dialog"]`, and exactly one call to `onCommit({ horizon, scheduled })` per value selection.

- [ ] **Step 1: Add a short closed-state label helper near `goalPeriodRange`**

Add this function after `goalPeriodRange`:

```tsx
function goalPeriodTriggerLabel(horizon: GoalHorizon, scheduled: string): string {
  const range = goalPeriodRange(horizon, scheduled);

  if (horizon === "year") {
    return `Year · ${range.start.slice(0, 4)}`;
  }
  if (horizon === "month") {
    return `Month · ${monthLabel(range.start)}`;
  }
  return `Week · ${range.start} to ${range.end}`;
}
```

- [ ] **Step 2: Replace the always-open control body with transient popover state**

At the top of `GoalPeriodControl`, retain `safeHorizon` and `safeScheduled`, then add this state and dismissal effect:

```tsx
const controlRef = useRef<HTMLDivElement>(null);
const [isOpen, setIsOpen] = React.useState(false);
const [candidateHorizon, setCandidateHorizon] = React.useState<GoalHorizon>(safeHorizon);

useEffect(() => {
  if (!isOpen) return;

  function dismissOnOutsidePointer(event: MouseEvent) {
    if (event.target instanceof Node && !controlRef.current?.contains(event.target)) {
      setIsOpen(false);
    }
  }

  document.addEventListener("mousedown", dismissOnOutsidePointer);
  return () => document.removeEventListener("mousedown", dismissOnOutsidePointer);
}, [isOpen]);

function open() {
  setCandidateHorizon(safeHorizon);
  setIsOpen(true);
}

function commit(date: string) {
  setIsOpen(false);
  onCommit({
    horizon: candidateHorizon,
    scheduled: canonicalGoalScheduled(candidateHorizon, date),
  });
}
```

Delete `commitOnChange` and `periodBasisDate` from `GoalPeriodControlProps` and its call sites. `onCommit` remains the only consumer boundary; the table consumer already PATCHes while detail and creation consumers already update local drafts.

- [ ] **Step 3: Render the trigger and conditional popover**

Replace the current `label` elements and always-rendered calendar with this structure inside the existing row-event boundary:

```tsx
<div
  ref={controlRef}
  className="goal-period-control"
  role="group"
  aria-label={label}
  onClick={stopRowEvent}
  onKeyDown={(event) => {
    if (event.key === "Escape" && isOpen) {
      event.stopPropagation();
      setIsOpen(false);
      return;
    }
    stopRowKeyDown(event);
  }}
>
  <button
    type="button"
    className="goal-period-trigger"
    aria-label={label}
    aria-haspopup="dialog"
    aria-expanded={isOpen}
    onClick={() => (isOpen ? setIsOpen(false) : open())}
  >
    {goalPeriodTriggerLabel(safeHorizon, safeScheduled)}
  </button>

  {isOpen ? (
    <div className="goal-period-popover" role="dialog" aria-label={label}>
      <div className="goal-period-types" aria-label="Period type">
        {goalHorizons.map((horizonOption) => (
          <button
            type="button"
            key={horizonOption}
            aria-pressed={candidateHorizon === horizonOption}
            onClick={() => setCandidateHorizon(horizonOption)}
          >
            {capitalize(horizonOption)}
          </button>
        ))}
      </div>

      {candidateHorizon === "year" ? (
        <label className="field-label">
          Goal year
          <select
            aria-label="Goal year"
            value={goalPeriodRange(candidateHorizon, safeScheduled).start.slice(0, 4)}
            onChange={(event) => commit(`${event.target.value}-01-01`)}
          >
            {yearOptions(Number(safeScheduled.slice(0, 4))).map((year) => (
              <option key={year} value={year}>{year}</option>
            ))}
          </select>
        </label>
      ) : (
        <GoalPeriodCalendar
          horizon={candidateHorizon}
          scheduled={safeScheduled}
          onSelect={commit}
        />
      )}

      <p className="goal-period-range">
        {goalPeriodRange(candidateHorizon, safeScheduled).start} to {goalPeriodRange(candidateHorizon, safeScheduled).end}
      </p>
    </div>
  ) : null}
</div>
```

Use a local `const candidateRange = goalPeriodRange(candidateHorizon, safeScheduled);` before the return to avoid repeating the helper calls in the final code. Keep `GoalPeriodCalendar` unchanged except for passing the candidate horizon and commit callback.

- [ ] **Step 4: Run the focused test after the component change**

Run:

```bash
cd frontend && npm test -- workbench-wireframe.spec.tsx
```

Expected: PASS after the test queries and component semantics agree.

### Task 3: Style The Popover And Run The Frontend Gates

**Files:**
- Modify: `frontend/src/styles/globals.css:1414-1476`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx` only if Task 2 exposes an assertion mismatch.

**Interfaces:**
- Consumes: `.goal-period-control`, `.goal-period-trigger`, `.goal-period-popover`, `.goal-period-types`, `.goal-period-calendar`, and `.goal-period-range` from Task 2.
- Produces: a fixed-width, layered popover that does not reserve calendar height in closed table, detail, or dialog layouts.

- [ ] **Step 1: Replace the control layout CSS with trigger and popover rules**

Replace the existing `.goal-period-control` rule and add these adjacent rules before `.goal-period-range`:

```css
.goal-period-control {
  position: relative;
  display: inline-flex;
  min-width: 0;
}

.goal-period-trigger {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  border: 1px solid var(--color-shade-30);
  border-radius: var(--radius-xs);
  background: var(--color-surface);
  padding: 0 10px;
  color: var(--color-text);
  font: inherit;
  white-space: nowrap;
}

.goal-period-popover {
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  left: 0;
  display: grid;
  width: min(320px, calc(100vw - 32px));
  gap: 12px;
  border: 1px solid var(--color-shade-30);
  border-radius: var(--radius-xs);
  background: var(--color-surface);
  padding: 12px;
  box-shadow: 0 10px 24px rgb(0 0 0 / 12%);
}

.goal-period-types {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
}

.goal-period-types button[aria-pressed="true"] {
  border-color: var(--color-ink);
  background: var(--color-ink);
  color: var(--color-on-dark);
}
```

Add `width: 100%;` to `.goal-period-calendar-grid` and change its columns to `repeat(7, minmax(0, 1fr))` so it fills the popover without a fixed 196px grid. Preserve the current selected-range and muted-day styles.

- [ ] **Step 2: Run the focused test and TypeScript gate**

Run:

```bash
cd frontend && npm test -- workbench-wireframe.spec.tsx
cd frontend && npm run typecheck
```

Expected: both commands exit with code 0.

- [ ] **Step 3: Run the production build**

Run:

```bash
cd frontend && npm run build
```

Expected: Next.js completes its production build with exit code 0.

- [ ] **Step 4: Commit the completed UI change**

Run the project commit checks, stage only the three implementation files, inspect the staged diff, then commit:

```bash
git add frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css frontend/tests/presentation/workbench-wireframe.spec.tsx
git diff --cached --check
git diff --cached
git commit -m $'[UPDATE] Replace workspace goal period picker\n\n- Goal 기간 선택을 단일 트리거와 팝오버로 통합\n- 타입 전환은 취소 가능하게 유지하고 값 선택 시에만 저장\n- 테이블, 상세, 생성 흐름과 ISO 주 시작일 검증을 갱신'
```

Expected: one `[UPDATE]` commit containing only the Goal period popover implementation and its presentation coverage.

## Plan Self-Review

- Closed rendering, popover layout, local type candidate, value commit, Escape dismissal, outside dismissal, and trigger updates are implemented by Tasks 1 and 2.
- Existing canonical year, month, and ISO-week rules are retained by Task 2 and asserted by Tasks 1 and 3.
- The table's single PATCH and draft-only detail/creation behavior remain at the existing consumer callbacks; Task 1 verifies the table does not PATCH on a type-only change and the detail view does not PATCH before Save.
- No endpoint, schema, service, dependency, daily horizon, free-form input, or Apply/Cancel work is included.
- Planner Goal creation is covered because it uses the same `GoalPeriodControl` call site as Workspace creation.
