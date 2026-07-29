# Raven Unified Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing Next.js workbench with English Ledger and Health Journal workspaces, a failure-isolated unified Dashboard, and structured forms over `/api/v1`.

**Architecture:** Domain API clients, models, and UI live in separate feature folders. The existing ToDo controller remains intact while the shell controller owns top-level selection; shared table primitives are extracted only when Ledger/Health need proven existing behavior.

**Tech Stack:** Next.js 14, React 18, TypeScript 5.5, Vitest, Testing Library, lucide-react, existing CSS/design tokens

## Global Constraints

- Requires the composed Raven API plan.
- Labels are English: Dashboard, ToDo, Ledger, Health Journal.
- Ledger leaves: Transactions, Accounts, Categories, Reports.
- Health leaves: Timeline, Diet, Bowel, Medication, Health Metrics, Trends.
- There are no generic Ledger or Health Overview pages.
- Ledger parent opens Transactions; Health Journal parent opens Timeline.
- Only one top-level workspace expands at a time.
- Forms are structured; no free-form natural-language parsing.
- Domain errors must not clear valid form input, and one Dashboard card failure must not hide others.

---

### Task 1: Top-level Raven navigation model

**Files:**
- Modify: `frontend/src/domain/workbench/navigation.ts`
- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- Modify: `frontend/src/features/workbench/ui/TreeSidebar.tsx`
- Test: `frontend/tests/domain/workbench-navigation.spec.ts`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Produces: `MainTabId = "dashboard" | "todo" | "ledger" | "health"` and domain leaf selection.
- Consumes: current ToDo Workspace/Planner selection rules.

- [ ] **Step 1: Write failing navigation tests**

```ts
it("opens domain parents at their first useful leaf", () => {
  expect(resolveSelection("ledger").leafTabId).toBe("transactions");
  expect(resolveSelection("health").leafTabId).toBe("timeline");
});

it("keeps only one top-level workspace expanded", () => {
  const ledger = resolveSelection("ledger");
  const health = resolveSelection("health", ledger);
  expect(health.ledgerExpanded).toBe(false);
  expect(health.healthExpanded).toBe(true);
});
```

- [ ] **Step 2: Run navigation tests**

Run: `npm --prefix frontend test -- --run tests/domain/workbench-navigation.spec.ts`

Expected: FAIL because the IDs and expansion fields do not exist.

- [ ] **Step 3: Extend navigation without changing ToDo leaves**

```ts
export type MainTabId = "dashboard" | "todo" | "ledger" | "health";
export type LedgerTabId = "transactions" | "accounts" | "categories" | "reports";
export type HealthTabId =
  | "timeline" | "diet" | "bowel" | "medication" | "health-metrics" | "trends";
```

Add icons, English copy, accessibility labels, parent toggles, and default
leaves. Preserve current Workspace and Planner keyboard/selection behavior.

- [ ] **Step 4: Run navigation/presentation tests**

Run: `npm --prefix frontend test -- --run tests/domain/workbench-navigation.spec.ts tests/presentation/workbench-wireframe.spec.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/domain/workbench/navigation.ts frontend/src/features/workbench frontend/tests
git commit -m "[UPDATE] Add Raven domain navigation" -m "- Ledger와 Health Journal 트리 및 기본 leaf 추가
- 기존 ToDo Workspace·Planner 선택 동작 유지"
```

### Task 2: Typed Raven API clients and shared request errors

**Files:**
- Create: `frontend/src/lib/raven-api.ts`
- Create: `frontend/src/features/ledger/api/ledger-api.ts`
- Create: `frontend/src/features/ledger/model/ledger-model.ts`
- Create: `frontend/src/features/health/api/health-api.ts`
- Create: `frontend/src/features/health/model/health-model.ts`
- Create: `frontend/src/features/dashboard/api/dashboard-api.ts`
- Test: `frontend/tests/domain/raven-api.spec.ts`
- Test: `frontend/tests/domain/ledger-model.spec.ts`
- Test: `frontend/tests/domain/health-model.spec.ts`

**Interfaces:**
- Produces: `RavenApiError`, `requestJson<T>`, `ledgerApi`, `healthApi`, and `fetchDashboard`.
- Consumes: `/api/v1` DTOs.

- [ ] **Step 1: Write failing API client tests**

```ts
it("preserves the Raven error envelope", async () => {
  mockFetch(400, {
    code: "validation_error",
    message: "invalid amount",
    fields: { amount: "must be positive" },
    request_id: "00000000-0000-0000-0000-000000000001",
  });
  await expect(requestJson("/api/v1/ledger/entries", { method: "POST" }))
    .rejects.toMatchObject({ code: "validation_error", fields: { amount: "must be positive" } });
});
```

- [ ] **Step 2: Run client/model tests**

Run: `npm --prefix frontend test -- --run tests/domain/raven-api.spec.ts tests/domain/ledger-model.spec.ts tests/domain/health-model.spec.ts`

Expected: FAIL because clients/models are absent.

- [ ] **Step 3: Implement one transport and domain DTOs**

```ts
export class RavenApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly fields: Record<string, string>,
    readonly requestId: string,
  ) { super(message); }
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json();
  if (!response.ok) throw toRavenApiError(body);
  return body as T;
}
```

Use exact snake-case wire types at the API boundary and explicit mapping into
camel-case view models. Do not duplicate fetch/error logic in features.

- [ ] **Step 4: Run API/model tests and typecheck**

Run: `npm --prefix frontend test -- --run tests/domain/raven-api.spec.ts tests/domain/ledger-model.spec.ts tests/domain/health-model.spec.ts && npm --prefix frontend run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib frontend/src/features/ledger frontend/src/features/health frontend/src/features/dashboard/api frontend/tests/domain
git commit -m "[ADD] Add typed Raven frontend clients" -m "- 공통 오류 envelope와 /api/v1 요청 계층 추가
- Ledger·Health wire DTO와 화면 모델 경계 정의"
```

### Task 3: Ledger workspace

**Files:**
- Create: `frontend/src/features/ledger/hooks/useLedgerController.ts`
- Create: `frontend/src/features/ledger/ui/LedgerPanel.tsx`
- Create: `frontend/src/features/ledger/ui/TransactionsTable.tsx`
- Create: `frontend/src/features/ledger/ui/TransactionForm.tsx`
- Create: `frontend/src/features/ledger/ui/AccountsPanel.tsx`
- Create: `frontend/src/features/ledger/ui/CategoriesPanel.tsx`
- Create: `frontend/src/features/ledger/ui/LedgerReports.tsx`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Test: `frontend/tests/presentation/ledger-panel.spec.tsx`
- Test: `frontend/tests/presentation/ledger-form.spec.tsx`

**Interfaces:**
- Produces: Ledger CRUD controller and four approved leaf panels.
- Consumes: `ledgerApi` and current table/detail interaction patterns.

- [ ] **Step 1: Write failing presentation tests**

```tsx
it("submits only structured transaction fields", async () => {
  render(<TransactionForm controller={controller} />);
  await user.selectOptions(screen.getByLabelText("Type"), "expense");
  await user.type(screen.getByLabelText("Amount"), "12000");
  await user.type(screen.getByLabelText("Content"), "Lunch");
  await user.click(screen.getByRole("button", { name: "Save transaction" }));
  expect(controller.createEntry).toHaveBeenCalledWith(expect.objectContaining({
    type: "expense", amount: "12000", content: "Lunch",
  }));
});
```

Add tests for Transactions default leaf, archive/restore/purge confirmation,
transfer paired form, account/category reference loading, Reports range
controls, loading/empty/error states, and preserved form values on validation.

- [ ] **Step 2: Run Ledger presentation tests**

Run: `npm --prefix frontend test -- --run tests/presentation/ledger-panel.spec.tsx tests/presentation/ledger-form.spec.tsx`

Expected: FAIL because Ledger components are absent.

- [ ] **Step 3: Implement focused Ledger components**

```ts
export type LedgerController = {
  state: LedgerState;
  refresh(): Promise<void>;
  createEntry(input: LedgerEntryInput): Promise<void>;
  transfer(input: TransferInput): Promise<void>;
  archive(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  purge(id: string, confirmation: string): Promise<void>;
};
```

Reuse existing table filter/sort/detail components only through small adapters;
do not add Ledger branches throughout the current 6,000-line `MainPanel`.
`MainPanel` delegates to `LedgerPanel` based on the selected leaf.

- [ ] **Step 4: Run Ledger tests and typecheck**

Run: `npm --prefix frontend test -- --run tests/presentation/ledger-panel.spec.tsx tests/presentation/ledger-form.spec.tsx && npm --prefix frontend run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/ledger frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation
git commit -m "[ADD] Build Raven Ledger workspace" -m "- 거래·이체·계좌·분류 구조화 화면 추가
- Reports와 archive·restore·purge 흐름 구현"
```

### Task 4: Health Journal workspace

**Files:**
- Create: `frontend/src/features/health/hooks/useHealthController.ts`
- Create: `frontend/src/features/health/ui/HealthPanel.tsx`
- Create: `frontend/src/features/health/ui/TimelinePanel.tsx`
- Create: `frontend/src/features/health/ui/DietPanel.tsx`
- Create: `frontend/src/features/health/ui/BowelPanel.tsx`
- Create: `frontend/src/features/health/ui/MedicationPanel.tsx`
- Create: `frontend/src/features/health/ui/HealthMetricsPanel.tsx`
- Create: `frontend/src/features/health/ui/HealthTrendsPanel.tsx`
- Create: `frontend/src/features/health/ui/HealthForms.tsx`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Test: `frontend/tests/presentation/health-panel.spec.tsx`
- Test: `frontend/tests/presentation/health-forms.spec.tsx`

**Interfaces:**
- Produces: Health controller and six approved leaf panels.
- Consumes: `healthApi`, current chart primitives, and media upload endpoint.

- [ ] **Step 1: Write failing Health UI tests**

```tsx
it("renders category-specific bowel fields and validates Bristol range", async () => {
  render(<BowelPanel controller={controller} />);
  await user.selectOptions(screen.getByLabelText("Bristol scale"), "4");
  await user.click(screen.getByLabelText("Blood visible"));
  await user.click(screen.getByRole("button", { name: "Save bowel entry" }));
  expect(controller.createBowel).toHaveBeenCalledWith(
    expect.objectContaining({ bristol: 4, bloodVisible: true }),
  );
});
```

Cover Timeline default, meal types/tags/image upload, medication units,
daily-metric batch, trends charts/correlation disclaimer, lifecycle, and
partial loading/error states.

- [ ] **Step 2: Run Health presentation tests**

Run: `npm --prefix frontend test -- --run tests/presentation/health-panel.spec.tsx tests/presentation/health-forms.spec.tsx`

Expected: FAIL because Health components are absent.

- [ ] **Step 3: Implement Health panels and controller**

Keep separate forms per category so invalid fields cannot leak between diet,
bowel, medication, and metrics. Timeline merges API-provided items; Trends
renders bowel/symptom/medication/weight/sleep/lab series and always labels
diet reactions as descriptive, not causal.

```ts
export type HealthController = {
  state: HealthState;
  createDiet(input: DietInput): Promise<void>;
  createBowel(input: BowelInput): Promise<void>;
  createMedication(input: MedicationInput): Promise<void>;
  upsertMetrics(input: DailyMetricInput[]): Promise<void>;
  archive(kind: HealthRecordKind, id: string): Promise<void>;
  restore(kind: HealthRecordKind, id: string): Promise<void>;
  purge(kind: HealthRecordKind, id: string, confirmation: string): Promise<void>;
};
```

- [ ] **Step 4: Run Health tests and typecheck**

Run: `npm --prefix frontend test -- --run tests/presentation/health-panel.spec.tsx tests/presentation/health-forms.spec.tsx && npm --prefix frontend run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/health frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation
git commit -m "[ADD] Build Raven Health Journal workspace" -m "- Timeline·Diet·Bowel·Medication·Metrics·Trends 화면 추가
- 이미지와 일일 지표를 포함한 구조화 기록 흐름 구현"
```

### Task 5: Unified Dashboard and Quick Add

**Files:**
- Modify: `frontend/src/features/dashboard/model/dashboard-model.ts`
- Modify: `frontend/src/features/dashboard/model/dashboard-widgets.ts`
- Modify: `frontend/src/features/dashboard/ui/DashboardPanel.tsx`
- Create: `frontend/src/features/dashboard/ui/LedgerSummaryCard.tsx`
- Create: `frontend/src/features/dashboard/ui/HealthSummaryCard.tsx`
- Create: `frontend/src/features/dashboard/ui/RecentActivityCard.tsx`
- Create: `frontend/src/features/workbench/ui/QuickAddDialog.tsx`
- Modify: `frontend/src/features/workbench/ui/WorkbenchWireframe.tsx`
- Test: `frontend/tests/domain/dashboard-model.spec.ts`
- Test: `frontend/tests/presentation/dashboard-panel.spec.tsx`
- Test: `frontend/tests/presentation/quick-add.spec.tsx`

**Interfaces:**
- Produces: domain-projection-aware Dashboard and structured Quick Add routing.
- Consumes: `fetchDashboard`, existing ToDo Dashboard cards, Ledger/Health forms.

- [ ] **Step 1: Write failing failure-isolation and Quick Add tests**

```tsx
it("keeps successful cards when Health projection fails", () => {
  render(<DashboardPanel model={dashboardWithHealthError} />);
  expect(screen.getByText("Today's Plan")).toBeVisible();
  expect(screen.getByText("Cash Flow")).toBeVisible();
  expect(screen.getByText("Health data unavailable")).toBeVisible();
});

it("routes Quick Add to a structured domain form", async () => {
  render(<QuickAddDialog controller={controller} />);
  await user.click(screen.getByRole("button", { name: "Ledger transaction" }));
  expect(screen.getByRole("dialog", { name: "Add transaction" })).toBeVisible();
});
```

- [ ] **Step 2: Run Dashboard tests**

Run: `npm --prefix frontend test -- --run tests/domain/dashboard-model.spec.ts tests/presentation/dashboard-panel.spec.tsx tests/presentation/quick-add.spec.tsx`

Expected: FAIL because multi-domain projections are unsupported.

- [ ] **Step 3: Implement compact root summaries**

Map each `DomainProjection` independently. Keep detailed analysis in Reports
and Trends. Add recent cross-domain activity and a Quick Add selector that
opens existing domain forms without duplicating form state.

```ts
export function toDashboardModel(response: DashboardResponse): DashboardModel {
  return {
    todo: mapProjection(response.todo, mapTodoSummary),
    ledger: mapProjection(response.ledger, mapLedgerSummary),
    health: mapProjection(response.health, mapHealthSummary),
    recentActivity: response.recent_activity.map(mapRecentActivity),
  };
}
```

- [ ] **Step 4: Run the complete frontend gate**

Run: `npm --prefix frontend test && npm --prefix frontend run typecheck && npm --prefix frontend run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/dashboard frontend/src/features/workbench frontend/tests
git commit -m "[UPDATE] Unify Raven Dashboard" -m "- ToDo·Ledger·Health 요약과 최근 활동을 한 화면에 결합
- 부분 실패 카드와 구조화 Quick Add 흐름 추가"
```

### Task 6: Responsive and accessibility verification

**Files:**
- Modify: `frontend/src/styles/globals.css`
- Modify: `frontend/src/design/copy.ts`
- Modify: `frontend/src/design/layout.ts`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`
- Test: `frontend/tests/presentation/ledger-panel.spec.tsx`
- Test: `frontend/tests/presentation/health-panel.spec.tsx`

**Interfaces:**
- Produces: drawer sidebar, stacked Dashboard cards, keyboard/focus contracts.
- Consumes: completed Raven shell and panels.

- [ ] **Step 1: Add failing accessibility assertions**

```tsx
it("exposes English navigation and dialog labels", () => {
  renderRaven();
  expect(screen.getByRole("navigation", { name: "Raven navigation" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Health Journal" })).toHaveAttribute("aria-expanded");
});
```

Add tests for Escape dismissal, focus restoration, purge focus trap, and
mobile drawer toggle.

- [ ] **Step 2: Run presentation tests**

Run: `npm --prefix frontend test -- --run tests/presentation`

Expected: FAIL for missing labels/responsive state.

- [ ] **Step 3: Add responsive styles and focus behavior**

At the existing mobile breakpoint, turn the sidebar into a modal drawer,
stack Dashboard cards, keep forms scrollable, and preserve every mutation
action. Use existing design tokens; do not introduce a second visual system.

```css
@media (max-width: 760px) {
  .workbench-nav[data-open="false"] { display: none; }
  .dashboard-grid { grid-template-columns: minmax(0, 1fr); }
  .domain-form { max-height: calc(100dvh - 2rem); overflow-y: auto; }
}
```

- [ ] **Step 4: Run frontend verification**

Run: `npm --prefix frontend test && npm --prefix frontend run typecheck && npm --prefix frontend run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src frontend/tests
git commit -m "[UPDATE] Complete Raven responsive shell" -m "- 모바일 drawer와 Dashboard 카드 적층 적용
- 도메인 내비게이션·폼·확인창 접근성 검증 강화"
```
