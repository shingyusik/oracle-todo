# Routine Recurrence Default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the Daily recurrence rule already displayed for routines whose stored rule is absent, so a paused routine can resume in one save.

**Architecture:** Keep the service and save sequence unchanged. Normalize only the routine detail draft: a missing stored rule becomes `RRULE:FREQ=DAILY`, while every existing rule passes through unchanged.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library

---

### Task 1: Synchronize the visible routine default with the detail draft

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx:2382-2400`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

- [ ] **Step 1: Write the failing presentation test**

Add a test that loads a paused routine with no `recurrence_rule`, opens its detail view, selects
`active`, and saves:

```tsx
it("saves the visible Daily recurrence before resuming a routine without a stored rule", async () => {
  const user = userEvent.setup();
  const calls: string[] = [];
  const routine = {
    id: "routine-1",
    type: "routine",
    title: "Daily routine",
    status: "paused",
    recurrence_rule: null,
    materialization_policy: "per_occurrence",
  };
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/todo-engine/items/routine-1" && init?.method === "PATCH") {
      calls.push("patch");
      expect(JSON.parse(String(init.body))).toEqual({
        recurrence_rule: "RRULE:FREQ=DAILY",
      });
      return Promise.resolve({
        ok: true,
        json: async () => ({ ...routine, recurrence_rule: "RRULE:FREQ=DAILY" }),
      });
    }
    if (url === "/todo-engine/items/routine-1/resume") {
      calls.push("resume");
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ...routine,
          status: "active",
          recurrence_rule: "RRULE:FREQ=DAILY",
        }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: async () => (url === "/todo-engine/items?type=routine" ? [routine] : []),
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<WorkbenchPageClient />);
  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Workspace" }));
  await user.click(screen.getByRole("button", { name: "Routines" }));
  await user.click(await screen.findByRole("cell", { name: "Daily routine" }));
  await user.selectOptions(screen.getByLabelText("Status for Daily routine"), "active");
  await user.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(calls).toEqual(["patch", "resume"]));
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run from `frontend/`:

```powershell
npx vitest run tests/presentation/workbench-wireframe.spec.tsx --no-file-parallelism -t "saves the visible Daily recurrence"
```

Expected: FAIL because no PATCH request is made before `/resume`.

- [ ] **Step 3: Implement the minimal draft normalization**

In `detailDraftForItem`, replace the recurrence draft initializer with:

```tsx
recurrence_rule:
  item?.type === "routine" ? item.recurrence_rule ?? "RRULE:FREQ=DAILY" : "",
```

Do not change the recurrence editor, transition mapping, controller, or Rust service.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run from `frontend/`:

```powershell
npx vitest run tests/presentation/workbench-wireframe.spec.tsx --no-file-parallelism -t "saves the visible Daily recurrence"
```

Expected: PASS with one PATCH followed by one resume request.

- [ ] **Step 5: Run frontend verification**

Run from `frontend/`:

```powershell
npm test
npm run typecheck
npm run build
```

Expected: all commands exit `0` with no failed tests or TypeScript/build errors.

- [ ] **Step 6: Inspect and commit the bug fix**

```powershell
git status --short
git diff --stat
git diff
git add -- frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx docs/superpowers/plans/2026-07-16-routine-recurrence-default.md
git diff --cached
git commit -m @'
[FIX] Persist visible routine recurrence defaults

- 저장값이 없는 Routine의 Daily 표시값을 편집 초깃값과 일치시켰습니다.
- 반복 규칙 저장 후 resume 요청이 실행되는 회귀 테스트를 추가했습니다.
'@
```

Expected: one `[FIX]` commit containing only the draft normalization, regression test, and implementation plan.
