---
name: raven-todo
description: "Raven에 저장된 할 일, 일정, 프로젝트, 영역, 목표, 반복 작업을 검색·생성·수정하거나 상태와 관계를 변경할 때 사용한다. 일반 프로젝트 계획 작성이나 Raven 소스 개발에는 사용하지 않는다."
---

# Raven ToDo 작업

먼저 [공통 실행·검색·재시도 규칙](../raven-cli/SKILL.md)을 읽는다.
Raven 사용자 데이터 작업에만 적용하며 [CLI 참고서의 ToDo 부분](../raven-cli/references/cli-reference.ko.md)을 필요한 만큼 읽는다.

## 검색과 선택

- `todo list --query <text> --format json`으로 간단히 찾고, 여러 조건·정렬·그룹은 `todo table query`로 검색한다.
- Workspace scope는 `workspace.area/project/goal/routine/task/event`다. Planner·linked 검색은 [API 참고서](../raven-cli/references/api-reference.md)의 정확한 scope와 context를 확인한다. 날짜·관계 범위를 추측하지 않는다.
- `todo options --type <type>`에서 타입별 수정 필드·고정 선택값을, `todo options --id <id>`에서 현재 항목의 상태 선택과 생명주기 actions를 확인한다.
- 관계 후보는 `todo table lookups --scope <scope> --id <id>`에서 선택한다. Goal 기간 변경 시 `--horizon week|month|year`도 전달한다. 종료·같거나 더 작은 기간·자기 자신·순환 부모를 임의로 추가하지 않는다.
- Task와 Area 등 타입별 상태 선택은 다르다. `--status`는 조회 필터이며 임의 상태 변경 옵션이 아니다. 원하는 전환을 options의 action 명령으로 실행한다.
- 과거 기록은 `todo list --include-archived --format json`으로 검색한다. `archive-list`는 archived만이 아니라 모든 종료 상태를 조회한다. `todo show <id>`는 종료된 항목도 조회한다.

## 생성·수정

- 생성은 바로 active다. Project에는 definition_of_done, Routine에는 반복 RRULE, Event에는 scheduled가 필요하다. 없는 필수 내용을 만들어 넣지 않고 확인한다.
- 수정 전에 `todo show <id>`로 현재 값·타입·updated_at을 읽고 해당 필드가 options에 허용되는지 확인한다. 지정하지 않은 필드는 보존한다.
- 우선순위는 1..10이다. 지울 때는 `update --clear-priority`를 쓰고 `--priority`와 섞지 않는다.
- 상태 전환은 complete/pause/resume/reopen/archive 등 지원되는 action을 사용한다. 완료 Task·Event의 재개는 reopen이다. 하드 삭제·purge를 흉내 내지 않는다.
- `today`는 조회다. Routine Task 생성은 요청된 경우에만 `routine materialize`로 실행한다.
- Postpone은 활성 Task·Event를 missed로 만들고 후속 항목을 생성한다. 단순 예정일 수정과 구분한다. 오늘로 미룰 수 있는 것은 원래 예정일이 오늘 이전인 경우뿐이다.

이름이 같은 후보가 여러 개면 ID와 최소한의 구분 정보를 제시해 대상을 확인한다.
변경 후에는 해당 항목·후속 항목을 다시 조회해 상태와 요청한 값을 확인한다.
