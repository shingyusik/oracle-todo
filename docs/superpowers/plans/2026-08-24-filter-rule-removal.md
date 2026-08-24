# Filter Rule Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an accessible per-row delete action to the shared table filter UI used by ToDo, Ledger, and Health Journal.

**Architecture:** Implement the action once in `TableViewControls`, where all three domains already render and update filter rules through the same adapter. Remove a rule by its stable ID and reuse the existing sort-rule X button styling, adding only the grid column needed to place it at the row end.

**Tech Stack:** React 18, TypeScript, Testing Library, Vitest, CSS

---

### Task 1: Remove individual filter rules

**Files:**
- Modify: `frontend/src/features/workbench/ui/TableViewControls.tsx:857-926`
- Modify: `frontend/src/styles/globals.css:1339-1350`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx:2558-2630`

- [ ] **Step 1: Write the failing shared-UI regression test**

Add this test beside the existing Workspace filter tests:

```tsx
it("removes one filter rule without clearing its siblings", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve({
    ok: true,
    json: async () => url === "/api/v1/todo/items?type=task" || url === "/api/v1/todo/items"
      ? [{ id: "task-1", type: "task", title: "Task", status: "active" }]
      : [],
  })));

  render(<WorkbenchPageClient />);
  await openWorkspaceTasks(user);
  await addWorkspaceStatusFilter(user, "active");
  const filter = screen.getByRole("dialog", { name: "Filter Tasks" });
  await user.click(within(filter).getByRole("button", { name: "Add filter rule" }));

  await user.click(within(filter).getByRole("button", {
    name: "Remove Title filter rule",
  }));
  expect(within(filter).getByRole("button", {
    name: "Remove Status filter rule",
  })).toBeInTheDocument();
  expect(within(filter).queryByRole("button", {
    name: "Remove Title filter rule",
  })).toBeNull();

  await user.click(within(filter).getByRole("button", {
    name: "Remove Status filter rule",
  }));
  expect(within(filter).getByRole("button", { name: "Add filter rule" }))
    .toBeInTheDocument();
  expect(within(filter).queryByRole("button", { name: "Delete filter" })).toBeNull();
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npm --prefix frontend test -- workbench-wireframe.spec.tsx -t "removes one filter rule"
```

Expected: FAIL because `Remove Title filter rule` does not exist.

- [ ] **Step 3: Add the minimal shared removal action**

Append the button to `TableViewAdvancedFilterRuleRow` after `TableViewFilterValueEditor`:

```tsx
<button
  type="button"
  className="planner-sort-remove"
  aria-label={`Remove ${field.label} filter rule`}
  onClick={() => adapter.update((current) => ({
    ...current,
    filterRules: current.filterRules.filter((candidate) => candidate.id !== rule.id),
  }))}
>
  <X size={14} aria-hidden="true" />
</button>
```

Extend the existing desktop filter-row grid and keep the button aligned right when the existing mobile layout stacks fields:

```css
.planner-advanced-filter-row {
  grid-template-columns: 58px max-content max-content minmax(160px, max-content) 28px;
}

.planner-advanced-filter-row .planner-sort-remove {
  justify-self: end;
}
```

Do not add domain-specific handlers: every ToDo, Ledger, and Health Journal adapter already routes through this shared row.

- [ ] **Step 4: Verify GREEN and regressions**

Run:

```powershell
npm --prefix frontend test -- workbench-wireframe.spec.tsx -t "removes one filter rule"
npm --prefix frontend test -- workbench-wireframe.spec.tsx ledger-panel.spec.tsx health-panel.spec.tsx
npm --prefix frontend run typecheck
npm --prefix frontend run build
git diff --check
```

Expected: the focused removal test passes; the shared ToDo, Ledger, and Health UI suites pass; typecheck, production build, and diff check exit successfully.

- [ ] **Step 5: Confirm stable documentation remains accurate**

Run the repository `docs-change-updater` workflow against the final diff. Expected: no README or operations-document change because the UI behavior is already fully captured in `docs/superpowers/specs/2026-08-24-filter-rule-removal-design.md` and no API or operator contract changes.

- [ ] **Step 6: Commit the implementation**

Stage only the three implementation/test files, inspect the cached diff, and commit:

```powershell
git add -- frontend/src/features/workbench/ui/TableViewControls.tsx frontend/src/styles/globals.css frontend/tests/presentation/workbench-wireframe.spec.tsx
git diff --cached --check
git diff --cached
git commit -m "[UPDATE] Add per-rule table filter removal" -m "- 공용 필터 행에서 선택한 규칙만 삭제할 수 있도록 지원`n- ToDo·Ledger·Health Journal의 동일 UI와 접근성 동작을 회귀 테스트로 고정"
```
