mod audit_json;
#[allow(dead_code)]
mod mapping;
#[allow(dead_code)]
mod repository;
#[cfg(test)]
mod repository_tests;
mod schema;

use std::path::Path;
use std::time::Duration;

use rusqlite::{Connection, OpenFlags, OptionalExtension};

use crate::application::error::{HealthError, HealthResult};

pub use schema::SCHEMA_VERSION;

pub const SQLITE_BUSY_TIMEOUT: Duration = Duration::from_millis(250);

#[derive(Debug)]
pub struct SqliteHealthRepository {
    pub(super) connection: Connection,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HealthStorageHealth {
    Healthy { user_version: i64 },
    NotInitialized,
    Unavailable,
}

impl SqliteHealthRepository {
    pub fn open(path: impl AsRef<Path>) -> HealthResult<Self> {
        let repository = Self {
            connection: Connection::open(path).map_err(storage_error)?,
        };
        repository.configure_connection()?;
        repository.init_schema()?;
        Ok(repository)
    }

    pub fn open_in_memory() -> HealthResult<Self> {
        let repository = Self {
            connection: Connection::open_in_memory().map_err(storage_error)?,
        };
        repository.configure_connection()?;
        repository.init_schema()?;
        Ok(repository)
    }

    /// Checks initialization and readability without creating or migrating.
    pub fn health_at(path: impl AsRef<Path>) -> HealthStorageHealth {
        let path = path.as_ref();
        match std::fs::metadata(path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return HealthStorageHealth::NotInitialized;
            }
            Err(_) => return HealthStorageHealth::Unavailable,
            Ok(metadata) if !metadata.is_file() => return HealthStorageHealth::Unavailable,
            Ok(_) => {}
        }

        let Ok(repository) = Self::open_read_only(path) else {
            return HealthStorageHealth::Unavailable;
        };
        let Ok(user_version) = repository.schema_version() else {
            return HealthStorageHealth::Unavailable;
        };
        if user_version == 0 {
            return HealthStorageHealth::NotInitialized;
        }
        match repository.check_schema() {
            Ok(()) => HealthStorageHealth::Healthy { user_version },
            Err(_) => HealthStorageHealth::Unavailable,
        }
    }

    pub fn init_schema(&self) -> HealthResult<()> {
        schema::init_schema(&self.connection)
    }

    pub fn check_schema(&self) -> HealthResult<()> {
        schema::check_schema(&self.connection)
    }

    pub fn schema_version(&self) -> HealthResult<i64> {
        schema::user_version(&self.connection)
    }

    #[doc(hidden)]
    pub fn table_exists_for_test(&self, table: &str) -> HealthResult<bool> {
        self.object_exists_for_test("table", table)
    }

    #[doc(hidden)]
    pub fn index_exists_for_test(&self, index: &str) -> HealthResult<bool> {
        self.object_exists_for_test("index", index)
    }

    #[doc(hidden)]
    pub fn column_type_for_test(&self, table: &str, column: &str) -> HealthResult<String> {
        self.connection
            .query_row(
                "SELECT type FROM pragma_table_info(?1) WHERE name = ?2",
                [table, column],
                |row| row.get(0),
            )
            .optional()
            .map_err(storage_error)?
            .ok_or_else(|| HealthError::Storage(format!("missing column {table}.{column}")))
    }

    #[doc(hidden)]
    pub fn foreign_keys_enabled_for_test(&self) -> HealthResult<bool> {
        self.connection
            .pragma_query_value(None, "foreign_keys", |row| row.get(0))
            .map_err(storage_error)
    }

    fn configure_connection(&self) -> HealthResult<()> {
        self.connection
            .busy_timeout(SQLITE_BUSY_TIMEOUT)
            .map_err(storage_error)?;
        self.connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(storage_error)
    }

    fn object_exists_for_test(&self, kind: &str, name: &str) -> HealthResult<bool> {
        self.connection
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM sqlite_master WHERE type = ?1 AND name = ?2
                 )",
                [kind, name],
                |row| row.get(0),
            )
            .map_err(storage_error)
    }

    fn open_read_only(path: &Path) -> HealthResult<Self> {
        let repository = Self {
            connection: Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(storage_error)?,
        };
        repository.configure_connection()?;
        Ok(repository)
    }
}

pub(super) fn storage_error(error: rusqlite::Error) -> HealthError {
    if is_busy_error(&error) {
        return HealthError::Busy(error.to_string());
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
            HealthError::Conflict(error.to_string())
        }
        _ => HealthError::Storage(error.to_string()),
    }
}

fn is_busy_error(error: &rusqlite::Error) -> bool {
    matches!(
        error,
        rusqlite::Error::SqliteFailure(failure, _)
            if matches!(
                failure.code,
                rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked
            )
    )
}
