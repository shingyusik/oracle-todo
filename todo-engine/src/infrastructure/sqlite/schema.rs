use super::mapping::storage_error;
use crate::application::error::{TodoError, TodoResult};
use rusqlite::Connection;

pub fn init_schema(conn: &Connection) -> TodoResult<()> {
    match init_schema_inner(conn) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(error)
        }
    }
}

fn init_schema_inner(conn: &Connection) -> TodoResult<()> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        BEGIN;

        CREATE TABLE IF NOT EXISTS items (
            id TEXT NOT NULL PRIMARY KEY,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL,
            area_id TEXT REFERENCES items(id),
            project_id TEXT REFERENCES items(id),
            routine_id TEXT REFERENCES items(id),
            parent_id TEXT REFERENCES items(id),
            description TEXT,
            note TEXT,
            outcome TEXT,
            definition_of_done TEXT,
            standard TEXT,
            review_cycle TEXT,
            recurrence_rule TEXT,
            materialization_policy TEXT NOT NULL DEFAULT 'single_open',
            future_occurrences INTEGER NOT NULL DEFAULT 7,
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
            tags TEXT NOT NULL DEFAULT '[]',
            metadata TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS events (
            id TEXT NOT NULL PRIMARY KEY,
            at TEXT NOT NULL,
            actor TEXT NOT NULL,
            action TEXT NOT NULL,
            object_type TEXT NOT NULL,
            object_id TEXT NOT NULL,
            before TEXT,
            after TEXT,
            reason TEXT
        );
        "#,
    )
    .map_err(|error| TodoError::Migration(error.to_string()))?;

    ensure_item_columns(conn)?;

    conn.execute(
        "UPDATE items SET status = 'active' WHERE status IN ('proposed', 'approved')",
        [],
    )
    .map_err(storage_error)?;

    conn.execute_batch(
        r#"
        CREATE INDEX IF NOT EXISTS idx_items_type ON items(type);
        CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
        CREATE INDEX IF NOT EXISTS idx_items_area_id ON items(area_id);
        CREATE INDEX IF NOT EXISTS idx_items_project_id ON items(project_id);
        CREATE INDEX IF NOT EXISTS idx_items_routine_id ON items(routine_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_items_routine_occurrence
            ON items(routine_id, occurrence_key)
            WHERE routine_id IS NOT NULL AND occurrence_key IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_items_parent_id ON items(parent_id);
        CREATE INDEX IF NOT EXISTS idx_items_scheduled ON items(scheduled);
        CREATE INDEX IF NOT EXISTS idx_items_type_horizon_scheduled
            ON items(type, horizon, scheduled);

        CREATE INDEX IF NOT EXISTS idx_events_at ON events(at);
        CREATE INDEX IF NOT EXISTS idx_events_object_id ON events(object_id);

        PRAGMA user_version = 1;
        COMMIT;
        "#,
    )
    .map_err(|error| TodoError::Migration(error.to_string()))
}

const ITEM_COLUMN_ADDITIONS: &[(&str, &str)] = &[
    ("area_id", "TEXT REFERENCES items(id)"),
    ("project_id", "TEXT REFERENCES items(id)"),
    ("routine_id", "TEXT REFERENCES items(id)"),
    ("parent_id", "TEXT REFERENCES items(id)"),
    ("description", "TEXT"),
    ("note", "TEXT"),
    ("outcome", "TEXT"),
    ("definition_of_done", "TEXT"),
    ("standard", "TEXT"),
    ("review_cycle", "TEXT"),
    ("recurrence_rule", "TEXT"),
    (
        "materialization_policy",
        "TEXT NOT NULL DEFAULT 'single_open'",
    ),
    ("future_occurrences", "INTEGER NOT NULL DEFAULT 7"),
    ("occurrence_key", "TEXT"),
    ("priority", "INTEGER"),
    ("due", "TEXT"),
    ("scheduled", "TEXT"),
    ("horizon", "TEXT"),
    ("proposed_by", "TEXT NOT NULL DEFAULT 'agent'"),
    ("approved_by", "TEXT"),
    ("approved_at", "TEXT"),
    ("completed_at", "TEXT"),
    ("archived_at", "TEXT"),
    ("last_materialized_at", "TEXT"),
    ("second_brain_refs", "TEXT NOT NULL DEFAULT '[]'"),
    ("tags", "TEXT NOT NULL DEFAULT '[]'"),
    ("metadata", "TEXT NOT NULL DEFAULT '{}'"),
];

fn ensure_item_columns(conn: &Connection) -> TodoResult<()> {
    let mut statement = conn
        .prepare("PRAGMA table_info(items)")
        .map_err(storage_error)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)?;

    for (name, definition) in ITEM_COLUMN_ADDITIONS {
        if !columns.iter().any(|column| column == name) {
            conn.execute_batch(&format!(
                "ALTER TABLE items ADD COLUMN {name} {definition};"
            ))
            .map_err(|error| TodoError::Migration(error.to_string()))?;
        }
    }
    Ok(())
}

pub fn user_version(conn: &Connection) -> TodoResult<i64> {
    conn.pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| TodoError::Storage(error.to_string()))
}
