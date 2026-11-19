//! SQLite statements behind the Health retention purge.

use std::path::Path;
use std::time::Duration;

use rusqlite::{Connection, params};

use super::{HealthStorageHealth, SQLITE_BUSY_TIMEOUT, SqliteHealthRepository, storage_error};
use crate::application::error::{HealthError, HealthResult};
use crate::application::retention::{
    ArchivedDietRow, ArchivedEventRow, RetentionPlan, RetentionRows, RetentionWindow, plan_from,
};

pub const RETENTION_BUSY_TIMEOUT: Duration = Duration::from_secs(5);

impl SqliteHealthRepository {
    /// Plans a retention purge for the store at `path` without creating or migrating it.
    /// A missing or uninitialized store yields an empty plan.
    pub fn retention_plan_at(
        path: impl AsRef<Path>,
        window: &RetentionWindow,
    ) -> HealthResult<RetentionPlan> {
        let path = path.as_ref();
        if Self::health_at(path) == HealthStorageHealth::NotInitialized {
            return Ok(RetentionPlan::empty(*window));
        }
        let repository = Self::open_read_only(path)?;
        plan_from(&repository, window)
    }
}

pub(super) fn set_purge_mode(connection: &Connection, enabled: bool) -> HealthResult<()> {
    let (timeout, secure_delete) = if enabled {
        (RETENTION_BUSY_TIMEOUT, true)
    } else {
        (SQLITE_BUSY_TIMEOUT, false)
    };
    connection.busy_timeout(timeout).map_err(storage_error)?;
    connection
        .pragma_update(None, "secure_delete", secure_delete)
        .map_err(storage_error)?;
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(storage_error)?;
    let foreign_keys: bool = connection
        .pragma_query_value(None, "foreign_keys", |row| row.get(0))
        .map_err(storage_error)?;
    if !foreign_keys {
        return Err(HealthError::Storage(
            "foreign keys must be enforced for retention".to_string(),
        ));
    }
    Ok(())
}

pub(super) fn retention_rows(connection: &Connection) -> HealthResult<RetentionRows> {
    // One read snapshot for all three queries; dropping it rolls the read back.
    let snapshot = connection.unchecked_transaction().map_err(storage_error)?;
    let connection: &Connection = &snapshot;
    let diets = query(
        connection,
        "SELECT id, food_name, deleted_at, media_id
         FROM diet_entries WHERE deleted_at IS NOT NULL ORDER BY id",
        |row| {
            Ok(ArchivedDietRow {
                id: row.get(0)?,
                label: row.get(1)?,
                deleted_at: row.get(2)?,
                media_id: row.get(3)?,
            })
        },
    )?;
    let events = query(
        connection,
        "SELECT id, name, category, deleted_at
         FROM health_events WHERE deleted_at IS NOT NULL ORDER BY id",
        |row| {
            Ok(ArchivedEventRow {
                id: row.get(0)?,
                label: row.get(1)?,
                category: row.get(2)?,
                deleted_at: row.get(3)?,
            })
        },
    )?;
    let media_references = query(
        connection,
        "SELECT media_id, id FROM diet_entries
         WHERE media_id IN (
            SELECT media_id FROM diet_entries
            WHERE deleted_at IS NOT NULL AND media_id IS NOT NULL
         )
         ORDER BY media_id, id",
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    Ok(RetentionRows {
        diets,
        events,
        media_references,
    })
}

pub(super) fn purge_diet(connection: &Connection, id: &str) -> HealthResult<()> {
    let tag_ids: Vec<String> = query_with(
        connection,
        "SELECT tag_id FROM diet_entry_tags WHERE diet_entry_id = ?1",
        [id],
        |row| row.get(0),
    )?;
    delete_history(connection, "diet_entry", id)?;
    let deleted = connection
        .execute("DELETE FROM diet_entries WHERE id = ?1", [id])
        .map_err(storage_error)?;
    ensure_deleted(deleted, "diet entry", id)?;
    for tag_id in tag_ids {
        connection
            .execute(
                "DELETE FROM diet_tags
                 WHERE id = ?1
                   AND NOT EXISTS (SELECT 1 FROM diet_entry_tags WHERE tag_id = ?1)",
                [&tag_id],
            )
            .map_err(storage_error)?;
    }
    Ok(())
}

pub(super) fn purge_event(connection: &Connection, id: &str) -> HealthResult<()> {
    delete_history(connection, "health_event", id)?;
    let deleted = connection
        .execute("DELETE FROM health_events WHERE id = ?1", [id])
        .map_err(storage_error)?;
    ensure_deleted(deleted, "health event", id)
}

pub(super) fn count_diet_media_references(
    connection: &Connection,
    media_id: &str,
) -> HealthResult<u64> {
    connection
        .query_row(
            "SELECT COUNT(*) FROM diet_entries WHERE media_id = ?1",
            [media_id],
            |row| row.get::<_, i64>(0),
        )
        .map(i64::unsigned_abs)
        .map_err(storage_error)
}

fn delete_history(connection: &Connection, record_type: &str, id: &str) -> HealthResult<()> {
    connection
        .execute(
            "DELETE FROM audit_events WHERE record_type = ?1 AND record_id = ?2",
            params![record_type, id],
        )
        .map_err(storage_error)?;
    Ok(())
}

fn ensure_deleted(deleted: usize, record_type: &str, id: &str) -> HealthResult<()> {
    if deleted == 1 {
        Ok(())
    } else {
        Err(HealthError::NotFound(format!("{record_type} {id}")))
    }
}

fn query<T>(
    connection: &Connection,
    sql: &str,
    map: impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
) -> HealthResult<Vec<T>> {
    query_with(connection, sql, [], map)
}

fn query_with<T, P: rusqlite::Params>(
    connection: &Connection,
    sql: &str,
    parameters: P,
    map: impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
) -> HealthResult<Vec<T>> {
    let mut statement = connection.prepare(sql).map_err(storage_error)?;
    statement
        .query_map(parameters, map)
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)
}
