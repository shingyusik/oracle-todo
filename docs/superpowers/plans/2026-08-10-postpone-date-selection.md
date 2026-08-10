# Postpone Date Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Planner users choose a future follow-up date in the existing Miss dialog, defaulting to browser-local tomorrow.

**Architecture:** Keep the change inside `PlannerMissButton`: local React state owns the selected ISO date, the native date input enforces the minimum, and the existing controller receives the selected value. Extend the existing presentation test so the API, domain, and persistence layers remain untouched.

**Tech Stack:** React 18, TypeScript, native `<input type="date">`, Vitest, Testing Library

---

## File Structure

- Modify `frontend/src/features/workbench/ui/MainPanel.tsx`: own, render, validate, reset, and submit the postpone date in `PlannerMissButton`.
- Modify `frontend/tests/presentation/workbench-wireframe.spec.tsx`: verify the default/minimum date, keyboard access, reset behavior, validation, and selected-date request body.

### Task 1: Specify the date-selection behavior with failing tests

**Files:**
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx:3424-3690`

- [ ] **Step 1: Extend the dialog interaction test**

In `opens a Miss dialog only from active task and event rows across Planner views`, add assertions after the dialog opens:

```tsx
const tomorrow = testAddDays(testToday(), 1);
const postponeDate = within(dialog).getByLabelText("Postpone date");
expect(postponeDate).toHaveValue(tomorrow);
expect(postponeDate).toHaveAttribute("min", tomorrow);

await user.tab({ shift: true });
expect(postponeDate).toHaveFocus();

fireEvent.change(postponeDate, {
  target: { value: testAddDays(testToday(), 5) },
});
await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
await user.click(trigger);
expect(within(screen.getByRole("dialog", { name: "Miss Active task?" }))
  .getByLabelText("Postpone date"))
  .toHaveValue(tomorrow);
```

Keep the existing Escape and trigger-focus assertions after reopening the dialog.

- [ ] **Step 2: Change the postpone request test to choose a date**

Rename the test to `postpones to a selected browser-local date and prevents duplicate dialog submission`. Before clicking the postpone button, verify invalid input disables it and a future selection enables it:

```tsx
const postponeDate = within(dialog).getByLabelText("Postpone date");
expect(postponeDate).toHaveValue("2026-07-26");
expect(postponeDate).toHaveAttribute("min", "2026-07-26");

fireEvent.change(postponeDate, { target: { value: "" } });
expect(postpone).toBeDisabled();

fireEvent.change(postponeDate, { target: { value: "2026-07-25" } });
expect(postpone).toBeDisabled();

fireEvent.change(postponeDate, { target: { value: "2026-07-30" } });
expect(postpone).toBeEnabled();
```

Update the existing request-body assertion to require the selected date:

```tsx
body: JSON.stringify({
  today: "2026-07-25",
  scheduled: "2026-07-30",
}),
```

- [ ] **Step 3: Run the focused test and confirm it fails**

Run:

```powershell
npm --prefix frontend test -- tests/presentation/workbench-wireframe.spec.tsx
```

Expected: FAIL because the dialog has no `Postpone date` control.

### Task 2: Add the native postpone date input

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx:2044-2189`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx:3424-3690`

- [ ] **Step 1: Add local date state and reset it whenever the dialog opens**

At the start of `PlannerMissButton`, add the input ref and state:

```tsx
const [postponeDate, setPostponeDate] = React.useState(browserTomorrow);
const postponeDateRef = useRef<HTMLInputElement>(null);
```

After reading `transitionState`, derive the current minimum and validity:

```tsx
const minimumPostponeDate = browserTomorrow();
const canPostpone = postponeDate >= minimumPostponeDate;
```

Add and use an open handler so a previous selection never survives reopening:

```tsx
function openDialog() {
  setPostponeDate(browserTomorrow());
  setOpen(true);
}
```

Replace the trigger's `onClick={() => setOpen(true)}` with `onClick={openDialog}`.

- [ ] **Step 2: Submit the selected date and keep it keyboard-accessible**

Pass state to the existing controller instead of recalculating tomorrow:

```tsx
await controller.postponeWorkspaceItem(item.id, postponeDate);
```

Include the input first in the dialog focus loop and use `HTMLElement` for the mixed controls:

```tsx
const controls = [
  postponeDateRef.current,
  markMissedRef.current,
  postponeRef.current,
  cancelRef.current,
].filter((control): control is HTMLElement => control !== null);
const currentIndex = controls.indexOf(document.activeElement as HTMLElement);
```

- [ ] **Step 3: Render the labeled native date input**

Change the explanatory text to refer to the chosen date, then insert this field before progress/error messages:

```tsx
<p>Mark this scheduled work as missed, or create a follow-up for the chosen date.</p>
<label className="field-label">
  Postpone date
  <input
    ref={postponeDateRef}
    type="date"
    value={postponeDate}
    min={minimumPostponeDate}
    disabled={transitionState.pending}
    onChange={(event) => setPostponeDate(event.target.value)}
  />
</label>
```

Disable only the postpone action when the date is empty or earlier than tomorrow:

```tsx
disabled={transitionState.pending || !canPostpone}
```

Reuse `.field-label`; do not add CSS or a date-picker dependency.

- [ ] **Step 4: Run the focused test and confirm it passes**

Run:

```powershell
npm --prefix frontend test -- tests/presentation/workbench-wireframe.spec.tsx
```

Expected: PASS for `frontend/tests/presentation/workbench-wireframe.spec.tsx`.

### Task 3: Verify and commit the implementation

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

- [ ] **Step 1: Run frontend type checking**

Run:

```powershell
npm --prefix frontend run typecheck
```

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 2: Run the complete frontend test suite**

Run:

```powershell
npm --prefix frontend test
```

Expected: all frontend test files pass.

- [ ] **Step 3: Build the static frontend**

Run:

```powershell
npm --prefix frontend run build
```

Expected: Next.js static export completes successfully.

- [ ] **Step 4: Inspect and commit one logical change**

Run:

```powershell
git status --short
git diff --check
git diff -- frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git add -- frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git diff --cached
git commit -m @'
[UPDATE] Let users choose postpone dates

- Miss 대화상자에 내일이 기본값인 날짜 입력을 추가
- 선택 날짜의 최소값과 제출 가능 상태를 검증
- 키보드 접근과 선택 날짜 요청을 프런트엔드 테스트로 보호
'@
```

Expected: one `[UPDATE]` commit containing only the UI and presentation-test changes.
