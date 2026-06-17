# De-Oracle / De-Hermes Rebrand — Design

**Date:** 2026-06-17
**Status:** Approved for planning
**Scope:** Remove every `oracle` and `hermes` identifier from the codebase — domain actor, persisted DB value, schema default, data-home path, branding, and current-state docs. Existing data is left intact (defaults change + warn; no auto-migration).

## Decisions (locked)

| Topic | Decision |
| --- | --- |
| `Actor::Oracle` | → `Actor::Agent`; wire value `"oracle"` → `"agent"` |
| Migration strategy | **Defaults change + warn.** No auto data rewrite, no auto dir move. Warn when a legacy home is detected. Existing DBs need a documented one-time manual `UPDATE`. |
| Branding | Remove **both** Oracle and Hermes from product prose |
| Data-home default | `~/.hermes/oracle-todo/` → **`~/.todo-engine/`** (db `~/.todo-engine/todo.sqlite`, logs `~/.todo-engine/logs/`) |
| Repo / checkout dir | Update in-repo name references; the actual git directory rename (`D:\02_Area\oracle-todo`) is a manual step for the user (out of scope here) |
| Historical docs | `docs/superpowers/**` (design/plan records, incl. this file and the restructure spec/plan) are LEFT as-is — rewriting records is revisionism. Flagged, not scrubbed. |

## Actor rename — `Oracle` → `Agent`

The `oracle` actor represents the AI/agent that proposes work (approval-gating revolves around it). It becomes `Agent`. The other actors (`User`, `System`) are unchanged.

Persistence path: `mapping.rs::actor_sqlite_value` writes `Actor::as_str()`; reads go through `Actor::from_str` (`parse_actor`). So the wire value is governed by `as_str()` + `FromStr`.

**Code edits (todo-engine/src):**
- `domain/model.rs`: enum variant `Oracle` → `Agent`; `as_str`: `Actor::Oracle => "oracle"` → `Actor::Agent => "agent"`; `FromStr`: `"oracle" => Ok(Actor::Oracle)` → `"agent" => Ok(Actor::Agent)`. (`#[serde(rename_all = "lowercase")]` then yields `"agent"`.)
- `application/service/creation.rs:27`, `interfaces/api/handlers.rs:54`, `interfaces/api/mod.rs:108`: `Actor::Oracle` → `Actor::Agent`.
- `interfaces/cli/mod.rs`: four `default_value = "oracle"` → `"agent"`; error message `expected one of: oracle, user, system` → `agent, user, system`.
- `infrastructure/sqlite/schema.rs:114`: backfill default `DEFAULT 'oracle'` → `DEFAULT 'agent'`.

**Read-compat note:** legacy values `"oracle"` are NOT accepted by the new `FromStr` (full removal per scope). A pre-existing DB opened by the new binary will fail to parse `proposed_by`/`actor = 'oracle'` rows until migrated. This is the accepted trade-off of "defaults change + warn"; the manual migration SQL is documented (see Migration docs below).

## Data-home path — `~/.hermes/oracle-todo` → `~/.todo-engine`

`infrastructure/paths.rs`:
- Default join `.hermes/oracle-todo` → `.todo-engine`.
- Add legacy detection: expose `legacy_home()` returning `$HOME/.hermes/oracle-todo`. After tracing is initialized in the CLI, if the resolved home equals the new default AND the legacy home exists, emit a `tracing::warn!` telling the user to migrate (move data + run the documented `UPDATE`). The warn fires from the CLI run path (not from `todo_home`, which resolves before tracing init).
- `db_path` (`todo.sqlite`) and the `TODO_ENGINE_HOME` env override are unchanged.
- `cli/mod.rs:27` doc comment: `~/.hermes/oracle-todo` → `~/.todo-engine`.

## Branding (de-Oracle + de-Hermes)

- `Cargo.toml` `description` and `cli/mod.rs` `#[command(about=...)]`: `"Policy-enforced Oracle ToDo engine"` → `"Policy-enforced personal ToDo engine"`.
- `infrastructure/system.rs` test path `/tmp/oracle/log.jsonl` → `/tmp/te/log.jsonl` (cosmetic; removes the `oracle` token).
- README/CLAUDE.md/AGENTS.md and `docs/**` current-state docs: `Oracle/Hermes workflows` → neutral (e.g. "agent workflows"); `Oracle-created` → `Agent-created`; actor docs `oracle` → `agent`; data-home path → `~/.todo-engine/`; repo-name heading `# oracle-todo` → `# todo-engine`.
- `frontend/README.md`: `oracle-todo monorepo` → `todo-engine monorepo`.
- `.planning/codebase/**` (GSD intel): update name/path references too (regenerable, but they are tracked and in scope for "remove all").

## Migration docs

Add/extend `docs/operations/migration.md` with a "Rebrand migration (oracle → todo-engine)" section:
1. Move data: `mv ~/.hermes/oracle-todo ~/.todo-engine` (or copy).
2. Rewrite actor values once:
   ```sql
   UPDATE items  SET proposed_by = 'agent' WHERE proposed_by = 'oracle';
   UPDATE items  SET approved_by = 'agent' WHERE approved_by = 'oracle';
   UPDATE events SET actor       = 'agent' WHERE actor       = 'oracle';
   ```
3. Update any scripts using the old `~/.hermes/oracle-todo` path.

## Tests (todo-engine/tests)

Update every `oracle` usage to `agent`:
- `Actor::Oracle` → `Actor::Agent` (unit/model.rs, integration/repository.rs).
- SQL string literals `'oracle'` and legacy `' ORACLE '` fixtures → `'agent'` / `' AGENT '` (e2e/cli.rs, e2e/api.rs, integration/repository.rs).
- Assertions `== "oracle"` → `== "agent"`.
- Test fn names `oracle_item_starts_proposed`, `oracle_task_requires_approval_before_activation` → `agent_*`.

## Out of Scope

- Auto-migrating existing data (chosen: warn + manual).
- Renaming the git checkout directory / remote (manual user step).
- Rewriting `docs/superpowers/**` historical records.
- Any logic/behavior change beyond the actor identifier and data-home default.

## Success Criteria

1. `cargo build`, `cargo test`, `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings` all pass.
2. Temp-home smoke: default home now resolves to `$HOME/.todo-engine/`; `init`+`health` succeed; log file under `~/.todo-engine/logs/`; an item created with the default actor persists `proposed_by='agent'`.
3. Legacy-warn smoke: with a pre-existing `$HOME/.hermes/oracle-todo` dir present and no `$HOME/.todo-engine`, running a command emits the migration warning.
4. `git grep -niE 'oracle|hermes' -- ':!docs/superpowers' ':!docs/operations/migration.md'` returns **zero** matches (code, current-state docs, .planning all clean).
5. Intentional survivors, allowed: `docs/superpowers/**` (historical records) and the legacy-migration section of `docs/operations/migration.md` (which must name the old `'oracle'` value and `~/.hermes/oracle-todo` path as the migration *source* — that is the whole point of the doc).
