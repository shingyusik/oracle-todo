# Planner Group Dropdown Width Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove unused horizontal space from the Planner Group dropdown without changing Filter or Sort widths.

**Architecture:** Add an explicit compact variant to the shared `PlannerControlDropdown` shell and enable it only for Group. CSS owns the 320px responsive shell width and makes the existing Group content fill that shell; no group state, model, or interaction logic changes.

**Tech Stack:** TypeScript 5.5, React 18, Next.js 14, Vitest, React Testing Library, existing CSS design tokens.

## Global Constraints

- Group preferred shell width is exactly 320px.
- Group maximum width on narrow screens is `calc(100vw - 24px)`.
- Filter and Sort retain the existing `min-width: min(540px, calc(100vw - 24px))` rule.
- Long group labels truncate rather than expanding the panel.
- Do not change group settings, persistence, candidates, ordering, visibility, drag, keyboard, or dismissal behavior.
- Do not add dependencies.
- Every commit follows `[TAG] English subject` plus a Korean bullet body.

---

### Task 1: Compact Group Dropdown Shell

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/styles/globals.css`
- Modify: `frontend/tests/architecture/design-boundaries.spec.ts`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes: existing `PlannerControlDropdown({ id?, title, children })` and Group dropdown call site.
- Produces: `PlannerControlDropdown({ id?, title, compact?, children })`, where `compact` adds `planner-control-dropdown-compact` without affecting default callers.

- [ ] **Step 1: Write a failing architecture contract test**

Extend the existing compact Group architecture test:

```ts
expect(styles).toMatch(
  /\.planner-control-dropdown-compact[^}]*width:\s*min\(320px, calc\(100vw - 24px\)\)/,
);
expect(styles).toMatch(
  /\.planner-control-dropdown-compact[^}]*min-width:\s*0/,
);
expect(styles).toMatch(
  /\.planner-control-dropdown-compact \.planner-group-settings-panel[^}]*width:\s*100%/,
);
expect(styles).toContain(
  "min-width: min(540px, calc(100vw - 24px));",
);
```

The regular-expression assertions must remain within one selector block by using `[^}]*`.

- [ ] **Step 2: Write a failing presentation assertion**

In the existing test that opens Group, add:

```tsx
const groupDialog = screen.getByRole("dialog", { name: "Group" });
expect(groupDialog).toHaveClass("planner-control-dropdown-compact");
```

In a Filter or Sort control test, assert the default shell is unchanged:

```tsx
const filterDialog = screen.getByRole("dialog", { name: "Filter" });
expect(filterDialog).not.toHaveClass("planner-control-dropdown-compact");
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
cd frontend
npm test -- --run tests/architecture/design-boundaries.spec.ts tests/presentation/workbench-wireframe.spec.tsx
```

Expected: FAIL because the compact class and CSS variant do not exist.

- [ ] **Step 4: Add the compact prop without changing default callers**

Update `PlannerControlDropdown`:

```tsx
function PlannerControlDropdown({
  id,
  title,
  compact = false,
  children,
}: {
  id?: string;
  title: string;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      id={id}
      className={`planner-control-dropdown${
        compact ? " planner-control-dropdown-compact" : ""
      }`}
      role="dialog"
      aria-label={title}
    >
      <div className="planner-control-dropdown-title">{title}</div>
      {children}
    </div>
  );
}
```

Pass `compact` only at the Group call site:

```tsx
<PlannerControlDropdown
  id="planner-group-dropdown"
  title="Group"
  compact
>
```

- [ ] **Step 5: Add responsive compact width rules**

Keep the existing default `.planner-control-dropdown` block unchanged and add:

```css
.planner-control-dropdown-compact {
  box-sizing: border-box;
  width: min(320px, calc(100vw - 24px));
  min-width: 0;
}

.planner-control-dropdown-compact .planner-group-settings-panel {
  width: 100%;
  min-width: 0;
}
```

Retain the existing `.planner-group-name` overflow, text-overflow, and white-space declarations so long labels continue to truncate.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
cd frontend
npm test -- --run tests/architecture/design-boundaries.spec.ts tests/presentation/workbench-wireframe.spec.tsx
```

Expected: both files PASS.

- [ ] **Step 7: Run all frontend gates**

Run:

```bash
cd frontend
npm run test
npm run typecheck
npm run build
```

Expected: all tests PASS, TypeScript exits 0, Next.js build succeeds without static-export rewrite warnings.

- [ ] **Step 8: Inspect and commit**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Then commit:

```bash
git add frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css frontend/tests/architecture/design-boundaries.spec.ts frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "[FIX] Compact planner group dropdown width" -m "- Group에만 320px 반응형 드롭다운 폭을 적용
- Filter와 Sort의 기존 폭 및 긴 그룹명 말줄임을 보존"
```

- [ ] **Step 9: Verify final repository state**

Run: `git status --short && git log --oneline -n 6`

Expected: worktree is clean and the compact width fix is the newest commit.
