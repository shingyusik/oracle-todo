# Remote MCP

[한국어](mcp-reference.ko.md)

`raven mcp` serves Streamable HTTP at `/mcp`, bound to `127.0.0.1:3003` by default.
It exposes UI domain operations through the existing in-process API router and application
services. Mutations retain validation, lifecycle, atomicity and audit policy. No separate
API process or UI session cookie is required. Keyed creates use durable local receipts.

## Start

Initialize a new home with `raven init`, or select the existing home with `--home`.
All three configuration values are required:

| Flag | Environment | Value |
| --- | --- | --- |
| `--port` | — | Loopback port, `1..65535`; default `3003` |
| `--public-origin` | `RAVEN_MCP_PUBLIC_ORIGIN` | Canonical public HTTPS origin, without `/mcp` |
| `--access-issuer` | `RAVEN_MCP_ACCESS_ISSUER` | `https://<team>.cloudflareaccess.com`, without trailing slash |
| `--access-audience` | `RAVEN_MCP_ACCESS_AUDIENCE` | Audience (AUD) of the MCP Access application |

```powershell
$env:RAVEN_MCP_PUBLIC_ORIGIN = 'https://mcp.example.com'
$env:RAVEN_MCP_ACCESS_ISSUER = 'https://your-team.cloudflareaccess.com'
$env:RAVEN_MCP_ACCESS_AUDIENCE = '<MCP application AUD>'
raven --home 'D:\RavenData' mcp
```

Use the MCP application's audience, rather than the UI application's audience. Public-origin
validation follows the canonical HTTPS rules of `RAVEN_UI_PUBLIC_ORIGIN`: lowercase host,
no credentials, path, query or fragment, no explicit default port. Configuration errors exit
`2`; startup failures exit `1`, without exposing configuration values or storage paths.
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
See [Cloudflare service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).

For clients requiring interactive OAuth, Cloudflare's Managed OAuth integration requires an
MCP server that validates Access JWTs. Raven performs that origin validation. Client discovery,
login and subsequent tool calls still require verification against the selected Cloudflare
configuration. Raven itself supplies no OAuth authorization server or discovery endpoints.
See [Cloudflare MCP authentication](https://developers.cloudflare.com/cloudflare-one/access-controls/ai-controls/secure-mcp-servers/).

Do not use Access Bypass policies. A browser login to the UI does not supply MCP client
credentials. The PC, Raven MCP process and tunnel must remain online.

## Transport and authentication

The external URL is `https://mcp.example.com/mcp`. Configure the client for Streamable HTTP.
The server uses JSON responses without retained legacy sessions; old SSE-only `/sse` transport
is unsupported. Authentication applies to initialization, tool discovery and every tool call.

Raven requires one `Cf-Access-Jwt-Assertion`, verifies its RS256 signature with the configured
issuer's signing keys, and checks issuer, audience, expiry and optional not-before. Missing,
duplicated, expired, forged or wrong-application assertions return `401`. Keys refresh with
a bounded cache and cooldown. Failed refresh of expired keys denies access.

Host must match the configured public authority (`421` otherwise). A supplied Origin must
match the public origin (`403` otherwise); non-browser clients may omit Origin. The listener
does not expose `/api/v1`, `/healthz`, static UI or session bootstrap routes. Auth headers and
cookies are removed before requests enter the MCP SDK. Requests are limited to 16 MiB.

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
