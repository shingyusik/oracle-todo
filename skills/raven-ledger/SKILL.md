---
name: raven-ledger
description: "Raven Ledger의 거래, 계좌, 분류, 통화, 이체, 잔액과 보고서를 조회하거나 기록·수정·보관·복구할 때 사용한다. 일반 금융 조언이나 Raven 소스 개발에는 사용하지 않는다."
---

# Raven Ledger 작업

먼저 [공통 실행·검색·재시도 규칙](../raven-cli/SKILL.md)을 읽는다.
명령·금액·생명주기는 [CLI 참고서의 Ledger 부분](../raven-cli/references/cli-reference.ko.md)을 확인한다.

## 조회와 후보

- 거래 검색은 `ledger entry list --format json`의 날짜·타입·계좌·분류·통화·내용 필터를 사용한다.
- 복합 검색·정렬·그룹은 `ledger table query`를 사용한다. scope는 `ledger.transactions`, `ledger.accounts`, `ledger.categories`이며 정렬 조건이 최소 한 개 필요하다.
- `ledger table lookups --scope <scope>`로 UI 필터의 ID·이름을 확인한다. 생성 대상 기준 데이터는 account/currency/category/account-category list로 조회하고 거래 타입에 맞는 분류를 선택한다.
- 기준 데이터 검색은 `--query`를 사용한다. `--include-inactive`는 복구·과거 확인용이며 비활성 항목을 새 거래의 활성 후보로 취급하지 않는다.
- 보관 거래는 `entry list --include-archived --format json`으로 검색하고 반환된 레코드를 확인한다. `entry show`는 보관되지 않은 거래만 조회한다.
- Reports·compare·balances·audit는 기존 레코드 읽기다. 조회·분석 요청 때문에 기준 데이터나 거래를 생성하지 않는다. `history`는 audit의 별칭이다.

## 기록과 변경

- 날짜는 YYYY-MM-DD, 입력 금액은 해당 통화 정밀도에 맞는 십진수다. 금액·통화·계좌를 추측하거나 임의로 반올림하지 않는다.
- 필요한 통화·계좌·분류가 없으면 확인한다. 기준 데이터 생성은 사용자 요청에 포함된 경우에만 한다.
- 직접 입력하는 entry 타입은 expense/income이다. 과거 transfer/adjustment가 조회된다고 같은 타입을 entry add/update로 설정하지 않는다.
- 이체는 `ledger transfer`로 양쪽을 원자적으로 생성한다. 정규 UUID v4 operation key를 같은 작업에 유지한다. entry 두 개로 이체를 흉내 내지 않는다.
- 이체 수정은 `transfer-update <group-id> --json <object>`를 사용한다. 이 입력은 전체 교체이며 notes를 생략하면 지워진다. `transfer-show <group-id> --format json`으로 현재 이체를 조회해 유지할 필드를 포함한다.
- 다른 add/create/update는 실제 help의 strict JSON 또는 개별 필드 옵션 중 하나를 사용하며 혼합하지 않는다. source·actor·written timestamp는 어댑터가 지정한다.
- 거래는 archive/restore, 기준 데이터는 active 플래그로 관리한다. Purge는 account-category만 지원한다. 삭제가 요청된 경우 preview의 영향과 confirmation ID를 확인하며, 보관 요청을 purge로 바꾸지 않는다.

변경 뒤 거래 또는 이체 쌍을 다시 읽어 계좌·통화·금액·타입·생명주기 결과를 확인한다.
기간 요약은 CLI 보고서를 사용하고 서로 다른 통화 금액을 그대로 합산하지 않는다.
