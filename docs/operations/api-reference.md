# API Reference

The HTTP surface is an `axum` router built by `router(db_path)` over the same `TodoService`
and the same database as the CLI. This reference is verified against the route table in
`todo-engine/src/interfaces/api/mod.rs` and the handlers/DTOs in `api/handlers.rs` / `api/dto.rs`.

Item-returning endpoints respond with the full `TodoItem` as JSON. Errors return
`{"detail": "<message>"}` with a status derived from `TodoError`
(see [../conventions/error-handling.md](../conventions/error-handling.md)).

Run the local server with `cargo run -p todo-engine -- api`; it binds to
`127.0.0.1:3002` by default. Use `--host` and `--port` to override that address.

## Routes

| Method | Path | Handler | Body / query |
| --- | --- | --- | --- |
| `GET` | `/health` | `health` | — (returns `{"ok": true}`) |
| `POST` | `/areas` | `create_area` | `AreaBody` |
| `POST` | `/projects/propose` | `propose_project` | `ProjectProposeBody` |
| `POST` | `/goals/propose` | `propose_goal` | `GoalProposeBody` |
| `POST` | `/routines/propose` | `propose_routine` | `RoutineProposeBody` |
| `POST` | `/routines/:id/materialize` | `materialize_routine` | `RoutineMaterializeBody` |
| `POST` | `/events/propose` | `propose_event` | `EventProposeBody` |
| `POST` | `/tasks/propose` | `propose_task` | `TaskProposeBody` |
| `GET` | `/items` | `list_items` | `ItemsQuery` (see below) |
| `GET` | `/items/archive` | `archive_items` | — |
| `GET` | `/settings/planner` | `get_planner` | — (returns the saved JSON document or `null`) |
| `PUT` | `/settings/planner` | `put_planner` | `{ "value": { ... } }` |
| `GET` | `/views/agenda` | `view_agenda` | `AgendaQuery`: required `date` |
| `GET` | `/views/date-range` | `view_date_range` | `DateRangeQuery`: required `from`, `to` |
| `GET` | `/views/period` | `view_period` | `PeriodQuery`: required `horizon`, `period` |
| `PATCH` | `/items/:id` | `update_item` | `UpdateBody` |
| `POST` | `/items/:id/pause` | `pause_item` | optional `ReasonBody` |
| `POST` | `/items/:id/resume` | `resume_item` | optional `ReasonBody` |
| `POST` | `/items/:id/complete` | `complete_item` | — |
| `POST` | `/items/:id/reopen` | `reopen_item` | — |
| `POST` | `/items/:id/archive` | `archive_item` | optional `ReasonBody` |
| `POST` | `/items/:id/drop` | `drop_item` | optional `ReasonBody` |
| `POST` | `/items/:id/cancel` | `cancel_item` | optional `ReasonBody` |

### Planner settings

`GET /settings/planner` returns the `planner.v1` preference document stored in
`workspace_preferences`, or JSON `null` when it has not been saved. `PUT /settings/planner`
accepts `{ "value": { ... } }`, requires `value` to be a JSON object, and returns the saved
object. A non-object `value` returns HTTP `400`; storage failures return HTTP `500`.

The preference is workspace-wide: it is persisted in the local workspace's `todo.sqlite`,
which has no user or profile identity. The Planner frontend keeps in-memory defaults if the
response is missing, malformed, or unavailable, and sends writes on a best-effort basis.

### Reopen a completed task or event

`POST /items/{id}/reopen`

- Accepts only an item with `type=task` or `type=event` and `status=completed`.
- Returns the item with `status=active` and `completed_at=null`.
- Writes a `reopen` audit event.
- Returns HTTP `400` with `code=policy_error` for another item type or source status.

### Materialize one routine

`POST /routines/{id}/materialize`

Saves the routine's rolling target and fills any shortage, following its
`materialization_policy`. Unlike the CLI's `routine materialize`, which sweeps every active
routine using stored targets, this acts only on `{id}`.

- Accepts only an item with `type=routine` and `status=active`; anything else is HTTP `400`
  with `code=policy_error`.
- Returns `{"routine": TodoItem, "created": [TodoItem]}` — the routine carries the refreshed
  `last_materialized_at`, and `created` holds only the tasks this call generated. Occurrences
  that already had a task are absent from `created`.
- Reducing the target keeps existing tasks; increasing it creates the missing future tasks.
- Repeating a call with the same target creates nothing and returns an empty `created`.
- A malformed or missing target is rejected.

## Request bodies

- **`AreaBody`** — `title` (required), `review_cycle?`, `standard?`, `note?`, `tags?`.
- **`TaskProposeBody`** — `title` (required), `area?`, `due?`, `scheduled?`, `priority?`,
  `description?`, `note?`, `tags?`, `actor?` (default `agent`).
- **`ProjectProposeBody`** — `title` (required), `area?`, `definition_of_done` (required and non-blank), `outcome?`,
  `due?`, `note?`, `tags?`, `actor?` (default `agent`).
- **`GoalProposeBody`** — `title` (required), `horizon` (required: `year`, `month`, or `week`),
  `scheduled` (required canonical period start date), `parent_id?`, `actor?`, `note?`, `tags?`.
- **`RoutineProposeBody`** — `title` (required), `area?`, `project_id?`, `description?`, `priority?`,
  `recurrence_rule` (required and non-blank), `materialization_policy?` (default `single_open`),
  `future_occurrences?` (default `7`), `note?`, `tags?`, `actor?` (default `agent`).
- **`RoutineMaterializeBody`** — `future_occurrences` (required integer `1..=365`). Values
  outside that range return HTTP `400` with `code=validation_error`.
- **`EventProposeBody`** — `title` (required), `scheduled` (required), `area?`, `project_id?`,
  `due?`, `priority?`, `description?`, `note?`, `location?`, `participants?` (array),
  `commitment_type?` (default `appointment`), `tags?`, `actor?` (default `agent`).
- **`ReasonBody`** — `reason?`. Optional on the transition endpoints that accept it.
- **`UpdateBody`** — all optional: `title`, `description`, `note`, `outcome`,
  `definition_of_done`, `standard`, `review_cycle`, `recurrence_rule`,
  `materialization_policy`, `future_occurrences`, `area`, `project_id`, `parent_id`, `routine_id`, `due`,
  `scheduled`, `priority`, `tags`, `reason`.

Common create/update fields:

All creation routes return an item with `status: "active"`, regardless of actor. The
compatible `/propose` route names remain for existing clients. Missing or blank project
completion criteria returns HTTP `400` with detail `Project requires definition_of_done`;
missing or blank routine recurrence returns HTTP `400` with detail
`Routine requires recurrence_rule`.

| Field | Type | Meaning |
| --- | --- | --- |
| `tags` | optional `string[]` | Common item tags. Empty strings are ignored and duplicates are removed. |

## Query: `GET /items`

`ItemsQuery` parameters (all optional strings): `status`, `type` (the `item_type`, exposed on
the wire as `type` via `#[serde(rename = "type")]`), `area_id`, `project_id`, `parent_id`,
`routine_id`, `horizon`, `scheduled`, `query`, `include_archived`. Empty strings are ignored; `include_archived` accepts
`true/1/yes/on` and `false/0/no/off`. Results are sorted by `created_at` descending, then by
`id` descending.

## Status mapping note

The `axum` error boundary maps every `TodoError` through `http_status_code`:
policy/validation → 400, not-found → 404, conflict → 409, storage/migration/internal → 500. See
[../conventions/error-handling.md](../conventions/error-handling.md).

## In-memory mode

Passing `:memory:` as the `db_path` to `router(...)` spins up a shared-cache in-memory SQLite
database (a `file:...?mode=memory&cache=shared` URI kept alive for the router's lifetime).
This backs the `tests/e2e/api.rs` suite; production passes the real `todo.sqlite` path.
