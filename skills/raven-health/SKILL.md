---
name: raven-health
description: "Raven Health Journal의 식사, 배변, 약 복용, 체중·수면·검사·컨디션 일일 지표를 검색·기록·수정하고 보고서나 보관 기록을 조회할 때 사용한다. 일반 의학적 판단이나 Raven 소스 개발에는 사용하지 않는다."
---

# Raven Health Journal 작업

먼저 [공통 실행·검색·재시도 규칙](../raven-cli/SKILL.md)을 읽는다.
명령·단위·metric 식별값은 [CLI 참고서의 Health 부분](../raven-cli/references/cli-reference.ko.md)과 해당 명령의 help를 확인한다.

## 조회와 선택

- Diet/Bowel/Medication list의 `--from/--to`는 양 끝 날짜를 포함하는 고정 UTC+09:00 기준이다. 실제 시각이 불분명하면 사용자 기준을 확인하고 RFC 3339로 전달한다.
- 식사·약 단위 등 고정 선택은 실제 help, 필터 후보는 `health table lookups --scope <scope>`에서 확인한다. 단위를 임의로 바꾸거나 추측하지 않는다.
- 복합 검색·정렬·그룹은 `health table query`를 사용한다. scope는 health.diet/bowel/medication/metrics다.
- `health.metrics`는 UI의 일일 metric 테이블이다. `metric list/show`는 개별 과거 레코드다. 일일 행의 날짜나 그룹 key를 event ID로 취급하지 않고 실제 구성 metric의 ID·updated_at을 사용한다.
- Health 목록에는 `--include-archived`가 없다. 알고 있는 보관 ID는 해당 diet/bowel/medication/metric show로 읽는다. 감사 명령은 `health audit`이며 `health history`는 없다.

## 기록과 수정

- 식사·배변·약 기록은 해당 add/update를 사용한다. JSON과 개별 필드 옵션을 섞지 않는다. 변경 전에 현재 레코드를 읽고 유지할 값과 updated_at을 확인한다.
- 일일 metric은 `health metric daily-upsert --json <array>`만 사용한다. 일반 `metric add`는 없다. 지원되는 정규 지표는 체중, 수면, CRP, 분변 칼프로텍틴, 전반적 컨디션이다.
- `daily-upsert --help`에서 category/key/name/unit을 확인한다. 컨디션은 category=overall_condition, 정수 1..10이고 condition_note만 지원한다. 조회용 category=symptom과 입력 category를 혼동하지 않는다.
- UTC+09:00 날짜 기준으로 기존 일일 값이 있는지 먼저 조회한다. 교체에는 해당 기존 레코드의 `expected_updated_at`을 입력 JSON에 포함한다. 다른 종류의 일일 지표를 원본 값 없이 임의로 추가하지 않는다.
- 기본값이 문서화된 식별 필드 외에는 측정값·시간·단위·메모를 만들어 넣지 않는다. CRP와 calprotectin은 help의 정규 key·단위를 따른다.
- Diet 사진은 사용자가 지정한 로컬 파일을 사용하며 허용 형식·크기를 help/참고서로 확인한다. JSON image 변경과 remove_image를 혼동하지 않는다. 불필요하게 이미지 바이트를 출력하지 않는다.
- 보관·복구는 지원되는 archive/restore와 현재 updated_at을 사용한다. Health purge는 없다. 보고서 요청 때문에 레코드를 변경하지 않는다.

Daily upsert 응답·개별 레코드를 다시 확인해 날짜·metric·값·버전을 검증한다.
여러 지표의 변경이 실패하거나 committed 결과가 불확실하면 공통 재시도 규칙을 따르고 중복 입력하지 않는다.
