# Monorepo Restructure — Design

**Date:** 2026-06-17
**Status:** Approved for planning
**Scope:** Restructure only — move the existing Rust crate into a monorepo layout and reserve a `frontend/` slot. No frontend application is built in this effort; its stack is decided later.

## Goal

Convert the single-crate `oracle-todo` repository into a **single-git-repo monorepo** (Cargo workspace) so that the Rust engine and a future web frontend live side by side as sibling packages, while preserving git history and all current build/test/runtime behavior.

This is one git repo with multiple packages — **not** a split into separate repositories.

## Chosen Layout (Approach A — flat)

```
oracle-todo/                ← git repo root, also the Cargo workspace root
  Cargo.toml                [workspace], members = ["todo"]
  Cargo.lock                workspace lock (moves to root)
  todo/                     the existing Rust engine, moved here verbatim
    Cargo.toml              [package] name = "oracle-todo"  (unchanged)
    src/
    tests/
  frontend/                 placeholder for the future web UI
    README.md               "stack TBD" note only
  docs/                     shared docs, stay at root
  README.md  CLAUDE.md  AGENTS.md   shared, stay at root
```

Rejected alternatives:
- **B (`apps/` + `crates/` grouping):** cleaner if many packages appear later, but deeper paths and more churn than warranted now.
- **C (split the Rust crate into multiple internal crates):** YAGNI for a structure-only change.

## What Moves

| From | To | Method |
| --- | --- | --- |
| `src/` | `todo/src/` | `git mv` (preserve history) |
| `tests/` | `todo/tests/` | `git mv` |
| `Cargo.toml` | `todo/Cargo.toml` | `git mv`, package section unchanged |
| `Cargo.lock` | stays at root | becomes the workspace lock |

New file: root `Cargo.toml` declaring the workspace.

Stays at root (shared, not moved): `docs/`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `.gitignore`, `.claude/`, `.codex/`.

## Root Workspace Manifest

New root `Cargo.toml`:

```toml
[workspace]
members = ["todo"]
resolver = "3"
```

The member crate keeps `name = "oracle-todo"`, so the binary name, the `cargo run -p oracle-todo` invocation, and the runtime data home (`~/.hermes/oracle-todo/`) are all unchanged.

## Frontend Placeholder

- Create `frontend/README.md` with a single line stating the stack is undecided and will be chosen in a later effort.
- Do **not** create a root `package.json` or any JS tooling yet (YAGNI until the frontend stack is chosen).

## Docs Sync

16 Markdown files reference `src/...` paths. After the move:

- Update `src/...` references to `todo/src/...` across `README.md`, `CLAUDE.md`, `AGENTS.md`, and `docs/**`.
- Confirm build/test commands in `CLAUDE.md` still hold — `cargo build` / `cargo test` run from the root work because it is now a workspace.
- Note in `CLAUDE.md` / `docs/architecture/` that the crate lives under `todo/` and `frontend/` is a reserved package.
- Run the `docs-tools` skill to keep documentation in sync with the new layout.

Historical artifacts under `docs/superpowers/plans/` and prior `specs/` are left as-is (they describe past states); only current-state docs are updated.

## Out of Scope

- Building or scaffolding the frontend application.
- Choosing the frontend framework.
- Wiring the frontend to the HTTP API.
- Splitting the Rust crate into multiple crates.
- Any change to runtime behavior, schema, data home, or the service layer.

## Success Criteria (Verification)

Run from the repo root after the restructure:

1. `cargo build` — passes.
2. `cargo test` — existing `unit`, `integration`, `e2e` suites stay green.
3. `cargo fmt --check` — passes.
4. `cargo clippy --all-targets --all-features -- -D warnings` — passes.
5. `cargo run -p oracle-todo -- health` — DB reachable, schema baseline OK.
6. `git log --follow todo/src/main.rs` — history follows through the move (history preserved).
7. No remaining stale `src/...` path references in current-state docs (grep clean).

## Risks / Notes

- **Path churn:** every doc and any tooling referencing `src/` must shift to `todo/src/`. Mitigated by the grep check in success criteria.
- **`.cargo/` config:** local-only and gitignored; not part of this change.
- **IDE / CI:** any path-pinned config (CI workflows, editor settings) pointing at `src/` would need updating — none committed today, but verify before merge.
