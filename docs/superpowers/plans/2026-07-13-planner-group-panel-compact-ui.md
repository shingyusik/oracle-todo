# Planner Group Panel Compact UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Planner Group panel use the same compact dropdown interaction and visual scale as Filter and Sort.

**Architecture:** Keep the existing group settings model, controller actions, candidate universe, and outer toolbar dismissal logic unchanged. Simplify `PlannerGroupPanel` into dropdown content with one inline selector state, let `MainPanel` provide the existing `PlannerControlDropdown` shell, and replace the oversized panel CSS with compact rows that reuse planner menu tokens.

**Tech Stack:** TypeScript 5.5, React 18, Next.js 14, Vitest, React Testing Library, lucide-react, existing CSS design tokens.

## Global Constraints

- Do not change group data, storage keys, candidate derivation, sorting semantics, visibility semantics, or persistence.
- Do not change Filter or Sort behavior.
- Do not add dependencies or menu libraries.
- Use the existing `PlannerControlDropdown` shell and its `Group` accessible title.
- Group has no dedicated header, Back button, Close button, or nested dialog role.
- Property and sort choices expand inline inside the Group dropdown and only one may be open.
- Selecting an option closes the inline menu while leaving the outer Group dropdown open.
- Escape closes an inline menu before the outer dropdown.
- Primary text is 13px; secondary text and counts are 12px; control icons are 14-16px.
- Group rows are approximately 32px high, borderless, regular weight, and use subtle existing hover/focus treatments.
- Native drag and keyboard reordering, visibility actions, bulk visibility, empty-group behavior, and Remove grouping remain functional.
- Every commit follows `[TAG] English subject` plus a Korean bullet body.

---

## File Structure

- Modify `frontend/src/features/workbench/ui/PlannerGroupPanel.tsx`: remove page navigation and nested dialog; render compact root rows with inline property/sort lists and two-stage Escape handling.
- Modify `frontend/src/features/workbench/ui/MainPanel.tsx`: wrap Group content with the existing `PlannerControlDropdown` shell and retain outside-click/focus restoration at the toolbar level.
- Modify `frontend/src/styles/globals.css`: replace large header/page/card styling with compact dropdown rows, inline lists, separators, small icons, and unobtrusive keyboard actions.
- Modify `frontend/tests/presentation/planner-group-panel.spec.tsx`: cover the content component's inline selector and Escape behavior.
- Modify `frontend/tests/presentation/workbench-wireframe.spec.tsx`: cover outer shell integration and absence of dedicated navigation controls.

---

### Task 1: Inline Group Dropdown Interaction

**Files:**
- Modify: `frontend/src/features/workbench/ui/PlannerGroupPanel.tsx`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/tests/presentation/planner-group-panel.spec.tsx`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes: existing `PlannerGroupPanel` props and all current controller callbacks without signature changes.
- Produces: `PlannerGroupPanel` as non-dialog dropdown content with `openSelector: "property" | "sort" | null`; `onRequestOuterClose(): void` for Escape delegation to the toolbar shell.

- [ ] **Step 1: Write failing content tests for inline selectors**

Replace tests that expect Back/Close navigation with tests that exercise the approved interaction:

```tsx
it("opens property and sort choices inline one at a time", async () => {
  const user = userEvent.setup();
  renderPanel();

  expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Close group settings" }),
  ).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Choose group property" }));
  expect(screen.getByRole("listbox", { name: "Choose group property" })).toBeVisible();

  await user.click(screen.getByRole("button", { name: "Choose group sort" }));
  expect(
    screen.queryByRole("listbox", { name: "Choose group property" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("listbox", { name: "Choose group sort" })).toBeVisible();
});

it("selects an inline option without closing the group content", async () => {
  const user = userEvent.setup();
  const onGroupByChange = vi.fn();
  renderPanel({ onGroupByChange });

  await user.click(screen.getByRole("button", { name: "Choose group property" }));
  await user.click(screen.getByRole("option", { name: "Tag" }));

  expect(onGroupByChange).toHaveBeenCalledWith("tag");
  expect(
    screen.queryByRole("listbox", { name: "Choose group property" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Choose group sort" })).toBeVisible();
});
```

Update the local `renderPanel` helper to accept partial prop overrides and add `onRequestOuterClose: vi.fn()`.

- [ ] **Step 2: Write a failing two-stage Escape test**

```tsx
it("closes an inline selector before requesting outer dismissal", async () => {
  const user = userEvent.setup();
  const onRequestOuterClose = vi.fn();
  renderPanel({ onRequestOuterClose });

  await user.click(screen.getByRole("button", { name: "Choose group sort" }));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("listbox", { name: "Choose group sort" })).not.toBeInTheDocument();
  expect(onRequestOuterClose).not.toHaveBeenCalled();

  await user.keyboard("{Escape}");
  expect(onRequestOuterClose).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 3: Run focused tests and verify RED**

Run: `cd frontend && npm test -- --run tests/presentation/planner-group-panel.spec.tsx`

Expected: FAIL because Back and Close still render, selectors replace the whole page, and `onRequestOuterClose` does not exist.

- [ ] **Step 4: Replace page navigation with inline selector state**

Use this state and key handler in `PlannerGroupPanel.tsx`:

```tsx
const [openSelector, setOpenSelector] = React.useState<
  "property" | "sort" | null
>(null);

function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "Escape") return;
  event.stopPropagation();
  if (openSelector) {
    setOpenSelector(null);
    return;
  }
  onRequestOuterClose();
}
```

Remove `ArrowLeft`, `X`, the `page` state, the header, and `role="dialog"`. Render one root container:

```tsx
<div className="planner-group-settings-panel" onKeyDown={handleKeyDown}>
  <div className="planner-group-setting-rows">
    <button
      type="button"
      aria-label="Choose group property"
      aria-expanded={openSelector === "property"}
      aria-controls="planner-group-property-options"
      onClick={() =>
        setOpenSelector((current) =>
          current === "property" ? null : "property",
        )
      }
    >
      <span>Group by</span>
      <span>{propertyLabel}<ChevronRight size={14} aria-hidden="true" /></span>
    </button>
    {openSelector === "property" ? propertyOptions : null}
    <button
      type="button"
      aria-label="Choose group sort"
      aria-expanded={openSelector === "sort"}
      aria-controls="planner-group-sort-options"
      onClick={() =>
        setOpenSelector((current) => current === "sort" ? null : "sort")
      }
    >
      <span>Sort</span>
      <span>{sortLabel}<ChevronRight size={14} aria-hidden="true" /></span>
    </button>
    {openSelector === "sort" ? sortOptionsList : null}
    <label>{hideEmptySwitch}</label>
  </div>
  {groupList}
  {removeGroupingButton}
</div>
```

Give each inline list its matching ID and existing listbox/option semantics. Each option calls its existing change callback and then `setOpenSelector(null)`.

- [ ] **Step 5: Integrate the standard outer dropdown shell**

In `MainPanel.tsx`, replace the custom Group wrapper with:

```tsx
<div ref={groupPanelRef}>
  <PlannerControlDropdown title="Group">
    <PlannerGroupPanel
      {...existingGroupProps}
      onRequestOuterClose={() => {
        setOpenDropdown(null);
        groupTriggerRef.current?.focus();
      }}
    />
  </PlannerControlDropdown>
</div>
```

Remove the old `onClose` prop. Preserve the toolbar's document-level outside pointer handler and Escape handler; the panel stops propagation when it consumes the first Escape for an inline selector.

- [ ] **Step 6: Add an outer integration assertion**

In `workbench-wireframe.spec.tsx`, open Group and assert:

```tsx
expect(screen.getByRole("dialog", { name: "Group" })).toBeInTheDocument();
expect(screen.queryByRole("dialog", { name: "Group settings" })).not.toBeInTheDocument();
expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
expect(
  screen.queryByRole("button", { name: "Close group settings" }),
).not.toBeInTheDocument();
```

- [ ] **Step 7: Run focused and regression tests**

Run: `cd frontend && npm test -- --run tests/presentation/planner-group-panel.spec.tsx tests/presentation/workbench-wireframe.spec.tsx && npm run typecheck`

Expected: both presentation files PASS and TypeScript exits 0.

- [ ] **Step 8: Commit the interaction change**

```bash
git add frontend/src/features/workbench/ui/PlannerGroupPanel.tsx frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation/planner-group-panel.spec.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "[UPDATE] Align planner group dropdown interaction" -m "- 별도 헤더와 뒤로가기 탐색을 제거하고 인라인 선택기로 통일
- Group 드롭다운의 Escape와 포커스 복귀 동작을 유지"
```

---

### Task 2: Compact Group Panel Styling and Final Verification

**Files:**
- Modify: `frontend/src/styles/globals.css`
- Modify: `frontend/tests/architecture/design-boundaries.spec.ts`

**Interfaces:**
- Consumes: Task 1 class names `planner-group-settings-panel`, `planner-group-setting-rows`, `planner-group-inline-options`, `planner-group-row`, `planner-group-drag-handle`, `planner-group-eye`, `planner-group-keyboard-moves`, and `planner-group-remove`.
- Produces: compact Group styling that uses only defined design tokens and matches existing planner dropdown density.

- [ ] **Step 1: Write a failing compact-density architecture test**

Add a source-contract assertion that prevents the oversized panel from returning:

```ts
it("keeps planner group controls compact and headerless", () => {
  const panel = readSource(
    "src/features/workbench/ui/PlannerGroupPanel.tsx",
  );
  const styles = readSource("src/styles/globals.css");

  expect(panel).not.toContain("planner-group-header");
  expect(styles).toContain(".planner-group-setting-rows > button");
  expect(styles).toMatch(
    /\.planner-group-setting-rows > button[\s\S]*?font-size:\s*13px/,
  );
  expect(styles).toMatch(
    /\.planner-group-count[\s\S]*?font-size:\s*12px/,
  );
  expect(styles).toMatch(
    /\.planner-group-row[\s\S]*?min-height:\s*32px/,
  );
});
```

Use the architecture suite's existing file-reading helper name instead of introducing a duplicate helper if it differs from `readSource`.

- [ ] **Step 2: Run the architecture test and verify RED**

Run: `cd frontend && npm test -- --run tests/architecture/design-boundaries.spec.ts`

Expected: FAIL because the existing Group CSS uses larger text, icons, spacing, and the removed header styles remain.

- [ ] **Step 3: Replace oversized Group styles with compact rules**

Delete `.planner-group-header` rules and the obsolete choice-page layout. Implement:

```css
.planner-group-settings-panel {
  display: grid;
  width: min(320px, calc(100vw - 36px));
  gap: 6px;
  color: var(--color-ink);
  font-size: 13px;
}

.planner-group-setting-rows > button,
.planner-group-setting-rows > label,
.planner-group-inline-options > button {
  display: flex;
  min-height: 32px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 0;
  border-radius: var(--radius-xs);
  padding: 4px 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  font-weight: 400;
}

.planner-group-inline-options {
  display: grid;
  margin: 0 0 2px;
  padding: 3px;
  border: 1px solid var(--color-hairline-light);
  border-radius: var(--radius-xs);
  background: var(--color-canvas-light);
}

.planner-group-row {
  display: grid;
  min-height: 32px;
  grid-template-columns: 20px minmax(0, 1fr) auto auto auto;
  align-items: center;
  gap: 4px;
  border: 0;
  border-radius: var(--radius-xs);
  padding: 2px 4px;
  font-size: 13px;
  font-weight: 400;
}

.planner-group-count {
  color: var(--color-shade-50);
  font-size: 12px;
}
```

Use 14-16px icon props in the component. Keep keyboard move buttons accessible; make them low contrast until the row is hovered or one receives focus. Use existing hover colors and tokens already used by `.planner-filter-field-options button:hover`.

- [ ] **Step 4: Run the complete frontend gates**

Run: `cd frontend && npm run test && npm run typecheck && npm run build`

Expected: 182 or more tests PASS, TypeScript exits 0, and Next.js completes the production build.

- [ ] **Step 5: Inspect final scope and whitespace**

Run:

```bash
git diff --check
git status --short
git diff --stat HEAD~1
rg -n "planner-group-header|ArrowLeft|Close group settings" frontend/src frontend/tests
```

Expected: no whitespace errors; no obsolete header/navigation references; changes remain limited to the Group component, integration, styles, and their tests.

- [ ] **Step 6: Commit compact styling**

```bash
git add frontend/src/styles/globals.css frontend/tests/architecture/design-boundaries.spec.ts
git commit -m "[UPDATE] Refine planner group panel density" -m "- Filter와 Sort에 맞춘 작은 글자와 조밀한 행 간격을 적용
- 그룹 조작 아이콘과 보조 정보를 낮은 시각적 강도로 정리"
```

- [ ] **Step 7: Verify final repository state**

Run: `git status --short && git log --oneline -n 8`

Expected: worktree is clean and the interaction and styling changes appear as two focused commits.
