# Code Style

## Language and workspace

Raven uses Rust 2024. `raven-cli` builds the only shipped binary, `raven`. `todo-engine`,
`ledger-engine`, `health-engine`, `raven-api`, and `backend` are library packages.

Engine dependencies point inward:

```text
interfaces / infrastructure → application → domain
```

Domain code performs no I/O and does not depend on another engine.

## Gate

```bash
cargo fmt --check
cargo test --workspace
cargo clippy --all-targets --all-features -- -D warnings
```

Warnings are errors. Keep imports and helpers limited to actual use.

## Modules and visibility

- Split files by responsibility when unrelated concerns accumulate.
- Prefer private items and `pub(super)` for sibling-module collaboration.
- Use `pub(crate)` only across a crate boundary.
- Reserve `pub` for the intentional composition surface.
- Do not widen visibility only to make a split compile.

The current package and module map is in [../architecture/layers.md](../architecture/layers.md).

## Naming and wire forms

- Executable and top-level command name: `raven`.
- Rust package names remain `todo-engine`, `ledger-engine`, `health-engine`, `raven-api`,
  and `raven-cli`.
- Serialized enums use their documented lowercase or snake-case forms.
- IDs, dates, timestamps, amounts, and strict JSON are validated at adapter and service
  boundaries; do not silently coerce invalid input.

## Errors and logging

Return typed errors for expected failures and map them once at CLI/API boundaries. Keep
stdout parseable, redact secrets and record payloads, and use stable tracing event fields.
See [error-handling.md](error-handling.md) and [logging.md](logging.md).

## Behavior preservation

Repository SQL, service policy, transaction boundaries, audit events, and deterministic
output are behavior contracts. Refactors must keep them unless the user-facing contract and
tests change together.
