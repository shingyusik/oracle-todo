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
  refresh does not extend it. A grant not refreshed for 14 days or more also expires
  (gateway constant `GRANT_IDLE_DAYS`, owner-adjustable). Applies after the gateway deploy.
  Grants issued before that deploy have no recorded refresh time, so their 14 days start at
  their first refresh after the deploy; the 30-day limit still applies to them.

| Client | CIMD client ID | Token endpoint authentication | Callback |
| --- | --- | --- | --- |
| ChatGPT | `https://chatgpt.com/oauth/client.json` | `private_key_jwt` with ChatGPT's published keys | Configured ChatGPT callback |
| Claude web, Desktop, mobile | `https://claude.ai/oauth/mcp-oauth-client-metadata` | `none` (public client, PKCE) | `https://claude.ai/api/mcp/auth_callback` |
| Claude Code | `https://claude.ai/oauth/claude-code-client-metadata` | `none` (public client, PKCE) | `http://localhost/callback` or `http://127.0.0.1/callback`, any port |
| Grok Bot, Grok web connectors, Cursor agents | `https://cursor.com/oauth/mcp-client.json` | `none` (public client, PKCE) | `https://www.cursor.com/agents/mcp/oauth/callback`, `https://www.cursor.com/bot/mcp/oauth/callback` or `https://grok.com/connectors-oauth-exchange-code/` |

The gateway rejects other client IDs, mismatched callbacks and mixed authentication methods.
After a rotation the previous refresh token stays usable for 10 minutes from that rotation
(gateway constant `PREVIOUS_REFRESH_GRACE_SECONDS`, owner-adjustable): public clients may
present it once, ChatGPT until it presents the current token. Using it does not extend the 10
minutes. Grants rotated before the gateway deploy count them from their last recorded refresh,
or from their next use of the previous token if none is recorded. Presenting the previous token
after the 10 minutes (reason `refresh_token_grace_expired`) or any other rotated refresh token
(reason `refresh_token_reuse`, whichever client presents it) revokes the whole grant: its access
and refresh tokens stop working at once, and the client must reconnect. Another client
presenting the current or previous token is only refused. Sending a rotated refresh token in a
token revocation request (RFC 7009) from the grant's own client also revokes the whole grant
(reason `retired_refresh_token_revoked`); the response is still `200` with an empty body.
Revocation with the previous refresh token after its 10 minutes also revokes the grant (reason
`refresh_token_grace_expired`, as for refresh); with the current token, or the previous token
within its 10 minutes, it revokes the grant without a security event; another client's or an
unknown token revokes nothing. For each revocation with a reason
the gateway logs `RAVEN_SECURITY_EVENT` and keeps a `security-event:` record (time, reason,
client ID, SHA-256 of the grant ID, outcome; never token text) for 30 days. Applies after the
gateway deploy. Consent shows an
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
screenshot or shared file; a lost device), when `events` shows `refresh_token_reuse` or
`retired_refresh_token_revoked`, or when
the list contains a grant you did not create. The gateway's `scripts/grants.mjs` lists and
revokes grants through owner-only admin routes; it needs Node.js 22 and no Cloudflare API
token.

Never write the admin token on a command line (`export NAME=<token>`, `--token`): shell
history, scrollback and screen sharing keep it. Do not export it either: an exported variable
is inherited by every child process the shell starts afterwards. Keep it in a plain shell
variable and pass it only to each `grants.mjs` command. Do not hand it to an AI agent; run
these commands yourself.

```bash
export RAVEN_GATEWAY_URL=https://<gateway-host>
# Type or paste the admin token into a shell variable; not echoed, not exported, not in history.
printf 'Admin token: '; IFS= read -rs RAVEN_GRANT_ADMIN_TOKEN; echo
# Client, grant ID, scope, issued, last used, expiry:
RAVEN_GRANT_ADMIN_TOKEN="$RAVEN_GRANT_ADMIN_TOKEN" node scripts/grants.mjs list
# refresh_token_reuse, refresh_token_grace_expired, retired_refresh_token_revoked and
# admin_revoke records, with access tokens deleted and left:
RAVEN_GRANT_ADMIN_TOKEN="$RAVEN_GRANT_ADMIN_TOKEN" node scripts/grants.mjs events
unset RAVEN_GRANT_ADMIN_TOKEN           # when you are done
```

PowerShell has no per-command form, so `$env:` sets the variable for the session: run only the
`grants.mjs` commands while it is set and remove it right after.

```powershell
$env:RAVEN_GATEWAY_URL = 'https://<gateway-host>'
$env:RAVEN_GRANT_ADMIN_TOKEN = Read-Host -MaskInput 'Admin token'   # PowerShell 7.1+
node scripts/grants.mjs list
Remove-Item Env:RAVEN_GRANT_ADMIN_TOKEN   # right after
```

The steps below write `grants.mjs <command>` for
`RAVEN_GRANT_ADMIN_TOKEN="$RAVEN_GRANT_ADMIN_TOKEN" node scripts/grants.mjs <command>`.

1. Identify. `list` shows one row per grant. `CLIENT` names the product; Cursor grants are
   split by callback: `Cursor (bot)`, `Cursor (agents)`, `Cursor (grok.com)` (see the client
   table; Grok Bot connections so far used the bot callback). `LAST USED` is the last refresh.
   A grant not refreshed for 14 days or more is already refused (idle expiry, see Grants
   above); grants issued before that rule show `unknown` until their next refresh, and their 14
   days start at that refresh (the 30-day limit still applies). A grant you cannot match to a
   connection you made is suspect. Grant IDs are not credentials, but do not paste `list`
   output into shared channels.
2. Revoke the narrowest set. Each command first prints what it will revoke; `--dry-run`
   stops there. Confirmation is typed in an interactive terminal; piped runs are refused.
   For a grant ID that starts with `-`, write `revoke -- <grant-id>`.

   | Command | Revokes | Type to confirm |
   | --- | --- | --- |
   | `revoke <grant-id>` | One grant | The grant ID |
   | `revoke --client <client-id>` | Every grant of that client | The number of grants |
   | `revoke --all` | Every grant (unknown leak) | `revoke all` |

3. Verify. `list` no longer shows the grant and `events` has one `admin_revoke` record per
   revoked grant, with the access tokens deleted and left to expire. Reconnect the legitimate
   clients you revoked; a new authorization needs the owner's One-time PIN login, so a leaked
   token cannot be used to obtain a new grant.
4. Clean up: `unset RAVEN_GRANT_ADMIN_TOKEN` (PowerShell:
   `Remove-Item Env:RAVEN_GRANT_ADMIN_TOKEN`).

Revocation runs in the gateway's authority Durable Object. It deletes the grant row and records
the `admin_revoke` event first, then deletes the grant's access-token rows. Every `/mcp`
request checks its access token against the grant row in that same serialized storage, so the
next request after the command returns `401` and the next refresh returns `invalid_grant`.
You do not wait for access tokens to expire (they live 10 minutes). Tests in the gateway prove
this for an access token issued just before the revocation, and that other grants keep
working. A request already forwarded to the origin finishes. Responses and output contain
grant IDs, client IDs, callbacks, scopes, times and token counts only, never token text. The
gateway logs `RAVEN_SECURITY_EVENT` `revoke_attempt`, then `revoke_committed` or
`revoke_rolled_back`, as for reuse revocation.

One request may change at most 2048 storage rows, so large revocations are bounded. Access-token
rows beyond that budget (a grant with thousands of live tokens) are left to expire within 10
minutes; they are already refused because their grant row is gone, and the CLI reports how many.
One request revokes at most 1000 grants. If more match, the CLI reports how many are still live
and exits `1`; run the same command again to revoke the rest. Re-running is safe: revoked
grants are no longer listed.

Owner setup, once: create a long random admin token with the password manager's generator
(at least 32 random bytes, e.g. 64 hex characters) and keep it only there; do not print it in a
terminal. Load it into the shell as above, then store only its SHA-256 hex as gateway secret
`GRANT_ADMIN_TOKEN_SHA256` in a new version (the hash goes through stdin) and promote it:

    printf %s "$RAVEN_GRANT_ADMIN_TOKEN" | shasum -a 256 | cut -d' ' -f1 \
      | npx wrangler versions secret put GRANT_ADMIN_TOKEN_SHA256 --name raven-mcp-gateway

If you generate the token locally instead, send it straight to the clipboard (macOS)
(`node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))' | pbcopy`),
paste it into the password manager and clear the clipboard. Without the secret the admin routes
return `404` and clients see no change; `404` after setup means the stored value is not exactly
the 64-character lowercase hex. Disable by deleting the secret. Deploying the gateway version
with the admin routes, and setting the secret, need the owner's approval.

### If the admin token leaks

Use this when the admin token may have leaked (lost or shared device, typed on a command line,
pasted somewhere). An admin token can list and revoke grants but cannot create grants or
tokens, so revoke first and rotate right after.

1. Revoke suspicious grants as above.
2. Rotate the hash secret at once: create a new token, store its hash as
   `GRANT_ADMIN_TOKEN_SHA256` in a new version and promote it. If you cannot do that right
   away, delete the secret to turn the admin routes off.
3. Confirm that `grants.mjs list` with the old token fails with `401`, and works with the new
   one.
4. Review `events` for `admin_revoke` records you did not make, and the Workers logs for
   `RAVEN_ADMIN_AUTH_FAILED` (failed admin logins; path and reason only).
5. If the token was ever typed on a command line, remove it from shell history: bash
   `history -d <n>` then `history -w`; zsh: close the other zsh sessions (they rewrite the file
   on exit), delete the line from `~/.zsh_history` and start a new shell; PowerShell:
   `Clear-History`, and delete the line from the PSReadLine history file
   (`(Get-PSReadLineOption).HistorySavePath`).
6. `unset RAVEN_GRANT_ADMIN_TOKEN` (PowerShell: `Remove-Item Env:RAVEN_GRANT_ADMIN_TOKEN`).

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
selects pending work. Follow `next` as the next offset. `todo_transition` with
`action=postpone` requires caller-local `today` and `scheduled`; MCP applies no default date.
`scheduled` must be later than `today`, or equal to it for an overdue source. Creation accepts ToDo `actor` for
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
returned events retain `record_type: ledger_entry`. `record_type=transfer` with the transfer
group ID reads paired-transfer create/update/archive/restore history. Use `limit`/`offset`
and follow `next_offset` until null; null marks the last page.

`health_event_list` accepts `category`, `metric_key`, `daily_only`, `metrics_only` and paging.
Categories are weight/bowel/sleep/lab/symptom/medication; query overall condition with
`category=symptom, metric_key=overall_condition`. Use `metrics_only=true` for CLI metric
history including older lab/symptom keys. Follow
`next_offset` until null (a final empty page is possible). Diet, bowel and medication list
filters are available through `health_search` scope filters. `health_audit` also accepts
`media_file`. Historical metric show/archive/restore use existing event tools and guards.
Diet/event get tools accept `include_archived=true` to read versions for recovery.
`health_records` and `health_audit` return `{items,next_offset}`; follow `next_offset` until
null, which marks the last page.

## CLI equivalence

MCP tools and CLI commands call the same application services, so validation, lifecycle,
atomicity and audit policy match. Adapter-level differences:

| Area | CLI | MCP |
| --- | --- | --- |
| Clock defaults | `todo postpone` defaults to tomorrow; `todo today` uses the local date | Caller supplies `today`/`scheduled`; `todo_list` `scope=today` requires `today` |
| Page cursor | `{items,next}` | ToDo `{items,next}`; Ledger and Health `{items,next_offset}` |
| Page size | `--limit` up to 1000 (ToDo) or 500 (Ledger, Health) | List and audit `limit` at most 100; searches at most 50 |
| ToDo rejection codes | `validation_error`, `policy_error`, `goal_*` | `validation_error` for every rejected input |
| Ledger records | `amount_minor` plus resolved account/category/currency names | Stored entry with minor-unit `amount`; transfer sides as `{entry,account_name,category_name,currency_code}` |
| Ledger masters, balances | `account_category_id`, `opening_balance_minor`, flat balance rows | `category_id`, `opening_balance`, balance rows with nested `account` |
| Ledger report dates | `range` as ISO `YYYY-MM-DD` | `range` as `[year, ordinal_day]`; Health reports use this form on both adapters |
| `ledger_report_compare` | `current`, `previous` | Same, plus per-currency `currencies` deltas |
| Health audit `occurred_at` | RFC 3339 | `[year, ordinal, hour, minute, second, nanosecond, offset_h, offset_m, offset_s]` |
| Archived reads | Ledger `entry show` hides archived; Health `show` returns them | `*_get` requires `include_archived=true` |
| Purge | Preview prints `confirmation_id` and exits `2` (`confirmation_mismatch`); purge prints `{purged,id}` | Preview succeeds; purge returns `{ok:true}`; wrong confirmation is `validation_error` |
| Routine materialize | Created items array | `{created}`; single routine adds `routine` |
| Health event list end | Exact `next` | `health_event_list` may return one final empty page |
| Provenance | Ledger `source`/`actor` `raven-cli`; Health actor `raven-cli` | Ledger `source: api`, actor `raven-api`; Health actor `raven-api` |
| Create receipts | `retry.sqlite` table `receipts` | `retry.sqlite` table `mcp_receipts`; one key does not deduplicate across adapters |

Archive and restore audit events name the service (`ledger-service`, Health `local`) on both
adapters. Unknown IDs are `not_found`, stale guards `conflict`, and same-key transfer or
create retries with changed input `conflict`/`request_key_conflict` on both adapters.

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

## Archived Linear records (2026-10-27)

Korean transcription of records from Linear issues archived on 2026-10-27, kept here so they
survive the archive. Not mirrored in [mcp-reference.ko.md](mcp-reference.ko.md). Each entry
names its source issue. Times are KST.

### 원격 MCP 운영 정보: Origin 서비스 토큰 만료 (출처: Linear SHI-137, 2026-10-27 보관)

- Origin 서비스 토큰 `<access-token-name>`(ID `<access-token-id>`)은 유효기간 2년, 만료 표시 `2028-10-05 04:56 AM`(시간대 미확인). 전용 Origin Service Auth 정책 `<access-policy-id>`이 이 토큰만 포함. 배포 때는 `--keep-vars`로 인증 binding을 보존.
- 구조·사고 기록 전체: [원격 Raven MCP 구조와 OAuth 연결 사고 기록](../solutions/mcp/remote-mcp-oauth-incidents.md).

### MCP 권한(scope) 결정과 CLI 동등성 경계 (출처: Linear SHI-138, 2026-10-27 보관)

- 요약: 6개 scope와 별도 opt-in 기능, MCP로 노출하지 않는 의도적 경계.
- 사용자 범위 확인(10/09): 읽기 전용은 최종 목표가 아니고 ToDo·Ledger·Health 추가·수정까지 포함한다.
- 결정(10/09): `ENABLE_CLI_DATA_OPERATIONS=true`는 read 3개와 todo/ledger/health.write 3개, 정확히 6개 scope만 제공(73 tools, 40 mutation). `ENABLE_LEDGER_EXPORT`, `ENABLE_LEDGER_PURGE`, `ENABLE_HEALTH_MEDIA`는 별도로 정확히 `true`를 줘야 켜지며 기본은 꺼짐. 기존 read grant는 write 권한을 자동으로 얻지 않음. 영구 삭제·별도 cancel 도구·사진·export는 일반 권한에 없음. 건강 `diet_update`의 `remove_image:true`는 media 권한이 없으면 거부.
- 의도적 경계: 운영 명령(init/health-check/import, 서버·인증·Cloudflare 설정), 임의 셸/SQL, data home, 로컬 이미지 경로, CLI 출력 형식은 원격 도구로 내지 않음. 이미지는 base64. 응답 8 MiB·페이지 100건 제한. 그보다 큰 export는 CLI 작업.
- 재시도 규칙: CLI와 MCP receipt 테이블은 분리돼 있어 인터페이스를 넘나드는 같은 키 중복 방지로 해석하면 안 됨. `committed=false && retryable=true`인 오류만 receipt를 지워 같은 키로 재시도 가능. pending·결과 불확실·이미 committed 요청은 다시 실행하지 않음.
- 도메인 규칙: `overall_condition`은 category가 아니라 `category=symptom` + `metric_key=overall_condition` 조합.
- 완료 범위(10/22): 구현분(`fce0d8f`, `f3dc889`, `9eeac76`, v0.4.32)만 Done. PR 없이 main에 들어감. 미체크 항목은 SHI-456으로 이관.
- 위치 메모: 제안 위치였던 gateway 저장소 `CLI-DATA-MAPPING.md`는 raven-mcp-gateway main에 없어 이 절에만 적는다.

### 봇 연결 기본 권한을 읽기 전용으로 제한: 하지 않기로 결정 (출처: Linear SHI-452, 2026-10-27 보관)

- 요약: 버린 대안과 남는 위험.
- 사용자 결정(10/23): 하지 않음.
- 남는 위험(Medium): 봇 연결이 기본으로 가계부·건강 쓰기 scope까지 받을 수 있어, 토큰 유출이나 봇 오동작이 데이터 변경으로 이어질 수 있음. 새 인가에는 소유자 One-time PIN이 필요해 무단 발급은 막혀 있음.
- 관찰: 미인증 `/mcp` 401의 `WWW-Authenticate`가 read·write 6개 scope를 모두 알림.
- 제약: 같은 클라이언트와 callback으로 다시 인가하면 scope가 달라도 기존 grant가 교체됨. 그래서 읽기 grant와 쓰기 grant를 함께 두기 어려움(`docs/solutions/mcp/cloudflare-otp-email-proof.md:693-699`).

### origin의 scope·호출자 검증 설계 (출처: Linear SHI-455, 2026-10-27 보관)

- 요약: 게이트웨이를 거치지 않는 직접 접근을 막는 방어 심층화 설계와 배포 순서.
- 호출자는 Access JWT의 `common_name`(서비스 토큰 Client ID)으로 구분. 허용 목록에 없는 호출자와 이메일 신원 로그인은 403.
- 게이트웨이는 `Raven-Scope-Assertion` 헤더(Ed25519 서명 JWT, aud·scope·client_id·iat, exp 60초)를 붙임. origin은 서명·aud·수명(120초 이하)을 검증. 게이트웨이가 아닌 호출자가 이 헤더를 보내면 거부. 서명 없는 헤더는 믿지 않음.
- Service Auth 직접 호출자는 `RAVEN_MCP_SERVICE_CLIENTS`에 정한 scope만 받음. 도구별 필요 scope는 `policy.rs`에 정의하고 게이트웨이 `allowedTool`과 1:1로 맞춤. 매핑 없는 도구는 거부(fail-closed). tools/list에서 숨기고 tools/call은 `-32602`.
- 새 설정이 없으면 `raven mcp`가 시작을 거부(exit 2, `caller_allowlist`).
- 배포 순서(어기면 MCP 중단): ① gateway secret `ORIGIN_SCOPE_ASSERTION_KEY` 추가 후 gateway 배포 → ② origin에 `RAVEN_MCP_GATEWAY_CLIENT_ID`, `RAVEN_MCP_GATEWAY_PUBLIC_KEY`(필요하면 `RAVEN_MCP_SERVICE_CLIENTS`) 설정 후 재시작.
- 미확인: 실제 Access JWT의 `common_name` 값, workerd에서 Ed25519 동작.
- 알려진 flaky 테스트: `same_length_mutation_after_open_is_rejected`(main에도 있음).
- PR: oracle-todo#21, raven-mcp-gateway#1. 병합 순서 SHI-455 → SHI-451 → SHI-453.

### refresh token 재사용 감지와 idle 만료 (출처: Linear SHI-451, 2026-10-27 보관)

- 전체 기록: [claude-public-client-gateway.md의 "Archived Linear records (2026-10-27)" 절](../solutions/mcp/claude-public-client-gateway.md#archived-linear-records-2026-10-27). 재사용 시 grant 폐기, idle 14일, 주의점. (확인 필요: idle 14일 값의 사용자 결정 기록은 이슈에 없음)

### 소유자용 grant 관리 도구 (출처: Linear SHI-453, 2026-10-27 보관)

- 요약: grant 목록·폐기 관리 API와 CLI, 안전장치.
- grant는 gateway Durable Object에 있어 Cloudflare API로 직접 다룰 수 없음 → 관리 API 추가: `GET /admin/grants`, `GET /admin/security-events`, `POST /admin/grants/revoke`.
- Worker secret `GRANT_ADMIN_TOKEN_SHA256`가 없으면 404(기본 꺼짐). Bearer 관리 토큰을 해시로 비교. OAuth 토큰은 받지 않고 CORS도 열지 않음. 관리 토큰은 로컬에만 보관.
- CLI `scripts/grants.mjs`: `list [--json]`, `events`, `revoke <grant-id>`, `revoke --client <id>`, `revoke --all`, `--dry-run`. 폐기 전 대상 표시 후 grant ID·개수·`revoke all`을 직접 입력해야 진행. TTY가 아니면 거부. 확인 생략 옵션 없음.
- 미검증: 문서의 wrangler secret 명령. Rogi의 grant는 'Cursor (bot)' 라벨로 보일 것으로 예상(폐기 전 발급 시각으로 확인).
- PR: raven-mcp-gateway#3(`6dd0623`), oracle-todo#23(`487c080`). 10/26 배포 5단계(`<version-id-2>`)에서 secret 추가.
- 절차 본문: 위 [Revoking grants after a token leak](#revoking-grants-after-a-token-leak).

### MCP·CLI 계약 테스트: 남은 결정과 후속 작업 (출처: Linear SHI-456, 2026-10-27 보관)

- 요약: 계약 테스트 결과와, 보관하면 잊힐 수 있는 미결 결정 3건·후속 작업 3건.
- 같은 fixture를 CLI와 실제 MCP(HTTP JSON-RPC)로 실행해 결과·감사 기록을 비교하는 contract 테스트 17개(todo 6, ledger 5, health 5, retry 1). 테스트용 인증은 cargo feature `contract-test-support`(배포 바이너리 제외).
- 고친 버그: MCP 계정·카테고리 purge가 항상 internal_error, CLI `ledger audit --record-type entry`, `ledger_audit` record_type에 `transfer` 추가, `health_records`·`health_audit` 정확한 `next_offset`.
- 미결 결정:
  1. `health_audit.occurred_at`과 report range의 time tuple 직렬화를 유지할지 ISO로 바꿀지
  2. `policy_error`와 `validation_error` 구분
  3. `confirmation_mismatch` 유지 여부
- 후속 작업(TODO, 새 이슈 대신 문서로 남김):
  - [ ] ledger export/doctor와 photo의 contract 테스트
  - [ ] `entry show --include-archived`
  - [ ] `health_event_list`의 정확한 cursor
- PR: oracle-todo#24(`238befd`까지 9개 커밋).

### 남은 테스트 빈틈과 문서 정정 (출처: Linear SHI-463·SHI-464(취소), 2026-10-27 보관)

- 요약: 취소됐지만 알려진 한계와 배포 이력으로 남길 내용.
- 테스트 빈틈(SHI-463): `/oauth/revoke`에 2048자 넘는 토큰을 보낼 때 grant 조회·폐기 없이 규격 응답을 주는지, 형식은 맞지만 소유하지 않은 위조 토큰이 아무 grant도 폐기하지 않고 보안 이벤트도 남기지 않는지 테스트가 없음.
- 문서 정정(SHI-464): '교체 후 10분 이상' 문구를 정확하게 고칠 것(직전 refresh token grace는 10분). 교체 후 10분 안에 들어온 retired token revoke는 보안 이벤트가 남지 않는다는 점을 명시할 것. (확인 필요: SHI-464는 취소됨. 이 문서와 gateway README의 해당 문구가 정정됐는지 확인 필요. 이 기록은 문구를 고치지 않았다)
- `DEPLOYMENTS.md`에 남길 두 버전: `<version-id-1>`(배포 `<deployment-id-1>`, 10/26 10:42 KST, main `d154dac`, 롤백 대상 `<version-id-0>`), `<version-id-2>`(배포 `<deployment-id-2>`, 10/26 12:17 KST, 코드 같음, `GRANT_ADMIN_TOKEN_SHA256`만 추가, 롤백 대상 `<version-id-1>`). raven-mcp-gateway `DEPLOYMENTS.md`에도 같은 기록을 남겼다.
