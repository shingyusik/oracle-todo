# CLI Reference

[한국어](cli-reference.ko.md)

The native command is `raven`. Inputs are structured flags or schema-validated JSON; Raven
does not parse natural-language journal text.

## Global options

```text
raven [--home <path>] [--error-format text|json] [--request-key <key>] <command>
```

`--home` overrides `RAVEN_HOME` and the default `$HOME/.raven`. Windows uses
`%USERPROFILE%/.raven` when `HOME` is absent or empty. It may precede any native command.
Help does not require a data home and does not initialize stores or logging.

`--error-format json` emits one structured error document on stderr and suppresses
console tracing. Successful command output still follows that command's output contract.
Place global options before the domain command, especially for delegated ToDo commands.
`raven --version` prints the native executable version.

See [AI CLI usage](ai-cli-usage.md) for a complete query, update, and retry workflow.

## System commands

| Command | Behavior |
| --- | --- |
| `raven init` | Idempotently initialize all stores and Health media |
| `raven health-check` | Read-only health/schema report for all stores and media |
| `raven import todo [--source-home <path>]` | Safely copy a source `todo.sqlite`; default source home is `$HOME/.todo-engine` |
| `raven api` | Serve bearer-authenticated HTTP API |
| `raven ui [--ui-path <dir>] [--port <u16>] [--no-open]` | Serve loopback UI and cookie-authenticated API |

`RAVEN_UI_PATH` supplies the UI artifact when `--ui-path` is absent.

`RAVEN_UI_PUBLIC_ORIGIN` enables the Cloudflare Access UI mode and must contain one canonical
HTTPS origin. The host must be lowercase; an optional port must be decimal `1..=65535` without
leading zeroes and must omit the default `443`. Credentials, paths, queries, fragments,
malformed ports, and an authority that resolves to the active loopback listener are rejected:

```bash
RAVEN_UI_PUBLIC_ORIGIN=https://raven.b-sir.xyz \
  raven ui --port 3001 --no-open
```

The value is validated before the listener binds; invalid public-origin configuration exits `2`
without echoing the value. The UI listener remains loopback-bound, and local Host behavior is
unchanged. Requests for the public Host require the `cloudflared`-verified Access assertion.
Top-level navigation may omit `Origin`; every supplied Origin and public API `POST`, `PUT`,
`PATCH`, or `DELETE` Origin must match exactly. The UI index and extensionless SPA fallback issue
a secure Raven session cookie, which remains mandatory on API routes; arbitrary `.html` assets
do not issue one. A request-target authority that conflicts with `Host` returns `421`. Tokens,
assertions, and cookies must not be logged.

## ToDo

`raven todo` delegates domain commands to the reusable ToDo CLI:

```text
init, health, list, show, options, table query|lookups,
area create,
project create,
goal create,
task create,
routine create|materialize,
event create,
pause, miss, postpone, resume, complete, reopen,
archive, update,
archive-list, pending, today
```

Examples:

```bash
raven todo project create "Monthly close" \
  --definition-of-done "Statements reconciled"
raven todo routine create "Morning review" \
  --recurrence-rule "RRULE:FREQ=DAILY"
raven todo task create "Call dentist" --scheduled today
raven todo list --format json --limit 100
raven todo show <item-id>
raven todo complete <item-id>
```

Projects require a non-blank `definition_of_done`; routines require a non-blank RRULE;
events require `scheduled`. ToDo uses its status lifecycle and does not expose purge.
`postpone --scheduled <date>` accepts today only for work scheduled before today; other
postpone targets must be later than today.
Use authenticated `raven api` or `raven ui` for HTTP access.
`create` creates an active item; `propose` remains a compatibility alias.
`list`, `pending`, `today`, and `archive-list` support `--format json`, `--offset`, and
`--limit`. Their JSON result is `{items,next}`; `next` is the next offset or null.
Markdown output includes item IDs. `show` returns the complete item as JSON.
`update --expected-updated-at <updated_at>` rejects stale records atomically. Use the
timestamp from `show`; omitting it keeps unconditional update behavior.
`today` only reads existing tasks; run `routine materialize` explicitly to generate
routine occurrences. Materialization returns one JSON array, including `[]` when empty.
ToDo, Ledger, and Health read commands do not create or migrate databases. Run `raven init`
before querying an uninitialized home.
Run `raven todo --help` and `raven todo <command> --help` for the complete existing flags.

`options [--type <type> | --id <item-id>]` returns JSON with fixed enums, type-specific
update fields, UI `status_choices`, and separate lifecycle `actions`. Item inspection
accounts for its current status. Read status filters include historical states; they are
not a list of writable statuses.

| Type | Status selector for open items |
| --- | --- |
| Area | `active`, `archived` |
| Task | `active`, `completed` |
| Event, Project, Routine, Goal | `active`, `paused`, `completed` |

Terminal items retain their current status. Completed Tasks and Events also allow
`active` through `reopen`. Archive and planner miss/postpone remain separate actions.
Existing historical states are retained in the selector, with only reachable transitions
offered. A paused Routine requires a recurrence rule before `active` is available.
`update --clear-priority` removes a Task, Routine, or Event priority and conflicts with
`--priority`; numeric priorities are `1..10`.

`list --query <text>` searches title, note, legacy description, and outcome with the
same Unicode case folding as UI text filters. Literal `%` and `_` remain literal.
Use `table query` for field-specific filters, sorting, and grouping.
`list --include-archived` includes statuses hidden by the default list. Use
`archive-list` to list terminal items (`completed,cancelled,dropped,archived,missed,rejected`);
`show <item-id>` also reads terminal items.

## Ledger

Top-level groups:

| Command | Operations |
| --- | --- |
| `ledger entry` | `add`, `update`, `list`, `show`, `archive`, `restore` |
| `ledger transfer` | Create an atomic idempotent paired transfer |
| `ledger transfer-show` | Show a transfer pair |
| `ledger transfer-update` | Update both sides through the atomic transfer service |
| `ledger currency` | `create`, `update`, `list` |
| `ledger account-category` | `create`, `update`, `list`, `purge` |
| `ledger account` | `create`, `update`, `list` |
| `ledger category` | `create`, `update`, `list` |
| `ledger reports` | Summary or category report for an inclusive range |
| `ledger balances` | Current account balances |
| `ledger compare` | Compare an inclusive range with the preceding equal-length range |
| `ledger audit` | Audit page for one record; alias `history` |
| `ledger doctor` | Bounded read-only consistency diagnostics |
| `ledger export` | Deterministic schema-v3 JSON export |
| `ledger table` | `query --json <body>`, `lookups --scope <scope>` |

Mutating add/create/update commands accept either `--json <object>` or field flags, not a
mixture. Dates use `YYYY-MM-DD`; timestamps use RFC 3339. Lists default to
`--offset 0 --limit 100 --format table`; `--format json` is script-friendly.

Entry example:

```bash
raven ledger entry add \
  --date 2026-07-31 --type expense --amount 12000 --currency KRW \
  --account Wallet --category Food --content Lunch
raven ledger entry list --from 2026-07-01 --to 2026-07-31 --format json
```

Transfer example:

```bash
raven ledger transfer \
  --operation-key 018f31c0-5c2a-4e75-9c18-a14d7bddb2a1 \
  --date 2026-07-31 --amount 10000 --currency KRW \
  --from-account Checking --to-account Savings --content Transfer
```

The operation key is a canonical UUID v4. Retrying the same operation is idempotent.

`transfer-update <group-id> --json <object>` replaces the paired transfer's date,
content, accounts, amount, currency, and notes through the transfer service. The strict
object requires `date`, `content`, `from_account`, `to_account`, `amount` (a decimal
string), and `currency`. Optional field is `notes`; omitting
`notes` clears it. Both entry amounts change atomically.

```bash
raven ledger transfer-update <group-id> --json \
  '{"date":"2026-09-30","content":"Savings","from_account":"Checking","to_account":"Savings","amount":"10000","currency":"KRW"}'
```

### Ledger lifecycle

Entries support `archive <id>` and `restore <id>`. Master data uses
`update --active <true|false>`. Only account-category purge is exposed; preview first,
then repeat with `--confirm <confirmation-id>`. Audit history remains available.
`entry list --include-archived` includes archived entries in search results. The list
contains their complete CLI record; `entry show` reads only non-archived entries.
Entry source, actor, and written timestamp are assigned by the adapter. Adjustment
records remain readable; creation and conversion to adjustment types are rejected.
Manual entry add/update type choices are `expense` and `income`; create transfers through
`ledger transfer`. Read filters also support historical transfer and adjustment types.
Currency, account-category, account, and category lists accept `--query <text>` and
`--include-inactive`. Name/code search uses Unicode case folding and filters before
pagination; inactive records remain available for recovery without becoming active choices.

## Health Journal

| Command | Operations |
| --- | --- |
| `health diet` | `add`, `update`, `list`, `show`, `archive`, `restore` |
| `health bowel` | same lifecycle |
| `health medication` | same lifecycle |
| `health metric` | `daily-upsert`, `list`, `show`, `archive`, `restore` |
| `health reports` | Report for explicit inclusive `--from` and `--to` dates |
| `health audit` | Paginated audit history for a record |
| `health table` | `query --json <body>`, `lookups --scope <scope>` |

Create/update commands accept strict `--json` or typed flags. Timestamps use RFC 3339.
Mutation JSON rejects unknown fields.

```bash
raven health diet add \
  --at 2026-07-31T12:00:00+09:00 --meal lunch --food "Rice bowl" \
  --tags rice,vegetables --image ./meal.jpg
raven health medication add \
  --at 2026-07-31T08:00:00+09:00 --name Vitamin-D --dose 1 --unit tablet
raven health metric daily-upsert \
  --json '[{"at":"2026-07-31T07:00:00+09:00","category":"weight","key":"body_weight","name":"Body weight","value":70.2,"unit":"kg"}]'
raven health reports --from 2026-07-01 --to 2026-07-31 --format json
raven health audit health_event <id> --limit 100 --format json
```

Daily metrics use fixed UTC+09:00 dates and canonical weight, sleep, CRP, fecal calprotectin, and overall-condition identities. Existing daily values require `expected_updated_at` when replaced. Per-metric notes are absent; overall condition uses `condition_note`.

Meal choices are `breakfast,lunch,dinner,snack,late_night`. Medication units are
`tablet,capsule,packet,mg,g,ml,drop,dose`. Metric category filters accept only
`weight,sleep,lab,symptom`; Bowel and Medication use their own commands.
Diet, Bowel, and Medication lists accept inclusive `--from`/`--to` dates in UTC+09:00.
Diet also accepts `--food`, `--meal`, and comma-separated `--tags`; Medication accepts
`--name` and `--unit`. These filters use the UI table service. Daily metric date/value
filters use `health table query`; `metric list` retains individual historical records.

Health audit record types are `diet_entry`, `health_event`, and `media_file`. Audit JSON has
`items` with RFC 3339 occurrence timestamps, before/after snapshots, and reasons. Reports
JSON returns the complete report projection; the table view summarizes record counts.

Health archive/restore accept optional `--expected-updated-at <RFC3339>` for optimistic
concurrency. The public Health CLI does not expose purge. Archived and legacy records remain
available for inspection and supported restore operations in the UI.
Health lists omit archived records and have no `--include-archived` flag. Use the matching
`diet|bowel|medication|metric show <id> --format json` command to inspect a known archived
record, and `health audit <record-type> <id> --format json` for its audit history.

## UI table queries and choice lookups

All three domains expose `table query --json <body>` and `table lookups --scope <scope>`.
Query JSON uses the same validated schema, filters, sorts, groups, and projections as the
corresponding UI table API. Query pages return `{items,next_offset}`; pass `next_offset`
back as JSON `offset`, keeping the other conditions. Ordinary list pages use `{items,next}`.
Run the command's `--help` for schema and examples; the API reference defines each scope's
fields and operators.
Each query accepts at most 50 filters and a page limit of `1..50` (default 50).
Ledger queries require 1..10 sort rules; ToDo and Health accept 0..10. Each rule has a scope-specific
`field` and `direction` (`asc` or `desc`).
`filters` combine with `filter_mode: "and"` or `"or"`. `sorts` apply in their array order.
`group_by` accepts one grouping field supported by the scope; `group_settings` controls
group order and visibility. Table queries follow the selected UI scope's visibility:
ToDo Workspace and linked tables hide `archived,dropped,cancelled`; Planner work tables
also hide `rejected`, while Planner goal tables exclude all terminal statuses.
Completed and missed work can remain visible. Ledger/Health tables omit archived records.

| Domain | Scopes |
| --- | --- |
| ToDo | `workspace.area/project/goal/routine/task/event`, plus the UI planner and linked scopes |
| Ledger | `ledger.transactions`, `ledger.accounts`, `ledger.categories` |
| Health | `health.diet`, `health.bowel`, `health.medication`, `health.metrics` |

Lookups return UI choice IDs and labels. ToDo returns `{items}`; Ledger and Health return
scope-specific lookup maps. ToDo accepts `--id <item-id>` to exclude invalid current-item
relations and `--horizon week|month|year` for Goal parent choices at a proposed horizon.
Goal parents must be non-terminal, strictly coarser, and must not create a cycle.

```bash
raven todo options --type task
raven todo options --id <item-id>
raven todo table lookups --scope workspace.task
raven todo table lookups --scope workspace.goal --id <goal-id> --horizon month
raven health table lookups --scope health.medication
raven ledger table lookups --scope ledger.transactions
```

## Output and exit codes

- Successful mutations print compact JSON.
- Reads default to tabular output where supported; use `--format json`.
- User results go to stdout. Errors and console logs go to stderr.

Paginated CLI lists and audit history return `{items,next}` in JSON mode. `next` is the
next numeric offset or null; reuse the same filters and limit. This includes Health diet,
bowel, medication, metric, and audit lists, and Ledger lists and audit history.
Reports and single-record reads retain their own object shapes. Offset pages are not a
snapshot: concurrent inserts or removals can move records between pages.

With `--error-format json`, stderr contains a single object with `code`, `message`,
`fields`, `committed`, and `retryable`; committed cleanup failures also include
`record_id`. `committed` is true after a committed mutation, false for a known rejected
request, and null when the outcome is unknown. Do not automatically repeat a mutation
when `committed` is true or null. Help and version remain successful text output.

| Exit | Meaning |
| --- | --- |
| `0` | Success, including clap help/version output |
| `2` | Validation, policy, conflict, unsafe configuration, or confirmation mismatch |
| `4` | Record not found |
| `1` | Storage, migration, cleanup, import integrity, or internal failure |

## Safe creation retries

Use a stable `--request-key` before the domain command when creating a record:

```bash
raven --error-format json --request-key dentist-2026-09-30 \
  todo task create "Call dentist" --scheduled today
raven --error-format json --request-key lunch-2026-09-30 \
  health diet add --at 2026-09-30T12:00:00+09:00 --meal lunch --food Rice
```

The same key and exact argument payload replay the original stdout without creating
another record. Reusing a key with different arguments fails with `request_key_conflict`.
Keys contain 1–128 ASCII letters, digits, `-`, `_`, `.`, or `:`. Receipts belong to one
data home and are stored in `retry.sqlite`; argument order and creation aliases are part
of the payload. Omit the key only when a duplicate creation is intentional or the caller
can reconcile an uncertain result itself.

Keyed child execution defaults to 120 seconds; `--request-timeout-seconds <1..3600>`
overrides the limit and requires a request key. Timeout returns `request_timeout` with
`committed: null` and preserves the pending receipt. The timeout is not part of payload identity.

Supported operations are ToDo area/item creation, Ledger entry/master-data creation,
and Health diet/bowel/medication add. Reads, updates, lifecycle commands, and
daily metric upsert do not accept request keys. Ledger transfers use their existing
`--operation-key` instead.

A pending receipt after interruption returns `request_outcome_unknown` and does not run
the mutation again. Inspect domain records before using a new key. Keep `retry.sqlite`
with backups that will be used to resume keyed requests; deleting the receipt history
removes duplicate protection. The receipt and domain databases do not share a transaction.
