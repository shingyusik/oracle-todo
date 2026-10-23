# Raven MCP connection: Claude clients rejected by a ChatGPT-only gateway

Date: 2026-10-19. Applies to the separately deployed `raven-mcp-gateway` Worker.
This gateway is outside the Rust workspace. The Rust MCP adapter was not changed.

## Symptom

- ChatGPT connected and called Raven tools.
- Claude web/Desktop and Claude Code could not connect to the same gateway URL.

## Confirmed cause

The gateway admitted exactly one OAuth client, ChatGPT, with signed client authentication.

- Discovery and the bundled provider advertised `token_endpoint_auth_methods_supported:
  ["private_key_jwt"]` only. Claude selects CIMD only when `"none"` is also listed;
  otherwise it falls back to dynamic registration, which the gateway does not offer.
- Claude's CIMD documents declare `token_endpoint_auth_method: "none"` and publish no keys.
  No Claude surface can send a `private_key_jwt` assertion.
- Nine gateway checks compared against the single configured ChatGPT client ID or callback,
  so a Claude `client_id` was rejected at `GET /authorize` before any login.
- The bundled provider rejected every CIMD document whose `jwks_uri` was not ChatGPT's.

The Rust origin was ruled out: all clients reach it through the gateway's own Service Auth
connection, which ChatGPT already exercised end to end.

## Resolution

Client allowlist with per-client authentication. Changes by gateway source module:

| Module | Change |
| --- | --- |
| `src/config.js` | `PUBLIC_CIMD_CLIENTS` (Claude, Claude Code); `configuration().clients` = ChatGPT (`private_key_jwt`) + public clients; helpers `allowedClient`, `redirectAllowed` (exact match; loopback `http` any port, same host/path/query), `redirectTargetAllowed` |
| `src/preflight.js` | `/authorize` head and token preflight use the allowlist and the client's callbacks; assertion required only for `private_key_jwt` clients; public clients must not send `client_assertion*` or `client_secret` |
| `src/authorize.js` | `validAuthorization` uses the allowlist; consent CSP `form-action` and displayed client follow the request; loopback callback warning |
| `src/navigation.js` | Denial navigation targets only allowlisted callbacks |
| `src/policy.js` | `authorizedIdentity` accepts tokens of allowlisted clients |
| `src/authority.js` | `validateToken` accepts grants of allowlisted clients |
| `src/worker.js` | Discovery advertises `["private_key_jwt", "none"]` |
| `vendor/oauth-provider.js` | Server methods `["private_key_jwt", "none"]`; a CIMD with ChatGPT's approved JWKS always negotiates `private_key_jwt`; public CIMD documents must carry no `jwks`/`jwks_uri`; public clients may use the previous refresh token once (reuse after that revokes the grant since SHI-451) |

Unchanged: owner-only Access One-time PIN, identity contract, PKCE `S256`, resource and scope
checks, ChatGPT assertion verification, rate limits and token lifetimes.

## Verification

- Patched bundle tests: 14 passed. Against the previous production bundle, the 8 Claude
  cases failed and the ChatGPT cases passed.
- Independent review suites compared ChatGPT discovery, consent, deny/allow navigation, token
  exchange, refresh, MCP initialize and stored grants between both bundles; results were
  identical apart from the advertised method list.
- Full in-process Claude and Claude Code flows (consent, Access callback, token, refresh,
  MCP initialize) passed with live-fetched Claude CIMD documents.
- Review findings fixed before deployment: unlimited reuse of a rotated public refresh token,
  ChatGPT method drift if its CIMD preference changes, and the missing loopback warning.

## Deployment

- Baseline: `0df09a46-e843-4b22-b313-910ac92bbc8a`, source SHA-256
  `7f3abd4408d00947ed8027afb52ce76eadf02a86006fbc3fd6822d2f3c1bdfa8`.
- New version: `710fb238-3d0d-480d-8c99-447f8c1d05ef`, main module SHA-256
  `dce22b87264f44969dff64e187be36eddd0adeb065598c5275056f3e17786476`, 100% traffic.
- Bindings (24), compatibility date and flags were inherited from the baseline; downloaded
  source and binding names were verified after upload.
- Public checks: discovery lists both methods with CIMD support; unauthenticated `/mcp`
  returns `401` with `resource_metadata` and scopes.
- ChatGPT reconnected. A first attempt returned `RAVEN-AUTH-02-BINDING-MISSING`, the known
  repeated-consent pattern; a fresh single-approval attempt succeeded.
- Claude Code authenticated and called `todo_options` successfully.
- Rollback target: `0df09a46-e843-4b22-b313-910ac92bbc8a`.

## Follow-up: Grok Bot

- Symptom: Grok Bot stopped at `Authorization request denied` on `GET /authorize`.
- Cause: Grok Bot authenticates as Cursor's public CIMD client
  `https://cursor.com/oauth/mcp-client.json` with callback
  `https://www.cursor.com/agents/mcp/oauth/callback`; that client was not allowlisted.
- Grok Bot's own diagnosis (missing dynamic registration) did not match the request: it had
  already reached `/authorize` through CIMD. Dynamic registration remains unsupported.
- Resolution: allowlist the Cursor CIMD client with its three HTTPS callbacks (Cursor agents,
  Cursor bot, Grok web connectors); its loopback `8787` callbacks stay excluded.
- Deployment: version `03393445-cfb9-4228-b936-6adf68c30ca5`, main module SHA-256
  `c5e58644d01dfe1a668c91ffc41bbdf1818dd4a19efc93a3e5497f82d3059e08`; rollback target
  `710fb238-3d0d-480d-8c99-447f8c1d05ef`. Gateway tests: 41 passed.
- Verification: Grok Bot connected through consent and One-time PIN.

## Follow-up: grant lifetime

- Symptom: every client asked for One-time PIN login again 8 hours after connecting.
- Cause: the gateway set `refreshTokenTTL` to 8 hours. The grant expiry is fixed at
  authorization; refresh does not extend it, so the next refresh failed with `invalid_grant`.
- Resolution: grant lifetime 30 days, still fixed at authorization. Access tokens stay at
  10 minutes; no idle-based expiry, so a stolen token cannot outlive the 30-day cap.
  (Idle expiry was added later without extending the cap; see the next section.)
- Deployment: version `82a5d2c8-6dc4-4283-adb3-71a8e904c036`, main module SHA-256
  `120e8289bdc107e09d474660bec241cf94240466f5ee095387c48076fceb7a7d`; rollback target
  `03393445-cfb9-4228-b936-6adf68c30ca5`. Gateway tests: 43 passed.
- Grants issued before this version keep their 8-hour expiry; the next connection gets 30 days.

## Follow-up: refresh-token reuse and idle expiry (SHI-451)

- Previous behavior of the refresh path (`handleRefreshTokenGrant` in the vendored provider):
  the current refresh token rotates and becomes the grant's previous token; a public client
  may present that previous token once more (grace), after which it is cleared; any other
  token, including older rotated ones, was rejected with `invalid_grant` like an unknown
  token, and the grant stayed usable.
- Change: every refresh token that leaves the current/previous pair is remembered by hash
  until the grant expires. Presenting one revokes the whole grant (all access and refresh
  tokens; MCP calls fail with `401` at once). The revocation deletes the grant row and stores
  the security event first; without the grant row no token of the grant is accepted. It then
  deletes at most 1000 access-token rows and leaves the rest to expire (10 minutes), so a
  grant with many live tokens cannot exceed the authority's 2048-write limit and roll the
  revocation back. The record, kept under `security-event:<time>:<grant id hash>` for 30
  days, holds the client ID, the SHA-256 of the grant ID and the outcome (`revoked`,
  access-token rows deleted and left); `RAVEN_SECURITY_EVENT` logs it after the revocation.
  Tokens never seen are only rejected.
- Idle expiry: a refresh 14 days or more (`GRANT_IDLE_DAYS`, gateway `src/oauth-options.js`)
  after the last refresh or authorization fails with `invalid_grant`. The 30-day absolute
  expiry from authorization is unchanged and never extended.
- Existing grants have no last-refresh time; their idle time starts at their next refresh, so
  the upgrade neither expires nor revokes them. The one-time grace keeps working across it.
- Patches: `patches/refresh-reuse-idle-expiry.py` and `patches/reuse-revocation-bounded.py` in
  `raven-mcp-gateway`; not yet deployed.

## Residual risks

- Public-client refresh tokens are bearer tokens. A stolen refresh token keeps working until
  the grant expires (30 days after authorization, or after 14 days or more without a refresh)
  as long as the legitimate client does not refresh. After both the thief and the legitimate
  client have refreshed, only one of them still holds a valid refresh token. The grant, with
  all its tokens, is revoked the next time the other one presents a rotated token; for an
  active client this is its next refresh, at most about 10 minutes later. Until then, whoever
  holds the current token keeps access. Detection relies on the authority Durable Object
  serialising token requests. Refresh tokens rotated before SHI-451 are not recorded and are
  only rejected. New authorizations still require the owner's One-time PIN.
- Claude and Cursor client IDs are shared by all users of those products. An authorization
  started by someone else and approved by the owner would issue tokens to that person.
- No pre-bundle gateway source exists. The deployed bundle, this patch, its tests and the
  deployment scripts are tracked in the private `raven-mcp-gateway` repository; deploy only
  from there.
- Zone-level Browser Integrity Check or AI bot policies can still block vendor backends.

Client setup and the supported-client table: [Remote MCP](../../operations/mcp-reference.md).
