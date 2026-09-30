use std::path::Path;
use std::time::Duration;

use rusqlite::{Connection, OpenFlags};
use serde_json::Value;

use crate::preferences;

const CANONICAL_WORKSPACE_VIEWS_PREFERENCE_KEY: &str = "workspace.views.v1";
const WORKSPACE_VIEWS_PREFERENCE_KEY: &str = "workspace-views.v1";

pub fn read_preference(
    db_path: &Path,
    key: &str,
) -> Result<Option<Value>, preferences::PreferencesError> {
    match std::fs::metadata(db_path) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    }
    let connection = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    connection.busy_timeout(Duration::from_secs(5))?;
    let initialized: bool = connection.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM sqlite_master
            WHERE type = 'table' AND name = 'workspace_preferences'
        )",
        [],
        |row| row.get(0),
    )?;
    if initialized {
        let value = preferences::get(&connection, key)?;
        if value.is_none() && key == CANONICAL_WORKSPACE_VIEWS_PREFERENCE_KEY {
            preferences::get(&connection, WORKSPACE_VIEWS_PREFERENCE_KEY)
        } else {
            Ok(value)
        }
    } else {
        Ok(None)
    }
}

pub fn write_preference(
    db_path: &Path,
    key: &str,
    value: &Value,
) -> Result<(), preferences::PreferencesError> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut connection = Connection::open(db_path)?;
    connection.busy_timeout(Duration::from_secs(5))?;
    preferences::init_schema(&connection)?;
    preferences::put(&mut connection, key, value)
}
