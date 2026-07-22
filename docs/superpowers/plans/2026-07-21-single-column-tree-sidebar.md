# Single-Column Tree Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-column workbench navigation with one labeled tree sidebar while preserving all existing selection and expansion behavior.

**Architecture:** `WorkbenchWireframe` renders one `TreeSidebar` rather than separate main and sub sidebars. The component consumes the existing navigation arrays and `WorkbenchSelection` state; no domain navigation helper changes. CSS replaces the two-column layout with tree indentation, a Dashboard divider, and labeled top-level items.

**Tech Stack:** Next.js, React, TypeScript, Vitest, Testing Library, lucide-react, CSS.

## Global Constraints

- Reuse `workbenchNavigation`, `WorkbenchSelection`, `resolveSelection`, and group-expansion helpers unchanged.
- Preserve the existing sidebar width, logo header, panel selection, and independent Workspace/Planner expansion.
- Use visible labels and `aria-expanded` on expandable groups.
- Add no dependency and no navigation state abstraction.

---

## File Structure

- Create `frontend/src/features/workbench/ui/TreeSidebar.tsx`: renders the complete labeled navigation tree.
- Modify `frontend/src/features/workbench/ui/WorkbenchWireframe.tsx`: replaces the two sidebar components with `TreeSidebar`.
- Delete `frontend/src/features/workbench/ui/MainSidebar.tsx`: obsolete icon-rail component.
- Delete `frontend/src/features/workbench/ui/SubSidebar.tsx`: obsolete second-column tree component.
- Modify `frontend/src/styles/globals.css`: changes navigation layout and adds tree presentation styles.
- Modify `frontend/tests/presentation/workbench-wireframe.spec.tsx`: verifies the one-column hierarchy and retained behavior.

### Task 1: Establish the tree sidebar presentation contract

**Files:**
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`
- Create: `frontend/src/features/workbench/ui/TreeSidebar.tsx`
- Modify: `frontend/src/features/workbench/ui/WorkbenchWireframe.tsx`

**Interfaces:**
- Consumes: `workbenchNavigation.mainTabs`, `todoTabs`, `workspaceTabs`, `plannerTabs` and `WorkbenchController` selection fields.
- Produces: `TreeSidebar` with `controller: WorkbenchController` and `ariaLabel: string` props.

- [ ] **Step 1: Replace the icon-rail presentation assertion with a failing one-column hierarchy test**

```tsx
it("renders dashboard and todo in one labeled navigation tree", () => {
  render(<WorkbenchPageClient />);

  const navigation = screen.getByLabelText("Workbench navigation");
  const dashboard = within(navigation).getByRole("button", { name: "Dashboard" });
  const todo = within(navigation).getByRole("button", { name: "ToDo" });

  expect(dashboard).toHaveTextContent("Dashboard");
  expect(todo).toHaveTextContent("ToDo");
  expect(dashboard.compareDocumentPosition(todo) & Node.DOCUMENT_POSITION_FOLLOWING)
    .toBeTruthy();
  expect(navigation.querySelector(".tree-sidebar-divider")).not.toBeNull();
});
```

- [ ] **Step 2: Run the focused test to verify it fails because the divider and visible labels are absent**

Run: `cd frontend && npm test -- --run tests/presentation/workbench-wireframe.spec.tsx`

Expected: FAIL in `renders dashboard and todo in one labeled navigation tree`.

- [ ] **Step 3: Create the minimum `TreeSidebar` component**

```tsx
import { CalendarDays, ChevronDown, Folder, LayoutDashboard, ListTodo } from "lucide-react";
import React from "react";

import { workbenchNavigation, type NavigationTab, type WorkbenchTabId } from "@/domain/workbench/navigation";
import type { WorkbenchController } from "@/features/workbench/model/workbench-model";

type TreeSidebarProps = { controller: WorkbenchController; ariaLabel: string };

export function TreeSidebar({ controller, ariaLabel }: TreeSidebarProps) {
  const { selection, selectTab } = controller;
  const todoVisible = selection.mainTabId === "todo";
  const renderLeaves = (tabs: readonly NavigationTab[]) =>
    tabs.map((tab) => (
      <button key={tab.id} type="button" className="tree-sidebar-tab tree-sidebar-leaf"
        data-active={tab.id === selection.leafTabId} onClick={() => selectTab(tab.id as WorkbenchTabId)}>
        {tab.label}
      </button>
    ));

  return (
    <nav className="tree-sidebar" aria-label={ariaLabel}>
      <button type="button" className="tree-sidebar-tab tree-sidebar-top-level"
        data-active={selection.mainTabId === "dashboard"} onClick={() => selectTab("dashboard")}>
        <LayoutDashboard aria-hidden="true" />Dashboard
      </button>
      <div className="tree-sidebar-divider" role="separator" />
      <button type="button" className="tree-sidebar-tab tree-sidebar-top-level"
        data-active={selection.mainTabId === "todo"} onClick={() => selectTab("todo")}>
        <ListTodo aria-hidden="true" />ToDo
      </button>
      {todoVisible ? <div className="tree-sidebar-children">
        {workbenchNavigation.todoTabs.map((tab) => {
          const workspace = tab.id === "workspace";
          const expanded = workspace ? selection.workspaceExpanded : selection.plannerExpanded;
          const Icon = workspace ? Folder : CalendarDays;
          const leaves = workspace ? workbenchNavigation.workspaceTabs : workbenchNavigation.plannerTabs;
          return <div key={tab.id} className="tree-sidebar-group">
            <button type="button" className="tree-sidebar-tab tree-sidebar-parent" aria-expanded={expanded}
              data-active={expanded} onClick={() => selectTab(tab.id)}>
              <span><Icon aria-hidden="true" />{tab.label}</span><ChevronDown aria-hidden="true" />
            </button>
            {expanded ? <div className="tree-sidebar-leaves">{renderLeaves(leaves)}</div> : null}
          </div>;
        })}
      </div> : null}
    </nav>
  );
}
```

- [ ] **Step 4: Wire the component into the workbench before running the test**

```tsx
import { TreeSidebar } from "@/features/workbench/ui/TreeSidebar";

// Inside <aside>, after the logo:
<TreeSidebar controller={controller} ariaLabel={workbenchCopy.navigation.shellLabel} />
```

Remove the `MainSidebar`, `SubSidebar`, and `workbenchNavigation` imports, the
three `show*Tabs` locals, and the `<div className="workbench-nav-grid">` block.

- [ ] **Step 5: Run the focused test to verify it passes**

Run: `cd frontend && npm test -- --run tests/presentation/workbench-wireframe.spec.tsx`

Expected: PASS.

- [ ] **Step 6: Commit the test, component, and wiring**

```bash
git add frontend/tests/presentation/workbench-wireframe.spec.tsx frontend/src/features/workbench/ui/TreeSidebar.tsx frontend/src/features/workbench/ui/WorkbenchWireframe.tsx
git commit -m "[UPDATE] Render navigation as a tree sidebar"
```

### Task 2: Style the unified navigation and remove obsolete components

**Files:**
- Modify: `frontend/src/styles/globals.css`
- Delete: `frontend/src/features/workbench/ui/MainSidebar.tsx`
- Delete: `frontend/src/features/workbench/ui/SubSidebar.tsx`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes: `TreeSidebar({ controller, ariaLabel })` from Task 1.
- Produces: a one-column navigation layout with visible tree hierarchy.

- [ ] **Step 1: Add an interaction test that confirms Workspace and Planner retain independent expansion**

```tsx
it("keeps workspace and planner independently expanded in the tree", async () => {
  const user = userEvent.setup();
  render(<WorkbenchPageClient />);

  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Workspace" }));
  await user.click(screen.getByRole("button", { name: "Planner" }));

  expect(screen.getByRole("button", { name: "Workspace" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: "Planner" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: "Areas" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Yearly" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test to prove the existing navigation behavior remains intact**

Run: `cd frontend && npm test -- --run tests/presentation/workbench-wireframe.spec.tsx`

Expected: PASS.

- [ ] **Step 3: Replace the old rail/grid styles with the minimum tree styles**

```css
:root {
  --workbench-total-sidebar-width: 212px;
}

.tree-sidebar { display: flex; flex-direction: column; background: var(--color-canvas-cream); }
.tree-sidebar-tab { display: flex; align-items: center; min-height: 44px; border: 0; background: transparent; color: var(--color-ink); font-size: 14px; }
.tree-sidebar-top-level { gap: 8px; padding: 0 12px; font-weight: 600; }
.tree-sidebar-divider { margin: 8px 12px; border-top: 1px solid var(--color-hairline-light); }
.tree-sidebar-children { margin-left: 22px; border-left: 1px solid var(--color-hairline-light); padding-left: 8px; }
.tree-sidebar-parent { justify-content: space-between; padding: 0 8px; font-weight: 560; }
.tree-sidebar-parent > span { display: inline-flex; align-items: center; gap: 5px; }
.tree-sidebar-leaves { margin-left: 14px; border-left: 1px solid var(--color-hairline-light); }
.tree-sidebar-leaf { width: 100%; padding-left: 12px; }
.tree-sidebar-tab[data-active="true"] { background: var(--color-aloe); }
```

Remove `.workbench-nav-grid`, `.main-sidebar*`, `.sub-sidebar*`, and `.nested-tab-list` rules. In the mobile media query, replace the old main/sub sidebar selector with `.tree-sidebar` so it remains horizontally scrollable.

- [ ] **Step 4: Delete the obsolete two-column sidebar components**

```bash
git rm frontend/src/features/workbench/ui/MainSidebar.tsx frontend/src/features/workbench/ui/SubSidebar.tsx
```

- [ ] **Step 5: Run focused and complete frontend verification**

Run:

```bash
cd frontend && npm test -- --run tests/presentation/workbench-wireframe.spec.tsx
cd frontend && npm test
cd frontend && npm run typecheck
cd frontend && npm run build
```

Expected: all commands exit `0`.

- [ ] **Step 6: Commit the style and obsolete-file removal**

```bash
git add frontend/src/styles/globals.css frontend/src/features/workbench/ui/MainSidebar.tsx frontend/src/features/workbench/ui/SubSidebar.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "[UPDATE] Consolidate workbench navigation into one column"
```

### Task 3: Verify the final working tree

**Files:**
- Verify: `frontend/src/features/workbench/ui/TreeSidebar.tsx`
- Verify: `frontend/src/features/workbench/ui/WorkbenchWireframe.tsx`
- Verify: `frontend/src/styles/globals.css`
- Verify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes: completed Tasks 1 and 2.
- Produces: verified one-column tree sidebar with no change to domain navigation.

- [ ] **Step 1: Check that legacy component references are gone**

Run: `rg -n 'MainSidebar|SubSidebar|workbench-nav-grid|main-sidebar|sub-sidebar' frontend/src frontend/tests`

Expected: no matches.

- [ ] **Step 2: Run the final frontend quality gate**

Run:

```bash
cd frontend && npm test
cd frontend && npm run typecheck
cd frontend && npm run build
```

Expected: all commands exit `0`.

- [ ] **Step 3: Inspect the intended diff and commit history**

Run:

```bash
git status --short
git log --oneline -3
```

Expected: only unrelated pre-existing files remain uncommitted; the two sidebar commits are present.
