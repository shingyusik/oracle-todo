# Layers

`oracle-todo` uses clean/hexagonal layering under `src/`. Dependencies point **inward**:
`interfaces` and `infrastructure` depend on `application` and `domain`, never the reverse,
and `domain` does no I/O. Each oversized file from the original layout has been split into a
directory module of focused submodules; the public crate surface (`oracle_todo::…` paths)
is intentionally small.

## Layer map (refactored tree)

| Layer | Module tree | Responsibility |
| --- | --- | --- |
| `domain/` | `model.rs`, `status.rs`, `recurrence.rs`, `mod.rs` | Pure logic, no I/O. `model.rs` holds `ItemType`, `Actor`, `TodoItem`, `TodoEvent`; `status.rs` holds `ItemStatus` + `terminal_status`/`hidden_by_default_status`; `recurrence.rs` holds the `occurrences` parser and `RecurrenceError`. |
| `application/` | `service/{mod,creation,transitions,update,materialization,queries}.rs`, `ports.rs`, `error.rs` | `TodoService` policy + state machine (split by concern), the repository port traits (`TodoRepository`/`EventRepository`/`TodoStore`) plus `ListFilter`/`apply_list_filter`, and `TodoError`. |
| `infrastructure/` | `sqlite/{mod,schema,mapping,repo,migrate_legacy}.rs`, `paths.rs`, `system.rs` | `rusqlite` repository (`SqliteTodoRepository`) + schema DDL, data-home resolution, clock/system + `OperationalLogger`. |
| `interfaces/` | `cli/{mod,create,lifecycle,views,markdown,output}.rs`, `api/{mod,handlers,dto}.rs` | `clap` CLI and `axum` HTTP router (thin adapters over the service). |
| (root) | `lib.rs`, `main.rs` | Crate wiring and the binary entrypoint. |

## Why each oversized file became a directory

- **`application/service/`** — `TodoService` is split by lifecycle concern: `creation` (the
  request structs `CreateArea`/`ProposeTask`/`ProposeProject`/`ProposeRoutine`/`ProposeEvent`
  and their methods), `transitions` (approve/activate/pause/resume/complete/archive/drop/cancel
  and the routine cascade helpers), `update` (`UpdateItem` + `update_item`), `materialization`
  (`materialize_routines` + generated-task helpers), and `queries` (`get`/`list_items`/`archive_items`).
  `mod.rs` keeps the struct, constructors, the deterministic ID/clock counters, and the shared
  helpers (`store_item_and_event`, `set_terminal_status`, `find_area`, `ensure_relation`, …).
- **`infrastructure/sqlite/`** — `schema` (`init_schema`/`user_version` + additive column
  backfill), `mapping` (row ↔ domain conversion and the leaf parse/format helpers),
  `repo` (the `TodoRepository`/`EventRepository`/`TodoStore` impls and the upsert SQL),
  `migrate_legacy` (`migrate_legacy_storage`/`LegacyMigrationReport` + Python-era normalization).
  `mod.rs` keeps `connect`, the `SqliteTodoRepository` struct, and the re-exports.
- **`interfaces/cli/`** — `mod` (clap definitions, dispatch in `run`, and the system handlers
  `init`/`health`/`migrate-legacy-db`), `create` (area/task/project/routine/event proposers),
  `lifecycle` (transition + update handlers), `views` (list/materialize/archive-list/pending/today),
  `markdown` (the CLI Markdown renderer), and `output` (the shared `print_json` helper).
- **`interfaces/api/`** — `mod` (router, `ApiState`, the `ApiError` boundary and shared helpers),
  `handlers` (the 18 endpoint functions), `dto` (the request/query wire structs).

## Dependency rule and its guard

The domain layer must stay pure — no references to `crate::application`,
`crate::infrastructure`, `crate::interfaces`, or I/O crates such as `rusqlite` or `axum`.
This is **enforced by a test**, not just by convention: `tests/unit/architecture.rs` scans
every `.rs` file under `src/domain/` and fails the build if any of those forbidden strings
appears. If you add an outward dependency to the domain, the unit test layer goes red.

## The `pub(super)` visibility convention

Rust privacy is **module-scoped**: splitting an `impl` block or a set of helpers across
sibling files in a directory module means those siblings can no longer see each other's
private items. To make the split compile *without* widening the public API, shared struct
fields, helper methods, and free functions inside a split module are promoted to
`pub(super)` (visible within the parent module tree), not `pub`.

- `pub(super)` is crate-internal visibility widening — it does **not** add anything to the
  public `oracle_todo::…` surface.
- Examples: `TodoService`'s fields (`store`, `events`, `id_counter`, …) and helpers
  (`next_id`, `next_now`, `store_item_and_event`, …) are `pub(super)`; the `sqlite::mapping`
  conversion helpers are `pub(super)`; the `api` handlers, `ApiState`, and `ApiError` helpers
  are `pub(super)`; the `cli` helpers (`service`, `connect_path`, `today_string`) and handlers
  are `pub(super)`.
- **Rule:** never widen to `pub` just to make a split compile. Items that are genuinely part
  of the public API (request structs like `ProposeTask`, the `router`/`run` entrypoints,
  the re-exported domain types) stay `pub`; everything else that only needs to cross a
  sibling-module boundary uses `pub(super)`.

See [../conventions/code-style.md](../conventions/code-style.md) for the file-size guideline
and the visibility rule restated as a coding convention.
