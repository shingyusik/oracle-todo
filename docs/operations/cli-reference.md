# CLI Reference

The binary is `todo-engine`. Invoke as `cargo run -p todo-engine -- <subcommand> [args]` (or
the built binary directly). This reference is verified against `todo-engine/src/interfaces/cli/mod.rs`.

## Global flag

- `--home <path>` (env `TODO_ENGINE_HOME`, including from `.env`) — data home. See
  [data-home.md](data-home.md).

Every run emits tracing logs to stderr and to the rotating JSONL file log (see
[logging-and-rotation.md](logging-and-rotation.md)). Created/updated items are printed as a
single JSON line on stdout; view commands print rendered Markdown.

## System commands

| Subcommand | Purpose | Output |
| --- | --- | --- |
| `init` | Create the data home and the SQLite schema. | `initialized <db>` |
| `health` | Check DB reachability and schema baseline. | `ok db=<db> user_version=<n>` |
| `api` | Serve the HTTP API. Flags: `--host` (default `127.0.0.1`), `--port` (default `3002`). | `serving http://<host>:<port>` |

## Creation commands

### `area create <title>`
Create an active area. Flags: `--review-cycle`, `--standard`, `--note`.

### `project propose <title>`
Create an active project. `--definition-of-done` is required and must be non-blank; otherwise
the command exits `2` with `Project requires definition_of_done`. Other flags: `--area`,
`--outcome`, `--due`, `--note`, `--actor` (default `agent`).

### `task propose <title>`
Create an active task. Flags: `--area`, `--due`, `--scheduled`, `--priority <int>`, `--description`,
`--note`, `--actor` (default `agent`).

### `goal propose <title>`
Create an active goal. Required flags: `--horizon`, `--scheduled`. Other flags: `--parent`,
`--note`, `--actor` (default `agent`).

### `routine propose <title>`
Create an active routine. `--recurrence-rule` is required and must be non-blank; otherwise
the command exits `2` with `Routine requires recurrence_rule`. Other flags: `--area`,
`--project-id`, `--description`, `--priority <int>`, `--tag <tag>` (repeatable),
`--materialization-policy` (default `single_open`), `--future-occurrences <int>` (default `7`,
range `1..=365`), `--note`, `--actor` (default `agent`).

### `routine materialize`
Fill every active routine to its stored target. Prints each created task as JSON, or
`No routine tasks materialized`. Routine creation stores the active template without creating
tasks. After materialization creates tasks, completing one replenishes its active routine.

To materialize a single routine instead of sweeping all of them, use
`POST /routines/{id}/materialize` (see [api-reference.md](api-reference.md)).

### `event propose <title> <scheduled>`
Create an active event. `<scheduled>` is a positional date/time string. Flags: `--area`,
`--project-id`, `--due`, `--priority <int>`, `--description`, `--note`, `--location`,
`--with <participant>` (repeatable), `--commitment-type` (default `appointment`),
`--actor` (default `agent`).

> `--actor` accepts `agent`, `user`, or `system`; every actor creates `active` work. The
> compatible `propose` command name is retained for callers and does not imply a waiting state.

## Lifecycle (transition) commands

Each takes a positional `<item_id>` and an optional `--reason`:

`pause`, `resume`, `complete`, `archive`, `drop`, `cancel`.

| Subcommand | Effect |
| --- | --- |
| `pause` | Pause an item. |
| `resume` | Resume a paused item. |
| `complete` | Complete an item (terminal). |
| `archive` | Archive an item (terminal). |
| `drop` | Drop an item (terminal). |
| `cancel` | Cancel an item (terminal). |

### `update <item_id>`
Update mutable fields. Flags (all optional): `--title`, `--description`, `--note`,
`--outcome`, `--definition-of-done`, `--standard`, `--review-cycle`, `--recurrence-rule`,
`--materialization-policy`, `--future-occurrences`, `--area`, `--project-id`, `--parent-id`,
`--routine-id`, `--due`, `--scheduled`,
`--priority <int>`, `--tag <tag>` (repeatable), `--reason`.

## View commands

| Subcommand | Output |
| --- | --- |
| `list` | List items as Markdown. Filter flags: `--status`, `--type`, `--area-id`, `--project-id`, `--routine-id`, `--query`, `--include-archived`. |
| `archive-list` | List terminal/archive items as Markdown. |
| `pending` | Show active work as Markdown. |
| `today` | Show today's task view as Markdown. |
| `agenda <date>` | Return scheduled or due items for one date as a JSON array. |
| `date-range <from> <to>` | Return items in an inclusive date range as a JSON array. |
| `period --horizon <year\|month\|week> --period <date>` | Return the goal-tree period view as JSON. |

`--status` accepts: `active`, `waiting`, `paused`, `completed`,
`cancelled`, `dropped`, `archived`, `someday`, `rejected`. `--type` accepts: `area`,
`project`, `routine`, `task`, `event`, `review`, `archive_item`, `goal`. Invalid values are rejected
with a helpful message and a validation exit code.

## Exit codes

Policy/validation → `2`; not-found → `4`; conflict → `2`; storage/migration/internal → `1`;
success → `0`.
See [../conventions/error-handling.md](../conventions/error-handling.md).
