# Filter Dropdown and Tag Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent nested filter option lists from being clipped and remove the visible `Add` tag trigger across every shared tag input.

**Architecture:** Keep the filter option list in its current React/DOM hierarchy but position it against the viewport with the existing dropdown geometry helper, which escapes the outer scroll panel without adding a new popover abstraction. Change only the shared `TagsInput`, so ToDo and Health consumers inherit the same full-field click behavior and empty-state hint.

**Tech Stack:** React 18, TypeScript, CSS, Vitest, Testing Library

---

## File Structure

- Modify `frontend/src/features/workbench/ui/TableViewControls.tsx`: measure and viewport-position open filter option lists.
- Modify `frontend/src/features/workbench/ui/TagsInput.tsx`: open from the shared field surface and replace the visible `Add` label.
- Modify `frontend/src/styles/globals.css`: style the tag trigger as the flexible field surface.
- Modify `frontend/tests/presentation/workbench-wireframe.spec.tsx`: cover filter option positioning.
- Modify `frontend/tests/presentation/health-forms.spec.tsx`: cover shared tag input behavior used by both Health and ToDo.

### Task 1: Escape the Filter Panel Clip

**Files:**
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx:1230-1360`
- Modify: `frontend/src/features/workbench/ui/TableViewControls.tsx:1008-1080`

- [ ] **Step 1: Write the failing filter positioning test**

Add a direct `TableViewControls` test beside the supplied-policy tests. Render one existing Status rule, mock `getBoundingClientRect()` so the trigger is near the viewport bottom and the option list is taller than the space below, open the list, and assert fixed placement above the trigger:

```tsx
it("positions filter option lists against the viewport instead of the filter panel", async () => {
  const user = userEvent.setup();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement): DOMRect {
      const isTrigger = this.getAttribute("aria-label") === "Select Status filter values";
      const isOptions = this.classList.contains("planner-filter-option-list");
      const top = isTrigger ? 700 : 0;
      const left = isTrigger ? 420 : 0;
      const width = isOptions ? 180 : isTrigger ? 160 : 320;
      const height = isOptions ? 160 : isTrigger ? 32 : 200;
      return {
        x: left, y: top, top, left, width, height,
        right: left + width, bottom: top + height,
        toJSON: () => ({}),
      } as DOMRect;
    },
  );
  const settings: PlannerTableSettings = {
    filterMode: "and",
    filterRules: [{
      id: "status-rule", field: "status", type: "select", operator: "is", value: [],
    }],
    sortRules: [],
    groupSettings: defaultPlannerGroupSettings(),
  };
  const adapter = {
    scopeId: "position.scope",
    title: "Position",
    settings,
    filterFields: ["status"] as const,
    sortFields: ["updated"] as const,
    groupOptions: [{ value: "none" as const, label: "None" }],
    candidates: [],
    filterOptions: {
      tags: [],
      daily: {
        tags: [], areas: [], projects: [], currencies: [], routines: [],
        statuses: [{ value: "active", label: "active" }], priorities: [],
        horizons: [], parents: [], materializationPolicies: [], participants: [],
      },
    },
    dropdownIdPrefix: "position",
    isDefaultSort: () => true,
    update: vi.fn(),
  };

  render(<TableViewControls adapter={adapter} />);
  await user.click(screen.getByRole("button", { name: "Filter Position" }));
  await user.click(screen.getByRole("button", { name: "Select Status filter values" }));

  const options = document.querySelector<HTMLElement>(".planner-filter-option-list");
  expect(options).not.toBeNull();
  await waitFor(() => expect(options).toHaveStyle({ position: "fixed" }));
  expect(Number.parseInt(options!.style.top, 10)).toBeLessThan(700);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm --prefix frontend test -- tests/presentation/workbench-wireframe.spec.tsx -t "positions filter option lists against the viewport"
```

Expected: FAIL because `.planner-filter-option-list` still uses only its absolute CSS position and has no fixed inline style.

- [ ] **Step 3: Add viewport positioning to the existing dropdown**

In `TableViewFilterOptionDropdown`, add refs and an inline style state, then reuse `tableViewControlDropdownStyle`:

```tsx
const triggerRef = React.useRef<HTMLButtonElement>(null);
const optionListRef = React.useRef<HTMLDivElement>(null);
const [optionListStyle, setOptionListStyle] = React.useState<React.CSSProperties>();

React.useLayoutEffect(() => {
  if (!open) return;
  function update() {
    if (triggerRef.current && optionListRef.current) {
      setOptionListStyle(
        tableViewControlDropdownStyle(triggerRef.current, optionListRef.current),
      );
    }
  }
  update();
  window.addEventListener("resize", update);
  window.addEventListener("scroll", update, true);
  return () => {
    window.removeEventListener("resize", update);
    window.removeEventListener("scroll", update, true);
  };
}, [open]);
```

Attach `ref={triggerRef}` to `.planner-filter-value-trigger`, and attach both `ref={optionListRef}` and `style={optionListStyle}` to `.planner-filter-option-list`. Do not change the outer filter panel overflow behavior.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2.

Expected: PASS with one matching test and no warnings.

- [ ] **Step 5: Commit the filter fix**

```powershell
git add -- frontend/src/features/workbench/ui/TableViewControls.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "[FIX] Keep filter option lists outside scroll clipping"
```

### Task 2: Apply Full-Field Tag Opening Everywhere

**Files:**
- Modify: `frontend/tests/presentation/health-forms.spec.tsx:342-385`
- Modify: `frontend/src/features/workbench/ui/TagsInput.tsx:175-218`
- Modify: `frontend/src/styles/globals.css:1928-1978`

- [ ] **Step 1: Write the failing shared-component test**

Add this beside the existing tag relationship tests:

```tsx
it("opens the shared tag dropdown from the field without a visible Add button", async () => {
  const user = userEvent.setup();
  render(<TagsInput label="Tags" value={[]} tagOptions={["rice"]} onCommit={vi.fn()} />);

  const trigger = screen.getByRole("button", { name: "Tags" });
  const field = trigger.closest<HTMLElement>(".tag-input");
  expect(field).not.toBeNull();
  expect(trigger).toHaveTextContent("Select or enter tags...");
  expect(trigger).not.toHaveTextContent(/^Add$/);

  await user.click(field!);
  expect(screen.getByRole("combobox", { name: "Tags" })).toBeVisible();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm --prefix frontend test -- tests/presentation/health-forms.spec.tsx -t "opens the shared tag dropdown from the field"
```

Expected: FAIL because the trigger still displays `Add` and a click targeted at the containing field does not open the dropdown.

- [ ] **Step 3: Implement the shared tag behavior**

In `TagsInput`, make the field surface open the dropdown unless disabled, keep remove-button propagation blocked, and render the selected empty-state hint only when there are no tags:

```tsx
<div
  className="tag-input"
  onClick={() => {
    if (!disabled) setOpen(true);
  }}
>
  {currentTags.map((tag) => (
    <span className="tag-chip" key={tag}>
      {tag}
      <button
        type="button"
        aria-label={`Remove ${tag} tag`}
        onClick={(event) => {
          stopEvent(event);
          commitTags(currentTags.filter((currentTag) => currentTag !== tag));
        }}
      >
        <X aria-hidden="true" size={14} />
      </button>
    </span>
  ))}
  <button
    ref={triggerRef}
    type="button"
    className="tag-input-trigger"
    aria-label={label}
    aria-haspopup="listbox"
    aria-controls={open ? listboxId : undefined}
    aria-expanded={open}
    disabled={disabled}
    onClick={(event) => {
      stopEvent(event);
      setOpen(true);
    }}
  >
    {currentTags.length === 0 ? "Select or enter tags..." : null}
  </button>
</div>
```

Add only the CSS needed to turn the existing trigger into the remaining field surface:

```css
.tag-input-trigger {
  min-height: 26px;
  min-width: 80px;
  flex: 1 1 80px;
  align-self: stretch;
  border: 0;
  background: transparent;
  padding: 0 2px;
  color: var(--color-shade-50);
  font: inherit;
  text-align: left;
  cursor: text;
}
```

- [ ] **Step 4: Run shared, ToDo, and Health tag tests**

Run:

```powershell
npm --prefix frontend test -- tests/presentation/health-forms.spec.tsx -t "tag"
npm --prefix frontend test -- tests/presentation/workbench-wireframe.spec.tsx -t "tag"
```

Expected: both commands PASS; the shared component test proves the visual `Add` label is removed for every consumer.

- [ ] **Step 5: Commit the shared tag change**

```powershell
git add -- frontend/src/features/workbench/ui/TagsInput.tsx frontend/src/styles/globals.css frontend/tests/presentation/health-forms.spec.tsx
git commit -m "[UPDATE] Open all tag inputs from the full field"
```

### Task 3: Verify the Frontend

**Files:**
- Verify only; no production file changes expected.

- [ ] **Step 1: Run formatting-sensitive type checks**

```powershell
npm --prefix frontend run typecheck
```

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 2: Run the full frontend suite**

```powershell
npm --prefix frontend test
```

Expected: exit code 0 with zero failed tests.

- [ ] **Step 3: Build the static frontend**

```powershell
npm --prefix frontend run build
```

Expected: exit code 0 and a successful Next.js production build.

- [ ] **Step 4: Inspect the final change set**

```powershell
git status --short
git log --oneline -n 6
```

Expected: no uncommitted source/test changes and two implementation commits after the design/plan commits.
