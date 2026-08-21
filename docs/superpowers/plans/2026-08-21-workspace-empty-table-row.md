# Workspace Empty Table Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every empty Workspace table message span the table's full native row width.

**Architecture:** Give the shared `WorkspaceGroupedRows` renderer an explicit `columnCount` supplied by its two callers. Use that value for both empty-cell and group-heading `colSpan`, deleting the current rendered-row inspection helper.

**Tech Stack:** React, TypeScript, Testing Library, Vitest

---

### Task 1: Make shared Workspace rows use an explicit column count

**Files:**
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`
- Modify: `frontend/src/features/workbench/ui/WorkspaceGroupedRows.tsx`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`

- [ ] **Step 1: Write failing shared-renderer and Workspace integration tests**

Import the shared renderer in `frontend/tests/presentation/workbench-wireframe.spec.tsx`:

```tsx
import { WorkspaceGroupedRows } from "@/features/workbench/ui/WorkspaceGroupedRows";
```

Add this test inside `describe("WorkbenchPageClient", ...)` to cover both the empty row and grouped heading contracts without DOM inference:

```tsx
it("spans shared empty rows and group headings across the declared columns", () => {
  const row = { id: "item-1" } as WorkspaceItemModel;
  const { rerender } = render(
    <table>
      <WorkspaceGroupedRows
        columnCount={4}
        emptyMessage="Nothing here."
        groups={[]}
        renderRow={() => null}
      />
    </table>,
  );

  expect(screen.getByRole("cell", { name: "Nothing here." })).toHaveAttribute(
    "colspan",
    "4",
  );

  rerender(
    <table>
      <WorkspaceGroupedRows
        columnCount={4}
        emptyMessage="Nothing here."
        groups={[{ key: "active", label: "Active", items: [row] }]}
        renderRow={(item) => (
          <tr key={item.id}>
            <td>One</td>
            <td>Two</td>
            <td>Three</td>
            <td>Four</td>
          </tr>
        )}
      />
    </table>,
  );

  expect(screen.getByRole("rowgroup", { name: "Active group" }))
    .toContainElement(screen.getByRole("rowheader", { name: "Active" }));
  expect(screen.getByRole("rowheader", { name: "Active" })).toHaveAttribute(
    "colspan",
    "4",
  );
});
```

Extend the existing `"exposes shared view controls and saved tabs on every Workspace table"` loop so all six Workspace tables prove their empty cell spans every header column:

```tsx
const table = screen.getByRole("table", { name: `${title} items` });
const emptyCell = screen.getByText(`No ${title.toLowerCase()} found.`).closest("td");

expect(emptyCell).toBeVisible();
expect(emptyCell).toHaveAttribute(
  "colspan",
  String(within(table).getAllByRole("columnheader").length),
);
```

Add a linked-items integration test beside the existing linked Project/Task controls tests. It filters the only linked Project out and proves the empty row keeps the linked table's single-column contract:

```tsx
it("spans an empty linked-items view across its single column", async () => {
  const user = userEvent.setup();
  await openOverflowAreaDetail(user);

  const projects = linkedItemTypeGroup("Projects · 1");
  await user.click(within(projects).getByRole("button", { name: "Filter Projects" }));
  const filter = screen.getByRole("dialog", { name: "Filter Projects" });
  await user.click(within(filter).getByRole("button", { name: "Add filter rule" }));
  await user.click(within(filter).getByRole("option", { name: "Status" }));
  await user.click(within(filter).getByRole("button", {
    name: "Select Status filter values",
  }));
  await user.click(within(filter).getByRole("checkbox", { name: "completed" }));

  const emptyCell = within(projects)
    .getByText("No linked items match this view.")
    .closest("td");
  expect(emptyCell).toHaveAttribute("colspan", "1");
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm --prefix frontend test -- workbench-wireframe.spec.tsx
```

Expected: FAIL because `WorkspaceGroupedRows` does not accept `columnCount`, its empty cell has no `colspan`, and both main and linked Workspace callers leave empty cells in the first column.

- [ ] **Step 3: Replace rendered-row inspection with the explicit native span**

Update `frontend/src/features/workbench/ui/WorkspaceGroupedRows.tsx` to accept and use `columnCount`:

```tsx
export function WorkspaceGroupedRows({
  groups,
  renderRow,
  emptyMessage,
  bodyClassName,
  columnCount,
}: {
  groups: WorkspaceViewGroup[];
  renderRow(item: WorkspaceItemModel): React.ReactNode;
  emptyMessage: string;
  bodyClassName?: string;
  columnCount: number;
}): React.ReactElement {
  if (groups.length === 0) {
    return (
      <tbody className={bodyClassName}>
        <tr className="workspace-table-empty-row">
          <td className="items-message workspace-table-empty-cell" colSpan={columnCount}>
            {emptyMessage}
          </td>
        </tr>
      </tbody>
    );
  }

  if (groups.length === 1 && groups[0]?.key === "all") {
    return <tbody className={bodyClassName}>{groups[0].items.map(renderRow)}</tbody>;
  }

  return (
    <>
      {groups.map((group) => (
        <tbody
          aria-label={`${group.label} group`}
          className={bodyClassName}
          key={group.key}
        >
          <tr className="workspace-group-heading">
            <th scope="rowgroup" colSpan={columnCount}>
              {group.label}
            </th>
          </tr>
          {group.items.map(renderRow)}
        </tbody>
      ))}
    </>
  );
}
```

Delete `workspaceRowColumnCount`; the caller already knows the real table width.

- [ ] **Step 4: Supply the two existing table widths**

In the main Workspace table call in `frontend/src/features/workbench/ui/MainPanel.tsx`, add:

```tsx
<WorkspaceGroupedRows
  columnCount={columns.length + 1}
  groups={groups}
```

The `+ 1` is the leading selection-checkbox column.

In the linked-items table call, add:

```tsx
<WorkspaceGroupedRows
  columnCount={1}
  groups={collapsed.groups}
```

The linked-items table renders exactly one data column.

- [ ] **Step 5: Run focused verification and verify GREEN**

Run:

```powershell
npm --prefix frontend test -- workbench-wireframe.spec.tsx
npm --prefix frontend run typecheck
```

Expected: the Workbench presentation suite and TypeScript check both PASS.

- [ ] **Step 6: Run production and repository checks**

Run:

```powershell
npm --prefix frontend run build
git diff --check
git status --short
```

Expected: build and diff check PASS; status lists only the three task files plus the pre-existing user-owned `frontend/package-lock.json` change.

- [ ] **Step 7: Commit only the implementation files**

```powershell
git add frontend/src/features/workbench/ui/WorkspaceGroupedRows.tsx frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "[FIX] Span workspace empty table rows"
```

Expected: the commit excludes `frontend/package-lock.json`.
