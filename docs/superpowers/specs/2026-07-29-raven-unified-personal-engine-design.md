# Raven Unified Personal Engine Design

**Date:** 2026-07-29
**Scope:** Rename the product to Raven and integrate ToDo, Ledger, and Health
Journal as policy-enforced Rust engines behind one CLI, one HTTP API, one
local-first data home, and one UI.

## Goal

Raven should provide one install and one structured command surface for
personal planning, finance, and health records:

```text
raven todo ...
raven ledger ...
raven health ...
raven ui
```

Each domain keeps its own service policy and SQLite database. CLI and HTTP are
adapters over the same service methods, and the UI consumes the HTTP API. The
root Dashboard combines small read-only projections from all three engines.

## Product Identity and Distribution

- Product name: `Raven`
- Native executable: `raven`
- npm package: `@shings/raven`
- Default data home: `~/.raven/`
- Data-home override: `--home`, `RAVEN_HOME`, or `RAVEN_HOME` in `.env`

The npm package distributes one platform-native Raven binary and the bundled
Next.js UI artifact. The old `oracle-todo` binary and `@shings/oracle-todo`
package name are replaced rather than retained as runtime aliases.

The GitHub repository rename and release publication are operational release
actions. They do not affect the internal engine boundaries described here.

## Source Feature Baselines

Raven incorporates behavior from these existing repositories:

- The current repository remains the ToDo behavior baseline, including its
  service policy, state machine, audit events, CLI/API agreement, Planner, and
  Workspace UI.
- `shingyusik/moneymanager-chat-ledger` supplies the Ledger baseline:
  currencies, account categories, accounts, transaction categories, entries,
  transfers, update/delete history, queries, references, doctor checks,
  analysis, briefing, and export behavior.
- `shingyusik/personal-health-tracker` supplies the Health Journal baseline:
  diet, images, bowel records, medication, weight, sleep, lab values, symptoms,
  same-day metric upsert, timelines, trends, and diet-to-symptom correlation
  summaries.

Raven does not embed a natural-language parser. All engine inputs are typed
flags or schema-validated JSON. Agents may translate natural language before
invoking Raven, but that translation is outside the engine.

## Architecture

### Workspace layout

The Rust workspace uses a modular single-executable design:

```text
raven-cli
├── todo-engine
├── ledger-engine
├── health-engine
└── raven-api
```

- `raven-cli` owns the `raven` binary, top-level command routing, shared
  configuration, process startup, and UI launch.
- `todo-engine` retains the existing ToDo domain, application service,
  repository, materialization, and state-machine behavior.
- `ledger-engine` owns finance domain types, finance policy, reporting, and the
  Ledger repository.
- `health-engine` owns diet and health domain types, category-specific
  validation, trends, and the Health Journal repository.
- `raven-api` composes the three engine routers and the shared Dashboard
  projection without owning domain mutation policy.
- `frontend` remains one Next.js UI and talks only to `/api/v1`.

The existing preferences-only `backend` functionality moves under the Raven
API composition layer. Its generic `workspace_preferences` table remains in
`todo.sqlite` for compatibility and may receive namespaced Ledger and Health
UI keys. Preferences are presentation state, not domain records, and the
preference adapter cannot mutate ToDo, Ledger, or Health records.

### Dependency direction

Each engine preserves clean inward dependencies:

```text
interfaces/infrastructure → application → domain
```

Engine domain and application modules do not depend on another engine.
`raven-cli` and `raven-api` may depend on all three public application
interfaces. The root Dashboard requests summary projections from each engine;
the engines never query one another.

### Runtime data flow

CLI mutation:

```text
raven command
→ top-level parser
→ owning engine service
→ validation and policy
→ record plus audit event in one SQLite transaction
→ typed CLI output
```

UI mutation:

```text
Next.js form
→ /api/v1/<domain>
→ HTTP DTO validation
→ owning engine service
→ validation and policy
→ record plus audit event in one SQLite transaction
→ typed JSON response
```

Neither CLI nor HTTP handlers issue direct SQL mutations.

## Data Home

The default layout is:

```text
~/.raven/
├── todo.sqlite
├── ledger.sqlite
├── health.sqlite
├── media/
│   └── health/
└── logs/
    └── raven.log.jsonl(.1-.3)
```

The databases are deliberately separate:

- They can be backed up, checked, and restored independently.
- A schema migration in one domain cannot partially alter another domain.
- An unavailable domain does not have to block reads from the others.
- Engine integration tests can create only the database they exercise.

All schema initialization is additive. Production databases are never dropped
or rewritten as an initialization strategy.

## Shared Record Conventions

- IDs are engine-generated UUIDs.
- Stored timestamps are UTC. Presentation uses a configurable timezone,
  defaulting to `Asia/Seoul`.
- New Ledger and Health mutable records have `created_at`, `updated_at`, and
  nullable `deleted_at`. Normal queries exclude soft-deleted rows; archive
  queries include only soft-deleted rows.
- ToDo retains its existing `ItemStatus` lifecycle and no-hard-delete policy.
  This design does not retrofit `deleted_at` or physical purge onto ToDo items.
- Every mutation writes the owning engine's existing event form: ToDo uses its
  current `events` model, while Ledger and Health use `audit_events` with
  actor, action, timestamp, record identity, and before/after JSON.
- Audit events survive record purge.
- Raven is single-user and local-first. Domain tables do not carry tenant IDs.

## Ledger Model and Policy

### Tables

`ledger.sqlite` contains:

- `currencies`: code, name, symbol, decimal places, active state.
- `account_categories`: hierarchy, liability flag, active state.
- `accounts`: category, currency, opening balance, active state.
- `transaction_categories`: hierarchy, transaction kind, active state.
- `ledger_entries`: date, written timestamp, content, category, account,
  entry type, integer minor-unit amount, currency, optional transfer group,
  source, notes, and lifecycle timestamps.
- `audit_events`: immutable Ledger mutation history.

Entry amounts are stored as nonnegative integer minor units, never as SQLite
`REAL`; the entry type determines balance direction. User-facing decimal input
is converted using the selected currency's decimal places. Account opening
balances use signed integer minor units. Current balances are derived from the
opening balance and non-deleted entries so a mutable cached balance cannot
drift from the journal.

### Entry policy

Supported entry types are:

- `expense`
- `income`
- `transfer_out`
- `transfer_in`
- `adjustment_out`
- `adjustment_in`

Amounts must be positive. Expense and income entries require a transaction
category. Transfer rows are created only through the paired transfer service
and never carry a transaction category. Adjustment categories are optional,
but an included category must resolve to an active category. Referenced
accounts, categories, and currencies must be active unless an update preserves
an existing historical reference.

A transfer is one service operation that creates paired `transfer_out` and
`transfer_in` rows with one transfer-group UUID. Both rows and the audit event
commit atomically. Initial Raven transfers require compatible currencies;
cross-currency conversion is not inferred.

### Ledger reads

Ledger provides:

- filtered and paginated entry list/show
- resolved account, category, and currency names
- transfer-group show
- account balances
- period income and expense totals
- category and account breakdowns
- comparison analysis and concise briefing
- reference/master-data reads
- database doctor checks
- structured export

Structured validation errors are returned to the caller. Raven does not retain
raw rejected chat payloads because it has no chat-ingestion layer.

## Health Journal Model and Policy

### Tables and media

`health.sqlite` contains:

- `diet_entries`: occurrence timestamp, meal type, food name, note, optional
  media reference, and lifecycle timestamps.
- `diet_tags` and `diet_entry_tags`: normalized many-to-many diet tags.
- `health_events`: occurrence timestamp, category, stable metric key, display
  name, numeric value, unit, note, category attributes JSON, and lifecycle
  timestamps.
- `media_files`: relative path, MIME type, byte size, checksum, and lifecycle
  timestamps.
- `audit_events`: immutable Health Journal mutation history.

Image bytes live under `~/.raven/media/health/`; SQLite stores metadata and
relative paths, not blobs. Upload validation restricts file type and size,
uses generated filenames, and never trusts the client filename as a path.
JPEG, PNG, and WebP are accepted, with a configurable size limit that defaults
to 10 MiB.

### Diet policy

Meal types are `breakfast`, `lunch`, `dinner`, `snack`, and `late_night`.
Food name and occurrence time are required. Tags are trimmed, normalized,
deduplicated, and linked through `diet_entry_tags`.

### Health event policy

Health categories are:

- `weight`
- `bowel`
- `sleep`
- `lab`
- `symptom`
- `medication`

The service applies category-specific validation:

- Bristol scale is an integer from 1 through 7; blood visibility is boolean.
- Medication requires a name, positive dose, and one of `tablet`, `capsule`,
  `packet`, `mg`, `g`, `ml`, `drop`, or `dose`.
- Weight is positive and uses an explicit unit.
- Sleep is greater than zero and no more than 24 hours.
- Lab values require a stable metric key and display name.
- Symptom and condition scores use an integer scale from 1 through 10.

Weight, sleep, lab, and overall-condition submissions use a stable
`metric_key`. Daily batch input upserts the same date/category/metric-key
combination rather than creating duplicate metric rows.

### Health reads

Health Journal provides:

- combined chronological Timeline
- filtered Diet, Bowel, Medication, and Health Metrics lists
- diet-tag frequency
- bowel and symptom trends
- medication frequency
- weight, sleep, lab, and condition charts
- possible diet-tag reactions within the following 24 hours

Correlation output is descriptive and must not be presented as medical
causation.

## Ledger and Health Record Lifecycle

The default lifecycle for Ledger and Health records is:

```text
active → archive → restore
active/archive → purge
```

- `archive` sets `deleted_at` and hides the record from normal reads.
- `restore` clears `deleted_at`.
- `purge` physically removes the domain record only when the caller supplies
  `--confirm <record-id>` or the equivalent explicit API confirmation.
- Purge writes its audit event before the record is removed in the same
  database transaction.
- Associated image deletion occurs only after the database purge commits. A
  file-cleanup failure leaves an unreferenced file for retry rather than
  restoring a domain row that claims a missing file.

Master data such as accounts and categories cannot be purged while referenced.
It is deactivated or archived instead.

ToDo continues to use its existing status transitions and terminal states.
There is no `raven todo ... purge` command.

## CLI Contract

Shared commands:

```text
raven init
raven health-check
raven import todo
raven api
raven ui
```

`raven init` creates or additively initializes all three engine databases and
the Health media directory. A domain-specific command may also initialize only
the database it requires when the other domains have not been used.

Domain command shapes:

```text
raven todo <existing-todo-command> ...

raven ledger entry add|list|show|update|archive|restore|purge ...
raven ledger transfer ...
raven ledger account ...
raven ledger category ...
raven ledger currency ...
raven ledger reports ...
raven ledger doctor
raven ledger export ...

raven health diet add|list|show|update|archive|restore|purge ...
raven health bowel add|list|show|update|archive|restore|purge ...
raven health medication add|list|show|update|archive|restore|purge ...
raven health metric add|daily-upsert|list|show|update|archive|restore|purge ...
raven health timeline ...
raven health trends ...
```

Commands accept explicit flags or `--json`. Natural-language input is rejected.
Reads support `--format table|json`; human-readable tables are the default.
Mutation JSON output uses stable DTOs suitable for agent workflows.

## HTTP API and Local Security

The composed API is versioned:

```text
/healthz
/api/v1/todo/*
/api/v1/ledger/*
/api/v1/health/*
/api/v1/dashboard
```

`raven ui` binds to `127.0.0.1:3002` by default and serves the bundled UI and
API from one origin. It creates an ephemeral session token and installs it in
an HTTP-only, SameSite-strict browser cookie. This avoids a permanent embedded
secret and avoids cross-origin configuration.

Standalone `raven api` requires a bearer token supplied through an environment
variable or permissions-checked token file. Configuration names are
`RAVEN_API_TOKEN`, `RAVEN_API_TOKEN_FILE`, `RAVEN_API_BIND_HOST`,
`RAVEN_API_BIND_PORT`, and `RAVEN_API_ALLOW_UNSAFE_CLEARTEXT`. Tokens are never
accepted as CLI arguments. Non-loopback cleartext binding is rejected unless
the operator explicitly enables the unsafe bind.

The Dashboard endpoint returns an independently tagged projection for each
engine. Failure in one projection produces an error state for that domain
instead of failing the entire response.

## UI Information Architecture

The UI uses English labels:

```text
Dashboard
ToDo
  Workspace
  Planner
Ledger
  Transactions
  Accounts
  Categories
  Reports
Health Journal
  Timeline
  Diet
  Bowel
  Medication
  Health Metrics
  Trends
```

There are no generic Ledger or Health Journal `Overview` pages. Clicking the
Ledger parent opens Transactions; clicking Health Journal opens Timeline.
Domain analytics use explicit Reports and Trends pages.

Only one top-level workspace expands at a time. The selected leaf remains
active. Existing ToDo Workspace and Planner behaviors remain intact.

### Root Dashboard

The root Dashboard combines compact read-only cards:

- today's ToDo progress and next actions
- current-period income, expense, and cash-flow summary
- recent condition, sleep, bowel, medication, and diet-tag snapshot
- recent cross-domain activity

Detailed finance analysis stays in Reports. Detailed health correlations and
charts stay in Trends.

Quick Add first selects ToDo, Ledger, or Health Journal and then opens the
owning domain's structured form. Domain tables reuse the existing UI patterns
for filtering, sorting, inline editing, details, confirmations, empty states,
and error feedback.

Responsive mode collapses the sidebar into a drawer and stacks Dashboard
cards. It does not remove mutation or detail capabilities.

## ToDo Data Import

Raven does not import the existing MoneyManager JSON/JSONL data or the existing
Health Tracker JSON data. Those systems begin with new Raven SQLite databases.

Current ToDo data may be carried forward explicitly:

```text
raven import todo
```

The command:

1. Resolves the source `~/.todo-engine/todo.sqlite` and destination
   `~/.raven/todo.sqlite`; `--source-home` supports an existing nondefault ToDo
   home.
2. Refuses to overwrite an existing destination.
3. Copies the database without modifying the source.
4. Opens the copy through the Raven ToDo schema initializer.
5. Runs schema/health validation and verifies the copied file.
6. Reports the source and destination paths without exposing record content.

Tests and smoke checks always use throwaway data homes and never target the
live source database.

## Errors and Logging

Error mappings are shared across engines:

| Error | CLI exit | HTTP |
| --- | ---: | ---: |
| Validation or policy | 2 | 400 |
| Conflict or invalid state transition | 2 | 409 |
| Not found | 4 | 404 |
| Storage or internal | 1 | 500 |

JSON errors use:

```json
{
  "code": "stable_machine_code",
  "message": "safe human-readable message",
  "fields": {},
  "request_id": "uuid"
}
```

Database mutation and audit insertion share one transaction. Paired transfers
share one transaction. Health uploads validate into a temporary file, move it
to its generated final path, and then commit its database record; a failed
database write removes the newly finalized file.

Structured logs include engine, operation, request ID, duration, result class,
and safe record identity. They do not include transaction content, notes,
amounts, health values, image bytes, authorization tokens, or raw mutation
payloads.

## Testing

### Domain tests

- Currency precision and minor-unit conversion
- Entry-type and reference validation
- Atomic paired transfers and derived balances
- Meal type and tag normalization
- Bristol scale, medication, weight, sleep, lab, and symptom validation
- Same-day metric upsert
- Ledger/Health archive, restore, purge, and confirmation policy

### Repository integration tests

- Additive schema initialization and indexes
- Record plus audit-event atomicity
- Soft-delete query visibility
- Ledger/Health restore and purge behavior
- Referenced master-data protection
- SQLite busy/concurrent-write behavior
- Media metadata and cleanup retry behavior

### Interface contract tests

- CLI and HTTP produce the same policy result for equivalent input.
- Exit codes and HTTP mappings follow the shared error table.
- JSON DTOs remain stable for agents and the frontend.
- Dashboard projection failure is isolated to one domain.
- Standalone API authentication and bind restrictions are enforced.

### UI tests

- Revised sidebar navigation and parent default leaves
- Global Dashboard composition and partial-failure cards
- Structured Quick Add forms
- Ledger transaction, account, category, and report surfaces
- Health Timeline, Diet, Bowel, Medication, Metrics, and Trends surfaces
- Ledger/Health archive, restore, purge confirmation, loading, empty, and
  error states
- Responsive sidebar and stacked Dashboard layout

### Regression and packaging gates

- All existing ToDo unit, integration, end-to-end, and frontend tests remain
  green.
- Ledger fixtures from the Rust SQLite source engine verify feature parity.
- Health API/use-case fixtures verify category validation, daily upsert, image
  validation, and trend summaries.
- `raven import todo` is tested only against temporary source and destination
  homes.
- macOS, Linux, and Windows packaging verifies the native binary and bundled UI
  artifact.
- Workspace gates remain `cargo fmt --check`, `cargo test`, and
  `cargo clippy --all-targets --all-features -- -D warnings`, with frontend
  tests, type checking, and production build added to the release gate.

## Implementation Boundaries

The work is decomposed in dependency order:

1. Establish Raven naming, shared data-home/configuration, and the top-level
   binary without changing ToDo behavior.
2. Move the existing ToDo adapters behind `raven todo` and add safe ToDo import.
3. Incorporate and adapt the Rust Ledger engine to Raven policy, lifecycle,
   audit, and packaging conventions.
4. Build the Rust Health engine and SQLite repository from the Health Tracker
   behavior baseline.
5. Compose the versioned API and failure-isolated Dashboard projections.
6. Extend the frontend shell, domain workspaces, structured forms, Reports,
   Trends, and unified Dashboard.
7. Rename and validate npm distribution and release artifacts.

Each boundary must leave existing completed behavior testable. No phase may
temporarily route mutations around an engine service.

## Non-Goals

- Importing production Ledger JSON/JSONL records.
- Importing production Health Tracker JSON records.
- Natural-language transaction or health parsing.
- Multi-user tenancy or remote account authentication.
- Writing back to MoneyManager, PocketBase, Cloudflare R2, or Second_Brain.
- Inferring cross-currency exchange rates.
- Claiming medical causation from diet/symptom correlations.
- Combining all domains into one SQLite database.
- Preserving `oracle-todo` as an additional executable or npm runtime alias.
