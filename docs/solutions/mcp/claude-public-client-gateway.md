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
| `vendor/oauth-provider.js` | Server methods `["private_key_jwt", "none"]`; a CIMD with ChatGPT's approved JWKS always negotiates `private_key_jwt`; public CIMD documents must carry no `jwks`/`jwks_uri`; public clients may use the previous refresh token once |

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

## Residual risks

- Public-client tokens are bearer tokens: a stolen current refresh token works until the
  8-hour grant expiry. New authorizations still require the owner's One-time PIN.
- Claude and Cursor client IDs are shared by all users of those products. An authorization
  started by someone else and approved by the owner would issue tokens to that person.
- No pre-bundle gateway source exists. The deployed bundle, this patch, its tests and the
  deployment scripts are tracked in the private `raven-mcp-gateway` repository; deploy only
  from there.
- Zone-level Browser Integrity Check or AI bot policies can still block vendor backends.

Client setup and the supported-client table: [Remote MCP](../../operations/mcp-reference.md).
