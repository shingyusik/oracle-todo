# 원격 MCP

[English](mcp-reference.md)

`raven mcp`는 기본 `127.0.0.1:3003`의 `/mcp`에서 Streamable HTTP를 제공합니다.
UI의 도메인 작업을 프로세스 내부의 기존 API 라우터와 서비스로 처리합니다.
검증·생명주기·원자성·감사 기록 정책을 그대로 적용합니다. 별도 API 프로세스나
UI 세션 쿠키는 필요하지 않습니다. 키를 지정한 생성은 로컬 영수증을 저장합니다.

## 실행

새 데이터 홈은 `raven init`으로 초기화하고, 기존 홈은 `--home`으로 지정합니다.
공개 origin·Access issuer·audience와 호출자를 하나 이상 등록한 호출자 허용 목록이
필요합니다([호출자와 scope](#호출자와-scope) 참고).

| 옵션 | 환경 변수 | 값 |
| --- | --- | --- |
| `--port` | — | 루프백 포트 `1..65535`, 기본 `3003` |
| `--public-origin` | `RAVEN_MCP_PUBLIC_ORIGIN` | `/mcp`를 제외한 공개 HTTPS origin |
| `--access-issuer` | `RAVEN_MCP_ACCESS_ISSUER` | 끝 `/` 없는 `https://<team>.cloudflareaccess.com` |
| `--access-audience` | `RAVEN_MCP_ACCESS_AUDIENCE` | MCP용 Access 애플리케이션의 AUD |
| `--gateway-client-id` | `RAVEN_MCP_GATEWAY_CLIENT_ID` | 게이트웨이 Access 서비스 토큰의 Client ID |
| `--gateway-public-key` | `RAVEN_MCP_GATEWAY_PUBLIC_KEY` | 게이트웨이 scope assertion용 Ed25519 공개 키, base64url(JWK `x`) |
| `--service-clients` | `RAVEN_MCP_SERVICE_CLIENTS` | 직접 연결 서비스 토큰: 공백으로 구분한 `<client-id>=<scope>[,<scope>...]` |

```powershell
$env:RAVEN_MCP_PUBLIC_ORIGIN = 'https://mcp.example.com'
$env:RAVEN_MCP_ACCESS_ISSUER = 'https://your-team.cloudflareaccess.com'
$env:RAVEN_MCP_ACCESS_AUDIENCE = '<MCP application AUD>'
$env:RAVEN_MCP_GATEWAY_CLIENT_ID = '<gateway service token Client ID>'
$env:RAVEN_MCP_GATEWAY_PUBLIC_KEY = '<gateway public key x>'
raven --home 'D:\RavenData' mcp
```

UI용 AUD와 MCP용 AUD를 구분합니다. 공개 origin은 `RAVEN_UI_PUBLIC_ORIGIN`과 같은
정규화 규칙을 따릅니다. 호스트는 소문자이며 인증 정보·경로·쿼리·fragment·명시적
기본 포트는 허용하지 않습니다. 잘못된 설정은 종료 코드 `2`, 시작 실패는 `1`을 반환하며
설정값이나 저장소 경로를 노출하지 않습니다. 호출자 허용 목록이 없거나 잘못되면
`raven mcp`는 시작하지 않습니다(종료 코드 `2`, 필드 `caller_allowlist`). 호출자 제한 없이
MCP를 제공하는 경우는 없습니다. 시작할 때 서명 키 서버에 접근할 수 있어야 합니다.
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
전달합니다. Raven이 이 원본 자격 증명을 자체 토큰으로 받는 것은 아닙니다. 이런 서비스
토큰은 `RAVEN_MCP_SERVICE_CLIENTS`에 scope와 함께 등록해야 합니다.
[Cloudflare 서비스 토큰 문서](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)를 참고하세요.

Access Bypass 정책을 사용하지 않습니다. UI 브라우저 로그인은 MCP 클라이언트의 인증 설정을
대신하지 않습니다. PC·Raven MCP 프로세스·Tunnel이 계속 실행되어 있어야 합니다.

## OAuth 게이트웨이와 클라이언트

Raven 자체에는 OAuth 인증 서버나 discovery 엔드포인트가 없습니다. 대화형 OAuth 클라이언트는
이 저장소 밖에서 별도로 배포한 Cloudflare Worker `raven-mcp-gateway`를 거쳐 연결합니다.
게이트웨이는 자체 공개 origin에서 discovery·동의·인가·토큰 엔드포인트를 제공하고, 자체
Service Auth 토큰과 서명된 scope assertion을 붙여 Access가 보호하는 원본에 MCP 요청을
전달합니다. 클라이언트에는 원본
URL이 아니라 게이트웨이 URL `https://<gateway-host>/mcp`를 입력합니다.

- 클라이언트 등록: Client ID Metadata Document(CIMD)만 지원하며 동적 등록은 지원하지 않습니다.
- 신원 확인: 새 인가마다 소유자 전용 Cloudflare Access One-time PIN 로그인을 거칩니다.
- 인가: PKCE `S256`, 등록된 콜백과의 정확한 일치, 도메인별 읽기·쓰기 scope를 요구합니다.
- 유효 기간: 접근 토큰은 10분, 인가 grant는 인가 후 30일이며 토큰을 갱신해도 연장되지 않습니다.

| 클라이언트 | CIMD 클라이언트 ID | 토큰 엔드포인트 인증 | 콜백 |
| --- | --- | --- | --- |
| ChatGPT | `https://chatgpt.com/oauth/client.json` | ChatGPT 공개 키로 검증하는 `private_key_jwt` | 설정된 ChatGPT 콜백 |
| Claude 웹·Desktop·모바일 | `https://claude.ai/oauth/mcp-oauth-client-metadata` | `none`(공개 클라이언트, PKCE) | `https://claude.ai/api/mcp/auth_callback` |
| Claude Code | `https://claude.ai/oauth/claude-code-client-metadata` | `none`(공개 클라이언트, PKCE) | `http://localhost/callback` 또는 `http://127.0.0.1/callback`, 포트 무관 |
| Grok Bot·Grok 웹 커넥터·Cursor 에이전트 | `https://cursor.com/oauth/mcp-client.json` | `none`(공개 클라이언트, PKCE) | `https://www.cursor.com/agents/mcp/oauth/callback`, `https://www.cursor.com/bot/mcp/oauth/callback`, `https://grok.com/connectors-oauth-exchange-code/` |

게이트웨이는 다른 클라이언트 ID, 일치하지 않는 콜백, 인증 방식을 섞은 요청을 거부합니다.
공개 클라이언트는 갱신 토큰이 회전된 뒤 직전 토큰을 한 번만 더 사용할 수 있습니다. 루프백
콜백이면 동의 화면에 경고를 추가로 표시합니다. Claude와 Cursor 클라이언트 ID는 해당 제품의
모든 사용자가 함께 쓰므로, 직접 시작한 연결의 동의만 승인합니다. VS Code·Gemini CLI처럼 표에
없는 클라이언트는 사용자 지정 헤더를 지원하는 경우 앞의 Service Auth 헤더 방식을 사용합니다.

Claude Code 연결:

```bash
claude mcp add --transport http raven https://<gateway-host>/mcp
```

이후 `/mcp`에서 `raven` 인증을 진행합니다. Claude 웹이나 Desktop에서는 같은 URL로 사용자 지정
커넥터를 추가하고 OAuth 클라이언트 ID는 비워 둡니다. Grok Bot도 같은 URL로 연결하며,
동의 화면에는 클라이언트가 Cursor로 표시됩니다. 동의 화면에서 한 번만 승인하고
One-time PIN 로그인을 완료합니다. 동의를 다시 제출하면 `RAVEN-AUTH-02-BINDING-MISSING`이
표시되며, 이때는 연결을 처음부터 다시 시작합니다.

Cloudflare zone 보호 기능은 게이트웨이보다 먼저 적용됩니다. Browser Integrity Check, 봇 규칙,
AI 봇 정책이 클라이언트 업체의 서버 요청을 차단하면 discovery나 토큰 교환이 실패합니다.

## 호출자와 scope

Raven은 검증된 Access JWT의 `common_name` claim으로 호출자를 식별합니다. Cloudflare는 이
값에 서비스 토큰의 Client ID를 넣습니다. `common_name`이 없는 신원 로그인과 허용 목록에 없는
서비스 토큰은 `403`입니다. 서명되지 않은 헤더로는 권한을 얻을 수 없습니다.

| 호출자 | scope |
| --- | --- |
| `RAVEN_MCP_GATEWAY_CLIENT_ID` | 요청마다 유효한 `Raven-Scope-Assertion` 헤더 하나에서 읽음 |
| `RAVEN_MCP_SERVICE_CLIENTS`의 Client ID | 해당 Client ID에 설정한 고정 목록 |

게이트웨이 Client ID와 공개 키는 함께 설정합니다. 같은 Client ID를 게이트웨이와 직접 연결
클라이언트로 동시에 등록할 수 없습니다. scope는 `raven.{todo,ledger,health}.{read,write}`,
`raven.ledger.export`, `raven.ledger.purge`, `raven.health.media`입니다. 예:
`RAVEN_MCP_SERVICE_CLIENTS='abc.access=raven.todo.read,raven.todo.write def.access=raven.health.read'`.

`Raven-Scope-Assertion`은 게이트웨이가 Ed25519(`alg: EdDSA`)로 서명한 JWT입니다. Raven은
다음 claim을 요구합니다.

| Claim | 값 |
| --- | --- |
| `aud` | 정확히 `<public origin>/mcp` |
| `scope` | 게이트웨이 grant의 OAuth scope, 공백 구분 |
| `client_id` | grant의 OAuth 클라이언트 ID, 비어 있지 않음 |
| `iat`, `exp` | 발급·만료 시각, `exp - iat`는 최대 120초, 시계 오차 30초 허용 |

게이트웨이가 보낸 assertion이 누락·중복·위조·만료되었거나 audience가 다르면 `403`이며,
다른 호출자가 assertion을 보내도 `403`입니다. 개인 키는 게이트웨이에만 있고, Raven에는
비밀이 아닌 공개 키만 설정합니다.

도구마다 필요한 scope는 게이트웨이 정책과 같습니다.

| 도구 | 필요한 scope |
| --- | --- |
| `<domain>` 조회: search, choices, get, list, history, reports, audit, doctor | `raven.<domain>.read` |
| `<domain>` 변경: create, update, transition, archive, restore, materialize, daily upsert | `raven.<domain>.write` |
| `raven_dashboard` | 세 도메인 read scope 모두 |
| `ledger_export` | `raven.ledger.read`, `raven.ledger.export` |
| `ledger_account_category_purge_preview` / `_purge` | `raven.ledger.read` / `raven.ledger.write`, 그리고 `raven.ledger.purge` |
| `health_diet_image_get` / `_create`, `_update` | `raven.health.read` / `raven.health.write`, 그리고 `raven.health.media` |

`media_file` 대상 `health_audit`와 `remove_image: true`인 `health_diet_update`에도
`raven.health.media`가 필요합니다. `tools/list`에는 호출자가 scope를 가진 도구만 표시합니다.
그 밖의 `tools/call`은 JSON-RPC 오류 `-32602` `Tool unavailable for this permission`을
반환하며, 매핑되지 않은 도구는 거부합니다. 거부 로그에는 도구 이름과 호출자 Client ID만
기록하고 토큰이나 assertion은 기록하지 않습니다.

### 배포 순서

기존 게이트웨이 grant를 재인가 없이 유지하려면 다음 순서로 배포합니다.

1. Ed25519 키 쌍을 만들고 개인 JWK를 게이트웨이 secret `ORIGIN_SCOPE_ASSERTION_KEY`로
   설정한 뒤 `Raven-Scope-Assertion`을 보내는 게이트웨이 버전을 배포합니다. 호출자 검사가
   없는 Raven 버전은 이 헤더를 무시합니다.
2. `RAVEN_MCP_GATEWAY_CLIENT_ID`, `RAVEN_MCP_GATEWAY_PUBLIC_KEY`(JWK `x`), 필요하면
   `RAVEN_MCP_SERVICE_CLIENTS`를 설정하고 이 버전으로 `raven mcp`를 다시 시작합니다.

게이트웨이에 저장된 grant는 바뀌지 않습니다. assertion은 요청마다 각 grant의 scope로 만듭니다.

## 전송과 인증

원본 URL은 `https://mcp.example.com/mcp`, 전송 방식은 Streamable HTTP입니다. Service Auth
헤더를 쓰는 클라이언트는 원본 URL을 직접 사용하고, OAuth 클라이언트는 게이트웨이 URL을 사용합니다.
서버는 JSON 응답을 사용하며 기존 세션을 보관하지 않습니다. 구형 SSE 전용 `/sse`는
지원하지 않습니다. 초기화·도구 목록 조회·모든 도구 호출에 인증을 적용합니다.

`Cf-Access-Jwt-Assertion` 하나만 허용합니다. 설정한 issuer의 키로 RS256 서명을 확인하고
issuer·audience·만료·선택적 not-before를 검증합니다. 누락·중복·만료·위조·다른 앱의
assertion은 `401`입니다. 서명 키 캐시와 갱신 간격을 제한하며, 만료된 키를 갱신하지
못하면 접근을 거부합니다.

Host는 설정한 공개 authority와 같아야 하며 다르면 `421`입니다. Origin이 있으면 공개
origin과 정확히 같아야 하며 다르면 `403`입니다. 브라우저가 아닌 클라이언트는 Origin을
생략할 수 있습니다. `/api/v1`, `/healthz`, UI 파일이나 세션 발급 경로는 제공하지 않습니다.
인증 헤더·scope assertion·쿠키는 MCP SDK에 전달하기 전에 제거합니다. 요청 크기는 최대 16 MiB입니다.

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

`ledger_audit(record_type=entry)`는 보관 거래를 포함해 생성·수정·보관의 불변 감사 이력을 읽습니다.
공개 요청 값 `entry`는 내부 `ledger_entry`로 매핑되며 반환 이벤트의 `record_type`은
`ledger_entry`입니다. `limit`·`offset`으로 페이지를 지정하고 `next_offset`이 null이 될 때까지
조회합니다.

`health_event_list`는 `category`, `metric_key`, `daily_only`, `metrics_only`와 페이징을
지원합니다. `category`는 weight/bowel/sleep/lab/symptom/medication이며 전체 컨디션은
`category=symptom, metric_key=overall_condition`으로 조회합니다.
`metrics_only=true`로 과거 lab/symptom 키를 포함한 지표 이력을 조회합니다.
`next_offset`이 null일 때까지 조회하며 마지막 빈 페이지가 있을 수 있습니다.
식단·배변·투약 목록 필터는 `health_search`로 조회하고 매체 감사는
`health_audit(record_type=media_file)`로 읽습니다. 과거 지표 상세·보관·복구는 이벤트 도구와
버전 가드를 사용합니다. 식단·이벤트 상세의 `include_archived=true`로 보관된 레코드의
버전도 조회할 수 있습니다.

## 변경·재시도·사진

일반 생성 도구는 선택적 `request_key`를 받습니다(ASCII 영문·숫자·`-_.:`, 1~128자).
같은 키·도구·입력으로 재시도하면 결과를 재사용합니다. 설정된 홈의 `retry.sqlite`에 CLI와
분리된 영수증을 저장하며 입력 원문·사진 대신 입력 해시와 결과를 보관합니다. 확실한 미커밋(`committed=false`)이며 재시도 가능(`retryable=true`)한 오류는 CLI처럼 영수증을
해제하므로 같은 키로 다시 시도할 수 있습니다. 그 외 완료된 오류는 재사용하며 알려진 실패 뒤
입력을 수정할 때는 새 키를 사용합니다. 영수증이 남아 있는 키의 다른 입력은
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
