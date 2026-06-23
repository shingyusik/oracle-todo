# Phase 3: Date View - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning

<domain>
## Phase Boundary

사용자가 **특정 날짜 또는 날짜 범위에 무엇이 있는지** 볼 수 있게 한다 — Core Value의 더 단순한 "평면(flat)" 절반. 뷰 로직은 `application/service/queries.rs`에서 **순수하게(side-effect-free)** 계산되어, CLI와 API가 동일한 결과를 얻는다(파리티의 토대).

**In scope (이 Phase):**
- 단일 날짜 + 임의 `[from, to]` 범위 날짜뷰 service 메서드 (`queries.rs`).
- 단일 날짜 아젠다: `scheduled == D OR due == D` 합집합 (VIEW-05 / SC3).
- `scheduled` 없는(또는 비-ISO) 태스크를 명시적 unscheduled 버킷으로 — 절대 드롭 금지 (SC2).
- 결정적 정렬 (SC1).
- side-effect-free — 루틴 머티리얼라이즈 호출 금지 (SC4). InMemory/Persistent 양쪽에서 동일 결과.
- 테스트 (service 동작 + 양쪽 store 파리티).

**Out of scope (다른 Phase 또는 v2):**
- CLI 서브커맨드 / HTTP 엔드포인트 노출 — Phase 5 (SURF-01/02). 이 Phase는 service 로직만.
- Period / goal-tree 뷰 — Phase 4 (VIEW-03/04).
- 루틴 머티리얼라이즈, overdue 롤링("오늘"로 끌어오기) — 새 뷰는 정확-날짜·순수.
- completed/종결 태스크 히스토리 리뷰 — v1 제외.
- 우선순위(priority) 정렬, progress rollup — v1 제외.

</domain>

<decisions>
## Implementation Decisions

### 반환 구조 (Return shape)
- **D-01:** 날짜뷰 service 메서드는 **평면 `Vec<TodoItem>` + 결정적 정렬**을 반환한다. 날짜별 그룹핑·unscheduled 분리는 **어댑터(CLI/API)가 표시 단계에서** 수행한다. service는 "올바른 태스크 집합을 결정적 순서로" 돌려주는 데 집중한다 (전용 `DateView` 구조 타입 아님).
- **D-01a (파리티 가드):** 평면 Vec 선택이므로 **결정적 정렬이 곧 CLI/API 파리티의 보증 수단**이다(CORE-03). service가 정렬을 단일하게 고정하면 어댑터는 동일 입력을 받아 동일하게 렌더한다. 그룹핑 로직이 두 어댑터에 중복될 경우 동일성을 유지해야 한다(필요시 공유 순수 그룹핑 헬퍼 고려 — planner 판단).

### scheduled + due 결합
- **D-02:** **단일 날짜 D 아젠다** = `scheduled == D` **OR** `due == D` 합집합. 같은 태스크가 둘 다 해당해도 id 기준 1회만 (단일 날짜라 자연히 1회). (VIEW-05 / SC3)
- **D-03:** **범위 `[from, to]` 뷰**는 **`scheduled` 기준으로만** 포함/그룹핑한다. due-스패닝은 단일 날짜 아젠다에만 적용 (SC1=범위는 scheduled 그룹핑, SC3=단일 날짜는 scheduled+due 문구와 일치).
- **D-04:** due로 인해 포함된 태스크에 **별도 태그/표식을 부여하지 않는다.** `TodoItem`이 `scheduled`·`due`를 이미 들고 있어 어댑터가 직접 판별한다(평면 Vec 결정과 일관).

### 상태·연체·센티널
- **D-05:** **미완료(open) 상태만 노출** — `Proposed` / `Approved` / `Active`, 기존 hidden-by-default 규칙 따름. `completed` / `dropped` / `cancelled` 등 종결 상태는 제외 (기존 `today` 의미와 일치, v1 scope 타이트).
- **D-06:** **정확 날짜 버킷팅만, 롤링 없음.** 각 태스크는 자기 `scheduled` 날짜 버킷에만 나타난다. 지난 미완료(overdue)를 "오늘" 아젠다로 끌어오지 않는다 (결정성↑). 기존 `today`의 `scheduled <= today` 롤링은 레거시 어댑터 동작으로 분리.
- **D-07:** **비-ISO `scheduled` 값(None, 레거시 `"today"` 센티널, 파싱 불가 잡값)은 unscheduled 버킷으로** 떨어뜨린다. ISO 파싱 성공한 값만 날짜 버킷에 들어간다. **드롭 금지(SC2 정신).** 엔진은 strict ISO 방향으로 이동 중(Phase 1/2가 센티널 거부).

### 정렬 (deterministic ordering, SC1)
- **D-08:** 1차 정렬 = `scheduled` 날짜(오름차순), unscheduled는 마지막. 같은 날짜 버킷 내 동률 = **`created_at` → `id`** (기존 `list_items` 정렬 재사용). 새 정렬 의미 도입 없음 — 최소 변경, 결정성 충족, `list`와 일관.

### Claude's Discretion
- 정확한 메서드 개수/이름/시그니처 — 예: `agenda(date)` + `date_range(from, to)` 분리 vs 통합 메서드. 파라미터를 `time::Date`로 받을지 `&str`로 받고 내부 파싱할지(파싱 위치).
- 반환 타입을 어디에 둘지(평면 `Vec<TodoItem>` 그대로면 신규 타입 불필요) 및 unscheduled를 같은 Vec 내 정렬 위치(끝)로 표현할지.
- 테스트 배치(unit vs integration). 기존 `tests/integration/goal_view.rs`의 persistent-store idiom을 따를 것.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` § "Phase 3: Date View" — Goal, Depends-on(Phase 2), 4개 Success Criteria(단일/범위 그룹핑, unscheduled 버킷, scheduled+due 스패닝, `queries.rs` 순수성).
- `.planning/REQUIREMENTS.md` — **VIEW-02**(날짜뷰: 단일/범위 그룹핑 + unscheduled 버킷), **VIEW-05**(scheduled+due 아젠다), **CORE-03**(뷰 로직은 application/service 레이어 — CLI/API 파리티). 이 Phase에 매핑되는 요구.
- `.planning/PROJECT.md` § "Key Decisions" + § "Constraints" — 기간 정체성 `(horizon, scheduled)`, additive 스키마, 모든 mutation은 `TodoService` 단일 경로, 데이터홈 안전.

### Data model & architecture (locked invariants)
- `README.md` — 권위 있는 데이터 모델: item types, `items` 컬럼(`scheduled`, `due`, `status`), status lifecycle. 날짜뷰 필터 의미를 정의하기 전 필독.
- `docs/architecture/layers.md` — per-file 레이어 분해 + `pub(super)` 가시성 컨벤션(뷰 로직은 순수 application/service).
- `.planning/codebase/ARCHITECTURE.md` — Read/Query 경로(`list_items` → `apply_list_filter`), 클린/헥사고날 inward 의존 규칙, anti-pattern(service 우회 금지).
- `.planning/codebase/CONCERNS.md` — 기존 in-memory full-table-scan 부채(Phase 4 성능 연구 플래그). Phase 3는 cheap/flat이라 영향 적지만 인지.

### Existing code this phase extends
- `todo-engine/src/application/service/queries.rs` — 날짜뷰 메서드가 들어갈 파일(현재 `get`/`list_items`/`archive_items`). SC4: 여기 + side-effect-free.
- `todo-engine/src/application/ports.rs` — `ListFilter`(`scheduled`/`horizon`/`parent_id` 술어, Phase 2) + `apply_list_filter` + hidden-by-default 규칙. 날짜뷰가 조합할 읽기 프리미티브.
- `todo-engine/src/domain/status.rs` — `terminal_status`, `hidden_by_default_status`. open-only 상태 필터(D-05)에 사용.
- `todo-engine/src/domain/recurrence.rs` + Phase 1 `Horizon`/anchor 헬퍼 — ISO 날짜 파싱·비교 idiom(`time::Date`, `number_from_monday`).
- `todo-engine/src/interfaces/cli/markdown.rs`(`today_tasks`, `current_today_items`, `parse_scheduled_day`) — 기존 `today` 의미의 **참조 반례**: 어댑터-레벨, 머티리얼라이즈 + `scheduled <= today` 롤링 + scheduled만. 새 뷰가 무엇을 다르게 하는지 대비용.
- `todo-engine/src/application/service/materialization.rs`(`materialize_routines`) — 새 날짜뷰가 **호출하면 안 되는** 부수효과 경로(SC4).
- `todo-engine/tests/integration/goal_view.rs` — VIEW-01 persistent-store 테스트 idiom; 날짜뷰 테스트가 따라갈 패턴.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`list_items` + `apply_list_filter`** (`queries.rs:19`, `ports.rs`): 상태/타입/관계 필터 + hidden-by-default. 날짜뷰는 이 위에 날짜 필터링·정렬을 조립.
- **`ListFilter.scheduled` 술어** (Phase 2): `scheduled` 매칭 재료.
- **Phase 1 anchor/`Horizon` 헬퍼 + `recurrence.rs` 날짜 math**: ISO `time::Date` 파싱·비교. 날짜 버킷 키 산출에 재사용.
- **`terminal_status` / `hidden_by_default_status`** (`status.rs`): open-only 필터(D-05).
- **기존 list 정렬** (`queries.rs:23-28`, `created_at` → `id`): 버킷 내 동률 정렬 그대로 재사용(D-08).

### Established Patterns
- **순수 query는 service에, mutation과 분리** (`queries.rs` vs `creation.rs`/`transitions.rs`). 날짜뷰도 query → side-effect-free(SC4).
- **InMemory/Persistent 동일 결과** (SC4 "identical regardless of caller"): `list_items`가 이미 양쪽을 지원 → 그 위에 쌓으면 파리티가 거의 무료. SQLite persistent 경로 테스트는 `goal_view.rs` idiom.
- **어댑터는 thin 렌더**(Markdown/JSON): 데이터·정렬·집합은 service; 평면 Vec 결정상 그룹핑·unscheduled 표시는 어댑터(단, D-01a 파리티 가드).

### Integration Points
- 날짜뷰 메서드 → `queries.rs`(`TodoService`) → `list_items`/`apply_list_filter` → InMemory & SQLite 양쪽.
- Phase 5(SURF)가 CLI/API에서 이 메서드 호출; 기존 `today` 재배선 여부는 Phase 5 결정.
- Phase 4(Period View)도 `queries.rs`에 뷰 로직 추가 — 같은 파일/레이어 컨벤션.

</code_context>

<specifics>
## Specific Ideas

- 단일 날짜 D 아젠다 = `scheduled == D OR due == D` 합집합, id 기준 1회.
- 범위 `[from, to]` = `scheduled ∈ [from, to]` 그룹핑; due 무시.
- 비-ISO `scheduled`(None, `"today"`, 잡값) → unscheduled 버킷, 절대 드롭 금지.
- open 상태(`Proposed`/`Approved`/`Active`)만; 종결/숨김 제외.
- 정렬: `scheduled` asc(unscheduled 마지막), 동률 `created_at` → `id`. 평면 Vec라 정렬이 곧 결정성·파리티 보장.

</specifics>

<deferred>
## Deferred Ideas

- **completed/종결 포함 히스토리 리뷰 뷰** — 지난 날짜의 완료 내역 회고. v1 제외, 추후.
- **overdue 롤업** — "오늘" 아젠다에 지난 미완료를 합치는 affordance. v1 제외; 별도 어젠다 기능 또는 Phase 5 어댑터 옵션으로 재고 가능.
- **기존 `today` CLI 재배선** — 머티리얼라이즈/롤링 제거하고 순수 날짜뷰 service에 위임. **Phase 5(SURF) 소관** — 이 Phase는 service 로직만 추가.
- **우선순위(priority) 정렬** — 새 필드 필요, 현 모델에 없음. v1 과잉, 제외.

None — discussion stayed within phase scope (위 항목은 명시적으로 다른 Phase/v2로 라우팅됨).

</deferred>

---

*Phase: 3-Date View*
*Context gathered: 2026-06-23*
