# AI CLI Usage

[한국어](ai-cli-usage.ko.md)

Use one `raven` executable and an explicit data home. Put wrapper options before the
domain command. Capture stdout, stderr, and exit code separately.

## Codex skills

The Raven skill bundle contains four skills in the repository's root `skills/` directory.
After installing the bundle, invoke one explicitly with its name in a Codex message:

| Skill | Use |
| --- | --- |
| `$raven-cli` | CLI discovery, choices, detailed queries, output, and retry rules |
| `$raven-todo` | ToDo items, relations, recurrence, and lifecycle changes |
| `$raven-ledger` | Entries, master data, transfers, balances, and reports |
| `$raven-health` | Diet, bowel, medication, canonical daily metrics, and reports |

The `skills/` directory is the source of truth and is versioned with the application code.
Copy all four folders together into the target environment's skill directory when needed;
the repository does not install them automatically. For Codex, use the target project's
`.codex/skills/` or the user's `$CODEX_HOME/skills` (default `~/.codex/skills`). Bundled
references are self-contained; domain skills share the `raven-cli` instructions and references.
The skills use an existing Raven executable and data home, verify the installed CLI's
help, and do not initialize or upgrade Raven merely to fulfill a read request.

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

## Discover choices and search

Use `--help` before constructing inputs. ToDo exposes machine-readable type and
current-item choices:

```bash
raven todo options --type task
raven --home ./raven-data todo options --id <item-id>
raven --home ./raven-data todo table lookups --scope workspace.task
raven --home ./raven-data todo table lookups --scope workspace.goal --id <goal-id> --horizon month
```

`status_choices` matches the UI status selector; `actions` includes separate lifecycle
operations. Historical read statuses do not imply those statuses can be assigned.
Use lookup IDs for relation selection. Goal lookups exclude terminal, equal/finer-period,
self, and cyclic parents; pass the proposed horizon when changing the period.

ToDo `list --query` uses case-insensitive literal text search. Ledger master lists support
`--query` and `--include-inactive`. Health lists support dates and domain-specific food,
tag, name, meal, or unit filters. For the full UI search surface, use the domain's
`table query --json` command:

```bash
raven --home ./raven-data todo table query --json \
  '{
    "scope":"workspace.task",
    "filter_mode":"and",
    "filters":[
      {"field":"title","operator":"contains","value":{"text":"dentist"}},
      {"field":"due","operator":"is_between","value":{"range":{"start":"2026-10-01","end":"2026-10-31"}}}
    ],
    "sorts":[{"field":"priority","direction":"asc"},{"field":"due","direction":"asc"}],
    "group_by":"project",
    "group_settings":{"sort":"alphabetical","hide_empty":true,"manual_order":[],"hidden_group_keys":[]},
    "context":{}
  }'
```

Table query pages use `{items,next_offset}`. Ordinary lists use `{items,next}`.
Keep filters, sorts, grouping, and context unchanged between pages.
The example combines title and due-date filters, sorts by priority then due date, and
groups by project. Use `filter_mode: "or"` to match either condition. Queries allow at
most 50 filters, a page limit of `1..50`, and at most 10 sort rules. Ledger requires at
least one sort rule; ToDo and Health accept an empty sort list.

Table queries follow the selected UI scope's visibility; completed and missed ToDo work
can remain visible. Ledger/Health tables omit archived records. To search earlier inputs
including archived ToDo or Ledger records:

```bash
raven --home ./raven-data todo list --query dentist --include-archived --format json
raven --home ./raven-data todo archive-list --format json
raven --home ./raven-data ledger entry list --content Lunch --include-archived --format json
```

ToDo `show` reads terminal items. Ledger's list includes the full CLI record, while
`entry show` reads only non-archived entries. Health lists have no archive-inclusion flag;
inspect a known archived ID with the matching `health diet|bowel|medication|metric show`
command and `--format json`. Use `health audit <record-type> <id> --format json` for Health
audit history; `history` is an alias only for Ledger audit.

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
`todo update --clear-priority` clears a priority; omitting priority flags preserves it.

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
