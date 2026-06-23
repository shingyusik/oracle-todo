# Phase 3: Date View - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-23
**Phase:** 3-Date View
**Areas discussed:** 반환 구조, scheduled+due 결합, 상태·연체·센티널, 버킷 내 정렬

---

## 반환 구조 (Return shape)

| Option | Description | Selected |
|--------|-------------|----------|
| 전용 DateView 타입 | 날짜별 버킷 + 명시적 unscheduled 버킷을 담는 구조화 타입. SC1/SC2를 service가 보장. Phase 4 PeriodView와 대칭. | |
| 평면 Vec<TodoItem> + 정렬만 | service는 정렬만, 그룹핑·unscheduled 구분은 어댑터. 단순. | ✓ |
| BTreeMap<Date,Vec> + unscheduled | 표준 컬렉션으로 구조화. | |

**User's choice:** 평면 Vec<TodoItem> + 정렬
**Notes:** 첫 질문에서 명확화 요청 → 선택지의 실제 의미(서비스가 그룹/unscheduled까지 끝낸 구조 vs 정렬만) 재설명 후 "평면 Vec + 정렬 ㄱㄱ". 파리티 가드(D-01a)를 CONTEXT에 기록: 평면 Vec이므로 결정적 정렬이 CLI/API 파리티 보증 수단(CORE-03).

---

## scheduled + due 결합

| Option | Description | Selected |
|--------|-------------|----------|
| 범위는 scheduled만 | 범위 뷰는 scheduled 기준만 그룹핑; due-스패닝은 단일 날짜 아젠다 전용. SC1/SC3 문구와 일치. | ✓ |
| 범위도 scheduled+due 합집합 | 범위 내 각 날짜에 scheduled OR due 포함. due-only 그룹 위치 모호. | |
| (due 포함 이유) 필드로 판별, 태그 없음 | TodoItem의 scheduled·due로 어댑터가 직접 판별. | ✓ |
| (due 포함 이유) metadata 태그 | scheduled/due/both 이유를 명시 부여. | |

**User's choice:** 범위는 scheduled만 + due 포함은 필드로 판별(태그 없음)
**Notes:** 단일 날짜 D 아젠다 = scheduled==D OR due==D 합집합(SC3 필수)은 기본 전제로 확정.

---

## 상태·연체·센티널

| Option | Description | Selected |
|--------|-------------|----------|
| (상태) 미완료(open)만 | Proposed/Approved/Active, hidden-by-default. 종결 제외. | ✓ |
| (상태) completed 포함 | 종결 태스크도 해당 날짜에 표시(히스토리). | |
| (연체) 정확 날짜만, 롤링 없음 | 각 태스크는 자기 scheduled 날짜에만. overdue를 오늘로 안 끌어옴. | ✓ |
| (연체) 오늘이면 overdue도 합침 | 기존 today 동작 보존. 정확-날짜 의미와 충돌. | |
| (센티널) 비-ISO는 unscheduled로 | ISO 파싱 성공만 날짜 버킷; None·'today'·잡값은 unscheduled. | ✓ |
| (센티널) 'today'는 기준일로 해석 | scheduled=='today'를 호출 기준일 버킷으로. 호출시각 의존. | |

**User's choice:** open만 + 정확 날짜만(롤링 없음) + 비-ISO는 unscheduled
**Notes:** 새 뷰는 순수(머티리얼라이즈 없음, SC4)·정확 날짜. 기존 today(어댑터, 머티리얼라이즈+롤링)와 별개. 드롭 금지(SC2) 일관 유지.

---

## 버킷 내 정렬

| Option | Description | Selected |
|--------|-------------|----------|
| created_at → id | 기존 list_items 기본 정렬 유지. 최소 변경, 결정성 충족. | ✓ |
| due → created_at → id | 마감 임박 우선. list와 정렬 규칙 불일치. | |
| 우선순위 도입 | priority 개념. 새 필드 필요, v1 과잉. | |

**User's choice:** created_at → id
**Notes:** 1차 정렬 = scheduled 날짜(asc, unscheduled 마지막), 동률 created_at→id.

---

## Claude's Discretion

- 메서드 개수/이름/시그니처(`agenda(date)` + `date_range(from,to)` 분리 vs 통합), 파라미터 `time::Date` vs `&str`(파싱 위치).
- 반환 타입 위치 / unscheduled를 같은 Vec 내 정렬 위치(끝)로 표현.
- 테스트 배치(unit vs integration; `goal_view.rs` idiom 따름).

## Deferred Ideas

- completed/종결 포함 히스토리 리뷰 뷰 — v1 제외.
- overdue 롤업(오늘 아젠다에 지난 미완료 합치기) — v1 제외, 추후 affordance.
- 기존 `today` CLI 재배선(순수 날짜뷰로 위임) — Phase 5(SURF) 소관.
- 우선순위(priority) 정렬 — 새 필드 필요, v1 제외.
