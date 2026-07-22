# Planner Table Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every meaningful Planner table its own persisted filter, sort, group, and contextual create controls, without changing the current-period navigation behavior.

**Architecture:** Define stable Planner table IDs and a complete per-table control state in the model layer. Normalize old tab-wide `planner.v1` preferences into this map in the controller hook, then pass table-specific settings into reusable header controls and table render pipelines. Creation receives an explicit table context so allowed types, anchors, and filter prefills are derived at the source table rather than from the active tab.

**Tech Stack:** React 18, Next.js 14, TypeScript, Vitest, Testing Library, existing SQLite-backed `/todo-engine/settings/planner` preference API, CSS in `frontend/src/styles/globals.css`.

## Global Constraints

- Keep `/todo-engine/settings/planner` and the `planner.v1` preference namespace; do not introduce a frontend-owned persistence path or direct SQLite access.
- Retain the top Planner toolbar only for period navigation and the current-period reset action. Filter, sort, group, and add belong to table headers.
- Use these exact persisted IDs: `daily.today`, `daily.overdue`, `daily.unscheduled`, `weekly.month-goals`, `weekly.week-goals`, `weekly.day-grid`, `monthly.period-goals`, `monthly.calendar`, `monthly.week-goals`, `yearly.period-goals`, and `yearly.month-goals`.
- Apply the table boundary before filter/sort/group work. A setting can affect only the raw item slice belonging to its own table.
- Weekly weekday cards share `weekly.day-grid`; monthly calendar cards share `monthly.calendar`; monthly weekly rails share `monthly.week-goals`; yearly monthly cards share `yearly.month-goals`.
- Planner displays only Tasks and Events in date-based work tables. Never render Routine there or offer Routine in Planner creation options. Daily Unscheduled offers Task only.
- Preserve the existing API validation error presentation in the creation dialog. Preference reads/writes stay best-effort and serialized.
- Follow red-green-refactor: add the focused failing test first, run it, implement the smallest change, then rerun the focused suite.

## File Structure

- Modify `frontend/src/features/workbench/model/planner-model.ts`
  - Stable table IDs, table setting defaults, valid-table normalization helpers, raw Daily section partitioning, and table-local rendering helpers.
- Modify `frontend/src/features/workbench/model/workbench-model.ts`
  - `PlannerTableSettings`, table settings map in Planner controls, creation context, and contextual creation form fields.
- Modify `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
  - Legacy preference migration, table-level updates/persistence, table-aware controller methods, and contextual creation request construction.
- Modify `frontend/src/features/workbench/ui/MainPanel.tsx`
  - Period-only top toolbar, reusable table header controls, table-local render pipelines, and contextual creation dialog behavior.
- Modify `frontend/src/styles/globals.css`
  - Compact per-section/table header layout and responsive control spacing.
- Modify `frontend/tests/domain/planner-model.spec.ts`
  - Stable IDs/defaults, Daily partition boundaries, and table-local filter/sort/group behavior.
- Modify `frontend/tests/presentation/use-workbench-controller.spec.tsx`
  - Preference migration/normalization/persistence and contextual creation request behavior.
- Modify `frontend/tests/presentation/workbench-wireframe.spec.tsx`
  - Header controls, isolation, contextual creation defaults, warnings, and Routine regression coverage.

### Task 1: Define Table Settings and Raw Table Boundaries

**Files:**
- Modify: `frontend/src/features/workbench/model/planner-model.ts`
- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Test: `frontend/tests/domain/planner-model.spec.ts`

**Interfaces:**
- Produces `PlannerTableId`, `PlannerTableSettings`, `plannerTableIds`, `defaultPlannerTableSettings()`, and `normalizePlannerTableSettings()`.
- Produces a Daily raw-section helper that returns `today`, `overdue`, and `unscheduled` before presentation filtering.
- Consumes existing `PlannerFilterRule`, `PlannerSortRule`, `PlannerGroupSettings`, `WorkspaceItemModel`, and date utilities.

- [ ] **Step 1: Add failing model tests for stable defaults and Daily section isolation.**

  In `planner-model.spec.ts`, add tests that assert:

  ```ts
  expect(plannerTableIds).toEqual([
    "daily.today", "daily.overdue", "daily.unscheduled",
    "weekly.month-goals", "weekly.week-goals", "weekly.day-grid",
    "monthly.period-goals", "monthly.calendar", "monthly.week-goals",
    "yearly.period-goals", "yearly.month-goals",
  ]);

  const sections = buildDailyPlannerSections(items, "2026-07-22");
  expect(sections.today.map((item) => item.id)).toEqual(["today-task"]);
  expect(sections.overdue.map((item) => item.id)).toEqual(["before-task"]);
  expect(sections.unscheduled.map((item) => item.id)).toEqual(["no-date-task"]);
  ```

  Add a test which applies a title filter and descending title sort only to `sections.today`, then proves the raw `overdue` and `unscheduled` arrays have not changed. Include a Routine with a matching date and assert it belongs to none of the three arrays.

- [ ] **Step 2: Run the focused model test and verify it fails.**

  ```bash
  cd frontend && npm run test -- tests/domain/planner-model.spec.ts
  ```

  Expected: FAIL because the table-ID/default exports and raw Daily section helper do not exist.

- [ ] **Step 3: Implement stable IDs, defaults, normalization, and raw section partitioning.**

  In `planner-model.ts`, declare the ID tuple with `as const`, derive `PlannerTableId`, and keep its values as the sole persistence keys. Define:

  ```ts
  export type PlannerTableSettings = {
    filterMode: PlannerFilterMode;
    filterRules: PlannerFilterRule[];
    sortRules: PlannerSortRule[];
    groupSettings: PlannerGroupSettings;
  };

  export function defaultPlannerTableSettings(tableId: PlannerTableId): PlannerTableSettings;
  export function normalizePlannerTableSettings(
    tableId: PlannerTableId,
    candidate: unknown,
    legacy: LegacyPlannerControls,
  ): PlannerTableSettings;
  ```

  The default must clone arrays and group values so editing one table cannot mutate another. The legacy argument supplies the old filter mode/rules and the old view-specific sort/group values for first-load migration.

  Extract the date/type partition currently embedded in `buildDailyPlannerModel()` into `buildDailyPlannerSections(items, selectedDate)`. It must return raw Task/Event arrays only, with the current daily definitions: scheduled on selected date, scheduled before selected date, and no scheduled date. Leave the existing Daily model as a compatibility wrapper or update its callers only after the new helper has tests.

- [ ] **Step 4: Rerun the focused model suite.**

  ```bash
  cd frontend && npm run test -- tests/domain/planner-model.spec.ts
  ```

  Expected: PASS; the test demonstrates boundaries are created before applying a table's display controls and Routine is excluded.

- [ ] **Step 5: Commit the model boundary work.**

  ```bash
  git add frontend/src/features/workbench/model/planner-model.ts frontend/src/features/workbench/model/workbench-model.ts frontend/tests/domain/planner-model.spec.ts
  git commit -m "[FEAT] Define planner table settings" -m "- 플래너 테이블 식별자와 독립 설정 기본값을 추가한다.\n- 일간 영역의 원본 항목 경계를 필터 처리보다 먼저 분리한다."
  ```

### Task 2: Migrate and Persist Table-Level Controller State

**Files:**
- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- Test: `frontend/tests/presentation/use-workbench-controller.spec.tsx`

**Interfaces:**
- `PlannerControls` owns `tableSettings: Record<PlannerTableId, PlannerTableSettings>`.
- Controller exposes `plannerTableSettings(tableId)` and `updatePlannerTableSettings(tableId, updater)` (or equivalent table-ID-aware read/update methods).
- Existing legacy fields remain readable only while parsing old stored documents; writes serialize `tableSettings` in `planner.v1`.

- [ ] **Step 1: Add failing controller tests.**

  Add focused tests which mock a stored legacy `planner.v1` payload containing global filter rules plus Daily/Weekly sort/group values and assert the mounted controller:

  1. assigns those Daily values independently to all three `daily.*` IDs;
  2. assigns Weekday-card values to only `weekly.day-grid` while `weekly.month-goals` and `weekly.week-goals` have their correct per-view legacy defaults;
  3. preserves valid settings for one table when another table's stored value is malformed;
  4. changes `daily.today` filters without changing `daily.overdue`; and
  5. writes a `planner.v1` body with `tableSettings` and retains the changed value across remount.

- [ ] **Step 2: Run the focused controller suite and verify it fails.**

  ```bash
  cd frontend && npm run test -- tests/presentation/use-workbench-controller.spec.tsx
  ```

  Expected: FAIL because the controller still owns one filter state and tab-keyed sort/group state.

- [ ] **Step 3: Replace active Planner display state with table settings and normalize preference input.**

  Update `PlannerControls` to store the complete `tableSettings` map. In `useWorkbenchController.ts`:

  - build a complete default map from `plannerTableIds`;
  - parse `planner.v1.tableSettings` table-by-table with `normalizePlannerTableSettings()`;
  - if the map is absent, seed each table from the legacy tab-wide controls, without deleting legacy fields during the read;
  - persist the current map through the existing serialized best-effort preference writer;
  - update exactly one map entry immutably in each filter/sort/group action.

  Do not have the old global setter silently update every table. Replace its call sites in the next task with the table-aware method, then delete unused global display setters. Keep only the period date setters/reset behavior in the top-level Planner control state.

- [ ] **Step 4: Rerun the focused controller suite.**

  ```bash
  cd frontend && npm run test -- tests/presentation/use-workbench-controller.spec.tsx
  ```

  Expected: PASS, including a remount proof that `tableSettings` is persisted and malformed entries are isolated.

- [ ] **Step 5: Commit controller persistence.**

  ```bash
  git add frontend/src/features/workbench/model/workbench-model.ts frontend/src/features/workbench/hooks/useWorkbenchController.ts frontend/tests/presentation/use-workbench-controller.spec.tsx
  git commit -m "[FEAT] Persist planner table settings" -m "- 기존 탭 공용 설정을 테이블별 설정으로 마이그레이션한다.\n- 테이블 하나의 변경이 다른 테이블 상태를 바꾸지 않도록 한다."
  ```

### Task 3: Render Table-Local Headers for Daily and Weekly

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- `PlannerTableHeader` receives `tableId`, title, table-local raw items, optional group universe items, and a `PlannerCreationContext`.
- It renders Filter, Sort, Group, and Add using the existing dropdown panels, but reads/writes only that table's settings.
- `applyPlannerTableSettings(rawItems, tableId, controller, relatedItems, date)` applies filter, then sort, then group.

- [ ] **Step 1: Add failing wireframe tests for Daily and Weekly headers.**

  Render Daily and assert Today, Before, and Unscheduled each have their own labelled header controls. Set a filter through Today and assert only Today content changes while Before remains visible. Open Daily Unscheduled Add and assert Routine/Event are absent and Task is the only selectable type.

  Render Weekly and assert Month Goals, Week Goals, and the Weekday grid each have a control cluster. Change the Weekday grid sorting and assert all seven day cards follow it while either goal table ordering is unchanged.

- [ ] **Step 2: Run the wireframe suite and verify it fails.**

  ```bash
  cd frontend && npm run test -- tests/presentation/workbench-wireframe.spec.tsx
  ```

  Expected: FAIL because controls are currently global in `PlannerControlToolbar` and Daily/Weekly read shared settings.

- [ ] **Step 3: Extract reusable local controls and wire Daily/Weekly data flows.**

  Refactor `PlannerControlToolbar` into a period-only toolbar. Keep its date/week/month/year navigation and current-period reset; remove global filter/sort/group/add content.

  In the same UI module, extract a reusable `PlannerTableHeader`/`PlannerTableControls` around the existing `PlannerDropdownButton`, `PlannerFilterRulePanel`, `PlannerSortPanel`, and `PlannerGroupPanel`. It receives a `tableId` and invokes the table-aware controller update API. Derive filter-field availability and group universe from that table's raw items, not from all Planner items.

  For Daily, call `buildDailyPlannerSections()` first, then independently filter, sort, and group each section. For Weekly, derive the three raw slices from the weekly model and independently process `monthGoals`, `weekGoals`, and each weekday card; all weekday cards use `weekly.day-grid`. Do not pass a previously globally filtered item list into either model.

- [ ] **Step 4: Rerun the wireframe suite.**

  ```bash
  cd frontend && npm run test -- tests/presentation/workbench-wireframe.spec.tsx
  ```

  Expected: PASS; Daily sections are isolated and the one weekday-grid setting is shared only across seven weekday cards.

- [ ] **Step 5: Commit Daily/Weekly table controls.**

  ```bash
  git add frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
  git commit -m "[FEAT] Localize daily and weekly planner controls" -m "- 일간 및 주간 테이블 헤더에 독립 제어 도구를 배치한다.\n- 요일 카드에는 하나의 공유 설정을 적용한다."
  ```

### Task 4: Wire Monthly and Yearly Table Scopes and Header Styling

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Modify: `frontend/src/styles/globals.css`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Monthly maps period goal cards to `monthly.period-goals`, all calendar day cards to `monthly.calendar`, and all weekly rails to `monthly.week-goals`.
- Yearly maps period goal cards to `yearly.period-goals` and all month cards to `yearly.month-goals`.
- Header controls remain accessible labels and do not alter the current carousel/navigation layout.

- [ ] **Step 1: Add failing Monthly/Yearly isolation tests.**

  Add wireframe tests that:

  - change Monthly calendar grouping and prove all calendar cells use it while weekly rails and period goals retain their presentation;
  - change a Monthly weekly-rail filter and prove it affects every rail but no calendar cell;
  - change Yearly monthly-card sorting and prove all twelve month cards use it while Yearly period goals do not; and
  - verify Monthly and Yearly header Add buttons are present alongside their scoped tables.

- [ ] **Step 2: Run the focused wireframe tests and verify they fail.**

  ```bash
  cd frontend && npm run test -- tests/presentation/workbench-wireframe.spec.tsx
  ```

  Expected: FAIL because Monthly/Yearly still consume the active tab's global filters/sorts/groups.

- [ ] **Step 3: Apply table-local rendering to Monthly and Yearly and add responsive header CSS.**

  Build Monthly and Yearly models from unfiltered Planner items. In Monthly, process raw period goals, raw calendar day work items, and raw weekly rails separately using their stable IDs. In Yearly, process raw period goals and raw monthly goal-card items separately. Reuse the header component from Task 3; do not create a target-picker or duplicate panel implementation.

  In `globals.css`, add styles scoped to the Planner section/card header that align the title and compact controls on wide screens, wrap safely on narrow screens, and avoid changing generic `.planner-section h2` or shared dropdown behavior outside Planner table headers.

- [ ] **Step 4: Rerun the wireframe suite and type check.**

  ```bash
  cd frontend && npm run test -- tests/presentation/workbench-wireframe.spec.tsx
  cd frontend && npm run typecheck
  ```

  Expected: PASS; each shared visual region uses precisely one intended settings key.

- [ ] **Step 5: Commit Monthly/Yearly controls and styles.**

  ```bash
  git add frontend/src/features/workbench/ui/MainPanel.tsx frontend/src/styles/globals.css frontend/tests/presentation/workbench-wireframe.spec.tsx
  git commit -m "[FEAT] Localize monthly and yearly planner controls" -m "- 월간과 연간의 공유 카드 영역을 독립 설정 범위로 연결한다.\n- 각 테이블 헤더의 제어 도구 배치를 반응형으로 정리한다."
  ```

### Task 5: Add Contextual Planner Creation and Complete Regression Coverage

**Files:**
- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Test: `frontend/tests/presentation/use-workbench-controller.spec.tsx`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- `PlannerCreationContext` contains source `tableId`, allowed item types, default scheduled/horizon anchor, editable-date flag, and table settings used for prefill analysis.
- `openPlannerCreationDialog(context)` replaces tab-global Planner creation. `closeCreationDialog()` clears the context.
- `CreateWorkspaceItemForm` carries optional `area_id`, `project_id`, `priority`, and `tags` so deterministic contextual prefills can reach the existing create API.

- [ ] **Step 1: Add failing creation tests.**

  Add controller tests that submit a contextual form and assert the outgoing request contains the expected type, `scheduled`, `horizon`, area/project/priority/tags when a compatible single-value AND filter exists, and never overwrites a user-entered value.

  Add wireframe tests for all creation boundaries:

  - Daily Today defaults to selected Daily date; Daily Before to the previous day; Daily Unscheduled has no scheduled input and only Task.
  - Weekly weekday grid defaults to that week's Monday and permits editing.
  - Monthly calendar defaults to the month's first day and permits editing.
  - Weekly month/week goals, Monthly period goals, Monthly weekly rails, Yearly period goals, and Yearly month cards offer only Goal and use their approved anchors; Monthly weekly rails and Yearly month cards permit editing their anchor.
  - a deterministic AND area/project/tag/priority filter prefills fields; an OR/text/range filter displays the visibility warning and does not force request values.
  - Routine is absent from every Planner creation menu and is absent from Planner date-based rendering even when fetched as related metadata.

- [ ] **Step 2: Run the focused test suites and verify they fail.**

  ```bash
  cd frontend && npm run test -- tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx
  ```

  Expected: FAIL because creation currently derives type/defaults from the active tab and still includes Routine in Planner type options.

- [ ] **Step 3: Implement contexts, defaults, prefill analysis, and dialog constraints.**

  Define the creation context at each `PlannerTableHeader` call site:

  | Source table | Context default |
  | --- | --- |
  | `daily.today` | selected Daily date |
  | `daily.overdue` | selected Daily date minus one day |
  | `daily.unscheduled` | no scheduled date; Task only |
  | `weekly.day-grid` | selected week Monday; editable |
  | `monthly.calendar` | selected month first day; editable |
  | `weekly.month-goals` | selected week's month anchor |
  | `weekly.week-goals` | selected week anchor |
  | `monthly.period-goals` | selected month anchor |
  | `monthly.week-goals` | selected month's first-week anchor; editable |
  | `yearly.period-goals` | selected year anchor |
  | `yearly.month-goals` | selected year January anchor; editable |

  In the controller, analyze only an AND set of single-value relation/select/multi-select rules for `area`, `project`, `tags`, and `priority`. Return suggestions rather than locking the form. Any OR rule, text rule, date/range rule, multiple values, or conflicting rule makes the context non-deterministic; show the dialog warning that the new item may not appear in the current table.

  Update the dialog's options and visibility rules from the context rather than `planner.activeView`. Goal contexts expose Goal only; date work contexts expose Task/Event; unscheduled exposes Task only. Remove Routine from all Planner option producers. Keep non-Planner workspace creation behavior unchanged.

- [ ] **Step 4: Run full frontend verification.**

  ```bash
  cd frontend && npm test
  cd frontend && npm run typecheck
  cd frontend && npm run build
  ```

  Expected: PASS. The full suite confirms no regression in Workspace creation, Planner navigation, or existing filter semantics.

- [ ] **Step 5: Commit contextual creation.**

  ```bash
  git add frontend/src/features/workbench/model/workbench-model.ts frontend/src/features/workbench/hooks/useWorkbenchController.ts frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation/use-workbench-controller.spec.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
  git commit -m "[FEAT] Contextualize planner creation" -m "- 테이블 위치에 맞는 생성 유형과 기본 날짜·기간을 적용한다.\n- 결정 가능한 필터만 생성 폼에 제안값으로 반영한다."
  ```

## Final Verification

- [ ] Run `git status --short` and confirm only intended changes are present.
- [ ] Run `cd frontend && npm test && npm run typecheck && npm run build`.
- [ ] Manually verify: filter/sort/group one table, switch period and Planner tabs, reload, and confirm its setting remains while sibling tables remain unchanged.
- [ ] Manually verify the eleven Add buttons use their table-specific type/options/defaults, and no Planner menu offers Routine.
- [ ] Update user-facing documentation only if the implementation changes a documented Planner control contract beyond the approved design; otherwise the approved spec and this plan are sufficient planning artifacts.
