# API Reference

Raven serves one HTTP API below `/api/v1`. CLI and API adapters call the same domain
services.

## Authentication and bind

Standalone `raven api` requires exactly one:

- `RAVEN_API_TOKEN`
- `RAVEN_API_TOKEN_FILE`

Send `Authorization: Bearer <token>`. Tokens are 16–4096 visible ASCII bytes; duplicate or
malformed authorization headers are rejected. The token-file variant enforces
platform-specific file permissions.

Default bind is `127.0.0.1:3002`. `RAVEN_API_BIND_HOST` must be an IP address and
`RAVEN_API_BIND_PORT` must be `1..=65535`. A non-loopback cleartext bind is rejected unless
`RAVEN_API_ALLOW_UNSAFE_CLEARTEXT=true` is set exactly.

`raven ui` instead issues a fresh HTTP-only `SameSite=Strict` `raven_session` cookie from
`/__raven/session`. Its listener stays loopback-only and validates exact request authority.
Without `RAVEN_UI_PUBLIC_ORIGIN`, local behavior is unchanged.

Setting an exact HTTPS origin enables Cloudflare Access UI mode while preserving the loopback
trust boundary:

```bash
RAVEN_UI_PUBLIC_ORIGIN=https://raven.b-sir.xyz \
  raven ui --port 3001 --no-open
```

The origin host must be lowercase. An optional port is decimal `1..=65535` without leading
zeroes; explicit default port `443`, empty or malformed ports, and an authority that resolves to
the active loopback listener are rejected before serving. Invalid configuration exits `2`
without echoing the value.

Public requests must use the configured Host and one non-empty `Cf-Access-Jwt-Assertion`
validated and forwarded by `cloudflared`. Top-level document navigation may omit `Origin`, but
every supplied Origin and every public API `POST`, `PUT`, `PATCH`, or `DELETE` request must match
the configured HTTPS origin exactly. A request-target authority that conflicts with `Host`
returns `421`. Successful public `GET` responses set a `Secure`, HTTP-only `SameSite=Strict`
Raven cookie only for the UI index and extensionless SPA fallback; other static assets, including
arbitrary `.html` files, do not set it. `/api/v1/*` routes still require the current Raven cookie.
API tokens, Access JWTs or assertions, and Raven session cookies must not be logged or included
in error responses.

Exact `GET /healthz` is the only unauthenticated route:

```json
{"status":"ok"}
```

`/healthz/` and descendants are not health probes.

## Shared error contract

Raven errors are:

```json
{
  "code": "validation_error",
  "message": "The request is invalid.",
  "fields": {"amount": ["invalid"]},
  "request_id": "uuid"
}
```

| Status | Default/common code |
| --- | --- |
| `400` | `validation_error` |
| `401` | `unauthorized` |
| `404` | `not_found` |
| `409` | `conflict` |
| `413` | `payload_too_large` |
| `414` | `uri_too_long` |
| `415` | `unsupported_media_type` |
| `431` | `header_too_large` |
| `500` | `internal_error` |

Messages are intentionally generic except for the authenticated ToDo detail exception below.
`request_id` correlates an internal failure without exposing database paths, SQL, record
contents, tokens, sessions, or arbitrary metadata.

## Dashboard and preferences

| Method | Route | Behavior |
| --- | --- | --- |
| `GET` | `/api/v1/dashboard` | Combined ToDo, Ledger, Health, and recent activity |
| `GET` | `/api/v1/preferences/:key` | Read namespaced presentation state |
| `PUT` | `/api/v1/preferences/:key` | Store an object-valued preference |

Preference keys must start with `planner.`, `workspace.`, `ledger.`, or `health.` and use
bounded lowercase segments. Preferences live in `todo.sqlite` and cannot mutate domain
tables.

Dashboard returns HTTP `200` even when one domain cannot load. Each `todo`, `ledger`, and
`health` member is independently:

```json
{"status":"ok","data":{}}
```

or:

```json
{
  "status":"error",
  "code":"domain_unavailable",
  "message":"This data is currently unavailable.",
  "request_id":"uuid"
}
```

## ToDo routes

The existing ToDo router is mounted below `/api/v1/todo`:

| Method | Relative route |
| --- | --- |
| `GET` | `/health`, `/items`, `/items/archive`, `/views/agenda`, `/views/date-range`, `/views/period` |
| `POST` | `/areas`, `/goals/propose`, `/projects/propose`, `/routines/propose`, `/routines/:id/materialize`, `/events/propose`, `/tasks/propose` |
| `PATCH` | `/items/:id` |
| `POST` | `/items/:id/pause`, `/miss`, `/postpone`, `/resume`, `/complete`, `/reopen`, `/archive`, `/drop`, `/cancel` |

Example full route: `GET /api/v1/todo/items`.

The standalone ToDo API command is not part of Raven's supported surface:
`raven todo api` is rejected. Use `raven api` or `raven ui`, both of which apply Raven
authentication and bind policy.

ToDo preserves its service policies: direct-active creation, required project
`definition_of_done`, required routine RRULE, canonical goal anchors, status-machine
transitions, and an audit event for every mutation.

Authenticated ToDo routes have a narrow safe-detail exception within the shared error
envelope. Only `400 goal_invalid_anchor` and `400 goal_parent_horizon_not_coarser` retain
their corresponding safe message detail. For these two errors, the `fields` object may
contain only `parent_horizon`, `child_horizon`, `horizon`, `scheduled`, and `parent_id`, and
each present value is a one-element string array.

ToDo `400 policy_error` uses the generic `validation_error` code and message, and ToDo
`404 not_found` uses the generic `not_found` message. Both have an empty `fields` object.

Malformed, oversized, status-mismatched, conflicting, payload-too-large, and internal ToDo
errors use the generic shared contract. They do not expose paths, SQL, raw storage errors,
tokens, sessions, or arbitrary metadata.

## Ledger routes

All routes below use prefix `/api/v1/ledger`.

| Resource | Routes |
| --- | --- |
| Entries | `GET/POST /entries`, `GET/PATCH /entries/:id`, `POST /entries/:id/archive`, `POST /entries/:id/restore`, `GET/DELETE /entries/:id/purge` |
| Transfers | `POST /transfers`, `GET/PATCH /transfers/:id` |
| Currencies | `GET/POST /currencies`, `PATCH/DELETE /currencies/:id`, `GET /currencies/:id/purge` |
| Account categories | `GET/POST /account-categories`, `PATCH/DELETE /account-categories/:id`, `GET /account-categories/:id/purge` |
| Accounts | `GET/POST /accounts`, `PATCH/DELETE /accounts/:id`, `GET /accounts/:id/purge` |
| Transaction categories | `GET/POST /transaction-categories`, `PATCH/DELETE /transaction-categories/:id`, `GET /transaction-categories/:id/purge` |
| Reads | `GET /account-balances`, `/audit/:record_type/:record_id`, `/reports/summary`, `/reports/accounts`, `/reports/categories`, `/reports/compare`, `/reports/trend`, `/reports/briefing` |

JSON bodies deny unknown fields and are limited to 128 KiB. List pagination defaults to
offset `0`, limit `100`; limits are bounded. Report queries accept either `from`+`to` or
`year`+`month` where supported.

Entry and master-data purge `GET` routes return confirmation previews. Purge `DELETE`
requires `{"confirmation":"<confirmation-id>"}` matching the preview; audit events survive.
Only entries expose archive/restore. Currency, account-category, account, and transaction
category lifecycle uses the `active` field on update.

### Ledger reports

`GET /reports/compare` accepts either the legacy explicit four-date selector or a period
selector:

| Selector | Query | Comparison period |
| --- | --- | --- |
| Explicit ranges | `current_from`, `current_to`, `previous_from`, `previous_to` | Explicitly supplied current and previous ranges |
| Current month | `period=current_month` | Current calendar month vs. the preceding calendar month |
| Previous month | `period=previous_month` | Previous calendar month vs. the calendar month before it |
| Current year | `period=current_year` | Current calendar year vs. the preceding calendar year |
| Custom | `period=custom&from=YYYY-MM-DD&to=YYYY-MM-DD` | The immediately preceding range of equal inclusive length |

The three presets use the configured local date to select calendar periods. `custom` requires
both `from` and `to`; its preceding range has the same inclusive number of days and ends the
day before the custom range. The response retains `current` and `previous` summaries and
also returns aligned `currencies` rows. Each currency remains separate: minor units from
different currencies are never combined or converted, and a currency missing from one side
has zero totals on that side. Summary and comparison currency rows include `decimal_places`
so clients can format integer minor units correctly even when a referenced currency is inactive.

`GET /reports/trend` requires `from` and `to` and accepts optional
`granularity=auto|daily|weekly|monthly`. Ranges are inclusive. Series are partitioned by
currency; each currency with activity receives zero-filled points for missing buckets. Daily,
weekly (Monday-based), and monthly (calendar-month) buckets are clipped to the requested range. Archived
entries are excluded. With no activity, `currencies` is an empty array. A trend request may
produce at most 366 buckets; larger requests return the standard validation error.

Report dates in JSON retain Raven's established `[year, ordinal]` representation for ranges
and trend-point `start`/`end` values; they are not ISO date strings.

## Health routes

All routes below use prefix `/api/v1/health`.

| Resource | Routes |
| --- | --- |
| Diet | `GET/POST /diet`, `GET/PATCH /diet/:id`, lifecycle `POST /diet/:id/archive|restore`, `DELETE /diet/:id/purge` |
| Diet image upload | `POST /diet/with-image` and `PATCH /diet/:id/with-image` with raw image bytes |
| Health events | `GET/POST /events`, `GET/PATCH /events/:id`, lifecycle `POST /events/:id/archive|restore`, `DELETE /events/:id/purge` |
| Metrics | `POST /metrics/daily` |
| Reads | `GET /timeline`, `/trends`, `/reports`, `/audit/:record_type/:record_id` |

`GET /events` accepts `offset`, `limit`, `category`, `metric_key`, and
`daily_only=true|false`. `daily_only=true` returns only active events created through the
daily-upsert workflow; ordinary metric events are excluded.

`POST /metrics/daily` atomically saves one local date. The body contains 1 through 366
combined `metrics` and `archives` operations. `archives` defaults to `[]`, and the existing
metrics-only body remains valid. Each operation may include `expected_updated_at` for
optimistic concurrency:

```json
{
  "metrics": [{
    "occurred_at": "2026-08-20T09:00:00+09:00",
    "details": {"kind": "weight", "value": 68.2, "unit": "kg"},
    "expected_updated_at": "2026-08-20T01:00:00Z"
  }],
  "archives": [{
    "id": "00000000-0000-4000-8000-000000000001",
    "expected_updated_at": "2026-08-20T01:00:00Z"
  }]
}
```

All operations must target the same local date. The service rejects stale versions,
ordinary or inactive archive targets, duplicate identities, and an identity present in both
arrays. Any validation, conflict, audit, or storage failure rolls back the entire request.
The response `items` contains the created or updated active events; archived events are not
included.

### Health reports

`GET /reports` requires exact local calendar dates `from` and `to` in `YYYY-MM-DD` format:

```bash
curl 'http://127.0.0.1:3002/api/v1/health/reports?from=2026-07-22&to=2026-08-20' \
  -H "Authorization: Bearer $RAVEN_API_TOKEN"
```

The range is inclusive and may contain at most 366 days. The response also includes the
immediately preceding period of equal inclusive length. Only active Diet and Health records
contribute to reports; archived records are excluded.

The five fixed daily metrics are body weight, sleep duration, CRP, fecal calprotectin, and
overall condition. Each summary returns the latest reading in the selected range as `current`
and that reading's immediate predecessor as `previous`; series contain the selected-range
readings. A missing count, average, or metric reading is `null`, not zero.

Bowel points and medication and Diet-tag frequencies cover the selected range. Diet-tag bowel
response rows include every tag plus `positive_meals`, `eligible_meals`, and `rate`. A response
uses bowel events in the interval `(meal, meal + 24 hours]`; a meal whose full response window
has not elapsed is excluded from both numerator and denominator. Historical ranges therefore
read through the selected end plus 24 hours so complete boundary responses remain visible.
The response includes this exact interpretation warning:

```text
Observed associations only; they do not establish causation.
```

JSON bodies are limited to 128 KiB. The Diet image routes are not multipart:

- Body: raw JPEG, PNG, or WebP bytes, at most 10 MiB
- `Content-Type`: exactly `image/jpeg`, `image/png`, or `image/webp`
- `X-Raven-Diet-Metadata`: required strict, HTTP-header-safe ASCII JSON
  metadata, at most 8 KiB; escape non-ASCII text in the JSON header value

The metadata object is:

```json
{
  "occurred_at": "2026-07-31T12:00:00+09:00",
  "meal_type": "lunch",
  "food_name": "Rice bowl",
  "note": null,
  "tags": ["rice", "vegetables"],
  "actor": "raven-api"
}
```

`note` is optional, `tags` defaults to `[]`, and `actor` defaults to `raven-api`. Unknown
metadata fields are rejected. Declared content type must agree with detected image bytes.
The same limits, MIME validation, and safe API errors apply to
`PATCH /diet/:id/with-image`. Its metadata accepts the optional Diet update fields plus
`expected_updated_at` for optimistic concurrency and `reason` for audit history. The new
image and record fields are committed by one service mutation. `remove_image:true` is
rejected because this route replaces the image.

JSON `PATCH /diet/:id` accepts the same update fields. `remove_image` defaults to `false`,
which preserves the current image; `remove_image:true` removes it. Record and media changes
commit atomically as one service mutation.

```bash
curl -X POST http://127.0.0.1:3002/api/v1/health/diet/with-image \
  -H "Authorization: Bearer $RAVEN_API_TOKEN" \
  -H "Content-Type: image/jpeg" \
  -H 'X-Raven-Diet-Metadata: {"occurred_at":"2026-07-31T12:00:00+09:00","meal_type":"lunch","food_name":"Rice bowl","tags":["rice"]}' \
  --data-binary @meal.jpg
```

Event category plus attributes determine bowel, medication, weight, sleep, lab, or symptom
validation. Daily metric mutations contain 1 through 366 combined metric and archive operations. Timeline supports range,
category, archive, and page filters; trends defaults to 30 days and has a bounded window.

Archive and restore support optimistic timestamps. Health API has no purge-preview route.
`DELETE /diet/:id/purge` and `DELETE /events/:id/purge` require
`{"confirmation":"<record-id>"}`. Purge removes the confirmed record and associated
unreferenced media and preserves audit events.

## UI static boundary

`raven ui` serves the startup snapshot of the static artifact. `/api`, `/__raven`, and
`/healthz` namespaces never use SPA fallback. Static files have bounded count, depth,
individual size, and total size; symlinks/reparse points are rejected during artifact load.
