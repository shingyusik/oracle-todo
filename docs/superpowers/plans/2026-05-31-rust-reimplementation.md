# Rust Reimplementation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reimplement `oracle-todo` in Rust with behavior parity for the current Python SQLite engine.

**Architecture:** Use Clean Architecture with framework-free domain and application layers, SQLite/logging/API/CLI as outer adapters, and all mutations routed through `TodoService`. Each task is a vertical slice that starts with failing Rust tests, passes them with minimal code, then refactors while preserving parity.

**Tech Stack:** Rust 2024, `rusqlite`, `clap`, `serde`, `serde_json`, `thiserror`, `uuid`, `time`, `tracing`, `tracing-subscriber`, `axum`, `tokio`, `tempfile`, `assert_cmd`, `predicates`, `tower`, `http-body-util`.

---

## Source Design

Implement this file structure:

- Create `src/lib.rs`: public module wiring and re-exports used by tests, CLI, and API.
- Create `src/domain/mod.rs`: domain module exports.
- Create `src/domain/model.rs`: `TodoItem`, `TodoEvent`, enums, terminal-status helper, constructors.
- Create `src/domain/recurrence.rs`: recurrence parser and occurrence generation.
- Create `src/application/mod.rs`: application module exports.
- Create `src/application/error.rs`: typed `TodoError` and `TodoResult`.
- Create `src/application/ports.rs`: repository, clock, id, and event sink traits.
- Create `src/application/service.rs`: `TodoService` use cases and policy orchestration.
- Create `src/infrastructure/mod.rs`: infrastructure module exports.
- Create `src/infrastructure/paths.rs`: data-home, DB, export-path resolution.
- Create `src/infrastructure/sqlite.rs`: SQLite schema, migrations, repository implementation.
- Create `src/infrastructure/system.rs`: system clock, UUID id generator, tracing event sink.
- Create `src/interfaces/mod.rs`: interface module exports.
- Create `src/interfaces/cli.rs`: `clap` command parsing and CLI handlers.
- Create `src/interfaces/api.rs`: `axum` router and handlers.
- Create `src/exports.rs`: markdown rendering and export file writing.
- Modify `src/main.rs`: initialize tracing, parse CLI, call `interfaces::cli::run`.
- Modify `Cargo.toml`: add serialization, API, logging, test, and binary-test dependencies.
- Create `tests/support/mod.rs`: temporary data-home helpers.
- Create `tests/application_policy.rs`: application parity tests for creation and transitions.
- Create `tests/routine_materialization.rs`: routine parity tests.
- Create `tests/sqlite_repository.rs`: schema, persistence, and compatibility tests.
- Create `tests/cli_parity.rs`: CLI command parity tests.
- Create `tests/api_parity.rs`: API route parity tests.
- Create `tests/export_parity.rs`: markdown export tests.
- Create `tests/logging_errors.rs`: logging and typed error tests.

Keep the existing Python files and tests untouched until Rust parity is verified.

## Task 1: Rust Foundation

**Files:**
- Modify: `Cargo.toml`
- Create: `src/lib.rs`
- Create: `src/domain/mod.rs`
- Create: `src/domain/model.rs`
- Create: `src/application/mod.rs`
- Create: `src/application/error.rs`
- Create: `src/application/ports.rs`
- Test: `tests/application_policy.rs`

- [ ] **Step 1: Add failing foundation tests**

Create `tests/application_policy.rs` with:

```rust
use oracle_todo::domain::{Actor, ItemStatus, ItemType, TodoItem};

#[test]
fn oracle_task_starts_proposed() {
    let item = TodoItem::new_task("앱 열고 DB 확인", Actor::Oracle);

    assert_eq!(item.item_type, ItemType::Task);
    assert_eq!(item.status, ItemStatus::Proposed);
    assert_eq!(item.proposed_by, Actor::Oracle);
}

#[test]
fn user_task_starts_approved() {
    let item = TodoItem::new_task("직접 입력한 일", Actor::User);

    assert_eq!(item.status, ItemStatus::Approved);
    assert_eq!(item.approved_by, Some(Actor::User));
    assert!(item.approved_at.is_some());
}
```

- [ ] **Step 2: Run the failing tests**

Run: `cargo test --test application_policy oracle_task_starts_proposed user_task_starts_approved`

Expected: FAIL because `oracle_todo::domain` and `TodoItem::new_task` do not exist.

- [ ] **Step 3: Add minimal dependencies**

Modify `Cargo.toml` dependencies to include:

```toml
[dependencies]
anyhow = "1.0"
axum = "0.7"
clap = { version = "4.5", features = ["derive", "env"] }
rusqlite = { version = "0.32", features = ["bundled"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
time = { version = "0.3", features = ["formatting", "parsing", "macros", "serde"] }
tokio = { version = "1", features = ["macros", "rt-multi-thread", "net"] }
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "fmt"] }
uuid = { version = "1", features = ["v4"] }

[dev-dependencies]
assert_cmd = "2"
http = "1"
http-body-util = "0.1"
predicates = "3"
tempfile = "3.15"
tower = { version = "0.5", features = ["util"] }
```

- [ ] **Step 4: Add module wiring**

Create `src/lib.rs`:

```rust
pub mod application;
pub mod domain;
```

Create `src/domain/mod.rs`:

```rust
mod model;

pub use model::{Actor, ItemStatus, ItemType, TodoEvent, TodoItem, terminal_status};
```

Create `src/application/mod.rs`:

```rust
pub mod error;
pub mod ports;
```

Do not declare `exports`, `infrastructure`, `interfaces`, `domain::recurrence`, or `application::service` in Task 1. Add each `pub mod` only in the task that creates the corresponding file so this task can reach a green test state.

- [ ] **Step 5: Add minimal domain model**

Create `src/domain/model.rs`:

```rust
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemType {
    Area,
    Project,
    Routine,
    Task,
    Event,
    Review,
    ArchiveItem,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemStatus {
    Proposed,
    Approved,
    Active,
    Waiting,
    Paused,
    Completed,
    Cancelled,
    Dropped,
    Archived,
    Someday,
    Rejected,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Actor {
    User,
    Oracle,
    System,
}

pub fn terminal_status(status: ItemStatus) -> bool {
    matches!(
        status,
        ItemStatus::Completed
            | ItemStatus::Cancelled
            | ItemStatus::Dropped
            | ItemStatus::Archived
            | ItemStatus::Someday
            | ItemStatus::Rejected
    )
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TodoItem {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: ItemType,
    pub title: String,
    pub status: ItemStatus,
    pub area_id: Option<String>,
    pub project_id: Option<String>,
    pub routine_id: Option<String>,
    pub parent_id: Option<String>,
    pub description: Option<String>,
    pub outcome: Option<String>,
    pub definition_of_done: Option<String>,
    pub standard: Option<String>,
    pub review_cycle: Option<String>,
    pub recurrence_rule: Option<String>,
    pub materialization_policy: String,
    pub occurrence_key: Option<String>,
    pub priority: Option<i64>,
    pub due: Option<String>,
    pub scheduled: Option<String>,
    pub horizon: Option<String>,
    pub proposed_by: Actor,
    pub approved_by: Option<Actor>,
    pub approved_at: Option<OffsetDateTime>,
    pub completed_at: Option<OffsetDateTime>,
    pub archived_at: Option<OffsetDateTime>,
    pub last_materialized_at: Option<OffsetDateTime>,
    pub second_brain_refs: Vec<Value>,
    #[serde(rename = "metadata_")]
    pub metadata: Map<String, Value>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TodoEvent {
    pub id: String,
    pub at: OffsetDateTime,
    pub actor: Actor,
    pub action: String,
    pub object_type: String,
    pub object_id: String,
    pub before: Option<Value>,
    pub after: Option<Value>,
    pub reason: Option<String>,
}

impl TodoItem {
    pub fn new_task(title: impl Into<String>, actor: Actor) -> Self {
        Self::new(ItemType::Task, "task", title, actor)
    }

    pub fn new(item_type: ItemType, prefix: &str, title: impl Into<String>, actor: Actor) -> Self {
        let now = OffsetDateTime::now_utc();
        let approved = actor == Actor::User;
        Self {
            id: format!("{}_{}", prefix, Uuid::new_v4().simple().to_string().chars().take(12).collect::<String>()),
            item_type,
            title: title.into(),
            status: if approved { ItemStatus::Approved } else { ItemStatus::Proposed },
            area_id: None,
            project_id: None,
            routine_id: None,
            parent_id: None,
            description: None,
            outcome: None,
            definition_of_done: None,
            standard: None,
            review_cycle: None,
            recurrence_rule: None,
            materialization_policy: "single_open".to_string(),
            occurrence_key: None,
            priority: None,
            due: None,
            scheduled: None,
            horizon: None,
            proposed_by: actor,
            approved_by: approved.then_some(Actor::User),
            approved_at: approved.then_some(now),
            completed_at: None,
            archived_at: None,
            last_materialized_at: None,
            second_brain_refs: Vec::new(),
            metadata: Map::new(),
            created_at: now,
            updated_at: now,
        }
    }
}

impl ItemType {
    pub fn as_str(self) -> &'static str {
        match self {
            ItemType::Area => "area",
            ItemType::Project => "project",
            ItemType::Routine => "routine",
            ItemType::Task => "task",
            ItemType::Event => "event",
            ItemType::Review => "review",
            ItemType::ArchiveItem => "archive_item",
        }
    }
}

impl ItemStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            ItemStatus::Proposed => "proposed",
            ItemStatus::Approved => "approved",
            ItemStatus::Active => "active",
            ItemStatus::Waiting => "waiting",
            ItemStatus::Paused => "paused",
            ItemStatus::Completed => "completed",
            ItemStatus::Cancelled => "cancelled",
            ItemStatus::Dropped => "dropped",
            ItemStatus::Archived => "archived",
            ItemStatus::Someday => "someday",
            ItemStatus::Rejected => "rejected",
        }
    }
}

impl Actor {
    pub fn as_str(self) -> &'static str {
        match self {
            Actor::User => "user",
            Actor::Oracle => "oracle",
            Actor::System => "system",
        }
    }
}
```

- [ ] **Step 6: Add typed errors and ports**

Create `src/application/error.rs`:

```rust
use thiserror::Error;

pub type TodoResult<T> = Result<T, TodoError>;

#[derive(Debug, Error, PartialEq)]
pub enum TodoError {
    #[error("{0}")]
    Policy(String),
    #[error("Item not found: {0}")]
    NotFound(String),
    #[error("{0}")]
    Validation(String),
    #[error("storage error: {0}")]
    Storage(String),
    #[error("migration error: {0}")]
    Migration(String),
    #[error("internal error: {0}")]
    Internal(String),
}
```

Create `src/application/ports.rs`:

```rust
use crate::application::error::TodoResult;
use crate::domain::{TodoEvent, TodoItem};
use time::OffsetDateTime;

pub trait Clock: Send + Sync {
    fn now(&self) -> OffsetDateTime;
}

pub trait IdGenerator: Send + Sync {
    fn new_id(&self, prefix: &str) -> String;
}

pub trait TodoRepository: Send {
    fn save_item(&mut self, item: &TodoItem) -> TodoResult<()>;
    fn get_item(&mut self, id: &str) -> TodoResult<Option<TodoItem>>;
    fn list_items(&mut self, filter: ListFilter) -> TodoResult<Vec<TodoItem>>;
}

pub trait EventRepository: Send {
    fn save_event(&mut self, event: &TodoEvent) -> TodoResult<()>;
}

#[derive(Clone, Debug, Default)]
pub struct ListFilter {
    pub status: Option<String>,
    pub item_type: Option<String>,
    pub area_id: Option<String>,
    pub project_id: Option<String>,
    pub routine_id: Option<String>,
    pub query: Option<String>,
    pub include_archived: bool,
}
```

- [ ] **Step 7: Run foundation tests**

Run: `cargo test --test application_policy oracle_task_starts_proposed user_task_starts_approved`

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add Cargo.toml src/lib.rs src/domain/mod.rs src/domain/model.rs src/application/mod.rs src/application/error.rs src/application/ports.rs tests/application_policy.rs
git commit -m "[feat] add Rust domain foundation"
```

## Task 2: SQLite Schema And Repository Baseline

**Files:**
- Create: `src/infrastructure/mod.rs`
- Create: `src/infrastructure/sqlite.rs`
- Create: `tests/sqlite_repository.rs`

- [ ] **Step 1: Write failing SQLite schema tests**

Create `tests/sqlite_repository.rs`:

```rust
use oracle_todo::infrastructure::sqlite::{connect, init_schema, user_version};

#[test]
fn init_schema_creates_items_and_events_tables() {
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();

    let tables: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();

    assert!(tables.contains(&"items".to_string()));
    assert!(tables.contains(&"events".to_string()));
    assert_eq!(user_version(&conn).unwrap(), 1);
}
```

- [ ] **Step 2: Run the failing test**

Run: `cargo test --test sqlite_repository init_schema_creates_items_and_events_tables`

Expected: FAIL because `infrastructure::sqlite` does not exist.

- [ ] **Step 3: Add infrastructure module and schema**

Create `src/infrastructure/mod.rs`:

```rust
pub mod sqlite;
```

Modify `src/lib.rs` in the same step:

```rust
pub mod application;
pub mod domain;
pub mod infrastructure;
```

Create `src/infrastructure/sqlite.rs`:

```rust
use crate::application::error::{TodoError, TodoResult};
use rusqlite::Connection;

pub fn connect(path: &str) -> TodoResult<Connection> {
    Connection::open(path).map_err(|error| TodoError::Storage(error.to_string()))
}

pub fn init_schema(conn: &Connection) -> TodoResult<()> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        PRAGMA user_version = 1;

        CREATE TABLE IF NOT EXISTS items (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL,
            area_id TEXT REFERENCES items(id),
            project_id TEXT REFERENCES items(id),
            routine_id TEXT REFERENCES items(id),
            parent_id TEXT REFERENCES items(id),
            description TEXT,
            outcome TEXT,
            definition_of_done TEXT,
            standard TEXT,
            review_cycle TEXT,
            recurrence_rule TEXT,
            materialization_policy TEXT NOT NULL DEFAULT 'single_open',
            occurrence_key TEXT,
            priority INTEGER,
            due TEXT,
            scheduled TEXT,
            horizon TEXT,
            proposed_by TEXT NOT NULL,
            approved_by TEXT,
            approved_at TEXT,
            completed_at TEXT,
            archived_at TEXT,
            last_materialized_at TEXT,
            second_brain_refs TEXT NOT NULL DEFAULT '[]',
            metadata TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_items_type ON items(type);
        CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
        CREATE INDEX IF NOT EXISTS idx_items_area_id ON items(area_id);
        CREATE INDEX IF NOT EXISTS idx_items_project_id ON items(project_id);
        CREATE INDEX IF NOT EXISTS idx_items_routine_id ON items(routine_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_items_routine_occurrence
            ON items(routine_id, occurrence_key)
            WHERE routine_id IS NOT NULL AND occurrence_key IS NOT NULL;

        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            at TEXT NOT NULL,
            actor TEXT NOT NULL,
            action TEXT NOT NULL,
            object_type TEXT NOT NULL,
            object_id TEXT NOT NULL,
            before TEXT,
            after TEXT,
            reason TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_events_at ON events(at);
        CREATE INDEX IF NOT EXISTS idx_events_object_id ON events(object_id);
        "#,
    )
    .map_err(|error| TodoError::Migration(error.to_string()))
}

pub fn user_version(conn: &Connection) -> TodoResult<i64> {
    conn.pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| TodoError::Storage(error.to_string()))
}
```

- [ ] **Step 4: Run schema test**

Run: `cargo test --test sqlite_repository init_schema_creates_items_and_events_tables`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/lib.rs src/infrastructure/mod.rs src/infrastructure/sqlite.rs tests/sqlite_repository.rs
git commit -m "[feat] add SQLite schema baseline"
```

## Task 3: Application Service Creation And Approval Policies

**Files:**
- Create: `src/application/service.rs`
- Modify: `src/application/ports.rs`
- Modify: `src/domain/model.rs`
- Modify: `tests/application_policy.rs`

- [ ] **Step 1: Add failing policy tests**

Append to `tests/application_policy.rs`:

```rust
use oracle_todo::application::error::TodoError;
use oracle_todo::application::service::{CreateArea, ProposeProject, TodoService};
use oracle_todo::domain::terminal_status;

#[test]
fn oracle_task_requires_approval_before_activation() {
    let mut service = TodoService::in_memory();
    let item = service.propose_task("앱 열고 DB 확인", Default::default()).unwrap();

    assert_eq!(item.status, ItemStatus::Proposed);

    let error = service.activate(&item.id, None).unwrap_err();
    assert_eq!(
        error,
        TodoError::Policy("Agent-created items must be approved before activation".to_string())
    );

    let approved = service.approve(&item.id, None).unwrap();
    let active = service.activate(&approved.id, None).unwrap();
    assert_eq!(active.status, ItemStatus::Active);
}

#[test]
fn area_creation_is_active_and_cannot_complete() {
    let mut service = TodoService::in_memory();
    let area = service
        .create_area(CreateArea {
            title: "재정".to_string(),
            review_cycle: Some("weekly".to_string()),
            standard: None,
        })
        .unwrap();

    assert_eq!(area.item_type, ItemType::Area);
    assert_eq!(area.status, ItemStatus::Active);
    assert!(!terminal_status(area.status));

    let error = service.complete(&area.id, None).unwrap_err();
    assert_eq!(
        error,
        TodoError::Policy("Areas cannot be completed; pause or archive them".to_string())
    );
}

#[test]
fn project_requires_definition_of_done_before_activation() {
    let mut service = TodoService::in_memory();
    let project = service
        .propose_project(ProposeProject {
            title: "가계부 자동화 안정화".to_string(),
            area: None,
            definition_of_done: None,
            outcome: None,
            due: None,
            actor: Actor::User,
        })
        .unwrap();

    let error = service.activate(&project.id, None).unwrap_err();
    assert_eq!(
        error,
        TodoError::Policy("Project requires definition_of_done before activation".to_string())
    );
}
```

- [ ] **Step 2: Run failing policy tests**

Run: `cargo test --test application_policy oracle_task_requires_approval_before_activation area_creation_is_active_and_cannot_complete project_requires_definition_of_done_before_activation`

Expected: FAIL because `TodoService`, request structs, and transitions do not exist.

- [ ] **Step 3: Implement in-memory service minimally**

Modify `src/application/mod.rs`:

```rust
pub mod error;
pub mod ports;
pub mod service;
```

Create `src/application/service.rs` with:

```rust
use crate::application::error::{TodoError, TodoResult};
use crate::domain::{terminal_status, Actor, ItemStatus, ItemType, TodoItem};
use std::collections::HashMap;

#[derive(Clone, Debug)]
pub struct CreateArea {
    pub title: String,
    pub review_cycle: Option<String>,
    pub standard: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct ProposeTask {
    pub title: String,
    pub area: Option<String>,
    pub project_id: Option<String>,
    pub routine_id: Option<String>,
    pub due: Option<String>,
    pub scheduled: Option<String>,
    pub priority: Option<i64>,
    pub description: Option<String>,
    pub actor: Option<Actor>,
}

#[derive(Clone, Debug)]
pub struct ProposeProject {
    pub title: String,
    pub area: Option<String>,
    pub definition_of_done: Option<String>,
    pub outcome: Option<String>,
    pub due: Option<String>,
    pub actor: Actor,
}

pub struct TodoService {
    items: HashMap<String, TodoItem>,
}

impl TodoService {
    pub fn in_memory() -> Self {
        Self { items: HashMap::new() }
    }

    pub fn create_area(&mut self, input: CreateArea) -> TodoResult<TodoItem> {
        let mut item = TodoItem::new(ItemType::Area, "area", input.title, Actor::User);
        item.status = ItemStatus::Active;
        item.review_cycle = input.review_cycle;
        item.standard = input.standard;
        self.items.insert(item.id.clone(), item.clone());
        Ok(item)
    }

    pub fn propose_task(&mut self, title: impl Into<String>, input: ProposeTask) -> TodoResult<TodoItem> {
        let actor = input.actor.unwrap_or(Actor::Oracle);
        let mut item = TodoItem::new_task(title, actor);
        item.due = input.due;
        item.scheduled = input.scheduled;
        item.priority = input.priority;
        item.description = input.description;
        item.area_id = input.area;
        item.project_id = input.project_id;
        item.routine_id = input.routine_id;
        self.items.insert(item.id.clone(), item.clone());
        Ok(item)
    }

    pub fn propose_project(&mut self, input: ProposeProject) -> TodoResult<TodoItem> {
        let mut item = TodoItem::new(ItemType::Project, "proj", input.title, input.actor);
        item.area_id = input.area;
        item.definition_of_done = input.definition_of_done;
        item.outcome = input.outcome;
        item.due = input.due;
        self.items.insert(item.id.clone(), item.clone());
        Ok(item)
    }

    pub fn get(&self, id: &str) -> TodoResult<TodoItem> {
        self.items
            .get(id)
            .cloned()
            .ok_or_else(|| TodoError::NotFound(id.to_string()))
    }

    pub fn approve(&mut self, id: &str, _reason: Option<String>) -> TodoResult<TodoItem> {
        let mut item = self.get(id)?;
        if !matches!(item.status, ItemStatus::Proposed | ItemStatus::Approved) {
            return Err(TodoError::Policy(format!("Cannot approve item in status {}", item.status.as_str())));
        }
        item.status = ItemStatus::Approved;
        item.approved_by = Some(Actor::User);
        item.approved_at = Some(time::OffsetDateTime::now_utc());
        self.items.insert(item.id.clone(), item.clone());
        Ok(item)
    }

    pub fn activate(&mut self, id: &str, _reason: Option<String>) -> TodoResult<TodoItem> {
        let mut item = self.get(id)?;
        if item.proposed_by != Actor::User && item.approved_at.is_none() {
            return Err(TodoError::Policy("Agent-created items must be approved before activation".to_string()));
        }
        if item.item_type == ItemType::Project && item.definition_of_done.is_none() {
            return Err(TodoError::Policy("Project requires definition_of_done before activation".to_string()));
        }
        if item.item_type == ItemType::Area {
            return Err(TodoError::Policy("Areas are ongoing and are active at creation; do not activate as work".to_string()));
        }
        if terminal_status(item.status) {
            return Err(TodoError::Policy(format!("Cannot activate terminal item: {}", item.status.as_str())));
        }
        item.status = ItemStatus::Active;
        self.items.insert(item.id.clone(), item.clone());
        Ok(item)
    }

    pub fn complete(&mut self, id: &str, _reason: Option<String>) -> TodoResult<TodoItem> {
        let mut item = self.get(id)?;
        if item.item_type == ItemType::Area {
            return Err(TodoError::Policy("Areas cannot be completed; pause or archive them".to_string()));
        }
        if terminal_status(item.status) {
            return Err(TodoError::Policy(format!("Already terminal: {}", item.status.as_str())));
        }
        item.status = ItemStatus::Completed;
        item.completed_at = Some(time::OffsetDateTime::now_utc());
        self.items.insert(item.id.clone(), item.clone());
        Ok(item)
    }
}
```

Use the `ItemStatus::as_str`, `ItemType::as_str`, and `Actor::as_str` helpers added in Task 1. Do not add duplicate string conversion functions in application or adapter code.

- [ ] **Step 4: Run policy tests**

Run: `cargo test --test application_policy`

Expected: PASS.

- [ ] **Step 5: Refactor only names and formatting**

Run: `cargo fmt`

Run: `cargo test --test application_policy`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/application/service.rs src/domain/model.rs tests/application_policy.rs
git commit -m "[feat] enforce core item policies"
```

## Task 4: Persistent Service, Audit Events, And State Transitions

**Files:**
- Modify: `src/application/service.rs`
- Modify: `src/application/ports.rs`
- Modify: `src/infrastructure/sqlite.rs`
- Modify: `tests/application_policy.rs`
- Modify: `tests/sqlite_repository.rs`

- [ ] **Step 1: Add failing event and transition tests**

Append to `tests/sqlite_repository.rs`:

```rust
use oracle_todo::application::ports::{EventRepository, ListFilter, TodoRepository};
use oracle_todo::domain::{Actor, ItemStatus, TodoEvent, TodoItem};
use oracle_todo::infrastructure::sqlite::SqliteTodoRepository;
use time::OffsetDateTime;

#[test]
fn saving_item_and_event_persists_to_sqlite() {
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut repo = SqliteTodoRepository::new(conn);
    let item = TodoItem::new_task("테스트", Actor::Oracle);

    repo.save_item(&item).unwrap();
    let fetched = repo.get_item(&item.id).unwrap().unwrap();

    assert_eq!(fetched.title, "테스트");
    assert_eq!(fetched.status, ItemStatus::Proposed);
    assert_eq!(repo.list_items(ListFilter::default()).unwrap().len(), 1);

    let event = TodoEvent {
        id: "evt_test".to_string(),
        at: OffsetDateTime::now_utc(),
        actor: Actor::Oracle,
        action: "propose_task".to_string(),
        object_type: "task".to_string(),
        object_id: item.id.clone(),
        before: None,
        after: Some(serde_json::to_value(&item).unwrap()),
        reason: None,
    };
    repo.save_event(&event).unwrap();
    assert_eq!(repo.list_events_for_item(&item.id).unwrap().len(), 1);
}

#[test]
fn repository_reads_python_sqlalchemy_datetime_format() {
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    conn.execute(
        "INSERT INTO items (id, type, title, status, proposed_by, second_brain_refs, metadata, created_at, updated_at)
         VALUES ('task_py', 'task', '파이썬 row', 'proposed', 'oracle', '[]', '{}', '2026-05-31 14:47:48.837726', '2026-05-31 14:47:48.837726')",
        [],
    )
    .unwrap();
    let mut repo = SqliteTodoRepository::new(conn);

    let item = repo.get_item("task_py").unwrap().unwrap();

    assert_eq!(item.title, "파이썬 row");
}
```

Append to `tests/application_policy.rs`:

```rust
#[test]
fn completing_terminal_item_is_rejected() {
    let mut service = TodoService::in_memory();
    let item = service.propose_task("완료", ProposeTask { actor: Some(Actor::User), ..Default::default() }).unwrap();

    service.complete(&item.id, None).unwrap();
    let error = service.complete(&item.id, None).unwrap_err();

    assert_eq!(error, TodoError::Policy("Already terminal: completed".to_string()));
}
```

- [ ] **Step 2: Run failing tests**

Run: `cargo test --test sqlite_repository saving_item_and_event_persists_to_sqlite`

Expected: FAIL because `SqliteTodoRepository` is not implemented.

Run: `cargo test --test application_policy completing_terminal_item_is_rejected`

Expected: FAIL if `ProposeTask` is not in scope or transition is incomplete.

- [ ] **Step 3: Implement SQLite repository mapping**

Add to `src/infrastructure/sqlite.rs`:

```rust
use crate::application::ports::{EventRepository, ListFilter, TodoRepository};
use crate::domain::{Actor, ItemStatus, ItemType, TodoEvent, TodoItem};
use rusqlite::{params, OptionalExtension};
use serde_json::{Map, Value};
use time::OffsetDateTime;

pub struct SqliteTodoRepository {
    conn: Connection,
}

impl SqliteTodoRepository {
    pub fn new(conn: Connection) -> Self {
        Self { conn }
    }

    pub fn list_events_for_item(&mut self, item_id: &str) -> TodoResult<Vec<TodoEvent>> {
        let mut stmt = self
            .conn
            .prepare("SELECT * FROM events WHERE object_id = ?1 ORDER BY at")
            .map_err(|error| TodoError::Storage(error.to_string()))?;
        stmt.query_map([item_id], row_to_event)
            .map_err(|error| TodoError::Storage(error.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| TodoError::Storage(error.to_string()))
    }
}

impl TodoRepository for SqliteTodoRepository {
    fn save_item(&mut self, item: &TodoItem) -> TodoResult<()> {
        self.conn
            .execute(
                r#"
                INSERT INTO items (
                    id, type, title, status, area_id, project_id, routine_id, parent_id,
                    description, outcome, definition_of_done, standard, review_cycle,
                    recurrence_rule, materialization_policy, occurrence_key, priority,
                    due, scheduled, horizon, proposed_by, approved_by, approved_at,
                    completed_at, archived_at, last_materialized_at, second_brain_refs,
                    metadata, created_at, updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                    ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25,
                    ?26, ?27, ?28, ?29, ?30)
                ON CONFLICT(id) DO UPDATE SET
                    type=excluded.type,
                    title=excluded.title,
                    status=excluded.status,
                    area_id=excluded.area_id,
                    project_id=excluded.project_id,
                    routine_id=excluded.routine_id,
                    parent_id=excluded.parent_id,
                    description=excluded.description,
                    outcome=excluded.outcome,
                    definition_of_done=excluded.definition_of_done,
                    standard=excluded.standard,
                    review_cycle=excluded.review_cycle,
                    recurrence_rule=excluded.recurrence_rule,
                    materialization_policy=excluded.materialization_policy,
                    occurrence_key=excluded.occurrence_key,
                    priority=excluded.priority,
                    due=excluded.due,
                    scheduled=excluded.scheduled,
                    horizon=excluded.horizon,
                    proposed_by=excluded.proposed_by,
                    approved_by=excluded.approved_by,
                    approved_at=excluded.approved_at,
                    completed_at=excluded.completed_at,
                    archived_at=excluded.archived_at,
                    last_materialized_at=excluded.last_materialized_at,
                    second_brain_refs=excluded.second_brain_refs,
                    metadata=excluded.metadata,
                    updated_at=excluded.updated_at
                "#,
                params![
                    &item.id,
                    item.item_type.as_str(),
                    &item.title,
                    item.status.as_str(),
                    item.area_id.as_deref(),
                    item.project_id.as_deref(),
                    item.routine_id.as_deref(),
                    item.parent_id.as_deref(),
                    item.description.as_deref(),
                    item.outcome.as_deref(),
                    item.definition_of_done.as_deref(),
                    item.standard.as_deref(),
                    item.review_cycle.as_deref(),
                    item.recurrence_rule.as_deref(),
                    &item.materialization_policy,
                    item.occurrence_key.as_deref(),
                    item.priority,
                    item.due.as_deref(),
                    item.scheduled.as_deref(),
                    item.horizon.as_deref(),
                    item.proposed_by.as_str(),
                    item.approved_by.map(Actor::as_str),
                    item.approved_at.map(format_time),
                    item.completed_at.map(format_time),
                    item.archived_at.map(format_time),
                    item.last_materialized_at.map(format_time),
                    serde_json::to_string(&item.second_brain_refs).unwrap(),
                    serde_json::to_string(&item.metadata).unwrap(),
                    format_time(item.created_at),
                    format_time(item.updated_at),
                ],
            )
            .map_err(|error| TodoError::Storage(error.to_string()))?;
        Ok(())
    }

    fn get_item(&mut self, id: &str) -> TodoResult<Option<TodoItem>> {
        self.conn
            .query_row("SELECT * FROM items WHERE id = ?1", [id], row_to_item)
            .optional()
            .map_err(|error| TodoError::Storage(error.to_string()))
    }

    fn list_items(&mut self, _filter: ListFilter) -> TodoResult<Vec<TodoItem>> {
        let mut stmt = self
            .conn
            .prepare("SELECT * FROM items ORDER BY created_at DESC")
            .map_err(|error| TodoError::Storage(error.to_string()))?;
        let items = stmt
            .query_map([], row_to_item)
            .map_err(|error| TodoError::Storage(error.to_string()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| TodoError::Storage(error.to_string()))?;
        Ok(items)
    }
}

impl EventRepository for SqliteTodoRepository {
    fn save_event(&mut self, event: &TodoEvent) -> TodoResult<()> {
        self.conn
            .execute(
                "INSERT INTO events (id, at, actor, action, object_type, object_id, before, after, reason)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    &event.id,
                    format_time(event.at),
                    event.actor.as_str(),
                    &event.action,
                    &event.object_type,
                    &event.object_id,
                    event.before.as_ref().map(|value| value.to_string()),
                    event.after.as_ref().map(|value| value.to_string()),
                    event.reason.as_deref(),
                ],
            )
            .map_err(|error| TodoError::Storage(error.to_string()))?;
        Ok(())
    }
}

fn format_time(value: OffsetDateTime) -> String {
    value
        .format(&time::format_description::well_known::Rfc3339)
        .expect("RFC3339 formatting must succeed")
}
```

Use the domain `as_str` helpers for string conversions. Do not add duplicate string conversion functions in SQLite, exports, CLI, or API code. Add the inverse parser for SQLite rows:

```rust
fn parse_item_type(value: &str) -> rusqlite::Result<ItemType> {
    match value {
        "area" => Ok(ItemType::Area),
        "project" => Ok(ItemType::Project),
        "routine" => Ok(ItemType::Routine),
        "task" => Ok(ItemType::Task),
        "event" => Ok(ItemType::Event),
        "review" => Ok(ItemType::Review),
        "archive_item" => Ok(ItemType::ArchiveItem),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}
```

Add `row_to_item` with direct column names:

```rust
fn row_to_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<TodoItem> {
    let second_brain_refs: String = row.get("second_brain_refs")?;
    let metadata: String = row.get("metadata")?;
    Ok(TodoItem {
        id: row.get("id")?,
        item_type: parse_item_type(&row.get::<_, String>("type")?)?,
        title: row.get("title")?,
        status: parse_status(&row.get::<_, String>("status")?)?,
        area_id: row.get("area_id")?,
        project_id: row.get("project_id")?,
        routine_id: row.get("routine_id")?,
        parent_id: row.get("parent_id")?,
        description: row.get("description")?,
        outcome: row.get("outcome")?,
        definition_of_done: row.get("definition_of_done")?,
        standard: row.get("standard")?,
        review_cycle: row.get("review_cycle")?,
        recurrence_rule: row.get("recurrence_rule")?,
        materialization_policy: row.get("materialization_policy")?,
        occurrence_key: row.get("occurrence_key")?,
        priority: row.get("priority")?,
        due: row.get("due")?,
        scheduled: row.get("scheduled")?,
        horizon: row.get("horizon")?,
        proposed_by: parse_actor(&row.get::<_, String>("proposed_by")?)?,
        approved_by: parse_optional_actor(row.get("approved_by")?)?,
        approved_at: parse_optional_time(row.get("approved_at")?)?,
        completed_at: parse_optional_time(row.get("completed_at")?)?,
        archived_at: parse_optional_time(row.get("archived_at")?)?,
        last_materialized_at: parse_optional_time(row.get("last_materialized_at")?)?,
        second_brain_refs: serde_json::from_str(&second_brain_refs).map_err(|_| rusqlite::Error::InvalidQuery)?,
        metadata: serde_json::from_str(&metadata).map_err(|_| rusqlite::Error::InvalidQuery)?,
        created_at: parse_time(&row.get::<_, String>("created_at")?)?,
        updated_at: parse_time(&row.get::<_, String>("updated_at")?)?,
    })
}

fn row_to_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<TodoEvent> {
    let before: Option<String> = row.get("before")?;
    let after: Option<String> = row.get("after")?;
    Ok(TodoEvent {
        id: row.get("id")?,
        at: parse_time(&row.get::<_, String>("at")?)?,
        actor: parse_actor(&row.get::<_, String>("actor")?)?,
        action: row.get("action")?,
        object_type: row.get("object_type")?,
        object_id: row.get("object_id")?,
        before: before.map(|value| serde_json::from_str(&value).map_err(|_| rusqlite::Error::InvalidQuery)).transpose()?,
        after: after.map(|value| serde_json::from_str(&value).map_err(|_| rusqlite::Error::InvalidQuery)).transpose()?,
        reason: row.get("reason")?,
    })
}
```

Add parser helpers in the same file:

```rust
fn parse_status(value: &str) -> rusqlite::Result<ItemStatus> {
    match value {
        "proposed" => Ok(ItemStatus::Proposed),
        "approved" => Ok(ItemStatus::Approved),
        "active" => Ok(ItemStatus::Active),
        "waiting" => Ok(ItemStatus::Waiting),
        "paused" => Ok(ItemStatus::Paused),
        "completed" => Ok(ItemStatus::Completed),
        "cancelled" => Ok(ItemStatus::Cancelled),
        "dropped" => Ok(ItemStatus::Dropped),
        "archived" => Ok(ItemStatus::Archived),
        "someday" => Ok(ItemStatus::Someday),
        "rejected" => Ok(ItemStatus::Rejected),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn parse_actor(value: &str) -> rusqlite::Result<Actor> {
    match value {
        "user" => Ok(Actor::User),
        "oracle" => Ok(Actor::Oracle),
        "system" => Ok(Actor::System),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn parse_optional_actor(value: Option<String>) -> rusqlite::Result<Option<Actor>> {
    value.as_deref().map(parse_actor).transpose()
}

fn parse_time(value: &str) -> rusqlite::Result<OffsetDateTime> {
    if let Ok(parsed) = OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339) {
        return Ok(parsed);
    }
    let python_sqlalchemy = time::macros::format_description!(
        "[year]-[month]-[day] [hour]:[minute]:[second].[subsecond]"
    );
    time::PrimitiveDateTime::parse(value, python_sqlalchemy)
        .map(|value| value.assume_utc())
        .map_err(|_| rusqlite::Error::InvalidQuery)
}

fn parse_optional_time(value: Option<String>) -> rusqlite::Result<Option<OffsetDateTime>> {
    value.as_deref().map(parse_time).transpose()
}
```

Do not add query filters in this step.

- [ ] **Step 4: Run persistence tests**

Run: `cargo test --test sqlite_repository`

Expected: PASS.

- [ ] **Step 5: Add audit events to service**

Refactor `TodoService` so persistence and audit recording happen inside the service boundary before any CLI/API adapter is implemented:

```rust
pub enum ServiceStore {
    InMemory {
        items: std::collections::HashMap<String, TodoItem>,
        events: Vec<TodoEvent>,
    },
    Sqlite {
        repo: SqliteTodoRepository,
    },
}

pub struct TodoService {
    store: ServiceStore,
}
```

`TodoService::in_memory()` keeps fast application tests. `TodoService::sqlite(db_path)` opens SQLite, runs `init_schema`, and stores items/events through `TodoRepository` and `EventRepository`. Adapters must call service methods only; they must not call `repo.save_item` or `repo.save_event` directly.

Extend `TodoService` so each mutation records an event with action names matching Python: `create_area`, `propose_task`, `propose_project`, `approve`, `activate`, `complete`.

Add to `tests/application_policy.rs`:

```rust
#[test]
fn every_mutation_records_event() {
    let mut service = TodoService::in_memory();
    let item = service.propose_task("테스트", Default::default()).unwrap();
    service.approve(&item.id, None).unwrap();

    let actions: Vec<String> = service.events().iter().map(|event| event.action.clone()).collect();

    assert_eq!(actions, vec!["propose_task".to_string(), "approve".to_string()]);
}
```

- [ ] **Step 6: Run audit tests**

Run: `cargo test --test application_policy every_mutation_records_event`

Expected: PASS after adding event recording.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/application/service.rs src/application/ports.rs src/infrastructure/sqlite.rs tests/application_policy.rs tests/sqlite_repository.rs
git commit -m "[feat] persist items and audit transitions"
```

## Task 5: Listing, Update, Archive View, And Markdown Exports

**Files:**
- Modify: `src/application/service.rs`
- Modify: `src/application/ports.rs`
- Modify: `src/infrastructure/sqlite.rs`
- Create: `src/exports.rs`
- Create: `tests/export_parity.rs`
- Modify: `tests/application_policy.rs`

- [ ] **Step 1: Add failing list/update/archive/export tests**

Create `tests/export_parity.rs`:

```rust
use oracle_todo::application::service::{ProposeEvent, ProposeTask, TodoService};
use oracle_todo::domain::Actor;
use oracle_todo::exports::{render_items, today_tasks, write_exports};

#[test]
fn today_export_includes_today_tasks_and_excludes_future_tasks() {
    let mut service = TodoService::in_memory();
    let today = service
        .propose_task("혼자 할 일", ProposeTask {
            actor: Some(Actor::User),
            scheduled: Some("today".to_string()),
            ..Default::default()
        })
        .unwrap();
    service
        .propose_task("다음 주 할 일", ProposeTask {
            actor: Some(Actor::User),
            scheduled: Some("2026-06-05".to_string()),
            ..Default::default()
        })
        .unwrap();

    let items = today_tasks(&service.list_items(Default::default()).unwrap(), "2026-05-26").unwrap();
    let markdown = render_items("Today", &items);

    assert_eq!(items, vec![today]);
    assert!(markdown.contains("- [ ] **혼자 할 일** `task approved scheduled:today`"));
    assert!(!markdown.contains("다음 주 할 일"));
}

#[test]
fn event_propose_distinguishes_external_commitments() {
    let mut service = TodoService::in_memory();

    let event = service
        .propose_event(ProposeEvent {
            title: "병원 예약".to_string(),
            actor: Actor::Oracle,
            scheduled: Some("2026-06-01 15:00".to_string()),
            area: None,
            project_id: None,
            due: None,
            priority: None,
            description: Some("진료 예약".to_string()),
            location: Some("서울대병원".to_string()),
            participants: vec!["서울대병원".to_string()],
            commitment_type: "appointment".to_string(),
        })
        .unwrap();

    assert_eq!(event.item_type.as_str(), "event");
    assert_eq!(event.metadata["location"], "서울대병원");
    assert_eq!(event.metadata["participants"][0], "서울대병원");
}

#[test]
fn write_exports_creates_expected_view_files() {
    let tmp = tempfile::tempdir().unwrap();
    let mut service = TodoService::in_memory();
    service.propose_task("오늘 할 일", ProposeTask { actor: Some(Actor::User), scheduled: Some("today".to_string()), ..Default::default() }).unwrap();

    let paths = write_exports(&service.list_items(Default::default()).unwrap(), tmp.path(), "2026-05-26").unwrap();

    assert!(paths.iter().any(|path| path.ends_with("today.md")));
    assert!(tmp.path().join("today.md").exists());
}
```

Append to `tests/application_policy.rs`:

```rust
#[test]
fn update_item_changes_core_fields_and_records_event() {
    let mut service = TodoService::in_memory();
    let item = service.propose_task("옛 제목", Default::default()).unwrap();

    let updated = service
        .update_item(&item.id, oracle_todo::application::service::UpdateItem {
            title: Some("새 제목".to_string()),
            description: Some("설명".to_string()),
            due: Some("2026-05-31".to_string()),
            scheduled: Some("today".to_string()),
            priority: Some(3),
            reason: Some("정리".to_string()),
            ..Default::default()
        })
        .unwrap();

    assert_eq!(updated.title, "새 제목");
    assert_eq!(updated.description.as_deref(), Some("설명"));
    assert_eq!(updated.due.as_deref(), Some("2026-05-31"));
    assert_eq!(updated.scheduled.as_deref(), Some("today"));
    assert_eq!(updated.priority, Some(3));
    assert_eq!(service.events().last().unwrap().action, "update_item");
}
```

- [ ] **Step 2: Run failing tests**

Run: `cargo test --test export_parity today_export_includes_today_tasks_and_excludes_future_tasks`

Expected: FAIL because `exports` does not exist.

Run: `cargo test --test application_policy update_item_changes_core_fields_and_records_event`

Expected: FAIL because `UpdateItem` and `update_item` do not exist.

- [ ] **Step 3: Implement update and list filters**

Add `UpdateItem` to `src/application/service.rs`:

```rust
#[derive(Clone, Debug, Default)]
pub struct UpdateItem {
    pub title: Option<String>,
    pub description: Option<String>,
    pub outcome: Option<String>,
    pub definition_of_done: Option<String>,
    pub standard: Option<String>,
    pub review_cycle: Option<String>,
    pub recurrence_rule: Option<String>,
    pub materialization_policy: Option<String>,
    pub area: Option<String>,
    pub project_id: Option<String>,
    pub routine_id: Option<String>,
    pub due: Option<String>,
    pub scheduled: Option<String>,
    pub priority: Option<i64>,
    pub reason: Option<String>,
}
```

Add `ProposeEvent` and implement `propose_event` with the Python policy messages exactly. Events require `scheduled`, use item type `event`, and store `commitment_type`, `schedule_kind`, `location`, and `participants` in metadata.

Implement `update_item`, `list_items`, `archive_items`, `drop`, `cancel`, and `archive` in `TodoService` with the Python policy messages exactly:

```rust
if terminal_status(item.status) {
    return Err(TodoError::Policy(format!("Cannot update terminal item: {}", item.status.as_str())));
}
if matches!(input.materialization_policy.as_deref(), Some(value) if value != "single_open" && value != "per_occurrence") {
    return Err(TodoError::Policy(format!("Unsupported materialization_policy: {}", input.materialization_policy.unwrap())));
}
```

- [ ] **Step 4: Implement exports**

Modify `src/lib.rs`:

```rust
pub mod application;
pub mod domain;
pub mod exports;
pub mod infrastructure;
```

Create `src/exports.rs`:

```rust
use crate::application::error::{TodoError, TodoResult};
use crate::domain::{ItemStatus, ItemType, TodoItem};
use time::{Date, Month};

pub fn render_items(title: &str, items: &[TodoItem]) -> String {
    let mut lines = vec![format!("# {}", title), String::new()];
    if items.is_empty() {
        lines.push("_없음_".to_string());
        return format!("{}\n", lines.join("\n"));
    }
    for item in items {
        let check = if item.status == ItemStatus::Completed { "x" } else { " " };
        let mut meta = vec![item.item_type.as_str().to_string(), item.status.as_str().to_string()];
        if let Some(due) = &item.due {
            meta.push(format!("due:{due}"));
        }
        if let Some(scheduled) = &item.scheduled {
            meta.push(format!("scheduled:{scheduled}"));
        }
        if let Some(area_id) = &item.area_id {
            meta.push(format!("area:{area_id}"));
        }
        lines.push(format!("- [{check}] **{}** `{}`", item.title, meta.join(" ")));
        if let Some(description) = &item.description {
            lines.push(format!("  - {description}"));
        }
    }
    format!("{}\n", lines.join("\n"))
}

pub fn today_tasks(items: &[TodoItem], today: &str) -> TodoResult<Vec<TodoItem>> {
    let today = parse_date(today)?;
    let mut out = Vec::new();
    for item in items {
        if item.item_type != ItemType::Task {
            continue;
        }
        if !matches!(item.status, ItemStatus::Proposed | ItemStatus::Approved | ItemStatus::Active) {
            continue;
        }
        match item.scheduled.as_deref() {
            None | Some("today") => out.push(item.clone()),
            Some(value) => {
                if let Some(prefix) = value.get(..10) {
                    if let Ok(scheduled_day) = parse_date(prefix) {
                        if scheduled_day <= today {
                            out.push(item.clone());
                        }
                    }
                }
            }
        }
    }
    Ok(out)
}

pub fn write_exports(items: &[TodoItem], out_dir: &std::path::Path, today: &str) -> TodoResult<Vec<std::path::PathBuf>> {
    std::fs::create_dir_all(out_dir).map_err(|error| TodoError::Storage(error.to_string()))?;
    let today_items = today_tasks(items, today)?;
    let views = [
        ("today.md", render_items("Today", &today_items)),
        ("events.md", render_items("Events", &items.iter().filter(|item| item.item_type == ItemType::Event).cloned().collect::<Vec<_>>())),
        ("projects.md", render_items("Projects", &items.iter().filter(|item| item.item_type == ItemType::Project).cloned().collect::<Vec<_>>())),
        ("areas.md", render_items("Areas", &items.iter().filter(|item| item.item_type == ItemType::Area).cloned().collect::<Vec<_>>())),
        ("routines.md", render_items("Routines", &items.iter().filter(|item| item.item_type == ItemType::Routine).cloned().collect::<Vec<_>>())),
        ("proposed.md", render_items("Proposed", &items.iter().filter(|item| item.status == ItemStatus::Proposed).cloned().collect::<Vec<_>>())),
        ("archive.md", render_items("Archive", &items.iter().filter(|item| matches!(item.status, ItemStatus::Archived | ItemStatus::Completed | ItemStatus::Dropped | ItemStatus::Cancelled | ItemStatus::Someday)).cloned().collect::<Vec<_>>())),
    ];
    let mut paths = Vec::new();
    for (name, body) in views {
        let path = out_dir.join(name);
        std::fs::write(&path, body).map_err(|error| TodoError::Storage(error.to_string()))?;
        paths.push(path);
    }
    Ok(paths)
}

fn parse_date(value: &str) -> TodoResult<Date> {
    let parts: Vec<i32> = value
        .split('-')
        .map(|part| part.parse::<i32>())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| TodoError::Validation(error.to_string()))?;
    if parts.len() != 3 {
        return Err(TodoError::Validation(format!("invalid date: {value}")));
    }
    let month = Month::try_from(parts[1] as u8).map_err(|error| TodoError::Validation(error.to_string()))?;
    Date::from_calendar_date(parts[0], month, parts[2] as u8)
        .map_err(|error| TodoError::Validation(error.to_string()))
}
```

The `today_tasks` implementation must ignore invalid or short `scheduled` strings instead of panicking. Remove any duplicate `item_type_str` helper and use `ItemType::as_str`.

- [ ] **Step 5: Run update/export tests**

Run: `cargo test --test application_policy update_item_changes_core_fields_and_records_event`

Expected: PASS.

Run: `cargo test --test export_parity`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/application/service.rs src/application/ports.rs src/infrastructure/sqlite.rs src/exports.rs tests/application_policy.rs tests/export_parity.rs
git commit -m "[feat] add item views and markdown exports"
```

## Task 6: Recurrence Parser And Routine Materialization

**Files:**
- Create: `src/domain/recurrence.rs`
- Modify: `src/application/service.rs`
- Modify: `src/domain/model.rs`
- Create: `tests/routine_materialization.rs`

- [ ] **Step 1: Add failing recurrence tests**

Create `tests/routine_materialization.rs`:

```rust
use oracle_todo::application::service::{ProposeRoutine, TodoService};
use oracle_todo::domain::{Actor, ItemStatus};

#[test]
fn per_occurrence_materialization_creates_bounded_unique_tasks() {
    let mut service = TodoService::in_memory();
    let routine = service
        .propose_routine(ProposeRoutine {
            title: "혈압 기록".to_string(),
            actor: Actor::User,
            recurrence_rule: Some("daily".to_string()),
            materialization_policy: "per_occurrence".to_string(),
            area: None,
        })
        .unwrap();
    service.activate(&routine.id, None).unwrap();

    let created = service.materialize_routines("2026-05-26", 2, 1).unwrap();
    let repeated = service.materialize_routines("2026-05-26", 2, 1).unwrap();

    assert!(repeated.is_empty());
    assert_eq!(
        created.iter().map(|task| task.occurrence_key.clone().unwrap()).collect::<Vec<_>>(),
        vec!["2026-05-25", "2026-05-26", "2026-05-27", "2026-05-28"]
    );
    assert!(created.iter().all(|task| task.status == ItemStatus::Approved));
}

#[test]
fn weekday_sets_and_ranges_match_python_behavior() {
    let mut service = TodoService::in_memory();
    let routine = service
        .propose_routine(ProposeRoutine {
            title: "월수금".to_string(),
            actor: Actor::User,
            recurrence_rule: Some("월수금".to_string()),
            materialization_policy: "per_occurrence".to_string(),
            area: None,
        })
        .unwrap();
    service.activate(&routine.id, None).unwrap();

    let created = service.materialize_routines("2026-05-26", 7, 0).unwrap();

    assert_eq!(
        created.iter().map(|task| task.occurrence_key.clone().unwrap()).collect::<Vec<_>>(),
        vec!["2026-05-27", "2026-05-29", "2026-06-01"]
    );
}

#[test]
fn recurrence_matrix_matches_existing_python_cases() {
    let cases = [
        ("every week on Monday", "2026-05-26", 7, 1, vec!["2026-05-25", "2026-06-01"]),
        ("weekdays", "2026-05-26", 7, 0, vec!["2026-05-26", "2026-05-27", "2026-05-28", "2026-05-29", "2026-06-01", "2026-06-02"]),
        ("weekends", "2026-05-26", 7, 0, vec!["2026-05-30", "2026-05-31"]),
        ("월-일", "2026-05-26", 7, 0, vec!["2026-05-26", "2026-05-27", "2026-05-28", "2026-05-29", "2026-05-30", "2026-05-31", "2026-06-01", "2026-06-02"]),
        ("Mon, Wed, Fri", "2026-05-26", 7, 0, vec!["2026-05-27", "2026-05-29", "2026-06-01"]),
        ("every month on the 6th", "2026-05-26", 40, 0, vec!["2026-06-06"]),
        ("every month on the last", "2026-05-26", 40, 0, vec!["2026-05-31", "2026-06-30"]),
        ("every 2 days", "2026-05-26", 6, 0, vec!["2026-05-26", "2026-05-28", "2026-05-30", "2026-06-01"]),
        ("every 5 weeks on Friday", "2026-05-26", 40, 0, vec!["2026-05-29", "2026-07-03"]),
        ("every year", "2026-12-30", 5, 0, vec!["2027-01-01"]),
    ];

    for (rule, now, lookahead_days, catchup_days, expected) in cases {
        let mut service = TodoService::in_memory();
        let routine = service
            .propose_routine(ProposeRoutine {
                title: rule.to_string(),
                actor: Actor::User,
                recurrence_rule: Some(rule.to_string()),
                materialization_policy: "per_occurrence".to_string(),
                area: None,
            })
            .unwrap();
        service.activate(&routine.id, None).unwrap();

        let created = service.materialize_routines(now, lookahead_days, catchup_days).unwrap();

        assert_eq!(
            created.iter().map(|task| task.occurrence_key.clone().unwrap()).collect::<Vec<_>>(),
            expected
        );
    }
}
```

- [ ] **Step 2: Run failing routine tests**

Run: `cargo test --test routine_materialization`

Expected: FAIL because `ProposeRoutine`, recurrence parsing, and materialization do not exist.

- [ ] **Step 3: Implement recurrence parser**

Modify `src/domain/mod.rs`:

```rust
mod model;
pub mod recurrence;

pub use model::{Actor, ItemStatus, ItemType, TodoEvent, TodoItem, terminal_status};
```

Create `src/domain/recurrence.rs` with these public functions:

```rust
use crate::application::error::{TodoError, TodoResult};
use time::{Date, Duration, Month, Weekday};

pub fn occurrences(rule: &str, start: Date, end: Date) -> TodoResult<Vec<Date>> {
    let normalized = normalize_alias(rule);
    if let Some(weekdays) = parse_weekday_set(&normalized) {
        if weekdays == vec![0, 1, 2, 3, 4, 5, 6] {
            return interval_occurrences(start, end, Duration::days(1));
        }
        return weekday_set_occurrences(start, end, &weekdays, 1);
    }
    parse_every_rule(&normalized, start, end, rule)
}

fn normalize_alias(rule: &str) -> String {
    match rule.trim().to_lowercase().as_str() {
        "daily" | "매일" => "every day".to_string(),
        "weekly" | "매주" => "every week".to_string(),
        "monthly" | "매월" => "every month".to_string(),
        "yearly" | "매년" => "every year".to_string(),
        value => value.to_string(),
    }
}
```

Add these recurrence helper functions in `src/domain/recurrence.rs`:

```rust
fn interval_occurrences(start: Date, end: Date, step: Duration) -> TodoResult<Vec<Date>> {
    let mut current = start;
    let mut out = Vec::new();
    while current <= end {
        out.push(current);
        current = current + step;
    }
    Ok(out)
}

fn weekday_index(value: &str) -> Option<u8> {
    match value {
        "mon" | "monday" | "월" => Some(0),
        "tue" | "tuesday" | "화" => Some(1),
        "wed" | "wednesday" | "수" => Some(2),
        "thu" | "thursday" | "목" => Some(3),
        "fri" | "friday" | "금" => Some(4),
        "sat" | "saturday" | "토" => Some(5),
        "sun" | "sunday" | "일" => Some(6),
        _ => None,
    }
}

fn weekday_set_alias(value: &str) -> Option<Vec<u8>> {
    match value {
        "weekday" | "weekdays" | "평일" | "월-금" => Some(vec![0, 1, 2, 3, 4]),
        "weekend" | "weekends" | "주말" | "토-일" => Some(vec![5, 6]),
        "월-일" => Some(vec![0, 1, 2, 3, 4, 5, 6]),
        _ => None,
    }
}
```

Then implement `parse_weekday_set`, `weekday_set_occurrences`, `monthly_occurrences`, `add_months`, `yearly_occurrences`, and `parse_every_rule` in the same file. Use `TodoError::Policy(format!("Unsupported recurrence_rule: {original_rule}"))` for unsupported input, matching Python behavior.

- [ ] **Step 4: Implement routine service methods**

Add `ProposeRoutine` and `materialize_routines` to `src/application/service.rs`:

```rust
#[derive(Clone, Debug)]
pub struct ProposeRoutine {
    pub title: String,
    pub area: Option<String>,
    pub actor: Actor,
    pub recurrence_rule: Option<String>,
    pub materialization_policy: String,
}
```

Rules:

- Reject materialization policies other than `single_open` and `per_occurrence` with `Unsupported materialization_policy: <value>`.
- Reject activation of a routine without `recurrence_rule` with `Routine requires recurrence_rule before activation`.
- `single_open` checks for any non-terminal generated task with the same `routine_id`.
- `per_occurrence` checks the `(routine_id, occurrence_key)` pair before creating.
- Generated tasks use actor `System`, status `Approved`, `metadata.generated_by = "routine"`, `approved_by = User`.

- [ ] **Step 5: Add cascade tests**

Append to `tests/routine_materialization.rs`:

```rust
#[test]
fn pausing_and_resuming_routine_cascades_generated_task_state() {
    let mut service = TodoService::in_memory();
    let routine = service
        .propose_routine(ProposeRoutine {
            title: "매일 스트레칭".to_string(),
            actor: Actor::User,
            recurrence_rule: Some("daily".to_string()),
            materialization_policy: "single_open".to_string(),
            area: None,
        })
        .unwrap();
    service.activate(&routine.id, None).unwrap();
    let task = service.materialize_routines("2026-05-26", 0, 0).unwrap().remove(0);

    service.pause(&routine.id, Some("잠시 중지".to_string())).unwrap();
    assert_eq!(service.get(&task.id).unwrap().status, ItemStatus::Waiting);

    service.resume(&routine.id, Some("다시 시작".to_string())).unwrap();
    assert_eq!(service.get(&task.id).unwrap().status, ItemStatus::Approved);
}
```

- [ ] **Step 6: Run all routine tests**

Run: `cargo test --test routine_materialization`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/domain/recurrence.rs src/application/service.rs src/domain/model.rs tests/routine_materialization.rs
git commit -m "[feat] materialize recurring routines"
```

## Task 7: CLI Parity

**Files:**
- Create: `src/interfaces/mod.rs`
- Create: `src/interfaces/cli.rs`
- Create: `src/infrastructure/paths.rs`
- Modify: `src/infrastructure/mod.rs`
- Modify: `src/main.rs`
- Create: `tests/support/mod.rs`
- Create: `tests/cli_parity.rs`

- [ ] **Step 1: Add failing CLI tests**

Create `tests/support/mod.rs`:

```rust
use tempfile::TempDir;

pub struct TestHome {
    pub dir: TempDir,
}

impl TestHome {
    pub fn new() -> Self {
        Self { dir: tempfile::tempdir().unwrap() }
    }

    pub fn path(&self) -> &std::path::Path {
        self.dir.path()
    }
}
```

Create `tests/cli_parity.rs`:

```rust
mod support;

use assert_cmd::Command;
use predicates::str::contains;
use support::TestHome;

#[test]
fn init_creates_sqlite_database() {
    let home = TestHome::new();
    let mut command = Command::cargo_bin("oracle-todo").unwrap();

    command.env("ORACLE_TODO_HOME", home.path()).arg("init");

    command.assert().success().stdout(contains("initialized"));
    assert!(home.path().join("todo.sqlite").exists());
}

#[test]
fn task_propose_prints_json_item() {
    let home = TestHome::new();
    Command::cargo_bin("oracle-todo").unwrap().env("ORACLE_TODO_HOME", home.path()).arg("init").assert().success();

    let mut command = Command::cargo_bin("oracle-todo").unwrap();
    command
        .env("ORACLE_TODO_HOME", home.path())
        .args(["task", "propose", "MoneyManager 앱 열고 DB 생성 여부 확인"]);

    command.assert().success().stdout(contains("\"status\":\"proposed\""));
}
```

- [ ] **Step 2: Run failing CLI tests**

Run: `cargo test --test cli_parity`

Expected: FAIL because CLI adapter still only supports `init` and `health`, and may not use the library service.

- [ ] **Step 3: Implement CLI adapter over service**

Create `src/interfaces/mod.rs`:

```rust
pub mod cli;
```

Modify `src/infrastructure/mod.rs`:

```rust
pub mod paths;
pub mod sqlite;
```

Create `src/infrastructure/paths.rs`:

```rust
use std::path::{Path, PathBuf};

pub fn todo_home(explicit_home: Option<PathBuf>) -> anyhow::Result<PathBuf> {
    if let Some(home) = explicit_home {
        return Ok(home);
    }
    if let Some(home) = std::env::var_os("ORACLE_TODO_HOME") {
        return Ok(PathBuf::from(home));
    }
    let home = std::env::var_os("HOME").ok_or_else(|| anyhow::anyhow!("HOME is not set"))?;
    Ok(PathBuf::from(home).join(".hermes/oracle-todo"))
}

pub fn db_path(home: &Path) -> PathBuf {
    home.join("todo.sqlite")
}

pub fn exports_dir(home: &Path) -> PathBuf {
    home.join("exports")
}
```

Modify `src/lib.rs` in the same step:

```rust
pub mod application;
pub mod domain;
pub mod exports;
pub mod infrastructure;
pub mod interfaces;
```

Create `src/interfaces/cli.rs` with this command shape:

```rust
use clap::{Args, Parser, Subcommand};
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(name = "oracle-todo")]
#[command(about = "Policy-enforced Oracle ToDo engine")]
pub struct Cli {
    #[arg(long, env = "ORACLE_TODO_HOME")]
    pub home: Option<PathBuf>,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    Init,
    Health,
    Task(TaskCommand),
}

#[derive(Debug, Subcommand)]
pub enum TaskCommand {
    Propose(TaskProposeArgs),
}

#[derive(Debug, Args)]
pub struct TaskProposeArgs {
    pub title: String,
    #[arg(long)]
    pub area: Option<String>,
    #[arg(long)]
    pub due: Option<String>,
    #[arg(long)]
    pub scheduled: Option<String>,
    #[arg(long)]
    pub priority: Option<i64>,
    #[arg(long)]
    pub description: Option<String>,
    #[arg(long, default_value = "oracle")]
    pub actor: String,
}
```

The first passing implementation supports `init`, `health`, and `task propose`:

```rust
pub fn run() -> anyhow::Result<()> {
    let cli = Cli::parse();
    dispatch(cli)
}
```

`task propose` opens `TodoService::sqlite(ORACLE_TODO_HOME/todo.sqlite)`, calls `TodoService::propose_task`, lets the service persist the item and event, and prints compact JSON via `serde_json::to_string(&item)`.

- [ ] **Step 4: Replace binary entrypoint**

Replace `src/main.rs`:

```rust
fn main() -> anyhow::Result<()> {
    oracle_todo::interfaces::cli::run()
}
```

- [ ] **Step 5: Run CLI tests**

Run: `cargo test --test cli_parity`

Expected: PASS.

- [ ] **Step 6: Commit core CLI**

Run:

```bash
git add src/lib.rs src/infrastructure/mod.rs src/infrastructure/paths.rs src/interfaces/mod.rs src/interfaces/cli.rs src/main.rs tests/support/mod.rs tests/cli_parity.rs
git commit -m "[feat] add core Rust CLI"
```

## Task 8: CLI Parity Expansion

**Files:**
- Modify: `src/interfaces/cli.rs`
- Modify: `tests/cli_parity.rs`

- [ ] **Step 1: Add remaining CLI command tests**

Add these tests to `tests/cli_parity.rs`:

```rust
#[test]
fn area_create_and_pending_match_python_cli_intent() {
    let home = TestHome::new();
    Command::cargo_bin("oracle-todo").unwrap().env("ORACLE_TODO_HOME", home.path()).arg("init").assert().success();
    Command::cargo_bin("oracle-todo").unwrap().env("ORACLE_TODO_HOME", home.path()).args(["area", "create", "재정", "--review-cycle", "weekly"]).assert().success().stdout(contains("\"status\":\"active\""));
    Command::cargo_bin("oracle-todo").unwrap().env("ORACLE_TODO_HOME", home.path()).args(["task", "propose", "DB 확인"]).assert().success();
    Command::cargo_bin("oracle-todo").unwrap().env("ORACLE_TODO_HOME", home.path()).arg("pending").assert().success().stdout(contains("DB 확인"));
}

#[test]
fn today_and_export_materialize_active_routines() {
    let home = TestHome::new();
    Command::cargo_bin("oracle-todo").unwrap().env("ORACLE_TODO_HOME", home.path()).arg("init").assert().success();
    let output = Command::cargo_bin("oracle-todo").unwrap().env("ORACLE_TODO_HOME", home.path()).args(["routine", "propose", "매일 스트레칭", "--recurrence-rule", "daily", "--actor", "user"]).assert().success().get_output().stdout.clone();
    let item: serde_json::Value = serde_json::from_slice(&output).unwrap();
    let routine_id = item["id"].as_str().unwrap();
    Command::cargo_bin("oracle-todo").unwrap().env("ORACLE_TODO_HOME", home.path()).args(["activate", routine_id]).assert().success();
    Command::cargo_bin("oracle-todo").unwrap().env("ORACLE_TODO_HOME", home.path()).arg("today").assert().success().stdout(contains("매일 스트레칭"));
    Command::cargo_bin("oracle-todo").unwrap().env("ORACLE_TODO_HOME", home.path()).arg("export").assert().success();
    assert!(home.path().join("exports").join("today.md").exists());
}

#[test]
fn event_propose_prints_external_commitment_metadata() {
    let home = TestHome::new();
    Command::cargo_bin("oracle-todo").unwrap().env("ORACLE_TODO_HOME", home.path()).arg("init").assert().success();
    Command::cargo_bin("oracle-todo").unwrap()
        .env("ORACLE_TODO_HOME", home.path())
        .args(["event", "propose", "병원 예약", "2026-06-01 15:00", "--with", "서울대병원", "--location", "서울대병원"])
        .assert()
        .success()
        .stdout(contains("\"type\":\"event\""))
        .stdout(contains("서울대병원"));
}
```

- [ ] **Step 2: Run expanded CLI tests and verify RED**

Run: `cargo test --test cli_parity`

Expected: FAIL because the CLI only supports `init`, `health`, and `task propose`.

- [ ] **Step 3: Implement remaining CLI commands over `TodoService::sqlite`**

Extend `src/interfaces/cli.rs` with `ListArgs`, `UpdateArgs`, `AreaCommand`, `ProjectCommand`, `RoutineCommand`, `EventCommand`, and transition commands. Each handler must open `TodoService::sqlite(db_path)` and call a service method. No handler may call SQLite repository methods directly.

- [ ] **Step 4: Run expanded CLI tests**

Run: `cargo test --test cli_parity`

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/interfaces/cli.rs tests/cli_parity.rs
git commit -m "[feat] expand Rust CLI parity"
```

## Task 9: API Parity

**Files:**
- Modify: `src/interfaces/api.rs`
- Modify: `src/interfaces/mod.rs`
- Create: `tests/api_parity.rs`

- [ ] **Step 1: Add failing API route tests**

Create `tests/api_parity.rs`:

```rust
use axum::body::Body;
use http_body_util::BodyExt;
use oracle_todo::interfaces::api::router;
use serde_json::json;
use tower::ServiceExt;

#[tokio::test]
async fn health_returns_ok() {
    let app = router(":memory:").unwrap();
    let response = app
        .oneshot(http::Request::builder().uri("/health").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), 200);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(&body[..], br#"{"ok":true}"#);
}

#[tokio::test]
async fn task_propose_and_approve_use_same_service_path() {
    let tmp = tempfile::tempdir().unwrap();
    let db_path = tmp.path().join("todo.sqlite");
    let app = router(&db_path).unwrap();
    let response = app
        .clone()
        .oneshot(
            http::Request::builder()
                .method("POST")
                .uri("/tasks/propose")
                .header("content-type", "application/json")
                .body(Body::from(json!({"title":"DB 확인"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), 200);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let item: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(item["status"], "proposed");

    let fresh_app = router(&db_path).unwrap();
    let response = fresh_app
        .oneshot(http::Request::builder().uri("/items").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let items: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(items.as_array().unwrap().len(), 1);
}
```

- [ ] **Step 2: Run failing API tests**

Run: `cargo test --test api_parity`

Expected: FAIL because `interfaces::api::router` does not exist.

- [ ] **Step 3: Implement minimal router**

Modify `src/interfaces/mod.rs`:

```rust
pub mod api;
pub mod cli;
```

Create `src/interfaces/api.rs`:

```rust
use axum::{extract::State, response::IntoResponse, routing::{get, post}, Json, Router};
use serde::Deserialize;
use serde_json::json;
use std::path::{Path, PathBuf};

use crate::application::service::{ProposeTask, TodoService};

#[derive(Clone)]
pub struct ApiState {
    db_path: PathBuf,
}

#[derive(Deserialize)]
struct TaskProposeBody {
    title: String,
    area: Option<String>,
    due: Option<String>,
    scheduled: Option<String>,
    priority: Option<i64>,
    description: Option<String>,
}

pub fn router(db_path: impl AsRef<Path>) -> anyhow::Result<Router> {
    let state = ApiState {
        db_path: db_path.as_ref().to_path_buf(),
    };
    Ok(Router::new()
        .route("/health", get(|| async { Json(json!({"ok": true})) }))
        .route("/tasks/propose", post(propose_task))
        .with_state(state))
}

async fn propose_task(State(state): State<ApiState>, Json(body): Json<TaskProposeBody>) -> impl IntoResponse {
    let mut service = TodoService::sqlite(&state.db_path).unwrap();
    let item = service
        .propose_task(
            body.title,
            ProposeTask {
                area: body.area,
                due: body.due,
                scheduled: body.scheduled,
                priority: body.priority,
                description: body.description,
                ..Default::default()
            },
        )
        .unwrap();
    Json(item)
}
```

Every handler creates a fresh `TodoService::sqlite(&state.db_path)` so API behavior persists across requests and matches the CLI service path.

- [ ] **Step 4: Add remaining API route tests and handlers**

Add route tests and handlers for these endpoints:

- `GET /items`
- `POST /areas`
- `POST /items/{id}/approve`
- `POST /items/{id}/complete`
- `GET /exports/today.md`

Use this test pattern for `POST /areas`:

```rust
#[tokio::test]
async fn create_area_returns_active_area() {
    let app = router(":memory:").unwrap();
    let response = app
        .oneshot(
            http::Request::builder()
                .method("POST")
                .uri("/areas")
                .header("content-type", "application/json")
                .body(Body::from(json!({"title":"재정","review_cycle":"weekly"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), 200);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let item: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(item["type"], "area");
    assert_eq!(item["status"], "active");
}
```

Use equivalent tests for `GET /items`, `POST /items/{id}/approve`, `POST /items/{id}/complete`, and `GET /exports/today.md`. Each handler must call `TodoService`, not repository or domain functions directly.

- [ ] **Step 5: Run API tests**

Run: `cargo test --test api_parity`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/interfaces/api.rs src/interfaces/mod.rs tests/api_parity.rs
git commit -m "[feat] add Rust API parity"
```

## Task 10: Logging, Error Mapping, Compatibility, And Full Verification

**Files:**
- Modify: `src/application/error.rs`
- Modify: `src/infrastructure/system.rs`
- Modify: `src/interfaces/cli.rs`
- Modify: `src/interfaces/api.rs`
- Modify: `src/infrastructure/sqlite.rs`
- Create: `tests/logging_errors.rs`
- Modify: `README.md`
- Modify: `docs/rust-refactor.md`

- [ ] **Step 1: Add failing error mapping tests**

Create `tests/logging_errors.rs`:

```rust
use oracle_todo::application::error::TodoError;

#[test]
fn policy_errors_map_to_exit_code_two() {
    assert_eq!(TodoError::Policy("x".to_string()).cli_exit_code(), 2);
}

#[test]
fn not_found_errors_map_to_http_404() {
    assert_eq!(TodoError::NotFound("item_1".to_string()).http_status_code(), 404);
}
```

- [ ] **Step 2: Run failing error tests**

Run: `cargo test --test logging_errors`

Expected: FAIL because error mapping helpers do not exist.

- [ ] **Step 3: Implement error mappings**

Add to `src/application/error.rs`:

```rust
impl TodoError {
    pub fn cli_exit_code(&self) -> i32 {
        match self {
            TodoError::Policy(_) | TodoError::Validation(_) => 2,
            TodoError::NotFound(_) => 4,
            TodoError::Storage(_) | TodoError::Migration(_) | TodoError::Internal(_) => 1,
        }
    }

    pub fn http_status_code(&self) -> u16 {
        match self {
            TodoError::Policy(_) | TodoError::Validation(_) => 400,
            TodoError::NotFound(_) => 404,
            TodoError::Storage(_) | TodoError::Migration(_) | TodoError::Internal(_) => 500,
        }
    }
}
```

- [ ] **Step 4: Add tracing setup**

Modify `src/infrastructure/mod.rs`:

```rust
pub mod paths;
pub mod sqlite;
pub mod system;
```

Create or extend `src/infrastructure/system.rs`:

```rust
use crate::application::ports::{Clock, IdGenerator};
use time::OffsetDateTime;
use uuid::Uuid;

pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> OffsetDateTime {
        OffsetDateTime::now_utc()
    }
}

pub struct UuidGenerator;

impl IdGenerator for UuidGenerator {
    fn new_id(&self, prefix: &str) -> String {
        format!("{}_{}", prefix, Uuid::new_v4().simple().to_string().chars().take(12).collect::<String>())
    }
}

pub fn init_tracing() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .try_init();
}
```

- [ ] **Step 5: Add copied-data compatibility smoke test**

Add to `tests/sqlite_repository.rs`:

```rust
#[test]
fn schema_init_is_additive_for_existing_database() {
    let conn = connect(":memory:").unwrap();
    conn.execute_batch(
        r#"
        CREATE TABLE items (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#,
    )
    .unwrap();

    init_schema(&conn).unwrap();
    assert_eq!(user_version(&conn).unwrap(), 1);
}
```

Make the test pass by changing `init_schema` to inspect `PRAGMA table_info(items)` and run `ALTER TABLE items ADD COLUMN` for these missing additive columns:

```rust
const ITEM_COLUMN_ADDITIONS: &[(&str, &str)] = &[
    ("area_id", "TEXT REFERENCES items(id)"),
    ("project_id", "TEXT REFERENCES items(id)"),
    ("routine_id", "TEXT REFERENCES items(id)"),
    ("parent_id", "TEXT REFERENCES items(id)"),
    ("description", "TEXT"),
    ("outcome", "TEXT"),
    ("definition_of_done", "TEXT"),
    ("standard", "TEXT"),
    ("review_cycle", "TEXT"),
    ("recurrence_rule", "TEXT"),
    ("materialization_policy", "TEXT NOT NULL DEFAULT 'single_open'"),
    ("occurrence_key", "TEXT"),
    ("priority", "INTEGER"),
    ("due", "TEXT"),
    ("scheduled", "TEXT"),
    ("horizon", "TEXT"),
    ("proposed_by", "TEXT NOT NULL DEFAULT 'oracle'"),
    ("approved_by", "TEXT"),
    ("approved_at", "TEXT"),
    ("completed_at", "TEXT"),
    ("archived_at", "TEXT"),
    ("last_materialized_at", "TEXT"),
    ("second_brain_refs", "TEXT NOT NULL DEFAULT '[]'"),
    ("metadata", "TEXT NOT NULL DEFAULT '{}'"),
];
```

- [ ] **Step 6: Update docs**

Update `README.md` to include Rust commands:

````markdown
## Rust parity commands

```bash
cargo test
cargo run -- init
cargo run -- task propose "MoneyManager 앱 열고 DB 생성 여부 확인"
cargo run -- pending
```
````

Update `docs/rust-refactor.md` cutover guardrails with the exact verification command list:

````markdown
## Rust parity verification

```bash
cargo test
uv run pytest
```

Run copied-data smoke tests only against an explicitly copied data home.
````

- [ ] **Step 7: Run full verification**

Run: `cargo fmt --check`

Expected: PASS.

Run: `cargo test`

Expected: PASS.

Run: `uv run pytest`

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/application/error.rs src/infrastructure/system.rs src/interfaces/cli.rs src/interfaces/api.rs src/infrastructure/sqlite.rs tests/logging_errors.rs tests/sqlite_repository.rs README.md docs/rust-refactor.md
git commit -m "[feat] finish Rust parity guardrails"
```

## Self-Review Checklist

- [ ] Spec coverage: tasks cover foundation, schema, policies, events, update/list/archive/export, routines, CLI, API, logging, errors, compatibility, and guardrails.
- [ ] TDD ordering: every task starts by adding or expanding failing tests before implementation steps.
- [ ] Clean Architecture: domain has no adapter dependencies; CLI/API call application service; SQLite stays in infrastructure.
- [ ] SQLite safety: tests use temporary or in-memory databases; live `~/.hermes/oracle-todo/todo.sqlite` is not used.
- [ ] KISS/YAGNI: no dashboard, Telegram parser, hard delete, or new recurrence behavior.
- [ ] DRY: recurrence parsing is centralized in `src/domain/recurrence.rs`; transitions are centralized in `TodoService`.
- [ ] Verification: final task runs `cargo fmt --check`, `cargo test`, and `uv run pytest`.

## Execution Choice

Recommended execution: subagent-driven, one fresh worker per task, with review after each task. Use disjoint ownership:

- Worker 1: Task 1 foundation.
- Worker 2: Task 2 SQLite baseline.
- Worker 3: Task 3 application policies.
- Worker 4: Task 4 events and transitions.
- Worker 5: Task 5 exports and views.
- Worker 6: Task 6 routines.
- Worker 7: Task 7 core CLI.
- Worker 8: Task 8 CLI expansion.
- Worker 9: Task 9 API.
- Worker 10: Task 10 verification and docs.

Do not run workers with overlapping write sets at the same time unless the active files are disjoint.
