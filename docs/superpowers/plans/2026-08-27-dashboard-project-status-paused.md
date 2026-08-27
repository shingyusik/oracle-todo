# Dashboard Project Status Paused Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exclude paused projects and paused linked work from the Dashboard Project status widget without changing other Dashboard projections.

**Architecture:** Apply the scope-specific filters inside `buildProjectStats`, before existing status aggregation and progress calculation. Keep shared status mapping intact for Area, Today, and completion history, and align the widget empty-state copy with the active-project-only rule.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Filter paused Project status data

**Files:**
- Modify: `frontend/tests/domain/dashboard-model.spec.ts`
- Modify: `frontend/tests/domain/dashboard-widgets.spec.ts`
- Modify: `frontend/src/features/dashboard/model/dashboard-model.ts:249-273`
- Modify: `frontend/src/features/dashboard/model/dashboard-widgets.ts:246-250`

- [ ] **Step 1: Write the failing model regression test**

Add this case inside `describe("dashboard model", ...)`:

```ts
it("excludes paused projects and work only from Project status", () => {
  const snapshot = buildDashboardSnapshot([
    { id: "area", type: "area", title: "Work", status: "active" },
    { id: "active-project", type: "project", title: "Active", status: "active" },
    { id: "paused-project", type: "project", title: "Paused", status: "paused" },
    {
      id: "done",
      type: "task",
      title: "Done",
      status: "completed",
      project_id: "active-project",
      area_id: "area",
      scheduled: today,
    },
    {
      id: "open",
      type: "event",
      title: "Open",
      status: "active",
      project_id: "active-project",
      area_id: "area",
      scheduled: today,
    },
    {
      id: "paused-work",
      type: "task",
      title: "Paused work",
      status: "paused",
      project_id: "active-project",
      area_id: "area",
      scheduled: today,
    },
    {
      id: "hidden-project-work",
      type: "task",
      title: "Hidden project work",
      status: "active",
      project_id: "paused-project",
      area_id: "area",
      scheduled: today,
    },
  ], today);

  expect(snapshot.projects).toHaveLength(1);
  expect(snapshot.projects[0]).toMatchObject({
    id: "active-project",
    values: { completed: 1, incomplete: 1, paused: 0, missed: 0 },
    total: 2,
    progress: 0.5,
  });
  expect(snapshot.areas[0]).toMatchObject({
    values: { completed: 1, incomplete: 2, paused: 1, missed: 0 },
    total: 4,
  });
  expect(snapshot.todayOutcomes).toMatchObject({ completed: 1, incomplete: 3, total: 4 });
  expect(snapshot.completionHistory.days.at(-1)).toMatchObject({
    date: today,
    completed: 1,
    total: 4,
  });
});
```

- [ ] **Step 2: Update the widget copy expectation**

In the Project status widget test, change the expected empty message to:

```ts
emptyMessage: "Create an active Project to view status distribution.",
```

- [ ] **Step 3: Run focused tests and confirm both failures**

Run: `npm --prefix frontend test -- tests/domain/dashboard-model.spec.ts tests/domain/dashboard-widgets.spec.ts`

Expected: FAIL because the paused project and paused linked work are still present, and the widget still says `active or paused Project`.

- [ ] **Step 4: Implement the minimum Project status filters and copy change**

Update only the two filters in `buildProjectStats`:

```ts
return items
  .filter((item) => item.type === "project" && item.status === "active")
  .map((project) => {
    const linked = work.filter((item) =>
      item.project_id === project.id && item.status !== "paused"
    );
```

Update the Project status widget empty message:

```ts
emptyMessage: "Create an active Project to view status distribution.",
```

- [ ] **Step 5: Run focused and static verification**

Run: `npm --prefix frontend test -- tests/domain/dashboard-model.spec.ts tests/domain/dashboard-widgets.spec.ts`

Expected: PASS.

Run: `npm --prefix frontend run typecheck`

Expected: exits with code 0.

- [ ] **Step 6: Commit the behavior change**

```powershell
git add -- frontend/tests/domain/dashboard-model.spec.ts frontend/tests/domain/dashboard-widgets.spec.ts frontend/src/features/dashboard/model/dashboard-model.ts frontend/src/features/dashboard/model/dashboard-widgets.ts
git commit -m "[FIX] Exclude paused work from project status"
```
