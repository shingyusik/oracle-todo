use axum::Json;
use axum::extract::rejection::{JsonRejection, QueryRejection};
use axum::extract::{Query, State};
use serde::Deserialize;
use serde_json::{Value, json};
use time::Date;

use super::{ApiResult, ApiState, validation_rejection, with_service};
use crate::application::error::TodoError;
use crate::application::table::{
    FilterMode, GroupSort, PlannerFilterField, PlannerSortField, PlannerTableGroup,
    PlannerTableScope, RelativeDateUnit, SortDirection, TableContext, TodoFilterOperator,
    TodoTableFilter, TodoTableFilterValue, TodoTableGroup, TodoTableGroupSettings, TodoTableQuery,
    TodoTableScope, TodoTableSort, WorkspaceFilterField, WorkspaceSortField, WorkspaceTableGroup,
    WorkspaceTableScope,
};
use crate::domain::ItemType;

fn default_limit() -> u16 {
    50
}

fn default_filter_mode() -> FilterMode {
    FilterMode::And
}

#[derive(Debug, Clone, Copy, Deserialize)]
enum TableScopeBody {
    #[serde(rename = "workspace.area")]
    WorkspaceArea,
    #[serde(rename = "workspace.project")]
    WorkspaceProject,
    #[serde(rename = "workspace.goal")]
    WorkspaceGoal,
    #[serde(rename = "workspace.routine")]
    WorkspaceRoutine,
    #[serde(rename = "workspace.task")]
    WorkspaceTask,
    #[serde(rename = "workspace.event")]
    WorkspaceEvent,
    #[serde(rename = "planner.yearly-period-goals")]
    PlannerYearlyPeriodGoals,
    #[serde(rename = "planner.yearly-month-goals")]
    PlannerYearlyMonthGoals,
    #[serde(rename = "planner.monthly-period-goals")]
    PlannerMonthlyPeriodGoals,
    #[serde(rename = "planner.monthly-calendar")]
    PlannerMonthlyCalendar,
    #[serde(rename = "planner.monthly-week-goals")]
    PlannerMonthlyWeekGoals,
    #[serde(rename = "planner.weekly-month-goals")]
    PlannerWeeklyMonthGoals,
    #[serde(rename = "planner.weekly-week-goals")]
    PlannerWeeklyWeekGoals,
    #[serde(rename = "planner.weekly-day-grid")]
    PlannerWeeklyDayGrid,
    #[serde(rename = "planner.daily-today")]
    PlannerDailyToday,
    #[serde(rename = "planner.daily-overdue")]
    PlannerDailyOverdue,
    #[serde(rename = "planner.daily-unscheduled")]
    PlannerDailyUnscheduled,
    #[serde(rename = "linked.area.project")]
    LinkedAreaProject,
    #[serde(rename = "linked.area.routine")]
    LinkedAreaRoutine,
    #[serde(rename = "linked.area.task")]
    LinkedAreaTask,
    #[serde(rename = "linked.area.event")]
    LinkedAreaEvent,
    #[serde(rename = "linked.project.routine")]
    LinkedProjectRoutine,
    #[serde(rename = "linked.project.task")]
    LinkedProjectTask,
    #[serde(rename = "linked.project.event")]
    LinkedProjectEvent,
    #[serde(rename = "linked.routine.task")]
    LinkedRoutineTask,
    #[serde(rename = "linked.goal.goal")]
    LinkedGoalGoal,
    #[serde(rename = "linked.goal.task")]
    LinkedGoalTask,
}

impl TableScopeBody {
    fn application(self) -> TodoTableScope {
        use PlannerTableScope as P;
        use TableScopeBody as S;
        use WorkspaceTableScope as W;
        match self {
            S::WorkspaceArea => TodoTableScope::Workspace(W::Area),
            S::WorkspaceProject => TodoTableScope::Workspace(W::Project),
            S::WorkspaceGoal => TodoTableScope::Workspace(W::Goal),
            S::WorkspaceRoutine => TodoTableScope::Workspace(W::Routine),
            S::WorkspaceTask => TodoTableScope::Workspace(W::Task),
            S::WorkspaceEvent => TodoTableScope::Workspace(W::Event),
            S::PlannerYearlyPeriodGoals => TodoTableScope::Planner(P::YearlyPeriodGoals),
            S::PlannerYearlyMonthGoals => TodoTableScope::Planner(P::YearlyMonthGoals),
            S::PlannerMonthlyPeriodGoals => TodoTableScope::Planner(P::MonthlyPeriodGoals),
            S::PlannerMonthlyCalendar => TodoTableScope::Planner(P::MonthlyCalendar),
            S::PlannerMonthlyWeekGoals => TodoTableScope::Planner(P::MonthlyWeekGoals),
            S::PlannerWeeklyMonthGoals => TodoTableScope::Planner(P::WeeklyMonthGoals),
            S::PlannerWeeklyWeekGoals => TodoTableScope::Planner(P::WeeklyWeekGoals),
            S::PlannerWeeklyDayGrid => TodoTableScope::Planner(P::WeeklyDayGrid),
            S::PlannerDailyToday => TodoTableScope::Planner(P::DailyToday),
            S::PlannerDailyOverdue => TodoTableScope::Planner(P::DailyOverdue),
            S::PlannerDailyUnscheduled => TodoTableScope::Planner(P::DailyUnscheduled),
            S::LinkedAreaProject => linked(ItemType::Area, ItemType::Project),
            S::LinkedAreaRoutine => linked(ItemType::Area, ItemType::Routine),
            S::LinkedAreaTask => linked(ItemType::Area, ItemType::Task),
            S::LinkedAreaEvent => linked(ItemType::Area, ItemType::Event),
            S::LinkedProjectRoutine => linked(ItemType::Project, ItemType::Routine),
            S::LinkedProjectTask => linked(ItemType::Project, ItemType::Task),
            S::LinkedProjectEvent => linked(ItemType::Project, ItemType::Event),
            S::LinkedRoutineTask => linked(ItemType::Routine, ItemType::Task),
            S::LinkedGoalGoal => linked(ItemType::Goal, ItemType::Goal),
            S::LinkedGoalTask => linked(ItemType::Goal, ItemType::Task),
        }
    }
}

const fn linked(parent: ItemType, child: ItemType) -> TodoTableScope {
    TodoTableScope::Linked { parent, child }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TableQueryBody {
    scope: TableScopeBody,
    #[serde(default)]
    offset: u32,
    #[serde(default = "default_limit")]
    limit: u16,
    #[serde(default = "default_filter_mode")]
    filter_mode: FilterMode,
    #[serde(default)]
    filters: Vec<TableFilterBody>,
    #[serde(default)]
    sorts: Vec<TableSortBody>,
    group_by: GroupField,
    group_settings: GroupSettingsBody,
    context: TableContextBody,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum TableContextBody {
    Workspace(WorkspaceContextBody),
    Planner(PlannerContextBody),
    Linked(LinkedContextBody),
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct WorkspaceContextBody {
    reference_date: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PlannerContextBody {
    from: String,
    to: String,
    reference_date: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct LinkedContextBody {
    parent_type: ItemType,
    parent_id: String,
    reference_date: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TableFilterBody {
    field: FilterField,
    operator: TodoFilterOperator,
    value: FilterValueBody,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum FilterField {
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
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum FilterValueBody {
    Text(TextBody),
    List(ListBody),
    Range(RangeValueBody),
    Relative(RelativeValueBody),
    Empty(EmptyBody),
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TextBody {
    text: String,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ListBody {
    list: Vec<String>,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RangeValueBody {
    range: RangeBody,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RangeBody {
    start: String,
    end: String,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RelativeValueBody {
    relative: RelativeBody,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RelativeBody {
    amount: String,
    unit: RelativeDateUnit,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EmptyBody {
    empty: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TableSortBody {
    field: SortField,
    direction: SortDirection,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum SortField {
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

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum GroupField {
    None,
    Area,
    Project,
    Routine,
    Tag,
    Status,
    Month,
    Week,
    Day,
    ItemType,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct GroupSettingsBody {
    sort: GroupSort,
    hide_empty: bool,
    manual_order: Vec<String>,
    hidden_group_keys: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TableLookupQuery {
    scope: TableScopeBody,
}

pub(super) async fn query_table(
    State(state): State<ApiState>,
    body: Result<Json<TableQueryBody>, JsonRejection>,
) -> ApiResult<Json<Value>> {
    let Json(body) = body.map_err(validation_rejection)?;
    let scope = body.scope.application();
    let (context, reference_date) = context(scope, body.context)?;
    let filters = body
        .filters
        .into_iter()
        .map(|value| filter(scope, value))
        .collect::<Result<Vec<_>, _>>()?;
    let sorts = body
        .sorts
        .into_iter()
        .map(|value| sort(scope, value))
        .collect::<Result<Vec<_>, _>>()?;
    let group_settings = TodoTableGroupSettings::new(
        group(scope, body.group_by)?,
        body.group_settings.sort,
        body.group_settings.hide_empty,
        body.group_settings.manual_order,
        body.group_settings.hidden_group_keys,
    )?;
    let query = TodoTableQuery::new(
        scope,
        context,
        body.offset,
        body.limit,
        body.filter_mode,
        filters,
        sorts,
        group_settings,
        reference_date,
    )?;
    let page = with_service(&state, |service| service.query_table(&query))?;
    Ok(Json(json!(page)))
}

pub(super) async fn table_lookups(
    State(state): State<ApiState>,
    query: Result<Query<TableLookupQuery>, QueryRejection>,
) -> ApiResult<Json<Value>> {
    let Query(query) = query.map_err(|error| TodoError::Validation(error.body_text()))?;
    let items = with_service(&state, |service| {
        service.table_lookups(query.scope.application())
    })?;
    Ok(Json(json!({"items": items})))
}

fn context(
    scope: TodoTableScope,
    body: TableContextBody,
) -> Result<(TableContext, Option<Date>), TodoError> {
    match (scope, body) {
        (TodoTableScope::Workspace(_), TableContextBody::Workspace(body)) => Ok((
            TableContext::Workspace,
            parse_optional_date(body.reference_date.as_deref())?,
        )),
        (TodoTableScope::Planner(_), TableContextBody::Planner(body)) => Ok((
            TableContext::Planner {
                from: parse_date(&body.from)?,
                to: parse_date(&body.to)?,
            },
            parse_optional_date(body.reference_date.as_deref())?,
        )),
        (
            TodoTableScope::Linked { .. },
            TableContextBody::Linked(LinkedContextBody {
                parent_type,
                parent_id,
                reference_date,
            }),
        ) => Ok((
            TableContext::Linked {
                parent_type,
                parent_id,
            },
            parse_optional_date(reference_date.as_deref())?,
        )),
        _ => Err(validation()),
    }
}

fn parse_optional_date(value: Option<&str>) -> Result<Option<Date>, TodoError> {
    value.map(parse_date).transpose()
}

fn parse_date(value: &str) -> Result<Date, TodoError> {
    Date::parse(
        value,
        time::macros::format_description!("[year]-[month]-[day]"),
    )
    .map_err(|_| validation())
}

fn filter(scope: TodoTableScope, body: TableFilterBody) -> Result<TodoTableFilter, TodoError> {
    let value = match body.value {
        FilterValueBody::Text(value) => TodoTableFilterValue::Text(value.text),
        FilterValueBody::List(value) => TodoTableFilterValue::TextList(value.list),
        FilterValueBody::Range(value) => TodoTableFilterValue::Range {
            start: value.range.start,
            end: value.range.end,
        },
        FilterValueBody::Relative(value) => TodoTableFilterValue::Relative {
            amount: value.relative.amount,
            unit: value.relative.unit,
        },
        FilterValueBody::Empty(value) if value.empty => TodoTableFilterValue::Empty,
        FilterValueBody::Empty(_) => return Err(validation()),
    };
    match scope {
        TodoTableScope::Planner(_) => Ok(TodoTableFilter::Planner {
            field: planner_filter(body.field),
            operator: body.operator,
            value,
        }),
        _ => Ok(TodoTableFilter::Workspace {
            field: workspace_filter(body.field),
            operator: body.operator,
            value,
        }),
    }
}

fn sort(scope: TodoTableScope, body: TableSortBody) -> Result<TodoTableSort, TodoError> {
    Ok(match scope {
        TodoTableScope::Planner(_) => TodoTableSort::Planner {
            field: planner_sort(body.field),
            direction: body.direction,
        },
        _ => TodoTableSort::Workspace {
            field: workspace_sort(body.field),
            direction: body.direction,
        },
    })
}

fn group(scope: TodoTableScope, field: GroupField) -> Result<TodoTableGroup, TodoError> {
    Ok(match scope {
        TodoTableScope::Planner(_) => TodoTableGroup::Planner(match field {
            GroupField::None => PlannerTableGroup::None,
            GroupField::Area => PlannerTableGroup::Area,
            GroupField::Project => PlannerTableGroup::Project,
            GroupField::Routine => PlannerTableGroup::Routine,
            GroupField::Tag => PlannerTableGroup::Tag,
            GroupField::Status => PlannerTableGroup::Status,
            GroupField::Month => PlannerTableGroup::Month,
            GroupField::Week => PlannerTableGroup::Week,
            GroupField::Day => PlannerTableGroup::Day,
            GroupField::ItemType => PlannerTableGroup::ItemType,
        }),
        _ => TodoTableGroup::Workspace(match field {
            GroupField::None => WorkspaceTableGroup::None,
            GroupField::Area => WorkspaceTableGroup::Area,
            GroupField::Project => WorkspaceTableGroup::Project,
            GroupField::Routine => WorkspaceTableGroup::Routine,
            GroupField::Tag => WorkspaceTableGroup::Tag,
            GroupField::Status => WorkspaceTableGroup::Status,
            _ => return Err(validation()),
        }),
    })
}

macro_rules! map_fields {
    ($workspace:ident, $planner:ident, $source:ty, [$($field:ident),+ $(,)?]) => {
        fn $workspace(field: $source) -> WorkspaceFilterField {
            match field { $(<$source>::$field => WorkspaceFilterField::$field),+ }
        }
        fn $planner(field: $source) -> PlannerFilterField {
            match field { $(<$source>::$field => PlannerFilterField::$field),+ }
        }
    };
}

map_fields!(
    workspace_filter,
    planner_filter,
    FilterField,
    [
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
        CommitmentType
    ]
);

fn workspace_sort(field: SortField) -> WorkspaceSortField {
    match field {
        SortField::Title => WorkspaceSortField::Title,
        SortField::Status => WorkspaceSortField::Status,
        SortField::Tags => WorkspaceSortField::Tags,
        SortField::Note => WorkspaceSortField::Note,
        SortField::Area => WorkspaceSortField::Area,
        SortField::Due => WorkspaceSortField::Due,
        SortField::Horizon => WorkspaceSortField::Horizon,
        SortField::Scheduled => WorkspaceSortField::Scheduled,
        SortField::Parent => WorkspaceSortField::Parent,
        SortField::Project => WorkspaceSortField::Project,
        SortField::RecurrenceRule => WorkspaceSortField::RecurrenceRule,
        SortField::MaterializationPolicy => WorkspaceSortField::MaterializationPolicy,
        SortField::Priority => WorkspaceSortField::Priority,
        SortField::Description => WorkspaceSortField::Description,
        SortField::Routine => WorkspaceSortField::Routine,
        SortField::Location => WorkspaceSortField::Location,
        SortField::Participants => WorkspaceSortField::Participants,
        SortField::CommitmentType => WorkspaceSortField::CommitmentType,
        SortField::Updated => WorkspaceSortField::Updated,
    }
}

fn planner_sort(field: SortField) -> PlannerSortField {
    match field {
        SortField::Title => PlannerSortField::Title,
        SortField::Status => PlannerSortField::Status,
        SortField::Tags => PlannerSortField::Tags,
        SortField::Note => PlannerSortField::Note,
        SortField::Area => PlannerSortField::Area,
        SortField::Due => PlannerSortField::Due,
        SortField::Horizon => PlannerSortField::Horizon,
        SortField::Scheduled => PlannerSortField::Scheduled,
        SortField::Parent => PlannerSortField::Parent,
        SortField::Project => PlannerSortField::Project,
        SortField::RecurrenceRule => PlannerSortField::RecurrenceRule,
        SortField::MaterializationPolicy => PlannerSortField::MaterializationPolicy,
        SortField::Priority => PlannerSortField::Priority,
        SortField::Description => PlannerSortField::Description,
        SortField::Routine => PlannerSortField::Routine,
        SortField::Location => PlannerSortField::Location,
        SortField::Participants => PlannerSortField::Participants,
        SortField::CommitmentType => PlannerSortField::CommitmentType,
        SortField::Updated => PlannerSortField::Updated,
    }
}

fn validation() -> TodoError {
    TodoError::Validation("invalid table request".into())
}
