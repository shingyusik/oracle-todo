use crate::application::error::{TodoError, TodoResult};
use crate::application::ports::{EventRepository, ListFilter, TodoRepository, TodoStore};
use crate::domain::{Actor, ItemStatus, ItemType, TodoEvent, TodoItem, hidden_by_default_status};
use rusqlite::types::FromSql;
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde_json::{Map, Value};
use std::str::FromStr;
use time::format_description::parse as parse_format_description;
use time::format_description::well_known::Rfc3339;
use time::{OffsetDateTime, PrimitiveDateTime};

pub fn connect(path: &str) -> TodoResult<Connection> {
    Connection::open(path).map_err(|error| TodoError::Storage(error.to_string()))
}

pub fn init_schema(conn: &Connection) -> TodoResult<()> {
    match init_schema_inner(conn) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(error)
        }
    }
}

fn init_schema_inner(conn: &Connection) -> TodoResult<()> {
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        BEGIN;

        CREATE TABLE IF NOT EXISTS items (
            id TEXT NOT NULL PRIMARY KEY,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL,
            area_id TEXT REFERENCES items(id),
            project_id TEXT REFERENCES items(id),
            routine_id TEXT REFERENCES items(id),
            parent_id TEXT REFERENCES items(id),
            description TEXT,
            outcome TEXT,
            definition_of_done TEXT,
            standard TEXT,
            review_cycle TEXT,
            recurrence_rule TEXT,
            materialization_policy TEXT NOT NULL DEFAULT 'single_open',
            occurrence_key TEXT,
            priority INTEGER,
            due TEXT,
            scheduled TEXT,
            horizon TEXT,
            proposed_by TEXT NOT NULL,
            approved_by TEXT,
            approved_at TEXT,
            completed_at TEXT,
            archived_at TEXT,
            last_materialized_at TEXT,
            second_brain_refs TEXT NOT NULL DEFAULT '[]',
            metadata TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS events (
            id TEXT NOT NULL PRIMARY KEY,
            at TEXT NOT NULL,
            actor TEXT NOT NULL,
            action TEXT NOT NULL,
            object_type TEXT NOT NULL,
            object_id TEXT NOT NULL,
            before TEXT,
            after TEXT,
            reason TEXT
        );
        "#,
    )
    .map_err(|error| TodoError::Migration(error.to_string()))?;

    ensure_item_columns(conn)?;

    conn.execute_batch(
        r#"
        CREATE INDEX IF NOT EXISTS idx_items_type ON items(type);
        CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
        CREATE INDEX IF NOT EXISTS idx_items_area_id ON items(area_id);
        CREATE INDEX IF NOT EXISTS idx_items_project_id ON items(project_id);
        CREATE INDEX IF NOT EXISTS idx_items_routine_id ON items(routine_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_items_routine_occurrence
            ON items(routine_id, occurrence_key)
            WHERE routine_id IS NOT NULL AND occurrence_key IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_events_at ON events(at);
        CREATE INDEX IF NOT EXISTS idx_events_object_id ON events(object_id);

        PRAGMA user_version = 1;
        COMMIT;
        "#,
    )
    .map_err(|error| TodoError::Migration(error.to_string()))
}

const ITEM_COLUMN_ADDITIONS: &[(&str, &str)] = &[
    ("area_id", "TEXT REFERENCES items(id)"),
    ("project_id", "TEXT REFERENCES items(id)"),
    ("routine_id", "TEXT REFERENCES items(id)"),
    ("parent_id", "TEXT REFERENCES items(id)"),
    ("description", "TEXT"),
    ("outcome", "TEXT"),
    ("definition_of_done", "TEXT"),
    ("standard", "TEXT"),
    ("review_cycle", "TEXT"),
    ("recurrence_rule", "TEXT"),
    (
        "materialization_policy",
        "TEXT NOT NULL DEFAULT 'single_open'",
    ),
    ("occurrence_key", "TEXT"),
    ("priority", "INTEGER"),
    ("due", "TEXT"),
    ("scheduled", "TEXT"),
    ("horizon", "TEXT"),
    ("proposed_by", "TEXT NOT NULL DEFAULT 'oracle'"),
    ("approved_by", "TEXT"),
    ("approved_at", "TEXT"),
    ("completed_at", "TEXT"),
    ("archived_at", "TEXT"),
    ("last_materialized_at", "TEXT"),
    ("second_brain_refs", "TEXT NOT NULL DEFAULT '[]'"),
    ("metadata", "TEXT NOT NULL DEFAULT '{}'"),
];

fn ensure_item_columns(conn: &Connection) -> TodoResult<()> {
    let mut statement = conn
        .prepare("PRAGMA table_info(items)")
        .map_err(storage_error)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(storage_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(storage_error)?;

    for (name, definition) in ITEM_COLUMN_ADDITIONS {
        if !columns.iter().any(|column| column == name) {
            conn.execute_batch(&format!(
                "ALTER TABLE items ADD COLUMN {name} {definition};"
            ))
            .map_err(|error| TodoError::Migration(error.to_string()))?;
        }
    }
    Ok(())
}

pub fn user_version(conn: &Connection) -> TodoResult<i64> {
    conn.pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|error| TodoError::Storage(error.to_string()))
}

pub struct SqliteTodoRepository {
    conn: Connection,
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

impl TodoRepository for SqliteTodoRepository {
    fn save_item(&mut self, item: &TodoItem) -> TodoResult<()> {
        save_item_on(&self.conn, item)
    }

    fn get_item(&mut self, id: &str) -> TodoResult<Option<TodoItem>> {
        let item = self
            .conn
            .query_row(item_select_sql("WHERE id = ?1").as_str(), [id], |row| {
                Ok(row_to_item(row))
            })
            .optional()
            .map_err(storage_error)?;
        item.transpose()
    }

    fn list_items(&mut self, filter: ListFilter) -> TodoResult<Vec<TodoItem>> {
        let mut statement = self
            .conn
            .prepare(item_select_sql("ORDER BY created_at, id").as_str())
            .map_err(storage_error)?;
        let mut rows = statement.query([]).map_err(storage_error)?;
        let mut items = Vec::new();
        while let Some(row) = rows.next().map_err(storage_error)? {
            items.push(row_to_item(row)?);
        }
        Ok(items
            .into_iter()
            .filter(|item| {
                filter.include_archived
                    || filter.status.is_some()
                    || !hidden_by_default_status(item.status)
            })
            .filter(|item| filter.status.is_none_or(|status| item.status == status))
            .filter(|item| {
                filter
                    .item_type
                    .is_none_or(|item_type| item.item_type == item_type)
            })
            .filter(|item| {
                filter
                    .area_id
                    .as_ref()
                    .is_none_or(|area_id| item.area_id.as_ref() == Some(area_id))
            })
            .filter(|item| {
                filter
                    .project_id
                    .as_ref()
                    .is_none_or(|project_id| item.project_id.as_ref() == Some(project_id))
            })
            .filter(|item| {
                filter
                    .routine_id
                    .as_ref()
                    .is_none_or(|routine_id| item.routine_id.as_ref() == Some(routine_id))
            })
            .filter(|item| {
                filter.query.as_ref().is_none_or(|query| {
                    item.title.contains(query)
                        || item
                            .description
                            .as_ref()
                            .is_some_and(|value| value.contains(query))
                        || item
                            .outcome
                            .as_ref()
                            .is_some_and(|value| value.contains(query))
                })
            })
            .collect())
    }
}

impl EventRepository for SqliteTodoRepository {
    fn save_event(&mut self, event: &TodoEvent) -> TodoResult<()> {
        save_event_on(&self.conn, event)
    }
}

impl TodoStore for SqliteTodoRepository {
    fn save_item_and_event(&mut self, item: &TodoItem, event: &TodoEvent) -> TodoResult<()> {
        let transaction = self.conn.transaction().map_err(storage_error)?;
        save_item_on(&transaction, item)?;
        save_event_on(&transaction, event)?;
        transaction.commit().map_err(storage_error)?;
        Ok(())
    }
}

fn save_item_on(conn: &Connection, item: &TodoItem) -> TodoResult<()> {
    conn.execute(
        r#"
                INSERT INTO items (
                    id, type, title, status, area_id, project_id, routine_id, parent_id,
                    description, outcome, definition_of_done, standard, review_cycle,
                    recurrence_rule, materialization_policy, occurrence_key, priority, due,
                    scheduled, horizon, proposed_by, approved_by, approved_at, completed_at,
                    archived_at, last_materialized_at, second_brain_refs, metadata, created_at,
                    updated_at
                )
                VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                    ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28,
                    ?29, ?30
                )
                ON CONFLICT(id) DO UPDATE SET
                    type = excluded.type,
                    title = excluded.title,
                    status = excluded.status,
                    area_id = excluded.area_id,
                    project_id = excluded.project_id,
                    routine_id = excluded.routine_id,
                    parent_id = excluded.parent_id,
                    description = excluded.description,
                    outcome = excluded.outcome,
                    definition_of_done = excluded.definition_of_done,
                    standard = excluded.standard,
                    review_cycle = excluded.review_cycle,
                    recurrence_rule = excluded.recurrence_rule,
                    materialization_policy = excluded.materialization_policy,
                    occurrence_key = excluded.occurrence_key,
                    priority = excluded.priority,
                    due = excluded.due,
                    scheduled = excluded.scheduled,
                    horizon = excluded.horizon,
                    proposed_by = excluded.proposed_by,
                    approved_by = excluded.approved_by,
                    approved_at = excluded.approved_at,
                    completed_at = excluded.completed_at,
                    archived_at = excluded.archived_at,
                    last_materialized_at = excluded.last_materialized_at,
                    second_brain_refs = excluded.second_brain_refs,
                    metadata = excluded.metadata,
                    updated_at = excluded.updated_at
                "#,
        params![
            item.id,
            item.item_type.as_str(),
            item.title,
            item.status.as_str(),
            item.area_id,
            item.project_id,
            item.routine_id,
            item.parent_id,
            item.description,
            item.outcome,
            item.definition_of_done,
            item.standard,
            item.review_cycle,
            item.recurrence_rule,
            item.materialization_policy,
            item.occurrence_key,
            item.priority,
            item.due,
            item.scheduled,
            item.horizon,
            item.proposed_by.as_str(),
            item.approved_by.map(Actor::as_str),
            format_optional_time(item.approved_at)?,
            format_optional_time(item.completed_at)?,
            format_optional_time(item.archived_at)?,
            format_optional_time(item.last_materialized_at)?,
            serde_json::to_string(&item.second_brain_refs)
                .map_err(|error| TodoError::Storage(error.to_string()))?,
            serde_json::to_string(&item.metadata)
                .map_err(|error| TodoError::Storage(error.to_string()))?,
            format_time(item.created_at)?,
            format_time(item.updated_at)?,
        ],
    )
    .map_err(storage_error)?;
    Ok(())
}

fn save_event_on(conn: &Connection, event: &TodoEvent) -> TodoResult<()> {
    conn.execute(
        r#"
                INSERT INTO events (
                    id, at, actor, action, object_type, object_id, before, after, reason
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                "#,
        params![
            event.id,
            format_time(event.at)?,
            event.actor.as_str(),
            event.action,
            event.object_type,
            event.object_id,
            event
                .before
                .as_ref()
                .map(serde_json::to_string)
                .transpose()
                .map_err(|error| TodoError::Storage(error.to_string()))?,
            event
                .after
                .as_ref()
                .map(serde_json::to_string)
                .transpose()
                .map_err(|error| TodoError::Storage(error.to_string()))?,
            event.reason,
        ],
    )
    .map_err(storage_error)?;
    Ok(())
}

fn item_select_sql(suffix: &str) -> String {
    format!(
        "SELECT id, type, title, status, area_id, project_id, routine_id, parent_id,
                description, outcome, definition_of_done, standard, review_cycle,
                recurrence_rule, materialization_policy, occurrence_key, priority, due,
                scheduled, horizon, proposed_by, approved_by, approved_at, completed_at,
                archived_at, last_materialized_at, second_brain_refs, metadata, created_at,
                updated_at
         FROM items
         {suffix}"
    )
}

fn row_to_item(row: &Row<'_>) -> TodoResult<TodoItem> {
    let item_type: String = row_value(row, 1)?;
    let status: String = row_value(row, 3)?;
    let proposed_by: String = row_value(row, 20)?;
    let approved_by: Option<String> = row_value(row, 21)?;
    let approved_at: Option<String> = row_value(row, 22)?;
    let completed_at: Option<String> = row_value(row, 23)?;
    let archived_at: Option<String> = row_value(row, 24)?;
    let last_materialized_at: Option<String> = row_value(row, 25)?;
    let second_brain_refs: String = row_value(row, 26)?;
    let metadata: String = row_value(row, 27)?;
    let created_at: String = row_value(row, 28)?;
    let updated_at: String = row_value(row, 29)?;

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
        outcome: row_value(row, 9)?,
        definition_of_done: row_value(row, 10)?,
        standard: row_value(row, 11)?,
        review_cycle: row_value(row, 12)?,
        recurrence_rule: row_value(row, 13)?,
        materialization_policy: row_value(row, 14)?,
        occurrence_key: row_value(row, 15)?,
        priority: row_value(row, 16)?,
        due: row_value(row, 17)?,
        scheduled: row_value(row, 18)?,
        horizon: row_value(row, 19)?,
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

fn row_to_event(row: &Row<'_>) -> TodoResult<TodoEvent> {
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

fn row_value<T: FromSql>(row: &Row<'_>, index: usize) -> TodoResult<T> {
    row.get(index).map_err(storage_error)
}

fn parse_item_type(value: &str) -> TodoResult<ItemType> {
    match value {
        "area" => Ok(ItemType::Area),
        "project" => Ok(ItemType::Project),
        "routine" => Ok(ItemType::Routine),
        "task" => Ok(ItemType::Task),
        "event" => Ok(ItemType::Event),
        "review" => Ok(ItemType::Review),
        "archive_item" => Ok(ItemType::ArchiveItem),
        _ => Err(TodoError::Storage(format!("unknown item type: {value}"))),
    }
}

fn parse_status(value: &str) -> TodoResult<ItemStatus> {
    match value {
        "proposed" => Ok(ItemStatus::Proposed),
        "approved" => Ok(ItemStatus::Approved),
        "active" => Ok(ItemStatus::Active),
        "waiting" => Ok(ItemStatus::Waiting),
        "paused" => Ok(ItemStatus::Paused),
        "completed" => Ok(ItemStatus::Completed),
        "cancelled" => Ok(ItemStatus::Cancelled),
        "dropped" => Ok(ItemStatus::Dropped),
        "archived" => Ok(ItemStatus::Archived),
        "someday" => Ok(ItemStatus::Someday),
        "rejected" => Ok(ItemStatus::Rejected),
        _ => Err(TodoError::Storage(format!("unknown status: {value}"))),
    }
}

fn parse_actor(value: &str) -> TodoResult<Actor> {
    Actor::from_str(value).map_err(TodoError::Storage)
}

fn parse_optional_actor(value: Option<&str>) -> TodoResult<Option<Actor>> {
    value.map(parse_actor).transpose()
}

fn parse_time(value: &str) -> TodoResult<OffsetDateTime> {
    OffsetDateTime::parse(value, &Rfc3339)
        .or_else(|_| {
            let format = parse_format_description(
                "[year]-[month]-[day] [hour]:[minute]:[second].[subsecond]",
            )
            .map_err(|error| TodoError::Storage(error.to_string()))?;
            PrimitiveDateTime::parse(value, &format)
                .map(PrimitiveDateTime::assume_utc)
                .map_err(|error| TodoError::Storage(error.to_string()))
        })
        .map_err(|error| TodoError::Storage(error.to_string()))
}

fn parse_optional_time(value: Option<&str>) -> TodoResult<Option<OffsetDateTime>> {
    value.map(parse_time).transpose()
}

fn format_time(value: OffsetDateTime) -> TodoResult<String> {
    value
        .format(&Rfc3339)
        .map_err(|error| TodoError::Storage(error.to_string()))
}

fn format_optional_time(value: Option<OffsetDateTime>) -> TodoResult<Option<String>> {
    value.map(format_time).transpose()
}

fn parse_json(value: &str) -> TodoResult<Vec<Value>> {
    serde_json::from_str(value).map_err(|error| TodoError::Storage(error.to_string()))
}

fn parse_json_object(value: &str) -> TodoResult<Map<String, Value>> {
    serde_json::from_str(value).map_err(|error| TodoError::Storage(error.to_string()))
}

fn parse_optional_json(value: Option<&str>) -> TodoResult<Option<Value>> {
    value
        .map(serde_json::from_str)
        .transpose()
        .map_err(|error| TodoError::Storage(error.to_string()))
}

fn storage_error(error: rusqlite::Error) -> TodoError {
    TodoError::Storage(error.to_string())
}
