# Phase 4: Period View (goal-tree rollup) - Context

**Gathered:** 2026-06-25
**Status:** Ready for planning

<domain>
## Phase Boundary

사용자가 **`(horizon, period)`를 요청하면 그 기간의 루트 goal(들) + 그 자손 goal+task subtree를 구조화된 트리로** 볼 수 있게 한다 — Core Value의 재귀적·성능 민감한 나머지 절반. 뷰 로직은 `application/service/queries.rs`에 공유 `PeriodView` 타입으로 살고, single-load 후 in-memory walk로 트리를 조립한다(재귀 안에서 `list_items` 호출 금지). **구조만** — completion rollup 없음. 미스케줄(scheduled 없는) goal-내 task도 표면화한다(VIEW-04, 절대 드롭 금지).

**In scope (이 Phase):**
- `(horizon, period)` period-view service 메서드 + 공유 `PeriodView` 트리 타입 (`queries.rs`, CORE-03/SC4).
- 루트 goal(들) + 자손 goal + 연결 task를 구조화 트리로 (VIEW-03 / SC1, structure-only).
- 미스케줄 goal-내 task 표면화 — 절대 드롭 금지 (VIEW-04 / SC2).
- single-load → in-memory walk, visited set + depth cap 안전 종결 (SC3).
- **SQL pushdown 성능 경로** — `repo.rs`에 indexed 쿼리(가능성: recursive CTE)로 관련 working set만 로드 (사용자 결정, 아래 D-10). `--research-phase` 필수.
- 테스트 (service 트리 동작 + InMemory/Persistent 파리티 — 이번엔 자동 아님, D-11).

**Out of scope (다른 Phase 또는 v2):**
- CLI 서브커맨드 / HTTP 엔드포인트 노출 — Phase 5 (SURF-01/02). 이 Phase는 service 로직 + 타입만.
- **Completion / progress rollup, 완료율·카운트 집계** — v2 (ROLL-01). v1은 structure-only.
- Health / at-risk 파생 신호 — v2 (ROLL-02).
- Coverage 뷰(task 0개 goal 표면화) — v2 (COVER-01).
- 새 goal-specific status state, goal 종결의 자식 cascade — ADR-0006이 v1 NO-cascade로 LOCK.
- Date view (단일/범위) — Phase 3 완료 (VIEW-02/05).

</domain>

<decisions>
## Implementation Decisions

### 트리 구조 (PeriodView 타입 모양)
- **D-01:** `PeriodView` = **중첩 재귀 노드** 타입. 형태: `PeriodView { <period meta>, roots: Vec<GoalNode> }`, `GoalNode { goal: TodoItem, child_goals: Vec<GoalNode>, tasks: Vec<TodoItem> }`. 트리가 구조 그대로 드러나 JSON은 자연 중첩, Markdown은 depth 들여쓰기로 렌더. 두 어댑터가 직렬화할 **단일 공유 타입**(SC4/CORE-03) — 파리티는 이 공유 타입 자체가 보장(date view처럼 정렬에 의존 안 함).
- **D-01a:** `child_goals`와 `tasks`를 **별도 vec로 분리** → "goals 먼저, tasks 나중" 분리는 타입 레벨에서 자연히 성립. 어댑터는 두 vec를 순서대로 렌더.

### 기간 멤버십·자손 경계
- **D-02:** **루트 = `(horizon, period)` 정확 매칭 goal**. period 키는 Phase 1 `Horizon` anchor 정규화로 산출. Phase 2 GOAL-04가 동일 horizon끼리 nesting을 금지(strictly-coarser parent)하므로 매칭 goal들은 서로 형제 → **전부 루트**. 루트의 조상(coarser goal)으로는 올라가지 않는다.
- **D-03:** **자손은 parent_id 구조 subtree 전체** — 루트에서 `parent_id`로 내려가며 만나는 모든 하위 goal(더 finer horizon)과 연결 task를, **자손 자신의 period와 무관하게** 포함한다. 해석: 트리는 "그 기간 goal의 decomposition(계획)"을 보여준다(달력 교차가 아님). VIEW-04 미스케줄 task와 자연 일치(task는 parent_id로 끌려오지 scheduled로 거르지 않음).
- **D-03a (수용한 대가):** 부모가 **다른 기간**에 있는 finer goal은 그 부모의 기간 뷰에만 뜨고, 이 기간 뷰엔 안 뜬다. (예: 5월 month-goal의 자식 week-goal이 6월 주에 있어도 6월 month 뷰엔 안 나옴 — 5월 뷰에 나옴.) D-03의 의도된 결과로 수용.

### 미스케줄·정렬 표면화 (VIEW-04)
- **D-04:** 미스케줄(scheduled None/비-ISO) goal-내 task는 **`GoalNode.tasks`에 inline** — 별도 버킷 없음, 절대 드롭 금지(VIEW-04 / SC2). 중첩 타입(D-01)이라 그 vec에 자연히 포함.
- **D-05:** **node 내 task 정렬 = Phase 3 `sort_date_view` 재사용** (`scheduled` asc, unscheduled 마지막, 동률 `created_at` → `id`). 새 정렬 의미 도입 없음.
- **D-06:** **`child_goals` 정렬 = period anchor(`scheduled`) asc → `created_at` → `id`**. task와 같은 결정적 tie-break.
- **D-07:** task 표면화 시 status 필터는 planner 판단(Claude 재량). 후보: date view의 open-only allowlist(`OPEN_STATUSES` = Proposed/Approved/Active) 재사용 vs 트리는 구조 뷰라 종결 task도 포함. ADR-0006이 goal 종결의 cascade를 부정하므로 goal 자체의 가시성과 task 가시성을 분리해 다룰 것.

### 안전 종결 (cycle / orphan / depth)
- **D-08:** **무한루프 방지 = visited `HashSet` + depth cap**. depth cap은 Phase 2 `goal.rs`의 `MAX_GOAL_DEPTH = 64` 재사용(ancestor-walk visited 패턴도 거기 idiom 존재). SC3 LOCK.
- **D-09:** **이상 신호는 남기되 최소화하고, 뷰는 절대 실패(throw/`Err`)시키지 않는다.** structure-only 뷰는 레거시 데이터가 망가져도 결과를 돌려준다(never-lose-data 정신).
  - `PeriodView`에 **가벼운 플래그/카운터 하나** — 예: `truncated: bool` 또는 `anomaly_count: usize` (순환 back-edge 끊김 + depth-cap 도달 + orphan 발견 합산). 정확한 이름/형태는 planner 재량.
  - **노드별 복잡한 표식 ❌, 풍부한 에러 객체 ❌.** 어댑터는 **한 줄 요약**만 (예: Markdown `⚠ 2 nodes truncated (cycle/depth)`, JSON은 그 필드 그대로).

### 성능 접근 (사용자 결정 — 기본 추천을 오버라이드)
- **D-10:** **SQL pushdown을 이번 Phase에서 한다.** working set 로드를 기존 `list_items` 전체스캔 재사용이 아니라 `repo.rs`에 **indexed 쿼리**(필요한 goal/task만)로 수행 — CONCERNS.md의 in-memory full-table-scan 부채를 이 경로에서 해소. Phase 1이 깐 인덱스(`parent_id`, `scheduled`, `(type, horizon, scheduled)`)를 실제로 사용.
  - 전체 subtree를 한 번에 가져오려면 **recursive CTE**(SQLite `WITH RECURSIVE` 지원) 또는 하이브리드 로드(goal 계층은 메모리, leaf task만 pushdown)가 후보 — **researcher가 결정**. SC3 "single-load → in-memory walk, 재귀 안 list_items 금지"는 유지.
  - ⚠ **PROJECT.md는 스캔 부채를 "이번 milestone 범위 밖(요구가 강제 안 하면)"으로 명시** — 사용자가 이 Phase에 한해 명시적으로 끌어옴. planner는 scope를 period-view 로드 경로로 **한정**(엔진 전역 list_items 리라이트로 번지지 않게).
- **D-11:** **CLI/API 파리티가 더 이상 자동이 아니다 — 명시적으로 보장·테스트해야 한다.** Persistent store는 새 SQL 경로로, InMemory store는 SQL 없어 **Rust로 동등한 필터·순회를 따로 구현** → 두 구현이 동일 결과를 내는지 `parity_in_memory_vs_persistent` idiom(Phase 3 `date_view.rs`)으로 명시 테스트. Phase 3가 `list_items` 합성으로 공짜로 얻던 파리티를 D-10이 깨므로 이 테스트는 필수.

### Claude's Discretion
- `PeriodView` / `GoalNode` 정확한 필드명·period meta 모양(요청 horizon·period 키 보관 방식), `truncated` vs `anomaly_count` 등 신호 필드 형태 (D-09).
- task status 필터 정책 (D-07) — open-only 재사용 vs 종결 포함.
- 메서드 시그니처(`period_view(horizon, period)` 파라미터 타입: `Horizon`+`Date` vs `&str` 내부 파싱), 반환 위치.
- SQL pushdown 구체 형태 — recursive CTE vs 하이브리드 로드, 인덱스 사용 전략 (D-10, **researcher 핵심 과제**).
- 테스트 배치(unit vs integration); persistent + parity는 `goal_view.rs`/`date_view.rs` idiom 따를 것.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` § "Phase 4: Period View (goal-tree rollup)" — Goal, Depends-on(Phase 3), 4개 Success Criteria(구조 트리·structure-only / 미스케줄 표면화 / load-once-walk-in-memory + visited-set·depth-cap / `queries.rs` 단일 `PeriodView`), **Research 플래그**(성능 연구 권장).
- `.planning/REQUIREMENTS.md` — **VIEW-03**(period 뷰: `(horizon,period)` 루트 + 자손 goal+task subtree, structure-only), **VIEW-04**(goal-내 미스케줄 task 표면화), **CORE-03**(뷰 로직 application/service 레이어 — CLI/API 파리티). v2 제외: **ROLL-01/02**(progress·health rollup), **COVER-01**(coverage).
- `.planning/PROJECT.md` § "Constraints" + § "Out of Scope" — 기간 정체성 `(horizon, scheduled)`, additive 스키마, 모든 mutation은 `TodoService` 단일 경로, **스캔 부채는 기본적으로 이 milestone 밖**(D-10이 이 Phase 한정 오버라이드).

### Data model & locked invariants
- `README.md` — 권위 데이터 모델: item types, `### Goal` 서브섹션, `items` 컬럼(`parent_id`, `scheduled`, `due`, `horizon`, `status`), status lifecycle. 트리 멤버십·정렬 정의 전 필독.
- `docs/architecture/decisions/adr-0006-goal-itemstatus-semantics.md` — **LOCKED:** Goal은 기존 `ItemStatus` lifecycle 재사용(새 state 없음); goal 종결(completed/dropped/cancelled)은 user-driven terminal이며 **자식 goal·연결 task로 cascade 안 함(v1)**. Phase 4 rollup은 이 의미를 **재논의 금지**.
- `docs/architecture/layers.md` — per-file 레이어 분해 + `pub(super)` 가시성 컨벤션(뷰 로직은 순수 application/service).
- `.planning/codebase/ARCHITECTURE.md` — Read/Query 경로(`list_items` → `apply_list_filter`), 클린/헥사고날 inward 의존, service 우회 금지 anti-pattern.
- `.planning/codebase/CONCERNS.md` — **in-memory full-table-scan 부채**(D-10이 period-view 경로에서 해소 대상); busy_timeout/WAL 부재(이번 비목표).

### Existing code this phase extends
- `todo-engine/src/application/service/queries.rs` — period-view 메서드 + `PeriodView` 타입이 들어갈 파일(SC4). **재사용:** `sort_date_view`(D-05), `iso_day`(미스케줄 판별), `open_tasks`/`OPEN_STATUSES`(D-07 후보), `get`/`list_items`.
- `todo-engine/src/application/service/goal.rs` — **`MAX_GOAL_DEPTH = 64`(:11)** + visited `HashSet` ancestor-walk idiom(:92) — D-08 traversal guard 재사용 원천.
- `todo-engine/src/application/ports.rs` — `ListFilter`(`horizon`/`parent_id`/`scheduled` 술어, Phase 2) + `apply_list_filter` + hidden-by-default. InMemory 필터 구현 재료(D-11).
- `todo-engine/src/infrastructure/sqlite/repo.rs` — `list_items` 전체스캔(`:29`). **D-10 SQL pushdown 타깃**(indexed WHERE / recursive CTE 추가).
- `todo-engine/src/infrastructure/sqlite/schema.rs` — Phase 1 추가 인덱스(`parent_id`, `scheduled`, `(type, horizon, scheduled)`). D-10이 실제 사용.
- `todo-engine/src/domain/` — Phase 1 `Horizon` anchor 정규화 + `is_coarser_than`(period 키 산출, D-02), `recurrence.rs` ISO `time::Date` 파싱·비교.
- `todo-engine/tests/integration/goal_view.rs` + `tests/integration/date_view.rs` — persistent-store + **`parity_in_memory_vs_persistent`** idiom (D-11 파리티 테스트가 따라갈 패턴).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`sort_date_view`** (`queries.rs:113`): `scheduled` asc / unscheduled last / `created_at`→`id`. node 내 task 정렬에 그대로(D-05).
- **`iso_day`** (`queries.rs:106`): leading-10-char ISO 파싱, None/sentinel/junk → None. 미스케줄 판별(D-04).
- **`open_tasks` / `OPEN_STATUSES`** (`queries.rs:10,89`): open-only allowlist. D-07 task status 필터 후보.
- **`MAX_GOAL_DEPTH` + visited HashSet walk** (`goal.rs:11,92`): depth cap·cycle guard idiom 재사용(D-08).
- **`ListFilter` horizon/parent_id/scheduled 술어 + `apply_list_filter`** (`ports.rs`): InMemory 동등 필터 구현 재료(D-11).
- **Phase 1 `Horizon` anchor + 인덱스**: period 키 산출(D-02) + SQL pushdown 인덱스(D-10).

### Established Patterns
- **순수 query는 `queries.rs`에, mutation과 분리.** period view도 side-effect-free read(머티리얼라이즈 호출 금지).
- **단일 공유 뷰 타입을 양 어댑터가 직렬화 = CORE-03 파리티.** D-01 중첩 타입이 그 보장체.
- **`parity_in_memory_vs_persistent`** (`date_view.rs`, `goal_view.rs`): seed 하나를 두 store에 통과시켜 stable key로 비교. D-11 필수 패턴.
- **store 분기 주의:** Phase 3는 `list_items` 합성으로 파리티 무료였으나, **D-10이 Persistent를 SQL 경로로 갈라 InMemory와 분리** → 파리티가 명시 책임이 됨(D-11).

### Integration Points
- period-view 메서드 → `queries.rs`(`TodoService`) → (Persistent) `repo.rs` 새 SQL / (InMemory) Rust 필터 → 트리 조립.
- Phase 5(SURF)가 CLI/API에서 이 메서드 호출 + `PeriodView` 직렬화(Markdown/JSON).
- D-10 SQL pushdown은 `repo.rs`·`schema.rs` 인덱스를 건드림 — scope를 period-view 로드 경로로 한정(전역 list_items 리라이트 금지).

</code_context>

<specifics>
## Specific Ideas

- `PeriodView { roots: Vec<GoalNode> }`, `GoalNode { goal, child_goals: Vec<GoalNode>, tasks: Vec<TodoItem> }` — 중첩 재귀.
- 루트 = `(horizon, period)` 정확 매칭 goal(형제 전부 루트); 자손은 parent_id subtree 전체(자손 period 무관).
- 미스케줄 task = `GoalNode.tasks` inline(scheduled None), 드롭 금지; 정렬 `sort_date_view` 재사용.
- 안전: visited HashSet + `MAX_GOAL_DEPTH=64`; 이상은 가벼운 플래그(`truncated`/`anomaly_count`) + 어댑터 한 줄, **throw 안 함**.
- 성능: `repo.rs` SQL pushdown(recursive CTE 후보) + 인덱스 사용; InMemory 동등 필터 + 명시 파리티 테스트. `--research-phase` 필수.

</specifics>

<deferred>
## Deferred Ideas

- **Progress / completion rollup** (ROLL-01) — 완료율·카운트를 트리 위로 집계. v2. 이 Phase는 structure-only(SC1).
- **Health / at-risk 파생 신호** (ROLL-02) — rollup 의존. v2.
- **Coverage 뷰** (COVER-01) — 기간 내 task 0개 goal 표면화. v2/v1.x.
- **엔진 전역 list_items SQL 리라이트** — CONCERNS.md 부채 전면 해소. D-10은 period-view 로드 경로로 **한정**; 전역 리라이트는 별도 tech-debt 작업.
- **busy_timeout / WAL / connection pool / API auth** — CONCERNS.md 항목, 이 milestone 비목표.

None — discussion stayed within phase scope (위 항목은 명시적으로 v2/별도 작업으로 라우팅됨).

</deferred>

---

*Phase: 4-Period View (goal-tree rollup)*
*Context gathered: 2026-06-25*
