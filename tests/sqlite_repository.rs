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
