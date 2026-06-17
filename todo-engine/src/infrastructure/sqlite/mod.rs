use crate::application::error::{TodoError, TodoResult};
use crate::domain::TodoEvent;
use rusqlite::Connection;

mod mapping;
mod repo;
mod schema;

pub use schema::{init_schema, user_version};

use mapping::{row_to_event, storage_error};

pub fn connect(path: &str) -> TodoResult<Connection> {
    Connection::open(path).map_err(|error| TodoError::Storage(error.to_string()))
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
}
