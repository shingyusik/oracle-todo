use super::mapping::{format_time, parse_time, storage_error};
use crate::application::error::{TodoError, TodoResult};
use crate::domain::{Actor, ItemStatus, ItemType};
use rusqlite::{Connection, params};
use std::str::FromStr;
use time::OffsetDateTime;
use time::PrimitiveDateTime;
use time::macros::format_description;

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct LegacyMigrationReport {
    pub item_rows: usize,
    pub event_rows: usize,
    pub timestamp_fields: usize,
}

pub fn migrate_legacy_storage(conn: &Connection) -> TodoResult<LegacyMigrationReport> {
    let item_rows = load_legacy_item_rows(conn)?;
    let event_rows = load_legacy_event_rows(conn)?;

    conn.execute_batch("BEGIN IMMEDIATE;")
        .map_err(storage_error)?;

    let result = (|| {
        let mut report = LegacyMigrationReport::default();

        for row in item_rows {
            let normalized = normalize_legacy_item_row(&row)?;
            if normalized.changed {
                conn.execute(
                    r#"
                    UPDATE items
                    SET type = ?2,
                        status = ?3,
                        proposed_by = ?4,
                        approved_by = ?5,
                        approved_at = ?6,
                        completed_at = ?7,
                        archived_at = ?8,
                        last_materialized_at = ?9,
                        created_at = ?10,
                        updated_at = ?11
                    WHERE id = ?1
                    "#,
                    params![
                        row.id,
                        normalized.item_type,
                        normalized.status,
                        normalized.proposed_by,
                        normalized.approved_by,
                        normalized.approved_at,
                        normalized.completed_at,
                        normalized.archived_at,
                        normalized.last_materialized_at,
                        normalized.created_at,
                        normalized.updated_at,
                    ],
                )
                .map_err(storage_error)?;
                report.item_rows += 1;
                report.timestamp_fields += normalized.timestamp_fields;
            }
        }

        for row in event_rows {
            let normalized = normalize_legacy_event_row(&row)?;
            if normalized.changed {
                conn.execute(
                    r#"
                    UPDATE events
                    SET at = ?2,
                        actor = ?3,
                        object_type = ?4
                    WHERE id = ?1
                    "#,
                    params![
                        row.id,
                        normalized.at,
                        normalized.actor,
                        normalized.object_type
                    ],
                )
                .map_err(storage_error)?;
                report.event_rows += 1;
                report.timestamp_fields += normalized.timestamp_fields;
            }
        }

        Ok(report)
    })();

    match result {
        Ok(report) => {
            conn.execute_batch("COMMIT;").map_err(storage_error)?;
            Ok(report)
        }
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(error)
        }
    }
}

struct LegacyItemRow {
    id: String,
    item_type: String,
    status: String,
    proposed_by: String,
    approved_by: Option<String>,
    approved_at: Option<String>,
    completed_at: Option<String>,
    archived_at: Option<String>,
    last_materialized_at: Option<String>,
    created_at: String,
    updated_at: String,
}

struct NormalizedLegacyItemRow {
    changed: bool,
    timestamp_fields: usize,
    item_type: String,
    status: String,
    proposed_by: String,
    approved_by: Option<String>,
    approved_at: Option<String>,
    completed_at: Option<String>,
    archived_at: Option<String>,
    last_materialized_at: Option<String>,
    created_at: String,
    updated_at: String,
}

struct LegacyEventRow {
    id: String,
    at: String,
    actor: String,
    object_type: String,
}

struct NormalizedLegacyEventRow {
    changed: bool,
    timestamp_fields: usize,
    at: String,
    actor: String,
    object_type: String,
}

fn load_legacy_item_rows(conn: &Connection) -> TodoResult<Vec<LegacyItemRow>> {
    let mut statement = conn
        .prepare(
            r#"
            SELECT id, type, status, proposed_by, approved_by, approved_at, completed_at,
                   archived_at, last_materialized_at, created_at, updated_at
            FROM items
            "#,
        )
        .map_err(storage_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok(LegacyItemRow {
                id: row.get(0)?,
                item_type: row.get(1)?,
                status: row.get(2)?,
                proposed_by: row.get(3)?,
                approved_by: row.get(4)?,
                approved_at: row.get(5)?,
                completed_at: row.get(6)?,
                archived_at: row.get(7)?,
                last_materialized_at: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)?;
    Ok(rows)
}

fn load_legacy_event_rows(conn: &Connection) -> TodoResult<Vec<LegacyEventRow>> {
    let mut statement = conn
        .prepare("SELECT id, at, actor, object_type FROM events")
        .map_err(storage_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok(LegacyEventRow {
                id: row.get(0)?,
                at: row.get(1)?,
                actor: row.get(2)?,
                object_type: row.get(3)?,
            })
        })
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)?;
    Ok(rows)
}

fn normalize_legacy_item_row(row: &LegacyItemRow) -> TodoResult<NormalizedLegacyItemRow> {
    let item_type = normalize_item_type_value(&row.item_type)?;
    let status = normalize_status_value(&row.status)?;
    let proposed_by = normalize_actor_value(&row.proposed_by)?;
    let approved_by = row
        .approved_by
        .as_deref()
        .map(normalize_actor_value)
        .transpose()?;

    let approved_at = normalize_optional_time_string(row.approved_at.as_deref())?;
    let completed_at = normalize_optional_time_string(row.completed_at.as_deref())?;
    let archived_at = normalize_optional_time_string(row.archived_at.as_deref())?;
    let last_materialized_at = normalize_optional_time_string(row.last_materialized_at.as_deref())?;
    let created_at = normalize_time_string(&row.created_at)?;
    let updated_at = normalize_time_string(&row.updated_at)?;

    let timestamp_fields = [
        approved_at.changed,
        completed_at.changed,
        archived_at.changed,
        last_materialized_at.changed,
        created_at.changed,
        updated_at.changed,
    ]
    .into_iter()
    .filter(|changed| *changed)
    .count();

    let changed = item_type != row.item_type
        || status != row.status
        || proposed_by != row.proposed_by
        || approved_by != row.approved_by
        || approved_at.value != row.approved_at
        || completed_at.value != row.completed_at
        || archived_at.value != row.archived_at
        || last_materialized_at.value != row.last_materialized_at
        || created_at.value.as_deref() != Some(row.created_at.as_str())
        || updated_at.value.as_deref() != Some(row.updated_at.as_str());

    Ok(NormalizedLegacyItemRow {
        changed,
        timestamp_fields,
        item_type,
        status,
        proposed_by,
        approved_by,
        approved_at: approved_at.value,
        completed_at: completed_at.value,
        archived_at: archived_at.value,
        last_materialized_at: last_materialized_at.value,
        created_at: created_at.value.expect("created_at is required"),
        updated_at: updated_at.value.expect("updated_at is required"),
    })
}

fn normalize_legacy_event_row(row: &LegacyEventRow) -> TodoResult<NormalizedLegacyEventRow> {
    let at = normalize_time_string(&row.at)?;
    let actor = normalize_actor_value(&row.actor)?;
    let object_type = normalize_item_type_value(&row.object_type)?;
    let changed = at.value.as_deref() != Some(row.at.as_str())
        || actor != row.actor
        || object_type != row.object_type;

    Ok(NormalizedLegacyEventRow {
        changed,
        timestamp_fields: usize::from(at.changed),
        at: at.value.expect("event timestamp is required"),
        actor,
        object_type,
    })
}

struct NormalizedTimeValue {
    value: Option<String>,
    changed: bool,
}

fn normalize_item_type_value(value: &str) -> TodoResult<String> {
    normalize_enum_value(value, |candidate| ItemType::from_str(candidate).map(|_| ()))
}

fn normalize_status_value(value: &str) -> TodoResult<String> {
    normalize_enum_value(value, |candidate| {
        ItemStatus::from_str(candidate).map(|_| ())
    })
}

fn normalize_actor_value(value: &str) -> TodoResult<String> {
    normalize_enum_value(value, |candidate| Actor::from_str(candidate).map(|_| ()))
}

fn normalize_enum_value<T>(
    value: &str,
    validate: impl Fn(&str) -> Result<T, String>,
) -> TodoResult<String> {
    let trimmed = value.trim();
    if validate(trimmed).is_ok() {
        return Ok(trimmed.to_string());
    }
    let lowered = trimmed.to_ascii_lowercase();
    validate(&lowered).map_err(TodoError::Storage)?;
    Ok(lowered)
}

fn normalize_optional_time_string(value: Option<&str>) -> TodoResult<NormalizedTimeValue> {
    value
        .map(normalize_time_string)
        .transpose()
        .map(|normalized| match normalized {
            Some(value) => value,
            None => NormalizedTimeValue {
                value: None,
                changed: false,
            },
        })
}

fn normalize_time_string(value: &str) -> TodoResult<NormalizedTimeValue> {
    if parse_time(value).is_ok() {
        return Ok(NormalizedTimeValue {
            value: Some(value.to_string()),
            changed: false,
        });
    }

    let parsed = parse_legacy_time(value)?;
    Ok(NormalizedTimeValue {
        value: Some(format_time(parsed)?),
        changed: true,
    })
}

fn parse_legacy_time(value: &str) -> TodoResult<OffsetDateTime> {
    const LEGACY_WITH_SUBSECOND: &[time::format_description::FormatItem<'static>] =
        format_description!("[year]-[month]-[day] [hour]:[minute]:[second].[subsecond]");
    const LEGACY_WITHOUT_SUBSECOND: &[time::format_description::FormatItem<'static>] =
        format_description!("[year]-[month]-[day] [hour]:[minute]:[second]");

    PrimitiveDateTime::parse(value, LEGACY_WITH_SUBSECOND)
        .or_else(|_| PrimitiveDateTime::parse(value, LEGACY_WITHOUT_SUBSECOND))
        .map(|value| value.assume_utc())
        .map_err(|error| TodoError::Storage(error.to_string()))
}
