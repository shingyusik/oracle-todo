mod audit_json;
mod mapping;
mod repository;
#[cfg(test)]
mod repository_tests;
mod schema;

use std::path::Path;
use std::time::Duration;

use rusqlite::{Connection, OptionalExtension};

use crate::application::error::{LedgerError, LedgerResult};

/// Keep cross-process writer contention bounded so callers can retry promptly.
pub const SQLITE_BUSY_TIMEOUT: Duration = Duration::from_millis(250);

pub struct SqliteLedgerRepository {
    pub(super) connection: Connection,
}

impl SqliteLedgerRepository {
    pub fn open(path: impl AsRef<Path>) -> LedgerResult<Self> {
        let repository = Self {
            connection: Connection::open(path)
                .map_err(|error| LedgerError::Storage(error.to_string()))?,
        };
        repository
            .connection
            .busy_timeout(SQLITE_BUSY_TIMEOUT)
            .map_err(storage_error)?;
        repository.init_schema()?;
        Ok(repository)
    }

    pub fn open_in_memory() -> LedgerResult<Self> {
        let repository = Self {
            connection: Connection::open_in_memory()
                .map_err(|error| LedgerError::Storage(error.to_string()))?,
        };
        repository
            .connection
            .busy_timeout(SQLITE_BUSY_TIMEOUT)
            .map_err(storage_error)?;
        repository.init_schema()?;
        Ok(repository)
    }

    pub fn init_schema(&self) -> LedgerResult<()> {
        schema::init_schema(&self.connection)
    }

    pub fn schema_version(&self) -> LedgerResult<i64> {
        schema::user_version(&self.connection)
    }

    pub fn check_schema(&self) -> LedgerResult<()> {
        schema::check_schema(&self.connection)
    }

    #[doc(hidden)]
    pub fn column_type_for_test(&self, table: &str, column: &str) -> LedgerResult<String> {
        self.connection
            .query_row(
                "SELECT type FROM pragma_table_info(?1) WHERE name = ?2",
                [table, column],
                |row| row.get(0),
            )
            .optional()
            .map_err(storage_error)?
            .ok_or_else(|| LedgerError::Storage(format!("missing schema column {table}.{column}")))
    }

    #[doc(hidden)]
    pub fn index_exists_for_test(&self, index: &str) -> LedgerResult<bool> {
        self.object_exists_for_test("index", index)
    }

    #[doc(hidden)]
    pub fn table_exists_for_test(&self, table: &str) -> LedgerResult<bool> {
        self.object_exists_for_test("table", table)
    }

    fn object_exists_for_test(&self, kind: &str, name: &str) -> LedgerResult<bool> {
        self.connection
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM sqlite_master WHERE type = ?1 AND name = ?2
                )",
                [kind, name],
                |row| row.get::<_, bool>(0),
            )
            .map_err(storage_error)
    }
}

pub(super) fn storage_error(error: rusqlite::Error) -> LedgerError {
    if is_busy_error(&error) {
        return LedgerError::Busy(error.to_string());
    }
    match &error {
        rusqlite::Error::SqliteFailure(failure, _)
            if failure.code == rusqlite::ErrorCode::ConstraintViolation
                && matches!(
                    failure.extended_code,
                    rusqlite::ffi::SQLITE_CONSTRAINT_PRIMARYKEY
                        | rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE
                ) =>
        {
            LedgerError::Conflict(error.to_string())
        }
        _ => LedgerError::Storage(error.to_string()),
    }
}

pub(super) fn is_busy_error(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(failure, _)
            if matches!(
                failure.code,
                rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked
            )
    )
}
