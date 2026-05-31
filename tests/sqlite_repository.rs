use oracle_todo::application::ports::{EventRepository, ListFilter, TodoRepository};
use oracle_todo::domain::{Actor, ItemStatus, TodoEvent, TodoItem};
use oracle_todo::infrastructure::sqlite::SqliteTodoRepository;
use oracle_todo::infrastructure::sqlite::{connect, init_schema, user_version};
use time::{OffsetDateTime, macros::datetime};

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

#[test]
fn schema_rejects_null_primary_ids() {
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();

    let item_result = conn.execute(
        "INSERT INTO items (id, type, title, status, proposed_by, created_at, updated_at) VALUES (NULL, 'task', 'bad', 'proposed', 'oracle', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z')",
        [],
    );
    let event_result = conn.execute(
        "INSERT INTO events (id, at, actor, action, object_type, object_id) VALUES (NULL, '2026-06-01T00:00:00Z', 'oracle', 'bad', 'task', 'task_1')",
        [],
    );

    assert!(item_result.is_err());
    assert!(event_result.is_err());
}

#[test]
fn failed_schema_init_does_not_mark_database_version() {
    let conn = connect(":memory:").unwrap();
    conn.execute_batch(
        r#"
        CREATE TABLE items (
            id TEXT NOT NULL PRIMARY KEY,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL,
            routine_id TEXT,
            occurrence_key TEXT,
            proposed_by TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        INSERT INTO items (id, type, title, status, routine_id, occurrence_key, proposed_by, created_at, updated_at)
        VALUES
            ('task_1', 'task', 'one', 'proposed', 'rtn_1', '2026-06-01', 'oracle', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z'),
            ('task_2', 'task', 'two', 'proposed', 'rtn_1', '2026-06-01', 'oracle', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z');
        "#,
    )
    .unwrap();

    let result = init_schema(&conn);

    assert!(result.is_err());
    assert_eq!(user_version(&conn).unwrap(), 0);
}

#[test]
fn saving_item_and_event_persists_to_sqlite() {
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();
    let mut repo = SqliteTodoRepository::new(conn);
    let now = datetime!(2026-06-01 00:00 UTC);
    let item = TodoItem::new_task("task_test", "테스트", Actor::Oracle, now);

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
