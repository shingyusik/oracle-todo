# Rust Cutover Compatibility Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Rust implementation safe for cutover evaluation by fixing SQLite enum compatibility, Python/Rust round-trip behavior, CLI parity, and API cutover scope.

**Architecture:** Keep the existing Clean Architecture split. Domain enums keep user-facing lowercase values; SQLite uppercase encoding lives in `src/infrastructure/sqlite.rs`; CLI and API handlers call `TodoService` only.

**Tech Stack:** Rust 2024, `rusqlite`, `clap`, `serde`, `serde_json`, `axum`, `assert_cmd`, `tempfile`, Python CLI via `uv run oracle-todo`, existing Python SQLModel SQLite engine.

---

## Source Design

- Modify `src/domain/model.rs`: enum parsers accept uppercase and lowercase values; add SQLite-specific value helpers if they are kept in domain.
- Modify `src/infrastructure/sqlite.rs`: write Python-compatible uppercase enum names for SQLite enum columns; keep event `object_type` lowercase.
- Modify `tests/application_policy.rs`: domain parser compatibility tests.
- Modify `tests/sqlite_repository.rs`: legacy uppercase fixture and SQLite write-format tests.
- Create `tests/python_rust_roundtrip.rs`: CLI smoke tests that run Rust and Python against the same temporary data homes.
- Modify `src/interfaces/cli.rs`: add missing Python CLI commands and route each command through `TodoService`.
- Modify `tests/cli_parity.rs`: command coverage for missing CLI surface.
- Modify `src/interfaces/api.rs`: add operational API routes if this implementation cycle includes API extension scope.
- Modify `tests/api_parity.rs`: route tests for API parity and any operational extension routes.
- Modify `README.md` or `docs/rust-refactor.md`: document cutover gates and copied-live-DB smoke command.

## Task 1: Fix SQLite Enum Compatibility

**Files:**
- Modify: `src/domain/model.rs`
- Modify: `src/infrastructure/sqlite.rs`
- Modify: `tests/application_policy.rs`
- Modify: `tests/sqlite_repository.rs`

- [ ] **Step 1: Add failing domain parser tests**

Append to `tests/application_policy.rs`:

```rust
#[test]
fn domain_enums_parse_uppercase_sqlite_names() {
    assert_eq!(ItemType::from_str("AREA").unwrap(), ItemType::Area);
    assert_eq!(ItemType::from_str("ARCHIVE_ITEM").unwrap(), ItemType::ArchiveItem);
    assert_eq!(ItemStatus::from_str("ACTIVE").unwrap(), ItemStatus::Active);
    assert_eq!(ItemStatus::from_str("PROPOSED").unwrap(), ItemStatus::Proposed);
    assert_eq!(Actor::from_str("ORACLE").unwrap(), Actor::Oracle);
    assert_eq!(Actor::from_str("SYSTEM").unwrap(), Actor::System);
}
```

- [ ] **Step 2: Run parser test to verify RED**

Run:

```bash
cargo test --test application_policy domain_enums_parse_uppercase_sqlite_names
```

Expected: FAIL with `unknown item type: AREA` or equivalent.

- [ ] **Step 3: Add failing SQLite legacy fixture test**

Append to `tests/sqlite_repository.rs`:

```rust
#[test]
fn repository_reads_legacy_uppercase_enum_rows() {
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    conn.execute(
        r#"
        INSERT INTO items (
            id, type, title, status, materialization_policy, proposed_by,
            second_brain_refs, metadata, created_at, updated_at
        )
        VALUES (
            'area_legacy', 'AREA', '레거시 영역', 'ACTIVE', 'single_open', 'USER',
            '[]', '{}', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z'
        )
        "#,
        [],
    )
    .unwrap();

    let mut repo = SqliteTodoRepository::new(conn);
    let item = repo.get_item("area_legacy").unwrap().unwrap();

    assert_eq!(item.item_type, ItemType::Area);
    assert_eq!(item.status, ItemStatus::Active);
    assert_eq!(item.proposed_by, Actor::User);
}
```

- [ ] **Step 4: Add failing SQLite write-format test**

Append to `tests/sqlite_repository.rs`:

```rust
#[test]
fn repository_writes_python_compatible_enum_names() {
    let dir = tempfile::TempDir::new().unwrap();
    let db_path = dir.path().join("todo.sqlite");
    let conn = connect(db_path.to_str().unwrap()).unwrap();
    init_schema(&conn).unwrap();
    let now = time::macros::datetime!(2026-06-01 00:00 UTC);
    let item = TodoItem::new_task("task_enum_format", "저장 포맷 확인", Actor::Oracle, now);
    let event = TodoEvent {
        id: "evt_enum_format".to_string(),
        at: now,
        actor: Actor::Oracle,
        action: "propose_task".to_string(),
        object_type: item.item_type.as_str().to_string(),
        object_id: item.id.clone(),
        before: None,
        after: None,
        reason: None,
    };

    let mut repo = SqliteTodoRepository::new(conn);
    repo.save_item_and_event(&item, &event).unwrap();
    drop(repo);

    let conn = connect(db_path.to_str().unwrap()).unwrap();
    let row = conn
        .query_row(
            "SELECT type, status, proposed_by FROM items WHERE id = ?1",
            ["task_enum_format"],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .unwrap();
    let event_row = conn
        .query_row(
            "SELECT actor, object_type FROM events WHERE id = ?1",
            ["evt_enum_format"],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .unwrap();

    assert_eq!(row, ("TASK".to_string(), "PROPOSED".to_string(), "ORACLE".to_string()));
    assert_eq!(event_row, ("ORACLE".to_string(), "task".to_string()));
}
```

- [ ] **Step 5: Run compatibility tests to verify RED**

Run:

```bash
cargo test --test sqlite_repository repository_reads_legacy_uppercase_enum_rows repository_writes_python_compatible_enum_names
```

Expected: first test FAILS while parsing uppercase values; second test FAILS because Rust writes lowercase enum values.

- [ ] **Step 6: Implement enum parsing and SQLite encoding**

Modify `src/domain/model.rs` parsers to normalize input:

```rust
fn normalize_enum_input(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}
```

Use `normalize_enum_input(value).as_str()` in the `FromStr` implementations for `ItemType`, `ItemStatus`, and `Actor`.

Add SQLite encoding helpers in `src/infrastructure/sqlite.rs`:

```rust
fn item_type_sqlite_value(item_type: ItemType) -> &'static str {
    match item_type {
        ItemType::Area => "AREA",
        ItemType::Project => "PROJECT",
        ItemType::Routine => "ROUTINE",
        ItemType::Task => "TASK",
        ItemType::Event => "EVENT",
        ItemType::Review => "REVIEW",
        ItemType::ArchiveItem => "ARCHIVE_ITEM",
    }
}

fn status_sqlite_value(status: ItemStatus) -> &'static str {
    match status {
        ItemStatus::Proposed => "PROPOSED",
        ItemStatus::Approved => "APPROVED",
        ItemStatus::Active => "ACTIVE",
        ItemStatus::Waiting => "WAITING",
        ItemStatus::Paused => "PAUSED",
        ItemStatus::Completed => "COMPLETED",
        ItemStatus::Cancelled => "CANCELLED",
        ItemStatus::Dropped => "DROPPED",
        ItemStatus::Archived => "ARCHIVED",
        ItemStatus::Someday => "SOMEDAY",
        ItemStatus::Rejected => "REJECTED",
    }
}

fn actor_sqlite_value(actor: Actor) -> &'static str {
    match actor {
        Actor::User => "USER",
        Actor::Oracle => "ORACLE",
        Actor::System => "SYSTEM",
    }
}
```

In `save_item_on`, replace:

```rust
item.item_type.as_str()
item.status.as_str()
item.proposed_by.as_str()
item.approved_by.map(Actor::as_str)
```

with:

```rust
item_type_sqlite_value(item.item_type)
status_sqlite_value(item.status)
actor_sqlite_value(item.proposed_by)
item.approved_by.map(actor_sqlite_value)
```

In `save_event_on`, replace `event.actor.as_str()` with `actor_sqlite_value(event.actor)`. Do not change `event.object_type`.

- [ ] **Step 7: Run enum compatibility tests to verify GREEN**

Run:

```bash
cargo test --test application_policy domain_enums_parse_uppercase_sqlite_names
cargo test --test sqlite_repository repository_reads_legacy_uppercase_enum_rows
cargo test --test sqlite_repository repository_writes_python_compatible_enum_names
```

Expected: PASS.

- [ ] **Step 8: Commit enum compatibility fix**

Run:

```bash
git add src/domain/model.rs src/infrastructure/sqlite.rs tests/application_policy.rs tests/sqlite_repository.rs
git commit -m "[fix] align SQLite enum compatibility"
```

## Task 2: Add Python/Rust Round-Trip Smoke Tests

**Files:**
- Create: `tests/python_rust_roundtrip.rs`
- Modify: `tests/support/mod.rs` if helper reuse is useful

- [ ] **Step 1: Add failing round-trip tests**

Create `tests/python_rust_roundtrip.rs`:

```rust
use assert_cmd::Command;
use predicates::prelude::*;
use std::process::Command as ProcessCommand;
use tempfile::TempDir;

fn rust_cli() -> Command {
    Command::cargo_bin("oracle-todo").unwrap()
}

fn python_oracle_todo(home: &TempDir, args: &[&str]) -> std::process::Output {
    ProcessCommand::new("uv")
        .args(["run", "oracle-todo"])
        .args(args)
        .env("ORACLE_TODO_HOME", home.path())
        .output()
        .unwrap()
}

#[test]
fn rust_reads_python_created_database() {
    let home = TempDir::new().unwrap();

    let init = python_oracle_todo(&home, &["init"]);
    assert!(init.status.success(), "{}", String::from_utf8_lossy(&init.stderr));

    let area = python_oracle_todo(&home, &["area", "create", "검증 영역"]);
    assert!(area.status.success(), "{}", String::from_utf8_lossy(&area.stderr));

    let task = python_oracle_todo(
        &home,
        &["task", "propose", "파이썬 생성 태스크", "--area", "검증 영역", "--actor", "oracle"],
    );
    assert!(task.status.success(), "{}", String::from_utf8_lossy(&task.stderr));

    rust_cli()
        .args(["--home", home.path().to_str().unwrap(), "pending"])
        .assert()
        .success()
        .stdout(predicate::str::contains("파이썬 생성 태스크"));
}

#[test]
fn python_reads_rust_created_database() {
    let home = TempDir::new().unwrap();

    rust_cli()
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .assert()
        .success();
    rust_cli()
        .args(["--home", home.path().to_str().unwrap(), "area", "create", "검증 영역"])
        .assert()
        .success();
    rust_cli()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "task",
            "propose",
            "러스트 생성 태스크",
            "--area",
            "검증 영역",
            "--actor",
            "oracle",
        ])
        .assert()
        .success();

    let pending = python_oracle_todo(&home, &["pending"]);
    assert!(
        pending.status.success(),
        "{}",
        String::from_utf8_lossy(&pending.stderr)
    );
    assert!(
        String::from_utf8_lossy(&pending.stdout).contains("러스트 생성 태스크"),
        "{}",
        String::from_utf8_lossy(&pending.stdout)
    );
}
```

- [ ] **Step 2: Run round-trip tests to verify RED**

Run:

```bash
cargo test --test python_rust_roundtrip
```

Expected before Task 1: FAIL. Expected after Task 1: PASS. If this fails after Task 1, inspect raw SQLite enum values before changing CLI behavior.

- [ ] **Step 3: Commit round-trip tests**

Run:

```bash
git add tests/python_rust_roundtrip.rs
git commit -m "[test] add Python Rust roundtrip coverage"
```

## Task 3: Add Missing Core CLI Commands

**Files:**
- Modify: `src/interfaces/cli.rs`
- Modify: `tests/cli_parity.rs`

- [ ] **Step 1: Add failing CLI command tests**

Append tests covering `list`, `approve`, `complete`, `archive`, `drop`, `cancel`, `project propose`, and `update` to `tests/cli_parity.rs`. Use command assertions that prove each command reaches `TodoService` by checking persisted status or updated fields through a later `list` command.

Use this command pattern in each test:

```rust
Command::cargo_bin("oracle-todo")
    .unwrap()
    .args(["--home", home.path().to_str().unwrap(), "list", "--include-archived"])
    .assert()
    .success()
    .stdout(predicate::str::contains("expected title"));
```

- [ ] **Step 2: Run CLI tests to verify RED**

Run:

```bash
cargo test --test cli_parity
```

Expected: FAIL with unknown subcommands or missing output.

- [ ] **Step 3: Add CLI command variants and argument structs**

Modify `src/interfaces/cli.rs`:

```rust
enum Command {
    Init,
    Health,
    List(ListArgs),
    Area { command: AreaCommand },
    Project { command: ProjectCommand },
    Task { command: TaskCommand },
    Routine { command: RoutineCommand },
    Event { command: EventCommand },
    Approve(ItemTransitionArgs),
    Activate(ItemTransitionArgs),
    Pause(ItemTransitionArgs),
    Resume(ItemTransitionArgs),
    Complete(ItemTransitionArgs),
    Archive(ItemTransitionArgs),
    Drop(ItemTransitionArgs),
    Cancel(ItemTransitionArgs),
    Update(UpdateArgs),
    #[command(name = "archive-list")]
    ArchiveList,
    Pending,
    Today,
    Export,
}

#[derive(Debug, Subcommand)]
enum ProjectCommand {
    Propose(ProjectProposeArgs),
}

#[derive(Debug, Args)]
struct ItemTransitionArgs {
    item_id: String,
    #[arg(long)]
    reason: Option<String>,
}

#[derive(Debug, Args)]
struct ListArgs {
    #[arg(long)]
    status: Option<String>,
    #[arg(long = "type")]
    item_type: Option<String>,
    #[arg(long)]
    area_id: Option<String>,
    #[arg(long)]
    project_id: Option<String>,
    #[arg(long)]
    routine_id: Option<String>,
    #[arg(long)]
    query: Option<String>,
    #[arg(long)]
    include_archived: bool,
}
```

Add project and update argument structs:

```rust
#[derive(Debug, Args)]
struct ProjectProposeArgs {
    title: String,
    #[arg(long)]
    area: Option<String>,
    #[arg(long)]
    definition_of_done: Option<String>,
    #[arg(long)]
    outcome: Option<String>,
    #[arg(long)]
    due: Option<String>,
    #[arg(long, default_value = "oracle", value_parser = parse_actor)]
    actor: Actor,
}

#[derive(Debug, Args)]
struct UpdateArgs {
    item_id: String,
    #[arg(long)]
    title: Option<String>,
    #[arg(long)]
    description: Option<String>,
    #[arg(long)]
    outcome: Option<String>,
    #[arg(long)]
    definition_of_done: Option<String>,
    #[arg(long)]
    standard: Option<String>,
    #[arg(long)]
    review_cycle: Option<String>,
    #[arg(long)]
    recurrence_rule: Option<String>,
    #[arg(long)]
    materialization_policy: Option<String>,
    #[arg(long)]
    area: Option<String>,
    #[arg(long)]
    project_id: Option<String>,
    #[arg(long)]
    routine_id: Option<String>,
    #[arg(long)]
    due: Option<String>,
    #[arg(long)]
    scheduled: Option<String>,
    #[arg(long)]
    priority: Option<i64>,
    #[arg(long)]
    reason: Option<String>,
}
```

- [ ] **Step 4: Implement handlers through `TodoService`**

Add handlers in `src/interfaces/cli.rs`:

```rust
fn approve(home: &Path, args: ItemTransitionArgs) -> Result<()> {
    let mut service = service(home)?;
    let item = service.approve(&args.item_id, args.reason.as_deref())?;
    println!("{}", serde_json::to_string(&item)?);
    Ok(())
}
```

Use the same pattern for `pause`, `resume`, `complete`, `archive`, `drop`, and `cancel`.

For `list`, convert string filters with `ItemStatus::from_str` and `ItemType::from_str`, then call `service.list_items(ListFilter { ... })` and print `render_items("Items", &items)`.

For `project propose`, call:

```rust
service.propose_project(ProposeProject {
    title: args.title,
    area: args.area,
    definition_of_done: args.definition_of_done,
    outcome: args.outcome,
    due: args.due,
    actor: args.actor,
})?;
```

For `update`, call:

```rust
service.update_item(
    &args.item_id,
    UpdateItem {
        title: args.title,
        description: args.description,
        outcome: args.outcome,
        definition_of_done: args.definition_of_done,
        standard: args.standard,
        review_cycle: args.review_cycle,
        recurrence_rule: args.recurrence_rule,
        materialization_policy: args.materialization_policy,
        area: args.area,
        project_id: args.project_id,
        routine_id: args.routine_id,
        due: args.due,
        scheduled: args.scheduled,
        priority: args.priority,
        reason: args.reason,
    },
)?;
```

- [ ] **Step 5: Run core CLI tests**

Run:

```bash
cargo test --test cli_parity
```

Expected: PASS.

- [ ] **Step 6: Commit core CLI parity**

Run:

```bash
git add src/interfaces/cli.rs tests/cli_parity.rs
git commit -m "[feat] complete core CLI parity"
```

## Task 4: Add Remaining Routine and Archive CLI Commands

**Files:**
- Modify: `src/interfaces/cli.rs`
- Modify: `tests/cli_parity.rs`

- [ ] **Step 1: Add failing tests for `archive-list` and `routine materialize`**

Append tests to `tests/cli_parity.rs` that:

- create and archive a task, then assert `archive-list` prints the archived task.
- create, approve, and activate a routine, then assert `routine materialize` prints generated tasks or the no-op message.

- [ ] **Step 2: Run targeted CLI tests to verify RED**

Run:

```bash
cargo test --test cli_parity archive_list_shows_terminal_items routine_materialize_matches_python_cli_intent
```

Expected: FAIL with missing subcommand or missing output.

- [ ] **Step 3: Implement `archive-list`**

Add handler:

```rust
fn archive_list(home: &Path) -> Result<()> {
    let mut service = service(home)?;
    let items = service.archive_items()?;
    println!("{}", render_items("Archive", &items));
    Ok(())
}
```

- [ ] **Step 4: Implement `routine materialize`**

Add subcommand:

```rust
enum RoutineCommand {
    Propose(RoutineProposeArgs),
    Materialize(RoutineMaterializeArgs),
}

#[derive(Debug, Args)]
struct RoutineMaterializeArgs {
    #[arg(long)]
    now: Option<String>,
    #[arg(long, default_value_t = 7)]
    lookahead_days: i64,
    #[arg(long, default_value_t = 1)]
    catchup_days: i64,
}
```

Add handler:

```rust
fn routine_materialize(home: &Path, args: RoutineMaterializeArgs) -> Result<()> {
    let mut service = service(home)?;
    let now = args.now.unwrap_or_else(today_string);
    let created = service.materialize_routines(&now, args.lookahead_days, args.catchup_days)?;
    if created.is_empty() {
        println!("No routine tasks materialized");
        return Ok(());
    }
    for item in created {
        println!("{}", serde_json::to_string(&item)?);
    }
    Ok(())
}
```

- [ ] **Step 5: Run routine/archive CLI tests**

Run:

```bash
cargo test --test cli_parity archive_list_shows_terminal_items routine_materialize_matches_python_cli_intent
```

Expected: PASS.

- [ ] **Step 6: Commit remaining CLI parity**

Run:

```bash
git add src/interfaces/cli.rs tests/cli_parity.rs
git commit -m "[feat] add routine and archive CLI parity"
```

## Task 5: Add Operational API Extension Routes

**Files:**
- Modify: `src/interfaces/api.rs`
- Modify: `tests/api_parity.rs`

- [ ] **Step 1: Add failing route tests**

Add tests for:

- `POST /projects/propose`
- `POST /routines/propose`
- `POST /events/propose`
- `POST /items/{id}/activate`
- `POST /items/{id}/pause`
- `POST /items/{id}/resume`
- `POST /items/{id}/archive`
- `POST /items/{id}/drop`
- `POST /items/{id}/cancel`
- `PATCH /items/{id}`
- `GET /items/archive`

Each route test must assert status code, response body, and persisted state through `GET /items`.

- [ ] **Step 2: Run API tests to verify RED**

Run:

```bash
cargo test --test api_parity
```

Expected: FAIL with `404 Not Found` for the new routes.

- [ ] **Step 3: Add request bodies and routes**

Modify `src/interfaces/api.rs`:

```rust
#[derive(Deserialize)]
struct ProjectProposeBody {
    title: String,
    area: Option<String>,
    definition_of_done: Option<String>,
    outcome: Option<String>,
    due: Option<String>,
    actor: Option<String>,
}

#[derive(Deserialize)]
struct UpdateBody {
    title: Option<String>,
    description: Option<String>,
    outcome: Option<String>,
    definition_of_done: Option<String>,
    standard: Option<String>,
    review_cycle: Option<String>,
    recurrence_rule: Option<String>,
    materialization_policy: Option<String>,
    area: Option<String>,
    project_id: Option<String>,
    routine_id: Option<String>,
    due: Option<String>,
    scheduled: Option<String>,
    priority: Option<i64>,
    reason: Option<String>,
}
```

Add routes to `router` using `post`, `patch`, and `get`.

- [ ] **Step 4: Implement handlers through `TodoService`**

Every handler must use `with_service(&state, |service| ...)`. Transition handlers must mirror the existing `approve_item` and `complete_item` pattern.

Do not instantiate `SqliteTodoRepository` inside individual handlers.

- [ ] **Step 5: Run API tests**

Run:

```bash
cargo test --test api_parity
```

Expected: PASS.

- [ ] **Step 6: Commit API extension**

Run:

```bash
git add src/interfaces/api.rs tests/api_parity.rs
git commit -m "[feat] add operational API routes"
```

## Task 6: Document Cutover Smoke Procedure

**Files:**
- Modify: `README.md`
- Modify: `docs/rust-refactor.md`

- [ ] **Step 1: Add copied-live-DB smoke commands**

Document this procedure:

```bash
tmp_home="$(mktemp -d)"
mkdir -p "$tmp_home"
cp ~/.hermes/oracle-todo/todo.sqlite "$tmp_home/todo.sqlite"
cargo run -- --home "$tmp_home" pending
cargo run -- --home "$tmp_home" today
cargo run -- --home "$tmp_home" export
```

State that the smoke uses a copied DB only and must not write to the live home.

- [ ] **Step 2: Add cutover gate checklist**

Document these required gates:

```text
cargo fmt --check
cargo test
cargo clippy --all-targets --all-features -- -D warnings
uv run pytest -q
cargo llvm-cov --summary-only
copied-live-DB smoke: pending, today, export
Python-to-Rust round-trip smoke
Rust-to-Python round-trip smoke
```

- [ ] **Step 3: Run docs diff check**

Run:

```bash
git diff --check README.md docs/rust-refactor.md
```

Expected: no output.

- [ ] **Step 4: Commit docs**

Run:

```bash
git add README.md docs/rust-refactor.md
git commit -m "[docs] add Rust cutover smoke gate"
```

## Task 7: Full Verification and Push

**Files:**
- All files modified by previous tasks.

- [ ] **Step 1: Run full verification**

Run:

```bash
cargo fmt --check
cargo test
cargo clippy --all-targets --all-features -- -D warnings
uv run pytest -q
cargo llvm-cov --summary-only
```

Expected:

- all Rust tests pass.
- all Python tests pass.
- Rust line coverage is at least 80%.

- [ ] **Step 2: Run copied-live-DB smoke**

Run against a copied data home:

```bash
tmp_home="$(mktemp -d)"
mkdir -p "$tmp_home"
cp ~/.hermes/oracle-todo/todo.sqlite "$tmp_home/todo.sqlite"
cargo run -- --home "$tmp_home" pending
cargo run -- --home "$tmp_home" today
cargo run -- --home "$tmp_home" export
```

Expected: all commands exit successfully without `unknown item type`, `unknown status`, or `unknown actor` errors.

- [ ] **Step 3: Inspect commit history and status**

Run:

```bash
git status --short --branch
git log --oneline -n 10
```

Expected: only intentionally untracked local files remain.

- [ ] **Step 4: Push branch**

Run:

```bash
git push origin refactor/rust-sqlite
```

Expected: branch updates successfully.

## Self-Review Checklist

- [ ] Spec coverage: DB enum compatibility, round-trip tests, CLI parity, API extension, docs, verification, and cutover smoke are represented.
- [ ] TDD ordering: every behavior change starts with failing tests before implementation.
- [ ] Clean Architecture: SQLite encoding stays outside application service; CLI/API use `TodoService`.
- [ ] SQLite safety: copied-live-DB smoke uses a temporary data home.
- [ ] KISS/YAGNI: no live migration, hard delete, dashboard, or new recurrence behavior.
- [ ] Verification: final gate includes Rust, Python, clippy, coverage, and copied DB smoke.
