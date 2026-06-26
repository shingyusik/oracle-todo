---
phase: 05-cli-api-surface-parity-locked
verified: 2026-06-26T03:05:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
---

# Phase 5: CLI + API Surface (parity-locked) 검증 보고서

**Phase Goal:** 계획 레이어 전체를 CLI와 HTTP API 양쪽에서 사용할 수 있게 하고, 두 표면이 동일한 서비스 메서드를 호출하며 정책을 재구현하지 않으므로 증명 가능한 패리티를 갖춘다. (Goal/link/view 명령 + 동일 서비스 메서드 위의 미러링된 HTTP 엔드포인트)
**Verified:** 2026-06-26T03:05:00Z
**Status:** passed
**Re-verification:** No — 최초 검증

## Goal Achievement

검증은 ROADMAP Phase 5의 4개 Success Criteria(계약)를 기준으로 수행했으며, 세 PLAN의 must_haves truths를 코드베이스 실증으로 교차 확인했다. SUMMARY 주장에 의존하지 않고 실제 소스 파일과 e2e 테스트를 직접 읽고, 8개 패리티 테스트를 본 검증 프로세스에서 직접 실행했다.

### Observable Truths

| # | Truth (ROADMAP SC) | Status | Evidence |
| --- | --- | --- | --- |
| 1 | SC1: CLI에서 goal 생성·task 링크·모든 뷰(date/week/month/year) 실행, 신규 뷰는 JSON 출력 | ✓ VERIFIED | `cli/mod.rs`: `Command::Goal{GoalCommand::Propose}`(:55,:121), 플랫 `Agenda`/`DateRange`(`#[command(name="date-range")]`)/`Period`(:100-105), `UpdateArgs.parent_id`(`--parent-id`, :317). dispatch(:375-404) + `command_label`(:440-469) 양쪽 exhaustive match에 모두 배선. `cli/views.rs::agenda`/`date_range`/`period`(:67-87) 모두 `print_json` 사용, `render_items` 미사용(D-01). `cli/create.rs::goal_propose`(:47-59) → `service.propose_goal`. CLI 테스트 4종 통과. |
| 2 | SC2: HTTP API가 동일 작업의 미러 엔드포인트를 노출, 동일 `TodoService` 메서드 호출 (핸들러에 정책/뷰 로직 없음) | ✓ VERIFIED | `api/mod.rs` Router: `POST /goals/propose`(:34), `GET /views/agenda`(:41)·`/views/date-range`(:42)·`/views/period`(:43), `PATCH /items/:id`(:44). `api/handlers.rs`: `propose_goal`(:94)·`view_agenda`(:211)·`view_date_range`(:218)·`view_period`(:227) 모두 `with_service`로 단일 서비스 메서드 호출 후 직렬화만 수행. `api/dto.rs`: `GoalProposeBody`(:35)·`AgendaQuery`(:97)·`DateRangeQuery`(:102)·`PeriodQuery`(:108). API 테스트 4종 통과. |
| 3 | SC3: 모든 신규 명령/엔드포인트에 페어드 e2e CLI+API 테스트 — 동일 item 상태 + 동일 거부 | ✓ VERIFIED | CLI 4종(`cli.rs:694,724,797,867`) + API 4종(`api.rs:576,599,643,686`) 존재·실증 단언. 상태 패리티: goal-create가 양쪽에서 `proposed`/`agent`. 거부 패리티: bad horizon → CLI exit 2(`period_bad_horizon_exits_two`, `.code(2)`) / HTTP 400(`view_period_bad_horizon_returns_400`, `status()==400` + `detail`). Pitfall-1 회귀 가드: `patch_item_parent_id_links_and_is_not_null`이 `!is_null()` + 동등성 단언. 본 검증에서 8/8 통과 실행 확인. |
| 4 | SC4: 양쪽 표면에서 agent 생성 goal이 `Proposed`로 시작하고 승인 필요 (API에서 우회 불가) | ✓ VERIFIED | CLI: `GoalProposeArgs.actor` 기본값 `agent`(`default_value = "agent"`, mod.rs:211); 핸들러는 status 미설정. API: `parse_actor_or_default`(mod.rs:107-113, `unwrap_or(Actor::Agent)`); `propose_goal` 핸들러 status 미설정. 테스트: `goal_propose_prints_proposed_json`(`"status":"proposed"`,`"proposed_by":"agent"`) + `goal_propose_returns_proposed_item`(`status=="proposed"` + `assert_ne!(status,"active")`). |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `cli/mod.rs` | Goal 서브명령 + Agenda/DateRange/Period 플랫 변형 + `--parent-id` + dispatch/label 배선 | ✓ VERIFIED | 모든 변형 존재, 두 exhaustive match에 배선됨 |
| `cli/create.rs` | `goal_propose` → `service.propose_goal` | ✓ VERIFIED | :47-59, `ProposeGoal{..}` 구성 후 `print_json` |
| `cli/views.rs` | `agenda`/`date_range`/`period` → `print_json` | ✓ VERIFIED | :67-87, 셋 다 `print_json`; `period`만 `Horizon` 파싱 → `TodoError::Validation` |
| `cli/lifecycle.rs` | `update`가 `parent_id: args.parent_id` 전달 | ✓ VERIFIED | :80, 하드코딩 `None` 제거됨 |
| `api/mod.rs` | `/goals/propose` + `/views/*` 라우트 | ✓ VERIFIED | :34, :41-43 Router 체인에 등록 |
| `api/handlers.rs` | propose_goal + view_* 핸들러 + `update_item` parent_id 수정 | ✓ VERIFIED | :94,:211,:218,:227; `update_item` :261 `parent_id: body.parent_id` |
| `api/dto.rs` | GoalProposeBody + 쿼리 DTO + UpdateBody.parent_id | ✓ VERIFIED | :35,:97,:102,:108; `UpdateBody.parent_id` :88 |
| `tests/e2e/cli.rs` | CLI e2e 4종 | ✓ VERIFIED | :694,:724,:797,:867 — 실증 단언, 통과 |
| `tests/e2e/api.rs` | API e2e 4종 | ✓ VERIFIED | :576,:599,:643,:686 — 실증 단언, 통과 |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `cli/create.rs::goal_propose` | `service.propose_goal(ProposeGoal{..})` | 직접 서비스 호출, raw string 전달 | ✓ WIRED | create.rs:49 |
| `cli/views.rs::period` | `service.period_view(horizon, &args.period)` | `parse::<Horizon>().map_err(TodoError::Validation)?` | ✓ WIRED | views.rs:81-85 |
| `cli/lifecycle.rs::update` | `update_item(.., UpdateItem{parent_id: args.parent_id})` | 하드코딩 None 제거 | ✓ WIRED | lifecycle.rs:80 |
| `api/handlers.rs::propose_goal` | `service.propose_goal(..)` | `with_service`, actor from `parse_actor_or_default` | ✓ WIRED | handlers.rs:99-101 |
| `api/handlers.rs::view_period` | `service.period_view(horizon, &q.period)` | `parse::<Horizon>().map_err(TodoError::Validation)?` | ✓ WIRED | handlers.rs:231-237 |
| `api/handlers.rs::update_item` | `UpdateItem{parent_id: body.parent_id}` | handlers.rs:212(구) None 제거 | ✓ WIRED | handlers.rs:261 |

### Data-Flow Trace (Level 4)

뷰 핸들러는 서비스 read 메서드(`agenda`/`date_range`/`period_view`)의 반환을 그대로 직렬화하며, 빈 store에서 `[]`/빈 `roots`는 정상 빈 결과이지 스텁이 아니다(이전 Phase 2–4에서 검증된 read 경로). `update --parent-id`/`PATCH parent_id`는 `parent_id` 변수가 raw 입력 → `UpdateItem.parent_id` → `update_item` 감사 경로로 흐르며, Pitfall-1 회귀 테스트가 결과 `parent_id`가 non-null인지 실증 확인. HOLLOW/DISCONNECTED 없음.

| Artifact | Data Variable | Source | Produces Real Data | Status |
| --- | --- | --- | --- | --- |
| `update_item`(API) | `parent_id` | `body.parent_id` → `update_item` 감사 경로 | Yes (테스트가 non-null 단언) | ✓ FLOWING |
| `view_period` | `PeriodView` | `service.period_view` | Yes (`period_key`/`roots` 단언) | ✓ FLOWING |

### Behavioral Spot-Checks

본 검증 프로세스에서 직접 실행함 (executor 내러티브 미신뢰). Phase 5 고유 8개 패리티 테스트만 필터로 실행 — 문서화된 dotenv 실패와 무관.

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Phase 5 패리티 e2e 8종 | `cargo test --test e2e -- goal_propose_prints_proposed_json agenda_date_range_period_emit_json update_parent_id_links_task_to_goal period_bad_horizon_exits_two goal_propose_returns_proposed_item view_routes_return_json patch_item_parent_id_links_and_is_not_null view_period_bad_horizon_returns_400` | `8 passed; 0 failed` | ✓ PASS |

### Requirements Coverage

PLAN frontmatter의 모든 requirement ID를 REQUIREMENTS.md와 교차 확인. Phase 5에 매핑된 ID는 정확히 SURF-01/SURF-02/CORE-03이며 누락·고아(orphan) 없음.

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| SURF-01 | 05-01, 05-03 | goal 생성·task 링크·모든 뷰 CLI 서브명령 (JSON 출력) | ✓ SATISFIED | `goal propose`/`agenda`/`date-range`/`period`/`update --parent-id` 모두 구현·테스트됨 (D-01 JSON-only 준수) |
| SURF-02 | 05-02, 05-03 | 신규 CLI 표면을 미러링하는 HTTP 엔드포인트, `TodoService` 재사용 | ✓ SATISFIED | `POST /goals/propose`, `GET /views/{agenda,date-range,period}`, `PATCH /items/:id parent_id` 구현·테스트됨 |
| CORE-03 | 05-02 | 신규 date/period 뷰 로직은 서비스 레이어에 존재 (어댑터 아님) | ✓ SATISFIED | CLI/API 어댑터 모두 단일 서비스 메서드 호출 후 직렬화만 수행; 뷰 로직은 `application/service/queries.rs`에 잔존. `period`/`view_period`의 `Horizon` 파싱은 enum 시그니처 요구로 Validation에 매핑 — 정책 아님 |

### Anti-Patterns Found

수정 파일(`cli/{mod,create,views,lifecycle}.rs`, `api/{mod,handlers,dto}.rs`, `tests/e2e/{cli,api}.rs`)에 TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER 부채 마커 없음. grep 매치는 모두 `TodoError`/`TodoItem`/`TodoService` 식별자(부분문자열 "todo")로 거짓 양성. 빈 반환(`[]`/빈 `roots`)은 정상 빈 store 결과이지 스텁 아님.

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| (none) | — | — | — | 부채 마커/스텁 없음 |

### Human Verification Required

PLAN 파일에 `<verify><human-check>` 지연 항목 없음. 모든 Success Criteria가 자동화 e2e + 코드 실증으로 검증 가능하며, 본 검증에서 실제 실행으로 확인됨. 인간 검증 필요 항목 없음.

### Gaps Summary

갭 없음. ROADMAP Phase 5의 4개 Success Criteria가 모두 코드베이스 실증으로 충족되고, SURF-01/SURF-02/CORE-03이 모두 satisfied이며, Phase 5 고유 패리티 e2e 8종이 본 검증에서 직접 실행되어 8/8 통과했다.

**범위 외 사전 실패(가산하지 않음):** `cli::init_loads_todo_engine_home_from_dotenv` e2e 실패는 STATE.md에 Phase 3/4/04.1/5에 걸쳐 문서화된 deferred 항목(init이 .env `TODO_ENGINE_HOME` 대신 기본 home 해석)으로, init/dotenv 코드를 건드리지 않은 본 Phase의 변경과 무관하며 명시적으로 범위 밖이다. Phase 5 검증에 가산하지 않는다.

---

_Verified: 2026-06-26T03:05:00Z_
_Verifier: Claude (gsd-verifier)_
