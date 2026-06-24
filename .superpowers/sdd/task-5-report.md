# Task 5 Report

## What you implemented

- 워크스페이스 테이블 행 클릭 시 상세 보기로 전환되도록 연결했다.
- 상세 보기 상단에 `Back`, `Properties`, `Title`, 상태/타입/업데이트일 표시를 추가했다.
- 상세 보기 하단에 `Note` textarea와 명시적 `Save` 버튼을 추가했다.
- `Save`는 `PATCH /todo-engine/items/:id`를 호출하고, 응답으로 상세 상태와 리스트 상태를 함께 갱신한다.
- 기존 Task 4의 최소 `detailItem` 상태를 실제 상세 보기 플로우로 확장했다.

## Files changed

- `frontend/src/features/workbench/model/workbench-model.ts`
- `frontend/src/features/workbench/hooks/useWorkbenchController.ts`
- `frontend/src/features/workbench/ui/MainPanel.tsx`
- `frontend/src/styles/globals.css`
- `frontend/tests/presentation/use-workbench-controller.spec.tsx`
- `frontend/tests/presentation/workbench-wireframe.spec.tsx`

## TDD Evidence

### RED command/output

Command:

```bash
cd frontend
npm run test -- tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx
```

Output:

```text
FAIL tests/presentation/workbench-wireframe.spec.tsx > opens a detail view and saves note edits
Unable to find an accessible element with the role "heading" and name "One"

Test Files  2 failed (2)
Tests  2 failed | 30 passed (32)
```

### GREEN command/output

Command:

```bash
cd frontend
npm run test -- tests/presentation/use-workbench-controller.spec.tsx tests/presentation/workbench-wireframe.spec.tsx
npm run typecheck
```

Output:

```text
✓ tests/presentation/workbench-wireframe.spec.tsx (21 tests)
✓ tests/presentation/use-workbench-controller.spec.tsx (11 tests)

Test Files  2 passed (2)
Tests  32 passed (32)

> tsc --noEmit
```

## Self-review findings

- 요구사항 범위만 구현했다: 네이티브 input/textarea, 명시적 저장, 리스트/상세 상태 동기화.
- 자동 저장, 마크다운 편집기, 인라인 편집 준비 코드는 추가하지 않았다.
- 체크박스 클릭의 `stopPropagation()`은 유지해서 행 선택과 상세 열기가 충돌하지 않게 했다.

## Concerns if any

- 저장 중 로딩/에러 UI는 아직 없다. 이번 태스크 요구사항 밖이라 추가하지 않았다.

## Review Fix

### Fix implemented

- 워크스페이스 테이블 데이터 행을 키보드 포커스 가능 대상으로 만들고 Enter/Space로 상세를 열 수 있게 했다.
- 행에 `role="button"`과 `aria-label`을 붙여 화면 판독기에서도 동작 의도를 드러내게 했다.
- 상세 화면의 뒤로가기 문구를 `< Back`으로 맞췄다.

### Files changed

- `frontend/src/features/workbench/ui/MainPanel.tsx`
- `frontend/src/styles/globals.css`
- `frontend/tests/presentation/workbench-wireframe.spec.tsx`

### TDD Evidence

#### RED command/output

Command:

```bash
cd frontend
npm run test -- tests/presentation/workbench-wireframe.spec.tsx
```

Output:

```text
FAIL tests/presentation/workbench-wireframe.spec.tsx [ tests/presentation/workbench-wireframe.spec.tsx ]
  × WorkbenchPageClient > opens a detail view and saves note edits
    → Unable to find an accessible element with the role "button" and name "< Back"
  × WorkbenchPageClient > opens a detail view from the keyboard
    → Unable to find an accessible element with the role "button" and name "Open details for One"
```

#### GREEN command/output

Command:

```bash
cd frontend
npm run test -- tests/presentation/workbench-wireframe.spec.tsx
npm run typecheck
```

Output:

```text
✓ tests/presentation/workbench-wireframe.spec.tsx (22 tests)

Test Files  1 passed (1)
Tests  22 passed (22)

> tsc --noEmit
```

### Self-review

- 행 클릭은 유지하면서 키보드 진입 경로만 추가해 기존 마우스 플로우를 건드리지 않았다.
- 체크박스의 `stopPropagation()`은 그대로 둬서 선택과 상세 열기가 분리되게 했다.
- 추가적인 편집 UI나 상태 머신 변경은 넣지 않았다.
