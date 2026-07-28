# Planner Tag, Popover, and Monthly Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify Planner creation tags, make table menus viewport-safe, and add direct Monthly navigation.

**Architecture:** Keep all work in the existing `MainPanel.tsx` interaction layer. Reuse `TagsInput`, portal table controls to `document.body` with fixed viewport positioning, and extend existing period navigation through current controller methods.

**Tech Stack:** React 18, TypeScript, React Testing Library, Vitest, CSS, Next.js 14.

## Global Constraints

- Do not change the todo-engine API, database schema, or Planner controller public contract.
- Preserve accessible labels, Escape/outside-click dismissal, and focus restoration.
- Retain `parseTagInput`, `formatTags`, and `sameTags` semantics; do not add another tag normalization rule.
- Menus escaping a scroll container must use `createPortal(..., document.body)` with fixed coordinates.

---

### Task 1: Reuse chip tags in Planner creation

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx:4840-5070,5412-5554`
- Modify: `frontend/src/styles/globals.css:1425-1518`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes: `TagsInput`, `controller.workspaceItems.tagOptions`, and `CreateWorkspaceItemForm.tags?: string[]`.
- Produces: selected `string[]` tags plus chip/search/remove behavior in CreationDialog.

- [ ] **Step 1: Write the failing interaction test**

```tsx
await user.click(screen.getByRole("button", { name: "Add to Today" }));
await user.click(screen.getByRole("button", { name: "Tags" }));
await user.type(screen.getByRole("textbox", { name: "Tags" }), "focus{Enter}");
expect(screen.getByText("focus")).toBeInTheDocument();
await user.click(screen.getByRole("button", { name: "Remove focus tag" }));
expect(screen.queryByText("focus")).not.toBeInTheDocument();
```

- [ ] **Step 2: Verify it fails**

Run: `npm test -- --run frontend/tests/presentation/workbench-wireframe.spec.tsx`

Expected: FAIL because CreationDialog renders only a comma-separated input.

- [ ] **Step 3: Use the shared tag control**

```tsx
const [tags, setTags] = React.useState<string[]>(creationPrefills.tags ?? []);
<TagsInput label="Tags" value={tags} tagOptions={controller.workspaceItems.tagOptions} onCommit={setTags} />
// create payload
tags: tags.length > 0 ? tags : undefined,
```

Delete string tag state and `parseTagInput(tags)` from CreationDialog. Keep this in the existing creation-context metadata block.

- [ ] **Step 4: Add any required dialog-only sizing CSS**

```css
.confirmation-dialog .tag-combobox,
.confirmation-dialog .tag-input { min-width: 0; }
```

- [ ] **Step 5: Verify and commit**

Run: `npm test -- --run frontend/tests/presentation/workbench-wireframe.spec.tsx && npm run typecheck`

Expected: PASS and typecheck exit code 0.

Commit: `[UPDATE] Unify Planner creation tags` with a Korean bullet body.

### Task 2: Portal Planner Filter, Sort, and Group menus

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx:1160-1350,6101-6140`
- Modify: `frontend/src/styles/globals.css:1090-1140`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes: existing trigger/panel refs, `PlannerControlDropdown`, and `goalPeriodPopoverStyle(trigger, popover)` behavior.
- Produces: `PlannerControlMenuPortal` and `plannerControlDropdownStyle(trigger, popover)`; every open menu becomes a `document.body` descendant.

- [ ] **Step 1: Write the failing portal test**

```tsx
await user.click(screen.getByRole("button", { name: "Filter Month Goals" }));
const dialog = screen.getByRole("dialog", { name: "Filter Month Goals" });
expect(dialog.parentElement).toBe(document.body);
expect(dialog).toHaveStyle({ position: "fixed" });
```

- [ ] **Step 2: Verify it fails**

Run: `npm test -- --run frontend/tests/presentation/workbench-wireframe.spec.tsx`

Expected: FAIL because the menu is an absolutely positioned descendant of `.planner-view-actions`.

- [ ] **Step 3: Implement the portal wrapper**

```tsx
function PlannerControlMenuPortal({ triggerRef, children }: {
  triggerRef: React.RefObject<HTMLButtonElement>;
  children: React.ReactNode;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = React.useState<React.CSSProperties>();
  React.useLayoutEffect(() => {
    const update = () => triggerRef.current && popoverRef.current &&
      setStyle(plannerControlDropdownStyle(triggerRef.current, popoverRef.current));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [triggerRef]);
  return createPortal(<div ref={popoverRef} style={style}>{children}</div>, document.body);
}
```

Portal all filter/sort/group menu wrappers while keeping their refs attached for existing outside-click handling. Reuse the 16px margin, horizontal clamp, upward flip, and height constraint from `goalPeriodPopoverStyle`; extract shared math only when needed to avoid duplication.

- [ ] **Step 4: Use fixed bounded menu CSS**

```css
.planner-control-dropdown {
  position: fixed;
  z-index: 40;
  max-height: calc(100vh - 32px);
  overflow: auto;
}
```

- [ ] **Step 5: Verify and commit**

Run: `npm test -- --run frontend/tests/presentation/workbench-wireframe.spec.tsx && npm run typecheck`

Expected: PASS; Filter, Sort, and Group menus are portal-rendered and viewport-bounded.

Commit: `[FIX] Keep Planner control menus in viewport` with a Korean bullet body.

### Task 3: Add Monthly previous/next/now and year-month picker

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx:1260-1510,6000-6160`
- Modify: `frontend/src/styles/globals.css:250-330`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes: `controller.movePlannerPeriod`, `controller.resetPlannerPeriodToToday`, `controller.selectPlannerPeriodDate`, `monthStart`, `goalYearOptions`, and the existing portal date-picker pattern.
- Produces: `PlannerMonthPicker` and labeled Previous month, Next month, Now, and Choose Monthly date controls.

- [ ] **Step 1: Write the failing Monthly navigation test**

```tsx
await user.click(screen.getByRole("button", { name: "Monthly" }));
await user.click(screen.getByRole("button", { name: "Previous month" }));
expect(screen.getByRole("button", { name: "Choose Monthly date" })).toBeInTheDocument();
await user.click(screen.getByRole("button", { name: "Now" }));
await user.click(screen.getByRole("button", { name: "Choose Monthly date" }));
await user.selectOptions(screen.getByLabelText("Year"), String(new Date().getFullYear() + 1));
await user.selectOptions(screen.getByLabelText("Month"), "06");
```

- [ ] **Step 2: Verify it fails**

Run: `npm test -- --run frontend/tests/presentation/workbench-wireframe.spec.tsx`

Expected: FAIL because `PlannerPeriodNavigation` returns `null` for Monthly.

- [ ] **Step 3: Extend navigation and implement month selection**

```tsx
const isMonthly = controller.panel.id === "monthly";
if (!isMonthly && controller.panel.id !== "weekly" && controller.panel.id !== "daily") return null;
// Render PlannerMonthPicker for monthly, PlannerDatePicker otherwise.

const selected = monthStart(controller.planner.date);
const commit = (year: string, month: string) =>
  controller.selectPlannerPeriodDate(`${year}-${month}-01`);
```

Use `goalYearOptions(Number(year))` and `01`–`12` values. PlannerMonthPicker must mirror PlannerDatePicker's portal, Escape/outside-click dismissal, focus restoration, and viewport positioning.

- [ ] **Step 4: Add compact selector layout**

```css
.planner-month-picker-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
```

- [ ] **Step 5: Verify and commit**

Run: `npm test -- --run frontend/tests/presentation/workbench-wireframe.spec.tsx && npm run typecheck`

Expected: PASS; arrows, Now, and direct selection update the visible month.

Commit: `[ADD] Navigate Planner months directly` with a Korean bullet body.

### Task 4: Full frontend verification and documentation check

**Files:**
- Modify if needed: `README.md` or `docs/operations/`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes: all completed Planner UI behaviors.
- Produces: verified build and accurate user documentation when existing docs mention these controls.

- [ ] **Step 1: Check documentation impact**

Run: `rg -n "Planner|Monthly|Filter|Sort|Group by|tag" README.md docs frontend/README.md`

Expected: update only inaccurate or missing user-facing Planner control documentation.

- [ ] **Step 2: Run the complete frontend quality gate**

Run: `npm test && npm run typecheck && npm run build`

Expected: all commands exit 0.

- [ ] **Step 3: Manually test the clipped-menu scenario**

Run: `npm run dev`

Open Monthly Planner with a table control near the viewport bottom. Confirm Filter, Sort, and Group menus flip above if needed, remain horizontally visible, scroll internally if tall, and dismiss via Escape/outside click. Confirm all monthly navigation controls update the calendar.

- [ ] **Step 4: Commit documentation only if changed**

Commit: `[DOCS] Document Planner interaction updates` with a Korean bullet body. Skip this commit when the documentation scan finds nothing to update.

## Plan Self-Review

- Spec coverage: Task 1 covers unified creation tags; Task 2 covers clip-proof Filter/Sort/Group menus; Task 3 covers all Monthly controls; Task 4 validates and documents the result.
- Placeholder scan: each task contains concrete files, interfaces, code, commands, and expected outcomes.
- Type consistency: all interactions use existing `WorkbenchController` methods and the current `TagsInput` contract; new helpers stay internal to `MainPanel.tsx`.
