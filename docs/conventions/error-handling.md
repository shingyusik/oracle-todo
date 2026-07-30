# Error Handling

Expected failures are typed at the owning engine boundary. Domain/application code returns
results; CLI and API adapters map them without parsing display strings.

## Engine error types

| Engine | Error families |
| --- | --- |
| ToDo | goal policy, policy, validation, not found, conflict, storage, migration, internal |
| Ledger | validation, not found, conflict, busy, storage, migration, confirmation mismatch |
| Health | validation, not found, conflict, busy, unsupported media, media too large, cleanup, migration/storage, confirmation mismatch |
| Raven command | import safety/integrity and API configuration/bind/startup |

Validation errors should identify a safe static field name. Storage errors may contain useful
operator context at the CLI boundary; the composed API never serializes their internal
message.

## CLI mapping

| Exit | ToDo | Ledger | Health | Raven system |
| --- | --- | --- | --- | --- |
| `2` | policy, validation, conflict | validation, conflict, confirmation | validation, conflict, media type/size, confirmation | import destination exists; invalid API token/bind/env |
| `4` | not found | not found | not found | — |
| `1` | storage, migration, internal | busy, storage, migration | busy, storage, migration, cleanup | import integrity/I/O; server startup |
| `0` | success | success | success | success/help |

Purge without `--confirm` deliberately prints a preview and exits `2`. This is not a storage
failure.

## API mapping

The composed `ApiError` emits:

```json
{
  "code": "validation_error",
  "message": "The request is invalid.",
  "fields": {"field": ["invalid"]},
  "request_id": "uuid"
}
```

| Engine condition | HTTP |
| --- | --- |
| validation/policy/confirmation mismatch | `400` |
| not found | `404` |
| conflict or database busy | `409` |
| unsupported media | `415` |
| media too large/body too large | `413` |
| storage/migration/cleanup/internal | `500` |

Authentication, URI, and header boundaries add `401`, `414`, and `431`. Unknown routes use
`404`.

API messages are fixed safe text. `fields` contains only allow-listed field identifiers.
`request_id` is the correlation handle for internal failures.

## Committed cleanup failures

Health operations can span SQLite and a media file. If the database mutation commits but
file cleanup cannot complete, return a cleanup-pending error and preserve recovery metadata.
Never claim the domain mutation rolled back after it committed.

## Propagation rules

- No panic for expected input, storage, concurrency, or media failure.
- Map errors once at the outer CLI/API boundary.
- Do not match on human-readable `Display` strings.
- Do not log bearer tokens, UI sessions, image bytes, or raw API storage errors.
- Keep audit history after domain-record purge.
