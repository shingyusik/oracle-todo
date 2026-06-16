# Testing

Tests are organized into three layers, each a separate cargo test binary, plus a shared
support module. The layers are behavior-locks: they prove the public CLI/API surface and
the policy invariants are unchanged across refactors.

## The three layers

| Layer | Binary | Directory | What belongs here |
| --- | --- | --- | --- |
| **unit** | `tests/unit.rs` | `tests/unit/` | Pure, no-I/O logic exercised through the crate's *public* API: recurrence, status, model, list filter, error mapping, the local-date clock helper, and the architecture boundary guard. |
| **integration** | `tests/integration.rs` | `tests/integration/` | The library wired in-process: `TodoService` policy, the audit-event invariant, the SQLite repository, and routine materialization. |
| **e2e** | `tests/e2e.rs` | `tests/e2e/` | The delivered interfaces end-to-end: the real `oracle-todo` binary via `assert_cmd` (`cli.rs`), and the full `axum` HTTP stack via `tower`'s `oneshot` (`api.rs`). |

## The dispatcher pattern (and the cargo subfolder gotcha)

Cargo compiles only **top-level `tests/*.rs`** files as test binaries. Files placed under a
subdirectory like `tests/unit/` are **not** compiled on their own — they must be declared as
modules of a top-level binary. So each layer has a one-file **dispatcher** at the top level
that `mod`s its subfolder files:

```rust
// tests/unit.rs
mod architecture;
mod clock;
mod error_mapping;
mod filter;
mod model;
mod recurrence;
mod status;
```

The integration and e2e dispatchers additionally pull in the shared support module with an
explicit `#[path]` attribute (because `tests/support/` is itself a subfolder, not a sibling
of the dispatcher's own modules):

```rust
// tests/integration.rs  (and tests/e2e.rs)
#[path = "support/mod.rs"]
mod support;

mod events;
mod materialization;
mod repository;
mod service_policy;
```

Without the dispatcher + `#[path]`, the subfolder files silently never run. When you add a
test file under a layer directory, remember to add a `mod` line to that layer's dispatcher.

## Running one layer

```bash
cargo test                       # all three binaries
cargo test --test unit           # only the unit layer
cargo test --test integration    # only the integration layer
cargo test --test e2e            # only the e2e layer
```

## Shared support module

`tests/support/mod.rs` holds helpers shared across binaries — notably a `TestHome` temp data
home and a `memory_service()` factory (`TodoService::in_memory()`). Because each test binary
that `mod`s the support file uses a different subset of its helpers, support items carry
`#[allow(dead_code)]` so the unused-in-this-binary ones do not trip the `-D warnings` gate.

## The architecture boundary guard

`tests/unit/architecture.rs` is a test, not a doc: it reads every `.rs` file under
`src/domain/` and fails if any references `crate::application`, `crate::infrastructure`,
`crate::interfaces`, `rusqlite`, or `axum`. This is how the inward-dependency rule is enforced
mechanically — see [../architecture/layers.md](../architecture/layers.md).

## Coverage

Target **≥80% line coverage**. Measure with `cargo llvm-cov --summary-only` or
`cargo tarpaulin --out Stdout` if the tooling is installed. Do not install coverage tooling
without approval; if neither tool is available, record that coverage was not measured (see
[../operations/verification-and-smoke.md](../operations/verification-and-smoke.md)).
