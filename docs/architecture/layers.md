# Layers

Raven keeps engine dependencies inward:

```text
interfaces / infrastructure → application → domain
```

Domain modules perform no I/O. Application services enforce mutation policy through
repository and media ports. Infrastructure implements those ports. CLI and HTTP adapters
translate transport input and output only.

## Workspace map

| Package | Important modules | Responsibility |
| --- | --- | --- |
| `raven-cli` | `cli`, `commands`, `config`, `logging` | `raven` parser, shared paths, engine dispatch, import, API/UI process startup |
| `raven-api` | `auth`, `routes`, `dto`, `state`, `server` | Authenticated `/api/v1`, error contract, Dashboard composition, static UI session |
| `todo-engine` | `domain`, `application`, `infrastructure`, `interfaces` | ToDo item graph, recurrence, status policy, SQLite, reusable CLI/API adapters |
| `ledger-engine` | `domain`, `application`, `infrastructure` | Money and master data, entries, transfers, reports, audit, SQLite |
| `health-engine` | `domain`, `application`, `infrastructure` | Diet, media, health events, timeline/trends, audit, SQLite |
| `backend` | `api` | Namespaced UI preferences stored in `todo.sqlite` |
| `frontend` | `app`, `domain`, `features` | Static unified Dashboard and domain workspaces |

`todo-engine` is a library crate; `raven-cli` owns the only shipped native binary.

## Engine boundaries

### ToDo

`TodoService` is the mutation boundary. CLI and API adapters reuse it, and the existing
ToDo router is mounted by `raven-api` below `/api/v1/todo`.

### Ledger

`LedgerService` owns master-data references, integer-minor-unit money policy, atomic
transfer pairs, archive/restore/purge, audit, reports, doctor checks, and export.

### Health Journal

`HealthService` coordinates `SqliteHealthRepository` with `LocalMediaStore`. Mutations that
touch both database and files preserve committed-state reporting and record pending cleanup
when a file operation cannot finish.

### Composition

`raven-cli` and `raven-api` instantiate services from paths. They may map errors and shape
DTOs but do not implement domain policy. Dashboard projection functions are read-only and
never initialize a missing database.

## Visibility and tests

Engine crates expose only composition-facing types. Split implementation modules use
private or `pub(super)` visibility where possible. Unit tests cover pure domain policy;
integration tests exercise repository/service behavior; CLI/API tests verify adapter
agreement and security boundaries.
