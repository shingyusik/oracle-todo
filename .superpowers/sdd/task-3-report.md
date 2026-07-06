# Task 3 Report: Planner Pure Model

## 범위

- 프론트엔드 순수 모델만 추가했다.
- 일일 planner 섹션/필터/그룹/정렬 헬퍼와 주간 목표/일자 헬퍼를 구현했다.
- React UI, 컨트롤러, CSS, 백엔드, 의존성은 건드리지 않았다.

## TDD 로그

1. `frontend/tests/domain/planner-model.spec.ts`를 먼저 추가했다.
2. `npm run test -- tests/domain/planner-model.spec.ts`를 실행해 `planner-model.ts` 미존재로 RED를 확인했다.
3. `frontend/src/features/workbench/model/planner-model.ts`를 브리프의 최소 구현 그대로 추가했다.
4. 같은 focused test를 다시 실행해 GREEN을 확인했다.

## 변경 사항

### `frontend/src/features/workbench/model/planner-model.ts`

- `DailyFilterState`, `DailyGroupBy`, `DailySortBy`, `DailyPlannerOptions` 타입을 추가했다.
- `buildDailyPlannerModel(items, relatedItems, options)`를 추가했다.
- completed / archived / dropped / cancelled 항목을 제외했다.
- tags, area, project, routine, item type, status 필터를 적용했다.
- today / overdue / upcoming / unscheduled 섹션으로 나눴다.
- `groupBy` 값에 따라 그룹을 만들고, area/project/routine 라벨은 `relatedItems`를 사용했다.
- `buildWeeklyPlannerModel(items, weekStart)`를 추가했다.
- month goal, week goal, 7일 컬럼을 계산했다.

### `frontend/tests/domain/planner-model.spec.ts`

- daily planner의 태그 + area 필터 조합을 검증했다.
- completed 항목이 daily 모델에서 숨겨지는지 검증했다.
- weekly planner가 month goals, week goals, 7일 컬럼을 만드는지 검증했다.

## 검증

`frontend/`에서 실행:

```bash
npm run test -- tests/domain/planner-model.spec.ts
```

결과:

- PASS
- 2 tests passed

## 커밋

- `dc8801c` `[ADD] Create planner model helpers`

## 자기 점검

- 구현은 브리프에 나온 순수 함수 범위 안에만 머물렀다.
- 추가 추상화는 넣지 않았다.
- 테스트는 요청된 focused spec 하나만 사용했다.

## 우려 사항

- 별도 우려 없음.
