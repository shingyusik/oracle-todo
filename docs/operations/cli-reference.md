# CLI Reference

The native command is `raven`. Inputs are structured flags or schema-validated JSON; Raven
does not parse natural-language journal text.

## Global option

```text
raven [--home <path>] <command>
```

`--home` overrides `RAVEN_HOME` and the default `$HOME/.raven`. It may precede any native
command.

## System commands

| Command | Behavior |
| --- | --- |
| `raven init` | Idempotently initialize all stores and Health media |
| `raven health-check` | Read-only health/schema report for all stores and media |
| `raven import todo [--source-home <path>]` | Safely copy a source `todo.sqlite`; default source home is `$HOME/.todo-engine` |
| `raven api` | Serve bearer-authenticated HTTP API |
| `raven ui [--ui-path <dir>] [--port <u16>] [--no-open]` | Serve loopback UI and cookie-authenticated API |

`RAVEN_UI_PATH` supplies the UI artifact when `--ui-path` is absent.

## ToDo

`raven todo` delegates domain commands to the reusable ToDo CLI:

```text
init, health, list,
area create,
project propose,
goal propose,
task propose,
routine propose|materialize,
event propose,
pause, miss, postpone, resume, complete,
archive, drop, cancel, update,
archive-list, pending, today, agenda, date-range, period
```

Examples:

```bash
raven todo project propose "Monthly close" \
  --definition-of-done "Statements reconciled"
raven todo routine propose "Morning review" \
  --recurrence-rule "RRULE:FREQ=DAILY"
raven todo task propose "Call dentist" --scheduled today
raven todo complete <item-id>
```

Projects require a non-blank `definition_of_done`; routines require a non-blank RRULE;
events require `scheduled`. ToDo uses its status lifecycle and does not expose purge.
`raven todo api` is explicitly unsupported; use authenticated `raven api` or `raven ui`.
Reopening a completed task or event is available through the ToDo HTTP API, not the CLI.
Run `raven todo --help` and `raven todo <command> --help` for the complete existing flags.

## Ledger

Top-level groups:

| Command | Operations |
| --- | --- |
| `ledger entry` | `add`, `update`, `list`, `show`, `archive`, `restore`, `purge` |
| `ledger transfer` | Create an atomic idempotent paired transfer |
| `ledger transfer-show` | Show a transfer pair |
| `ledger currency` | `create`, `update`, `list`, `purge` |
| `ledger account-category` | `create`, `update`, `list`, `purge` |
| `ledger account` | `create`, `update`, `list`, `purge` |
| `ledger category` | `create`, `update`, `list`, `purge` |
| `ledger reports` | Summary, account, or category report for an inclusive range |
| `ledger balances` | Current account balances |
| `ledger briefing` | Concise inclusive-range briefing |
| `ledger compare` | Compare two explicit inclusive ranges |
| `ledger audit` | Audit page for one record; alias `history` |
| `ledger doctor` | Bounded read-only consistency diagnostics |
| `ledger export` | Deterministic schema-v3 JSON export |

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

### Ledger archive, restore, and purge

```bash
raven ledger entry archive <id>
raven ledger entry restore <id>
raven ledger entry purge <id>
# inspect confirmation_id, then:
raven ledger entry purge <id> --confirm <confirmation-id>
```

The first purge invocation prints a preview and exits `2`. Master-data purge follows the
same preview/confirm contract. Confirmation must match exactly. Purge removes the record but
not its audit events; transfer entry preview/purge covers the linked pair. Archive and
restore apply only to entries. Ledger master data uses `update --active <true|false>` and
preview/confirmed purge.

## Health Journal

| Command | Operations |
| --- | --- |
| `health diet` | `add`, `update`, `list`, `show`, `archive`, `restore`, `purge` |
| `health bowel` | same lifecycle |
| `health medication` | same lifecycle |
| `health metric` | `add`, `daily-upsert`, `update`, `list`, `show`, lifecycle commands |
| `health timeline` | Combined paginated diet/event timeline |
| `health trends` | Bounded trends; default `--days 30` |

Create/update commands accept strict `--json` or typed flags. Timestamps use RFC 3339.
Mutation JSON rejects unknown fields.

```bash
raven health diet add \
  --at 2026-07-31T12:00:00+09:00 --meal lunch --food "Rice bowl" \
  --tags rice,vegetables --image ./meal.jpg
raven health medication add \
  --at 2026-07-31T08:00:00+09:00 --name Vitamin-D --dose 1 --unit tablet
raven health metric daily-upsert \
  --json '[{"at":"2026-07-31T07:00:00+09:00","category":"weight","key":"body_weight","name":"Weight","value":70.2,"unit":"kg"}]'
raven health timeline --limit 50 --format json
```

Health archive/restore accept optional `--expected-updated-at <RFC3339>` for optimistic
concurrency. Health CLI purge prints `{"confirmation_id":"<id>"}` without `--confirm`, exits
`2`, and succeeds only when the same ID is repeated:

```bash
raven health diet purge <id>
raven health diet purge <id> --confirm <confirmation-id>
```

## Output and exit codes

- Successful mutations print compact JSON.
- Reads default to tabular output where supported; use `--format json`.
- User results go to stdout. Errors and console logs go to stderr.

| Exit | Meaning |
| --- | --- |
| `0` | Success, including clap help/version output |
| `2` | Validation, policy, conflict, unsafe configuration, or confirmation mismatch |
| `4` | Record not found |
| `1` | Storage, migration, cleanup, import integrity, or internal failure |
