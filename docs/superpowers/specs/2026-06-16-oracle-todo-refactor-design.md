# oracle-todo Refactor — Design Spec

- **Date:** 2026-06-16
- **Author:** shingyusik (with Claude)
- **Status:** Approved design, pending implementation plan
- **Scope:** Repository-wide refactor of `oracle-todo` (Rust 2024) — src structure, test taxonomy, and docs structure. Behavior-preserving by default.

## 1. Goal

Restructure the existing `oracle-todo` engine so that:

1. **src** keeps its clean/hexagonal layering but oversized files are split into focused units (~<400 lines each), `exports.rs` moves into a layer, and the dependency direction is enforced automatically.
2. **tests** are organized into explicit **unit / integration / e2e** layers under `tests/`, with the missing unit coverage added.
3. **docs** gain `architecture/`, `conventions/`, and `operations/` subfolders, each populated with real, code-verified content.

This is a **refactor**, not a feature change. The public surface (CLI args, HTTP routes, JSON shapes, SQLite schema, exit codes, Markdown exports) is preserved. Any behavior change discovered mid-work is stopped and flagged for explicit approval before landing ("allow small fixes" policy).

## 2. Non-goals

- No new features, endpoints, CLI subcommands, or schema columns.
- No dependency upgrades unless required by a split.
- No rewrite of domain logic — only relocation and decomposition.
- README.md remains the canonical user-facing reference; docs go deeper and cross-link rather than duplicate it.

## 3. Current state (baseline)

src is already clean/hexagonal. Pain points:

| File | Lines | Problem |
| --- | --- | --- |
| `src/application/service.rs` | 1056 | Does too much: creation, transitions, update, materialization, queries, event emission. |
| `src/infrastructure/sqlite.rs` | 841 | Schema + mapping + CRUD + legacy migration in one file. |
| `src/interfaces/cli.rs` | 687 | All clap defs + all handlers + rendering in one file. |
| `src/interfaces/api.rs` | 539 | Router + handlers + DTOs in one file. |
| `src/exports.rs` | 243 | Output adapter living at crate root instead of a layer. |

Tests: 7 flat files in `tests/`, kinds mixed (policy/repo/materialization are integration-shaped; cli_parity spawns the binary = e2e; api_parity drives axum; export_parity checks Markdown). **Zero inline unit tests** (`#[cfg(test)]` absent from src).

Docs: two flat files — `docs/design-v1.md`, `docs/rust-refactor.md`. No subfolders.

## 4. Target src layout

Keep 4 layers (`domain` → `application` → `infrastructure`/`interfaces`), dependency direction inward, one purpose per file.

```
src/
  domain/                  PURE, no I/O
    model.rs               Item, ItemType, fields
    status.rs              ItemStatus enum + is_terminal/parse/transition predicates  (extracted from model.rs)
    recurrence.rs          recurrence parse + occurrence generation (keep)
  application/
    service/
      mod.rs               TodoService struct, ctor, shared helpers, event emission
      creation.rs          create area, propose project/task/routine/event
      transitions.rs       approve/activate/pause/resume/complete/archive/drop/cancel (state machine)
      update.rs            update mutable fields
      materialization.rs   routine materialization (single_open / per_occurrence)
      queries.rs           list / pending / today / archive-list views
    ports.rs               repository port trait (keep)
    error.rs               TodoError (keep)
  infrastructure/
    sqlite/
      mod.rs               SqliteRepository, connection
      schema.rs            init_schema, additive column backfill
      mapping.rs           row <-> Item / TodoEvent
      repo.rs              TodoRepository impl (CRUD queries)
      migrate_legacy.rs    migrate-legacy-db normalization
    paths.rs               data-home resolution (keep)
    system.rs              clock/system (keep)
  interfaces/
    cli/
      mod.rs               clap Cli/Command defs + dispatch
      create.rs            create/propose handlers
      lifecycle.rs         approve/activate/.../cancel handlers
      views.rs             pending/today/list/archive-list/export handlers
      output.rs            stdout/stderr rendering
    api/
      mod.rs               axum router
      handlers.rs          endpoint handlers
      dto.rs               request/response shapes
    exports.rs             Markdown views  (MOVED from crate root)
  lib.rs                   module wiring (updated)
  main.rs                  entrypoint (keep)
```

Decomposition is mechanical: move blocks of existing code into new modules, re-export through each `mod.rs` so external call sites and the public API are unchanged. `lib.rs` is updated to wire the new module tree and keep the existing public re-exports stable.

### 4.1 Boundary rule (enforced)

- `domain/` depends on nothing in the crate except `std` and pure third-party crates. It must NOT reference `infrastructure`, `interfaces`, `rusqlite`, or `axum`.
- `application/` may depend on `domain` and `ports`, not on `infrastructure`/`interfaces` concretely.
- `infrastructure/` and `interfaces/` depend inward on `application`/`domain`, never the reverse.

Enforced by an automated test (`tests/unit/architecture.rs`) that scans `src/domain/*.rs` source text and asserts none of the forbidden identifiers appear. Layering can no longer rot silently.

## 5. Target test layout

```
tests/
  unit.rs              dispatcher: #[path="support/mod.rs"] mod support; mod recurrence; mod status; mod model; mod architecture;
  unit/
    recurrence.rs      all recurrence rules from the README table (pure)
    status.rs          parse / is_terminal / legal transitions (pure)
    model.rs           item construction, defaults, pure validators
    architecture.rs    boundary guard (domain has no infra/interface/rusqlite/axum refs)
  integration.rs       dispatcher
  integration/
    service_policy.rs    <- application_policy.rs  (approval gating, DoD/recurrence activation, area no-complete)
    repository.rs        <- sqlite_repository.rs   (CRUD, additive schema init, legacy migrate)
    materialization.rs   <- routine_materialization.rs
    events.rs            audit event emitted on every mutation
    logging.rs           <- logging_errors.rs
  e2e.rs               dispatcher
  e2e/
    cli.rs               <- cli_parity.rs   (assert_cmd, full surface, exit codes 1/2/4)
    api.rs               <- api_parity.rs   (axum tower oneshot, HTTP 400/404/500)
    export.rs            <- export_parity.rs (Markdown views)
  support/
    mod.rs               TestHome + service factory + fixture builders (extended)
```

### 5.1 The cargo subfolder gotcha (critical)

Cargo only auto-compiles **top-level** `tests/*.rs` files as test binaries. Files inside `tests/unit/`, `tests/integration/`, `tests/e2e/` are NOT discovered on their own. The fix is the three dispatcher files (`tests/unit.rs`, `tests/integration.rs`, `tests/e2e.rs`), each declaring its subfolder files as modules. This yields exactly three test binaries (`unit`, `integration`, `e2e`) with clean subfolders and **zero Cargo.toml changes**.

Shared fixtures are reached from each dispatcher with `#[path = "support/mod.rs"] mod support;` (path is relative to `tests/`). `cargo test --test unit` / `--test integration` / `--test e2e` run a single layer.

### 5.2 Unit tests hit public API only

Per the chosen layout, unit tests live in `tests/` (separate crates), so they can only call the crate's **public** surface. Pure domain types/functions under test (recurrence parsing, `ItemStatus` helpers, pure validators) must be `pub` and re-exported from `lib.rs`. Where a pure helper is currently private, expose it minimally (no behavior change).

### 5.3 Behavior lock

All existing test assertions are preserved, only relocated/renamed. New unit tests are added on top. The suite must be green before the refactor begins and after it completes.

## 6. Target docs layout

```
docs/
  architecture/
    overview.md          system + canonical diagram + source-of-truth principle  (from design-v1)
    layers.md            4 layers, dependency direction, module responsibilities, boundary rule
    data-model.md        item types / status lifecycle / events — conceptual + invariants (links README, no dup)
    decisions/
      adr-0001-sqlite-source-of-truth.md
      adr-0002-service-layer-policy.md
      adr-0003-approval-gating.md
      adr-0004-no-hard-delete.md
      adr-0005-recurrence-pattern-parsing.md
  conventions/
    code-style.md        Rust 2024, fmt/clippy gates, ~400-line file guideline, naming
    testing.md           unit/integration/e2e taxonomy, how to run, coverage >=80% gate, fixtures
    error-handling.md    TodoError, exit-code/HTTP mapping, no-panic policy
    logging.md           how to emit JSONL operational logs in code
    git-commit.md        [TAG] subject + Korean bullet body (repo's existing NFLOW format)
  operations/
    setup.md             build, init, data home
    cli-reference.md     full CLI surface
    api-reference.md     HTTP endpoints
    data-home.md         layout, ORACLE_TODO_HOME / --home
    logging-and-rotation.md   files, sizes, rotation env vars
    verification-and-smoke.md fmt/test/clippy gates + copied-data smoke  (from rust-refactor)
    migration.md         migrate-legacy-db, additive schema init
```

Disposition of existing docs:

- `docs/design-v1.md` → folded into `architecture/overview.md` + `architecture/decisions/*`. Original flat file removed (git history preserves it).
- `docs/rust-refactor.md` → folded into `operations/verification-and-smoke.md`; data-home safety guardrails into `operations/data-home.md`; the coverage/boundary guardrails into `conventions/`.
- `README.md` unchanged in role; docs cross-link to it instead of copying column tables.
- `CLAUDE.md` "Docs Map" table currently points at `docs/design-v1.md` and `docs/rust-refactor.md` — update those paths to the new structure.

All docs are verified against the refactored code (commands run, routes exist, columns match) before they are considered done.

## 7. Execution order (behavior-locked)

1. **Safety net** — confirm `cargo test` green. Reorganize existing tests into unit/integration/e2e + add dispatchers. Add missing unit tests (recurrence, status, model). Verify green. *(Behavior locked before src changes.)*
2. **src split** — one layer at a time: domain → application → infrastructure → interfaces. Update `lib.rs`. `cargo test` green after each layer.
3. **Boundary guard** — add `tests/unit/architecture.rs`; `cargo fmt --check` and `cargo clippy --all-targets --all-features -- -D warnings` clean.
4. **Docs** — author architecture/conventions/operations against the refactored code; update `CLAUDE.md` Docs Map.
5. **Final gate** — `cargo fmt --check`, `cargo test`, `cargo clippy -D warnings`, coverage ≥80% (if tooling present), copied-data smoke against a temp home (never the live `~/.hermes/oracle-todo`).

## 8. Success criteria (verifiable)

- `cargo build` succeeds.
- `cargo test` green; three test binaries exist (`unit`, `integration`, `e2e`); `cargo test --test unit|integration|e2e` each run independently.
- `cargo fmt --check` and `cargo clippy --all-targets --all-features -- -D warnings` clean.
- No `src` file exceeds ~400 lines (guideline, not a hard gate); `exports.rs` lives under `interfaces/`.
- `tests/unit/architecture.rs` passes (domain has no forbidden imports).
- All public surfaces unchanged: CLI args, HTTP routes, JSON shapes, SQLite schema, exit codes, Markdown exports (proven by the relocated parity/e2e tests staying green).
- `docs/{architecture,conventions,operations}/` populated and code-verified; `CLAUDE.md` Docs Map updated; no broken doc cross-links.
- Coverage ≥80% line (if `cargo-llvm-cov`/`tarpaulin` available); otherwise documented as not measured.

## 9. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Module split breaks the public API / call sites. | Re-export through each `mod.rs`; keep `lib.rs` public surface identical; lean on green tests after each layer. |
| Unit tests need private items. | Expose minimally as `pub`; no logic change. |
| Subfolder tests silently don't run. | Dispatcher files + `--test <name>` verification in success criteria. |
| Doc/code drift. | Author docs last, against refactored code; verify commands/routes/columns. |
| Accidental hit on live data home. | Copied-data smoke only; never target `~/.hermes/oracle-todo`. |
| Hidden behavior change during split. | Stop and flag for approval before landing (per "allow small fixes"). |

## 10. Commit strategy

Fine-grained, logical commits via the repo's `[TAG] subject + Korean bullet body` convention (git-workflow skill). Roughly: one commit per test-reorg step, one per src layer split, one for the boundary guard, one per docs group, one for CLAUDE.md sync.
