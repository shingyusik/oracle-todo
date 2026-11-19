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
| `task` | Concrete work linked to area, project, or goal; routine links are generated |
| `event` | External commitment with required `scheduled` value |
| `review`, `archive_item` | Reserved persisted types |

Statuses are `active`, `waiting`, `paused`, `completed`, `cancelled`, `dropped`,
`archived`, `missed`, and `rejected`. Terminal statuses remain persisted. Normal lists hide
`archived`, `dropped`, and `cancelled` unless explicitly requested; `missed` remains
queryable but is not active work. Public mutations do not create dropped/cancelled states; tasks cannot pause.
ToDo has no user-facing hard delete; hidden items are removed only by the
[retention purge](#retention-purge).

Routines support RRULE frequency `DAILY`, `WEEKLY`, `MONTHLY`, or `YEARLY` with the
UI-supported subset of `INTERVAL` (1..365), `BYDAY`, and single `BYMONTHDAY`/`BYMONTH` values. Creation and updates share validation; unsupported stored rules remain readable.
`single_open` maintains one open generated task; `per_occurrence` maintains the configured
`future_occurrences` target.

Each `events` row records timestamp, actor, action, object identity, optional reason, and
before/after item JSON.

## Ledger database

`ledger.sqlite` schema version is `3`.

| Table | Canonical content |
| --- | --- |
| `currencies` | Code, name, symbol, decimal places, active flag |
| `account_categories` | Name, optional parent, liability flag, active flag |
| `accounts` | Name, optional purpose, category, currency, signed opening balance in minor units, active flag |
| `transaction_categories` | Name, optional parent, `expense`/`income` kind, active flag |
| `ledger_entries` | Date, written timestamp, content, references, type, positive minor-unit amount, source, notes, lifecycle timestamps |
| `transfer_operations` | Idempotency key and paired-transfer result |
| `audit_events` | Immutable mutation history with before/after JSON |

Account `purpose` is optional free text describing what the account is used for. The
service trims it, stores blank input as `NULL`, and rejects more than 500 characters.
Schema version 3 added the nullable `accounts.purpose` column; migrating a version 2
database keeps existing accounts with `NULL` purpose. Version 2 binaries refuse a version 3
database as a newer schema.

Entry types are `expense`, `income`, `transfer_out`, `transfer_in`, `adjustment_out`, and
`adjustment_in`. The type supplies balance direction; SQLite `REAL` is not used for money.
User decimals are parsed using the referenced currency precision.

Transfers create `transfer_out` and `transfer_in` rows with one transfer-group ID. The
operation key makes retries idempotent, and all transfer rows/audit state commit atomically.

Ledger entry archive sets `deleted_at`; entry restore clears it. Currency, account-category,
account, and transaction-category records use an `active` flag rather than archive/restore.
Only account-category purge is user-confirmed; archived entries and transfers are also
removed by the [retention purge](#retention-purge). Master data retains activation. Adjustment records remain readable, but creation and conversion are prohibited. Adapters assign entry source, actor, and written timestamp; updates preserve source and written timestamp.

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

Archive/restore use `deleted_at`; there is no user-facing purge, only the
[retention purge](#retention-purge) of archived records. Optimistic `expected_updated_at` checks protect mutable Health records. Daily metrics use fixed UTC+09:00 dates and canonical weight, sleep, CRP, fecal calprotectin, and overall-condition identities. Generic event creation accepts bowel and medication. Legacy metrics remain visible in the record inspector.

## Retention purge

Raven permanently deletes long-hidden records once they are older than `retention_days`
(default `30`, range `7..=3650`). The purge is enabled by default and runs at most once per
24 hours from the `raven ui`/`raven api` scheduler, or on demand through the
[API](../operations/api-reference.md#maintenance-retention) and
[CLI](../operations/cli-reference.md#maintenance). A record is due when its clock is at or
before `now - retention_days` (UTC).

| Domain | Purged | Clock | Kept (skip reason) |
| --- | --- | --- | --- |
| ToDo | Items with status `archived`, `dropped`, or `cancelled` (not `completed`, `missed`, `rejected`) | max(`archived_at`, `updated_at`) | Items still referenced by a kept item through `area_id`/`project_id`/`routine_id`/`parent_id` (`referenced`); the earliest generated task of each non-terminal routine (`routine_anchor`); generated tasks whose occurrence is today or later in local time (`future_occurrence`); unparseable timestamps (`unparseable_timestamp`) |
| Ledger | Archived entries (`ledger_entry`); transfers as a pair plus their `transfer_operations` row (`ledger_transfer`) | `ledger_entries.deleted_at` | Inconsistent transfer pairs (`invalid_transfer_pair`) |
| Health | Archived diet entries and health events (`health_diet`, `health_bowel`, `health_medication`, `health_metric`) and their photos (`health_media`) | `diet_entries.deleted_at`, `health_events.deleted_at` | Photos still used by another diet entry (`media_shared`); unparseable timestamps |

Each run plans every domain read-only, backs up the affected databases (and the Health photos
to be deleted) into `backups/retention/`, then applies each domain independently. Apply
re-checks every planned record inside `BEGIN IMMEDIATE` transactions of at most 200 roots,
with `foreign_keys` and `secure_delete` on; a record that changed since planning is kept
(`changed_since_plan`). Reported skip counts are plan skips plus apply skips.

All audit or event rows of a purged record are deleted in the same transaction and replaced
by exactly one tombstone with `action = "purge"`, `reason = "retention"`, and no before/after
payload. Tombstone actors are ToDo `system`, Ledger `ledger-retention`, and Health
`retention`. Dashboard recent activity excludes these tombstones, and the Ledger doctor
accepts a tombstone-only history. Health photos follow the normal detach and cleanup trail;
a photo file that cannot be removed stays `cleanup_pending` and is counted as
`media_cleanup_pending`. Orphaned diet tags are removed afterwards.

Purged data is recoverable only from the retention backups, which keep the newest
`backup_keep` (default `3`) runs. See [Data Home](../operations/data-home.md#maintenance-and-retention-backups).

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
production database. Ledger read paths upgrade an initialized store with an older
supported schema before reading, so a schema-bumping release needs no manual `raven init`.
