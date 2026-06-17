# Monorepo Restructure + `todo-engine` Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the single-crate `oracle-todo` repo into a Cargo-workspace monorepo with the Rust package moved to `todo-engine/` and renamed to `todo-engine`, reserve a `frontend/` slot, and keep the runtime data home (`~/.hermes/oracle-todo/`) unchanged.

**Architecture:** This is a mechanical restructure + rename, not feature work. There is no new behavior to TDD; correctness is verified by the **existing** `unit`/`integration`/`e2e` test suites staying green plus a `git grep` gauntlet that proves the rename is complete and the data-home path survived. The work is split into two history-preserving phases: (1) a **pure `git mv`** so Git records a rename and `git log --follow` keeps working, then (2) content edits that rename identifiers. Phases are separate commits.

**Tech Stack:** Rust 2024, Cargo workspaces, `clap`, `axum`, `rusqlite`, `tracing`, `assert_cmd` (e2e).

**Spec:** `docs/superpowers/specs/2026-06-17-monorepo-restructure-design.md`

---

## File Structure

After this plan:

```
oracle-todo/                  git + workspace root (name unchanged)
  Cargo.toml                  NEW — [workspace] only
  Cargo.lock                  stays at root (regenerated for workspace)
  todo-engine/                MOVED from repo root
    Cargo.toml                MOVED + edited (name = "todo-engine")
    src/                      MOVED verbatim, then identifier edits
    tests/                    MOVED verbatim, then identifier edits
  frontend/
    README.md                 NEW — placeholder
  docs/  README.md  CLAUDE.md  AGENTS.md   unchanged location, content synced
```

Identifier rename rules (used throughout):

- **`oracle_todo` (underscore)** → **`todo_engine`** — ALWAYS rename. Appears only as crate/module paths, tracing targets, the in-memory DB name, and one test fn name. Never appears in the data-home path.
- **`ORACLE_TODO_` (env, upper)** → **`TODO_ENGINE_`** — ALWAYS rename.
- **`oracle-todo` (hyphen)** → **`todo-engine`** — rename ONLY the command name, the log filename, and `cargo_bin(...)`. **KEEP** the two data-home occurrences in `todo-engine/src/infrastructure/paths.rs` and the path portion of the CLI doc comment.

---

## Task 1: Restructure into a Cargo workspace (pure move)

Goal: move the crate under `todo-engine/` with **zero content changes** so Git records clean renames, and add the workspace root. After this task the package is still named `oracle-todo` and everything builds/tests exactly as before.

**Files:**
- Create: `Cargo.toml` (new workspace root)
- Create: `frontend/README.md`
- Move: `src/` → `todo-engine/src/`, `tests/` → `todo-engine/tests/`, `Cargo.toml` → `todo-engine/Cargo.toml`
- Keep at root: `Cargo.lock`, `docs/`, `README.md`, `CLAUDE.md`, `AGENTS.md`

- [ ] **Step 1: Confirm clean tree**

Run: `git status --short`
Expected: empty (only this plan/spec already committed on the branch).

- [ ] **Step 2: Move the crate with `git mv` (no edits)**

Run (Bash tool):
```bash
mkdir todo-engine
git mv src todo-engine/src
git mv tests todo-engine/tests
git mv Cargo.toml todo-engine/Cargo.toml
```
Note: do **not** move `Cargo.lock` — it stays at the root as the workspace lock.

- [ ] **Step 3: Create the workspace root `Cargo.toml`**

Create `Cargo.toml` (repo root) with exactly:
```toml
[workspace]
resolver = "3"
members = ["todo-engine"]
```

- [ ] **Step 4: Create the frontend placeholder**

Create `frontend/README.md` with:
```markdown
# frontend

Reserved package for the future web UI of the oracle-todo monorepo.

Stack is undecided and will be chosen in a later effort. No build tooling
lives here yet.
```

- [ ] **Step 5: Verify the workspace builds and tests pass (still named `oracle-todo`)**

Run from repo root:
```bash
cargo build
cargo test
```
Expected: build succeeds; `unit`, `integration`, `e2e` suites all pass. `Cargo.lock` may update its `[[package]]` path metadata — that is expected.

- [ ] **Step 6: Verify history follows the move**

Run: `git log --follow --oneline -- todo-engine/src/main.rs`
Expected: commits from before the move appear (rename detected).

- [ ] **Step 7: Commit the move**

```bash
git add -A
git commit -F - <<'EOF'
[REFACTOR] Move crate into Cargo workspace under todo-engine/

- 단일 크레이트를 워크스페이스로 전환: src/, tests/, Cargo.toml을 todo-engine/로 git mv
- 루트 Cargo.toml을 [workspace](members=["todo-engine"], resolver="3")로 신설
- Cargo.lock은 워크스페이스 락으로 루트 유지
- frontend/ placeholder(README) 추가 — 스택 미정
- 패키지명/식별자는 이 커밋에서 변경 없음(순수 이동, 이력 보존)
EOF
```

---

## Task 2: Rename the package and all `oracle_todo` (underscore) identifiers

Goal: rename the Cargo package and every underscore-form identifier. Underscore form is always safe to replace globally — it never appears in the data-home path.

**Files:**
- Modify: `todo-engine/Cargo.toml` (package name)
- Modify: `todo-engine/src/main.rs` (crate path imports)
- Modify: `todo-engine/src/infrastructure/system.rs` (tracing target strings)
- Modify: `todo-engine/src/interfaces/api/mod.rs:73` (in-memory DB name)
- Modify: all `todo-engine/tests/**` files using `use oracle_todo::…`
- Modify: `todo-engine/tests/e2e/cli.rs` (test fn name `init_uses_oracle_todo_home_environment`)

- [ ] **Step 1: Rename the package**

In `todo-engine/Cargo.toml`, change:
```toml
name = "oracle-todo"
```
to:
```toml
name = "todo-engine"
```
(Leave `version`, `edition`, `description`, and all dependencies untouched. No `[[bin]]`/`[lib]` needed — defaults rename the binary to `todo-engine` and the lib crate to `todo_engine` automatically.)

- [ ] **Step 2: Replace every `oracle_todo` with `todo_engine` in source**

Apply `replace_all` of the exact substring `oracle_todo` → `todo_engine` in each file that contains it:
- `todo-engine/src/main.rs` — `use oracle_todo::application::error::TodoError;` and `oracle_todo::interfaces::cli::run()` → `todo_engine::…`
- `todo-engine/src/infrastructure/system.rs` — the two tracing target strings `"oracle_todo::infrastructure::system"` (lines ~171 and ~222) → `"todo_engine::infrastructure::system"`
- `todo-engine/src/interfaces/api/mod.rs` — `"file:oracle_todo_api_{}?mode=memory&cache=shared"` → `"file:todo_engine_api_{}?mode=memory&cache=shared"`

- [ ] **Step 3: Replace every `oracle_todo` with `todo_engine` in tests**

Apply `replace_all` of `oracle_todo` → `todo_engine` in each test file containing it:
- `todo-engine/tests/e2e/api.rs`
- `todo-engine/tests/integration/events.rs`, `materialization.rs`, `repository.rs`, `service_policy.rs`
- `todo-engine/tests/unit/clock.rs`, `error_mapping.rs`, `filter.rs`, `model.rs`, `recurrence.rs`, `status.rs`

This covers both the `use todo_engine::…` imports and the test fn `init_uses_oracle_todo_home_environment` in `todo-engine/tests/e2e/cli.rs` → `init_uses_todo_engine_home_environment`.

- [ ] **Step 4: Verify the underscore form is gone**

Run: `git grep -n 'oracle_todo'`
Expected: **no matches.**

- [ ] **Step 5: Build (compiles under the new crate name)**

Run: `cargo build`
Expected: succeeds. `Cargo.lock` updates the package id `oracle-todo` → `todo-engine` (expected).

- [ ] **Step 6: Commit the underscore rename**

```bash
git add -A
git commit -F - <<'EOF'
[REFACTOR] Rename crate oracle-todo to todo-engine

- Cargo 패키지명 oracle-todo → todo-engine (lib/bin 타깃 자동 rename)
- 크레이트/모듈 경로 oracle_todo:: → todo_engine:: (src + 전 테스트)
- tracing target 및 in-memory DB명 oracle_todo_api_ → todo_engine_api_
- 테스트 함수명 init_uses_oracle_todo_home_environment → todo_engine
- 데이터홈 경로(.hermes/oracle-todo)는 손대지 않음
EOF
```

---

## Task 3: Rename env vars, command name, and log filename (hyphen/upper forms)

Goal: rename the user-facing `ORACLE_TODO_*` env vars, the clap command name, and the log filename — while **keeping** the data-home path `~/.hermes/oracle-todo`.

**Files:**
- Modify: `todo-engine/src/infrastructure/paths.rs` (env var rename, KEEP path)
- Modify: `todo-engine/src/infrastructure/system.rs` (env vars + log filename)
- Modify: `todo-engine/src/interfaces/cli/mod.rs` (command name + env attr + doc comment)
- Modify: `todo-engine/tests/e2e/cli.rs` (env, `cargo_bin`, log filenames, assert messages)

- [ ] **Step 1: `paths.rs` — rename env var, keep data-home path**

In `todo-engine/src/infrastructure/paths.rs`, change only the env-var name:
```rust
    if let Some(home) = std::env::var_os("ORACLE_TODO_HOME") {
```
to:
```rust
    if let Some(home) = std::env::var_os("TODO_ENGINE_HOME") {
```
**Do NOT change** line 13 — `Ok(PathBuf::from(home).join(".hermes/oracle-todo"))` stays exactly as-is.

- [ ] **Step 2: `system.rs` — rename env vars and log filename**

In `todo-engine/src/infrastructure/system.rs` apply these exact replacements:
- `level_from_env("ORACLE_TODO_CONSOLE_LOG", …)` → `level_from_env("TODO_ENGINE_CONSOLE_LOG", …)`
- `level_from_env("ORACLE_TODO_FILE_LOG", …)` → `level_from_env("TODO_ENGINE_FILE_LOG", …)`
- `std::env::var("ORACLE_TODO_LOG_MAX_BYTES")` → `std::env::var("TODO_ENGINE_LOG_MAX_BYTES")`
- `std::env::var("ORACLE_TODO_LOG_MAX_FILES")` → `std::env::var("TODO_ENGINE_LOG_MAX_FILES")`
- `home.join("logs/oracle-todo.log.jsonl")` → `home.join("logs/todo-engine.log.jsonl")`
- the rotated-path fallback `.unwrap_or("oracle-todo.log.jsonl")` → `.unwrap_or("todo-engine.log.jsonl")`
- the two `#[cfg(test)]` literals `PathBuf::from("oracle-todo.log.jsonl")` → `PathBuf::from("todo-engine.log.jsonl")`

(The test path literal `/tmp/oracle/log.jsonl` in `log_write_fallback_warning_includes_path_and_error` is unrelated — leave it.)

- [ ] **Step 3: `cli/mod.rs` — command name, env attr, doc comment**

In `todo-engine/src/interfaces/cli/mod.rs`:
- `#[command(name = "oracle-todo")]` → `#[command(name = "todo-engine")]`
- `#[arg(long, env = "ORACLE_TODO_HOME")]` → `#[arg(long, env = "TODO_ENGINE_HOME")]`
- doc comment `/// Data home. Defaults to ORACLE_TODO_HOME or ~/.hermes/oracle-todo.` → `/// Data home. Defaults to TODO_ENGINE_HOME or ~/.hermes/oracle-todo.` (rename the env var; **keep** `~/.hermes/oracle-todo`)

- [ ] **Step 4: `tests/e2e/cli.rs` — env vars, binary name, log filenames, assert messages**

In `todo-engine/tests/e2e/cli.rs` apply `replace_all` for each exact substring:
- `Command::cargo_bin("oracle-todo")` → `Command::cargo_bin("todo-engine")`
- `"ORACLE_TODO_HOME"` → `"TODO_ENGINE_HOME"`
- `"ORACLE_TODO_FILE_LOG"` → `"TODO_ENGINE_FILE_LOG"`
- `"ORACLE_TODO_LOG_MAX_BYTES"` → `"TODO_ENGINE_LOG_MAX_BYTES"`
- `"ORACLE_TODO_LOG_MAX_FILES"` → `"TODO_ENGINE_LOG_MAX_FILES"`
- `logs/oracle-todo.log.jsonl` → `logs/todo-engine.log.jsonl` (covers the base path and the `.1`/`.2`/`.3` rotated paths, which are built by appending to this string)
- assert-message text `ORACLE_TODO_FILE_LOG=error` → `TODO_ENGINE_FILE_LOG=error`

This file contains no data-home path literal (tests use temp dirs), so every remaining `oracle` token here is intended to change.

- [ ] **Step 5: Verify env/command rename is complete and data-home survived**

Run:
```bash
git grep -nE 'ORACLE_TODO'      # expect: no matches
git grep -n 'oracle-todo'       # expect: ONLY paths.rs (.hermes/oracle-todo) + its cli doc comment
git grep -n '\.hermes/oracle-todo'   # expect: still present (data home unchanged)
```

- [ ] **Step 6: Run the full gate**

Run from repo root:
```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test
cargo run -p todo-engine -- health
```
Expected: fmt clean; clippy clean; all suites pass (e2e now drives the `todo-engine` binary with `TODO_ENGINE_*` env); `health` reports the DB reachable at the unchanged `~/.hermes/oracle-todo/`.

- [ ] **Step 7: Commit the env/command/log rename**

```bash
git add -A
git commit -F - <<'EOF'
[UPDATE] Rename env vars, command, and log file to todo-engine

- env prefix ORACLE_TODO_* → TODO_ENGINE_* (HOME, CONSOLE_LOG, FILE_LOG, LOG_MAX_*)
- clap 커맨드명 oracle-todo → todo-engine, 로그 파일명 todo-engine.log.jsonl
- e2e 테스트의 cargo_bin/env/로그 경로/어서션 메시지 일괄 갱신
- 데이터홈 경로 ~/.hermes/oracle-todo는 의도적으로 유지(라이브 DB 보존)
- 하위 호환 alias 없음 — ORACLE_TODO_* 사용자는 TODO_ENGINE_*로 전환 필요
EOF
```

---

## Task 4: Sync documentation

Goal: update current-state docs to the new layout, package name, env vars, binary, and log filename — while keeping the data-home path. Historical artifacts under `docs/superpowers/plans/` and `docs/superpowers/specs/2026-06-16-*` are left untouched.

**Files (current-state docs with hits):** `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/operations/logging-and-rotation.md`, `docs/operations/data-home.md`, `docs/operations/setup.md`, `docs/operations/cli-reference.md`, `docs/operations/migration.md`, `docs/operations/verification-and-smoke.md`, `docs/conventions/logging.md`, `docs/conventions/code-style.md`, `docs/conventions/testing.md`, `docs/architecture/layers.md`, `docs/architecture/overview.md`, `docs/architecture/data-model.md`, `docs/architecture/decisions/adr-0001-sqlite-source-of-truth.md`.

- [ ] **Step 1: Invoke the docs-tools skill**

Use the `docs-tools` skill (`docs-change-updater`) to drive the sync, applying these transformations per file:

- Path refs `src/…` → `todo-engine/src/…`.
- Env-var refs `ORACLE_TODO_*` → `TODO_ENGINE_*`.
- Binary/command refs `oracle-todo <args>` → `todo-engine <args>`; `cargo run -- …` examples → `cargo run -p todo-engine -- …`; `cargo run -p oracle-todo` → `cargo run -p todo-engine`.
- Crate/module refs `oracle_todo::…` → `todo_engine::…`.
- Log-filename refs `oracle-todo.log.jsonl` → `todo-engine.log.jsonl`.
- **KEEP** the data-home path `~/.hermes/oracle-todo/` wherever it appears (notably `docs/operations/data-home.md`, `docs/operations/setup.md`).

- [ ] **Step 2: Update the architecture/layout description**

In `CLAUDE.md` and `docs/architecture/layers.md`, note that the crate now lives under `todo-engine/` and `frontend/` is a reserved sibling package; update the file table's `src/…` paths to `todo-engine/src/…`. Confirm the `## Commands` block in `CLAUDE.md` still works from the workspace root (prefer `cargo run -p todo-engine -- …`).

- [ ] **Step 3: Verify docs are consistent**

Run:
```bash
git grep -n 'oracle-todo' -- '*.md' ':!docs/superpowers/plans' ':!docs/superpowers/specs/2026-06-16-*'
```
Expected: matches are ONLY the intentional data-home path `~/.hermes/oracle-todo/` and any prose naming the monorepo/product/repo "oracle-todo". No stale binary, env, crate, or log-filename references.

Also: `git grep -n 'ORACLE_TODO\|oracle_todo' -- '*.md' ':!docs/superpowers/plans' ':!docs/superpowers/specs/2026-06-16-*'` → no matches.

- [ ] **Step 4: Commit docs**

```bash
git add -A
git commit -F - <<'EOF'
[DOCS] Sync docs to todo-engine monorepo layout

- 경로 src/ → todo-engine/src/, env ORACLE_TODO_* → TODO_ENGINE_* 반영
- 바이너리/커맨드 oracle-todo → todo-engine, 로그 파일명 갱신
- 데이터홈 경로 ~/.hermes/oracle-todo는 유지(언급 위치 보존)
- 아키텍처 문서에 todo-engine/ 패키지와 frontend/ 예약 슬롯 명시
EOF
```

---

## Task 5: Final full-repo verification

Goal: prove the spec's success criteria all hold.

- [ ] **Step 1: Run the complete gate from the repo root**

```bash
cargo build
cargo test
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo run -p todo-engine -- health
```
Expected: every command succeeds; `health` confirms the DB at `~/.hermes/oracle-todo/`.

- [ ] **Step 2: Run the grep gauntlet (spec success criteria 7–9)**

```bash
git grep -nE 'ORACLE_TODO|oracle_todo'            # expect: no matches
git grep -n 'oracle-todo' -- ':!docs/superpowers' # expect: ONLY paths.rs data-home path + docs data-home path
git grep -n '\.hermes/oracle-todo'                # expect: present (data home preserved)
git log --follow --oneline -- todo-engine/src/main.rs   # expect: pre-move history present
```

- [ ] **Step 3: Confirm branch state**

```bash
git status        # clean
git log --oneline -n 8
```
Expected: clean tree; commits for move, underscore rename, env/command rename, docs (plus the earlier spec commits).

---

## Self-Review

- **Spec coverage:** Layout A move (Task 1), workspace manifest (Task 1 Step 3), package+binary+lib rename (Task 2), env-var rename (Task 3), log filename + in-memory DB rename (Tasks 2–3), data-home KEEP (Task 3 Step 1, guarded by Task 5 greps), frontend placeholder (Task 1 Step 4), docs sync incl. data-home keep (Task 4), all 9 success criteria (Tasks 1/2/3/5 verify steps). No gaps.
- **History preservation:** pure `git mv` isolated in Task 1 before any content edit; verified by `git log --follow` in Task 1 Step 6 and Task 5 Step 2.
- **Data-home safety:** the only edits near the data-home path are explicit KEEP instructions (Task 3 Step 1) plus a positive grep that the path still exists (Task 5 Step 2).
- **Identifier consistency:** underscore form (`oracle_todo`→`todo_engine`), upper env form (`ORACLE_TODO_`→`TODO_ENGINE_`), and hyphen form (`oracle-todo`→`todo-engine`, except data-home) are defined once in File Structure and applied consistently per task.
