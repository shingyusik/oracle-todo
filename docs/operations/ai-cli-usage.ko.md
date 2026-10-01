# AI CLI 사용 가이드

[English](ai-cli-usage.md)

`raven` 실행 파일 하나와 명시적인 데이터 홈을 사용합니다.
전역 옵션은 도메인 명령 앞에 놓습니다. Stdout·stderr·종료 코드를 따로 수집합니다.

## Codex 스킬

Raven 스킬 묶음은 저장소 루트 `skills/`의 스킬 네 개로 구성됩니다.
묶음을 설치한 뒤 Codex 메시지에 이름을 넣어 명시적으로 호출할 수 있습니다.

| 스킬 | 용도 |
| --- | --- |
| `$raven-cli` | CLI help·선택값·상세 검색·출력·재시도 공통 규칙 |
| `$raven-todo` | ToDo 항목·관계·반복·상태 변경 |
| `$raven-ledger` | 거래·기준 데이터·이체·잔액·보고서 |
| `$raven-health` | 식사·배변·약·정규 일일 metric·보고서 |

원본은 `skills/`이며 애플리케이션 코드와 함께 버전 관리합니다.
필요할 때 네 폴더를 대상 환경의 스킬 디렉터리에 함께 복사합니다.
저장소는 스킬을 자동 설치하지 않습니다. Codex에서는 대상 프로젝트의 `.codex/skills/`
또는 사용자 `$CODEX_HOME/skills`(기본 `~/.codex/skills`)를 사용할 수 있습니다.
참고서는 묶음 안에 포함되며 도메인 스킬은 `raven-cli`의 공통 지침·참고서를 공유합니다.
기존 Raven 실행 파일·데이터 홈과 설치된 CLI의 help를 확인하며,
단순 조회를 위해 저장소 초기화나 Raven 업데이트를 수행하지 않습니다.

## 초기화와 조회

새 홈은 한 번 초기화합니다. 조회 명령은 없는 저장소를 초기화하지 않습니다.

```bash
raven --home ./raven-data --error-format json init
raven --home ./raven-data --error-format json todo list --format json --limit 100
raven --home ./raven-data --error-format json todo show <item-id>
```

목록 페이지는 `{items,next}`입니다.
숫자 `next`를 다음 요청의 `--offset`에 넣고 필터·limit을 유지합니다. Null이면 조회를 끝냅니다.
동시 변경은 페이지 경계를 움직일 수 있으므로 다른 쓰기 작업과 함께 조회할 때는 ID로 중복을 제거합니다.
단일 레코드 조회·보고서는 명령별 결과 형식을 사용합니다.

`todo today`는 기존 발생 항목만 조회합니다.
Routine Task 생성은 `todo routine materialize`로 명시적으로 실행하며 결과는 JSON 배열 하나입니다.
초기화·상태 검사·help·version은 `--error-format json`을 사용해도 텍스트로 출력합니다.

## 선택값 확인과 검색

입력을 구성하기 전에 `--help`를 확인합니다.
ToDo는 타입별 고정 선택값과 현재 항목에 가능한 선택값을 JSON으로 제공합니다.

```bash
raven todo options --type task
raven --home ./raven-data todo options --id <item-id>
raven --home ./raven-data todo table lookups --scope workspace.task
raven --home ./raven-data todo table lookups --scope workspace.goal --id <goal-id> --horizon month
```

`status_choices`는 UI 상태 선택기와 같고, `actions`는 별도 생명주기 동작을 포함합니다.
조회 가능한 과거 상태라고 해서 그 상태를 임의로 설정할 수 있는 것은 아닙니다.
관계 선택에는 lookup 결과의 ID를 사용합니다.
Goal 부모 후보에서는 종료된 항목, 같거나 더 작은 기간, 자기 자신, 순환을 만드는 항목을 제외합니다.
기간을 변경할 때는 변경할 `--horizon`을 전달합니다.

ToDo `list --query`는 대소문자를 구분하지 않고 입력한 문자열 그대로 검색합니다.
Ledger 기준 데이터 목록은 `--query`, `--include-inactive`를 지원합니다.
Health 목록은 날짜와 각 명령의 음식·태그·이름·식사·단위 필터를 지원합니다.
UI의 상세 검색 기능은 도메인별 `table query --json`을 사용합니다.

```bash
raven --home ./raven-data todo table query --json \
  '{
    "scope":"workspace.task",
    "filter_mode":"and",
    "filters":[
      {"field":"title","operator":"contains","value":{"text":"dentist"}},
      {"field":"due","operator":"is_between","value":{"range":{"start":"2026-10-01","end":"2026-10-31"}}}
    ],
    "sorts":[{"field":"priority","direction":"asc"},{"field":"due","direction":"asc"}],
    "group_by":"project",
    "group_settings":{"sort":"alphabetical","hide_empty":true,"manual_order":[],"hidden_group_keys":[]},
    "context":{}
  }'
```

테이블 검색 페이지는 `{items,next_offset}`, 일반 목록은 `{items,next}`입니다.
테이블 검색은 `next_offset`을 다음 JSON 요청의 `offset`에 넣습니다.
페이지를 넘길 때 필터·정렬·그룹·context를 유지합니다.

예제는 제목·마감일 조건을 AND로 결합하고, 우선순위 다음 마감일 순으로 오름차순 정렬하며 Project별로 그룹화합니다.
둘 중 하나만 만족하도록 검색하려면 `filter_mode: "or"`를 사용합니다.
필터는 최대 50개, 페이지 limit은 `1..50`, 정렬 조건은 최대 10개입니다.
Ledger에는 정렬 조건이 최소 1개 필요합니다. ToDo·Health는 빈 정렬 목록을 허용합니다.

테이블 검색은 UI scope의 표시 정책을 따릅니다. Completed·missed ToDo 작업은 계속 보일 수 있습니다.
Ledger·Health 테이블은 보관된 레코드를 제외합니다.
보관된 ToDo·Ledger 레코드까지 포함해 이전 입력을 검색하려면 다음 명령을 사용합니다.

```bash
raven --home ./raven-data todo list --query dentist --include-archived --format json
raven --home ./raven-data todo archive-list --format json
raven --home ./raven-data ledger entry list --content Lunch --include-archived --format json
```

ToDo `show`는 종료된 항목도 읽습니다.
Ledger 목록에는 전체 CLI 레코드가 포함되며 `entry show`는 보관되지 않은 거래만 조회합니다.
Health 목록에는 보관 항목 포함 옵션이 없습니다.
알고 있는 보관 ID는 해당 `health diet|bowel|medication|metric show` 명령에 `--format json`을 붙여 조회합니다.
Health 감사 이력은 `health audit <record-type> <id> --format json`으로 확인합니다.
`history`는 Ledger audit에만 있는 별칭입니다.

## 생성과 수정

생성 작업 하나마다 고정 request key 하나를 부여합니다.
재시도는 인수 순서까지 정확히 같아야 합니다. 다른 생성 작업에는 새 키가 필요합니다.

```bash
raven --home ./raven-data --error-format json --request-key dentist-2026-09-30 \
  todo task create "Call dentist" --scheduled today
raven --home ./raven-data --error-format json todo show <item-id>
raven --home ./raven-data --error-format json todo update <item-id> \
  --expected-updated-at <updated_at-from-show> --title "Call dentist tomorrow"
```

ToDo 수정과 지원되는 Health 변경에는 `--expected-updated-at`을 사용합니다.
충돌하면 다시 조회한 뒤 변경 내용을 조정합니다. 타임스탬프를 생략하면 버전 비교 없이 수정합니다.
JSON의 원래 `updated_at` 문자열을 그대로 사용합니다. 쉘이 자동 변환한 로컬 날짜 문자열은 전달하지 않습니다.
Ledger 이체는 전역 request key 대신 `--operation-key`를 사용합니다.
`todo update --clear-priority`는 우선순위를 지웁니다. 관련 옵션을 생략하면 기존 우선순위를 유지합니다.

## 오류와 재시도

종료 코드 0은 성공입니다. Stdout은 명령별 출력 형식에 맞게 해석합니다.
`--error-format json`을 지정한 실패 명령은 stderr에 JSON 오류 하나를 출력합니다.

| 결과 | 대응 |
| --- | --- |
| 종료 코드 2, 검증 오류 | `fields` 확인. `committed`가 false이면 입력을 고쳐 재시도 |
| 종료 코드 4, 레코드 없음 | 레코드 ID 또는 lookup 다시 확인 |
| `committed: true` | 반영된 레코드·정리 상태 확인. 생성 재실행 금지 |
| `committed: null` | 변경 재시도 전에 레코드 확인 |
| `request_key_conflict` | 원래 인수 복구. 같은 키를 다른 작업에 재사용하지 않음 |
| `request_outcome_unknown` 또는 `request_timeout` | 새 키 사용 전에 실제 저장된 레코드 확인 |

키가 있는 자식 실행의 기본 제한 시간은 120초입니다.
도메인 명령 앞의 `--request-timeout-seconds <1..3600>`으로 변경합니다.
시간 초과는 자식 실행을 중단하고 pending 영수증을 유지합니다.
프로세스가 종료됐다는 사실만으로 변경이 롤백됐다고 판단하지 않습니다.
제한 시간은 요청 내용의 동일성을 판단하는 기준에 포함되지 않습니다.
키가 있는 요청의 백업에는 `retry.sqlite`도 보관합니다.

전체 옵션은 [CLI 참고서](cli-reference.ko.md) 또는 `raven <domain> <command> --help`에서 확인합니다.
JSON 입력은 명령행 `--json` 인수로 전달합니다.
