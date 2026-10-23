# Remote MCP

[한국어](mcp-reference.ko.md)

`raven mcp` serves Streamable HTTP at `/mcp`, bound to `127.0.0.1:3003` by default.
It exposes UI domain operations through the existing in-process API router and application
services. Mutations retain validation, lifecycle, atomicity and audit policy. No separate
API process or UI session cookie is required. Keyed creates use durable local receipts.

## Start

Initialize a new home with `raven init`, or select the existing home with `--home`.
The public origin, Access issuer and audience are required, plus a caller allowlist with at
least one caller (see [Callers and scopes](#callers-and-scopes)):

| Flag | Environment | Value |
| --- | --- | --- |
| `--port` | — | Loopback port, `1..65535`; default `3003` |
| `--public-origin` | `RAVEN_MCP_PUBLIC_ORIGIN` | Canonical public HTTPS origin, without `/mcp` |
| `--access-issuer` | `RAVEN_MCP_ACCESS_ISSUER` | `https://<team>.cloudflareaccess.com`, without trailing slash |
| `--access-audience` | `RAVEN_MCP_ACCESS_AUDIENCE` | Audience (AUD) of the MCP Access application |
| `--gateway-client-id` | `RAVEN_MCP_GATEWAY_CLIENT_ID` | Client ID of the gateway's Access service token |
| `--gateway-public-key` | `RAVEN_MCP_GATEWAY_PUBLIC_KEY` | Gateway scope-assertion Ed25519 public key, base64url (JWK `x`) |
| `--service-clients` | `RAVEN_MCP_SERVICE_CLIENTS` | Direct service tokens: whitespace-separated `<client-id>=<scope>[,<scope>...]` |

```powershell
$env:RAVEN_MCP_PUBLIC_ORIGIN = 'https://mcp.example.com'
$env:RAVEN_MCP_ACCESS_ISSUER = 'https://your-team.cloudflareaccess.com'
$env:RAVEN_MCP_ACCESS_AUDIENCE = '<MCP application AUD>'
$env:RAVEN_MCP_GATEWAY_CLIENT_ID = '<gateway service token Client ID>'
$env:RAVEN_MCP_GATEWAY_PUBLIC_KEY = '<gateway public key x>'
raven --home 'D:\RavenData' mcp
```

Use the MCP application's audience, rather than the UI application's audience. Public-origin
validation follows the canonical HTTPS rules of `RAVEN_UI_PUBLIC_ORIGIN`: lowercase host,
no credentials, path, query or fragment, no explicit default port. Configuration errors exit
`2`; startup failures exit `1`, without exposing configuration values or storage paths.
Without a valid caller allowlist `raven mcp` refuses to start (exit `2`, field
`caller_allowlist`); it never serves MCP with unrestricted callers.
Signing keys must be reachable at startup. Reads never initialize or migrate domain stores.

## Cloudflare Tunnel and Access

1. Add a dedicated public hostname to the existing tunnel, mapped to
   `http://127.0.0.1:3003`. Preserve the public Host header; do not override it to localhost.
2. Protect that hostname with a separate Cloudflare Access application. Restrict its policy
   to your identity or selected service token. Keep the UI application's configuration intact.
3. Copy the MCP application's AUD and team issuer into Raven's MCP configuration.
4. Choose authentication supported by the target MCP client and test the external endpoint.

Example ingress entry, inserted before the tunnel's final catch-all:

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

For a client supporting custom HTTP headers, a Service Auth policy can accept
`CF-Access-Client-Id` and `CF-Access-Client-Secret`. Store credentials in the client's secret
configuration, never in repository files or command examples. Cloudflare authenticates them
and forwards an Access JWT; Raven does not accept those raw credentials as its own token.
Each such service token must also be listed in `RAVEN_MCP_SERVICE_CLIENTS` with its scopes.
See [Cloudflare service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).

Do not use Access Bypass policies. A browser login to the UI does not supply MCP client
credentials. The PC, Raven MCP process and tunnel must remain online.

## OAuth gateway and clients

Raven itself supplies no OAuth authorization server or discovery endpoints. Interactive OAuth
clients connect through `raven-mcp-gateway`, a separately deployed Cloudflare Worker outside
this workspace. The gateway serves discovery, consent, authorization and token endpoints on
its own public origin, then forwards MCP requests to the Access-protected origin with its own
Service Auth token and a signed scope assertion. Clients use the gateway URL,
`https://<gateway-host>/mcp`, not the origin URL.

- Registration: Client ID Metadata Documents (CIMD) only; no dynamic client registration.
- Identity: owner-only Cloudflare Access One-time PIN login on every new authorization.
- Authorization: PKCE `S256`, exact registered callbacks, per-domain read/write scopes.
- Grants: access tokens last 10 minutes; a grant expires 30 days after authorization, and
  refresh does not extend it. A grant not refreshed for 14 days also expires (gateway
  constant `GRANT_IDLE_DAYS`, owner-adjustable).

| Client | CIMD client ID | Token endpoint authentication | Callback |
| --- | --- | --- | --- |
| ChatGPT | `https://chatgpt.com/oauth/client.json` | `private_key_jwt` with ChatGPT's published keys | Configured ChatGPT callback |
| Claude web, Desktop, mobile | `https://claude.ai/oauth/mcp-oauth-client-metadata` | `none` (public client, PKCE) | `https://claude.ai/api/mcp/auth_callback` |
| Claude Code | `https://claude.ai/oauth/claude-code-client-metadata` | `none` (public client, PKCE) | `http://localhost/callback` or `http://127.0.0.1/callback`, any port |
| Grok Bot, Grok web connectors, Cursor agents | `https://cursor.com/oauth/mcp-client.json` | `none` (public client, PKCE) | `https://www.cursor.com/agents/mcp/oauth/callback`, `https://www.cursor.com/bot/mcp/oauth/callback` or `https://grok.com/connectors-oauth-exchange-code/` |

The gateway rejects other client IDs, mismatched callbacks and mixed authentication methods.
Public clients may present the previous refresh token once after rotation. Presenting any
other rotated refresh token revokes the whole grant: its access and refresh tokens stop
working at once, and the client must reconnect. The gateway logs `RAVEN_SECURITY_EVENT` and
keeps a `security-event:` record (time, reason, client ID, SHA-256 of the grant ID; never
token text) for 30 days. Consent shows an
extra warning for loopback callbacks. Claude and Cursor client IDs are shared by every user of
those products; approve consent only for connections you started. Clients outside this table,
such as VS Code or Gemini CLI, can use the Service Auth header route above when they support
custom headers.

Connect Claude Code:

```bash
claude mcp add --transport http raven https://<gateway-host>/mcp
```

Then authenticate `raven` from `/mcp`. In Claude web or Desktop, add a custom connector with
the same URL and leave the OAuth client ID empty. Grok Bot connects with the same URL and
shows Cursor as the client on the consent page. Approve consent once, then complete the
One-time PIN login. A repeated consent submission reports `RAVEN-AUTH-02-BINDING-MISSING`;
start the connection again.

Cloudflare zone protections apply before the gateway. Browser Integrity Check, bot rules or
AI bot policies that block vendor backends prevent discovery or token exchange.

### Revoking grants after a token leak

Use this when a gateway access or refresh token may have leaked (pasted into a log, chat,
screenshot or shared file; a lost device), when `events` shows `refresh_token_reuse`, or when
the list contains a grant you did not create. The gateway's `scripts/grants.mjs` lists and
revokes grants through owner-only admin routes; it needs Node.js 22 and no Cloudflare API
token.

```bash
export RAVEN_GATEWAY_URL=https://<gateway-host>
export RAVEN_GRANT_ADMIN_TOKEN=...      # from the password manager, never as an argument
node scripts/grants.mjs list            # client, grant ID, scope, issued, last used, expiry
node scripts/grants.mjs events          # refresh_token_reuse and admin_revoke records
```

1. Identify. `list` shows one row per grant. `CLIENT` names the product; Cursor grants are
   split by callback: `Cursor (bot)`, `Cursor (agents)`, `Cursor (grok.com)` (see the client
   table; Grok Bot connections so far used the bot callback). `LAST USED` is the last refresh (`unknown` for grants issued before the
   14-day idle rule until their next refresh). A grant you cannot match to a connection you
   made is suspect.
2. Revoke the narrowest set. Each command first prints what it will revoke; `--dry-run`
   stops there. Confirmation is typed in an interactive terminal; piped runs are refused.

   | Command | Revokes | Type to confirm |
   | --- | --- | --- |
   | `revoke <grant-id>` | One grant | The grant ID |
   | `revoke --client <client-id>` | Every grant of that client | The number of grants |
   | `revoke --all` | Every grant (unknown leak) | `revoke all` |

3. Verify. `list` no longer shows the grant and `events` has one `admin_revoke` record per
   revoked grant. Reconnect the legitimate clients you revoked; a new authorization needs
   the owner's One-time PIN login, so a leaked token cannot be used to obtain a new grant.

Revocation deletes the grant and all its access and refresh tokens in the gateway's authority
Durable Object. Every `/mcp` request checks its access token against the grant in that same
serialized storage, so the next request after the command returns `401` and the next refresh
returns `invalid_grant`; there is no 10-minute window. Tests in the gateway prove this for an
access token issued just before the revocation, and that other grants keep working. A request
already forwarded to the origin finishes. Responses and output contain grant IDs, client IDs,
callbacks, scopes and times only, never token text.

Owner setup, once: generate a long random admin token locally (for example
`node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'`) and keep it
only in a password manager. Store only its SHA-256 hex
(`printf %s "$RAVEN_GRANT_ADMIN_TOKEN" | shasum -a 256`) as gateway secret
`GRANT_ADMIN_TOKEN_SHA256` in a new version and promote it. Without the secret the admin
routes return `404` and clients see no change. Rotate by storing the hash of a new token;
disable by deleting the secret. Deploying the gateway version with the admin routes, and
setting the secret, need the owner's approval.

## Callers and scopes

Raven identifies the caller by the `common_name` claim of the verified Access JWT, which
Cloudflare sets to the service token's Client ID. Identity logins without `common_name`,
and service tokens outside the allowlist, receive `403`. Unsigned headers never grant access.

| Caller | Scopes |
| --- | --- |
| `RAVEN_MCP_GATEWAY_CLIENT_ID` | From one valid `Raven-Scope-Assertion` header per request |
| Client ID in `RAVEN_MCP_SERVICE_CLIENTS` | The fixed list configured for that Client ID |

The gateway client ID and public key are set together. A Client ID cannot be both gateway
and direct client. Scopes are `raven.{todo,ledger,health}.{read,write}`,
`raven.ledger.export`, `raven.ledger.purge` and `raven.health.media`. Example:
`RAVEN_MCP_SERVICE_CLIENTS='abc.access=raven.todo.read,raven.todo.write def.access=raven.health.read'`.

`Raven-Scope-Assertion` is a JWT signed by the gateway with Ed25519 (`alg: EdDSA`). Raven
requires these claims:

| Claim | Value |
| --- | --- |
| `aud` | `<public origin>/mcp`, exactly |
| `scope` | Space-separated OAuth scopes of the gateway grant |
| `client_id` | OAuth client ID of the grant, non-empty |
| `iat`, `exp` | Issue and expiry time; `exp - iat` at most 120 seconds, 30 seconds clock leeway |

A missing, duplicated, forged, expired or wrong-audience assertion from the gateway returns
`403`, as does any assertion sent by another caller. The private key exists only in the
gateway; Raven holds the public key, which is not secret.

Each tool requires scopes; the mapping matches the gateway policy:

| Tools | Required scopes |
| --- | --- |
| `<domain>` reads: search, choices, get, list, history, reports, audit, doctor | `raven.<domain>.read` |
| `<domain>` writes: create, update, transition, archive, restore, materialize, daily upsert | `raven.<domain>.write` |
| `raven_dashboard` | All three domain read scopes |
| `ledger_export` | `raven.ledger.read`, `raven.ledger.export` |
| `ledger_account_category_purge_preview` / `_purge` | `raven.ledger.read` / `raven.ledger.write`, plus `raven.ledger.purge` |
| `health_diet_image_get` / `_create`, `_update` | `raven.health.read` / `raven.health.write`, plus `raven.health.media` |

`health_audit` for `media_file` and `health_diet_update` with `remove_image: true` also
require `raven.health.media`. `tools/list` shows only tools whose scopes the caller holds.
Other `tools/call` requests return JSON-RPC error `-32602` `Tool unavailable for this
permission`; unmapped tools are denied. Denials are logged with the tool name and caller
Client ID only, never tokens or assertions.

### Deployment order

Deploy in this order so existing gateway grants keep working without re-authorization:

1. Generate an Ed25519 key pair. Set the private JWK as gateway secret
   `ORIGIN_SCOPE_ASSERTION_KEY`, then deploy the gateway version that sends
   `Raven-Scope-Assertion`. A Raven version without caller checks ignores the header.
2. Configure `RAVEN_MCP_GATEWAY_CLIENT_ID`, `RAVEN_MCP_GATEWAY_PUBLIC_KEY` (the JWK `x`)
   and any `RAVEN_MCP_SERVICE_CLIENTS`, then restart `raven mcp` with this version.

Grants stored by the gateway are unchanged; the assertion is derived from each grant's
scopes on every request.

## Transport and authentication

The origin URL is `https://mcp.example.com/mcp`. Service Auth header clients use it directly;
OAuth clients use the gateway URL. Configure the client for Streamable HTTP.
The server uses JSON responses without retained legacy sessions; old SSE-only `/sse` transport
is unsupported. Authentication applies to initialization, tool discovery and every tool call.

Raven requires one `Cf-Access-Jwt-Assertion`, verifies its RS256 signature with the configured
issuer's signing keys, and checks issuer, audience, expiry and optional not-before. Missing,
duplicated, expired, forged or wrong-application assertions return `401`. Keys refresh with
a bounded cache and cooldown. Failed refresh of expired keys denies access.

Host must match the configured public authority (`421` otherwise). A supplied Origin must
match the public origin (`403` otherwise); non-browser clients may omit Origin. The listener
does not expose `/api/v1`, `/healthz`, static UI or session bootstrap routes. Auth headers,
scope assertions and cookies are removed before requests enter the MCP SDK. Requests are
limited to 16 MiB.

## Discovery and workflow

1. Read `tools/list` descriptions and strict input schemas.
2. Call `todo_options` for types, edit fields and current item lifecycle actions.
3. Call `<domain>_choices` with the desired scope. Results contain `choices` and the exact
   `query_schema` for that scope. Select returned IDs, rather than guessing names or IDs.
4. Search existing records with `<domain>_search`; follow `next_offset` until null.
5. Read the selected record before editing. Pass its `updated_at` as `expected_updated_at`
   wherever required. On conflict, reread and reconcile; do not remove the guard.

Tool groups include Dashboard; ToDo typed creation/editing, lifecycle, routine materialization
and history; Ledger master data, transactions, transfers, balances, reports and audit;
Health diet/photos, bowel, medication, daily metrics, reports, recovery and audit.
Only confirmed Ledger account-category purge is exposed. No arbitrary command, SQL,
local-file path, remote-image URL or generic metric-add tool is exposed.

Example `todo_search` arguments:

```json
{
  "scope": "workspace.task",
  "filters": [{"field": "title", "operator": "contains", "value": {"text": "dentist"}}],
  "sorts": [{"field": "scheduled", "direction": "asc"}],
  "group_by": "project",
  "limit": 50
}
```

Fields, operators and groups must be valid for the selected scope. Relative-date filters
require `context.reference_date`. Planner searches require `context.from` and `context.to`;
linked searches require `context.parent_type` and `context.parent_id`. Group settings default
to alphabetical, visible groups. Grouping can repeat a record across rows; deduplicate by ID.
Omitted Ledger sorts use the UI defaults: transactions by date descending, accounts/categories
by name ascending. An explicit empty sort list is rejected by Ledger.

`todo_list` exposes CLI list filters with `scope` (`list`, `archive`, `today`), paging,
and historical statuses/types; `scope=today` requires caller-local `today`. `status=active`
selects pending work. Follow `next` as the next offset. Creation accepts ToDo `actor` for
project/goal/routine/task/event. Routine creation and update accept `future_occurrences`;
`todo_routine_materialize` can omit it to preserve the saved target. Use
`todo_routines_materialize` to sweep all active routines using the server's local date.

`ledger_entry_list` supports date, type, account, category, currency, content and archived
filters. `ledger_entry_get(include_archived=true)` reads recovery records. Master lists
accept `query` and `include_inactive`, applying name/code matching before paging.
`ledger_doctor` performs bounded read-only diagnostics; `ledger_export` returns a structured
snapshot without a file destination. Both accept positive `max_records`/`max_bytes` budgets;
MCP input byte budgets are at most 8 MiB and all responses remain capped at 8 MiB. Large
exports should use the CLI. Export `include_archived=true` produces a restore-capable snapshot.

`ledger_audit(record_type=entry)` reads immutable create/update/archive history,
including archived entries. Requests map `entry` to canonical `ledger_entry`;
returned events retain `record_type: ledger_entry`. Use `limit`/`offset` and follow
`next_offset` until null.

`health_event_list` accepts `category`, `metric_key`, `daily_only`, `metrics_only` and paging.
Categories are weight/bowel/sleep/lab/symptom/medication; query overall condition with
`category=symptom, metric_key=overall_condition`. Use `metrics_only=true` for CLI metric
history including older lab/symptom keys. Follow
`next_offset` until null (a final empty page is possible). Diet, bowel and medication list
filters are available through `health_search` scope filters. `health_audit` also accepts
`media_file`. Historical metric show/archive/restore use existing event tools and guards.
Diet/event get tools accept `include_archived=true` to read versions for recovery.

## Mutations and images

Regular create tools accept optional `request_key` (1..128 ASCII letters, digits, `-_.:`).
Reuse the same key, tool and input after an uncertain response. Receipts persist in the
configured home's `retry.sqlite`, separately from CLI receipts. They store an input digest
and the result, without storing create arguments or image bytes. Completed results, including
errors, replay after restart, except definitely uncommitted retryable errors
(`committed=false`, `retryable=true`), which release the receipt just like the CLI so the
same key can retry. Missing/unknown commitment never permits re-execution.
Changed input while a receipt exists returns `request_key_conflict`; use a new key for
corrected input after a known failure. Pending receipts return `request_outcome_unknown`
with `committed: null` and `retryable: false` and never execute again. Inspect records to
reconcile an interrupted create before choosing another key. Do not delete receipts to retry.
`timeout_seconds` requires a key, defaults to 120, and accepts 1..3600. A timeout leaves a
pending receipt because a blocking service write may still complete. Creates without a key
retain their existing behavior; search after a lost response before retrying.
Transfer creation requires a stable UUID `operation_key`; reuse it on retry.
Respect errors' `committed` and `retryable` fields. A committed cleanup failure must not be
treated as a rolled-back mutation. Lifecycle operations preserve each service's policy.

`health_daily_upsert` saves the UI's daily weight, sleep, CRP, fecal calprotectin and overall
condition row, with atomic `metrics`/`archives` operations and UTC+09:00 dates. Supply existing
metric timestamps as version guards. Condition scores are `1..10`.

`health_diet_image_create` and `health_diet_image_update` accept `metadata`, `content_type`
and `image_base64`; update also requires `id` and `metadata.expected_updated_at`. PNG, JPEG
and WebP are limited to 10 MiB decoded. ASCII-escaped metadata is limited to 8 KiB by the
existing API. `health_diet_image_get` returns MCP image content. Remove a photo with
`health_diet_update` and `remove_image: true`. Database and Health media must be backed up together.
