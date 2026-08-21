mod audit_json;
mod mapping;
mod repository;
#[cfg(test)]
mod repository_tests;
mod schema;
mod table_query;

use std::path::Path;
use std::time::Duration;

use rusqlite::functions::FunctionFlags;
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use unicode_casefold::UnicodeCaseFold;
use unicode_normalization::UnicodeNormalization;

use crate::application::error::{LedgerError, LedgerResult};

/// Keep cross-process writer contention bounded so callers can retry promptly.
pub const SQLITE_BUSY_TIMEOUT: Duration = Duration::from_millis(250);

pub struct SqliteLedgerRepository {
    pub(super) connection: Connection,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LedgerHealth {
    Healthy { user_version: i64 },
    NotInitialized,
    Unavailable,
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
        register_read_functions(&repository.connection)?;
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
        register_read_functions(&repository.connection)?;
        repository.init_schema()?;
        Ok(repository)
    }

    /// Reports Ledger initialization and schema health without changing the
    /// target path or database.
    pub fn health_at(path: impl AsRef<Path>) -> LedgerHealth {
        let path = path.as_ref();
        match std::fs::metadata(path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return LedgerHealth::NotInitialized;
            }
            Err(_) => return LedgerHealth::Unavailable,
            Ok(metadata) if !metadata.is_file() => return LedgerHealth::Unavailable,
            Ok(_) => {}
        }

        let Ok(repository) = Self::open_read_only_connection(path) else {
            return LedgerHealth::Unavailable;
        };
        let Ok(user_version) = repository.schema_version() else {
            return LedgerHealth::Unavailable;
        };
        if user_version == 0 {
            return LedgerHealth::NotInitialized;
        }
        match repository.check_schema() {
            Ok(()) => LedgerHealth::Healthy { user_version },
            Err(_) => LedgerHealth::Unavailable,
        }
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

    pub fn open_read_only(path: impl AsRef<Path>) -> LedgerResult<Self> {
        let repository = Self::open_read_only_connection(path.as_ref())?;
        repository.check_schema()?;
        Ok(repository)
    }

    fn open_read_only_connection(path: &Path) -> LedgerResult<Self> {
        let repository = Self {
            connection: Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|error| LedgerError::Storage(error.to_string()))?,
        };
        repository
            .connection
            .busy_timeout(SQLITE_BUSY_TIMEOUT)
            .map_err(storage_error)?;
        repository
            .connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(storage_error)?;
        register_read_functions(&repository.connection)?;
        Ok(repository)
    }
}

fn register_read_functions(connection: &Connection) -> LedgerResult<()> {
    connection
        .create_scalar_function(
            "ledger_content_contains",
            2,
            FunctionFlags::SQLITE_UTF8
                | FunctionFlags::SQLITE_DETERMINISTIC
                | FunctionFlags::SQLITE_INNOCUOUS,
            |context| {
                let content = context.get::<String>(0)?;
                let needle = context.get::<String>(1)?;
                Ok(unicode_search_key(&content).contains(&unicode_search_key(&needle)))
            },
        )
        .map_err(storage_error)?;
    connection
        .create_scalar_function(
            "ledger_money_key",
            2,
            FunctionFlags::SQLITE_UTF8
                | FunctionFlags::SQLITE_DETERMINISTIC
                | FunctionFlags::SQLITE_INNOCUOUS,
            |context| {
                Ok(money_sort_key(
                    context.get::<i64>(0)?,
                    context.get::<u8>(1)?,
                ))
            },
        )
        .map_err(storage_error)?;
    connection
        .create_scalar_function(
            "ledger_number_key",
            1,
            FunctionFlags::SQLITE_UTF8
                | FunctionFlags::SQLITE_DETERMINISTIC
                | FunctionFlags::SQLITE_INNOCUOUS,
            |context| {
                decimal_sort_key(&context.get::<String>(0)?).ok_or_else(|| {
                    rusqlite::Error::UserFunctionError("invalid decimal value".into())
                })
            },
        )
        .map_err(storage_error)
}

fn money_sort_key(minor: i64, decimal_places: u8) -> String {
    let negative = minor < 0;
    let digits = i128::from(minor).abs().to_string();
    let value = if decimal_places == 0 {
        digits
    } else {
        let decimal_places = usize::from(decimal_places);
        if digits.len() <= decimal_places {
            format!("0.{}{digits}", "0".repeat(decimal_places - digits.len()))
        } else {
            let split = digits.len() - decimal_places;
            format!("{}.{}", &digits[..split], &digits[split..])
        }
    };
    decimal_sort_key(&format!("{}{value}", if negative { "-" } else { "" }))
        .expect("persisted money precision is valid")
}

fn decimal_sort_key(value: &str) -> Option<String> {
    const WIDTH: usize = 400;
    let value = value.trim();
    let (negative, unsigned) = match value.as_bytes().first() {
        Some(b'-') => (true, &value[1..]),
        Some(b'+') => (false, &value[1..]),
        _ => (false, value),
    };
    let (mantissa, exponent) = if let Some((mantissa, exponent)) = unsigned.split_once(['e', 'E']) {
        (mantissa, exponent.parse::<i32>().ok()?)
    } else {
        (unsigned, 0)
    };
    if mantissa.is_empty() {
        return None;
    }
    let dot = mantissa.find('.');
    if dot.is_some_and(|dot| mantissa[dot + 1..].contains('.')) {
        return None;
    }
    let digits = mantissa.replace('.', "");
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let decimal_index = i64::try_from(dot.unwrap_or(mantissa.len()))
        .ok()?
        .checked_add(i64::from(exponent))?;
    let mut normalized = vec![b'0'; WIDTH * 2];
    for (index, digit) in digits.bytes().enumerate() {
        let position = i64::try_from(WIDTH).ok()? - decimal_index + i64::try_from(index).ok()?;
        if position < 0 {
            return None;
        }
        if let Some(slot) = usize::try_from(position)
            .ok()
            .and_then(|position| normalized.get_mut(position))
        {
            *slot = digit;
        }
    }
    let zero = normalized.iter().all(|digit| *digit == b'0');
    if negative && !zero {
        for digit in &mut normalized {
            *digit = b'9' - (*digit - b'0');
        }
    }
    Some(format!(
        "{}{}",
        if negative && !zero { '0' } else { '1' },
        String::from_utf8(normalized).ok()?
    ))
}

fn unicode_search_key(value: &str) -> String {
    value.nfkc().case_fold().nfkc().collect()
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
