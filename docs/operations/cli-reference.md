# CLI Reference

The binary is `todo-engine`. Invoke as `cargo run -p todo-engine -- <subcommand> [args]` (or
the built binary directly). This reference is verified against `todo-engine/src/interfaces/cli/mod.rs`.

## Global flag

- `--home <path>` (env `TODO_ENGINE_HOME`) — data home. See [data-home.md](data-home.md).

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
Propose a project. Flags: `--area`, `--definition-of-done`, `--outcome`, `--due`, `--note`,
`--actor` (default `agent`).

### `task propose <title>`
Propose a task. Flags: `--area`, `--due`, `--scheduled`, `--priority <int>`, `--description`,
`--note`, `--actor` (default `agent`).

### `routine propose <title>`
Propose a routine. Flags: `--area`, `--recurrence-rule`, `--materialization-policy`
(default `single_open`), `--note`, `--actor` (default `agent`).

### `routine materialize`
Materialize due routine tasks. Flags: `--now <date>` (defaults to today's local date),
`--lookahead-days <int>` (default `7`), `--catchup-days <int>` (default `1`). Prints each
created task as JSON, or `No routine tasks materialized`.

### `event propose <title> <scheduled>`
Propose an event. `<scheduled>` is a positional date/time string. Flags: `--area`,
`--project-id`, `--due`, `--priority <int>`, `--description`, `--note`, `--location`,
`--with <participant>` (repeatable), `--commitment-type` (default `appointment`),
`--actor` (default `agent`).

> `--actor` accepts `agent`, `user`, or `system`. A `user` actor auto-approves the created
> item; any other actor leaves it `proposed` (see
> [../architecture/decisions/adr-0003-approval-gating.md](../architecture/decisions/adr-0003-approval-gating.md)).

## Lifecycle (transition) commands

Each takes a positional `<item_id>` and an optional `--reason`:

`approve`, `activate`, `pause`, `resume`, `complete`, `archive`, `drop`, `cancel`.

| Subcommand | Effect |
| --- | --- |
| `approve` | Approve a proposed item. |
| `activate` | Activate an approved or user-created item. |
| `pause` | Pause an item. |
| `resume` | Resume a paused item. |
| `complete` | Complete an item (terminal). |
| `archive` | Archive an item (terminal). |
| `drop` | Drop an item (terminal). |
| `cancel` | Cancel an item (terminal). |

### `update <item_id>`
Update mutable fields. Flags (all optional): `--title`, `--description`, `--note`,
`--outcome`, `--definition-of-done`, `--standard`, `--review-cycle`, `--recurrence-rule`,
`--materialization-policy`, `--area`, `--project-id`, `--routine-id`, `--due`, `--scheduled`,
`--priority <int>`, `--reason`.

## View commands

| Subcommand | Output |
| --- | --- |
| `list` | List items as Markdown. Filter flags: `--status`, `--type`, `--area-id`, `--project-id`, `--routine-id`, `--query`, `--include-archived`. |
| `archive-list` | List terminal/archive items as Markdown. |
| `pending` | Show proposed/approved/active work as Markdown. |
| `today` | Show today's task view as Markdown. |

`--status` accepts: `proposed`, `approved`, `active`, `waiting`, `paused`, `completed`,
`cancelled`, `dropped`, `archived`, `someday`, `rejected`. `--type` accepts: `area`,
`project`, `routine`, `task`, `event`, `review`, `archive_item`. Invalid values are rejected
with a helpful message and a validation exit code.

## Exit codes

Policy/validation → `2`; not-found → `4`; storage/migration/internal → `1`; success → `0`.
See [../conventions/error-handling.md](../conventions/error-handling.md).
