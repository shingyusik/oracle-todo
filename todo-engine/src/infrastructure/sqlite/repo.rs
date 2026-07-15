use super::SqliteTodoRepository;
use super::mapping::{
    actor_sqlite_value, format_optional_time, format_time, item_select_sql, item_type_sqlite_value,
    row_to_item, status_sqlite_value, storage_error,
};
use crate::application::error::{TodoError, TodoResult};
use crate::application::ports::{
    EventRepository, ListFilter, TodoRepository, TodoStore, apply_list_filter,
};
use crate::domain::{OPEN_STATUSES, TodoEvent, TodoItem};
use rusqlite::types::ToSql;
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

    /// D-10 indexed working-set loader for `period_view`. One `WITH RECURSIVE`
    /// CTE walks `parent_id` downward from the period's root goals — exercising
    /// `idx_items_type_horizon_scheduled` (seed) and `idx_items_parent_id`
    /// (recursive step) instead of the `list_items` full-table scan. A
    /// deduplicating `UNION` (never the appending variant) collapses the
    /// reachable id set, which is the SQL-level cycle guard for any legacy
    /// `parent_id` back-edges (T-04-05).
    ///
    /// D-01 goal-parent descent: the recursive step joins back to the parent row
    /// and keeps only children whose parent is a goal, so this loader produces
    /// the SAME flat working set as the InMemory frontier walk (goal->goal only)
    /// — the two stores cannot drift even on adversarial `goal -> task -> goal`
    /// linkage (a goal under a task is unreachable in both). This makes D-11 true
    /// by construction in SQL, not by an `assemble` implementation detail.
    ///
    /// D-07 visibility parity (CRITICAL): the task-status predicate is GENERATED
    /// from the single [`OPEN_STATUSES`] source of truth shared with the
    /// InMemory loader — never a hand-typed status literal list — so the two
    /// stores cannot drift. The predicate is ASYMMETRIC: GOAL rows are kept at
    /// ANY status (terminal goals stay in the structure AND are traversed so a
    /// live grandchild can outlive a terminal parent, ADR-0006), while TASK rows
    /// are restricted to the open statuses. Tasks are NOT filtered by
    /// `scheduled` — unscheduled tasks must survive (VIEW-04).
    ///
    /// All inputs are bound as parameters (`?N`); nothing is `format!`-ed into
    /// the SQL (V5.3 / T-04-04). The `IN (...)` placeholder list is built from
    /// the COUNT of open statuses, and the status strings are appended to the
    /// bound params — still no value interpolation.
    fn load_period_subtree(
        &mut self,
        horizon: &str,
        period_key: &str,
    ) -> TodoResult<Vec<TodoItem>> {
        // Placeholder list `?3, ?4, ...` for the open-status allowlist, generated
        // from OPEN_STATUSES so the predicate stays byte-equivalent to the
        // InMemory loader. ?1 = horizon, ?2 = period_key, then the statuses.
        let status_placeholders = (0..OPEN_STATUSES.len())
            .map(|offset| format!("?{}", offset + 3))
            .collect::<Vec<_>>()
            .join(", ");

        // The seed selects root goals at (horizon, period_key); the recursive
        // step pulls in any goal/task whose parent is already reachable. The
        // outer WHERE then applies the asymmetric D-07 status predicate: goals
        // at any status, tasks open-only.
        let suffix = format!(
            "WHERE id IN (
                 WITH RECURSIVE subtree(id) AS (
                     SELECT id FROM items
                     WHERE type = 'goal' AND horizon = ?1 AND scheduled = ?2
                     UNION
                     SELECT i.id FROM items i
                     JOIN subtree s ON i.parent_id = s.id
                     -- D-11: only descend through goal parents so the CTE working set
                     -- matches the InMemory frontier (goal->goal only). A goal whose
                     -- parent is a task is unreachable in both stores.
                     JOIN items p ON s.id = p.id AND p.type = 'goal'
                     WHERE i.type IN ('goal', 'task')
                 )
                 SELECT id FROM subtree
             )
             AND (type = 'goal' OR (type = 'task' AND status IN ({status_placeholders})))"
        );

        // Bind order matches the placeholders: horizon, period_key, then the
        // open-status strings. No value is ever interpolated into the SQL text.
        let mut params: Vec<&dyn ToSql> = vec![&horizon, &period_key];
        let status_values: Vec<&'static str> =
            OPEN_STATUSES.iter().map(|status| status.as_str()).collect();
        for status in &status_values {
            params.push(status);
        }

        let mut statement = self
            .conn
            .prepare(item_select_sql(&suffix).as_str())
            .map_err(storage_error)?;
        let mut rows = statement.query(params.as_slice()).map_err(storage_error)?;
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
