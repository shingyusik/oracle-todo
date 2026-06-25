# Phase 4: Period View (goal-tree rollup) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-25
**Phase:** 4-Period View (goal-tree rollup)
**Areas discussed:** 트리 구조, 기간 멤버십·자손 경계, 미스케줄·정렬 표면화, 안전 종결·성능 범위

---

## 트리 구조 (PeriodView 타입)

| Option | Description | Selected |
|--------|-------------|----------|
| 중첩 재귀 노드 | `PeriodView{roots: Vec<GoalNode>}`, `GoalNode{goal, child_goals, tasks}`. 트리가 구조 그대로 → JSON 자연 중첩, 공유 타입 자체가 파리티 보장. | ✓ |
| 평면 리스트+depth | `Vec<PeriodRow{item, depth, parent_id}>` pre-order. Phase 3 D-01 일관, 어댑터가 재구성. | |
| You decide | 직렬화·렌더 편의로 Claude 결정. | |

**User's choice:** 중첩 재귀 노드 (추천)
**Notes:** period view는 본질적으로 계층 데이터 → 중첩이 자연 표현. SC4 단일 공유 타입을 양 어댑터가 직렬화 → 파리티는 정렬 아닌 타입 자체로 보장.

---

## 기간 멤버십·자손 경계

| Option | Description | Selected |
|--------|-------------|----------|
| 구조 subtree 전체 | 루트=`(horizon,period)` 매칭; parent_id subtree 전체를 자손 period 무관하게 포함. VIEW-04와 자연 일치. 대가: 부모가 다른 달인 week goal은 그 달 뷰에만. | ✓ |
| period 교차 필터 | 자손도 자신의 period가 요청 period에 포함될 때만. '달력 교차'. task는 horizon 없어 처리 애매 → VIEW-04 드롭 위험. | |
| You decide | researcher/planner 결정. | |

**User's choice:** 구조 subtree 전체 (추천)
**Notes:** 트리는 'goal의 decomposition(계획)'을 보여줌. Phase 2 GOAL-04(동일 horizon nesting 금지)로 매칭 goal은 형제 → 전부 루트.

---

## 미스케줄·정렬 표면화 (VIEW-04)

| Option | Description | Selected |
|--------|-------------|----------|
| D-08 재사용 + 인라인 | 미스케줄 task = `GoalNode.tasks` inline(드롭 금지). task 정렬=`sort_date_view`, child_goals=anchor asc→created_at→id. goals/tasks 분리 vec. | ✓ |
| goal별 명시 버킷 | `scheduled_tasks` + `unscheduled_tasks` 두 필드로 분리. 구조적으로 명시하나 필드·직렬화 복잡↑. | |
| You decide | 정렬 세부 Claude 재량, 미스케줄 inline·드롭 금지는 확정. | |

**User's choice:** D-08 재사용 + 인라인 (추천)
**Notes:** 중첩 타입(GoalNode.tasks)이라 미스케줄이 자연히 그 vec에 포함 → 별도 버킷 불필요.

---

## 안전 종결·성능 범위 (질문 1 — 성능)

| Option | Description | Selected |
|--------|-------------|----------|
| 기존 방식 그대로 (list_items 재사용) | list_items 1회 호출(전체스캔) → 메모리 트리. Phase 3 일관, 파리티 자동, 스캔 부채 이월. research 불필요. (기본 추천) | |
| 이번에 성능까지 (SQL pushdown) | `repo.rs`에 indexed SQL(필요 goal/task만), 인덱스 사용. 코드 복잡↑, `--research-phase` 필요, 범위 커짐. | ✓ |

**User's choice:** 이번에 성능까지 (추천 오버라이드)
**Notes:** 사용자가 STATE.md 성능 플래그를 명시적으로 끌어옴. 결과 고지: CLI/API 파리티가 더 이상 자동이 아님(InMemory는 Rust 동등 필터 별도 구현 → 명시 파리티 테스트 필요); 전체 subtree 한 쿼리엔 recursive CTE 후보 → researcher 핵심 과제; `--research-phase` 필수. scope를 period-view 로드 경로로 한정(전역 list_items 리라이트 금지).

---

## 안전 종결·성능 범위 (질문 2 — 망가진 데이터 표면화)

| Option | Description | Selected |
|--------|-------------|----------|
| 조용히 안전 종결 | 순환 한 번만·재방문 안 함, depth cap 도달 시 멈춤, 표시·에러 없음. 방어용. | |
| 잘림 표시 노출 | truncated 플래그/노드 표식으로 '여기 순환·잘림' 노출. 방어적이나 복잡↑. | |
| You decide | Claude 재량, 무한루프 안전 종결은 확정. | |
| **Other (free text)** | "에러는 표시하되 최대한 단순하게" | ✓ |

**User's choice:** Other — "에러는 표시하되 최대한 단순하게"
**Notes:** 반영 후 확인("ㅇㅇ"): 망가진 데이터를 조용히 버리지 않고 **가벼운 플래그/카운터 하나**(`truncated`/`anomaly_count`)만 남기고 어댑터는 한 줄 요약. 노드별 복잡 표식·풍부 에러 객체 ❌. 핵심 확인: **뷰는 throw/`Err` 안 함** — structure-only 뷰는 레거시 데이터 망가져도 결과를 돌려줌(never-lose-data). visited HashSet + `MAX_GOAL_DEPTH=64`는 확정(SC3).

---

## Claude's Discretion

- `PeriodView`/`GoalNode` 정확 필드명·period meta 모양, 이상 신호 필드 형태(`truncated` vs `anomaly_count`).
- task status 필터 정책(open-only 재사용 vs 종결 포함).
- 메서드 시그니처·파라미터 타입, 반환 위치.
- SQL pushdown 구체 형태(recursive CTE vs 하이브리드 로드, 인덱스 전략) — researcher 핵심 과제.
- 테스트 배치(unit vs integration); persistent+parity는 goal_view.rs/date_view.rs idiom.

## Deferred Ideas

- Progress/completion rollup (ROLL-01) — v2.
- Health/at-risk 파생 신호 (ROLL-02) — v2.
- Coverage 뷰 (COVER-01) — v2/v1.x.
- 엔진 전역 list_items SQL 리라이트 — D-10은 period-view 경로 한정; 전역은 별도 tech-debt.
- busy_timeout/WAL/connection pool/API auth — CONCERNS.md, 이 milestone 비목표.
