# 원격 Raven MCP 구조와 OAuth 연결 사고 기록

출처: Linear [SHI-137](https://linear.app/shingyusik/issue/SHI-137), 2026-10-27 보관.
이 문서는 보관된 이슈 기록을 옮긴 것이다(한국어 원문 요약 그대로). 시각은 KST.

### 원격 Raven MCP 구조와 OAuth 연결 사고 기록 (출처: Linear SHI-137, 2026-10-27 보관)

- 요약: 외부 AI 클라이언트용 원격 MCP 구조, 인증 결정, 연결 중 발생한 사고 4건과 고친 방식.
- 구조: 외부 클라이언트 → Cloudflare Worker `raven-mcp-gateway`(`<gateway-host>`, OAuth, SQLite Durable Object) → Access Service Token → 기존 `<tunnel-name>` Tunnel → `mcp.example.com` → 로컬 `127.0.0.1:3003` raven-api MCP. UI(`app.example.com` → `127.0.0.1:3001`)와 Access 정책은 그대로 유지.
- 설계 원칙: MCP는 DB 직접 변경·임의 SQL·임의 셸/CLI 실행을 제공하지 않음. UI 세션 쿠키에 의존하지 않음. 임의로 보낸 Access 헤더는 인증으로 인정하지 않음.
- 결정: KV-only 구성은 인증 상태 원자성 문제로 공개 배포 보류 → SQLite Durable Object 단일 인증 권위로 변경. 설정이 없으면 `/mcp`는 503(fail-closed).
- 사고 1(10/06): 동의 POST가 Forbidden. 원인은 `Referrer-Policy: no-referrer`가 `Origin: null`을 만들어 정확한 Origin 검사에서 403이 난 것. 수정: 동의 HTML에만 `Referrer-Policy: same-origin`. null Origin 허용이나 검사 완화는 하지 않음.
- 사고 2(10/09): `Raven authorization could not be completed`. ChatGPT CIMD가 `private_key_jwt`를 광고하는데 OAuth provider 1.2.1은 `none`만 협상(`Supported methods: none. Client advertised: private_key_jwt`). 수정: private_key_jwt 실제 검증 패치(ChatGPT 공개 JWKS, RS256, iss/sub 정확 일치, aud=`PUBLIC_ORIGIN/oauth/token`, iat/exp/jti 필수, 수명 최대 5분, 미래 iat 최대 30초, 만료 grace 없음, jti replay는 DO에 원자 저장). 버린 대안: 메타데이터를 `none`으로 바꾸거나 클라이언트 검증을 우회하는 방식(금지).
- 사고 3(10/12): 동의 뒤 외부 302가 strict CSP `form-action 'self'`에 막힘. 수정: 승인 POST → 같은 출처 JS 없는 200 → 같은 출처 GET → 고정 외부 endpoint. 버린 대안: CSP 완화, `unsafe-eval`.
- 사고 4(10/12): 동의 Cookie가 서버에 오지 않음(BINDING-MISSING). 진단용으로 폼·브라우저 바인딩·핸들·거래 단계별 고정 실패 코드를 도입. 독립 리뷰에서 handle-derived Cookie 결함을 찾아 별도 랜덤 secret과 암호화 레코드 해시 비교로 수정.
- 운영 정보: Origin 서비스 토큰 `<access-token-name>`(ID `<access-token-id>`)은 유효기간 2년, 만료 표시 `2028-10-05 04:56 AM`(시간대 미확인). 전용 Origin Service Auth 정책 `<access-policy-id>`이 이 토큰만 포함. 배포 때는 `--keep-vars`로 인증 binding을 보존.
- 완료(10/22): ChatGPT, Claude Code, Grok Bot 실제 연결 확인. 커밋 `d1bf65d`, `107e599`, `9a9347b`, 기록은 `mcp-reference.md`.

설정 절차와 현재 클라이언트 표: [Remote MCP](../../operations/mcp-reference.md).
