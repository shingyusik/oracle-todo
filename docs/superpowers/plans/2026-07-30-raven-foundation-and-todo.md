# Raven Foundation and ToDo Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `raven` executable, Raven data-home/logging conventions, ToDo command delegation, and safe existing-ToDo import without changing ToDo domain behavior.

**Architecture:** A new `raven-cli` binary owns top-level parsing and resolves `RavenPaths`. The existing `todo-engine` remains the policy owner and exposes argument-driven adapter functions so Raven can invoke it in-process against `~/.raven/todo.sqlite`.

**Tech Stack:** Rust 2024, clap 4.5, rusqlite 0.32 bundled/backup, dotenvy, tracing, assert_cmd, tempfile

## Global Constraints

- Product/package/binary names are `Raven`, `@shings/raven`, and `raven`.
- Default home is `~/.raven`; precedence is `--home`, `RAVEN_HOME`, `.env`, default.
- ToDo keeps its existing `ItemStatus`, service policy, audit events, and no-hard-delete behavior.
- All tests use temporary homes; never open or mutate the live `~/.todo-engine/todo.sqlite`.
- Structured logging must not include titles, notes, descriptions, or raw payloads.
- Every task must keep `cargo fmt --check`, targeted tests, and clippy green.

---

### Task 1: Raven path and configuration foundation

**Files:**
- Modify: `Cargo.toml`
- Modify: `Cargo.lock`
- Create: `raven-cli/Cargo.toml`
- Create: `raven-cli/src/lib.rs`
- Create: `raven-cli/src/config.rs`
- Create: `raven-cli/src/main.rs`
- Test: `raven-cli/tests/config.rs`

**Interfaces:**
- Consumes: operating-system home directory and optional CLI/environment overrides.
- Produces: `RavenPaths::resolve(explicit_home) -> Result<RavenPaths>` and path accessors `todo_db()`, `ledger_db()`, `health_db()`, `health_media_dir()`, and `log_file()`.

- [ ] **Step 1: Write failing configuration tests**

```rust
#[test]
fn explicit_home_builds_all_raven_paths() {
    let paths = RavenPaths::resolve_with_default(
        Some(PathBuf::from("/tmp/raven-test")),
        None,
    ).unwrap();
    assert_eq!(paths.todo_db(), PathBuf::from("/tmp/raven-test/todo.sqlite"));
    assert_eq!(paths.ledger_db(), PathBuf::from("/tmp/raven-test/ledger.sqlite"));
    assert_eq!(paths.health_db(), PathBuf::from("/tmp/raven-test/health.sqlite"));
    assert_eq!(paths.health_media_dir(), PathBuf::from("/tmp/raven-test/media/health"));
    assert_eq!(paths.log_file(), PathBuf::from("/tmp/raven-test/logs/raven.log.jsonl"));
}

#[test]
fn raven_home_env_precedes_default_home() {
    let paths = RavenPaths::resolve_with_default(
        None,
        Some(PathBuf::from("/tmp/from-env")),
    ).unwrap();
    assert_eq!(paths.home(), Path::new("/tmp/from-env"));
}
```

- [ ] **Step 2: Run the tests and verify the crate is absent**

Run: `cargo test -p raven-cli --test config`

Expected: FAIL because package `raven-cli` and `RavenPaths` do not exist.

- [ ] **Step 3: Add the workspace member and minimal path implementation**

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RavenPaths {
    home: PathBuf,
}

impl RavenPaths {
    pub fn from_home(home: impl Into<PathBuf>) -> Self {
        Self { home: home.into() }
    }

    pub fn resolve(explicit: Option<PathBuf>) -> anyhow::Result<Self> {
        let env_home = std::env::var_os("RAVEN_HOME").map(PathBuf::from);
        Self::resolve_with_default(explicit, env_home)
    }

    pub fn resolve_with_default(
        explicit: Option<PathBuf>,
        env_home: Option<PathBuf>,
    ) -> anyhow::Result<Self> {
        let home = explicit
            .or(env_home)
            .or_else(|| std::env::var_os("HOME").map(|value| PathBuf::from(value).join(".raven")))
            .ok_or_else(|| anyhow::anyhow!("HOME is not set"))?;
        Ok(Self { home })
    }

    pub fn todo_db(&self) -> PathBuf { self.home.join("todo.sqlite") }
    pub fn ledger_db(&self) -> PathBuf { self.home.join("ledger.sqlite") }
    pub fn health_db(&self) -> PathBuf { self.home.join("health.sqlite") }
    pub fn health_media_dir(&self) -> PathBuf { self.home.join("media/health") }
    pub fn log_file(&self) -> PathBuf { self.home.join("logs/raven.log.jsonl") }
    pub fn home(&self) -> &Path { &self.home }
}
```

Declare `raven-cli` as a workspace member and expose only `config` from its library. Make the binary print clap help until Task 3 adds commands.

- [ ] **Step 4: Run configuration and workspace tests**

Run: `cargo test -p raven-cli --test config && cargo test --workspace`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml Cargo.lock raven-cli
git commit -m "[ADD] Establish Raven path foundation" -m "- Raven 데이터 홈과 엔진별 경로 계약 추가
- 단일 raven 바이너리 크레이트를 워크스페이스에 등록"
```

### Task 2: Argument-driven ToDo adapter

**Files:**
- Modify: `todo-engine/src/interfaces/cli/mod.rs`
- Modify: `todo-engine/src/infrastructure/paths.rs`
- Modify: `todo-engine/src/main.rs`
- Test: `todo-engine/tests/e2e/cli.rs`
- Test: `todo-engine/tests/unit/architecture.rs`

**Interfaces:**
- Consumes: an explicit `&Path` and ToDo-only argv values.
- Produces: `todo_engine::interfaces::cli::run_from(args)` for the legacy binary and `run_at(home, args)` for Raven delegation.

- [ ] **Step 1: Add a failing delegated-command test**

```rust
#[test]
fn run_at_executes_today_against_the_explicit_home() {
    let home = tempfile::tempdir().unwrap();
    todo_engine::interfaces::cli::run_at(home.path(), ["todo-engine", "init"]).unwrap();
    assert!(home.path().join("todo.sqlite").exists());
}
```

Add an architecture assertion that `raven-cli` will not import private ToDo CLI types; only the public functions are required.

- [ ] **Step 2: Run the focused test**

Run: `cargo test -p todo-engine --test e2e run_at_executes_today_against_the_explicit_home`

Expected: FAIL because `run_at` is undefined.

- [ ] **Step 3: Split parsing from execution**

```rust
pub fn run() -> Result<()> {
    load_dotenv()?;
    run_from(std::env::args_os())
}

pub fn run_from<I, T>(args: I) -> Result<()>
where
    I: IntoIterator<Item = T>,
    T: Into<std::ffi::OsString> + Clone,
{
    let cli = Cli::parse_from(args);
    let home = todo_home(cli.home)?;
    execute(home, cli.command)
}

pub fn run_at<I, T>(home: &Path, args: I) -> Result<()>
where
    I: IntoIterator<Item = T>,
    T: Into<std::ffi::OsString> + Clone,
{
    let cli = Cli::parse_from(args);
    execute(home.to_path_buf(), cli.command)
}
```

Move the current command match and completion logging into private `execute`. Keep `main.rs` calling `run()` so all existing commands remain compatible during transition.

- [ ] **Step 4: Run all ToDo tests**

Run: `cargo test -p todo-engine`

Expected: PASS with unchanged CLI/API behavior.

- [ ] **Step 5: Commit**

```bash
git add todo-engine/src todo-engine/tests
git commit -m "[REFACTOR] Expose argument-driven ToDo CLI" -m "- Raven이 명시적 데이터 홈으로 ToDo 명령을 위임할 수 있게 분리
- 기존 todo-engine 실행 경로와 정책 동작은 유지"
```

### Task 3: Raven top-level commands and unified logging

**Files:**
- Modify: `raven-cli/Cargo.toml`
- Modify: `raven-cli/src/lib.rs`
- Create: `raven-cli/src/cli.rs`
- Create: `raven-cli/src/logging.rs`
- Create: `raven-cli/src/commands/mod.rs`
- Create: `raven-cli/src/commands/init.rs`
- Create: `raven-cli/src/commands/todo.rs`
- Modify: `raven-cli/src/main.rs`
- Test: `raven-cli/tests/cli.rs`

**Interfaces:**
- Consumes: `RavenPaths` and `todo_engine::interfaces::cli::run_at`.
- Produces: `raven init`, `raven health-check`, and transparent `raven todo <args...>`.

- [ ] **Step 1: Write failing CLI tests**

```rust
#[test]
fn raven_init_creates_todo_database_and_media_directory() {
    let home = tempfile::tempdir().unwrap();
    Command::cargo_bin("raven").unwrap()
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .assert().success();
    assert!(home.path().join("todo.sqlite").exists());
    assert!(home.path().join("media/health").is_dir());
}

#[test]
fn raven_todo_delegates_existing_commands() {
    let home = tempfile::tempdir().unwrap();
    Command::cargo_bin("raven").unwrap()
        .args(["--home", home.path().to_str().unwrap(), "todo", "init"])
        .assert().success();
}
```

- [ ] **Step 2: Run the Raven CLI test**

Run: `cargo test -p raven-cli --test cli`

Expected: FAIL because the subcommands are not defined.

- [ ] **Step 3: Implement top-level parsing and delegation**

```rust
#[derive(Debug, Parser)]
#[command(name = "raven")]
pub struct Cli {
    #[arg(long, env = "RAVEN_HOME")]
    pub home: Option<PathBuf>,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    Init,
    HealthCheck,
    Todo {
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<OsString>,
    },
}
```

`init` creates the home, `media/health`, and initializes `todo.sqlite`.
`health-check` opens the ToDo database and reports unavailable Ledger/Health
databases as `not_initialized` until their plans add initializers. Prefix the
delegated argv with `todo-engine` before calling `run_at`.

Move tracing setup to `raven-cli/src/logging.rs` with `RAVEN_CONSOLE_LOG`,
`RAVEN_FILE_LOG`, `RAVEN_LOG_MAX_BYTES`, and `RAVEN_LOG_MAX_FILES`. Emit only
command name, engine, duration, exit code, and safe IDs.

- [ ] **Step 4: Run CLI and regression gates**

Run: `cargo test -p raven-cli && cargo test -p todo-engine && cargo fmt --check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add raven-cli todo-engine Cargo.lock
git commit -m "[ADD] Route ToDo through Raven CLI" -m "- raven init과 health-check 및 todo 위임 명령 추가
- Raven 전용 구조화 로그와 환경변수 계약 적용"
```

### Task 4: Safe ToDo database import

**Files:**
- Modify: `todo-engine/Cargo.toml`
- Modify: `raven-cli/Cargo.toml`
- Create: `raven-cli/src/commands/import.rs`
- Modify: `raven-cli/src/commands/mod.rs`
- Modify: `raven-cli/src/cli.rs`
- Test: `raven-cli/tests/import_todo.rs`

**Interfaces:**
- Consumes: source home from `--source-home` or `~/.todo-engine`, destination from `RavenPaths::todo_db()`.
- Produces: `import_todo(source_home, &RavenPaths) -> Result<ImportReport>` and `raven import todo`.

- [ ] **Step 1: Write import safety tests**

```rust
#[test]
fn import_copies_and_validates_without_modifying_source() {
    let source = seeded_todo_home();
    let source_before = std::fs::metadata(source.path().join("todo.sqlite")).unwrap().len();
    let destination = tempfile::tempdir().unwrap();

    let report = import_todo(source.path(), &RavenPaths::from_home(destination.path())).unwrap();

    assert_eq!(report.integrity_check, "ok");
    assert!(destination.path().join("todo.sqlite").exists());
    assert_eq!(
        std::fs::metadata(source.path().join("todo.sqlite")).unwrap().len(),
        source_before,
    );
}

#[test]
fn import_refuses_existing_destination() {
    let error = import_todo(source.path(), &RavenPaths::from_home(destination.path()))
        .unwrap_err();
    assert!(matches!(error, ImportTodoError::DestinationExists(_)));
}
```

- [ ] **Step 2: Run the import tests**

Run: `cargo test -p raven-cli --test import_todo`

Expected: FAIL because import types and command are absent.

- [ ] **Step 3: Implement SQLite online backup and validation**

```rust
pub struct ImportReport {
    pub source: PathBuf,
    pub destination: PathBuf,
    pub integrity_check: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ImportTodoError {
    #[error("destination already exists: {0}")]
    DestinationExists(PathBuf),
    #[error("imported database failed integrity_check: {0}")]
    Integrity(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
}

pub fn import_todo(
    source_home: &Path,
    paths: &RavenPaths,
) -> Result<ImportReport, ImportTodoError> {
    let source_path = source_home.join("todo.sqlite");
    let destination_path = paths.todo_db();
    if destination_path.exists() {
        return Err(ImportTodoError::DestinationExists(destination_path));
    }
    std::fs::create_dir_all(paths.home())?;

    let source = rusqlite::Connection::open_with_flags(
        &source_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )?;
    let mut destination = rusqlite::Connection::open(&destination_path)?;
    rusqlite::backup::Backup::new(&source, &mut destination)?.run_to_completion(
        64,
        std::time::Duration::from_millis(10),
        None,
    )?;
    todo_engine::infrastructure::sqlite::init_schema(&destination)?;
    let integrity: String =
        destination.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if integrity != "ok" {
        return Err(ImportTodoError::Integrity(integrity));
    }
    Ok(ImportReport { source: source_path, destination: destination_path, integrity_check: integrity })
}
```

On any failure after destination creation, remove only the newly created
destination file. Never delete, rewrite, or schema-initialize the source.

- [ ] **Step 4: Run import, CLI, and ToDo tests**

Run: `cargo test -p raven-cli --test import_todo && cargo test -p raven-cli --test cli && cargo test -p todo-engine`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Cargo.lock raven-cli todo-engine/Cargo.toml
git commit -m "[ADD] Import existing ToDo data safely" -m "- SQLite 온라인 백업으로 기존 DB를 Raven 홈에 복사
- 대상 덮어쓰기 방지와 integrity_check 검증 추가"
```

### Task 5: Foundation verification

**Files:**
- Modify: `scripts/create-mock-db.sh`
- Modify: `scripts/create-mock-db.ps1`
- Modify: `scripts/test-create-mock-db.sh`
- Test: `raven-cli/tests/cli.rs`

**Interfaces:**
- Consumes: completed foundation commands.
- Produces: platform-neutral smoke evidence for Raven paths and unchanged ToDo behavior.

- [ ] **Step 1: Add a failing smoke assertion**

```bash
cargo run -p raven-cli -- --home "$SMOKE_HOME" init
cargo run -p raven-cli -- --home "$SMOKE_HOME" todo today
test -f "$SMOKE_HOME/todo.sqlite"
test -d "$SMOKE_HOME/media/health"
```

Mirror the same explicit-home checks in PowerShell without using the live home.

- [ ] **Step 2: Run the smoke test before script updates**

Run: `bash scripts/test-create-mock-db.sh`

Expected: FAIL because the scripts still invoke `todo-engine`.

- [ ] **Step 3: Update scripts to use Raven**

Use `cargo run -p raven-cli --` in both shell variants, pass only explicit
temporary homes, and retain all existing mock-data assertions.

```bash
cargo run -p raven-cli -- --home "$MOCK_HOME" init
cargo run -p raven-cli -- --home "$MOCK_HOME" todo area create "Health"
cargo run -p raven-cli -- --home "$MOCK_HOME" todo list --format json
```

- [ ] **Step 4: Run the full foundation gate**

Run: `cargo fmt --check && cargo test --workspace && cargo clippy --all-targets --all-features -- -D warnings && bash scripts/test-create-mock-db.sh`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts raven-cli/tests
git commit -m "[UPDATE] Verify ToDo through Raven" -m "- 임시 Raven 홈 기반 스모크 경로로 전환
- 기존 ToDo 생성과 조회 회귀 검증 유지"
```
