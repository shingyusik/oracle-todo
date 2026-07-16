# Routine Task Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Routine에 실행 템플릿 정보(`project_id`, `description`, `note`, `priority`, `tags`)를 저장·편집하고, 이후 materialize되는 task가 그 값을 생성 시점 스냅샷으로 받게 한다.

**Architecture:** 기존 공용 `items` 테이블과 `TodoItem` 필드를 그대로 재사용하므로 스키마 변경은 없다. `TodoService::create_generated_task`에서 템플릿 필드를 한 번 복사하고, API·CLI·UI는 기존 생성/수정 경로를 확장한다. 이미 생성된 task는 routine 변경 시 자동 동기화하지 않는다.

**Tech Stack:** Rust 2024, Axum, Clap, SQLite/rusqlite, Next.js/React/TypeScript, Vitest/Testing Library

## Global Constraints

- 모든 mutation은 `TodoService`를 통하고 audit event를 유지한다.
- `scheduled`는 routine 값이 아니라 occurrence date로 생성한다.
- `routine_id`, `occurrence_key`, `metadata.generated_by`는 시스템 관리 provenance로 유지한다.
- `due`는 상대 마감 규칙이 없으므로 이번 범위에서 상속하지 않는다.
- 새 테이블, 새 칼럼, 새 의존성, 기존 task 자동 동기화는 추가하지 않는다.

## Task/Routine UI Field Parity

| Task 표시 항목 | Routine 계획 | 판단 |
| --- | --- | --- |
| Title | 기존 공용 UI 유지 | 그대로 task에 복사 |
| Status | 기존 공용 UI 유지 | 타입별 lifecycle이 다르므로 값은 복사하지 않음 |
| Tags | 기존 공용 UI 유지 | task에 복사 |
| Area | 기존 Routine UI 유지 | task에 복사 |
| Project | 상세·목록 UI 추가 | task에 복사 |
| Routine | 추가하지 않음 | 생성 task가 원본 routine을 가리키는 역참조라 routine 자체에는 해당 없음 |
| Scheduled | 추가하지 않음 | recurrence가 계산한 `occurrence_key`를 생성 task의 `scheduled`로 설정 |
| Due | 이번 범위에서 제외 | 고정 날짜 복사는 반복 작업에 맞지 않음; 필요 시 `due_offset_days` 계약을 별도 설계 |
| Priority | 상세·목록 UI 추가 | task에 복사 |
| Description | 상세·목록 UI 추가 | task에 복사 |
| Note | 기존 Routine UI 유지 | task에 복사 |
| Created / Updated | 기존 UI 유지 | 각 item 자체의 감사 시각이므로 복사하지 않음 |

Routine 전용 `Recurrence Rule`, `Materialization Policy`, `Future Occurrences`, `Last Materialized`는 생성 규칙과 운영 상태이므로 task에 복사하거나 task UI에 추가하지 않는다.

---

### Task 1: Backend routine template inheritance

**Files:**
- Modify: `todo-engine/src/application/service/creation.rs`
- Modify: `todo-engine/src/application/service/materialization.rs`
- Modify: `todo-engine/src/interfaces/api/dto.rs`
- Modify: `todo-engine/src/interfaces/api/handlers.rs`
- Modify: `todo-engine/src/interfaces/cli/mod.rs`
- Modify: `todo-engine/src/interfaces/cli/create.rs`
- Test: `todo-engine/tests/integration/materialization.rs`
- Test: `todo-engine/tests/e2e/api.rs`
- Test: `todo-engine/tests/e2e/cli.rs`

**Interfaces:**
- Consumes: 기존 `TodoItem::{project_id,description,note,priority,tags}`, `TodoService::ensure_relation`, `TodoService::store_item_and_event`
- Produces: `ProposeRoutine`과 `RoutineProposeBody`의 `project_id: Option<String>`, `description: Option<String>`, `priority: Option<i64>` 입력; 생성 task의 템플릿 스냅샷

- [ ] **Step 1: materialization 상속 실패 테스트 작성**

`todo-engine/tests/integration/materialization.rs`에 routine을 생성한 뒤 materialize하여 아래를 검증한다.

```rust
assert_eq!(task.description.as_deref(), Some("500ml를 마신다"));
assert_eq!(task.note.as_deref(), Some("찬물 제외"));
assert_eq!(task.priority, Some(2));
assert_eq!(task.tags, vec!["health"]);
assert_eq!(task.project_id.as_deref(), Some(project.id.as_str()));
assert_eq!(task.scheduled.as_deref(), task.occurrence_key.as_deref());
assert_eq!(task.routine_id.as_deref(), Some(routine.id.as_str()));
```

- [ ] **Step 2: 실패 확인**

Run: `cargo test -p todo-engine --test integration materialization`

Expected: 생성 task의 `project_id`, `description`, `note`, `priority`, `tags`가 기본값이라 FAIL.

- [ ] **Step 3: routine 생성 입력 확장**

`ProposeRoutine`, API DTO/handler, CLI `routine propose`에 `project_id`, `description`, `priority`를 연결한다. CLI에는 `--project-id`와 기존 API에 맞춘 반복 가능한 `--tag`를 연결한다.

```rust
pub project_id: Option<String>,
pub description: Option<String>,
pub priority: Option<i64>,
```

`TodoService::propose_routine`에서는 project가 존재하고 terminal 상태가 아닌지 기존 관계 검증으로 확인한 뒤 저장한다.

```rust
item.project_id = self.ensure_relation(request.project_id, ItemType::Project, "Project")?;
item.description = request.description;
item.priority = request.priority;
```

- [ ] **Step 4: materialization 한 곳에서만 템플릿 복사**

`TodoService::create_generated_task`의 기존 `title`, `area_id` 복사 옆에 아래만 추가한다.

```rust
task.description = routine.description.clone();
task.note = routine.note.clone();
task.priority = routine.priority;
task.tags = routine.tags.clone();
task.project_id = routine.project_id.clone();
```

- [ ] **Step 5: API·CLI 생성 경계 테스트 추가**

API와 CLI로 routine을 만든 뒤 `project_id`, `description`, `note`, `priority`, `tags`가 응답에 보존되는지 각각 한 사례로 검증한다. 존재하지 않거나 terminal인 project는 기존 project 관계 정책대로 거부되는 사례도 하나 검증한다. 이후 materialize 응답의 task에도 같은 값이 있는지 API e2e에서 검증한다.

- [ ] **Step 6: backend 검증**

Run: `cargo test -p todo-engine --test integration materialization && cargo test -p todo-engine --test e2e`

Expected: PASS.

- [ ] **Step 7: commit**

```bash
git add todo-engine/src todo-engine/tests
git commit -m $'[ADD] Add routine task template inheritance\n\n- Routine 실행 템플릿 필드를 생성 Task에 스냅샷으로 상속\n- API와 CLI의 Routine 생성 입력에 템플릿 필드 연결'
```

---

### Task 2: Routine UI template editing

**Files:**
- Modify: `frontend/src/features/workbench/ui/MainPanel.tsx`
- Test: `frontend/tests/presentation/workbench-wireframe.spec.tsx`

**Interfaces:**
- Consumes: 기존 `WorkspaceItemModel.project_id`, `WorkspaceItemModel.description`, `WorkspaceItemModel.priority`, `WorkspaceItemPatch`, `patchWorkspaceItem`, `DetailRelationField`, `projectColumn`
- Produces: routine 상세 및 테이블에서 편집 가능한 `Project`, `Description`, `Priority`; 기존 `Tags`, `Note`와 함께 완전한 최소 템플릿 UI

- [ ] **Step 1: routine 상세 UI 실패 테스트 작성**

Routine fixture에 템플릿 값을 넣고 상세 화면에서 기존 `Tags`, `Note`와 함께 다음 컨트롤이 보이는지 검증한다.

```ts
expect(screen.getByLabelText("Project for 물 마시기")).toHaveValue("project-1");
expect(screen.getByLabelText("Priority")).toHaveValue("2");
expect(screen.getByLabelText("Description")).toHaveValue("500ml를 마신다");
```

값 수정 후 기존 PATCH 경로가 아래 body를 보내는지도 검증한다.

```ts
expect(JSON.parse(String(init.body))).toEqual({
  project_id: "project-2",
  description: "물을 천천히 마신다",
  priority: 3,
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm --prefix frontend test -- --run frontend/tests/presentation/workbench-wireframe.spec.tsx`

Expected: routine 상세에 Project, Priority, Description 컨트롤이 없어 FAIL.

- [ ] **Step 3: 기존 task UI 컴포넌트 재사용**

`DetailTypeFields`의 routine 분기에 기존 컴포넌트를 그대로 추가한다.

```tsx
<DetailRelationField
  label="Project"
  controlLabel={`Project for ${item.title}`}
  value={draft.project_id}
  options={workspaceItems.relatedItems.projects}
  allowNone
  onChange={(project_id) => setField("project_id", project_id)}
/>
<DetailPriorityField
  label="Priority"
  value={draft.priority}
  onChange={(value) => setField("priority", value)}
/>
<DetailTextAreaField
  label="Description"
  value={draft.description}
  onChange={(value) => setField("description", value)}
/>
```

`detailPatchForItem`의 routine 분기에서 기존 helper를 호출한다.

```ts
addStringPatch(patch, "description", draft.description, itemDescription(item));
addPriorityPatch(patch, draft.priority, item.priority);
```

- [ ] **Step 4: routine 목록 칼럼 추가**

`itemColumns.routines`에 기존 `projectColumn()`, `priorityColumn()`과 Description 표시 칼럼을 추가한다. `Tags`와 `Note`는 이미 있으므로 중복 구현하지 않는다.

- [ ] **Step 5: frontend 검증**

Run: `npm --prefix frontend test -- --run frontend/tests/presentation/workbench-wireframe.spec.tsx && npm --prefix frontend run typecheck`

Expected: PASS.

- [ ] **Step 6: commit**

```bash
git add frontend/src/features/workbench/ui/MainPanel.tsx frontend/tests/presentation/workbench-wireframe.spec.tsx
git commit -m $'[UPDATE] Show routine task template fields\n\n- Routine 상세와 목록에 Project, Priority, Description 표시\n- 기존 Task 편집 컴포넌트와 PATCH 경로 재사용'
```

---

### Task 3: Contract docs and full verification

**Files:**
- Modify: `README.md`
- Modify: `docs/operations/api-reference.md`
- Modify: `docs/operations/cli-reference.md`

**Interfaces:**
- Consumes: Task 1의 API/CLI 필드와 materialization 동작
- Produces: routine 템플릿 및 스냅샷 상속에 대한 최종 사용자 계약

- [ ] **Step 1: 데이터 모델 문서 갱신**

README의 Routine 표에 `project_id`, `description`, `priority`, `tags`를 추가하고, generated task가 `title`, `area_id`, `project_id`, `description`, `note`, `priority`, `tags`를 생성 시점에 복사한다고 명시한다. `scheduled`는 occurrence date이며 기존 task는 이후 routine 수정에 동기화되지 않는다고 적는다.

- [ ] **Step 2: API·CLI 문서 갱신**

`RoutineProposeBody`에 `project_id?`, `description?`, `priority?`를 추가하고 CLI `routine propose` 옵션에 `--project-id`, `--description`, `--priority`, `--tag`를 기록한다.

- [ ] **Step 3: 전체 품질 게이트 실행**

```bash
cargo fmt --check
cargo test
cargo clippy --all-targets --all-features -- -D warnings
npm --prefix frontend test -- --run
npm --prefix frontend run typecheck
```

Expected: 모든 명령 PASS.

- [ ] **Step 4: commit**

```bash
git add README.md docs/operations
git commit -m $'[DOCS] Document routine task templates\n\n- Routine 입력 필드와 Task 스냅샷 상속 계약 명시\n- API와 CLI 생성 옵션을 현재 동작에 맞게 갱신'
```

---

## Self-Review

- 스키마 추가 없이 기존 공용 필드만 사용한다.
- routine의 project 연결, 생성, 수정, materialization, API/CLI/UI, 문서와 검증을 모두 포함한다.
- `due`, recurrence 설정 복제, provenance 중복 표시, 기존 task 자동 동기화는 의도적으로 제외한다.
- 모든 새 동작은 service 경로를 지나고 기존 audit event 저장을 유지한다.
