# Tracing Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom CLI operational logger with `tracing`-based console and rotating JSONL file logging.

**Architecture:** CLI startup resolves the data home before tracing initialization, then installs two `tracing_subscriber` layers: stderr console logs at `INFO+` and JSONL file logs at `DEBUG+`. A local rotating writer preserves the existing size/count backup policy and writes to `logs/oracle-todo.log.jsonl`.

**Tech Stack:** Rust 2024, `tracing`, `tracing-subscriber`, `serde_json`, `assert_cmd`, `tempfile`.

---

## File Structure

- Modify `Cargo.toml`: enable the `json` feature on `tracing-subscriber`.
- Modify `src/infrastructure/system.rs`: remove `OperationalLogger`, add `init_tracing(home)`, level parsing helpers, and a buffered rotating JSONL writer.
- Modify `src/interfaces/cli/mod.rs`: initialize tracing after resolving `home`, replace explicit logger calls with `tracing` events, and add progress logs around DB/service setup.
- Modify `tests/e2e/cli.rs`: replace old operational logger assertions with tracing console/file/rotation assertions.
- Modify `docs/conventions/logging.md`, `docs/operations/logging-and-rotation.md`, `docs/operations/data-home.md`, `docs/operations/cli-reference.md`, `README.md`, `CLAUDE.md`, and `AGENTS.md` only where stable docs still mention `oracle-todo.jsonl` or `OperationalLogger`.

---

### Task 1: Add Failing Tracing CLI Tests

**Files:**
- Modify: `tests/e2e/cli.rs`

- [ ] **Step 1: Replace the success logging test**

Replace `cli_writes_structured_jsonl_logs_without_changing_stdout` with:

```rust
#[test]
fn cli_writes_info_to_stderr_and_debug_to_file_without_changing_stdout() {
    let home = TestHome::new();

    let output = Command::cargo_bin("oracle-todo")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .assert()
        .success()
        .stdout(contains("initialized"))
        .get_output()
        .clone();

    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("todo.sqlite"));

    let stderr = String::from_utf8(output.stderr).unwrap();
    assert!(stderr.contains("INFO"));
    assert!(stderr.contains("command started"));
    assert!(stderr.contains("command completed"));
    assert!(!stderr.contains("DEBUG"));

    let records = read_jsonl_records(home.path().join("logs/oracle-todo.log.jsonl"));
    assert_jsonl_event(&records, "INFO", "command_started");
    assert_jsonl_event(&records, "INFO", "command_completed");
    assert_jsonl_event(&records, "DEBUG", "home_resolved");
    assert_jsonl_event(&records, "DEBUG", "database_opened");
}
```

- [ ] **Step 2: Replace the error logging test**

Replace `cli_logs_error_exit_code_for_todo_errors` with:

```rust
#[test]
fn cli_logs_error_event_with_exit_code_to_file() {
    let home = TestHome::new();

    Command::cargo_bin("oracle-todo")
        .unwrap()
        .args(["--home", home.path().to_str().unwrap(), "init"])
        .assert()
        .success();

    Command::cargo_bin("oracle-todo")
        .unwrap()
        .args([
            "--home",
            home.path().to_str().unwrap(),
            "task",
            "propose",
            "실패할 일",
            "--area",
            "없는영역",
        ])
        .assert()
        .code(4)
        .stderr(contains("ERROR"))
        .stderr(contains("Item not found: 없는영역"));

    let records = read_jsonl_records(home.path().join("logs/oracle-todo.log.jsonl"));
    let error = find_jsonl_event(&records, "command_failed");
    assert_eq!(error["level"], "ERROR");
    assert_eq!(error["fields"]["command"], "task propose");
    assert_eq!(error["fields"]["exit_code"], 4);
    assert!(
        error["fields"]["error"]
            .as_str()
            .unwrap()
            .contains("Item not found: 없는영역")
    );
}
```

- [ ] **Step 3: Replace the rotation test**

Replace `cli_rotates_jsonl_logs_with_configurable_backup_count` with:

```rust
#[test]
fn cli_rotates_tracing_jsonl_logs_with_configurable_backup_count() {
    let home = TestHome::new();

    for _ in 0..8 {
        Command::cargo_bin("oracle-todo")
            .unwrap()
            .env("ORACLE_TODO_LOG_MAX_BYTES", "520")
            .env("ORACLE_TODO_LOG_MAX_FILES", "2")
            .args(["--home", home.path().to_str().unwrap(), "init"])
            .assert()
            .success();
    }

    let log_path = home.path().join("logs/oracle-todo.log.jsonl");
    let rotated_path = home.path().join("logs/oracle-todo.log.jsonl.1");
    let second_rotated_path = home.path().join("logs/oracle-todo.log.jsonl.2");
    let third_rotated_path = home.path().join("logs/oracle-todo.log.jsonl.3");
    assert!(log_path.exists());
    assert!(rotated_path.exists());
    assert!(second_rotated_path.exists());
    assert!(!third_rotated_path.exists());

    let records = read_jsonl_records(&log_path)
        .into_iter()
        .chain(read_jsonl_records(rotated_path))
        .chain(read_jsonl_records(second_rotated_path))
        .collect::<Vec<_>>();
    assert_jsonl_event(&records, "INFO", "log_rotated");
    assert!(records.iter().any(|record| record["fields"]["event"] == "command_completed"));
}
```

- [ ] **Step 4: Add JSONL helper functions**

Keep `read_jsonl_records`, then add:

```rust
fn find_jsonl_event<'a>(
    records: &'a [serde_json::Value],
    event: &str,
) -> &'a serde_json::Value {
    records
        .iter()
        .find(|record| record["fields"]["event"] == event)
        .unwrap_or_else(|| panic!("{event} event in {records:#?}"))
}

fn assert_jsonl_event(records: &[serde_json::Value], level: &str, event: &str) {
    let record = find_jsonl_event(records, event);
    assert_eq!(record["level"], level);
}
```

- [ ] **Step 5: Run tests to verify RED**

Run:

```bash
cargo test --test e2e cli_writes_info_to_stderr_and_debug_to_file_without_changing_stdout cli_logs_error_event_with_exit_code_to_file cli_rotates_tracing_jsonl_logs_with_configurable_backup_count
```

Expected: Cargo rejects multiple filters. Then run:

```bash
cargo test --test e2e cli_
```

Expected: FAIL because `logs/oracle-todo.log.jsonl` does not exist and stderr still has no info logs.

---

### Task 2: Implement Tracing Initialization and Rotating File Writer

**Files:**
- Modify: `Cargo.toml`
- Modify: `src/infrastructure/system.rs`

- [ ] **Step 1: Enable JSON formatting**

Change the dependency to:

```toml
tracing-subscriber = { version = "0.3", features = ["env-filter", "fmt", "json"] }
```

- [ ] **Step 2: Replace logger types in `system.rs` imports**

Use:

```rust
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde_json::json;
use time::{OffsetDateTime, UtcOffset, format_description::well_known::Rfc3339};
use tracing::Level;
use tracing_subscriber::Layer;
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
```

- [ ] **Step 3: Replace `init_tracing()` and remove `OperationalLogger`**

Implement:

```rust
pub fn init_tracing(home: &Path) {
    let log_dir = home.join("logs");
    let file_writer = RotatingJsonlMakeWriter::new(
        log_dir.join("oracle-todo.log.jsonl"),
        log_max_bytes_from_env(),
        log_max_files_from_env(),
    );

    let console_level = level_from_env("ORACLE_TODO_CONSOLE_LOG", LevelFilter::INFO);
    let file_level = level_from_env("ORACLE_TODO_FILE_LOG", LevelFilter::DEBUG);

    let console_layer = tracing_subscriber::fmt::layer()
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .with_filter(console_level);

    let file_layer = tracing_subscriber::fmt::layer()
        .json()
        .flatten_event(false)
        .with_writer(file_writer)
        .with_filter(file_level);

    let _ = tracing_subscriber::registry()
        .with(console_layer)
        .with(file_layer)
        .try_init();
}
```

- [ ] **Step 4: Add level parsing helper**

Implement:

```rust
fn level_from_env(name: &str, default: LevelFilter) -> LevelFilter {
    std::env::var(name)
        .ok()
        .and_then(|value| match value.to_ascii_lowercase().as_str() {
            "off" => Some(LevelFilter::OFF),
            "error" => Some(LevelFilter::ERROR),
            "warn" | "warning" => Some(LevelFilter::WARN),
            "info" => Some(LevelFilter::INFO),
            "debug" => Some(LevelFilter::DEBUG),
            "trace" => Some(LevelFilter::TRACE),
            _ => None,
        })
        .unwrap_or(default)
}
```

- [ ] **Step 5: Add rotating writer state**

Implement:

```rust
#[derive(Debug, Clone)]
struct RotatingJsonlMakeWriter {
    state: Arc<Mutex<RotatingJsonlState>>,
}

#[derive(Debug)]
struct RotatingJsonlState {
    path: PathBuf,
    max_bytes: u64,
    max_files: usize,
}

#[derive(Debug)]
struct RotatingJsonlWriter {
    state: Arc<Mutex<RotatingJsonlState>>,
    buffer: Vec<u8>,
}
```

- [ ] **Step 6: Implement `MakeWriter` and buffered `Write`**

Implement:

```rust
impl RotatingJsonlMakeWriter {
    fn new(path: PathBuf, max_bytes: u64, max_files: usize) -> Self {
        Self {
            state: Arc::new(Mutex::new(RotatingJsonlState {
                path,
                max_bytes,
                max_files,
            })),
        }
    }
}

impl<'a> MakeWriter<'a> for RotatingJsonlMakeWriter {
    type Writer = RotatingJsonlWriter;

    fn make_writer(&'a self) -> Self::Writer {
        RotatingJsonlWriter {
            state: Arc::clone(&self.state),
            buffer: Vec::new(),
        }
    }
}

impl Write for RotatingJsonlWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.buffer.extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Drop for RotatingJsonlWriter {
    fn drop(&mut self) {
        if self.buffer.is_empty() {
            return;
        }
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        let _ = state.write_event(&self.buffer);
    }
}
```

- [ ] **Step 7: Implement rotation and direct rotation record**

Implement methods on `RotatingJsonlState`:

```rust
impl RotatingJsonlState {
    fn write_event(&mut self, bytes: &[u8]) -> io::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }

        let rotated = self.rotate_if_needed(bytes.len() as u64)?;
        if rotated {
            self.write_rotation_record()?;
        }

        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?
            .write_all(bytes)
    }

    fn rotate_if_needed(&self, incoming_bytes: u64) -> io::Result<bool> {
        let current_bytes = fs::metadata(&self.path)
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        if current_bytes == 0 || current_bytes + incoming_bytes <= self.max_bytes {
            return Ok(false);
        }

        if self.max_files == 0 {
            if self.path.exists() {
                fs::remove_file(&self.path)?;
            }
            return Ok(true);
        }

        let oldest = self.rotated_path(self.max_files);
        if oldest.exists() {
            fs::remove_file(oldest)?;
        }

        for index in (1..self.max_files).rev() {
            let source = self.rotated_path(index);
            if source.exists() {
                fs::rename(source, self.rotated_path(index + 1))?;
            }
        }

        if self.path.exists() {
            fs::rename(&self.path, self.rotated_path(1))?;
        }
        Ok(true)
    }

    fn write_rotation_record(&self) -> io::Result<()> {
        let record = json!({
            "timestamp": timestamp(),
            "level": Level::INFO.as_str(),
            "fields": {
                "message": "log file rotated",
                "event": "log_rotated",
                "backup_count": self.max_files,
            },
            "target": "oracle_todo::infrastructure::system",
        });
        let mut line = serde_json::to_vec(&record)?;
        line.push(b'\n');
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?
            .write_all(&line)
    }

    fn rotated_path(&self, index: usize) -> PathBuf {
        let file_name = self
            .path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("oracle-todo.log.jsonl");
        self.path.with_file_name(format!("{file_name}.{index}"))
    }
}
```

- [ ] **Step 8: Run tests to verify partial GREEN**

Run:

```bash
cargo test --test e2e cli_
```

Expected: still FAIL until CLI emits the expected tracing events.

---

### Task 3: Replace CLI Logger Calls With Tracing Events

**Files:**
- Modify: `src/interfaces/cli/mod.rs`

- [ ] **Step 1: Update imports**

Replace:

```rust
use crate::infrastructure::system::{OperationalLogger, init_tracing, local_today_string};
```

with:

```rust
use crate::infrastructure::system::{init_tracing, local_today_string};
```

- [ ] **Step 2: Update `run()` startup and completion logging**

Change the top and bottom of `run()` to:

```rust
pub fn run() -> Result<()> {
    let cli = Cli::parse();
    let command_name = command_label(&cli.command);
    let home = todo_home(cli.home)?;
    init_tracing(&home);
    tracing::debug!(event = "home_resolved", home = %home.display());
    tracing::info!(event = "command_started", command = command_name, "command started");
    let started_at = Instant::now();

    let result = match cli.command {
        // existing match arms stay unchanged
    };

    let duration_ms = elapsed_millis(started_at);
    match &result {
        Ok(()) => tracing::info!(
            event = "command_completed",
            command = command_name,
            duration_ms,
            exit_code = 0,
            "command completed"
        ),
        Err(error) => tracing::error!(
            event = "command_failed",
            command = command_name,
            duration_ms,
            exit_code = TodoError::cli_exit_code_from_error(error),
            error = %format!("{error:#}"),
            "command failed"
        ),
    }
    result
}
```

- [ ] **Step 3: Add DB progress logs**

Add these logs in `init`, `health`, `migrate_legacy_db`, and `service` immediately after `let db_path = db_path(home);`:

```rust
tracing::debug!(event = "database_path_resolved", path = %db_path.display());
```

Add this log immediately after each successful `connect_path(&db_path)?`:

```rust
tracing::debug!(event = "database_opened", path = %db_path.display());
```

Add this log immediately after each successful `init_schema(&conn)?`:

```rust
tracing::debug!(event = "schema_initialized", path = %db_path.display());
```

In `service`, after `init_schema(&conn)?`, add:

```rust
tracing::debug!(event = "service_ready", path = %db_path.display());
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```bash
cargo test --test e2e cli_
```

Expected: PASS for the CLI logging tests and existing CLI e2e tests.

---

### Task 4: Documentation Sync

**Files:**
- Modify: `README.md`
- Modify: `docs/conventions/logging.md`
- Modify: `docs/operations/logging-and-rotation.md`
- Modify: `docs/operations/data-home.md`
- Modify: `docs/operations/cli-reference.md`
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Replace old filename references**

Replace `oracle-todo.jsonl` with `oracle-todo.log.jsonl` only where the text refers to operational/file logging. Do not change SQLite audit-event docs.

- [ ] **Step 2: Update logging convention language**

In `docs/conventions/logging.md`, describe:

```markdown
Use `tracing::{debug, info, warn, error}!` for operational logging.
stdout remains command output; stderr receives console logs at `ORACLE_TODO_CONSOLE_LOG`
or `info`; `logs/oracle-todo.log.jsonl` receives JSONL logs at `ORACLE_TODO_FILE_LOG`
or `debug`.
```

- [ ] **Step 3: Update rotation docs**

In `docs/operations/logging-and-rotation.md`, describe that the file remains size-rotated by the local writer and that rotation can add `event="log_rotated"` JSONL records.

- [ ] **Step 4: Keep agent context files in sync**

Apply the same filename/config facts to `CLAUDE.md` and `AGENTS.md`.

---

### Task 5: Full Verification

**Files:**
- No edits.

- [ ] **Step 1: Format check**

Run:

```bash
cargo fmt --check
```

Expected: PASS.

- [ ] **Step 2: Test suite**

Run:

```bash
cargo test
```

Expected: PASS.

- [ ] **Step 3: Lint gate**

Run:

```bash
cargo clippy --all-targets --all-features -- -D warnings
```

Expected: PASS.

- [ ] **Step 4: Manual smoke**

Run:

```bash
tmp_home=$(mktemp -d /tmp/oracle-todo-tracing.XXXXXX)
cargo run --quiet -- --home "$tmp_home" init
cargo run --quiet -- --home "$tmp_home" pending
tail -n 20 "$tmp_home/logs/oracle-todo.log.jsonl"
```

Expected: stderr shows INFO records, stdout still shows command output, and the file includes INFO and DEBUG JSONL records.
