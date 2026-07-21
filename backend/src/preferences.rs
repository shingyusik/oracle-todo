use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;

#[derive(Debug, thiserror::Error)]
pub enum PreferencesError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("invalid preference JSON: {0}")]
    Json(#[from] serde_json::Error),
}

pub fn init_schema(connection: &Connection) -> Result<(), PreferencesError> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS workspace_preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);",
    )?;
    Ok(())
}

pub fn get(connection: &Connection, key: &str) -> Result<Option<Value>, PreferencesError> {
    connection
        .query_row(
            "SELECT value FROM workspace_preferences WHERE key = ?1",
            [key],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .map(|value| serde_json::from_str(&value))
        .transpose()
        .map_err(PreferencesError::from)
}

pub fn put(connection: &mut Connection, key: &str, value: &Value) -> Result<(), PreferencesError> {
    connection.execute(
        "INSERT INTO workspace_preferences (key, value, updated_at)
         VALUES (?1, ?2, CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP",
        (key, serde_json::to_string(value)?),
    )?;
    Ok(())
}
