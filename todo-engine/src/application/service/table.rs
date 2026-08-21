use std::cmp::Ordering;
use std::collections::HashMap;

use time::Date;

use super::{ServiceStore, TodoService};
use crate::application::error::TodoResult;
use crate::application::table::*;
use crate::domain::{ItemStatus, ItemType, TodoItem, hidden_by_default_status, terminal_status};

impl TodoService {
    pub fn query_table(&mut self, query: &TodoTableQuery) -> TodoResult<TablePage<TodoTableRow>> {
        match &mut self.store {
            ServiceStore::Persistent(store) => store.query_table(query),
            ServiceStore::InMemory(items) => query_items(items.values().cloned(), query),
        }
    }

    pub fn table_lookups(&mut self, scope: TodoTableScope) -> TodoResult<Vec<TodoTableLookup>> {
        match &mut self.store {
            ServiceStore::Persistent(store) => store.table_lookups(scope),
            ServiceStore::InMemory(items) => Ok(build_lookups(items.values(), scope)),
        }
    }
}

pub(crate) fn query_items(
    items: impl IntoIterator<Item = TodoItem>,
    query: &TodoTableQuery,
) -> TodoResult<TablePage<TodoTableRow>> {
    let all = items.into_iter().collect::<Vec<_>>();
    let labels = all
        .iter()
        .map(|item| (item.id.clone(), item.title.clone()))
        .collect::<HashMap<_, _>>();
    let mut selected = all
        .into_iter()
        .filter(|item| in_context(item, query))
        .filter(|item| matches_filters(item, &labels, query))
        .collect::<Vec<_>>();
    selected.sort_by(|left, right| compare_items(left, right, query));

    let mut occurrences = selected
        .into_iter()
        .flat_map(|item| group_occurrences(item, &labels, query))
        .collect::<Vec<_>>();
    let mut base_occurrences = occurrences.iter().collect::<Vec<_>>();
    base_occurrences.sort_by(|(_, _, left), (_, _, right)| {
        compare_items(left, right, query).then_with(|| left.id.cmp(&right.id))
    });
    let mut first_seen = HashMap::new();
    for (key, _, _) in base_occurrences {
        let next = first_seen.len();
        first_seen.entry(key.clone()).or_insert(next);
    }
    occurrences.sort_by(
        |(left_key, left_label, left), (right_key, right_label, right)| {
            compare_groups(
                left_key.as_deref(),
                left_label.as_deref(),
                right_key.as_deref(),
                right_label.as_deref(),
                query,
                &first_seen,
            )
            .then_with(|| left_key.cmp(right_key))
            .then_with(|| compare_items(left, right, query))
            .then_with(|| left.id.cmp(&right.id))
        },
    );
    let start = usize::try_from(query.offset()).unwrap_or(usize::MAX);
    let take = usize::from(query.limit()) + 1;
    let rows = occurrences
        .into_iter()
        .skip(start)
        .take(take)
        .map(|(key, label, item)| TodoTableRow::new(key, label, TodoTableRecord::new(item)?))
        .collect::<TodoResult<Vec<_>>>()?;
    TablePage::from_limit_plus_one(rows, query.offset(), query.limit())
}

pub(crate) fn build_lookups<'a>(
    items: impl IntoIterator<Item = &'a TodoItem>,
    scope: TodoTableScope,
) -> Vec<TodoTableLookup> {
    let mut values = items
        .into_iter()
        .filter(|item| !terminal_status(item.status))
        .filter(|item| lookup_type_allowed(item.item_type, scope))
        .map(|item| {
            let mut tags = item
                .tags
                .iter()
                .map(|tag| tag.trim().to_lowercase())
                .filter(|tag| !tag.is_empty())
                .collect::<Vec<_>>();
            tags.sort();
            tags.dedup();
            TodoTableLookup {
                id: item.id.clone(),
                item_type: item.item_type,
                title: item.title.clone(),
                tags,
            }
        })
        .collect::<Vec<_>>();
    values.sort_by(|left, right| {
        left.item_type
            .as_str()
            .cmp(right.item_type.as_str())
            .then_with(|| compare_unicode_text(&left.title, &right.title))
            .then_with(|| left.id.cmp(&right.id))
    });
    values
}

fn lookup_type_allowed(item_type: ItemType, scope: TodoTableScope) -> bool {
    match scope {
        TodoTableScope::Workspace(scope) => {
            item_type == scope.item_type() || relation_type(item_type)
        }
        TodoTableScope::Linked { child, .. } => item_type == child || relation_type(item_type),
        TodoTableScope::Planner(scope) if scope.is_goal_table() => matches!(
            item_type,
            ItemType::Area | ItemType::Project | ItemType::Routine | ItemType::Goal
        ),
        TodoTableScope::Planner(_) => matches!(
            item_type,
            ItemType::Area
                | ItemType::Project
                | ItemType::Routine
                | ItemType::Task
                | ItemType::Event
        ),
    }
}

const fn relation_type(item_type: ItemType) -> bool {
    matches!(
        item_type,
        ItemType::Area | ItemType::Project | ItemType::Routine | ItemType::Goal
    )
}

fn in_context(item: &TodoItem, query: &TodoTableQuery) -> bool {
    match (query.scope(), query.context()) {
        (TodoTableScope::Workspace(scope), TableContext::Workspace) => {
            item.item_type == scope.item_type() && !hidden_by_default_status(item.status)
        }
        (TodoTableScope::Linked { parent, child }, TableContext::Linked { parent_id, .. }) => {
            item.item_type == child
                && !hidden_by_default_status(item.status)
                && linked_parent(item, parent) == Some(parent_id.as_str())
        }
        (TodoTableScope::Planner(scope), TableContext::Planner { from, to }) => {
            planner_context(item, scope, *from, *to)
        }
        _ => false,
    }
}

fn linked_parent(item: &TodoItem, parent: ItemType) -> Option<&str> {
    match parent {
        ItemType::Area => item.area_id.as_deref(),
        ItemType::Project => item.project_id.as_deref(),
        ItemType::Routine => item.routine_id.as_deref(),
        ItemType::Goal => item.parent_id.as_deref(),
        _ => None,
    }
}

fn planner_context(item: &TodoItem, scope: PlannerTableScope, from: Date, to: Date) -> bool {
    let scheduled = item.scheduled.as_deref().and_then(parse_date_prefix);
    if scope.is_goal_table() {
        let horizon = match scope {
            PlannerTableScope::YearlyPeriodGoals => "year",
            PlannerTableScope::YearlyMonthGoals
            | PlannerTableScope::MonthlyPeriodGoals
            | PlannerTableScope::WeeklyMonthGoals => "month",
            _ => "week",
        };
        return item.item_type == ItemType::Goal
            && !terminal_status(item.status)
            && item.horizon.as_deref() == Some(horizon)
            && scheduled.is_some_and(|date| from <= date && date <= to);
    }
    if !matches!(item.item_type, ItemType::Task | ItemType::Event)
        || !planner_work_visible(item.status)
    {
        return false;
    }
    match scope {
        PlannerTableScope::DailyOverdue => scheduled.is_some_and(|date| date < from),
        PlannerTableScope::DailyUnscheduled => scheduled.is_none(),
        _ => scheduled.is_some_and(|date| from <= date && date <= to),
    }
}

const fn planner_work_visible(status: ItemStatus) -> bool {
    !matches!(
        status,
        ItemStatus::Archived | ItemStatus::Dropped | ItemStatus::Cancelled | ItemStatus::Rejected
    )
}

fn parse_date_prefix(value: &str) -> Option<Date> {
    let value = value.get(..10)?;
    Date::parse(
        value,
        time::macros::format_description!("[year]-[month]-[day]"),
    )
    .ok()
}

fn matches_filters(
    item: &TodoItem,
    labels: &HashMap<String, String>,
    query: &TodoTableQuery,
) -> bool {
    if query.filters().is_empty() {
        return true;
    }
    let matches = |filter| matches_filter(item, labels, filter, query.reference_date());
    match query.filter_mode() {
        FilterMode::And => query.filters().iter().all(matches),
        FilterMode::Or => query.filters().iter().any(matches),
    }
}

fn matches_filter(
    item: &TodoItem,
    labels: &HashMap<String, String>,
    filter: &TodoTableFilter,
    reference: Option<Date>,
) -> bool {
    let (field, operator, value) = match filter {
        TodoTableFilter::Workspace {
            field,
            operator,
            value,
        } => (workspace_field(*field), *operator, value),
        TodoTableFilter::Planner {
            field,
            operator,
            value,
        } => (planner_field(*field), *operator, value),
    };
    let actual = field_value(item, labels, field);
    matches_value(actual, operator, value, reference)
}

#[derive(Clone, Copy)]
enum Field {
    Title,
    Status,
    Tags,
    Note,
    Area,
    Due,
    Horizon,
    Scheduled,
    Parent,
    Project,
    RecurrenceRule,
    MaterializationPolicy,
    Priority,
    Description,
    Routine,
    Location,
    Participants,
    CommitmentType,
    Updated,
}

macro_rules! map_field {
    ($value:expr, $type:ty) => {
        match $value {
            <$type>::Title => Field::Title,
            <$type>::Status => Field::Status,
            <$type>::Tags => Field::Tags,
            <$type>::Note => Field::Note,
            <$type>::Area => Field::Area,
            <$type>::Due => Field::Due,
            <$type>::Horizon => Field::Horizon,
            <$type>::Scheduled => Field::Scheduled,
            <$type>::Parent => Field::Parent,
            <$type>::Project => Field::Project,
            <$type>::RecurrenceRule => Field::RecurrenceRule,
            <$type>::MaterializationPolicy => Field::MaterializationPolicy,
            <$type>::Priority => Field::Priority,
            <$type>::Description => Field::Description,
            <$type>::Routine => Field::Routine,
            <$type>::Location => Field::Location,
            <$type>::Participants => Field::Participants,
            <$type>::CommitmentType => Field::CommitmentType,
        }
    };
}
fn workspace_field(value: WorkspaceFilterField) -> Field {
    map_field!(value, WorkspaceFilterField)
}
fn planner_field(value: PlannerFilterField) -> Field {
    map_field!(value, PlannerFilterField)
}
macro_rules! map_sort_field {
    ($value:expr, $type:ty) => {
        match $value {
            <$type>::Title => Field::Title,
            <$type>::Status => Field::Status,
            <$type>::Tags => Field::Tags,
            <$type>::Note => Field::Note,
            <$type>::Area => Field::Area,
            <$type>::Due => Field::Due,
            <$type>::Horizon => Field::Horizon,
            <$type>::Scheduled => Field::Scheduled,
            <$type>::Parent => Field::Parent,
            <$type>::Project => Field::Project,
            <$type>::RecurrenceRule => Field::RecurrenceRule,
            <$type>::MaterializationPolicy => Field::MaterializationPolicy,
            <$type>::Priority => Field::Priority,
            <$type>::Description => Field::Description,
            <$type>::Routine => Field::Routine,
            <$type>::Location => Field::Location,
            <$type>::Participants => Field::Participants,
            <$type>::CommitmentType => Field::CommitmentType,
            <$type>::Updated => Field::Updated,
        }
    };
}
fn workspace_sort_field(value: WorkspaceSortField) -> Field {
    map_sort_field!(value, WorkspaceSortField)
}
fn planner_sort_field(value: PlannerSortField) -> Field {
    map_sort_field!(value, PlannerSortField)
}

enum Value {
    One(Option<String>),
    Many(Vec<String>),
    Number(Option<i64>),
}

fn relation(item_id: Option<&String>, labels: &HashMap<String, String>) -> Vec<String> {
    let Some(id) = item_id else {
        return vec![];
    };
    let mut values = vec![id.clone()];
    if let Some(label) = labels.get(id).filter(|label| *label != id) {
        values.push(label.clone());
    }
    values
}

fn field_value(item: &TodoItem, labels: &HashMap<String, String>, field: Field) -> Value {
    let one = |value: Option<&str>| Value::One(value.map(str::to_string));
    match field {
        Field::Title => one(Some(&item.title)),
        Field::Status => one(Some(item.status.as_str())),
        Field::Tags => Value::Many(item.tags.clone()),
        Field::Note => one(item.note.as_deref()),
        Field::Area => Value::Many(relation(item.area_id.as_ref(), labels)),
        Field::Due => one(item.due.as_deref().and_then(|v| v.get(..10))),
        Field::Horizon => one(item.horizon.as_deref()),
        Field::Scheduled => one(item.scheduled.as_deref().and_then(|v| v.get(..10))),
        Field::Parent => Value::Many(relation(item.parent_id.as_ref(), labels)),
        Field::Project => Value::Many(relation(item.project_id.as_ref(), labels)),
        Field::RecurrenceRule => one(item.recurrence_rule.as_deref()),
        Field::MaterializationPolicy => one(Some(&item.materialization_policy)),
        Field::Priority => Value::Number(item.priority),
        Field::Description => one(item.description.as_deref()),
        Field::Routine => Value::Many(relation(item.routine_id.as_ref(), labels)),
        Field::Location => one(item.metadata.get("location").and_then(|v| v.as_str())),
        Field::Participants => Value::Many(
            item.metadata
                .get("participants")
                .and_then(|v| v.as_array())
                .into_iter()
                .flatten()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect(),
        ),
        Field::CommitmentType => one(item
            .metadata
            .get("commitment_type")
            .and_then(|v| v.as_str())),
        Field::Updated => one(item
            .updated_at
            .format(&time::format_description::well_known::Rfc3339)
            .ok()
            .as_deref()),
    }
}

fn matches_value(
    actual: Value,
    operator: TodoFilterOperator,
    expected: &TodoTableFilterValue,
    reference: Option<Date>,
) -> bool {
    let empty = match &actual {
        Value::One(v) => v.as_deref().is_none_or(str::is_empty),
        Value::Many(v) => v.is_empty(),
        Value::Number(v) => v.is_none(),
    };
    if operator == TodoFilterOperator::IsEmpty {
        return empty;
    }
    if operator == TodoFilterOperator::IsNotEmpty {
        return !empty;
    }
    if empty {
        return matches!(
            operator,
            TodoFilterOperator::IsNot | TodoFilterOperator::DoesNotContain
        );
    }
    match actual {
        Value::Number(actual) => {
            let actual = actual.unwrap();
            let expected = expected_strings(expected)
                .first()
                .and_then(|v| v.parse::<i64>().ok())
                .unwrap_or_default();
            match operator {
                TodoFilterOperator::Is => actual == expected,
                TodoFilterOperator::IsNot => actual != expected,
                TodoFilterOperator::GreaterThan => actual > expected,
                TodoFilterOperator::LessThan => actual < expected,
                _ => false,
            }
        }
        Value::Many(values) => {
            let values = values.iter().map(|v| v.to_lowercase()).collect::<Vec<_>>();
            let expected = expected_strings(expected);
            let hit = expected.iter().any(|value| values.contains(value));
            match operator {
                TodoFilterOperator::Is | TodoFilterOperator::Contains => hit,
                TodoFilterOperator::IsNot | TodoFilterOperator::DoesNotContain => !hit,
                _ => false,
            }
        }
        Value::One(Some(actual)) => {
            if matches!(
                operator,
                TodoFilterOperator::IsBefore
                    | TodoFilterOperator::IsAfter
                    | TodoFilterOperator::IsOnOrBefore
                    | TodoFilterOperator::IsOnOrAfter
                    | TodoFilterOperator::IsBetween
                    | TodoFilterOperator::IsRelativeToToday
            ) {
                return matches_date(&actual, operator, expected, reference);
            }
            let actual = actual.to_lowercase();
            let expected = expected_strings(expected);
            let first = expected.first().map(String::as_str).unwrap_or("");
            match operator {
                TodoFilterOperator::Is => expected.contains(&actual),
                TodoFilterOperator::IsNot => !expected.contains(&actual),
                TodoFilterOperator::Contains => expected.iter().any(|v| actual.contains(v)),
                TodoFilterOperator::DoesNotContain => expected.iter().all(|v| !actual.contains(v)),
                TodoFilterOperator::StartsWith => actual.starts_with(first),
                TodoFilterOperator::EndsWith => actual.ends_with(first),
                _ => false,
            }
        }
        _ => false,
    }
}

fn expected_strings(value: &TodoTableFilterValue) -> Vec<String> {
    match value {
        TodoTableFilterValue::Text(v) => vec![v.to_lowercase()],
        TodoTableFilterValue::TextList(v) => v.iter().map(|v| v.to_lowercase()).collect(),
        _ => vec![],
    }
}

fn matches_date(
    actual: &str,
    op: TodoFilterOperator,
    value: &TodoTableFilterValue,
    reference: Option<Date>,
) -> bool {
    let Some(actual) = parse_date_prefix(actual) else {
        return false;
    };
    match (op, value) {
        (TodoFilterOperator::Is, TodoTableFilterValue::Text(v)) => {
            parse_date_prefix(v) == Some(actual)
        }
        (TodoFilterOperator::IsNot, TodoTableFilterValue::Text(v)) => {
            parse_date_prefix(v) != Some(actual)
        }
        (TodoFilterOperator::IsBefore, TodoTableFilterValue::Text(v)) => {
            parse_date_prefix(v).is_some_and(|v| actual < v)
        }
        (TodoFilterOperator::IsAfter, TodoTableFilterValue::Text(v)) => {
            parse_date_prefix(v).is_some_and(|v| actual > v)
        }
        (TodoFilterOperator::IsOnOrBefore, TodoTableFilterValue::Text(v)) => {
            parse_date_prefix(v).is_some_and(|v| actual <= v)
        }
        (TodoFilterOperator::IsOnOrAfter, TodoTableFilterValue::Text(v)) => {
            parse_date_prefix(v).is_some_and(|v| actual >= v)
        }
        (TodoFilterOperator::IsBetween, TodoTableFilterValue::Range { start, end }) => {
            parse_date_prefix(start)
                .zip(parse_date_prefix(end))
                .is_some_and(|(s, e)| s <= actual && actual <= e)
        }
        (
            TodoFilterOperator::IsRelativeToToday,
            TodoTableFilterValue::Relative { amount, unit },
        ) => reference
            .and_then(|date| checked_relative_date(date, amount, *unit).ok())
            .is_some_and(|date| actual == date),
        _ => false,
    }
}

fn compare_items(left: &TodoItem, right: &TodoItem, query: &TodoTableQuery) -> Ordering {
    for sort in query.sorts() {
        let (field, direction) = match sort {
            TodoTableSort::Workspace { field, direction } => {
                (workspace_sort_field(*field), *direction)
            }
            TodoTableSort::Planner { field, direction } => (planner_sort_field(*field), *direction),
        };
        let order = compare_field(left, right, field, direction);
        if order != Ordering::Equal {
            return order;
        }
    }
    if query.sorts().is_empty() {
        let default = match query.scope() {
            TodoTableScope::Planner(
                PlannerTableScope::DailyToday
                | PlannerTableScope::DailyOverdue
                | PlannerTableScope::DailyUnscheduled,
            ) => option_number(left.priority, right.priority, SortDirection::Asc),
            TodoTableScope::Planner(_) => {
                option_text(left.scheduled.as_deref(), right.scheduled.as_deref())
            }
            _ => right.updated_at.cmp(&left.updated_at),
        };
        if default != Ordering::Equal {
            return default;
        }
    }
    planner_fallback(left, right)
}

fn compare_field(
    left: &TodoItem,
    right: &TodoItem,
    field: Field,
    direction: SortDirection,
) -> Ordering {
    if matches!(field, Field::Priority) {
        return option_number(left.priority, right.priority, direction);
    }
    let empty = HashMap::new();
    let text = |item| match field_value(item, &empty, field) {
        Value::One(v) => v,
        Value::Many(v) => Some(v.join(", ")),
        Value::Number(v) => v.map(|v| v.to_string()),
    };
    option_text_direction(text(left).as_deref(), text(right).as_deref(), direction)
}
fn option_text(left: Option<&str>, right: Option<&str>) -> Ordering {
    compare_unicode_text(left.unwrap_or(""), right.unwrap_or(""))
}
fn option_text_direction(
    left: Option<&str>,
    right: Option<&str>,
    direction: SortDirection,
) -> Ordering {
    let order = compare_unicode_text(left.unwrap_or(""), right.unwrap_or(""));
    if direction == SortDirection::Desc {
        order.reverse()
    } else {
        order
    }
}
fn option_number(left: Option<i64>, right: Option<i64>, direction: SortDirection) -> Ordering {
    match (left, right) {
        (Some(l), Some(r)) => {
            let order = l.cmp(&r);
            if direction == SortDirection::Desc {
                order.reverse()
            } else {
                order
            }
        }
        (Some(_), None) => {
            if direction == SortDirection::Desc {
                Ordering::Greater
            } else {
                Ordering::Less
            }
        }
        (None, Some(_)) => {
            if direction == SortDirection::Desc {
                Ordering::Less
            } else {
                Ordering::Greater
            }
        }
        _ => Ordering::Equal,
    }
}
fn planner_fallback(left: &TodoItem, right: &TodoItem) -> Ordering {
    option_text(left.scheduled.as_deref(), right.scheduled.as_deref())
        .then_with(|| right.updated_at.cmp(&left.updated_at))
        .then_with(|| compare_unicode_text(&left.title, &right.title))
        .then_with(|| left.id.cmp(&right.id))
}

fn group_occurrences(
    item: TodoItem,
    labels: &HashMap<String, String>,
    query: &TodoTableQuery,
) -> Vec<(Option<String>, Option<String>, TodoItem)> {
    let group = query.group_settings().group_by();
    let raw = match group {
        TodoTableGroup::Workspace(WorkspaceTableGroup::None)
        | TodoTableGroup::Planner(PlannerTableGroup::None) => return vec![(None, None, item)],
        TodoTableGroup::Workspace(WorkspaceTableGroup::Tag)
        | TodoTableGroup::Planner(PlannerTableGroup::Tag) => {
            if item.tags.is_empty() {
                vec![("untagged".into(), "Untagged".into())]
            } else {
                item.tags
                    .iter()
                    .map(|tag| (canonical_group_value(tag), tag.clone()))
                    .collect()
            }
        }
        TodoTableGroup::Workspace(WorkspaceTableGroup::Area)
        | TodoTableGroup::Planner(PlannerTableGroup::Area) => {
            relation_group(item.area_id.as_ref(), labels, "No area")
        }
        TodoTableGroup::Workspace(WorkspaceTableGroup::Project)
        | TodoTableGroup::Planner(PlannerTableGroup::Project) => {
            relation_group(item.project_id.as_ref(), labels, "No project")
        }
        TodoTableGroup::Workspace(WorkspaceTableGroup::Routine)
        | TodoTableGroup::Planner(PlannerTableGroup::Routine) => {
            relation_group(item.routine_id.as_ref(), labels, "No routine")
        }
        TodoTableGroup::Workspace(WorkspaceTableGroup::Status)
        | TodoTableGroup::Planner(PlannerTableGroup::Status) => {
            vec![(
                item.status.as_str().into(),
                status_label(item.status).into(),
            )]
        }
        TodoTableGroup::Planner(PlannerTableGroup::ItemType) => vec![(
            item.item_type.as_str().into(),
            item_type_label(item.item_type).into(),
        )],
        TodoTableGroup::Planner(PlannerTableGroup::Month) => {
            vec![date_group(item.scheduled.as_deref(), DateGroup::Month)]
        }
        TodoTableGroup::Planner(PlannerTableGroup::Week) => {
            vec![date_group(item.scheduled.as_deref(), DateGroup::Week)]
        }
        TodoTableGroup::Planner(PlannerTableGroup::Day) => {
            vec![date_group(item.scheduled.as_deref(), DateGroup::Day)]
        }
    };
    raw.into_iter()
        .filter(|(key, _)| !query.group_settings().hidden_group_keys().contains(key))
        .map(|(key, label)| (Some(key), Some(label), item.clone()))
        .collect()
}

enum DateGroup {
    Month,
    Week,
    Day,
}

fn date_group(value: Option<&str>, group: DateGroup) -> (String, String) {
    let Some(date) = value.and_then(parse_date_prefix) else {
        return ("none".into(), "No date".into());
    };
    let day = date.to_string();
    match group {
        DateGroup::Day => (day.clone(), day),
        DateGroup::Week => {
            let monday =
                date - time::Duration::days(i64::from(date.weekday().number_days_from_monday()));
            let key = monday.to_string();
            (key.clone(), format!("Week of {key}"))
        }
        DateGroup::Month => {
            const MONTHS: [&str; 12] = [
                "January",
                "February",
                "March",
                "April",
                "May",
                "June",
                "July",
                "August",
                "September",
                "October",
                "November",
                "December",
            ];
            let key = day[..7].to_string();
            (
                key,
                format!(
                    "{} {}",
                    MONTHS[usize::from(date.month() as u8 - 1)],
                    date.year()
                ),
            )
        }
    }
}

fn status_label(status: ItemStatus) -> &'static str {
    match status {
        ItemStatus::Active => "Active",
        ItemStatus::Waiting => "Waiting",
        ItemStatus::Paused => "Paused",
        ItemStatus::Completed => "Completed",
        ItemStatus::Cancelled => "Cancelled",
        ItemStatus::Dropped => "Dropped",
        ItemStatus::Archived => "Archived",
        ItemStatus::Missed => "missed",
        ItemStatus::Rejected => "Rejected",
    }
}

fn item_type_label(item_type: ItemType) -> &'static str {
    match item_type {
        ItemType::Area => "Area",
        ItemType::Project => "Project",
        ItemType::Routine => "Routine",
        ItemType::Task => "Task",
        ItemType::Event => "Event",
        ItemType::Review => "Review",
        ItemType::ArchiveItem => "Archive item",
        ItemType::Goal => "Goal",
    }
}
fn relation_group(
    id: Option<&String>,
    labels: &HashMap<String, String>,
    missing: &str,
) -> Vec<(String, String)> {
    match id {
        Some(id) => vec![(
            canonical_group_value(id),
            labels.get(id).cloned().unwrap_or_else(|| id.clone()),
        )],
        None => vec![("none".into(), missing.into())],
    }
}
fn compare_groups(
    left: Option<&str>,
    left_label: Option<&str>,
    right: Option<&str>,
    right_label: Option<&str>,
    query: &TodoTableQuery,
    first_seen: &HashMap<Option<String>, usize>,
) -> Ordering {
    let settings = query.group_settings();
    let left = left.unwrap_or("");
    let right = right.unwrap_or("");
    match settings.sort() {
        GroupSort::Alphabetical => {
            compare_unicode_text(left_label.unwrap_or(""), right_label.unwrap_or(""))
        }
        GroupSort::ReverseAlphabetical => {
            compare_unicode_text(right_label.unwrap_or(""), left_label.unwrap_or(""))
        }
        GroupSort::Manual => {
            let rank = |key: &str| settings.manual_order().iter().position(|v| v == key);
            match (rank(left), rank(right)) {
                (Some(l), Some(r)) => l.cmp(&r),
                (Some(_), None) => Ordering::Less,
                (None, Some(_)) => Ordering::Greater,
                _ => compare_manual_group_base(
                    left,
                    left_label.unwrap_or(""),
                    right,
                    right_label.unwrap_or(""),
                    settings.group_by(),
                    first_seen,
                ),
            }
        }
    }
}

fn compare_manual_group_base(
    left: &str,
    left_label: &str,
    right: &str,
    right_label: &str,
    group: TodoTableGroup,
    first_seen: &HashMap<Option<String>, usize>,
) -> Ordering {
    let fixed_rank = |value: &str, values: &[&str]| {
        values
            .iter()
            .position(|candidate| *candidate == value)
            .unwrap_or(values.len())
    };
    match group {
        TodoTableGroup::Workspace(WorkspaceTableGroup::Tag)
        | TodoTableGroup::Planner(PlannerTableGroup::Tag) => (left == "untagged")
            .cmp(&(right == "untagged"))
            .then_with(|| compare_unicode_text(left_label, right_label)),
        TodoTableGroup::Workspace(WorkspaceTableGroup::Status)
        | TodoTableGroup::Planner(PlannerTableGroup::Status) => fixed_rank(
            left,
            &["active", "paused", "completed", "missed", "waiting"],
        )
        .cmp(&fixed_rank(
            right,
            &["active", "paused", "completed", "missed", "waiting"],
        )),
        TodoTableGroup::Planner(PlannerTableGroup::ItemType) => {
            fixed_rank(left, &["task", "event", "routine"])
                .cmp(&fixed_rank(right, &["task", "event", "routine"]))
        }
        TodoTableGroup::Planner(PlannerTableGroup::Month)
        | TodoTableGroup::Planner(PlannerTableGroup::Week)
        | TodoTableGroup::Planner(PlannerTableGroup::Day) => (left == "none")
            .cmp(&(right == "none"))
            .then_with(|| left.cmp(right)),
        TodoTableGroup::Workspace(WorkspaceTableGroup::Area)
        | TodoTableGroup::Workspace(WorkspaceTableGroup::Project)
        | TodoTableGroup::Workspace(WorkspaceTableGroup::Routine)
        | TodoTableGroup::Planner(PlannerTableGroup::Area)
        | TodoTableGroup::Planner(PlannerTableGroup::Project)
        | TodoTableGroup::Planner(PlannerTableGroup::Routine) => {
            (left == "none").cmp(&(right == "none")).then_with(|| {
                first_seen
                    .get(&Some(left.to_string()))
                    .cmp(&first_seen.get(&Some(right.to_string())))
            })
        }
        TodoTableGroup::Workspace(WorkspaceTableGroup::None)
        | TodoTableGroup::Planner(PlannerTableGroup::None) => Ordering::Equal,
    }
}

fn compare_unicode_text(left: &str, right: &str) -> Ordering {
    unicode_sort_key(left)
        .cmp(&unicode_sort_key(right))
        .then_with(|| left.chars().cmp(right.chars()))
}
