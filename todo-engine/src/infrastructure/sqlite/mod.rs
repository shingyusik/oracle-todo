use crate::application::error::{TodoError, TodoResult};
use crate::domain::TodoEvent;
use rusqlite::functions::FunctionFlags;
use rusqlite::{Connection, OpenFlags};
use time::OffsetDateTime;

mod mapping;
mod repo;
mod schema;
mod table_query;

pub use schema::{init_schema, user_version};

use mapping::{row_to_event, storage_error};

pub fn connect(path: &str) -> TodoResult<Connection> {
    let connection =
        Connection::open(path).map_err(|error| TodoError::Storage(error.to_string()))?;
    register_sort_key(&connection)?;
    Ok(connection)
}

pub fn connect_read_only(path: &str) -> TodoResult<Connection> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| TodoError::Storage(error.to_string()))?;
    register_sort_key(&connection)?;
    match user_version(&connection)? {
        1 => Ok(connection),
        version => Err(TodoError::Migration(format!(
            "unsupported todo schema version {version}"
        ))),
    }
}

pub(super) fn register_sort_key(connection: &Connection) -> TodoResult<()> {
    let flags = FunctionFlags::SQLITE_DETERMINISTIC | FunctionFlags::SQLITE_INNOCUOUS;
    connection
        .create_scalar_function("todo_sort_key", 1, flags, |context| {
            let value = context.get::<String>(0)?;
            Ok(crate::application::table::unicode_sort_key(&value))
        })
        .map_err(storage_error)?;
    connection
        .create_scalar_function("todo_fold", 1, flags, |context| {
            Ok(context.get::<Option<String>>(0)?.map(|value| {
                value
                    .chars()
                    .flat_map(char::to_lowercase)
                    .collect::<String>()
            }))
        })
        .map_err(storage_error)?;
    connection
        .create_scalar_function("todo_group_key", 1, flags, |context| {
            Ok(context
                .get::<Option<String>>(0)?
                .map(|value| crate::application::table::canonical_group_value(&value)))
        })
        .map_err(storage_error)?;
    connection
        .create_scalar_function("todo_date_ordinal", 1, flags, |context| {
            Ok(context.get::<Option<String>>(0)?.and_then(|value| {
                time::Date::parse(
                    value.get(..10).unwrap_or(""),
                    time::macros::format_description!("[year]-[month]-[day]"),
                )
                .ok()
                .map(time::Date::to_julian_day)
            }))
        })
        .map_err(storage_error)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TodoActivity {
    pub timestamp: OffsetDateTime,
    pub action: String,
    pub record_id: String,
}

pub struct SqliteTodoRepository {
    pub(super) conn: Connection,
}

impl SqliteTodoRepository {
    pub fn new(conn: Connection) -> Self {
        Self { conn }
    }

    pub fn list_events_for_item(&mut self, item_id: &str) -> TodoResult<Vec<TodoEvent>> {
        let mut statement = self
            .conn
            .prepare(
                "SELECT id, at, actor, action, object_type, object_id, before, after, reason
                 FROM events
                 WHERE object_id = ?1
                 ORDER BY at, id",
            )
            .map_err(storage_error)?;
        let mut rows = statement.query([item_id]).map_err(storage_error)?;
        let mut events = Vec::new();
        while let Some(row) = rows.next().map_err(storage_error)? {
            events.push(row_to_event(row)?);
        }
        Ok(events)
    }

    pub fn recent_activity(&self, limit: u16) -> TodoResult<Vec<TodoActivity>> {
        if limit == 0 || limit > 500 {
            return Err(TodoError::Validation(
                "activity limit must be between 1 and 500".to_string(),
            ));
        }
        let mut statement = self
            .conn
            .prepare(
                "SELECT at, action, object_id
                 FROM events
                 ORDER BY at DESC, object_id, action, id
                 LIMIT ?1",
            )
            .map_err(storage_error)?;
        let mut rows = statement.query([i64::from(limit)]).map_err(storage_error)?;
        let mut activity = Vec::new();
        while let Some(row) = rows.next().map_err(storage_error)? {
            let timestamp: String = row.get(0).map_err(storage_error)?;
            activity.push(TodoActivity {
                timestamp: OffsetDateTime::parse(
                    &timestamp,
                    &time::format_description::well_known::Rfc3339,
                )
                .map_err(|_| TodoError::Storage("invalid event timestamp".to_string()))?,
                action: row.get(1).map_err(storage_error)?,
                record_id: row.get(2).map_err(storage_error)?,
            });
        }
        Ok(activity)
    }
}
