# 원격 MCP

[English](mcp-reference.md)

`raven mcp`는 기본 `127.0.0.1:3003`의 `/mcp`에서 Streamable HTTP를 제공합니다.
UI의 도메인 작업을 프로세스 내부의 기존 API 라우터와 서비스로 처리합니다.
검증·생명주기·원자성·감사 기록 정책을 그대로 적용합니다. 별도 API 프로세스나
UI 세션 쿠키는 필요하지 않습니다. 키를 지정한 생성은 로컬 영수증을 저장합니다.

## 실행

새 데이터 홈은 `raven init`으로 초기화하고, 기존 홈은 `--home`으로 지정합니다.
아래 세 인증 설정은 모두 필요합니다.

| 옵션 | 환경 변수 | 값 |
| --- | --- | --- |
| `--port` | — | 루프백 포트 `1..65535`, 기본 `3003` |
| `--public-origin` | `RAVEN_MCP_PUBLIC_ORIGIN` | `/mcp`를 제외한 공개 HTTPS origin |
| `--access-issuer` | `RAVEN_MCP_ACCESS_ISSUER` | 끝 `/` 없는 `https://<team>.cloudflareaccess.com` |
| `--access-audience` | `RAVEN_MCP_ACCESS_AUDIENCE` | MCP용 Access 애플리케이션의 AUD |

```powershell
$env:RAVEN_MCP_PUBLIC_ORIGIN = 'https://mcp.example.com'
$env:RAVEN_MCP_ACCESS_ISSUER = 'https://your-team.cloudflareaccess.com'
$env:RAVEN_MCP_ACCESS_AUDIENCE = '<MCP application AUD>'
raven --home 'D:\RavenData' mcp
```

UI용 AUD와 MCP용 AUD를 구분합니다. 공개 origin은 `RAVEN_UI_PUBLIC_ORIGIN`과 같은
정규화 규칙을 따릅니다. 호스트는 소문자이며 인증 정보·경로·쿼리·fragment·명시적
기본 포트는 허용하지 않습니다. 잘못된 설정은 종료 코드 `2`, 시작 실패는 `1`을 반환하며
설정값이나 저장소 경로를 노출하지 않습니다. 시작할 때 서명 키 서버에 접근할 수 있어야 합니다.
조회 때문에 도메인 저장소를 생성하거나 마이그레이션하지 않습니다.

## Cloudflare Tunnel과 Access

1. 기존 Tunnel에 MCP 전용 공개 호스트를 추가하고 `http://127.0.0.1:3003`으로 연결합니다.
   공개 Host를 유지합니다. localhost로 덮어쓰지 않습니다.
2. 해당 호스트를 별도 Access 애플리케이션으로 보호합니다. 본인 계정 또는 선택한 서비스
   토큰만 허용하도록 정책을 제한합니다. 기존 UI 애플리케이션 설정은 유지합니다.
3. MCP 애플리케이션 AUD와 팀 issuer를 Raven 환경 변수에 설정합니다.
4. 사용할 MCP 클라이언트가 지원하는 인증 방식으로 외부 연결을 검증합니다.

로컬 ingress 설정은 마지막 catch-all 앞에 추가합니다.

```yaml
- hostname: mcp.example.com
  service: http://127.0.0.1:3003
  originRequest:
    access:
      required: true
      teamName: your-team
      audTag:
        - <MCP application AUD>
```

사용자 지정 HTTP 헤더를 지원하는 클라이언트는 Service Auth 정책과
`CF-Access-Client-Id`, `CF-Access-Client-Secret`을 사용할 수 있습니다. 자격 증명은
클라이언트의 비밀 설정에 보관하며 저장소에 넣지 않습니다. Cloudflare가 인증하고 Access JWT를
전달합니다. Raven이 이 원본 자격 증명을 자체 토큰으로 받는 것은 아닙니다.
[Cloudflare 서비스 토큰 문서](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)를 참고하세요.

대화형 OAuth가 필요한 클라이언트는 Cloudflare의 Managed OAuth 연동을 검토합니다.
이 연동에는 Access JWT를 검증하는 MCP 서버가 필요하며 Raven이 그 검증을 수행합니다.
인증 발견·로그인·도구 호출은 선택한 클라이언트와 Cloudflare 설정으로 실제 확인해야 합니다.
Raven 자체에는 OAuth 인증 서버나 discovery 엔드포인트가 없습니다.
[Cloudflare MCP 인증 문서](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/secure-mcp-servers/)를 참고하세요.

Access Bypass 정책을 사용하지 않습니다. UI 브라우저 로그인은 MCP 클라이언트의 인증 설정을
대신하지 않습니다. PC·Raven MCP 프로세스·Tunnel이 계속 실행되어 있어야 합니다.

## 전송과 인증

외부 URL은 `https://mcp.example.com/mcp`, 전송 방식은 Streamable HTTP입니다.
서버는 JSON 응답을 사용하며 기존 세션을 보관하지 않습니다. 구형 SSE 전용 `/sse`는
지원하지 않습니다. 초기화·도구 목록 조회·모든 도구 호출에 인증을 적용합니다.

`Cf-Access-Jwt-Assertion` 하나만 허용합니다. 설정한 issuer의 키로 RS256 서명을 확인하고
issuer·audience·만료·선택적 not-before를 검증합니다. 누락·중복·만료·위조·다른 앱의
assertion은 `401`입니다. 서명 키 캐시와 갱신 간격을 제한하며, 만료된 키를 갱신하지
못하면 접근을 거부합니다.

Host는 설정한 공개 authority와 같아야 하며 다르면 `421`입니다. Origin이 있으면 공개
origin과 정확히 같아야 하며 다르면 `403`입니다. 브라우저가 아닌 클라이언트는 Origin을
생략할 수 있습니다. `/api/v1`, `/healthz`, UI 파일이나 세션 발급 경로는 제공하지 않습니다.
인증 헤더와 쿠키는 MCP SDK에 전달하기 전에 제거합니다. 요청 크기는 최대 16 MiB입니다.

## AI 사용 순서

1. `tools/list`에서 설명과 엄격한 입력 스키마를 읽습니다.
2. `todo_options`로 타입·수정 필드·현재 항목에서 가능한 생명주기 동작을 확인합니다.
3. `<domain>_choices`에 scope를 지정합니다. `choices`와 해당 scope의 `query_schema`를
   반환합니다. 이름이나 ID를 추측하지 않고 반환된 후보에서 선택합니다.
4. `<domain>_search`로 기존 입력을 검색하고 `next_offset`이 null이 될 때까지 조회합니다.
5. 수정 전에 상세 항목을 읽고 필요한 곳에 `updated_at`을 `expected_updated_at`으로
   전달합니다. 충돌하면 재조회·조정합니다. 버전 조건을 제거하지 않습니다.

Dashboard, ToDo 타입별 생성·편집·생명주기·루틴 생성·이력, Ledger 기준 데이터·거래·이체·잔액·보고서·감사,
Health 식단·사진·배변·투약·일일 지표·보고서·복구·감사 도구를 제공합니다.
영구 삭제는 확인된 Ledger 계좌 분류 purge만 제공합니다.
임의 명령·SQL·로컬 파일 경로·원격 이미지 URL·일반 metric-add 도구는 제공하지 않습니다.

`todo_search` 입력 예:

```json
{
  "scope": "workspace.task",
  "filters": [{"field": "title", "operator": "contains", "value": {"text": "치과"}}],
  "sorts": [{"field": "scheduled", "direction": "asc"}],
  "group_by": "project",
  "limit": 50
}
```

필드·연산자·그룹은 해당 scope에서 유효해야 합니다. 상대 날짜는 `context.reference_date`,
planner는 `context.from`·`context.to`, linked는 `context.parent_type`·`context.parent_id`가 필요합니다.
그룹 설정 기본값은 알파벳순·그룹 표시입니다. 그룹 때문에 항목이 여러 행에 나오면 ID로 중복을 제거합니다.
Ledger 정렬을 생략하면 UI 기본값인 거래 날짜 내림차순·계좌 및 분류 이름 오름차순을 적용합니다.
명시적으로 빈 정렬 배열을 전달하면 Ledger가 거부합니다.

`todo_list`는 CLI 목록 필터·이력 타입·상태와 페이징을 제공합니다. `scope`는
`list`, `archive`, `today`이며 오늘 조회에는 사용자 로컬 `today`가 필요합니다.
`status=active`로 진행 중 항목을 선택하고 `next`를 다음 offset으로 사용합니다.
ToDo 생성의 `actor`와 루틴 생성·편집의 `future_occurrences`를 지원합니다.
`todo_routine_materialize`는 저장된 목표를 유지하도록 목표 인수를 생략할 수 있으며,
`todo_routines_materialize`는 서버 로컬 날짜로 모든 활성 루틴을 생성합니다.

`ledger_entry_list`는 날짜·타입·계정·분류·통화·내용·보관 필터를 지원합니다.
`ledger_entry_get(include_archived=true)`로 보관 거래를 읽습니다. 기준 데이터 목록의
`query`, `include_inactive`는 페이징 전에 적용됩니다. `ledger_doctor`는 읽기 전용 진단,
`ledger_export`는 파일 경로 없이 구조화된 스냅샷을 반환합니다. 양수 `max_records`,
`max_bytes`를 지정할 수 있으며 MCP 바이트 예산·응답은 최대 8 MiB입니다.
큰 내보내기는 CLI를 사용합니다. `include_archived=true` 내보내기는 복구 가능한 스냅샷입니다.

`health_event_list`는 `category`, `metric_key`, `daily_only`, `metrics_only`와 페이징을
지원합니다. `metrics_only=true`로 과거 lab/symptom 키를 포함한 지표 이력을 조회합니다.
`next_offset`이 null일 때까지 조회하며 마지막 빈 페이지가 있을 수 있습니다.
식단·배변·투약 목록 필터는 `health_search`로 조회하고 매체 감사는
`health_audit(record_type=media_file)`로 읽습니다. 과거 지표 상세·보관·복구는 이벤트 도구와
버전 가드를 사용합니다. 식단·이벤트 상세의 `include_archived=true`로 보관된 레코드의
버전도 조회할 수 있습니다.

## 변경·재시도·사진

일반 생성 도구는 선택적 `request_key`를 받습니다(ASCII 영문·숫자·`-_.:`, 1~128자).
같은 키·도구·입력으로 재시도하면 결과를 재사용합니다. 설정된 홈의 `retry.sqlite`에 CLI와
분리된 영수증을 저장하며 입력 원문·사진 대신 입력 해시와 결과를 보관합니다. 완료된 오류도
재사용하므로 알려진 실패 뒤 입력을 수정할 때는 새 키를 사용합니다. 다른 입력은
`request_key_conflict`입니다. 보류 영수증은 재실행하지 않고 `request_outcome_unknown`,
`committed: null`, `retryable: false`를 반환합니다. 중단된 생성은 조회로 확인한 후 새 키를
결정하고 재시도를 위해 영수증을 삭제하지 않습니다. `timeout_seconds`는 키가 필요하며
기본 120초, 1~3600초입니다. 타임아웃 뒤에도 서비스 쓰기가 완료될 수 있어 보류로 남습니다.
키 없는 생성은 기존 동작을 유지하며 응답 유실 뒤 먼저 검색합니다.
이체 생성은 안정적인 UUID `operation_key`가 필요하며 재시도에도 같은 키를 사용합니다.
오류의 `committed`·`retryable`을 확인합니다. 반영된 변경의 미디어 정리 실패를 롤백으로
해석하지 않습니다. 생명주기는 기존 서비스 정책을 따릅니다.

`health_daily_upsert`는 UI의 체중·수면·CRP·분변 칼프로텍틴·전반적 상태를 저장합니다.
`metrics`·`archives`를 원자적으로 처리하며 날짜는 UTC+09:00입니다. 기존 항목을 변경할 때
버전 타임스탬프를 전달합니다. 상태 점수는 `1..10`입니다.

`health_diet_image_create`·`health_diet_image_update`는 `metadata`·`content_type`·`image_base64`를
받습니다. 수정에는 `id`와 `metadata.expected_updated_at`도 필요합니다. PNG·JPEG·WebP만
허용하며 디코딩 후 최대 10 MiB입니다. ASCII 이스케이프한 메타데이터는 기존 API 제한에 따라
최대 8 KiB입니다. `health_diet_image_get`은 MCP 이미지 콘텐츠를 반환합니다.
사진 제거는 `health_diet_update`의 `remove_image: true`로 처리합니다.
Health 데이터베이스와 미디어는 함께 백업합니다.
