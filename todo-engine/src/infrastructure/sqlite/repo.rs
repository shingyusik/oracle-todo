use super::SqliteTodoRepository;
use super::mapping::{
    actor_sqlite_value, format_optional_time, format_time, item_select_sql, item_type_sqlite_value,
    row_to_item, status_sqlite_value, storage_error,
};
use crate::application::error::{TodoError, TodoResult};
use crate::application::ports::{
    EventRepository, ItemPageQuery, ItemPageScope, ListFilter, TodoRepository, TodoStore,
    apply_list_filter,
};
use crate::domain::{TodoEvent, TodoItem};
use rusqlite::{Connection, OptionalExtension, params};

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
        Ok(apply_list_filter(items, filter))
    }

    fn list_items_page(&mut self, query: &ItemPageQuery) -> TodoResult<Vec<TodoItem>> {
        use rusqlite::types::Value;
        let filter = &query.filter;
        let mut clauses = Vec::new();
        let mut values = Vec::<Value>::new();
        if !filter.include_archived && filter.status.is_none() {
            clauses.push("status NOT IN ('archived', 'dropped', 'cancelled')".to_string());
        }
        for (column, value) in [
            (
                "status",
                filter.status.map(|value| value.as_str().to_string()),
            ),
            (
                "type",
                filter.item_type.map(|value| value.as_str().to_string()),
            ),
            ("area_id", filter.area_id.clone()),
            ("project_id", filter.project_id.clone()),
            ("parent_id", filter.parent_id.clone()),
            ("routine_id", filter.routine_id.clone()),
            ("horizon", filter.horizon.clone()),
            ("scheduled", filter.scheduled.clone()),
        ] {
            if let Some(value) = value {
                values.push(Value::Text(value));
                clauses.push(format!("{column} = ?{}", values.len()));
            }
        }
        if let Some(text) = &filter.query {
            values.push(Value::Text(crate::application::table::unicode_fold(text)));
            let index = values.len();
            clauses.push(format!("(instr(todo_fold(title), ?{index}) > 0 OR instr(todo_fold(note), ?{index}) > 0 OR instr(todo_fold(description), ?{index}) > 0 OR instr(todo_fold(outcome), ?{index}) > 0)"));
        }
        match query.scope {
            ItemPageScope::List => {}
            ItemPageScope::Archive => clauses.push(
                "status IN ('completed', 'cancelled', 'dropped', 'archived', 'missed', 'rejected')"
                    .into(),
            ),
            ItemPageScope::Today(today) => {
                values.push(Value::Integer(i64::from(today.to_julian_day())));
                clauses.push(format!("type = 'task' AND status = 'active' AND (scheduled IS NULL OR scheduled = 'today' OR todo_date_ordinal(scheduled) <= ?{})", values.len()));
            }
        }
        values.push(Value::Integer(i64::from(query.limit) + 1));
        let limit_index = values.len();
        values.push(Value::Integer(i64::from(query.offset)));
        let predicate = if clauses.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", clauses.join(" AND "))
        };
        let sql = item_select_sql(&format!(
            "{predicate} ORDER BY created_at, id LIMIT ?{limit_index} OFFSET ?{}",
            values.len()
        ));
        let mut statement = self.conn.prepare(&sql).map_err(storage_error)?;
        let mut rows = statement
            .query(rusqlite::params_from_iter(values))
            .map_err(storage_error)?;
        let mut items = Vec::new();
        while let Some(row) = rows.next().map_err(storage_error)? {
            items.push(row_to_item(row)?);
        }
        Ok(items)
    }
}

impl EventRepository for SqliteTodoRepository {
    fn save_event(&mut self, event: &TodoEvent) -> TodoResult<()> {
        save_event_on(&self.conn, event)
    }
}

impl TodoStore for SqliteTodoRepository {
    fn item_history(
        &mut self,
        item_id: &str,
        offset: u32,
        limit: u32,
    ) -> TodoResult<Vec<TodoEvent>> {
        let mut statement = self.conn.prepare("SELECT id, at, actor, action, object_type, object_id, before, after, reason FROM events WHERE object_id = ?1 ORDER BY at DESC, id DESC LIMIT ?2 OFFSET ?3").map_err(storage_error)?;
        let mut rows = statement
            .query(rusqlite::params![item_id, limit, offset])
            .map_err(storage_error)?;
        let mut events = Vec::new();
        while let Some(row) = rows.next().map_err(storage_error)? {
            events.push(super::mapping::row_to_event(row)?);
        }
        Ok(events)
    }
    fn query_table(
        &mut self,
        query: &crate::application::table::TodoTableQuery,
    ) -> TodoResult<crate::application::table::TablePage<crate::application::table::TodoTableRow>>
    {
        self.query_table_page(query)
    }

    fn table_lookups(
        &mut self,
        scope: crate::application::table::TodoTableScope,
    ) -> TodoResult<Vec<crate::application::table::TodoTableLookup>> {
        self.read_table_lookups(scope)
    }

    fn save_item_and_event(&mut self, item: &TodoItem, event: &TodoEvent) -> TodoResult<()> {
        let transaction = self.conn.transaction().map_err(storage_error)?;
        save_item_on(&transaction, item)?;
        save_event_on(&transaction, event)?;
        transaction.commit().map_err(storage_error)?;
        Ok(())
    }

    fn save_item_and_event_if_current(
        &mut self,
        item: &TodoItem,
        event: &TodoEvent,
        expected_updated_at: time::OffsetDateTime,
    ) -> TodoResult<()> {
        let transaction = self
            .conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(storage_error)?;
        let current = transaction
            .query_row(
                item_select_sql("WHERE id = ?1").as_str(),
                [&item.id],
                |row| Ok(row_to_item(row)),
            )
            .optional()
            .map_err(storage_error)?
            .transpose()?
            .ok_or_else(|| TodoError::NotFound(item.id.clone()))?;
        if current.updated_at != expected_updated_at {
            return Err(TodoError::Conflict(
                "Item changed since it was read".to_string(),
            ));
        }
        save_item_on(&transaction, item)?;
        save_event_on(&transaction, event)?;
        transaction.commit().map_err(storage_error)
    }

    fn save_items_and_events(&mut self, writes: &[(TodoItem, TodoEvent)]) -> TodoResult<()> {
        let transaction = self.conn.transaction().map_err(storage_error)?;
        for (item, event) in writes {
            save_item_on(&transaction, item)?;
            save_event_on(&transaction, event)?;
        }
        transaction.commit().map_err(storage_error)
    }
}

fn save_item_on(conn: &Connection, item: &TodoItem) -> TodoResult<()> {
    conn.execute(
        r#"
                INSERT INTO items (
                    id, type, title, status, area_id, project_id, routine_id, parent_id,
                    description, note, outcome, definition_of_done, standard, review_cycle,
                    recurrence_rule, materialization_policy, future_occurrences, occurrence_key, priority, due,
                    scheduled, horizon, proposed_by, approved_by, approved_at, completed_at,
                    archived_at, last_materialized_at, second_brain_refs, tags, metadata,
                    created_at, updated_at
                )
                VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                    ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28,
                    ?29, ?30, ?31, ?32, ?33
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
                    note = excluded.note,
                    outcome = excluded.outcome,
                    definition_of_done = excluded.definition_of_done,
                    standard = excluded.standard,
                    review_cycle = excluded.review_cycle,
                    recurrence_rule = excluded.recurrence_rule,
                    materialization_policy = excluded.materialization_policy,
                    future_occurrences = excluded.future_occurrences,
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
                    tags = excluded.tags,
                    metadata = excluded.metadata,
                    updated_at = excluded.updated_at
                "#,
        params![
            item.id,
            item_type_sqlite_value(item.item_type),
            item.title,
            status_sqlite_value(item.status),
            item.area_id,
            item.project_id,
            item.routine_id,
            item.parent_id,
            item.description,
            item.note,
            item.outcome,
            item.definition_of_done,
            item.standard,
            item.review_cycle,
            item.recurrence_rule,
            item.materialization_policy,
            item.future_occurrences,
            item.occurrence_key,
            item.priority,
            item.due,
            item.scheduled,
            item.horizon,
            actor_sqlite_value(item.proposed_by),
            item.approved_by.map(actor_sqlite_value),
            format_optional_time(item.approved_at)?,
            format_optional_time(item.completed_at)?,
            format_optional_time(item.archived_at)?,
            format_optional_time(item.last_materialized_at)?,
            serde_json::to_string(&item.second_brain_refs)
                .map_err(|error| TodoError::Storage(error.to_string()))?,
            serde_json::to_string(&item.tags)
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
            actor_sqlite_value(event.actor),
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
