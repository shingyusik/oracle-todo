# Task 6 Implementer Report

## 결과

- 상태: 완료
- 커밋 메시지: `[ADD] Expose Ledger through Raven CLI`
- 범위: Raven Ledger 구조화 CLI, Ledger init/health 연동, 안정 JSON DTO,
  exit-code 및 안전 로깅 계약
- 데이터 홈: 모든 E2E와 health 검증은 `tempfile` 임시 홈만 사용
- 라이브 데이터: `~/.raven`, `~/.todo-engine` 및 실제 사용자 DB에 접근하지 않음

## CLI 표면

`raven ledger`는 다음 명령을 제공한다.

- `entry add|update|list|show|archive|restore|purge`
- `transfer`, `transfer-show`
- `currency create|update|list|purge`
- `account-category create|update|list|purge`
- `account create|update|list|purge`
- `category create|update|list|purge`
- `reports`, `balances`, `briefing`, `doctor`, `export`

모든 mutation은 명시적 flag 또는 inline `--json` 객체만 받는다. 자연어
positional input은 clap error로 거부된다. JSON mutation DTO는
`deny_unknown_fields`를 사용하므로 caller-supplied `id`, transfer group/entry
ID, 알 수 없는 필드를 서비스 호출 전에 거부한다. `--json`과 mutation field
flag의 혼용도 validation error다.

## 서비스 경계와 금액

- 모든 mutation은 `LedgerService<SqliteLedgerRepository>` 공개 메서드만
  호출한다. CLI에서 raw SQL mutation이나 repository transaction을 열지
  않는다.
- entry/master/transfer 입력은 Task 3의 공개 command DTO와 현재
  `create_category`, account-category page, resolved `EntryView` API를 사용한다.
- 금액은 active currency public page를 끝까지 조회해 ID → code → 고유 name
  순서로 정밀도를 해석하고 `Money::parse`로 변환한다.
- entry/account update에서 currency가 생략되면 현재 public read projection의
  currency ID를 사용한다.
- 소수 자릿수 초과, malformed decimal, overflow, 잘못된 calendar date와
  RFC3339 timestamp는 Ledger validation error로 반환한다.
- entry list는 inclusive date range, type, account, category, currency,
  literal content, archived visibility, offset/limit을 `EntryQuery`에 전달한다.

## Transfer와 lifecycle

- transfer는 canonical UUID v4 `--operation-key`를 필수로 요구하며
  `--idempotency-key` 별칭도 제공한다.
- 같은 key와 같은 payload의 재시도는 동일한
  `transfer_group_id/out_entry_id/in_entry_id`를 반환한다.
- 같은 key와 다른 payload는 conflict로 거부된다.
- transfer entry archive/restore는 LedgerService의 pair lifecycle을 그대로
  사용한다.
- entry purge에서 confirmation이 생략되면 JSON preview로
  `confirmation_id`, `transfer_group_id`, 두 `entry_ids`를 반환하고 exit 2로
  중단한다.
- transfer pair는 target entry ID가 아니라 group ID를 정확히
  `--confirm`해야 두 row가 함께 purge된다.
- master purge도 record ID preview와 exact confirmation을 사용하며,
  참조 중인 master는 service conflict로 보존된다.

## 읽기 출력

- 모든 read는 `--format table|json`을 지원하고 table이 기본값이다.
- entry, master, balances, transfer는 CLI 전용 output DTO로 변환한다.
- 금액 필드는 `amount_minor`, `opening_balance_minor`,
  `current_balance_minor`로 고정한다.
- JSON page는 `{"items":[...],"next":{"offset":...,"limit":...}}`
  구조이며 마지막 page의 `next`는 `null`이다.
- mutation 결과도 고정 필드 순서의 단일 JSON 객체다.
- report는 summary/account/category projection을 제공하고, balances와
  briefing은 각각 공개 service read projection을 사용한다.
- doctor는 caller record/byte budget을 공개 doctor API에 전달한다.
- export는 Ledger export schema version 3을 그대로 직렬화하며 같은 snapshot
  상태에서 반복 실행한 byte output이 동일하다.

## Init과 health

- `raven init`은 `todo.sqlite`, `ledger.sqlite`, Health media directory를
  초기화한다.
- Ledger health는 SQLite read-only flag로만 연결하고 schema version과
  `check_schema()`를 검사한다.
- missing file과 version 0은 `ledger=not_initialized`, 정상 version 2는
  `ledger=ok user_version=2`, 손상되거나 미래 version인 DB는
  `ledger=unavailable`이다.
- missing/future/corrupt health 검사는 파일을 생성하거나 DB bytes를
  변경하지 않는다.

## 오류와 로깅

| Ledger 오류 | CLI exit |
| --- | ---: |
| `Validation`, `Conflict`, `ConfirmationMismatch` | 2 |
| `NotFound` | 4 |
| `Busy`, `Storage`, `Migration`, internal | 1 |

- clap help는 0, clap parse error는 2다.
- Raven terminal event는 `command=ledger`, `engine=ledger`, duration과
  numeric exit code만 기록한다.
- 로그에는 entry content, notes, amount, currency/account input, raw JSON,
  데이터 홈 path, SQLite 원문 오류를 넣지 않는다.

## TDD 증거

### RED

최초 `cargo test -p raven-cli --test ledger_cli`에서 8개 E2E가 모두 실패했다.

- `ledger` subcommand가 없어 master/entry/transfer/report 명령이
  `unrecognized subcommand 'ledger'`로 실패
- `raven init` 뒤 `ledger.sqlite`가 생성되지 않음
- health가 Ledger schema를 검사하지 않음

production code를 추가하기 전에 실패 원인이 Task 6 surface 부재임을
확인했다.

### GREEN과 보강

- 최초 8개 E2E: 모두 통과
- ambiguous reference, storage exit/log privacy, future schema read-only health를
  추가한 최종 Ledger CLI E2E: 11개 통과
- 기존 Raven health 기대값을 실제 Ledger schema-aware 상태
  (`unavailable`)에 맞추고 Raven CLI 회귀 전체를 재검증

## 최종 검증

다음 명령을 최종 source 상태에서 실행했다.

```text
cargo test -p ledger-engine
PASS: library 34, integration 107, unit 15, doc-tests 5

cargo test -p raven-cli
PASS

cargo test --workspace -q
PASS: workspace 전체 test 및 doc-test 실패 0

cargo fmt --all -- --check
PASS

cargo clippy --workspace --all-targets --all-features -- -D warnings
PASS

git diff --check
PASS
```

## 자체 검토

- CLI layer는 public service/read projection만 조합하며 Ledger의 transaction
  및 policy 경계를 우회하지 않는다.
- Money 변환은 float를 사용하지 않고 currency별 최소화폐단위 정밀도를
  적용한다.
- transfer lifecycle은 pair/group confirmation을 entry ID confirmation보다
  우선해 single-side purge를 만들 수 없다.
- read JSON은 domain 내부 field 이름에 의존하지 않는 CLI DTO를 사용한다.
- health의 read-only 연결은 missing DB를 만들지 않고 미래 schema를
  migrate/downgrade하지 않는다.
- Todo delegation, Todo exit mapping, Raven logging/rotation 동작은 변경하지
  않았고 기존 Raven 테스트로 회귀를 확인했다.

## 문서 동기화

`README.md`, `docs/operations/*`, `AGENTS.md`, `CLAUDE.md`는 현재 배포된
Todo 제품을 설명한다. Raven 전체 packaging과 사용자 문서화는 별도
`2026-07-30-raven-packaging-and-docs` 계획의 범위이므로 Task 6에서는
공개 안정 문서를 부분 갱신하지 않고 이 SDD 구현 보고서만 추가했다.
