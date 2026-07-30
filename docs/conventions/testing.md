# Testing

Raven tests domain policy in-process and tests shipped process behavior through the
`raven` binary. `todo-engine` is library-only and has no subprocess binary contract.

## Workspace layers

| Package | Coverage |
| --- | --- |
| `todo-engine` | Unit policy, service/repository integration, in-process ToDo API |
| `ledger-engine` | Money/model unit tests, service/repository/transfer/report integration |
| `health-engine` | Diet/event unit tests, service/repository/media/lifecycle/trend integration |
| `raven-api` | Authentication, safe errors, Dashboard, preferences, all domain routes, UI session |
| `raven-cli` | Real `raven` subprocess, config, ToDo delegation, Ledger/Health CLI, API/UI startup, import |
| `frontend` | Architecture, model, controller, API mapping, and presentation behavior |
| `npm/raven` | Platform assets, cache/install/update, forwarding, and native UI delegation |

## Rust commands

```bash
cargo test --workspace
cargo test -p todo-engine --test unit
cargo test -p todo-engine --test integration
cargo test -p todo-engine --test e2e
cargo test -p raven-api
cargo test -p raven-cli
```

`todo-engine/tests/e2e.rs` exercises its reusable Axum adapter in-process. Shipped CLI
subprocess tests live under `raven-cli/tests/` and execute
`env!("CARGO_BIN_EXE_raven")`, including `raven todo ...`.

## Dispatcher pattern

Cargo compiles top-level `tests/*.rs` files as integration-test binaries. Engine suites use
those files as dispatchers for focused files under `tests/unit/` or
`tests/integration/`:

```rust
#[path = "integration/service_policy.rs"]
mod service_policy;
```

Add a dispatcher entry whenever adding a nested test file; an unreferenced nested file does
not run.

## Cross-surface checks

- CLI and API mutations must agree with the owning service policy.
- ToDo frontend calls use authenticated `/api/v1/todo`; preferences use
  `/api/v1/preferences`.
- `raven todo api` must remain rejected so no unauthenticated secondary HTTP surface exists.
- UI-session tests exercise production router paths, cookies, authority validation, and API
  namespace fallback.
- Ledger/Health purge tests cover confirmation mismatch and audit retention.
- Health media tests cover type detection, size bounds, cleanup, and database/file
  consistency.

## Frontend and npm

```bash
npm --prefix frontend test
npm --prefix frontend run typecheck
npm --prefix frontend run build
npm --prefix npm/raven test
```

## Coverage

Use `cargo llvm-cov --summary-only` or `cargo tarpaulin --out Stdout` when already
installed. Do not install coverage tooling without approval.
