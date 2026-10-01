---
name: raven-cli
description: "Raven CLI 사용법, help와 선택값 확인, 도메인 공통 상세 검색·출력·오류·재시도 규칙이 필요할 때 사용한다. Raven 소스 개발이나 CLI와 무관한 일반 작업에는 사용하지 않는다."
---

# Raven CLI 공통 사용

이 스킬 묶음은 설치된 Raven의 사용자 데이터를 CLI로 조회·관리한다.
ToDo 작업은 `raven-todo`, 재무 기록은 `raven-ledger`, 건강 기록은 `raven-health`를 사용한다.
네 스킬 폴더는 같은 skills 디렉터리에 함께 보관한다. 저장소 경로를 전제로 하지 않는다.

## 실행 환경

- 사용자가 지정한 실행 파일 또는 PATH의 `raven`을 사용한다. 소스 저장소에서는 이미 검증된 `target/release/raven(.exe)`도 사용할 수 있다.
- `raven --version`과 필요한 하위 명령의 `--help`로 설치 버전의 실제 지원 범위를 확인한다. 문서와 다르면 실행 중인 CLI를 기준으로 한다. 없는 명령·옵션을 만들어 내지 않는다.
- 실행 파일이 없으면 위치를 확인한다. 설치·업데이트·빌드는 요청된 경우에만 한다.
- 데이터 홈은 사용자가 지정한 `--home`, `RAVEN_HOME`, CLI 기본 홈 순으로 결정한다. 다른 프로젝트에서 실행한다고 새 데이터 홈을 만들거나 기존 홈을 바꾸지 않는다. 여러 홈 중 대상이 불명확하면 먼저 확인한다.
- 기존 저장소가 없거나 읽을 수 없으면 오류를 보고한다. 조회 요청 때문에 `init`·import·migration을 실행하지 않는다. 새 홈 초기화는 요청 범위에 포함된 경우에만 한다.
- 전역 옵션은 도메인 앞에 둔다: `raven --home <home> --error-format json <domain> ...`. 쉘에 맞게 인수를 전달하고 stdout·stderr·종료 코드를 각각 수집한다.

## 선택값과 상세 검색

- 입력 구성 전에 해당 명령의 `--help`를 확인한다. 고정 enum과 변경 가능한 필드는 help를, 실제 관계·필터 후보는 `table lookups --scope <scope>`를 확인한다. 후보 이름만으로 ID를 추측하지 않는다.
- ToDo 현재 상태 선택은 `todo options --id <id>`의 `status_choices`와 `actions`를 확인한다. 단순 조회용 enum을 수정 가능한 값으로 취급하지 않는다.
- UI와 같은 상세 검색은 `<domain> table query --json <body>`를 사용한다. scope별 필터·연산자·값 형식·정렬·그룹 필드는 실행 중인 help와 [API 참고서](references/api-reference.md)의 해당 도메인 부분에서 확인한다.
- `filters`를 AND/OR로 결합하고, `sorts`는 우선순위 순서로 배열에 넣는다. `group_by`는 그룹 필드 하나다. 페이지 limit은 1..50, 필터 최대 50개, 정렬 최대 10개다. Ledger 정렬은 최소 한 개 필요하다.
- 테이블 결과는 `{items,next_offset}`, 일반 목록은 `{items,next}`다. 다음 offset만 바꾸고 필터·정렬·그룹·context를 유지한다. null이면 끝낸다. 그룹화로 같은 레코드가 여러 행에 나타날 수 있으므로 레코드 수를 셀 때 ID 기준으로 중복을 제거한다.
- 결과의 `record`와 ID를 사용해 필요한 상세 조회를 한다. 목록은 스냅샷이 아니므로 동시 변경이 있는 수집 결과도 ID로 중복을 제거한다.
- UI scope의 숨김 정책을 따른다. 보관 기록까지 필요한지는 도메인 스킬의 조회 방법을 사용한다. 검색 결과가 없다는 이유로 새 레코드를 생성하지 않는다.

## 변경과 재시도

- 변경은 사용자가 요청한 내용에 한정해 CLI로 수행한다. 구체적으로 요청한 작업에 같은 승인을 반복 요구하지 않는다. 단순 조회·분석 요청을 변경 승인으로 해석하지 않는다. 데이터베이스 직접 수정은 하지 않는다.
- 지원되는 ToDo·Health 수정에는 조회한 원래 `updated_at` 문자열을 `--expected-updated-at`으로 전달한다. 충돌하면 다시 조회해 조정하며 버전 조건을 제거해 강제로 재시도하지 않는다.
- 지원되는 생성 작업은 고정 `--request-key`와 정확히 같은 인수·순서로 재시도한다. Ledger 이체는 UUID v4 `--operation-key`를 사용한다. 조회·수정·생명주기·일일 metric upsert에는 request key를 붙이지 않는다.
- 오류는 stderr JSON의 `code,fields,committed,retryable`을 해석한다. `committed: true`는 반영된 결과·정리 상태를 확인하고 반복하지 않는다. null, timeout, outcome_unknown이면 저장된 결과를 확인하기 전 새 키로 재실행하지 않는다. 확인으로도 결과를 판별할 수 없으면 불확실성을 보고하고 중단한다.
- 성공 뒤 결과 ID·버전·관련 값으로 요청한 변경을 확인한다. 필요한 부분만 보고하며 토큰·세션 값이나 불필요한 개인정보 전체를 출력하지 않는다.

일반 작업 흐름은 [AI CLI 사용 가이드](references/ai-cli-usage.ko.md),
세부 명령·생명주기·재시도 지원 범위는 [CLI 참고서](references/cli-reference.ko.md)를 읽는다.
긴 참고서는 현재 작업의 도메인·검색·오류 부분만 읽는다.
