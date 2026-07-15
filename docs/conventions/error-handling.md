# Error Handling

## `TodoError`

Domain/service errors are modeled by the `TodoError` enum in `todo-engine/src/application/error.rs`. It
has **nine variants** (verified against source):

| Variant | `Display` form | Meaning |
| --- | --- | --- |
| `GoalInvalidAnchor { horizon, scheduled }` | `Goal anchor {scheduled} is not the canonical start of its {horizon} period` | A goal's `scheduled` date is not its period's start. |
| `GoalParentHorizonNotCoarser { parent_horizon, child_horizon }` | `Goal parent horizon ({parent}) must be strictly coarser than child horizon ({child})` | A goal's parent does not sit on a coarser horizon. |
| `Policy(String)` | `{0}` | A policy rule was violated (e.g. activating a project without a `definition_of_done`). |
| `Validation(String)` | `{0}` | Input was malformed or invalid (bad date, unknown actor/status, bad request body). |
| `NotFound(String)` | `Item not found: {0}` | The referenced item does not exist. |
| `Conflict(String)` | `conflict: {0}` | A write lost a uniqueness race against a concurrent one. |
| `Storage(String)` | `storage error: {0}` | A SQLite/storage operation failed. |
| `Migration(String)` | `migration error: {0}` | The legacy migration failed. |
| `Internal(String)` | `internal error: {0}` | An unexpected internal failure (e.g. a serialization/format failure). |

`GoalInvalidAnchor` and `GoalParentHorizonNotCoarser` also carry their horizons into the API
error body via `api_metadata`, so a client can render the conflict without parsing the message.

`Conflict` is raised by the SQLite layer when a write violates a `UNIQUE` index — the database,
not a prior read, is what settles who won. Callers that can reconcile it do: materialization
treats a lost race for an occurrence as "already materialized" and skips it, because the
occurrence now exists either way.

`TodoResult<T>` is the crate alias `Result<T, TodoError>` used throughout the service and
repository layers.

## Exit-code / HTTP-status mapping

The variant determines both the CLI exit code (`cli_exit_code`) and the HTTP status
(`http_status_code`):

| Variant | CLI exit code | HTTP status |
| --- | --- | --- |
| `GoalInvalidAnchor`, `GoalParentHorizonNotCoarser`, `Policy`, `Validation` | `2` | `400` |
| `NotFound` | `4` | `404` |
| `Conflict` | `2` | `409` |
| `Storage`, `Migration`, `Internal` | `1` | `500` |

> The `axum` `ApiError::into_response` boundary maps every variant through
> `http_status_code` above — `NotFound` → 404, like the CLI's exit-code mapping.

## Propagation pattern

- The service and repository layers return `TodoResult<T>` and never panic on expected
  failures.
- At the binary boundary the CLI uses `anyhow` (`run() -> anyhow::Result<()>`). On error it
  downcasts back to `TodoError` via `TodoError::cli_exit_code_from_error(&err)` to derive the
  process exit code (and to record the mapped `exit_code` in the operational log). A
  non-`TodoError` anyhow error yields `None` (the caller falls back to a generic failure).
- The API wraps any `Into<anyhow::Error>` in `ApiError`; `into_response` downcasts to
  `TodoError` to choose the status and returns a JSON body `{"detail": "<message>"}`.

## No-panic policy

Production code does not `panic!`/`unwrap` on expected error paths — failures become
`TodoError` values. The few `.expect()` sites that remain are **documented invariants** that
genuinely cannot fail (e.g. serializing a `TodoItem` to JSON, month arithmetic that is always
in range). These are preserved verbatim across refactors; do not introduce new `.expect()` on
paths that can realistically fail.

See [logging.md](logging.md) for how errors are recorded operationally, and
[../operations/cli-reference.md](../operations/cli-reference.md) /
[../operations/api-reference.md](../operations/api-reference.md) for the surfaces that consume
these codes.
