# Code Style

## Language and edition

Rust 2024. The crate is `oracle_todo` (package `oracle-todo`), built as both a library and a
binary (`oracle-todo`).

## The gate (must pass before every commit)

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
```

`-D warnings` makes warnings hard errors. In practice this means **a stray unused import or
dead helper fails the build** — every file must `use` only what it references. When you move
code between modules, trim the imports to exactly what the moved code needs.

## File size and "split by responsibility"

Keep source files focused — roughly **under ~400 lines**. When a file outgrows that, split it
into a directory module whose submodules each own one responsibility, rather than letting one
file accumulate unrelated concerns. The refactored tree is the worked example: `service.rs`
became `application/service/{creation,transitions,update,materialization,queries}.rs`;
`sqlite.rs` became `infrastructure/sqlite/{schema,mapping,repo,migrate_legacy}.rs`; `cli.rs`
and `api.rs` were split the same way. See [../architecture/layers.md](../architecture/layers.md).

## Visibility: prefer `pub(super)` over `pub`

Rust privacy is module-scoped, so splitting an `impl` block across sibling files breaks their
mutual visibility. The convention is:

- Promote shared fields, helper methods, and free functions that only need to cross a
  sibling-module boundary to **`pub(super)`** (or `pub(crate)` if they must cross further) —
  this is crate-internal and does **not** widen the public API.
- Keep `pub` only for items that are genuinely part of the public crate surface (request
  structs like `ProposeTask`, entrypoints like `router`/`run`, the re-exported domain types).
- **Never widen something to `pub` just to make a split compile.** If the compiler complains
  that a sibling can't see a helper, the fix is `pub(super)`, not `pub`.

## Naming

- Use the real, established symbol names — e.g. the repository struct is
  `SqliteTodoRepository` (not `SqliteRepository`). Do not rename public symbols.
- Enum string forms are canonical lowercase (`ItemStatus`, `Actor` lowercase; `ItemType`
  snake_case with `archive_item`). `FromStr` impls are case-sensitive and trim whitespace.

## Errors and logging

Error handling and logging have their own conventions — see
[error-handling.md](error-handling.md) and [logging.md](logging.md).

## Behavior preservation

When refactoring, move code verbatim where possible: keep raw SQL string literals
byte-for-byte, preserve documented `.expect()` invariant sites, and do not reorder the
deterministic ID/clock helper calls that tests assert exactly. Behavior is locked by the
test layers (see [testing.md](testing.md)); if a change cannot preserve behavior, surface it
rather than silently changing output.
