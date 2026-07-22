use std::collections::BTreeSet;
use todo_engine::infrastructure::sqlite::{connect, init_schema, user_version};

/// Names of the three planning indexes this plan adds (CORE-02 / D-08).
const PLANNING_INDEXES: [&str; 3] = [
    "idx_items_parent_id",
    "idx_items_scheduled",
    "idx_items_type_horizon_scheduled",
];

/// Read the current `items` column names as a sorted set.
fn item_columns(conn: &rusqlite::Connection) -> BTreeSet<String> {
    conn.prepare("PRAGMA table_info(items)")
        .unwrap()
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .collect::<Result<BTreeSet<_>, _>>()
        .unwrap()
}

/// Read the planning index names that exist in `sqlite_master` as a set.
fn planning_indexes_present(conn: &rusqlite::Connection) -> BTreeSet<String> {
    conn.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN \
         ('idx_items_parent_id','idx_items_scheduled','idx_items_type_horizon_scheduled')",
    )
    .unwrap()
    .query_map([], |row| row.get::<_, String>(0))
    .unwrap()
    .collect::<Result<BTreeSet<_>, _>>()
    .unwrap()
}

/// SC4: re-running `init_schema` over an EXISTING, populated data home (simulated by an
/// in-memory copy that already holds rows) adds the three planning indexes idempotently,
/// preserves the existing rows, and leaves `user_version` at 1 — never touching the live DB.
#[test]
fn init_schema_adds_planning_indexes_on_existing_populated_home() {
    let conn = connect(":memory:").unwrap();

    // First open: an existing data home created by a prior binary run.
    init_schema(&conn).unwrap();

    // Existing data the user already had (mirror repository.rs INSERT shape).
    conn.execute_batch(
        r#"
        INSERT INTO items (id, type, title, status, proposed_by, created_at, updated_at)
        VALUES
            ('task_1', 'task', 'one', 'proposed', 'agent', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z'),
            ('task_2', 'task', 'two', 'proposed', 'agent', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z');
        "#,
    )
    .unwrap();

    let rows_before: i64 = conn
        .query_row("SELECT COUNT(*) FROM items", [], |row| row.get(0))
        .unwrap();
    assert_eq!(rows_before, 2);

    // Current binary re-opens the existing populated data home.
    init_schema(&conn).unwrap();

    // All three planning indexes are present.
    assert_eq!(
        planning_indexes_present(&conn),
        PLANNING_INDEXES.iter().map(|s| s.to_string()).collect(),
        "all three planning indexes must exist after re-running init_schema"
    );

    // Existing rows are preserved (additive migration, no data loss).
    let rows_after: i64 = conn
        .query_row("SELECT COUNT(*) FROM items", [], |row| row.get(0))
        .unwrap();
    assert_eq!(rows_after, 2, "existing rows must survive the re-migration");

    // No version bump: still at the additive baseline.
    assert_eq!(user_version(&conn).unwrap(), 1);
}

/// CORE-02: the migration drops/rewrites no columns and introduces no `period_key` column.
/// Capture columns before and after a re-run and assert the BEFORE set is a subset of AFTER
/// and that `period_key` never appears.
#[test]
fn migration_preserves_columns_and_adds_no_period_key() {
    let conn = connect(":memory:").unwrap();
    init_schema(&conn).unwrap();

    let before = item_columns(&conn);

    // Re-run, simulating the current binary re-opening an existing data home.
    init_schema(&conn).unwrap();

    let after = item_columns(&conn);

    assert!(
        before.is_subset(&after),
        "no existing column may be dropped or renamed (before must be a subset of after)"
    );
    assert!(
        !after.contains("period_key"),
        "the additive migration must not introduce a period_key column (locked OUT)"
    );

    // The reserved columns the planning indexes depend on are present.
    for column in ["parent_id", "scheduled", "type", "horizon"] {
        assert!(
            after.contains(column),
            "expected indexed column {column} to exist on items"
        );
    }
}

#[test]
fn init_schema_adds_tags_column_to_legacy_items_table() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        r#"
        CREATE TABLE items (
            id TEXT NOT NULL PRIMARY KEY,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#,
    )
    .unwrap();

    todo_engine::infrastructure::sqlite::init_schema(&conn).unwrap();

    let columns = item_columns_vec(&conn);
    assert!(columns.iter().any(|column| column == "tags"));
}

#[test]
fn init_schema_creates_workspace_preferences_table() {
    let conn = connect(":memory:").unwrap();

    init_schema(&conn).unwrap();

    let table_exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'workspace_preferences')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(table_exists);
}

fn item_columns_vec(conn: &rusqlite::Connection) -> Vec<String> {
    let mut statement = conn.prepare("PRAGMA table_info(items)").unwrap();
    statement
        .query_map([], |row| row.get::<_, String>(1))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap()
}
