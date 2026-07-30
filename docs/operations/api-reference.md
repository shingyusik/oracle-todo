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
`/__raven/session`. UI mode is loopback-only and validates the exact request authority.

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

| Status | Codes |
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

Messages are intentionally generic. `request_id` correlates an internal failure without
exposing database paths, SQL, record contents, or tokens.

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

ToDo preserves its service policies: direct-active creation, required project
`definition_of_done`, required routine RRULE, canonical goal anchors, status-machine
transitions, and an audit event for every mutation.

## Ledger routes

All routes below use prefix `/api/v1/ledger`.

| Resource | Routes |
| --- | --- |
| Entries | `GET/POST /entries`, `GET/PATCH /entries/:id`, `POST /entries/:id/archive`, `POST /entries/:id/restore`, `GET/DELETE /entries/:id/purge` |
| Transfers | `POST /transfers`, `GET /transfers/:id` |
| Currencies | `GET/POST /currencies`, `PATCH/DELETE /currencies/:id`, `GET /currencies/:id/purge` |
| Account categories | `GET/POST /account-categories`, `PATCH/DELETE /account-categories/:id`, `GET /account-categories/:id/purge` |
| Accounts | `GET/POST /accounts`, `PATCH/DELETE /accounts/:id`, `GET /accounts/:id/purge` |
| Transaction categories | `GET/POST /transaction-categories`, `PATCH/DELETE /transaction-categories/:id`, `GET /transaction-categories/:id/purge` |
| Reads | `GET /account-balances`, `/audit/:record_type/:record_id`, `/reports/summary`, `/reports/accounts`, `/reports/categories`, `/reports/compare`, `/reports/briefing` |

JSON bodies deny unknown fields and are limited to 128 KiB. List pagination defaults to
offset `0`, limit `100`; limits are bounded. Report queries accept either `from`+`to` or
`year`+`month` where supported.

Purge `GET` returns a confirmation preview. Purge `DELETE` requires a JSON confirmation
matching the preview; audit events survive.

## Health routes

All routes below use prefix `/api/v1/health`.

| Resource | Routes |
| --- | --- |
| Diet | `GET/POST /diet`, `GET/PATCH /diet/:id`, lifecycle `POST /diet/:id/archive|restore`, `DELETE /diet/:id/purge` |
| Diet image upload | `POST /diet/with-image` |
| Health events | `GET/POST /events`, `GET/PATCH /events/:id`, lifecycle `POST /events/:id/archive|restore`, `DELETE /events/:id/purge` |
| Metrics | `POST /metrics/daily` |
| Reads | `GET /timeline`, `/trends`, `/audit/:record_type/:record_id` |

JSON bodies are limited to 128 KiB. Diet multipart/image input is limited to 10 MiB;
metadata headers are separately bounded. Accepted image content is JPEG, PNG, or WebP and
must agree with detected bytes.

Event category plus attributes determine bowel, medication, weight, sleep, lab, or symptom
validation. Daily metric input is bounded to 366 objects. Timeline supports range,
category, archive, and page filters; trends defaults to 30 days and has a bounded window.

Archive and restore support optimistic timestamps. Purge requires exact record confirmation,
physically removes the record and associated unreferenced media, and preserves audit events.

## UI static boundary

`raven ui` serves the startup snapshot of the static artifact. `/api`, `/__raven`, and
`/healthz` namespaces never use SPA fallback. Static files have bounded count, depth,
individual size, and total size; symlinks/reparse points are rejected during artifact load.
