# API Reference

The HTTP surface is an `axum` router built by `router(db_path)` over the same `TodoService`
and the same database as the CLI. This reference is verified against the route table in
`todo-engine/src/interfaces/api/mod.rs` and the handlers/DTOs in `api/handlers.rs` / `api/dto.rs`.

Item-returning endpoints respond with the full `TodoItem` as JSON. Errors return
`{"detail": "<message>"}` with a status derived from `TodoError`
(see [../conventions/error-handling.md](../conventions/error-handling.md)).

## Routes

| Method | Path | Handler | Body / query |
| --- | --- | --- | --- |
| `GET` | `/health` | `health` | — (returns `{"ok": true}`) |
| `POST` | `/areas` | `create_area` | `AreaBody` |
| `POST` | `/projects/propose` | `propose_project` | `ProjectProposeBody` |
| `POST` | `/routines/propose` | `propose_routine` | `RoutineProposeBody` |
| `POST` | `/events/propose` | `propose_event` | `EventProposeBody` |
| `POST` | `/tasks/propose` | `propose_task` | `TaskProposeBody` |
| `GET` | `/items` | `list_items` | `ItemsQuery` (see below) |
| `GET` | `/items/archive` | `archive_items` | — |
| `PATCH` | `/items/:id` | `update_item` | `UpdateBody` |
| `POST` | `/items/:id/approve` | `approve_item` | — |
| `POST` | `/items/:id/activate` | `activate_item` | optional `ReasonBody` |
| `POST` | `/items/:id/pause` | `pause_item` | optional `ReasonBody` |
| `POST` | `/items/:id/resume` | `resume_item` | optional `ReasonBody` |
| `POST` | `/items/:id/complete` | `complete_item` | — |
| `POST` | `/items/:id/archive` | `archive_item` | optional `ReasonBody` |
| `POST` | `/items/:id/drop` | `drop_item` | optional `ReasonBody` |
| `POST` | `/items/:id/cancel` | `cancel_item` | optional `ReasonBody` |

## Request bodies

- **`AreaBody`** — `title` (required), `review_cycle?`, `standard?`, `note?`.
- **`TaskProposeBody`** — `title` (required), `area?`, `due?`, `scheduled?`, `priority?`,
  `description?`, `note?`, `actor?` (default `oracle`).
- **`ProjectProposeBody`** — `title` (required), `area?`, `definition_of_done?`, `outcome?`,
  `due?`, `note?`, `actor?` (default `oracle`).
- **`RoutineProposeBody`** — `title` (required), `area?`, `recurrence_rule?`,
  `materialization_policy?` (default `single_open`), `note?`, `actor?` (default `oracle`).
- **`EventProposeBody`** — `title` (required), `scheduled` (required), `area?`, `project_id?`,
  `due?`, `priority?`, `description?`, `note?`, `location?`, `participants?` (array),
  `commitment_type?` (default `appointment`), `actor?` (default `oracle`).
- **`ReasonBody`** — `reason?`. Optional on the transition endpoints that accept it.
- **`UpdateBody`** — all optional: `title`, `description`, `note`, `outcome`,
  `definition_of_done`, `standard`, `review_cycle`, `recurrence_rule`,
  `materialization_policy`, `area`, `project_id`, `routine_id`, `due`, `scheduled`,
  `priority`, `reason`.

## Query: `GET /items`

`ItemsQuery` parameters (all optional strings): `status`, `type` (the `item_type`, exposed on
the wire as `type` via `#[serde(rename = "type")]`), `area_id`, `project_id`, `routine_id`,
`query`, `include_archived`. Empty strings are ignored; `include_archived` accepts
`true/1/yes/on` and `false/0/no/off`. Results are sorted by `created_at` descending, then by
`id` descending.

## Status mapping note

The `axum` error boundary maps every `TodoError` through `http_status_code`:
policy/validation → 400, not-found → 404, storage/migration/internal → 500. See
[../conventions/error-handling.md](../conventions/error-handling.md).

## In-memory mode

Passing `:memory:` as the `db_path` to `router(...)` spins up a shared-cache in-memory SQLite
database (a `file:...?mode=memory&cache=shared` URI kept alive for the router's lifetime).
This backs the `tests/e2e/api.rs` suite; production passes the real `todo.sqlite` path.
