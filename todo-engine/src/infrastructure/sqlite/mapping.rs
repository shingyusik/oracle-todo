use crate::application::error::{TodoError, TodoResult};
use crate::domain::{Actor, ItemStatus, ItemType, TodoEvent, TodoItem};
use rusqlite::Row;
use rusqlite::types::FromSql;
use serde_json::{Map, Value};
use std::str::FromStr;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

pub(super) fn item_type_sqlite_value(item_type: ItemType) -> &'static str {
    item_type.as_str()
}

pub(super) fn status_sqlite_value(status: ItemStatus) -> &'static str {
    status.as_str()
}

pub(super) fn actor_sqlite_value(actor: Actor) -> &'static str {
    actor.as_str()
}

pub(super) fn item_select_sql(suffix: &str) -> String {
    format!(
        "SELECT id, type, title, status, area_id, project_id, routine_id, parent_id,
                description, note, outcome, definition_of_done, standard, review_cycle,
                recurrence_rule, materialization_policy, occurrence_key, priority, due,
                scheduled, horizon, proposed_by, approved_by, approved_at, completed_at,
                archived_at, last_materialized_at, second_brain_refs, metadata, created_at,
                updated_at
         FROM items
         {suffix}"
    )
}

pub(super) fn row_to_item(row: &Row<'_>) -> TodoResult<TodoItem> {
    let item_type: String = row_value(row, 1)?;
    let status: String = row_value(row, 3)?;
    let proposed_by: String = row_value(row, 21)?;
    let approved_by: Option<String> = row_value(row, 22)?;
    let approved_at: Option<String> = row_value(row, 23)?;
    let completed_at: Option<String> = row_value(row, 24)?;
    let archived_at: Option<String> = row_value(row, 25)?;
    let last_materialized_at: Option<String> = row_value(row, 26)?;
    let second_brain_refs: String = row_value(row, 27)?;
    let metadata: String = row_value(row, 28)?;
    let created_at: String = row_value(row, 29)?;
    let updated_at: String = row_value(row, 30)?;

    Ok(TodoItem {
        id: row_value(row, 0)?,
        item_type: parse_item_type(&item_type)?,
        title: row_value(row, 2)?,
        status: parse_status(&status)?,
        area_id: row_value(row, 4)?,
        project_id: row_value(row, 5)?,
        routine_id: row_value(row, 6)?,
        parent_id: row_value(row, 7)?,
        description: row_value(row, 8)?,
        note: row_value(row, 9)?,
        outcome: row_value(row, 10)?,
        definition_of_done: row_value(row, 11)?,
        standard: row_value(row, 12)?,
        review_cycle: row_value(row, 13)?,
        recurrence_rule: row_value(row, 14)?,
        materialization_policy: row_value(row, 15)?,
        occurrence_key: row_value(row, 16)?,
        priority: row_value(row, 17)?,
        due: row_value(row, 18)?,
        scheduled: row_value(row, 19)?,
        horizon: row_value(row, 20)?,
        proposed_by: parse_actor(&proposed_by)?,
        approved_by: parse_optional_actor(approved_by.as_deref())?,
        approved_at: parse_optional_time(approved_at.as_deref())?,
        completed_at: parse_optional_time(completed_at.as_deref())?,
        archived_at: parse_optional_time(archived_at.as_deref())?,
        last_materialized_at: parse_optional_time(last_materialized_at.as_deref())?,
        second_brain_refs: parse_json(&second_brain_refs)?,
        metadata: parse_json_object(&metadata)?,
        created_at: parse_time(&created_at)?,
        updated_at: parse_time(&updated_at)?,
    })
}

pub(super) fn row_to_event(row: &Row<'_>) -> TodoResult<TodoEvent> {
    let at: String = row_value(row, 1)?;
    let actor: String = row_value(row, 2)?;
    let before: Option<String> = row_value(row, 6)?;
    let after: Option<String> = row_value(row, 7)?;

    Ok(TodoEvent {
        id: row_value(row, 0)?,
        at: parse_time(&at)?,
        actor: parse_actor(&actor)?,
        action: row_value(row, 3)?,
        object_type: row_value(row, 4)?,
        object_id: row_value(row, 5)?,
        before: parse_optional_json(before.as_deref())?,
        after: parse_optional_json(after.as_deref())?,
        reason: row_value(row, 8)?,
    })
}

pub(super) fn row_value<T: FromSql>(row: &Row<'_>, index: usize) -> TodoResult<T> {
    row.get(index).map_err(storage_error)
}

pub(super) fn parse_item_type(value: &str) -> TodoResult<ItemType> {
    ItemType::from_str(value).map_err(TodoError::Storage)
}

pub(super) fn parse_status(value: &str) -> TodoResult<ItemStatus> {
    ItemStatus::from_str(value).map_err(TodoError::Storage)
}

pub(super) fn parse_actor(value: &str) -> TodoResult<Actor> {
    if value.trim() == "oracle" {
        return Ok(Actor::Agent);
    }

    Actor::from_str(value).map_err(TodoError::Storage)
}

pub(super) fn parse_optional_actor(value: Option<&str>) -> TodoResult<Option<Actor>> {
    value.map(parse_actor).transpose()
}

pub(super) fn parse_time(value: &str) -> TodoResult<OffsetDateTime> {
    OffsetDateTime::parse(value, &Rfc3339).map_err(|error| TodoError::Storage(error.to_string()))
}

pub(super) fn parse_optional_time(value: Option<&str>) -> TodoResult<Option<OffsetDateTime>> {
    value.map(parse_time).transpose()
}

pub(super) fn format_time(value: OffsetDateTime) -> TodoResult<String> {
    value
        .format(&Rfc3339)
        .map_err(|error| TodoError::Storage(error.to_string()))
}

pub(super) fn format_optional_time(value: Option<OffsetDateTime>) -> TodoResult<Option<String>> {
    value.map(format_time).transpose()
}

pub(super) fn parse_json(value: &str) -> TodoResult<Vec<Value>> {
    serde_json::from_str(value).map_err(|error| TodoError::Storage(error.to_string()))
}

pub(super) fn parse_json_object(value: &str) -> TodoResult<Map<String, Value>> {
    serde_json::from_str(value).map_err(|error| TodoError::Storage(error.to_string()))
}

pub(super) fn parse_optional_json(value: Option<&str>) -> TodoResult<Option<Value>> {
    value
        .map(serde_json::from_str)
        .transpose()
        .map_err(|error| TodoError::Storage(error.to_string()))
}

pub(super) fn storage_error(error: rusqlite::Error) -> TodoError {
    TodoError::Storage(error.to_string())
}
