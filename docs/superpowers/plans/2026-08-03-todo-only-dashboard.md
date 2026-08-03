# ToDo-Only Dashboard Implementation Plan

> **For Codex:** Follow this plan task by task with test-first changes and the repository's structured commit rules.

**Goal:** Restore the Dashboard to the original four ToDo analytics cards and stop the Dashboard UI from loading or rendering Ledger, Health Journal, and recent-activity summaries.

**Architecture:** Keep the composed `GET /api/v1/dashboard` API and its reusable frontend models/cards intact. Simplify only `DashboardPanel` so it derives its display from `controller.workspaceItems.allItems` through the existing ToDo snapshot/widget pipeline. This is a presentation-only rollback with no engine, database, lifecycle, or API contract changes.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, Next.js 14.

**Constraints:** Reuse the existing `buildDashboardSnapshot` and `dashboardWidgets`; do not add a feature flag, replacement abstraction, or new dependency. Preserve the standalone unified-dashboard components for later reuse. Keep ToDo loading, failure, retry, navigation, range selection, and status-card behavior unchanged.

---

## Task 1: Lock the ToDo-only Dashboard contract and remove unified summaries

**Files:**

- Modify: `frontend/tests/presentation/dashboard-panel.spec.tsx`
- Modify: `frontend/src/features/dashboard/ui/DashboardPanel.tsx`

### Step 1: Replace the panel-level unified-card test with a failing regression test

Remove the `RavenDashboard` import and the `ravenDashboardResponse`/`ravenResponse` fixtures. Remove the `/api/v1/dashboard` branch from `installLoadedDashboard`, return its fetch mock from `renderLoadedDashboard`, and replace `keeps successful domain cards visible when Health projection fails` with this contract test:

```tsx
it("renders only ToDo analytics without requesting unified summaries", async () => {
  const fetchMock = await renderLoadedDashboard(populatedItems());

  for (const name of [
    "Today's work",
    "Completion history",
    "Area status",
    "Project status",
  ]) {
    expect(screen.getByRole("region", { name })).toBeVisible();
  }
  for (const name of [
    "Today's Plan",
    "Cash Flow",
    "Health Journal summary",
    "Recent activity",
  ]) {
    expect(screen.queryByRole("region", { name })).toBeNull();
  }
  expect(
    fetchMock.mock.calls.some(([url]) => url === "/api/v1/dashboard"),
  ).toBe(false);
});
```

Keep the direct `RecentActivityCard` key-stability test because the dormant reusable component still exists. In the ToDo retry test, remove only the obsolete `/api/v1/dashboard` mock branch.

### Step 2: Run the focused test and confirm the old panel fails the new contract

Run:

```bash
npm --prefix frontend test -- dashboard-panel.spec.tsx -t "renders only ToDo analytics without requesting unified summaries"
```

Expected: FAIL because the current `DashboardPanel` still requests `/api/v1/dashboard` and renders the unified summary cards.

### Step 3: Remove the unified Dashboard path from `DashboardPanel`

Make the minimum deletion-only behavioral change:

- Remove `fetchDashboard`, `RavenDashboard`, `toUnifiedDashboardModel`, `UnifiedDashboardModel`, and `unifiedTodoStats` imports.
- Remove `HealthSummaryCard`, `LedgerSummaryCard`, and `RecentActivityCard` imports.
- Reduce `DashboardPanelProps` to `controller` only.
- Remove `UnifiedDashboardState`, `requestGeneration`, `unifiedDashboard`, `reloadUnifiedDashboard`, and the unified-fetch effect.
- Remove both `<UnifiedDashboardCards ... />` call sites.
- Delete the private `UnifiedDashboardCards` function.

The remaining data flow must stay:

```tsx
const snapshot = workspaceItems.status === "loaded"
  ? buildDashboardSnapshot(workspaceItems.allItems, today, appliedRange)
  : null;
const models = snapshot === null
  ? []
  : dashboardWidgets.map((widget) => widget.build(snapshot));
```

Do not modify `dashboard-api.ts`, `dashboard-model.ts`, `dashboard-widgets.ts`, or the three reusable unified card components.

### Step 4: Run the complete Dashboard presentation suite

Run:

```bash
npm --prefix frontend test -- dashboard-panel.spec.tsx
```

Expected: PASS, including the four-card loading skeleton, ToDo error/retry, date-range controls, navigation, and status-card tests.

### Step 5: Run frontend static checks

Run:

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: both commands exit successfully with no unused imports or invalid props.

### Step 6: Commit the UI behavior change

Before staging, inspect `git status --short`, `git diff --stat`, `git diff`, and `git diff --cached`. Stage only the two Task 1 files, inspect the staged diff, then commit:

```bash
git add frontend/src/features/dashboard/ui/DashboardPanel.tsx frontend/tests/presentation/dashboard-panel.spec.tsx
git commit -m "[UPDATE] Restore the ToDo-only dashboard" -m $'- 대시보드에서 Ledger·Health Journal·최근 활동 요약을 숨김\n- 통합 대시보드 요청을 제거하고 기존 ToDo 분석만 유지\n- ToDo 전용 표시와 요청 부재를 회귀 테스트로 고정'
```

---

## Task 2: Synchronize current-state UI documentation

**Files:**

- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`

### Step 1: Update only stale Dashboard UI statements

In `README.md`, replace the combined-screen claim with a current-state description such as:

```markdown
- **Dashboard** — a read-only ToDo analytics screen for today's work, completion history,
  Area status, and Project status.
```

Change the following sentence so it no longer says Ledger and Health tabs sit under a combined Dashboard:

```markdown
Ledger and Health Journal do not repeat an Overview page. Their operational tabs remain
available in the main navigation:
```

In both `AGENTS.md` and `CLAUDE.md`, replace the stale project-overview bullet with the same fact:

```markdown
- The UI Dashboard currently shows ToDo analytics only. Ledger and Health Journal do not
  have duplicate Overview pages.
```

Do not change headings or document this as history/future work. Do not edit the API reference because `GET /api/v1/dashboard` remains supported and unchanged. Keep `AGENTS.md` and `CLAUDE.md` byte-identical.

### Step 2: Verify documentation coherence

Run:

```bash
cmp AGENTS.md CLAUDE.md
rg -n "combined Dashboard|one read-only screen combining|operational tabs sit under" README.md AGENTS.md CLAUDE.md
git diff --check
```

Expected: `cmp` succeeds, the stale-phrase search returns no matches, and `git diff --check` reports nothing. Also verify the README's existing top-level heading order did not change.

### Step 3: Commit the documentation update

Inspect the unstaged and staged diffs, stage only these three files, then commit:

```bash
git add README.md AGENTS.md CLAUDE.md
git commit -m "[DOCS] Describe the ToDo-only dashboard" -m $'- 현재 대시보드가 ToDo 분석만 표시한다는 동작을 반영\n- Ledger와 Health Journal의 독립 작업 화면 설명은 유지\n- AGENTS.md와 CLAUDE.md의 프로젝트 개요를 동일하게 동기화'
```

---

## Task 3: Final verification and handoff

**Files:** None unless a verification failure exposes an in-scope defect.

### Step 1: Run the frontend regression gate serially

Run these commands one at a time to avoid resource-contention timeouts:

```bash
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: all frontend tests pass, TypeScript reports no errors, and the static export builds successfully.

### Step 2: Confirm scope and repository state

Run:

```bash
git status --short
git diff HEAD~2 --stat
git log --oneline -n 5
rg -n "fetchDashboard|UnifiedDashboardCards|initialDashboard" frontend/src/features/dashboard/ui/DashboardPanel.tsx frontend/tests/presentation/dashboard-panel.spec.tsx
```

Expected: the worktree is clean; the two implementation commits are visible; the final search has no panel-level unified Dashboard wiring. Report that the composed API and dormant unified components were intentionally retained.
