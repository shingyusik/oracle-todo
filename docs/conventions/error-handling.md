# Error Handling

## `TodoError`

Domain/service errors are modeled by the `TodoError` enum in `todo-engine/src/application/error.rs`. It
has **six variants** (verified against source):

| Variant | `Display` form | Meaning |
| --- | --- | --- |
| `Policy(String)` | `{0}` | A policy rule was violated (e.g. activating a project without a `definition_of_done`). |
| `Validation(String)` | `{0}` | Input was malformed or invalid (bad date, unknown actor/status, bad request body). |
| `NotFound(String)` | `Item not found: {0}` | The referenced item does not exist. |
| `Storage(String)` | `storage error: {0}` | A SQLite/storage operation failed. |
| `Migration(String)` | `migration error: {0}` | The legacy migration failed. |
| `Internal(String)` | `internal error: {0}` | An unexpected internal failure (e.g. a serialization/format failure). |

`TodoResult<T>` is the crate alias `Result<T, TodoError>` used throughout the service and
repository layers.

## Exit-code / HTTP-status mapping

The variant determines both the CLI exit code (`cli_exit_code`) and the HTTP status
(`http_status_code`):

| Variant | CLI exit code | HTTP status |
| --- | --- | --- |
| `Policy`, `Validation` | `2` | `400` |
| `NotFound` | `4` | `404` |
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
