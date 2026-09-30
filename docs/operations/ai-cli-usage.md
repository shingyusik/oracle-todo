# AI CLI Usage

Use one `raven` executable and an explicit data home. Put wrapper options before the
domain command. Capture stdout, stderr, and exit code separately.

## Initialize and query

Initialize a new home once. Reads do not initialize missing stores.

```bash
raven --home ./raven-data --error-format json init
raven --home ./raven-data --error-format json todo list --format json --limit 100
raven --home ./raven-data --error-format json todo show <item-id>
```

Paginated lists return `{items,next}`. Pass a numeric `next` as `--offset`, preserving
filters and limit; stop at null. Concurrent mutations can shift pages; deduplicate by ID
when collecting records while another writer is active. Single-record reads and reports
retain command-specific shapes.

`todo today` reads existing occurrences. Generate routine tasks explicitly with
`todo routine materialize`, which returns one JSON array. Initialization, health checks,
help, and version remain text even with `--error-format json`.

## Create and update

Assign one stable request key to each intended creation. A retry uses the exact same
arguments, including order. A different creation needs a new key.

```bash
raven --home ./raven-data --error-format json --request-key dentist-2026-09-30 \
  todo task create "Call dentist" --scheduled today
raven --home ./raven-data --error-format json todo show <item-id>
raven --home ./raven-data --error-format json todo update <item-id> \
  --expected-updated-at <updated_at-from-show> --title "Call dentist tomorrow"
```

Use `--expected-updated-at` for ToDo updates and supported Health mutations. On conflict,
read again and reconcile before updating. Omitting the timestamp permits an unconditional
update. Preserve the original `updated_at` JSON string; do not pass a locale-formatted
date produced by a shell's automatic date conversion. Ledger transfers use
`--operation-key` instead of the wrapper request key.

## Errors and retries

Exit zero means success; parse stdout according to the command contract.
With `--error-format json`, a failed command emits one JSON error on stderr.

| Result | Action |
| --- | --- |
| Exit 2, validation error | Inspect `fields`; correct input and retry when `committed` is false |
| Exit 4, not found | Refresh the record ID or lookup |
| `committed: true` | Inspect the committed record and cleanup state; do not repeat creation |
| `committed: null` | Inspect records before another mutation |
| `request_key_conflict` | Recover original arguments; do not repurpose the key |
| `request_outcome_unknown` or `request_timeout` | Reconcile records before using a new key |

Keyed child execution defaults to 120 seconds. Use `--request-timeout-seconds <1..3600>`
before the domain command to change it. Timeout stops the child and preserves the pending
receipt. Process termination does not prove the mutation rolled back. Timeout settings
do not affect payload identity. Preserve `retry.sqlite` in backups used for keyed requests.

Read the [CLI reference](cli-reference.md) or run `raven <domain> <command> --help` for
complete flags. JSON input uses existing command-line `--json` arguments.
