# Data Model

Raven stores canonical records in three independent SQLite databases. IDs are
engine-generated, timestamps are persisted in UTC, and mutations write the owning engine's
audit event in the same service operation.

## ToDo database

`todo.sqlite` contains the `items`, `events`, and UI preference tables.

| Item type | Policy |
| --- | --- |
| `area` | Long-lived responsibility; created `active`; not completed as ordinary work |
| `project` | Finite outcome; non-blank `definition_of_done` required |
| `goal` | `year`, `month`, or `week`; explicit canonical period start; parent must be coarser |
| `routine` | RRULE required; materializes de-duplicated task occurrences |
| `task` | Concrete work linked optionally to area, project, or routine |
| `event` | External commitment with required `scheduled` value |
| `review`, `archive_item` | Reserved persisted types |

Statuses are `active`, `waiting`, `paused`, `completed`, `cancelled`, `dropped`,
`archived`, `missed`, and `rejected`. Terminal statuses remain persisted. Normal lists hide
`archived`, `dropped`, and `cancelled` unless explicitly requested; `missed` remains
queryable but is not active work.

Routines support RRULE frequency `DAILY`, `WEEKLY`, `MONTHLY`, or `YEARLY` with the
validated subset of `INTERVAL`, `BYDAY`, `BYMONTHDAY`, and `BYMONTH`.
`single_open` maintains one open generated task; `per_occurrence` maintains the configured
`future_occurrences` target.

Each `events` row records timestamp, actor, action, object identity, optional reason, and
before/after item JSON.

## Ledger database

`ledger.sqlite` schema version is `2`.

| Table | Canonical content |
| --- | --- |
| `currencies` | Code, name, symbol, decimal places, active flag |
| `account_categories` | Name, optional parent, liability flag, active flag |
| `accounts` | Category, currency, signed opening balance in minor units, active flag |
| `transaction_categories` | Name, optional parent, `expense`/`income` kind, active flag |
| `ledger_entries` | Date, written timestamp, content, references, type, positive minor-unit amount, source, notes, lifecycle timestamps |
| `transfer_operations` | Idempotency key and paired-transfer result |
| `audit_events` | Immutable mutation history with before/after JSON |

Entry types are `expense`, `income`, `transfer_out`, `transfer_in`, `adjustment_out`, and
`adjustment_in`. The type supplies balance direction; SQLite `REAL` is not used for money.
User decimals are parsed using the referenced currency precision.

Transfers create `transfer_out` and `transfer_in` rows with one transfer-group ID. The
operation key makes retries idempotent, and all transfer rows/audit state commit atomically.

Ledger entry archive sets `deleted_at`; entry restore clears it. Currency, account-category,
account, and transaction-category records use an `active` flag rather than archive/restore.
Entry and master-data purge physically remove confirmed records while preserving audit
history. A transfer-pair purge covers the pair.

## Health database and media

`health.sqlite` schema version is `1`.

| Table | Canonical content |
| --- | --- |
| `diet_entries` | Timestamp, meal type, food, note, optional media ID, lifecycle timestamps |
| `diet_tags`, `diet_entry_tags` | Normalized many-to-many tags |
| `health_events` | Timestamp, category, metric key/name, numeric value, unit, note, category attributes, lifecycle timestamps |
| `media_files` | Relative path, MIME type, byte size, SHA-256 checksum, cleanup state, lifecycle timestamps |
| `audit_events` | Immutable mutation history with before/after JSON |

Meal types are `breakfast`, `lunch`, `dinner`, `snack`, and `late_night`. Tags are Unicode
normalized, case-folded, de-duplicated, and bounded.

Health categories are `weight`, `bowel`, `sleep`, `lab`, `symptom`, and `medication`.
Metric keys are normalized lowercase ASCII identifiers. Weight is positive, sleep is in
`(0,24]` hours, Bristol scale is `1..=7`, and all numeric values must be finite.

Images are JPEG, PNG, or WebP, at most 10 MiB. Bytes live below `media/health`; records keep
generated relative paths, never caller file paths. Media lifecycle is constrained by
SQLite triggers and coordinated by `HealthService`.

Archive/restore use `deleted_at`. Purge requires exact confirmation and leaves audit
history. Optimistic `expected_updated_at` checks are available for mutable Health records.

## Dashboard projection

`GET /api/v1/dashboard` returns:

- ToDo active/today/overdue counts
- Ledger current-period currency totals
- latest Health condition, sleep, bowel, and medication values plus recent diet tags
- a bounded, sanitized recent-activity list

Each domain is wrapped as `{status:"ok",data:...}` or
`{status:"error",code:"domain_unavailable",message,request_id}`. Projection reads do not
create or migrate missing databases.

## Schema initialization

`raven init` initializes all three stores and `media/health`. ToDo initialization is
additive and normalizes supported legacy statuses. Ledger and Health migrations run under
their own schema-version checks and reject future versions. Initialization never drops a
production database.
