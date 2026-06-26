---
phase: 05-cli-api-surface-parity-locked
plan: 03
subsystem: api
tags: [e2e, parity, assert_cmd, axum, oneshot, sc3, sc4, pitfall-1]

# Dependency graph
requires:
  - phase: 05-cli-api-surface-parity-locked
    plan: 01
    provides: CLI surface (goal propose / agenda / date-range / period / update --parent-id) under test
  - phase: 05-cli-api-surface-parity-locked
    plan: 02
    provides: HTTP API surface (POST /goals/propose, GET /views/*, PATCH /items/:id parent_id) under test
provides:
  - "Paired CLI+API e2e tests proving goal-create state parity (proposed/agent) across both surfaces (SC3/SC4)"
  - "Present-but-invalid rejection parity: bad horizon => CLI exit 2 / HTTP 400 with detail (SC3)"
  - "Pitfall-1 regression guard: PATCH /items/:id parent_id is asserted non-null after task->goal link"
  - "View JSON shape parity: agenda/date-range arrays + period period_key/roots on both surfaces"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CLI e2e: assert_cmd Command::cargo_bin over a TestHome, parse JSON stdout via serde_json::from_slice"
    - "API e2e: router(&db_path) over a tempdir todo.sqlite, oneshot via json_request/empty_request, parse body_json"
    - "Parity asserted independently in each file against the same service path (no shared cross-surface helper, matches existing idiom)"
    - "Rejection parity tested only for present-but-invalid input (Pitfall 3); CLI exit 2 mirrors HTTP 400"

key-files:
  created: []
  modified:
    - todo-engine/tests/e2e/cli.rs
    - todo-engine/tests/e2e/api.rs

key-decisions:
  - "State/view parity asserted independently in each e2e file against the same TodoService path — matches the existing idiom, no bespoke cross-surface comparison helper (PATTERNS §8)."
  - "Rejection parity uses present-but-invalid horizon (bogus) only, per Pitfall 3: it routes through TodoError::Validation on both surfaces (exit 2 / HTTP 400) so the rejection is byte-comparable; missing-param rejections differ (clap usage vs axum QueryRejection) and are NOT used for strict parity."
  - "Pitfall-1 guarded with an explicit !is_null() assert in addition to the equality check, so a future refactor that reverts handlers.rs to parent_id: None fails loudly."

patterns-established:
  - "Goal/view/link e2e tests cloned from task_propose_prints_json_item (CLI) and task_propose_and_items_use_same_service_path (API)."
  - "JSON-shape assertions (is_array / is_string on period_key/roots) prove D-01 JSON-only output without coupling to row content."

requirements-completed: [SURF-01, SURF-02]

# Metrics
duration: 9min
completed: 2026-06-26
---

# Phase 5 Plan 03: 페어드 CLI+API e2e 패리티 테스트 Summary

**Phase 5의 두 표면(CLI / HTTP API)이 동일한 TodoService 위에서 패리티임을 증명하는 페어드 e2e 테스트 8개 — goal-create 상태 패리티(proposed/agent, SC4), 세 뷰의 JSON 형태 패리티, task→goal 링크, 그리고 present-but-invalid 입력의 거부 패리티(exit 2 / HTTP 400, SC3) + Pitfall-1 non-null parent_id 회귀 가드.**

## Performance

- **Duration:** ~9 min
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- CLI e2e 4종 (`tests/e2e/cli.rs`): `goal_propose_prints_proposed_json`(goal이 proposed/agent로 시작 — SC4), `agenda_date_range_period_emit_json`(세 뷰 모두 JSON 출력 — D-01, period는 `period_key`+`roots` 객체), `update_parent_id_links_task_to_goal`(`update --parent-id`로 task→goal 링크, `parent_id`/`scheduled` 반영), `period_bad_horizon_exits_two`(present-but-invalid horizon → exit 2 — SC3 CLI 측).
- API e2e 4종 (`tests/e2e/api.rs`): `goal_propose_returns_proposed_item`(`POST /goals/propose` → 200 + proposed/agent, `active` 아님 — SC4 + CLI와 상태 패리티), `view_routes_return_json`(`GET /views/{agenda,date-range,period}` JSON 형태 패리티), `patch_item_parent_id_links_and_is_not_null`(`PATCH /items/:id`의 `parent_id`가 goal id이며 non-null — Pitfall-1 회귀 가드), `view_period_bad_horizon_returns_400`(present-but-invalid → 400 + `detail` — SC3 API 측, CLI exit 2와 쌍).
- 전체 스위트 green(문서화된 dotenv 실패 1건 제외): lib 2/2, unit 49/49, integration 62/62, e2e 37/38. clippy `-D warnings` + `cargo fmt --check` 모두 통과.

## Task Commits

각 태스크는 원자적으로 커밋되었습니다:

1. **Task 1: CLI e2e 패리티 테스트 (goal propose / views / link / bad-horizon)** - `3e66d05` (test)
2. **Task 2: API e2e 패리티 테스트 (goals/propose / views / parent_id / 400)** - `85589f4` (test)

## Files Created/Modified
- `todo-engine/tests/e2e/cli.rs` - 4개의 `#[test]` fn 추가(`goal_propose_prints_proposed_json`, `agenda_date_range_period_emit_json`, `update_parent_id_links_task_to_goal`, `period_bad_horizon_exits_two`). 각 테스트는 `TestHome::new()` + `init` 후 `Command::cargo_bin("todo-engine")`로 명령을 실행하고 stdout JSON을 `serde_json::from_slice`로 파싱.
- `todo-engine/tests/e2e/api.rs` - 4개의 `#[tokio::test]` fn 추가(`goal_propose_returns_proposed_item`, `view_routes_return_json`, `patch_item_parent_id_links_and_is_not_null`, `view_period_bad_horizon_returns_400`). 각 테스트는 tempdir의 `todo.sqlite` 위에 `router(&db_path)`를 만들고 기존 `json_request`/`empty_request`/`body_json` 헬퍼로 oneshot 요청.

## Decisions Made
- 상태/뷰 패리티는 두 파일에서 동일 서비스 경로에 대해 독립적으로 단언 — 기존 idiom과 일치하며 별도 교차-표면 비교 헬퍼를 만들지 않음(PATTERNS §8).
- 거부 패리티는 present-but-invalid horizon(`bogus`)에 한정(Pitfall 3): 양 표면 모두 `TodoError::Validation`을 거쳐 exit 2 / HTTP 400으로 매핑되어 거부가 비교 가능. 누락 파라미터 거부(clap usage vs axum `QueryRejection`)는 본문이 달라 엄격 패리티에 쓰지 않음.
- Pitfall-1은 동등성 단언에 더해 명시적 `!is_null()` 단언을 추가 — 향후 `handlers.rs`가 `parent_id: None`으로 되돌아가면 테스트가 즉시 실패.

## Deviations from Plan

None - 계획대로 정확히 실행됨. (`cargo fmt --check` 통과, 재포맷 불필요.)

## Issues Encountered
계획된 작업에는 이슈 없음. 전체 테스트 실행 시 `cli::init_loads_todo_engine_home_from_dotenv`(e2e) 1건이 실패하는데, 이는 STATE.md에 기록된 **사전 존재하는 deferred dotenv 실패**(Phase 04.1 Plan 03: "init resolves default home not .env TODO_ENGINE_HOME")로, 본 플랜의 변경(테스트 추가만)과 무관하며 범위 밖(out of scope)으로 남겨둠. cargo의 e2e 바이너리가 이 실패로 조기 종료되어 unit/integration은 `--test unit --test integration`으로 별도 실행하여 green을 확인함.

## Known Stubs
None. 본 플랜은 테스트 함수만 추가하며 프로덕션 심볼을 만들지 않음. 빈 `agenda`/`period` 결과(`[]` / 빈 `roots`)는 비어 있는 저장소를 반영하는 것이지 스텁이 아님.

## Threat Surface
새 런타임 표면 없음 — 모든 변경은 05-01/05-02에서 추가된 기존 표면에 대한 테스트 단언일 뿐. 플랜의 `<threat_model>`(T-05-TEST-01..03 mitigate, T-05-TEST-SC accept) 그대로 충족: 승인 게이팅 비우회(SC4), 입력 검증 패리티(SC3), Pitfall-1 non-null `parent_id` 회귀가 자동화 테스트로 잠김. 새 패키지 설치 없음(모든 dev-dependency는 기존 e2e 파일에서 이미 사용 중). No threat flags.

## User Setup Required
None - 외부 서비스 구성이나 새 의존성 설치가 필요하지 않음.

## Next Phase Readiness
- Phase 5 (cli-api-surface-parity-locked)의 마지막 플랜 — 세 플랜(CLI 표면 / API 표면 / 페어드 e2e)이 모두 완료되어 SURF-01/SURF-02가 단언이 아닌 증명으로 닫힘.
- `/gsd-verify-work` 게이트 준비 완료: full `cargo test` green(문서화된 dotenv 실패 제외) + clippy + fmt clean.

## Self-Check: PASSED

- Modified files present: `todo-engine/tests/e2e/cli.rs`, `todo-engine/tests/e2e/api.rs` (둘 다 존재, 컴파일 + 신규 테스트 통과).
- Commits present: `3e66d05`(CLI), `85589f4`(API).
- New tests pass: CLI 4/4, API 4/4; 유일한 실패는 문서화된 deferred dotenv 테스트.

---
*Phase: 05-cli-api-surface-parity-locked*
*Completed: 2026-06-26*
