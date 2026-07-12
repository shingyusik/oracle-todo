# Main Sidebar Icon Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Dashboard and ToDo as icon-only primary navigation tabs with labels revealed on hover or keyboard focus.

**Architecture:** `MainSidebar` maps each existing primary navigation id to a Lucide icon and exposes the tab label through `aria-label` and `data-tooltip`. `globals.css` owns the compact rail size and the tooltip presentation, while `workbenchLayout` remains the typed source for the matching dimensions.

**Tech Stack:** React 18, TypeScript, lucide-react, CSS, Vitest, Testing Library.

## Global Constraints

- Main tab rail width is exactly `64px`; the sub-sidebar remains `148px`; total sidebar width is `212px`.
- Use `LayoutDashboard` for Dashboard and `ListTodo` for ToDo from the existing `lucide-react` dependency.
- Keep primary tab buttons accessible by their existing `Dashboard` and `ToDo` names.
- Do not render the label as visible button text.
- Tooltip labels appear for hover and keyboard focus, and the existing active-state colors and navigation behavior remain unchanged.

---

### Task 1: Render compact primary tabs with accessible tooltips

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainSidebar.tsx`
- Modify: `frontend/src/styles/globals.css`
- Modify: `frontend/src/design/layout.ts`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`
- Modify: `frontend/tests/architecture/design-boundaries.spec.ts`

**Interfaces:**
- Consumes: `NavigationTab<MainTabId>` entries with `id` values `dashboard` and `todo`.
- Produces: `MainSidebar` buttons with `aria-label`, `data-tooltip`, and a decorative `.main-sidebar-tab-icon` SVG.
- Produces: `workbenchLayout.mainSidebarWidthPx === 64`, reflected in the sidebar CSS variables.

- [ ] **Step 1: Write the failing presentation and layout tests**

Add this test after the existing main-navigation rendering test in `frontend/tests/presentation/workbench-wireframe.spec.tsx`:

```tsx
  it("renders icon-only primary tabs with accessible tooltip labels", () => {
    render(<WorkbenchPageClient />);

    for (const label of ["Dashboard", "ToDo"]) {
      const tab = screen.getByRole("button", { name: label });

      expect(tab).toHaveAttribute("data-tooltip", label);
      expect(tab).not.toHaveTextContent(label);
      expect(tab.querySelector(".main-sidebar-tab-icon")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    }
  });
```

Change the first assertion in `frontend/tests/architecture/design-boundaries.spec.ts` from `112` to `64`:

```ts
    expect(workbenchLayout.mainSidebarWidthPx).toBe(64);
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
npm test -- tests/presentation/workbench-wireframe.spec.tsx tests/architecture/design-boundaries.spec.ts
```

Expected: the presentation test fails because primary tabs have no `data-tooltip` attribute and visible text remains; the architecture test fails because the typed width is still `112`.

- [ ] **Step 3: Implement icon-only buttons and compact tooltip styling**

Replace the `MainSidebar` tab loop with an exhaustive icon mapping and decorative icon rendering:

```tsx
const mainTabIcons: Record<MainTabId, LucideIcon> = {
  dashboard: LayoutDashboard,
  todo: ListTodo,
};

{tabs.map((tab) => {
  const TabIcon = mainTabIcons[tab.id];

  return (
    <button
      key={tab.id}
      type="button"
      className="main-sidebar-tab"
      aria-label={tab.label}
      data-tooltip={tab.label}
      data-active={tab.id === activeTabId}
      onClick={() => onSelectTab(tab.id)}
    >
      <TabIcon className="main-sidebar-tab-icon" aria-hidden="true" />
    </button>
  );
})}
```

Import `LayoutDashboard`, `ListTodo`, and `LucideIcon` from `lucide-react`. In `frontend/src/design/layout.ts`, set `mainSidebarWidthPx` to `64`. In `frontend/src/styles/globals.css`, update the CSS width variables to the derived `64px` and `212px`, center `.main-sidebar-tab` content, and add a right-positioned tooltip through `.main-sidebar-tab::after` visible for `:hover` and `:focus-visible`.

- [ ] **Step 4: Run focused tests and verify they pass**

Run:

```bash
npm test -- tests/presentation/workbench-wireframe.spec.tsx tests/architecture/design-boundaries.spec.ts
```

Expected: both test files pass with the primary tabs discoverable by accessible name, rendered without visible labels, and aligned to the `64px` typed layout constant.

- [ ] **Step 5: Run the frontend quality gates**

Run:

```bash
npm run typecheck && npm test && npm run build
```

Expected: TypeScript completes without errors, all frontend tests pass, and Next.js completes a production build.

- [ ] **Step 6: Commit the implementation**

```bash
git add frontend/src/features/workbench/ui/MainSidebar.tsx frontend/src/styles/globals.css frontend/src/design/layout.ts frontend/tests/presentation/workbench-wireframe.spec.tsx frontend/tests/architecture/design-boundaries.spec.ts
git commit -m "[UPDATE] Compact primary sidebar tabs"
```
