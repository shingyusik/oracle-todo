# Workspace Status Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Workspace status selector expose a stable, type-specific option list while displaying internal proposal states as `active` without changing stored data.

**Architecture:** Keep the Rust lifecycle and API payload unchanged. Consolidate the Workspace presentation mapping in `MainPanel.tsx`, then use the same helpers for inline and detail selectors. Lock the contract with presentation tests whose fixtures contain `proposed`, `approved`, `active`, and `paused` items.

**Tech Stack:** Next.js 14, React 18, TypeScript, Vitest, Testing Library

## Global Constraints

- Task options are exactly `active`, `completed`.
- Area options are exactly `active`, `archived`.
- Project, Routine, Event, and Goal options are exactly `active`, `paused`, `completed`.
- `proposed`, `approved`, and `waiting` are presentation-mapped to `active`; API and SQLite state remain unchanged.
- All mutations continue through existing transition endpoints and `TodoService`.
- Do not change the Rust state machine, API, CLI, schema, or dependencies.
- Preserve unrelated port/configuration changes already present in the working tree.

---

## File Structure

- Modify `frontend/src/features/workbench/ui/MainPanel.tsx`: own the three fixed profiles and stored-to-visible mapping shared by table and detail selectors.
- Modify `frontend/tests/presentation/workbench-wireframe.spec.tsx`: prove stable options and UI-only normalization across item types and selector locations.

### Task 1: Stabilize Workspace Status Profiles

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx:71-81,4500-4640`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx:14-28,5050-5150`

**Interfaces:**
- Consumes: `WorkspaceItemModel.type`, `WorkspaceItemModel.status`, existing `transitionActionForStatus(currentStatus, nextStatus)`, and controller transition actions.
- Produces: `statusOptionsForItem(item: WorkspaceItemModel): string[]` with an ordered fixed profile and `displayStatusForItem(item: WorkspaceItemModel): string` with UI-only normalization.

- [ ] **Step 1: Write the failing fixed-profile assertions**

Remove the `enabledStatusOptions` test helper. Rename the existing multi-type transition test to `shows stable status options for every item type` and replace its status assertions with:

```tsx
await user.click(screen.getByRole("button", { name: "Projects" }));
expect(await statusOptions("Project without DoD")).toEqual(["active", "paused", "completed"]);
expect(screen.getByLabelText("Status for Project without DoD")).toHaveValue("active");
expect(await statusOptions("Project with DoD")).toEqual(["active", "paused", "completed"]);

await user.click(screen.getByRole("button", { name: "Routines" }));
expect(await statusOptions("Routine without rule")).toEqual(["active", "paused", "completed"]);
expect(screen.getByLabelText("Status for Routine without rule")).toHaveValue("active");
expect(await statusOptions("Paused routine")).toEqual(["active", "paused", "completed"]);
expect(screen.getByLabelText("Status for Paused routine")).toHaveValue("paused");

await user.click(screen.getByRole("button", { name: "Events" }));
expect(await statusOptions("Event without scheduled")).toEqual(["active", "paused", "completed"]);
expect(await statusOptions("Scheduled event")).toEqual(["active", "paused", "completed"]);

await user.click(screen.getByRole("button", { name: "Areas" }));
expect(await statusOptions("Area")).toEqual(["active", "archived"]);

await user.click(screen.getByRole("button", { name: "Goals" }));
for (const title of ["Proposed goal", "Approved goal", "Active goal", "Paused goal"]) {
  expect(await statusOptions(title)).toEqual(["active", "paused", "completed"]);
}
expect(screen.getByLabelText("Status for Proposed goal")).toHaveValue("active");
expect(screen.getByLabelText("Status for Approved goal")).toHaveValue("active");
expect(screen.getByLabelText("Status for Paused goal")).toHaveValue("paused");
await user.click(screen.getByRole("cell", { name: "Proposed goal" }));
expect(await statusOptions("Proposed goal")).toEqual(["active", "paused", "completed"]);
expect(screen.getByLabelText("Status for Proposed goal")).toHaveValue("active");
await user.click(screen.getByRole("button", { name: "< Back" }));

await user.click(screen.getByRole("button", { name: "Tasks" }));
expect(await statusOptions("Proposed task")).toEqual(["active", "completed"]);
expect(screen.getByLabelText("Status for Proposed task")).toHaveValue("active");
```

Also remove the earlier `enabledStatusOptions("One")` assertion because every rendered option remains selectable.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd frontend
npx vitest run --no-file-parallelism tests/presentation/workbench-wireframe.spec.tsx -t "shows stable status options for every item type"
```

Expected: FAIL because Project and Goal still render stored proposal states and state-dependent option lists.

- [ ] **Step 3: Implement the three fixed profiles**

Replace the general and event-specific constants in `MainPanel.tsx` with:

```tsx
const workItemStatusOptions = ["active", "paused", "completed"];
const areaStatusOptions = ["active", "archived"];
const taskStatusOptions = ["active", "completed"];
```

Replace the state-dependent option and display helpers with:

```tsx
function statusOptionsForItem(item: WorkspaceItemModel): string[] {
  if (item.type === "area") {
    return areaStatusOptions;
  }
  if (item.type === "task") {
    return taskStatusOptions;
  }
  return workItemStatusOptions;
}

function detailStatusForItem(item: WorkspaceItemModel | null): string {
  return item ? displayStatusForItem(item) : "";
}

function displayStatusForItem(item: WorkspaceItemModel): string {
  if (item.type === "area") {
    return item.status === "archived" ? "archived" : "active";
  }
  if (item.type === "task") {
    return item.status === "completed" ? "completed" : "active";
  }
  if (item.status === "paused" || item.status === "completed") {
    return item.status;
  }
  return "active";
}
```

Delete `uniqueStatuses`, `visibleStatusOptionsForItem`, and `enabledStatusOptionsForItem`. Keep `StatusSelect`, `DetailStatusField`, and `transitionActionForStatus` wired to the existing helpers and endpoints.

- [ ] **Step 4: Run the focused presentation tests and verify GREEN**

Run:

```bash
cd frontend
npx vitest run --no-file-parallelism tests/presentation/workbench-wireframe.spec.tsx -t "shows stable status options for every item type|shows only active status choices and priority controls|hides approved from task and event status"
```

Expected: PASS with 3 passing tests and no unhandled errors.

- [ ] **Step 5: Run all frontend verification gates**

Run:

```bash
cd frontend
npm run test
npm run typecheck
npm run build
```

Expected: all Vitest suites pass, TypeScript exits 0, and the static Next.js export completes.

- [ ] **Step 6: Commit only the status-selector change**

Run:

```bash
git diff -- frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git add frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git diff --cached
git commit -m "[UPDATE] Stabilize workspace status options" -m "- 타입별 상태 선택지를 데이터와 무관한 고정 목록으로 통일했습니다.\n- proposed와 approved 등 내부 상태는 저장값을 유지한 채 active로 표시합니다.\n- 테이블과 상세 화면의 상태 옵션 계약을 프런트엔드 테스트로 고정했습니다."
```

Expected: one `[UPDATE]` commit containing only the two named files; unrelated port/configuration changes remain unstaged.
