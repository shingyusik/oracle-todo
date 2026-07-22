# Workspace Linked Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show direct child Workspace items in typed detail-panel lists and let users navigate safely to a selected child.

**Architecture:** A pure frontend model helper derives direct child relationships from the existing `workspaceItems.items` collection; it performs no I/O and does not alter parent selectors. The detail view renders the nonempty typed groups and owns the local unsaved-draft confirmation state before it calls the existing `openDetailView` controller action.

**Tech Stack:** Next.js, React, TypeScript, Vitest, Testing Library, existing Workbench CSS.

## Global Constraints

- Do not add a backend endpoint or change TodoService behavior.
- Preserve current Area, Project, Routine, and Parent selection fields as the source of parent relationships.
- Show only direct children; never traverse through intermediate items.
- Show only nonempty type groups and omit the complete section when no direct children exist.
- A dirty detail draft requires explicit confirmation before navigation; cancelling preserves the draft.
- Follow the existing Workbench detail panel, confirmation dialog, and `openDetailView` patterns.

## File Structure

| File | Responsibility |
| --- | --- |
| `frontend/src/features/workbench/model/linked-items.ts` | Pure direct-child filtering and stable type grouping. |
| `frontend/tests/domain/linked-items.spec.ts` | Unit coverage for relationship predicates and group ordering. |
| `frontend/src/features/workbench/ui/MainPanel.tsx` | Detail-panel section, linked-row navigation, and dirty-draft confirmation dialog. |
| `frontend/src/styles/globals.css` | Layout and interaction styles for linked-item groups and rows. |
| `frontend/tests/presentation/workbench-wireframe.spec.tsx` | End-to-end presentation behavior for rendering and navigation safety. |

---

### Task 1: Model direct Workspace child relationships

**Files:**
- Create: `frontend/src/features/workbench/model/linked-items.ts`
- Create: `frontend/tests/domain/linked-items.spec.ts`

**Interfaces:**
- Consumes: `WorkspaceItemModel` from `frontend/src/features/workbench/model/workbench-model.ts`.
- Produces: `linkedItemGroups(item: WorkspaceItemModel, items: WorkspaceItemModel[]): LinkedItemGroup[]`.
- Produces: `LinkedItemGroup = { type: LinkedItemType; label: string; items: WorkspaceItemModel[] }`, where `LinkedItemType` is `"project" | "routine" | "task" | "event" | "goal"`.

- [ ] **Step 1: Write the failing model tests**

```ts
import { describe, expect, it } from "vitest";

import { linkedItemGroups } from "@/features/workbench/model/linked-items";

const area = { id: "area-1", type: "area", title: "Health", status: "active" };

it("groups only direct Area children by supported type", () => {
  const groups = linkedItemGroups(area, [
    { id: "project-1", type: "project", title: "Checkup", status: "active", area_id: "area-1" },
    { id: "task-1", type: "task", title: "Book", status: "active", area_id: "area-1" },
    { id: "task-2", type: "task", title: "Indirect", status: "active", project_id: "project-1" },
  ]);

  expect(groups.map((group) => [group.type, group.items.map((item) => item.id)])).toEqual([
    ["project", ["project-1"]],
    ["task", ["task-1"]],
  ]);
});

it("maps project, routine, and goal to their direct relation field", () => {
  expect(linkedItemGroups(
    { id: "project-1", type: "project", title: "Checkup", status: "active" },
    [
      { id: "routine-1", type: "routine", title: "Prepare", status: "active", project_id: "project-1" },
      { id: "task-1", type: "task", title: "Book", status: "active", project_id: "project-1" },
      { id: "event-1", type: "event", title: "Visit", status: "active", project_id: "project-1" },
    ],
  ).map((group) => group.type)).toEqual(["routine", "task", "event"]);

  expect(linkedItemGroups(
    { id: "routine-1", type: "routine", title: "Stretch", status: "active" },
    [{ id: "task-1", type: "task", title: "Do", status: "active", routine_id: "routine-1" }],
  )[0]?.type).toBe("task");

  expect(linkedItemGroups(
    { id: "goal-1", type: "goal", title: "Fitness", status: "active" },
    [{ id: "goal-2", type: "goal", title: "Run", status: "active", parent_id: "goal-1" }],
  )[0]?.type).toBe("goal");
});

it("returns no groups for Task and Event", () => {
  expect(linkedItemGroups(
    { id: "task-1", type: "task", title: "Book", status: "active" },
    [{ id: "task-2", type: "task", title: "Child", status: "active", parent_id: "task-1" }],
  )).toEqual([]);
  expect(linkedItemGroups(
    { id: "event-1", type: "event", title: "Visit", status: "active" },
    [{ id: "task-1", type: "task", title: "Follow-up", status: "active", project_id: "event-1" }],
  )).toEqual([]);
});

it("excludes a malformed self-referencing child", () => {
  expect(linkedItemGroups(
    { id: "area-1", type: "area", title: "Health", status: "active", area_id: "area-1" },
    [{ id: "area-1", type: "project", title: "Invalid", status: "active", area_id: "area-1" }],
  )).toEqual([]);
});
```

- [ ] **Step 2: Run the model test to verify it fails**

Run: `npm test -- --run tests/domain/linked-items.spec.ts` from `frontend/`
Expected: FAIL because `linked-items` does not exist.

- [ ] **Step 3: Implement the minimal pure helper**

```ts
import type { WorkspaceItemModel } from "@/features/workbench/model/workbench-model";

export type LinkedItemType = "project" | "routine" | "task" | "event" | "goal";
export type LinkedItemGroup = {
  type: LinkedItemType;
  label: string;
  items: WorkspaceItemModel[];
};

const childRules: Record<string, { field: "area_id" | "project_id" | "routine_id" | "parent_id"; types: LinkedItemType[] }> = {
  area: { field: "area_id", types: ["project", "routine", "task", "event"] },
  project: { field: "project_id", types: ["routine", "task", "event"] },
  routine: { field: "routine_id", types: ["task"] },
  goal: { field: "parent_id", types: ["goal", "task"] },
};

export function linkedItemGroups(item: WorkspaceItemModel, items: WorkspaceItemModel[]): LinkedItemGroup[] {
  const rule = childRules[item.type];
  if (!rule) return [];
  return rule.types.flatMap((type) => {
    const children = items.filter((candidate) => candidate.id !== item.id && candidate.type === type && candidate[rule.field] === item.id);
    return children.length === 0 ? [] : [{ type, label: `${type[0]?.toUpperCase()}${type.slice(1)}s`, items: children }];
  });
}
```

Keep the supported type order exactly as each parent rule declares it. Do not include the current item even if malformed data points a relationship field at itself.

- [ ] **Step 4: Run the model tests and typecheck**

Run: `npm test -- --run tests/domain/linked-items.spec.ts && npm run typecheck` from `frontend/`
Expected: both commands exit 0.

- [ ] **Step 5: Commit the model slice**

```bash
git add frontend/src/features/workbench/model/linked-items.ts frontend/tests/domain/linked-items.spec.ts
git commit -m $'[ADD] Model workspace linked items\n\n- 직접 연결된 하위 Workspace 항목을 타입별로 계산\n- 다단계 관계 탐색 없이 Area·Project·Routine·Goal 규칙을 고정\n- 관계 규칙과 빈 그룹 제외 동작을 단위 테스트로 검증'
```

### Task 2: Render linked-item groups and safe detail navigation

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx:1-45, 121-176`
- Modify: `frontend/src/styles/globals.css:1413-1615`
- Modify: `frontend/tests/presentation/workbench-wireframe.spec.tsx:3499-3545`

**Interfaces:**
- Consumes: `linkedItemGroups(item, controller.workspaceItems.items)` from Task 1.
- Consumes: `hasDetailChanges(item, draft)` and `controller.openDetailView(item)` already defined in the Workbench detail flow.
- Produces: typed `Linked items` detail section and a modal `Discard unsaved changes?` confirmation before dirty-form navigation.

- [ ] **Step 1: Write the failing presentation tests**

Add a fixture response containing an Area plus a directly linked Project and Task. Add tests with the existing `WorkbenchPageClient` render helper style:

```tsx
it("renders nonempty linked-item groups and opens the selected child", async () => {
  const user = userEvent.setup();
  render(<WorkbenchPageClient />);
  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Workspace" }));
  await user.click(screen.getByRole("button", { name: "Areas" }));
  await user.click(await screen.findByRole("button", { name: "Open details for Health" }));

  const linkedItems = screen.getByRole("region", { name: "Linked items" });
  expect(within(linkedItems).getByRole("heading", { name: "Projects · 1" })).toBeInTheDocument();
  expect(within(linkedItems).getByRole("heading", { name: "Tasks · 1" })).toBeInTheDocument();
  await user.click(within(linkedItems).getByRole("button", { name: "Open Checkup details" }));
  expect(screen.getByLabelText("Checkup details")).toBeInTheDocument();
});

it("confirms before discarding a dirty detail draft to open a linked item", async () => {
  const user = userEvent.setup();
  // Render the same Area fixture and open Health details.
  await user.clear(screen.getByLabelText("Title"));
  await user.type(screen.getByLabelText("Title"), "Health draft");
  await user.click(screen.getByRole("button", { name: "Open Checkup details" }));

  expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByLabelText("Health details")).toBeInTheDocument();
  expect(screen.getByLabelText("Title")).toHaveValue("Health draft");

  await user.click(screen.getByRole("button", { name: "Open Checkup details" }));
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(screen.getByLabelText("Checkup details")).toBeInTheDocument();
});
```

Add a Task fixture with no direct children and assert `screen.queryByRole("region", { name: "Linked items" })` is `null`.

- [ ] **Step 2: Run the presentation tests to verify they fail**

Run: `npm test -- --run tests/presentation/workbench-wireframe.spec.tsx` from `frontend/`
Expected: FAIL because `Linked items` and the discard-navigation dialog are absent.

- [ ] **Step 3: Add detail view state and markup**

In `DetailView`, add pending-navigation state next to `draft`, then derive `groups` after `hasDraftChanges`:

```tsx
const [pendingLinkedItem, setPendingLinkedItem] = React.useState<WorkspaceItemModel | null>(null);
const groups = linkedItemGroups(detailItem, controller.workspaceItems.items);

function openLinkedItem(nextItem: WorkspaceItemModel) {
  if (hasDraftChanges) {
    setPendingLinkedItem(nextItem);
    return;
  }
  controller.openDetailView(nextItem);
}

function discardDraftAndOpenLinkedItem() {
  if (!pendingLinkedItem) return;
  controller.openDetailView(pendingLinkedItem);
  setPendingLinkedItem(null);
}
```

Render after the `detail-properties` block only when `groups.length > 0`:

```tsx
<section className="linked-items" aria-label="Linked items">
  <h2>Linked items</h2>
  {groups.map((group) => (
    <section className="linked-items-group" key={group.type}>
      <h3>{group.label} · {group.items.length}</h3>
      <ul>
        {group.items.map((linkedItem) => (
          <li key={linkedItem.id}>
            <button type="button" aria-label={`Open ${linkedItem.title} details`} onClick={() => openLinkedItem(linkedItem)}>
              <span>{linkedItem.title}</span><span>{linkedItem.status}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  ))}
</section>
```

Render the confirmation using the established `.confirmation-backdrop` and `.confirmation-dialog` classes. Its cancel handler only clears `pendingLinkedItem`; its discard handler calls `discardDraftAndOpenLinkedItem`. Add an Escape key handler that performs the same cancel behavior and focus the Cancel button when the dialog appears.

- [ ] **Step 4: Add focused styles without changing existing detail fields**

Add styles adjacent to `.detail-properties`:

```css
.linked-items { display: grid; gap: 12px; margin-top: 28px; }
.linked-items-group { display: grid; gap: 6px; }
.linked-items-group h3 { margin: 0; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; }
.linked-items-group ul { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
.linked-items-group button { display: flex; justify-content: space-between; width: 100%; padding: 9px 10px; text-align: left; }
```

Use existing color, border, radius, and focus variables/classes already used by detail controls. Do not change the selector grid or parent-relation field styles.

- [ ] **Step 5: Run focused tests, complete frontend verification, and commit**

Run: `npm test -- --run tests/domain/linked-items.spec.ts tests/presentation/workbench-wireframe.spec.tsx && npm run typecheck && npm run build` from `frontend/`
Expected: all commands exit 0.

```bash
git add frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m $'[ADD] Navigate workspace linked items\n\n- 상세 화면에서 직접 연결된 하위 항목을 타입별 목록으로 표시\n- 연결 항목 클릭 시 기존 상세 화면 전환을 재사용\n- 저장되지 않은 수정은 확인 후에만 버리고 이동하도록 보호'
```

### Task 3: Verify the completed feature against the approved design

**Files:**
- Verify: `docs/superpowers/specs/2026-07-22-workspace-linked-items-design.md`
- Verify: `frontend/src/features/workbench/model/linked-items.ts`
- Verify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Verify: `frontend/tests/domain/linked-items.spec.ts`
- Verify: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes: the finished direct-child model and detail navigation from Tasks 1–2.
- Produces: evidence that every approved relationship, empty-state, and dirty-navigation rule is covered.

- [ ] **Step 1: Run the complete frontend test suite**

Run: `npm test` from `frontend/`
Expected: all Vitest suites exit 0.

- [ ] **Step 2: Re-check the design coverage**

Verify all of the following directly in code and tests:

```text
Area -> Project/Routine/Task/Event by area_id
Project -> Routine/Task/Event by project_id
Routine -> Task by routine_id
Goal -> Goal/Task by parent_id
Task/Event -> no linked section
only direct children and nonempty type groups
clean navigation is immediate
dirty navigation requires discard confirmation and cancellation preserves draft
```

- [ ] **Step 3: Inspect the final diff and repository state**

Run: `git status --short && git log --oneline -3` from the repository root
Expected: only the two Task commits are present for this feature and no unexpected worktree changes exist.
