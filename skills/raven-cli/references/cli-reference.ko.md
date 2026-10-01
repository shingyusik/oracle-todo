# CLI 참고서

[English](cli-reference.md)

실행 명령은 `raven`입니다. 입력은 구조화된 옵션 또는 스키마로 검증하는 JSON입니다.
자연어로 작성한 일지 내용을 자동으로 해석하지 않습니다.

## 전역 옵션

```text
raven [--home <path>] [--error-format text|json] [--request-key <key>] <command>
```

`--home`은 `RAVEN_HOME`과 기본 경로 `$HOME/.raven`보다 우선합니다.
Windows에서 `HOME`이 없거나 비어 있으면 `%USERPROFILE%/.raven`을 사용합니다.
전역 옵션은 도메인 명령 앞에 놓습니다. 특히 위임 실행하는 ToDo 명령에서는 이 순서를 지킵니다.
help는 데이터 홈 없이 실행되며 저장소나 로그를 초기화하지 않습니다.

`--error-format json`은 stderr에 구조화된 오류 문서 하나를 출력하고 콘솔 로그를 억제합니다.
성공 출력은 명령별 출력 형식을 따릅니다. `raven --version`은 실행 파일 버전을 출력합니다.

조회·수정·재시도 흐름은 [AI CLI 사용 가이드](ai-cli-usage.ko.md)를 참고하세요.

## 시스템 명령

| 명령 | 동작 |
| --- | --- |
| `raven init` | 모든 저장소와 Health 미디어 초기화. 반복 실행 가능 |
| `raven health-check` | 저장소·미디어의 상태와 스키마를 읽기 전용으로 확인 |
| `raven import todo [--source-home <path>]` | 원본 `todo.sqlite`를 안전하게 복사. 기본 원본 홈은 `$HOME/.todo-engine` |
| `raven api` | Bearer 인증 HTTP API 실행 |
| `raven ui [--ui-path <dir>] [--port <u16>] [--no-open]` | 루프백 UI와 쿠키 인증 API 실행 |

`--ui-path`가 없으면 `RAVEN_UI_PATH`에서 UI 파일 경로를 읽습니다.

`RAVEN_UI_PUBLIC_ORIGIN`은 Cloudflare Access를 통한 공개 UI 접근을 설정합니다.
정규화된 HTTPS origin 하나만 허용합니다. 호스트는 소문자여야 하며, 선택적으로 지정하는
포트는 앞자리 0 없이 `1..=65535`여야 합니다. 기본 포트 `443`은 생략합니다.
사용자 인증 정보, 경로, 쿼리, fragment, 잘못된 포트, 현재 루프백 리스너로 해석되는
authority는 거부합니다.

```bash
RAVEN_UI_PUBLIC_ORIGIN=https://raven.b-sir.xyz \
  raven ui --port 3001 --no-open
```

설정은 리스너를 열기 전에 검증합니다. 잘못된 공개 origin은 값을 노출하지 않고 종료 코드 `2`를 반환합니다.
UI 리스너는 루프백에 바인딩되며 로컬 Host 동작은 유지됩니다.
공개 Host 요청에는 `cloudflared`가 검증한 Access assertion이 필요합니다.
최상위 페이지 이동은 `Origin`을 생략할 수 있습니다. 전달된 Origin과 공개 API의
`POST`, `PUT`, `PATCH`, `DELETE` Origin은 설정값과 정확히 일치해야 합니다.
UI 인덱스와 확장자 없는 SPA 경로는 보안 Raven 세션 쿠키를 발급합니다.
일반 `.html` 파일은 발급하지 않으며, API에는 세션 쿠키가 계속 필요합니다.
요청 대상 authority와 `Host`가 충돌하면 `421`을 반환합니다.
토큰·assertion·쿠키는 로그에 기록하지 않습니다.

## ToDo

`raven todo`는 도메인 명령을 재사용 가능한 ToDo CLI에 위임합니다.

```text
init, health, list, show, options, table query|lookups,
area create,
project create,
goal create,
task create,
routine create|materialize,
event create,
pause, miss, postpone, resume, complete, reopen,
archive, update,
archive-list, pending, today
```

예제:

```bash
raven todo project create "Monthly close" \
  --definition-of-done "Statements reconciled"
raven todo routine create "Morning review" \
  --recurrence-rule "RRULE:FREQ=DAILY"
raven todo task create "Call dentist" --scheduled today
raven todo list --format json --limit 100
raven todo show <item-id>
raven todo complete <item-id>
```

Project는 비어 있지 않은 `definition_of_done`, Routine은 비어 있지 않은 RRULE,
Event는 `scheduled`가 필요합니다. ToDo는 상태 전환으로 생명주기를 관리하며 purge를 제공하지 않습니다.
`postpone --scheduled <date>`에서 오늘을 지정할 수 있는 것은 기존 예정일이 오늘 이전인 경우뿐입니다.
그 외에는 오늘보다 뒤의 날짜를 지정해야 합니다.
HTTP 접근은 인증된 `raven api` 또는 `raven ui`를 사용합니다.

`create`는 `active` 항목을 생성합니다. `propose`도 같은 생성 명령의 호환 별칭입니다.
`list`, `pending`, `today`, `archive-list`는 `--format json`, `--offset`, `--limit`를 지원합니다.
JSON 결과는 `{items,next}`이며 `next`는 다음 offset 또는 null입니다.
Markdown 출력에도 항목 ID가 포함됩니다. `show`는 전체 항목을 JSON으로 반환합니다.

`update --expected-updated-at <updated_at>`은 읽은 뒤 변경된 항목의 수정을 원자적으로 거부합니다.
`show`의 타임스탬프를 사용합니다. 생략하면 버전 비교 없이 수정합니다.
`today`는 기존 Task만 조회합니다. Routine 발생 항목을 생성하려면 `routine materialize`를 실행합니다.
생성 결과는 JSON 배열 하나이며, 결과가 없으면 `[]`입니다.
ToDo·Ledger·Health 조회 명령은 데이터베이스를 생성하거나 마이그레이션하지 않습니다.
초기화되지 않은 홈은 먼저 `raven init`을 실행합니다.
전체 옵션은 `raven todo --help`, `raven todo <command> --help`로 확인합니다.

`options [--type <type> | --id <item-id>]`는 고정 선택값, 타입별 수정 가능 필드,
UI의 `status_choices`, 별도의 생명주기 `actions`를 JSON으로 반환합니다.
ID를 지정하면 현재 상태를 고려합니다. 조회용 상태에는 과거 상태도 포함되며,
그 목록 전체를 임의로 설정할 수 있다는 뜻은 아닙니다.

| 타입 | 열린 항목의 기본 상태 선택지 |
| --- | --- |
| Area | `active`, `archived` |
| Task | `active`, `completed` |
| Event, Project, Routine, Goal | `active`, `paused`, `completed` |

종료된 항목은 현재 상태를 유지합니다. 완료된 Task·Event는 `reopen`으로 `active`로 되돌릴 수 있습니다.
Archive와 Planner의 miss/postpone은 별도 동작입니다.
기존 과거 상태는 선택기에 유지하지만 실제로 전환 가능한 상태만 추가로 제공합니다.
Paused Routine은 반복 규칙이 있어야 `active`로 전환할 수 있습니다.
`update --clear-priority`는 Task·Routine·Event의 우선순위를 지우며 `--priority`와 함께 쓸 수 없습니다.
숫자 우선순위 범위는 `1..10`입니다.

`list --query <text>`는 제목·메모·과거 description·outcome을 검색합니다.
UI 텍스트 필터와 같은 Unicode 대소문자 정규화를 사용합니다. `%`, `_`도 입력한 문자 그대로 검색합니다.
필드별 조건·정렬·그룹화는 `table query`를 사용합니다.
`list --include-archived`는 기본 목록에서 숨기는 상태도 포함합니다.
`archive-list`는 종료 상태(`completed,cancelled,dropped,archived,missed,rejected`)를 조회합니다.
`show <item-id>`도 종료된 항목을 조회합니다.

## Ledger

| 명령 | 기능 |
| --- | --- |
| `ledger entry` | `add`, `update`, `list`, `show`, `archive`, `restore` |
| `ledger transfer` | 원자적이고 중복 생성되지 않는 이체 쌍 생성 |
| `ledger transfer-show` | 이체 쌍 조회 |
| `ledger transfer-update` | 원자적 이체 서비스로 양쪽 거래 수정 |
| `ledger currency` | `create`, `update`, `list` |
| `ledger account-category` | `create`, `update`, `list`, `purge` |
| `ledger account` | `create`, `update`, `list` |
| `ledger category` | `create`, `update`, `list` |
| `ledger reports` | 양 끝 날짜를 포함하는 기간의 요약 또는 분류별 보고서 |
| `ledger balances` | 현재 계좌 잔액 |
| `ledger compare` | 지정 기간과 바로 앞의 같은 길이 기간 비교 |
| `ledger audit` | 한 레코드의 감사 이력 페이지. 별칭 `history` |
| `ledger doctor` | 범위를 제한한 읽기 전용 정합성 진단 |
| `ledger export` | 결정적인 schema-v3 JSON 내보내기 |
| `ledger table` | `query --json <body>`, `lookups --scope <scope>` |

add/create/update 입력은 `--json <object>` 또는 개별 필드 옵션 중 하나를 사용합니다. 혼합하지 않습니다.
날짜는 `YYYY-MM-DD`, 타임스탬프는 RFC 3339입니다.
목록 기본값은 `--offset 0 --limit 100 --format table`입니다. 스크립트는 `--format json`을 사용합니다.

거래 예제:

```bash
raven ledger entry add \
  --date 2026-07-31 --type expense --amount 12000 --currency KRW \
  --account Wallet --category Food --content Lunch
raven ledger entry list --from 2026-07-01 --to 2026-07-31 --format json
```

이체 예제:

```bash
raven ledger transfer \
  --operation-key 018f31c0-5c2a-4e75-9c18-a14d7bddb2a1 \
  --date 2026-07-31 --amount 10000 --currency KRW \
  --from-account Checking --to-account Savings --content Transfer
```

Operation key는 정규 형식의 UUID v4입니다. 같은 작업을 재시도해도 중복 생성되지 않습니다.

`transfer-update <group-id> --json <object>`는 이체 쌍의 날짜·내용·계좌·금액·통화·메모를 교체합니다.
필수 필드는 `date`, `content`, `from_account`, `to_account`, `amount`(십진수 문자열), `currency`입니다.
선택 필드는 `notes`이며 생략하면 메모가 지워집니다. 양쪽 거래 금액은 원자적으로 변경됩니다.

```bash
raven ledger transfer-update <group-id> --json \
  '{"date":"2026-09-30","content":"Savings","from_account":"Checking","to_account":"Savings","amount":"10000","currency":"KRW"}'
```

### Ledger 생명주기

거래는 `archive <id>`, `restore <id>`를 지원합니다. 기준 데이터는 `update --active <true|false>`를 사용합니다.
Purge는 account-category만 제공합니다. 먼저 미리보기를 조회하고 `--confirm <confirmation-id>`로 확인합니다.
감사 이력은 유지됩니다.
`entry list --include-archived`는 보관된 거래를 검색 결과에 포함합니다.
목록에는 전체 CLI 레코드가 포함됩니다. `entry show`는 보관되지 않은 거래만 조회합니다.

거래 source·actor·작성 타임스탬프는 어댑터가 지정합니다.
Adjustment 레코드는 조회할 수 있지만 직접 생성하거나 해당 타입으로 변환할 수 없습니다.
직접 add/update하는 거래 타입은 `expense`, `income`입니다. 이체는 `ledger transfer`로 생성합니다.
조회 필터는 과거 transfer·adjustment 타입도 지원합니다.
Currency·account-category·account·category 목록은 `--query <text>`, `--include-inactive`를 지원합니다.
이름·코드 검색은 Unicode 대소문자 정규화를 사용하며 페이지를 나누기 전에 필터링합니다.
비활성 레코드는 복구를 위해 조회할 수 있지만 활성 선택 후보로 취급하지 않습니다.

## Health Journal

| 명령 | 기능 |
| --- | --- |
| `health diet` | `add`, `update`, `list`, `show`, `archive`, `restore` |
| `health bowel` | 같은 생명주기 |
| `health medication` | 같은 생명주기 |
| `health metric` | `daily-upsert`, `list`, `show`, `archive`, `restore` |
| `health reports` | `--from`, `--to` 양 끝 날짜를 포함하는 기간 보고서 |
| `health audit` | 한 레코드의 감사 이력 페이지 |
| `health table` | `query --json <body>`, `lookups --scope <scope>` |

생성·수정은 엄격한 `--json` 또는 타입이 정해진 개별 옵션을 사용합니다.
타임스탬프는 RFC 3339입니다. 변경 JSON은 알 수 없는 필드를 거부합니다.

```bash
raven health diet add \
  --at 2026-07-31T12:00:00+09:00 --meal lunch --food "Rice bowl" \
  --tags rice,vegetables --image ./meal.jpg
raven health medication add \
  --at 2026-07-31T08:00:00+09:00 --name Vitamin-D --dose 1 --unit tablet
raven health metric daily-upsert \
  --json '[{"at":"2026-07-31T07:00:00+09:00","category":"weight","key":"body_weight","name":"Body weight","value":70.2,"unit":"kg"}]'
raven health reports --from 2026-07-01 --to 2026-07-31 --format json
raven health audit health_event <id> --limit 100 --format json
```

일일 metric은 고정 UTC+09:00 날짜를 사용합니다. 체중·수면·CRP·분변 칼프로텍틴·전반적 컨디션의
정해진 식별값을 사용합니다. 기존 일일 값을 교체하려면 `expected_updated_at`이 필요합니다.
Metric별 메모는 없으며 전반적 컨디션만 `condition_note`를 사용합니다.

식사 선택값은 `breakfast,lunch,dinner,snack,late_night`입니다.
약 단위는 `tablet,capsule,packet,mg,g,ml,drop,dose`입니다.
Metric 분류 조회값은 `weight,sleep,lab,symptom`이며 Bowel·Medication은 각각의 명령을 사용합니다.
Diet·Bowel·Medication 목록은 UTC+09:00 기준의 `--from`, `--to` 날짜를 지원하며 양 끝 날짜를 포함합니다.
Diet는 `--food`, `--meal`, 쉼표로 구분한 `--tags`도 지원합니다.
Medication은 `--name`, `--unit`을 지원합니다. 이 필터들은 UI 테이블 서비스를 사용합니다.
일일 metric의 날짜·값 필터는 `health table query`를 사용합니다.
`metric list`는 개별 과거 레코드를 조회하는 형식입니다.

Health 감사 이력의 레코드 타입은 `diet_entry`, `health_event`, `media_file`입니다.
감사 JSON의 `items`에는 RFC 3339 발생 시각, 변경 전후 스냅샷, 사유가 포함됩니다.
보고서 JSON은 전체 보고서 데이터를 반환하며 table 형식은 레코드 수를 요약합니다.

Health archive/restore는 동시 수정을 확인하는 `--expected-updated-at <RFC3339>`를 선택적으로 받습니다.
공개 Health CLI에는 purge가 없습니다. 보관·과거 레코드는 UI에서 조회하고 지원되는 복구 작업을 할 수 있습니다.
Health 목록은 보관된 레코드를 제외하며 `--include-archived` 옵션이 없습니다.
알고 있는 보관 ID는 해당 `diet|bowel|medication|metric show <id> --format json` 명령으로 조회합니다.
감사 이력은 `health audit <record-type> <id> --format json`으로 확인합니다.

## UI 테이블 검색과 선택 후보

세 도메인 모두 `table query --json <body>`, `table lookups --scope <scope>`를 제공합니다.
검색 JSON은 해당 UI 테이블 API와 같은 검증 스키마·필터·정렬·그룹·결과 형식을 사용합니다.
검색 페이지는 `{items,next_offset}`입니다. 같은 조건에서 JSON의 `offset`에 `next_offset`을 넣어 다음 페이지를 조회합니다.
일반 목록 페이지는 `{items,next}`입니다.
스키마와 예제는 명령의 `--help`에서, scope별 필드·연산자는 [API 참고서](api-reference.md)에서 확인합니다.

검색당 필터는 최대 50개, 페이지 limit은 `1..50`이며 기본값은 50입니다.
Ledger 정렬 조건은 1..10개, ToDo·Health는 0..10개입니다.
정렬 조건은 scope별 `field`와 `direction`(`asc`, `desc`)으로 구성하며 배열 순서대로 적용합니다.
`filter_mode: "and"` 또는 `"or"`로 `filters`를 결합합니다.
`group_by`에는 해당 scope가 지원하는 그룹 필드 하나를 지정합니다.
`group_settings`는 그룹 순서와 표시 여부를 조절합니다.

검색 결과 표시 정책도 UI scope를 따릅니다.
ToDo Workspace·linked 테이블은 `archived,dropped,cancelled`를 숨깁니다.
Planner 작업 테이블은 `rejected`도 숨기며, Planner Goal 테이블은 모든 종료 상태를 제외합니다.
Completed·missed 작업은 계속 보일 수 있습니다. Ledger·Health 테이블은 보관 레코드를 제외합니다.

| 도메인 | Scope |
| --- | --- |
| ToDo | `workspace.area/project/goal/routine/task/event` 및 UI Planner·linked scope |
| Ledger | `ledger.transactions`, `ledger.accounts`, `ledger.categories` |
| Health | `health.diet`, `health.bowel`, `health.medication`, `health.metrics` |

Lookups는 UI 선택 후보의 ID·이름을 반환합니다.
ToDo는 `{items}`, Ledger·Health는 scope별 후보 목록 객체를 반환합니다.
ToDo의 `--id <item-id>`는 현재 항목에 유효하지 않은 관계 후보를 제외합니다.
`--horizon week|month|year`는 변경할 Goal 기간에 맞는 부모 후보를 조회합니다.
Goal 부모는 종료 상태가 아니어야 하며 자식보다 더 큰 기간이어야 합니다. 순환 관계는 허용하지 않습니다.

```bash
raven todo options --type task
raven todo options --id <item-id>
raven todo table lookups --scope workspace.task
raven todo table lookups --scope workspace.goal --id <goal-id> --horizon month
raven health table lookups --scope health.medication
raven ledger table lookups --scope ledger.transactions
```

## 출력과 종료 코드

- 성공한 변경 명령은 압축된 JSON을 출력합니다.
- 지원되는 조회 명령은 기본적으로 표 형식을 사용합니다. JSON은 `--format json`으로 선택합니다.
- 결과는 stdout, 오류·콘솔 로그는 stderr입니다.

CLI 목록·감사 이력의 JSON 페이지는 `{items,next}`입니다.
`next`는 다음 숫자 offset 또는 null입니다. 필터와 limit을 유지해 다음 페이지를 조회합니다.
Health diet·bowel·medication·metric·audit 목록, Ledger 목록·감사 이력에 적용됩니다.
보고서·단일 레코드 조회는 각각의 객체 형식을 사용합니다.
Offset 페이지는 스냅샷이 아니므로 동시에 삽입·삭제가 일어나면 페이지 사이에서 레코드 위치가 바뀔 수 있습니다.

`--error-format json` 오류는 `code`, `message`, `fields`, `committed`, `retryable`을 포함하는 객체 하나입니다.
커밋 이후 정리 실패는 `record_id`도 포함합니다.
`committed`는 커밋된 변경이면 true, 확실히 거부된 요청이면 false, 결과를 모르면 null입니다.
True·null일 때 변경을 자동으로 반복하지 않습니다. Help·version은 성공한 텍스트 출력입니다.

| 종료 코드 | 의미 |
| --- | --- |
| `0` | 성공. Help·version 포함 |
| `2` | 입력 검증·정책·충돌·안전하지 않은 설정·확인값 불일치 |
| `4` | 레코드를 찾을 수 없음 |
| `1` | 저장소·마이그레이션·정리·가져오기 무결성·내부 오류 |

## 안전한 생성 재시도

레코드 생성 시 도메인 명령 앞에 고정된 `--request-key`를 지정합니다.

```bash
raven --error-format json --request-key dentist-2026-09-30 \
  todo task create "Call dentist" --scheduled today
raven --error-format json --request-key lunch-2026-09-30 \
  health diet add --at 2026-09-30T12:00:00+09:00 --meal lunch --food Rice
```

같은 키·정확히 같은 인수로 재시도하면 중복 생성 없이 원래 stdout을 재생합니다.
같은 키에 다른 인수를 사용하면 `request_key_conflict`가 발생합니다.
키는 ASCII 영문·숫자·`-`, `_`, `.`, `:`로 구성하며 길이는 1–128입니다.
실행 영수증은 해당 데이터 홈의 `retry.sqlite`에 저장됩니다.
인수 순서와 생성 별칭도 요청 내용을 구분하는 기준입니다.
의도적으로 중복 생성하거나 불확실한 결과를 호출자가 직접 확인할 수 있는 경우에만 키를 생략합니다.

키가 있는 자식 실행의 기본 제한 시간은 120초입니다.
`--request-timeout-seconds <1..3600>`으로 변경할 수 있으며 request key가 필요합니다.
시간 초과는 `request_timeout`, `committed: null`을 반환하고 pending 영수증을 유지합니다.
제한 시간은 요청 내용의 동일성을 판단하는 기준에 포함되지 않습니다.

지원 작업은 ToDo Area·항목 생성, Ledger 거래·기준 데이터 생성, Health diet·bowel·medication add입니다.
조회·수정·생명주기 명령·일일 metric upsert에는 request key를 사용할 수 없습니다.
Ledger 이체는 `--operation-key`를 사용합니다.

실행 중단 후 pending 영수증이 있으면 `request_outcome_unknown`을 반환하고 변경을 재실행하지 않습니다.
새 키를 쓰기 전에 도메인 레코드를 확인합니다.
키가 있는 요청을 재개할 백업에는 `retry.sqlite`도 포함합니다. 영수증을 삭제하면 중복 방지가 사라집니다.
영수증과 도메인 데이터베이스는 하나의 트랜잭션으로 묶이지 않습니다.
