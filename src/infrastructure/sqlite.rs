use crate::application::error::{TodoError, TodoResult};
use rusqlite::Connection;

pub fn connect(path: &str) -> TodoResult<Connection> {
    Connection::open(path).map_err(|error| TodoError::Storage(error.to_string()))
}

pub fn init_schema(conn: &Connection) -> TodoResult<()> {
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

        CREATE INDEX IF NOT EXISTS idx_events_at ON events(at);
        CREATE INDEX IF NOT EXISTS idx_events_object_id ON events(object_id);

        PRAGMA user_version = 1;
        COMMIT;
        "#,
    )
    .map_err(|error| TodoError::Migration(error.to_string()))
}

pub fn user_version(conn: &Connection) -> TodoResult<i64> {
    conn.pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| TodoError::Storage(error.to_string()))
}
