# Planner UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build usable planner views with item tags, workspace tag editing, weekly goal/task planning, and a daily execution view with filters, grouping, and sorting.

**Architecture:** Keep SQLite as the source of truth and route all mutations through `TodoService`. Add one common `tags: Vec<String>` field to `TodoItem`, then reuse existing item list/create/patch API calls from the frontend. Planner grouping and filtering stays frontend-derived from loaded items and related item titles; no new Rust planner endpoints.

**Tech Stack:** Rust 2024, rusqlite, axum, serde, Next.js App Router, React, TypeScript strict mode, Vitest, React Testing Library, lucide-react.

## Global Constraints

- The planner reuses current todo-engine item APIs and creation flows; it does not add new Rust planner endpoints.
- SQLite stores item tags in an additive `items.tags` column as a JSON string array.
- The domain/API shape exposes tags as `string[]`.
- Workspace table views show tags as an editable column for areas, projects, goals, routines, tasks, and events.
- Daily filters include tags, area, project, routine, item type, and status.
- Daily filters use `AND` between filter categories and `OR` inside a multi-select category.
- Daily group-by options include none, area, project, routine, tag, item type, and status.
- Completed and archived items are hidden from Daily.
- No separate tag management tables or screens.
- No tag colors and rename flows.
- No drag-and-drop scheduling.
- No persisted selected week/month navigation.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `todo-engine/src/domain/model.rs` | Add `TodoItem.tags: Vec<String>` and default empty tags. |
| `todo-engine/src/infrastructure/sqlite/schema.rs` | Add `items.tags` to create/backfill schema. |
| `todo-engine/src/infrastructure/sqlite/mapping.rs` | Select and parse tags JSON. |
| `todo-engine/src/infrastructure/sqlite/repo.rs` | Save tags in insert/update. |
| `todo-engine/src/application/service/mod.rs` | Add shared `normalize_tags` helper. |
| `todo-engine/src/application/service/creation.rs` | Accept tags for create/propose requests. |
| `todo-engine/src/application/service/update.rs` | Patch tags through service policy and audit path. |
| `todo-engine/src/interfaces/api/dto.rs` | Add `tags: Option<Vec<String>>` to create/update DTOs. |
| `todo-engine/src/interfaces/api/handlers.rs` | Pass tags from API DTOs into service requests. |
| `todo-engine/tests/e2e/api.rs` | Prove create/patch responses round-trip tags. |
| `todo-engine/tests/integration/schema_indexes.rs` | Prove old schemas get additive `tags` column. |
| `frontend/src/features/workbench/model/workbench-model.ts` | Add tags to item, create, and patch models; add planner state types. |
| `frontend/src/features/workbench/model/planner-model.ts` | Pure date bucketing, filtering, grouping, and sorting helpers. |
| `frontend/tests/domain/planner-model.spec.ts` | Pure tests for Daily/Weekly planner helpers. |
| `frontend/src/features/workbench/hooks/useWorkbenchController.ts` | Load planner item sets, expose planner controls, send tags in create/patch calls. |
| `frontend/src/features/workbench/ui/MainPanel.tsx` | Render planner views, workspace tag editing, detail tag editing. |
| `frontend/src/styles/globals.css` | Minimal planner/card/filter styling. |
| `frontend/tests/presentation/use-workbench-controller.spec.tsx` | Controller tests for planner fetches and tags patch payloads. |
| `frontend/tests/presentation/workbench-wireframe.spec.tsx` | Rendering tests for workspace tags, Weekly, and Daily. |

---

### Task 1: Backend Tags Field

**Files:**
- Modify: `todo-engine/src/domain/model.rs`
- Modify: `todo-engine/src/infrastructure/sqlite/schema.rs`
- Modify: `todo-engine/src/infrastructure/sqlite/mapping.rs`
- Modify: `todo-engine/src/infrastructure/sqlite/repo.rs`
- Modify: `todo-engine/src/application/service/mod.rs`
- Modify: `todo-engine/src/application/service/creation.rs`
- Modify: `todo-engine/src/application/service/update.rs`
- Modify: `todo-engine/src/interfaces/api/dto.rs`
- Modify: `todo-engine/src/interfaces/api/handlers.rs`
- Test: `todo-engine/tests/e2e/api.rs`
- Test: `todo-engine/tests/integration/schema_indexes.rs`

**Interfaces:**
- Consumes: existing `TodoItem`, `TodoService`, `UpdateItem`, and API create/update DTO flow.
- Produces: `TodoItem.tags: Vec<String>`, create/propose request `tags: Vec<String>`, update request `tags: Option<Vec<String>>`, API JSON field `tags`.

- [ ] **Step 1: Write the failing API round-trip test**

Add this test to `todo-engine/tests/e2e/api.rs`:

```rust
#[tokio::test]
async fn api_create_and_patch_round_trips_tags() {
    let app = router(":memory:").unwrap();

    let response = json_request(
        app.clone(),
        "POST",
        "/tasks/propose",
        serde_json::json!({
            "title": "Draft planner",
            "actor": "user",
            "tags": ["deep-work", "planning", "deep-work", ""]
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let created = body_json(response).await;

    assert_eq!(created["tags"], serde_json::json!(["deep-work", "planning"]));

    let id = created["id"].as_str().expect("created item id");
    let response = json_request(
        app,
        "PATCH",
        format!("/items/{id}"),
        serde_json::json!({
            "tags": ["home", "admin"]
        }),
    )
    .await;
    assert_eq!(response.status(), 200);
    let patched = body_json(response).await;

    assert_eq!(patched["tags"], serde_json::json!(["home", "admin"]));
}
```

The helper functions `router`, `json_request`, and `body_json` already exist in `todo-engine/tests/e2e/api.rs`; keep this test in the same file so it can use them.

- [ ] **Step 2: Run the API test to verify it fails**

Run:

```bash
cargo test -p todo-engine --test e2e api_create_and_patch_round_trips_tags
```

Expected: FAIL because `tags` is not accepted or not returned.

- [ ] **Step 3: Write the failing schema backfill test**

Add this test to `todo-engine/tests/integration/schema_indexes.rs`:

```rust
#[test]
fn init_schema_adds_tags_column_to_legacy_items_table() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        r#"
        CREATE TABLE items (
            id TEXT NOT NULL PRIMARY KEY,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#,
    )
    .unwrap();

    todo_engine::infrastructure::sqlite::init_schema(&conn).unwrap();

    let columns = item_columns(&conn);
    assert!(columns.iter().any(|column| column == "tags"));
}

fn item_columns(conn: &rusqlite::Connection) -> Vec<String> {
    let mut statement = conn.prepare("PRAGMA table_info(items)").unwrap();
    statement
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
}
```

- [ ] **Step 4: Run the schema test to verify it fails**

Run:

```bash
cargo test -p todo-engine --test integration init_schema_adds_tags_column_to_legacy_items_table
```

Expected: FAIL because `items.tags` is missing.

- [ ] **Step 5: Add the domain field and tag normalization helper**

In `todo-engine/src/domain/model.rs`, add the field after `second_brain_refs`:

```rust
pub tags: Vec<String>,
```

In `TodoItem::new`, initialize it:

```rust
tags: Vec::new(),
```

In `todo-engine/src/application/service/mod.rs`, add:

```rust
pub(super) fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    for tag in tags {
        let tag = tag.trim().to_string();
        if !tag.is_empty() && !normalized.contains(&tag) {
            normalized.push(tag);
        }
    }
    normalized
}
```

- [ ] **Step 6: Add SQLite storage and mapping**

In `todo-engine/src/infrastructure/sqlite/schema.rs`, add `tags` to the table:

```rust
tags TEXT NOT NULL DEFAULT '[]',
```

Add it to `ITEM_COLUMN_ADDITIONS`:

```rust
("tags", "TEXT NOT NULL DEFAULT '[]'"),
```

In `todo-engine/src/infrastructure/sqlite/mapping.rs`, include `tags` in `item_select_sql` between `second_brain_refs` and `metadata`, then shift the following indexes by one. Parse tags with existing `parse_json`:

```rust
let tags: String = row_value(row, 28)?;
let metadata: String = row_value(row, 29)?;
let created_at: String = row_value(row, 30)?;
let updated_at: String = row_value(row, 31)?;
```

Set the item field:

```rust
tags: parse_tags(&tags)?,
```

Add a focused parser near `parse_json`:

```rust
pub(super) fn parse_tags(value: &str) -> TodoResult<Vec<String>> {
    parse_json(value)?
        .into_iter()
        .map(|value| {
            value
                .as_str()
                .map(ToOwned::to_owned)
                .ok_or_else(|| TodoError::Storage("tag values must be strings".to_string()))
        })
        .collect()
}
```

In `todo-engine/src/infrastructure/sqlite/repo.rs`, add `tags` to insert, update, placeholders, and params:

```rust
serde_json::to_string(&item.tags)
    .map_err(|error| TodoError::Storage(error.to_string()))?,
```

- [ ] **Step 7: Accept tags through service and API**

In each create request struct in `todo-engine/src/application/service/creation.rs`, add:

```rust
pub tags: Vec<String>,
```

For `ProposeTask::default`, set:

```rust
tags: Vec::new(),
```

In every create/propose method after building the item, assign:

```rust
item.tags = super::normalize_tags(request.tags);
```

In `UpdateItem` in `todo-engine/src/application/service/update.rs`, add:

```rust
pub tags: Option<Vec<String>>,
```

Destructure `tags`, then apply before updating `updated_at`:

```rust
if let Some(tags) = tags {
    item.tags = super::normalize_tags(tags);
}
```

In `todo-engine/src/interfaces/api/dto.rs`, add `pub tags: Option<Vec<String>>` to `AreaBody`, all propose bodies, and `UpdateBody`.

In `todo-engine/src/interfaces/api/handlers.rs`, pass:

```rust
tags: body.tags.unwrap_or_default(),
```

For `UpdateItem`, pass:

```rust
tags: body.tags,
```

- [ ] **Step 8: Run backend verification**

Run:

```bash
cargo fmt --check
cargo test -p todo-engine --test e2e api_create_and_patch_round_trips_tags
cargo test -p todo-engine --test integration init_schema_adds_tags_column_to_legacy_items_table
cargo test -p todo-engine
```

Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add todo-engine/src/domain/model.rs todo-engine/src/infrastructure/sqlite/schema.rs todo-engine/src/infrastructure/sqlite/mapping.rs todo-engine/src/infrastructure/sqlite/repo.rs todo-engine/src/application/service/mod.rs todo-engine/src/application/service/creation.rs todo-engine/src/application/service/update.rs todo-engine/src/interfaces/api/dto.rs todo-engine/src/interfaces/api/handlers.rs todo-engine/tests/e2e/api.rs todo-engine/tests/integration/schema_indexes.rs
git commit -m "$(cat <<'EOF'
[ADD] Add item tags to todo engine

- 공통 items.tags 저장 필드와 API 왕복 경로 추가
- 태그 정규화로 빈 값과 중복 값을 제거
- 기존 SQLite 스키마에 additive tags 컬럼 보강
EOF
)"
```

---

### Task 2: Workspace Tag Editing

**Files:**
- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Test: `frontend/tests/presentation/use-workbench-controller.spec.tsx`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes: backend `TodoItem.tags: string[]` and PATCH body `{ tags: string[] }`.
- Produces: `WorkspaceItemModel.tags?: string[]`, `WorkspaceItemPatch.tags?: string[]`, tag text editing in table and detail views.

- [ ] **Step 1: Write the failing controller patch test**

Add to `frontend/tests/presentation/use-workbench-controller.spec.tsx`:

```ts
it("patches item tags from workspace edits", async () => {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/todo-engine/items/task-1") {
      expect(init).toEqual(
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ tags: ["deep-work", "planning"] }),
        }),
      );
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: "task-1",
          type: "task",
          title: "Plan",
          status: "active",
          tags: ["deep-work", "planning"],
        }),
      });
    }

    return Promise.resolve({
      ok: true,
      json: async () => [
        { id: "task-1", type: "task", title: "Plan", status: "active", tags: [] },
      ],
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useWorkbenchController());

  await act(async () => {
    result.current.selectTab("workspace");
    result.current.selectTab("tasks");
  });

  await vi.waitFor(() => expect(result.current.workspaceItems.status).toBe("loaded"));

  await act(async () => {
    await result.current.patchWorkspaceItem("task-1", {
      tags: ["deep-work", "planning"],
    });
  });

  expect(result.current.workspaceItems.items[0].tags).toEqual([
    "deep-work",
    "planning",
  ]);
});
```

- [ ] **Step 2: Write the failing rendering test**

Add to `frontend/tests/presentation/workbench-wireframe.spec.tsx`:

```ts
it("edits tags from the workspace table and detail view", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/todo-engine/items/task-1") {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: "task-1",
          type: "task",
          title: "Plan",
          status: "active",
          tags: ["deep-work", "planning"],
        }),
      });
    }

    return Promise.resolve({
      ok: true,
      json: async () => [
        { id: "task-1", type: "task", title: "Plan", status: "active", tags: ["deep-work"] },
      ],
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<WorkbenchPageClient />);
  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Workspace" }));
  await user.click(screen.getByRole("button", { name: "Tasks" }));

  const tags = await screen.findByLabelText("Tags for Plan");
  await user.clear(tags);
  await user.type(tags, "deep-work, planning");
  fireEvent.blur(tags);

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/todo-engine/items/task-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ tags: ["deep-work", "planning"] }),
      }),
    ),
  );
});
```

- [ ] **Step 3: Run the frontend tests to verify they fail**

Run:

```bash
cd frontend
npm run test -- tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx
```

Expected: FAIL because tags are not in the model/UI.

- [ ] **Step 4: Add frontend model types and tag parser**

In `frontend/src/features/workbench/model/workbench-model.ts`, add:

```ts
tags?: string[];
```

to `WorkspaceItemModel`, and add:

```ts
tags?: string[];
```

to `CreateWorkspaceItemForm` and `WorkspaceItemPatch`.

In `frontend/src/features/workbench/ui/MainPanel.tsx`, add:

```ts
function parseTagInput(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .filter((tag, index, tags) => tags.indexOf(tag) === index);
}

function formatTags(tags: string[] | null | undefined): string {
  return (tags ?? []).join(", ");
}
```

- [ ] **Step 5: Add tags to detail draft and patch**

In `DetailDraft`, add:

```ts
tags: string;
```

In `detailDraftForItem`, add:

```ts
tags: formatTags(item?.tags),
```

In `detailPatchForItem`, add:

```ts
const draftTags = parseTagInput(draft.tags);
if (draft.tags !== formatTags(item.tags)) {
  patch.tags = draftTags;
}
```

In the shared detail properties before type-specific fields, add:

```tsx
<DetailTextField
  label="Tags"
  value={draft.tags}
  onChange={(value) => setField("tags", value)}
/>
```

- [ ] **Step 6: Add editable tags column to workspace table**

In the item column configuration in `MainPanel.tsx`, add a `Tags` column for all item types:

```tsx
{
  label: "Tags",
  value: (item, _workspaceItems, controller) => (
    <input
      aria-label={`Tags for ${item.title}`}
      className="table-inline-input"
      defaultValue={formatTags(item.tags)}
      onBlur={(event) => {
        const tags = parseTagInput(event.currentTarget.value);
        if (event.currentTarget.value !== formatTags(item.tags)) {
          void controller.patchWorkspaceItem(item.id, { tags });
        }
      }}
    />
  ),
}
```

- [ ] **Step 7: Run frontend verification**

Run:

```bash
cd frontend
npm run test -- tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/workbench/model/workbench-model.ts frontend/src/features/workbench/hooks/useWorkbenchController.ts frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation/use-workbench-controller.spec.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "$(cat <<'EOF'
[ADD] Add workspace tag editing

- Workspace 테이블과 상세 화면에서 공통 tags 필드 편집 지원
- 태그 입력을 쉼표 기반 배열로 정규화해 PATCH 요청 전송
- 프론트 모델과 컨트롤러 테스트에 tags 경로 추가
EOF
)"
```

---

### Task 3: Planner Pure Model

**Files:**
- Create: `frontend/src/features/workbench/model/planner-model.ts`
- Test: `frontend/tests/domain/planner-model.spec.ts`

**Interfaces:**
- Consumes: `WorkspaceItemModel` with `type`, `status`, `scheduled`, `due`, `priority`, `updated_at`, `area_id`, `project_id`, `routine_id`, `tags`.
- Produces: `buildDailyPlannerModel(items, relatedItems, options): DailyPlannerModel` and `buildWeeklyPlannerModel(items, weekStart): WeeklyPlannerModel`.

- [ ] **Step 1: Write failing pure model tests**

Create `frontend/tests/domain/planner-model.spec.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  buildDailyPlannerModel,
  buildWeeklyPlannerModel,
} from "@/features/workbench/model/planner-model";
import type { WorkspaceItemModel, WorkspaceItemsModel } from "@/features/workbench/model/workbench-model";

const relatedItems: WorkspaceItemsModel["relatedItems"] = {
  areas: { "area-1": "Work" },
  goals: {},
  projects: { "project-1": "Planner" },
  routines: { "routine-1": "Morning" },
};

const items: WorkspaceItemModel[] = [
  {
    id: "task-today",
    type: "task",
    title: "Today high",
    status: "active",
    scheduled: "2026-07-06",
    priority: 1,
    area_id: "area-1",
    project_id: "project-1",
    tags: ["deep-work"],
    updated_at: "2026-07-06T08:00:00Z",
  },
  {
    id: "task-overdue",
    type: "task",
    title: "Yesterday",
    status: "active",
    scheduled: "2026-07-05",
    priority: 5,
    tags: ["admin"],
    updated_at: "2026-07-05T08:00:00Z",
  },
  {
    id: "done",
    type: "task",
    title: "Done",
    status: "completed",
    scheduled: "2026-07-06",
    tags: ["deep-work"],
  },
  {
    id: "unscheduled",
    type: "task",
    title: "Loose",
    status: "active",
    tags: ["deep-work"],
  },
];

describe("planner model", () => {
  it("builds daily sections, hides completed items, and filters by tag and area", () => {
    const model = buildDailyPlannerModel(items, relatedItems, {
      date: "2026-07-06",
      filters: {
        tags: ["deep-work"],
        areaIds: ["area-1"],
        projectIds: [],
        routineIds: [],
        itemTypes: [],
        statuses: [],
      },
      groupBy: "area",
      sortBy: "priority",
    });

    expect(model.sections.today.groups[0]).toMatchObject({
      label: "Work",
      items: [expect.objectContaining({ id: "task-today" })],
    });
    expect(model.sections.overdue.groups).toEqual([]);
    expect(model.sections.unscheduled.groups).toEqual([]);
  });

  it("builds weekly goals and seven day columns", () => {
    const weekly = buildWeeklyPlannerModel(
      [
        {
          id: "month-goal",
          type: "goal",
          title: "July Goal",
          status: "active",
          horizon: "month",
          scheduled: "2026-07-01",
        },
        {
          id: "week-goal",
          type: "goal",
          title: "Week Goal",
          status: "active",
          horizon: "week",
          scheduled: "2026-07-06",
        },
        {
          id: "task",
          type: "task",
          title: "Monday Task",
          status: "active",
          scheduled: "2026-07-06",
        },
      ],
      "2026-07-06",
    );

    expect(weekly.monthGoals.map((item) => item.id)).toEqual(["month-goal"]);
    expect(weekly.weekGoals.map((item) => item.id)).toEqual(["week-goal"]);
    expect(weekly.days).toHaveLength(7);
    expect(weekly.days[0].items.map((item) => item.id)).toEqual(["task"]);
  });
});
```

- [ ] **Step 2: Run pure model tests to verify they fail**

Run:

```bash
cd frontend
npm run test -- tests/domain/planner-model.spec.ts
```

Expected: FAIL because `planner-model.ts` does not exist.

- [ ] **Step 3: Implement the minimal planner model**

Create `frontend/src/features/workbench/model/planner-model.ts`:

```ts
import type {
  WorkspaceItemModel,
  WorkspaceItemsModel,
} from "@/features/workbench/model/workbench-model";

export type DailyFilterState = {
  tags: string[];
  areaIds: string[];
  projectIds: string[];
  routineIds: string[];
  itemTypes: string[];
  statuses: string[];
};

export type DailyGroupBy =
  | "none"
  | "area"
  | "project"
  | "routine"
  | "tag"
  | "item_type"
  | "status";

export type DailySortBy = "priority" | "scheduled" | "updated" | "title";

export type DailyPlannerOptions = {
  date: string;
  filters: DailyFilterState;
  groupBy: DailyGroupBy;
  sortBy: DailySortBy;
};

export type PlannerGroup = {
  key: string;
  label: string;
  items: WorkspaceItemModel[];
};

export type DailyPlannerSection = {
  id: "today" | "overdue" | "upcoming" | "unscheduled";
  title: string;
  groups: PlannerGroup[];
};

export type DailyPlannerModel = {
  sections: Record<DailyPlannerSection["id"], DailyPlannerSection>;
};

export type WeeklyPlannerDay = {
  date: string;
  label: string;
  items: WorkspaceItemModel[];
};

export type WeeklyPlannerModel = {
  monthGoals: WorkspaceItemModel[];
  weekGoals: WorkspaceItemModel[];
  days: WeeklyPlannerDay[];
};

const terminalStatuses = new Set(["completed", "archived", "dropped", "cancelled"]);

export function buildDailyPlannerModel(
  items: WorkspaceItemModel[],
  relatedItems: WorkspaceItemsModel["relatedItems"],
  options: DailyPlannerOptions,
): DailyPlannerModel {
  const visible = items
    .filter((item) => !terminalStatuses.has(item.status))
    .filter((item) => matchesDailyFilters(item, options.filters))
    .sort((left, right) => compareDailyItems(left, right, options.sortBy));

  const today: WorkspaceItemModel[] = [];
  const overdue: WorkspaceItemModel[] = [];
  const upcoming: WorkspaceItemModel[] = [];
  const unscheduled: WorkspaceItemModel[] = [];

  for (const item of visible) {
    const date = datePart(item.scheduled);
    if (!date) {
      unscheduled.push(item);
    } else if (date < options.date) {
      overdue.push(item);
    } else if (date === options.date) {
      today.push(item);
    } else {
      upcoming.push(item);
    }
  }

  return {
    sections: {
      today: section("today", "Today", today, relatedItems, options.groupBy),
      overdue: section("overdue", "Overdue", overdue, relatedItems, options.groupBy),
      upcoming: section("upcoming", "Upcoming", upcoming, relatedItems, options.groupBy),
      unscheduled: section(
        "unscheduled",
        "Unscheduled",
        unscheduled,
        relatedItems,
        options.groupBy,
      ),
    },
  };
}

export function buildWeeklyPlannerModel(
  items: WorkspaceItemModel[],
  weekStart: string,
): WeeklyPlannerModel {
  const weekDates = Array.from({ length: 7 }, (_, offset) =>
    addDays(weekStart, offset),
  );
  const monthKey = weekStart.slice(0, 7);

  return {
    monthGoals: items.filter(
      (item) =>
        item.type === "goal" &&
        item.horizon === "month" &&
        datePart(item.scheduled)?.startsWith(monthKey),
    ),
    weekGoals: items.filter(
      (item) =>
        item.type === "goal" &&
        item.horizon === "week" &&
        weekDates.includes(datePart(item.scheduled) ?? ""),
    ),
    days: weekDates.map((date) => ({
      date,
      label: date,
      items: items.filter(
        (item) =>
          item.type !== "goal" &&
          !terminalStatuses.has(item.status) &&
          datePart(item.scheduled) === date,
      ),
    })),
  };
}

function matchesDailyFilters(
  item: WorkspaceItemModel,
  filters: DailyFilterState,
): boolean {
  return (
    matchesAny(item.tags ?? [], filters.tags) &&
    matchesOne(item.area_id, filters.areaIds) &&
    matchesOne(item.project_id, filters.projectIds) &&
    matchesOne(item.routine_id, filters.routineIds) &&
    matchesOne(item.type, filters.itemTypes) &&
    matchesOne(item.status, filters.statuses)
  );
}

function matchesAny(values: string[], selected: string[]): boolean {
  return selected.length === 0 || selected.some((value) => values.includes(value));
}

function matchesOne(value: string | null | undefined, selected: string[]): boolean {
  return selected.length === 0 || (value != null && selected.includes(value));
}

function compareDailyItems(
  left: WorkspaceItemModel,
  right: WorkspaceItemModel,
  sortBy: DailySortBy,
): number {
  if (sortBy === "title") {
    return left.title.localeCompare(right.title);
  }
  if (sortBy === "scheduled") {
    return compareText(left.scheduled, right.scheduled);
  }
  if (sortBy === "updated") {
    return compareText(right.updated_at, left.updated_at);
  }
  return compareNumber(left.priority, right.priority)
    || compareText(left.scheduled, right.scheduled)
    || compareText(right.updated_at, left.updated_at)
    || left.title.localeCompare(right.title);
}

function compareNumber(
  left: number | null | undefined,
  right: number | null | undefined,
): number {
  return (left ?? Number.MAX_SAFE_INTEGER) - (right ?? Number.MAX_SAFE_INTEGER);
}

function compareText(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  return (left ?? "").localeCompare(right ?? "");
}

function section(
  id: DailyPlannerSection["id"],
  title: string,
  items: WorkspaceItemModel[],
  relatedItems: WorkspaceItemsModel["relatedItems"],
  groupBy: DailyGroupBy,
): DailyPlannerSection {
  return { id, title, groups: groupItems(items, relatedItems, groupBy) };
}

function groupItems(
  items: WorkspaceItemModel[],
  relatedItems: WorkspaceItemsModel["relatedItems"],
  groupBy: DailyGroupBy,
): PlannerGroup[] {
  if (groupBy === "none") {
    return items.length === 0 ? [] : [{ key: "all", label: "All", items }];
  }

  const groups = new Map<string, PlannerGroup>();
  for (const item of items) {
    const keys = groupKeys(item, groupBy);
    for (const key of keys) {
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: groupLabel(key, groupBy, relatedItems),
          items: [],
        });
      }
      groups.get(key)?.items.push(item);
    }
  }
  return [...groups.values()];
}

function groupKeys(item: WorkspaceItemModel, groupBy: DailyGroupBy): string[] {
  if (groupBy === "tag") {
    return item.tags && item.tags.length > 0 ? item.tags : ["untagged"];
  }
  if (groupBy === "area") return [item.area_id ?? "none"];
  if (groupBy === "project") return [item.project_id ?? "none"];
  if (groupBy === "routine") return [item.routine_id ?? "none"];
  if (groupBy === "item_type") return [item.type];
  if (groupBy === "status") return [item.status];
  return ["all"];
}

function groupLabel(
  key: string,
  groupBy: DailyGroupBy,
  relatedItems: WorkspaceItemsModel["relatedItems"],
): string {
  if (key === "none") return "No value";
  if (key === "untagged") return "Untagged";
  if (groupBy === "area") return relatedItems.areas[key] ?? key;
  if (groupBy === "project") return relatedItems.projects[key] ?? key;
  if (groupBy === "routine") return relatedItems.routines[key] ?? key;
  return key;
}

function datePart(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run pure model tests**

Run:

```bash
cd frontend
npm run test -- tests/domain/planner-model.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/workbench/model/planner-model.ts frontend/tests/domain/planner-model.spec.ts
git commit -m "$(cat <<'EOF'
[ADD] Add planner view model helpers

- Daily 섹션/필터/group-by/sort 계산을 순수 함수로 분리
- Weekly 월간 goal, 주간 goal, 월-일 카드 모델 생성
- Planner UI 구현 전 도메인 계산 테스트 고정
EOF
)"
```

---

### Task 4: Planner Data Loading and Rendering

**Files:**
- Modify: `frontend/src/features/workbench/model/workbench-model.ts`
- Modify: `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Test: `frontend/tests/presentation/use-workbench-controller.spec.tsx`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes: `buildDailyPlannerModel`, `buildWeeklyPlannerModel`, existing fetch helpers, existing detail open/patch/create methods.
- Produces: `controller.planner`, planner tab rendering for Yearly, Monthly, Weekly, Daily, and planner fast-add buttons.

- [ ] **Step 1: Write failing controller fetch test**

Add to `frontend/tests/presentation/use-workbench-controller.spec.tsx`:

```ts
it("loads planner item sets for daily", async () => {
  const fetchMock = vi.fn((url: string) =>
    Promise.resolve({
      ok: true,
      json: async () => [],
    }),
  );
  vi.stubGlobal("fetch", fetchMock);

  const { result } = renderHook(() => useWorkbenchController());

  await act(async () => result.current.selectTab("daily"));

  await vi.waitFor(() => expect(result.current.workspaceItems.status).toBe("loaded"));

  expect(fetchMock).toHaveBeenCalledWith("/todo-engine/items?type=task");
  expect(fetchMock).toHaveBeenCalledWith("/todo-engine/items?type=event");
  expect(fetchMock).toHaveBeenCalledWith("/todo-engine/items?type=routine");
  expect(fetchMock).toHaveBeenCalledWith("/todo-engine/items?type=area");
  expect(fetchMock).toHaveBeenCalledWith("/todo-engine/items?type=project");
});
```

- [ ] **Step 2: Write failing weekly and daily rendering tests**

Add to `frontend/tests/presentation/workbench-wireframe.spec.tsx`:

```ts
it("renders weekly planner goals and day cards", async () => {
  const user = userEvent.setup();
  const responses: Record<string, unknown[]> = {
    "/todo-engine/items?type=goal": [
      { id: "g1", type: "goal", title: "July Goal", status: "active", horizon: "month", scheduled: "2026-07-01" },
      { id: "g2", type: "goal", title: "Week Goal", status: "active", horizon: "week", scheduled: "2026-07-06" },
    ],
    "/todo-engine/items?type=task": [
      { id: "t1", type: "task", title: "Monday Task", status: "active", scheduled: "2026-07-06" },
    ],
    "/todo-engine/items?type=event": [],
    "/todo-engine/items?type=routine": [],
    "/todo-engine/items?type=area": [],
    "/todo-engine/items?type=project": [],
  };
  vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve({
    ok: true,
    json: async () => responses[url] ?? [],
  })));

  render(<WorkbenchPageClient />);
  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Planner" }));
  await user.click(screen.getByRole("button", { name: "Weekly" }));

  expect(await screen.findByRole("heading", { name: "Goals for this month" })).toBeInTheDocument();
  expect(screen.getByText("July Goal")).toBeInTheDocument();
  expect(screen.getByText("Week Goal")).toBeInTheDocument();
  expect(screen.getByText("Monday Task")).toBeInTheDocument();
  expect(screen.getAllByTestId("weekly-day-card")).toHaveLength(7);
});

it("renders daily sections and hides completed items", async () => {
  const user = userEvent.setup();
  const responses: Record<string, unknown[]> = {
    "/todo-engine/items?type=task": [
      { id: "t1", type: "task", title: "Today Task", status: "active", scheduled: "2026-07-06", tags: ["deep-work"] },
      { id: "t2", type: "task", title: "Done Task", status: "completed", scheduled: "2026-07-06", tags: ["deep-work"] },
      { id: "t3", type: "task", title: "Overdue Task", status: "active", scheduled: "2026-07-05" },
    ],
    "/todo-engine/items?type=event": [],
    "/todo-engine/items?type=routine": [],
    "/todo-engine/items?type=area": [],
    "/todo-engine/items?type=project": [],
  };
  vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve({
    ok: true,
    json: async () => responses[url] ?? [],
  })));

  render(<WorkbenchPageClient />);
  await user.click(screen.getByRole("button", { name: "ToDo" }));
  await user.click(screen.getByRole("button", { name: "Planner" }));
  await user.click(screen.getByRole("button", { name: "Daily" }));

  expect(await screen.findByRole("heading", { name: "Today" })).toBeInTheDocument();
  expect(screen.getByText("Today Task")).toBeInTheDocument();
  expect(screen.getByText("Overdue Task")).toBeInTheDocument();
  expect(screen.queryByText("Done Task")).toBeNull();
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
cd frontend
npm run test -- tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx
```

Expected: FAIL because planner tabs still render the workspace table path.

- [ ] **Step 4: Extend controller model**

In `frontend/src/features/workbench/model/workbench-model.ts`, add:

```ts
import type {
  DailyFilterState,
  DailyGroupBy,
  DailySortBy,
} from "@/features/workbench/model/planner-model";
```

Add:

```ts
export type PlannerControls = {
  date: string;
  weekStart: string;
  dailyFilters: DailyFilterState;
  dailyGroupBy: DailyGroupBy;
  dailySortBy: DailySortBy;
};
```

Add to `WorkbenchController`:

```ts
planner: PlannerControls;
setDailyFilter: (field: keyof DailyFilterState, values: string[]) => void;
setDailyGroupBy: (groupBy: DailyGroupBy) => void;
setDailySortBy: (sortBy: DailySortBy) => void;
```

- [ ] **Step 5: Load planner data in controller**

In `useWorkbenchController.ts`, add planner tab item types:

```ts
const plannerItemTypes: Partial<Record<LeafTabId, WorkspaceItemType[]>> = {
  yearly: ["goal", "area", "project"],
  monthly: ["goal", "area", "project"],
  weekly: ["goal", "task", "event", "routine", "area", "project"],
  daily: ["task", "event", "routine", "area", "project"],
};
```

Update the loading effect so planner tabs use `plannerItemTypes[selection.leafTabId]` and workspace tabs continue using the existing single type plus related types.

Add default controls:

```ts
const [planner, setPlanner] = useState<PlannerControls>({
  date: "2026-07-06",
  weekStart: "2026-07-06",
  dailyFilters: {
    tags: [],
    areaIds: [],
    projectIds: [],
    routineIds: [],
    itemTypes: [],
    statuses: [],
  },
  dailyGroupBy: "none",
  dailySortBy: "priority",
});
```

Expose control setters:

```ts
setDailyFilter: (field, values) =>
  setPlanner((current) => ({
    ...current,
    dailyFilters: { ...current.dailyFilters, [field]: values },
  })),
setDailyGroupBy: (groupBy) =>
  setPlanner((current) => ({ ...current, dailyGroupBy: groupBy })),
setDailySortBy: (sortBy) =>
  setPlanner((current) => ({ ...current, dailySortBy: sortBy })),
```

- [ ] **Step 6: Render planner panels**

In `MainPanel`, route planner leaf tabs before the workspace table:

```tsx
if (["yearly", "monthly", "weekly", "daily"].includes(controller.selection.leafTabId)) {
  return (
    <main className="main-panel">
      <PlannerPanel controller={controller} />
    </main>
  );
}
```

Add `PlannerPanel`, `YearlyPlanner`, `MonthlyPlanner`, `WeeklyPlanner`, and `DailyPlanner` in `MainPanel.tsx`. Keep them local for this first pass. Use `buildWeeklyPlannerModel` and `buildDailyPlannerModel` for weekly/daily.

Use buttons for fast add:

```tsx
<button type="button" className="items-toolbar-button" onClick={controller.openCreationDialog}>
  <Plus size={16} aria-hidden="true" />
  <span className="sr-only">Add planner item</span>
</button>
```

Render Daily controls with native selects:

```tsx
<select
  aria-label="Group daily items by"
  value={controller.planner.dailyGroupBy}
  onChange={(event) =>
    controller.setDailyGroupBy(event.target.value as DailyGroupBy)
  }
>
  <option value="none">No grouping</option>
  <option value="area">Area</option>
  <option value="project">Project</option>
  <option value="routine">Routine</option>
  <option value="tag">Tag</option>
  <option value="item_type">Item type</option>
  <option value="status">Status</option>
</select>
```

- [ ] **Step 7: Run frontend verification**

Run:

```bash
cd frontend
npm run test -- tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/workbench/model/workbench-model.ts frontend/src/features/workbench/hooks/useWorkbenchController.ts frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation/use-workbench-controller.spec.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m "$(cat <<'EOF'
[ADD] Render planner workbench views

- Planner 탭에서 goal/task/event/routine 데이터를 로드
- Weekly goal strip과 월-일 카드 뷰 렌더링
- Daily 섹션형 실행 뷰와 필터/group-by/sort 컨트롤 추가
EOF
)"
```

---

### Task 5: Styling, Docs Sync, and Full Verification

**Files:**
- Modify: `frontend/src/styles/globals.css`
- Modify: `README.md`
- Modify: `docs/operations/api-reference.md`
- Test: existing Rust and frontend suites

**Interfaces:**
- Consumes: planner UI classes and backend tags API from previous tasks.
- Produces: readable planner layout, documented tags API, documented planner behavior.

- [ ] **Step 1: Add minimal CSS**

In `frontend/src/styles/globals.css`, add:

```css
.planner-panel {
  display: grid;
  gap: 16px;
}

.planner-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.planner-control-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.planner-section {
  display: grid;
  gap: 10px;
}

.planner-goal-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.weekly-day-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(140px, 1fr));
  gap: 10px;
  overflow-x: auto;
}

.planner-card {
  min-height: 96px;
  border: 1px solid var(--color-hairline-light);
  border-radius: var(--radius-md);
  background: var(--color-canvas-light);
  padding: 10px;
}

.planner-card-list {
  display: grid;
  gap: 8px;
}

.planner-item {
  border: 1px solid var(--color-hairline-light);
  border-radius: var(--radius-xs);
  background: var(--color-canvas-cream);
  padding: 8px;
  text-align: left;
}

.table-inline-input {
  width: 100%;
  min-width: 140px;
  border: 1px solid var(--color-hairline-light);
  border-radius: var(--radius-xs);
  padding: 6px 8px;
  background: var(--color-canvas-light);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}
```

- [ ] **Step 2: Update docs**

Update `README.md` data model table to include:

```markdown
| `tags` | JSON array of strings | Common item tags for workspace editing and planner filters. |
```

Update `docs/operations/api-reference.md` create/update body docs to include:

```markdown
| `tags` | optional `string[]` | Common item tags. Empty strings are ignored and duplicates are removed. |
```

- [ ] **Step 3: Run full verification**

Run:

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
cd frontend
npm run test
npm run typecheck
npm run build
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/styles/globals.css README.md docs/operations/api-reference.md
git commit -m "$(cat <<'EOF'
[DOCS] Document planner tags and polish UI

- Planner 카드/필터/태그 입력 스타일 보강
- README와 API 문서에 공통 tags 필드 추가
- CLI 태그 플래그가 없는 경우 CLI 문서는 변경하지 않음
EOF
)"
```

---

## Final Verification

- [ ] Run Rust verification:

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

- [ ] Run frontend verification:

```bash
cd frontend
npm run test
npm run typecheck
npm run build
```

- [ ] Check git history:

```bash
git status --short
git log --oneline -n 8
```

Expected: worktree clean and task commits visible in order.
