use std::fmt::Write as _;

use rusqlite::OptionalExtension;
use rusqlite::params_from_iter;
use rusqlite::types::Value;
use time::Date;

use super::SqliteTodoRepository;
use super::mapping::{row_to_item, storage_error};
use crate::application::error::{TodoError, TodoResult};
use crate::application::service::table::{build_lookups, lookup_item_types};
use crate::application::table::*;
use crate::domain::ItemType;

impl SqliteTodoRepository {
    pub(super) fn query_table_page(
        &mut self,
        query: &TodoTableQuery,
    ) -> TodoResult<TablePage<TodoTableRow>> {
        let (sql, params) = table_sql(query)?;
        let mut statement = self.conn.prepare(&sql).map_err(storage_error)?;
        let mut rows = statement
            .query(params_from_iter(params.iter()))
            .map_err(storage_error)?;
        let mut result = Vec::with_capacity(usize::from(query.limit()));
        let mut has_more = false;
        while let Some(row) = rows.next().map_err(storage_error)? {
            // The LIMIT+1 sentinel proves another page exists, but its detail payload is
            // deliberately never read or materialized.
            if result.len() == usize::from(query.limit()) {
                has_more = true;
                break;
            }
            let item = row_to_item(row)?;
            let raw_key: Option<String> = row.get(33).map_err(storage_error)?;
            let label: Option<String> = row.get(34).map_err(storage_error)?;
            result.push(TodoTableRow::new(
                raw_key,
                label,
                TodoTableRecord::new(item)?,
            )?);
        }
        Ok(TablePage {
            items: result,
            next_offset: has_more.then(|| query.offset() + u32::from(query.limit())),
        })
    }

    pub(super) fn read_table_lookups(
        &mut self,
        scope: TodoTableScope,
    ) -> TodoResult<Vec<TodoTableLookup>> {
        // Lookups intentionally select only compact columns. No note/body/metadata is read.
        let invalid_type = self
            .conn
            .query_row(
                "SELECT type FROM items WHERE type NOT IN ('area','project','goal','routine','task','event','review','archive_item') LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(storage_error)?;
        if invalid_type.is_some() {
            return Err(TodoError::Storage(
                "invalid item type in table lookup".into(),
            ));
        }
        let sql = format!(
            "SELECT id, type, title, tags FROM items WHERE status NOT IN ('completed','cancelled','dropped','archived','missed','rejected') AND type IN ({}) ORDER BY type, todo_sort_key(title), title, id",
            lookup_type_sql(scope)
        );
        let mut statement = self.conn.prepare(&sql).map_err(storage_error)?;
        let values = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(storage_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(storage_error)?;
        let items = values
            .into_iter()
            .map(|(id, kind, title, tags)| -> TodoResult<_> {
                let item_type = kind
                    .parse::<ItemType>()
                    .map_err(|_| TodoError::Storage("invalid item type in table lookup".into()))?;
                let mut item = crate::domain::TodoItem::new(
                    id,
                    item_type,
                    title,
                    crate::domain::Actor::System,
                    time::OffsetDateTime::UNIX_EPOCH,
                );
                item.tags = serde_json::from_str(&tags)
                    .map_err(|_| TodoError::Storage("invalid tags in table lookup".into()))?;
                Ok(item)
            })
            .collect::<TodoResult<Vec<_>>>()?;
        Ok(build_lookups(items.iter(), scope))
    }
}

fn lookup_type_sql(scope: TodoTableScope) -> String {
    lookup_item_types(scope)
        .iter()
        .map(|item_type| format!("'{}'", item_type.as_str()))
        .collect::<Vec<_>>()
        .join(",")
}

fn table_sql(query: &TodoTableQuery) -> TodoResult<(String, Vec<Value>)> {
    let mut params = Vec::new();
    let mut predicates = Vec::new();
    context_predicates(query, &mut predicates, &mut params);
    if !query.filters().is_empty() {
        let rules = query
            .filters()
            .iter()
            .map(|filter| filter_predicate(filter, query.reference_date(), &mut params))
            .collect::<TodoResult<Vec<_>>>()?;
        predicates.push(format!(
            "({})",
            rules.join(match query.filter_mode() {
                FilterMode::And => " AND ",
                FilterMode::Or => " OR ",
            })
        ));
    }

    let (join, raw_group, group_label) = group_projection(query.group_settings().group_by());
    let canonical_group = raw_group;
    if let Some(group) = &canonical_group {
        for hidden in query.group_settings().hidden_group_keys() {
            predicates.push(format!("{group} <> ?"));
            params.push(Value::Text(hidden.clone()));
        }
    }

    let mut item_order = Vec::new();
    for sort in query.sorts() {
        let (field, direction) = sort_sql(*sort);
        let sql_direction = if direction == SortDirection::Asc {
            "ASC"
        } else {
            "DESC"
        };
        if field == "i.priority" {
            item_order.push(format!("({field}) IS NULL {sql_direction}"));
            item_order.push(format!("{field} {sql_direction}"));
        } else if field.starts_with("todo_date_ordinal") {
            item_order.push(format!("({field}) IS NOT NULL {sql_direction}"));
            item_order.push(format!("{field} {sql_direction}"));
        } else {
            item_order.push(format!(
                "todo_sort_key(coalesce(CAST({field} AS TEXT),'')) {sql_direction}"
            ));
            item_order.push(format!(
                "coalesce(CAST({field} AS TEXT),'') {sql_direction}"
            ));
        }
    }
    if query.sorts().is_empty() {
        match query.scope() {
            TodoTableScope::Planner(
                PlannerTableScope::DailyToday
                | PlannerTableScope::DailyOverdue
                | PlannerTableScope::DailyUnscheduled,
            ) => {
                item_order.extend(["i.priority IS NULL ASC".into(), "i.priority ASC".into()]);
            }
            TodoTableScope::Planner(_) => {
                item_order.push("todo_date_ordinal(i.scheduled) ASC".into());
            }
            _ => item_order.push("i.updated_at DESC".into()),
        }
    }
    item_order.extend([
        "todo_date_ordinal(i.scheduled) ASC".into(),
        "i.updated_at DESC".into(),
        "todo_sort_key(i.title) ASC".into(),
        "i.title ASC".into(),
    ]);
    item_order.push("i.id ASC".into());

    let selected = "i.id, i.type, i.title, i.status, i.area_id, i.project_id, i.routine_id, i.parent_id,
        i.description, i.note, i.outcome, i.definition_of_done, i.standard, i.review_cycle,
        i.recurrence_rule, i.materialization_policy, i.future_occurrences, i.occurrence_key, i.priority, i.due,
        i.scheduled, i.horizon, i.proposed_by, i.approved_by, i.approved_at, i.completed_at,
        i.archived_at, i.last_materialized_at, i.second_brain_refs, i.tags, i.metadata,
        i.created_at, i.updated_at";
    let key_sql = canonical_group.unwrap_or_else(|| "NULL".into());
    let label_sql = group_label.unwrap_or_else(|| "NULL".into());
    let sql = if key_sql == "NULL" {
        format!(
            "SELECT {selected}, NULL AS group_key, NULL AS group_label FROM items i {join} WHERE {} ORDER BY {} LIMIT ? OFFSET ?",
            predicates.join(" AND "),
            item_order.join(", ")
        )
    } else {
        let mut group_order = Vec::new();
        match query.group_settings().sort() {
            GroupSort::Manual => {
                if !query.group_settings().manual_order().is_empty() {
                    let mut rank = "CASE i.group_key".to_string();
                    for (index, key) in query.group_settings().manual_order().iter().enumerate() {
                        write!(rank, " WHEN ? THEN {index}")
                            .expect("writing to String cannot fail");
                        params.push(Value::Text(key.clone()));
                    }
                    rank.push_str(" ELSE 1000000 END ASC");
                    group_order.push(rank);
                }
                group_order.extend(manual_group_base_order(query.group_settings().group_by()));
            }
            GroupSort::Alphabetical => {
                group_order.extend([
                    "todo_sort_key(i.group_label) ASC".into(),
                    "i.group_label ASC".into(),
                ]);
            }
            GroupSort::ReverseAlphabetical => {
                group_order.extend([
                    "todo_sort_key(i.group_label) DESC".into(),
                    "i.group_label DESC".into(),
                ]);
            }
        }
        group_order.push("i.group_key ASC".into());
        group_order.extend(item_order.iter().cloned());
        format!(
            "WITH occurrences AS (SELECT {selected}, {key_sql} AS group_key, {label_sql} AS group_label FROM items i {join} WHERE {}) SELECT {selected}, i.group_key, i.group_label FROM occurrences i ORDER BY {} LIMIT ? OFFSET ?",
            predicates.join(" AND "),
            group_order.join(", ")
        )
    };
    params.push(Value::Integer(i64::from(query.limit()) + 1));
    params.push(Value::Integer(i64::from(query.offset())));
    Ok((sql, params))
}

fn manual_group_base_order(group: TodoTableGroup) -> Vec<String> {
    match group {
        TodoTableGroup::Workspace(WorkspaceTableGroup::Tag)
        | TodoTableGroup::Planner(PlannerTableGroup::Tag) => vec![
            "CASE WHEN i.group_key = 'untagged' THEN 1 ELSE 0 END ASC".into(),
            "todo_sort_key(i.group_label) ASC".into(),
            "i.group_label ASC".into(),
        ],
        TodoTableGroup::Workspace(WorkspaceTableGroup::Status)
        | TodoTableGroup::Planner(PlannerTableGroup::Status) => vec![
            "CASE i.group_key WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'completed' THEN 2 WHEN 'missed' THEN 3 WHEN 'waiting' THEN 4 WHEN 'rejected' THEN 5 ELSE 6 END ASC".into(),
        ],
        TodoTableGroup::Planner(PlannerTableGroup::ItemType) => vec![
            "CASE i.group_key WHEN 'task' THEN 0 WHEN 'event' THEN 1 WHEN 'routine' THEN 2 ELSE 3 END ASC".into(),
        ],
        TodoTableGroup::Planner(PlannerTableGroup::Month)
        | TodoTableGroup::Planner(PlannerTableGroup::Week)
        | TodoTableGroup::Planner(PlannerTableGroup::Day) => vec![
            "CASE WHEN i.group_key = 'none' THEN 1 ELSE 0 END ASC".into(),
            "i.group_key ASC".into(),
        ],
        TodoTableGroup::Workspace(WorkspaceTableGroup::Area)
        | TodoTableGroup::Workspace(WorkspaceTableGroup::Project)
        | TodoTableGroup::Workspace(WorkspaceTableGroup::Routine)
        | TodoTableGroup::Planner(PlannerTableGroup::Area)
        | TodoTableGroup::Planner(PlannerTableGroup::Project)
        | TodoTableGroup::Planner(PlannerTableGroup::Routine) => {
            vec![
                "CASE WHEN i.group_key = 'none' THEN 1 ELSE 0 END ASC".into(),
                "todo_sort_key(i.group_label) ASC".into(),
                "i.group_label ASC".into(),
                "i.group_key ASC".into(),
            ]
        }
        TodoTableGroup::Workspace(WorkspaceTableGroup::None)
        | TodoTableGroup::Planner(PlannerTableGroup::None) => Vec::new(),
    }
}

fn context_predicates(query: &TodoTableQuery, out: &mut Vec<String>, params: &mut Vec<Value>) {
    match (query.scope(), query.context()) {
        (TodoTableScope::Workspace(scope), TableContext::Workspace) => {
            out.push("i.type = ?".into());
            params.push(Value::Text(scope.item_type().as_str().into()));
            out.push("i.status NOT IN ('archived','dropped','cancelled')".into());
        }
        (TodoTableScope::Linked { parent, child }, TableContext::Linked { parent_id, .. }) => {
            out.push("i.type = ?".into());
            params.push(Value::Text(child.as_str().into()));
            out.push(format!(
                "i.{} = ?",
                match parent {
                    ItemType::Area => "area_id",
                    ItemType::Project => "project_id",
                    ItemType::Routine => "routine_id",
                    ItemType::Goal => "parent_id",
                    _ => "id",
                }
            ));
            params.push(Value::Text(parent_id.clone()));
            out.push("i.status NOT IN ('archived','dropped','cancelled')".into());
        }
        (TodoTableScope::Planner(scope), TableContext::Planner { from, to })
            if scope.is_goal_table() =>
        {
            out.extend(["i.type = 'goal'".into(), "i.status NOT IN ('completed','missed','archived','dropped','cancelled','rejected')".into()]);
            out.push("i.horizon = ?".into());
            params.push(Value::Text(
                match scope {
                    PlannerTableScope::YearlyPeriodGoals => "year",
                    PlannerTableScope::YearlyMonthGoals
                    | PlannerTableScope::MonthlyPeriodGoals
                    | PlannerTableScope::WeeklyMonthGoals => "month",
                    _ => "week",
                }
                .into(),
            ));
            date_range(out, params, *from, *to);
        }
        (TodoTableScope::Planner(scope), TableContext::Planner { from, to }) => {
            out.extend([
                "i.type IN ('task','event')".into(),
                "i.status NOT IN ('archived','dropped','cancelled','rejected')".into(),
            ]);
            match scope {
                PlannerTableScope::DailyOverdue => {
                    out.push("todo_date_ordinal(i.scheduled) < todo_date_ordinal(?)".into());
                    params.push(Value::Text(iso(*from)));
                }
                PlannerTableScope::DailyUnscheduled => {
                    out.push("(todo_date_ordinal(i.scheduled) IS NULL)".into())
                }
                _ => date_range(out, params, *from, *to),
            }
        }
        _ => out.push("0".into()),
    }
}

fn date_range(out: &mut Vec<String>, params: &mut Vec<Value>, from: Date, to: Date) {
    out.push(
        "todo_date_ordinal(i.scheduled) BETWEEN todo_date_ordinal(?) AND todo_date_ordinal(?)"
            .into(),
    );
    params.extend([Value::Text(iso(from)), Value::Text(iso(to))]);
}

fn iso(date: Date) -> String {
    date.format(time::macros::format_description!("[year]-[month]-[day]"))
        .expect("valid date")
}

fn filter_predicate(
    filter: &TodoTableFilter,
    reference: Option<Date>,
    params: &mut Vec<Value>,
) -> TodoResult<String> {
    let (field, operator, value) = match filter {
        TodoTableFilter::Workspace {
            field,
            operator,
            value,
        } => (workspace_filter_sql(*field), *operator, value),
        TodoTableFilter::Planner {
            field,
            operator,
            value,
        } => (planner_filter_sql(*field), *operator, value),
    };
    let relation_column = match field {
        "i.area_id" => Some("area_id"),
        "i.project_id" => Some("project_id"),
        "i.routine_id" => Some("routine_id"),
        "i.parent_id" => Some("parent_id"),
        _ => None,
    };
    let is_many = field == "i.tags" || field.contains("participants") || relation_column.is_some();
    let match_field = relation_column.map_or_else(|| field.to_string(), |column| format!("json_array(i.{column},(SELECT title FROM items relation_label WHERE relation_label.id=i.{column}))"));
    let is_date = matches!(field, "i.due" | "i.scheduled");
    let is_text = !is_many
        && !is_date
        && field != "i.priority"
        && !matches!(field, "i.status" | "i.horizon" | "i.materialization_policy");
    let empty = if is_date {
        format!("todo_date_ordinal({field}) IS NULL")
    } else if is_many {
        format!("({field} IS NULL OR {field} = '' OR {field} = '[]')")
    } else {
        format!("({field} IS NULL OR {field} = '')")
    };
    if operator == TodoFilterOperator::IsEmpty {
        return Ok(empty);
    }
    if operator == TodoFilterOperator::IsNotEmpty {
        return Ok(format!("NOT {empty}"));
    }
    let values = match value {
        TodoTableFilterValue::Text(value) => vec![Value::Text(unicode_fold(value))],
        TodoTableFilterValue::TextList(values) => values
            .iter()
            .map(|value| Value::Text(unicode_fold(value)))
            .collect(),
        TodoTableFilterValue::Range { start, end } => {
            vec![Value::Text(start.clone()), Value::Text(end.clone())]
        }
        TodoTableFilterValue::Relative { amount, unit } => {
            vec![Value::Text(iso(checked_relative_date(
                reference.ok_or_else(|| {
                    TodoError::Validation("relative date requires reference date".into())
                })?,
                amount,
                *unit,
            )?))]
        }
        TodoTableFilterValue::Empty => vec![],
    };
    let placeholders = (0..values.len()).map(|_| "?").collect::<Vec<_>>().join(",");
    params.extend(values.clone());
    Ok(match operator {
        TodoFilterOperator::Is if is_many => format!(
            "EXISTS (SELECT 1 FROM json_each({match_field}) f WHERE todo_fold(CAST(f.value AS TEXT)) IN ({placeholders}))"
        ),
        TodoFilterOperator::Is if is_date => {
            format!("todo_date_ordinal({field}) IN (todo_date_ordinal(?))")
        }
        TodoFilterOperator::Is => format!("todo_fold(CAST({field} AS TEXT)) IN ({placeholders})"),
        TodoFilterOperator::IsNot if is_many => format!(
            "NOT EXISTS (SELECT 1 FROM json_each({match_field}) f WHERE todo_fold(CAST(f.value AS TEXT)) IN ({placeholders}))"
        ),
        TodoFilterOperator::IsNot if is_date => {
            format!("({empty} OR todo_date_ordinal({field}) NOT IN (todo_date_ordinal(?)))")
        }
        TodoFilterOperator::IsNot => {
            format!("({empty} OR todo_fold(CAST({field} AS TEXT)) NOT IN ({placeholders}))")
        }
        TodoFilterOperator::Contains if is_many => format!(
            "EXISTS (SELECT 1 FROM json_each({match_field}) f WHERE todo_fold(CAST(f.value AS TEXT)) IN ({placeholders}))"
        ),
        TodoFilterOperator::Contains if is_text => format!("instr(todo_fold({field}), ?) > 0"),
        TodoFilterOperator::Contains => {
            format!("todo_fold(CAST({field} AS TEXT)) IN ({placeholders})")
        }
        TodoFilterOperator::DoesNotContain if is_many => format!(
            "NOT EXISTS (SELECT 1 FROM json_each({match_field}) f WHERE todo_fold(CAST(f.value AS TEXT)) IN ({placeholders}))"
        ),
        TodoFilterOperator::DoesNotContain if is_text => {
            format!("({empty} OR instr(todo_fold({field}), ?) = 0)")
        }
        TodoFilterOperator::DoesNotContain => {
            format!("({empty} OR todo_fold(CAST({field} AS TEXT)) NOT IN ({placeholders}))")
        }
        TodoFilterOperator::StartsWith => format!("instr(todo_fold({field}), ?) = 1"),
        TodoFilterOperator::EndsWith => {
            params.extend(values);
            format!("substr(todo_fold({field}), -length(?)) = ?")
        }
        TodoFilterOperator::IsBefore => {
            format!("todo_date_ordinal({field}) < todo_date_ordinal(?)")
        }
        TodoFilterOperator::IsAfter => format!("todo_date_ordinal({field}) > todo_date_ordinal(?)"),
        TodoFilterOperator::IsOnOrBefore => {
            format!("todo_date_ordinal({field}) <= todo_date_ordinal(?)")
        }
        TodoFilterOperator::IsOnOrAfter => {
            format!("todo_date_ordinal({field}) >= todo_date_ordinal(?)")
        }
        TodoFilterOperator::IsBetween => format!(
            "todo_date_ordinal({field}) BETWEEN todo_date_ordinal(?) AND todo_date_ordinal(?)"
        ),
        TodoFilterOperator::IsRelativeToToday => {
            format!("todo_date_ordinal({field}) = todo_date_ordinal(?)")
        }
        TodoFilterOperator::GreaterThan => format!("CAST({field} AS INTEGER) > CAST(? AS INTEGER)"),
        TodoFilterOperator::LessThan => format!("CAST({field} AS INTEGER) < CAST(? AS INTEGER)"),
        TodoFilterOperator::IsEmpty | TodoFilterOperator::IsNotEmpty => unreachable!(),
    })
}

macro_rules! field_sql {
    ($value:expr, $type:ty) => {
        match $value {
            <$type>::Title => "i.title",
            <$type>::Status => "i.status",
            <$type>::Tags => "i.tags",
            <$type>::Note => "i.note",
            <$type>::Area => "i.area_id",
            <$type>::Due => "i.due",
            <$type>::Horizon => "i.horizon",
            <$type>::Scheduled => "i.scheduled",
            <$type>::Parent => "i.parent_id",
            <$type>::Project => "i.project_id",
            <$type>::RecurrenceRule => "i.recurrence_rule",
            <$type>::MaterializationPolicy => "i.materialization_policy",
            <$type>::Priority => "i.priority",
            <$type>::Description => "i.description",
            <$type>::Routine => "i.routine_id",
            <$type>::Location => "json_extract(i.metadata,'$.location')",
            <$type>::Participants => "json_extract(i.metadata,'$.participants')",
            <$type>::CommitmentType => "json_extract(i.metadata,'$.commitment_type')",
        }
    };
}
fn workspace_filter_sql(field: WorkspaceFilterField) -> &'static str {
    field_sql!(field, WorkspaceFilterField)
}
fn planner_filter_sql(field: PlannerFilterField) -> &'static str {
    field_sql!(field, PlannerFilterField)
}

macro_rules! sort_field_sql {
    ($value:expr, $type:ty) => {
        match $value {
            <$type>::Updated => "i.updated_at",
            <$type>::Title => "i.title",
            <$type>::Status => "i.status",
            <$type>::Tags => "(SELECT group_concat(CAST(value AS TEXT), ', ') FROM json_each(i.tags))",
            <$type>::Note => "i.note",
            <$type>::Area => "i.area_id",
            <$type>::Due => "todo_date_ordinal(i.due)",
            <$type>::Horizon => "i.horizon",
            <$type>::Scheduled => "todo_date_ordinal(i.scheduled)",
            <$type>::Parent => "i.parent_id",
            <$type>::Project => "i.project_id",
            <$type>::RecurrenceRule => "i.recurrence_rule",
            <$type>::MaterializationPolicy => "i.materialization_policy",
            <$type>::Priority => "i.priority",
            <$type>::Description => "i.description",
            <$type>::Routine => "i.routine_id",
            <$type>::Location => "json_extract(i.metadata,'$.location')",
            <$type>::Participants => "(SELECT group_concat(CAST(value AS TEXT), ', ') FROM json_each(json_extract(i.metadata,'$.participants')))",
            <$type>::CommitmentType => "json_extract(i.metadata,'$.commitment_type')",
        }
    };
}
fn sort_sql(sort: TodoTableSort) -> (&'static str, SortDirection) {
    match sort {
        TodoTableSort::Workspace { field, direction } => {
            (sort_field_sql!(field, WorkspaceSortField), direction)
        }
        TodoTableSort::Planner { field, direction } => {
            (sort_field_sql!(field, PlannerSortField), direction)
        }
    }
}

fn group_projection(group: TodoTableGroup) -> (String, Option<String>, Option<String>) {
    let relation = |column: &str, missing: &str| {
        (
            String::new(),
            Some(format!(
                "CASE WHEN i.{column} IS NULL THEN 'none' ELSE {} END",
                canonical_group_sql(&format!("i.{column}"))
            )),
            Some(format!(
                "coalesce((SELECT title FROM items label WHERE label.id=i.{column}),'{missing}')"
            )),
        )
    };
    match group {
        TodoTableGroup::Workspace(WorkspaceTableGroup::None)
        | TodoTableGroup::Planner(PlannerTableGroup::None) => (String::new(), None, None),
        TodoTableGroup::Workspace(WorkspaceTableGroup::Tag)
        | TodoTableGroup::Planner(PlannerTableGroup::Tag) => (
            "LEFT JOIN json_each(i.tags) tag ON true".into(),
            Some(format!(
                "CASE WHEN tag.value IS NULL THEN 'untagged' ELSE {} END",
                canonical_group_sql("CAST(tag.value AS TEXT)")
            )),
            Some("coalesce(CAST(tag.value AS TEXT),'Untagged')".into()),
        ),
        TodoTableGroup::Workspace(WorkspaceTableGroup::Area)
        | TodoTableGroup::Planner(PlannerTableGroup::Area) => relation("area_id", "No area"),
        TodoTableGroup::Workspace(WorkspaceTableGroup::Project)
        | TodoTableGroup::Planner(PlannerTableGroup::Project) => {
            relation("project_id", "No project")
        }
        TodoTableGroup::Workspace(WorkspaceTableGroup::Routine)
        | TodoTableGroup::Planner(PlannerTableGroup::Routine) => {
            relation("routine_id", "No routine")
        }
        TodoTableGroup::Workspace(WorkspaceTableGroup::Status)
        | TodoTableGroup::Planner(PlannerTableGroup::Status) => (
            String::new(),
            Some("i.status".into()),
            Some("CASE i.status WHEN 'active' THEN 'Active' WHEN 'waiting' THEN 'Waiting' WHEN 'paused' THEN 'Paused' WHEN 'completed' THEN 'Completed' WHEN 'cancelled' THEN 'Cancelled' WHEN 'dropped' THEN 'Dropped' WHEN 'archived' THEN 'Archived' WHEN 'missed' THEN 'missed' WHEN 'rejected' THEN 'Rejected' ELSE i.status END".into()),
        ),
        TodoTableGroup::Planner(PlannerTableGroup::ItemType) => (String::new(), Some("i.type".into()), Some("CASE i.type WHEN 'area' THEN 'Area' WHEN 'project' THEN 'Project' WHEN 'routine' THEN 'Routine' WHEN 'task' THEN 'Task' WHEN 'event' THEN 'Event' WHEN 'review' THEN 'Review' WHEN 'archive_item' THEN 'Archive item' WHEN 'goal' THEN 'Goal' ELSE i.type END".into())),
        TodoTableGroup::Planner(PlannerTableGroup::Day) => (String::new(), Some("CASE WHEN todo_date_ordinal(i.scheduled) IS NULL THEN 'none' ELSE substr(i.scheduled,1,10) END".into()), Some("CASE WHEN todo_date_ordinal(i.scheduled) IS NULL THEN 'No date' ELSE substr(i.scheduled,1,10) END".into())),
        TodoTableGroup::Planner(PlannerTableGroup::Week) => (String::new(), Some("CASE WHEN todo_date_ordinal(i.scheduled) IS NULL THEN 'none' ELSE date(substr(i.scheduled,1,10), '-' || ((CAST(strftime('%w',substr(i.scheduled,1,10)) AS INTEGER)+6)%7) || ' days') END".into()), Some("CASE WHEN todo_date_ordinal(i.scheduled) IS NULL THEN 'No date' ELSE 'Week of ' || date(substr(i.scheduled,1,10), '-' || ((CAST(strftime('%w',substr(i.scheduled,1,10)) AS INTEGER)+6)%7) || ' days') END".into())),
        TodoTableGroup::Planner(PlannerTableGroup::Month) => (String::new(), Some("CASE WHEN todo_date_ordinal(i.scheduled) IS NULL THEN 'none' ELSE substr(i.scheduled,1,7) END".into()), Some("CASE WHEN todo_date_ordinal(i.scheduled) IS NULL THEN 'No date' ELSE CASE substr(i.scheduled,6,2) WHEN '01' THEN 'January' WHEN '02' THEN 'February' WHEN '03' THEN 'March' WHEN '04' THEN 'April' WHEN '05' THEN 'May' WHEN '06' THEN 'June' WHEN '07' THEN 'July' WHEN '08' THEN 'August' WHEN '09' THEN 'September' WHEN '10' THEN 'October' WHEN '11' THEN 'November' WHEN '12' THEN 'December' END || ' ' || substr(i.scheduled,1,4) END".into())),
    }
}

fn canonical_group_sql(raw: &str) -> String {
    format!("todo_group_key({raw}, 0)")
}
