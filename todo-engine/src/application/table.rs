use serde::{Deserialize, Serialize};
use time::{Date, OffsetDateTime};

use crate::application::error::{TodoError, TodoResult};
use crate::domain::{ItemStatus, ItemType, TodoItem};

pub const TABLE_PAGE_LIMIT: u16 = 50;
const MAX_FILTERS: usize = 50;
const MAX_SORTS: usize = 10;
const MAX_TEXT_BYTES: usize = 512;
const MAX_VALUES: usize = 100;
const MAX_GROUP_KEYS: usize = 100;
const MAX_GROUP_KEY_BYTES: usize = 256;
const MAX_PARENT_ID_BYTES: usize = 512;
const MAX_RELATIVE_DATE_AMOUNT: u32 = 100_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceTableScope {
    Area,
    Project,
    Goal,
    Routine,
    Task,
    Event,
}

impl TryFrom<ItemType> for WorkspaceTableScope {
    type Error = TodoError;

    fn try_from(value: ItemType) -> Result<Self, Self::Error> {
        match value {
            ItemType::Area => Ok(Self::Area),
            ItemType::Project => Ok(Self::Project),
            ItemType::Goal => Ok(Self::Goal),
            ItemType::Routine => Ok(Self::Routine),
            ItemType::Task => Ok(Self::Task),
            ItemType::Event => Ok(Self::Event),
            ItemType::Review | ItemType::ArchiveItem => {
                Err(validation("item type has no workspace table"))
            }
        }
    }
}

impl WorkspaceTableScope {
    pub const fn item_type(self) -> ItemType {
        match self {
            Self::Area => ItemType::Area,
            Self::Project => ItemType::Project,
            Self::Goal => ItemType::Goal,
            Self::Routine => ItemType::Routine,
            Self::Task => ItemType::Task,
            Self::Event => ItemType::Event,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PlannerTableScope {
    YearlyPeriodGoals,
    YearlyMonthGoals,
    MonthlyPeriodGoals,
    MonthlyCalendar,
    MonthlyWeekGoals,
    WeeklyMonthGoals,
    WeeklyWeekGoals,
    WeeklyDayGrid,
    DailyToday,
    DailyOverdue,
    DailyUnscheduled,
}

impl PlannerTableScope {
    pub const fn is_goal_table(self) -> bool {
        matches!(
            self,
            Self::YearlyPeriodGoals
                | Self::YearlyMonthGoals
                | Self::MonthlyPeriodGoals
                | Self::MonthlyWeekGoals
                | Self::WeeklyMonthGoals
                | Self::WeeklyWeekGoals
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TodoTableScope {
    Workspace(WorkspaceTableScope),
    Planner(PlannerTableScope),
    Linked { parent: ItemType, child: ItemType },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TableContext {
    Workspace,
    Planner {
        from: Date,
        to: Date,
    },
    Linked {
        parent_type: ItemType,
        parent_id: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterMode {
    And,
    Or,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TodoFilterOperator {
    Is,
    IsNot,
    Contains,
    DoesNotContain,
    StartsWith,
    EndsWith,
    IsBefore,
    IsAfter,
    IsOnOrBefore,
    IsOnOrAfter,
    IsBetween,
    IsRelativeToToday,
    GreaterThan,
    LessThan,
    IsEmpty,
    IsNotEmpty,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TodoTableFilterValue {
    Text(String),
    TextList(Vec<String>),
    Range {
        start: String,
        end: String,
    },
    Relative {
        amount: String,
        unit: RelativeDateUnit,
    },
    Empty,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RelativeDateUnit {
    Day,
    Week,
    Month,
}

macro_rules! item_fields {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
        #[serde(rename_all = "snake_case")]
        pub enum $name {
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
    };
}

item_fields!(WorkspaceFilterField);
item_fields!(PlannerFilterField);

macro_rules! sort_fields {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
        #[serde(rename_all = "snake_case")]
        pub enum $name {
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
    };
}

sort_fields!(WorkspaceSortField);
sort_fields!(PlannerSortField);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "surface", rename_all = "snake_case")]
pub enum TodoTableFilter {
    Workspace {
        field: WorkspaceFilterField,
        operator: TodoFilterOperator,
        value: TodoTableFilterValue,
    },
    Planner {
        field: PlannerFilterField,
        operator: TodoFilterOperator,
        value: TodoTableFilterValue,
    },
}

impl TodoTableFilter {
    pub fn values(&self) -> &[String] {
        match self.value() {
            TodoTableFilterValue::TextList(values) => values,
            _ => &[],
        }
    }

    fn value(&self) -> &TodoTableFilterValue {
        match self {
            Self::Workspace { value, .. } | Self::Planner { value, .. } => value,
        }
    }

    fn value_mut(&mut self) -> &mut TodoTableFilterValue {
        match self {
            Self::Workspace { value, .. } | Self::Planner { value, .. } => value,
        }
    }

    fn operator(&self) -> TodoFilterOperator {
        match self {
            Self::Workspace { operator, .. } | Self::Planner { operator, .. } => *operator,
        }
    }

    fn is_relative(&self) -> bool {
        self.operator() == TodoFilterOperator::IsRelativeToToday
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortDirection {
    Asc,
    Desc,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "surface", rename_all = "snake_case")]
pub enum TodoTableSort {
    Workspace {
        field: WorkspaceSortField,
        direction: SortDirection,
    },
    Planner {
        field: PlannerSortField,
        direction: SortDirection,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceTableGroup {
    None,
    Area,
    Project,
    Routine,
    Tag,
    Status,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PlannerTableGroup {
    None,
    Area,
    Project,
    Routine,
    Tag,
    ItemType,
    Status,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "surface", content = "field", rename_all = "snake_case")]
pub enum TodoTableGroup {
    Workspace(WorkspaceTableGroup),
    Planner(PlannerTableGroup),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GroupSort {
    Manual,
    Alphabetical,
    ReverseAlphabetical,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TodoTableGroupSettings {
    group_by: TodoTableGroup,
    sort: GroupSort,
    hide_empty: bool,
    manual_order: Vec<String>,
    hidden_group_keys: Vec<String>,
}

impl TodoTableGroupSettings {
    pub fn new(
        group_by: TodoTableGroup,
        sort: GroupSort,
        hide_empty: bool,
        manual_order: Vec<String>,
        hidden_group_keys: Vec<String>,
    ) -> TodoResult<Self> {
        Ok(Self {
            group_by,
            sort,
            hide_empty,
            manual_order: validated_group_keys(manual_order)?,
            hidden_group_keys: validated_group_keys(hidden_group_keys)?,
        })
    }

    pub const fn group_by(&self) -> TodoTableGroup {
        self.group_by
    }
    pub const fn sort(&self) -> GroupSort {
        self.sort
    }
    pub const fn hide_empty(&self) -> bool {
        self.hide_empty
    }
    pub fn manual_order(&self) -> &[String] {
        &self.manual_order
    }
    pub fn hidden_group_keys(&self) -> &[String] {
        &self.hidden_group_keys
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TodoTableQuery {
    scope: TodoTableScope,
    context: TableContext,
    offset: u32,
    limit: u16,
    filter_mode: FilterMode,
    filters: Vec<TodoTableFilter>,
    sorts: Vec<TodoTableSort>,
    group_settings: TodoTableGroupSettings,
    reference_date: Option<Date>,
}

impl TodoTableQuery {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        scope: TodoTableScope,
        context: TableContext,
        offset: u32,
        limit: u16,
        filter_mode: FilterMode,
        mut filters: Vec<TodoTableFilter>,
        sorts: Vec<TodoTableSort>,
        group_settings: TodoTableGroupSettings,
        reference_date: Option<Date>,
    ) -> TodoResult<Self> {
        if !(1..=TABLE_PAGE_LIMIT).contains(&limit) {
            return Err(validation("limit must be between 1 and 50"));
        }
        if filters.len() > MAX_FILTERS || sorts.len() > MAX_SORTS {
            return Err(validation("too many table rules"));
        }
        validate_context(scope, &context)?;
        for filter in &mut filters {
            normalize_filter_value(filter.value_mut())?;
            if !filter_valid_for_scope(filter, scope) {
                return Err(validation("filter is invalid for table scope"));
            }
        }
        if sorts.iter().any(|sort| !sort_valid_for_scope(*sort, scope)) {
            return Err(validation("sort is invalid for table scope"));
        }
        if !group_valid_for_scope(group_settings.group_by(), scope) {
            return Err(validation("group is invalid for table scope"));
        }
        if filters.iter().any(TodoTableFilter::is_relative) && reference_date.is_none() {
            return Err(validation(
                "relative date filters require a local reference date",
            ));
        }
        Ok(Self {
            scope,
            context,
            offset,
            limit,
            filter_mode,
            filters,
            sorts,
            group_settings,
            reference_date,
        })
    }

    pub const fn scope(&self) -> TodoTableScope {
        self.scope
    }
    pub const fn context(&self) -> &TableContext {
        &self.context
    }
    pub const fn offset(&self) -> u32 {
        self.offset
    }
    pub const fn limit(&self) -> u16 {
        self.limit
    }
    pub const fn filter_mode(&self) -> FilterMode {
        self.filter_mode
    }
    pub fn filters(&self) -> &[TodoTableFilter] {
        &self.filters
    }
    pub fn sorts(&self) -> &[TodoTableSort] {
        &self.sorts
    }
    pub const fn group_settings(&self) -> &TodoTableGroupSettings {
        &self.group_settings
    }
    pub const fn reference_date(&self) -> Option<Date> {
        self.reference_date
    }
}

fn validate_context(scope: TodoTableScope, context: &TableContext) -> TodoResult<()> {
    match (scope, context) {
        (TodoTableScope::Workspace(_), TableContext::Workspace) => Ok(()),
        (TodoTableScope::Planner(_), TableContext::Planner { from, to }) if from <= to => Ok(()),
        (
            TodoTableScope::Linked { parent, child },
            TableContext::Linked {
                parent_type,
                parent_id,
            },
        ) if parent == *parent_type
            && valid_link(parent, child)
            && !parent_id.is_empty()
            && parent_id.len() <= MAX_PARENT_ID_BYTES =>
        {
            Ok(())
        }
        _ => Err(validation("table context does not match scope")),
    }
}

const fn valid_link(parent: ItemType, child: ItemType) -> bool {
    matches!(
        (parent, child),
        (
            ItemType::Area,
            ItemType::Project | ItemType::Routine | ItemType::Task | ItemType::Event
        ) | (
            ItemType::Project,
            ItemType::Routine | ItemType::Task | ItemType::Event
        ) | (ItemType::Routine, ItemType::Task)
            | (ItemType::Goal, ItemType::Goal | ItemType::Task)
    )
}

fn filter_valid_for_scope(filter: &TodoTableFilter, scope: TodoTableScope) -> bool {
    let (field_type, operator, value) = match filter {
        TodoTableFilter::Workspace {
            field,
            operator,
            value,
        } if workspace_field_allowed(*field, workspace_scope(scope)) => {
            (workspace_field_type(*field), *operator, value)
        }
        TodoTableFilter::Planner {
            field,
            operator,
            value,
        } if planner_field_allowed(*field, planner_scope(scope)) => {
            (planner_field_type(*field), *operator, value)
        }
        _ => return false,
    };
    field_type.accepts(operator, value)
}

fn sort_valid_for_scope(sort: TodoTableSort, scope: TodoTableScope) -> bool {
    match sort {
        TodoTableSort::Workspace { field, .. } => {
            workspace_sort_allowed(field, workspace_scope(scope))
        }
        TodoTableSort::Planner { field, .. } => planner_sort_allowed(field, planner_scope(scope)),
    }
}

fn group_valid_for_scope(group: TodoTableGroup, scope: TodoTableScope) -> bool {
    match group {
        TodoTableGroup::Workspace(field) => workspace_group_allowed(field, workspace_scope(scope)),
        TodoTableGroup::Planner(field) => planner_group_allowed(field, planner_scope(scope)),
    }
}

fn workspace_scope(scope: TodoTableScope) -> Option<WorkspaceTableScope> {
    match scope {
        TodoTableScope::Workspace(scope) => Some(scope),
        TodoTableScope::Linked { child, .. } => WorkspaceTableScope::try_from(child).ok(),
        TodoTableScope::Planner(_) => None,
    }
}

fn planner_scope(scope: TodoTableScope) -> Option<PlannerTableScope> {
    match scope {
        TodoTableScope::Planner(scope) => Some(scope),
        _ => None,
    }
}

macro_rules! one_of {
    ($value:expr; $($pattern:pat_param)|+ $(,)?) => { matches!($value, $($pattern)|+) };
}

fn workspace_field_allowed(
    field: WorkspaceFilterField,
    scope: Option<WorkspaceTableScope>,
) -> bool {
    use WorkspaceFilterField as F;
    match scope {
        Some(WorkspaceTableScope::Area) => one_of!(field; F::Title | F::Status | F::Tags | F::Note),
        Some(WorkspaceTableScope::Project) => {
            one_of!(field; F::Title | F::Status | F::Tags | F::Area | F::Due | F::Note)
        }
        Some(WorkspaceTableScope::Goal) => {
            one_of!(field; F::Title | F::Status | F::Tags | F::Horizon | F::Scheduled | F::Parent | F::Note)
        }
        Some(WorkspaceTableScope::Routine) => {
            one_of!(field; F::Title | F::Status | F::Tags | F::Area | F::Project | F::RecurrenceRule | F::MaterializationPolicy | F::Priority | F::Description | F::Note)
        }
        Some(WorkspaceTableScope::Task) => {
            one_of!(field; F::Title | F::Status | F::Tags | F::Area | F::Project | F::Routine | F::Scheduled | F::Due | F::Priority | F::Description | F::Note)
        }
        Some(WorkspaceTableScope::Event) => {
            one_of!(field; F::Title | F::Status | F::Tags | F::Area | F::Project | F::Scheduled | F::Due | F::Priority | F::Location | F::Participants | F::CommitmentType | F::Description | F::Note)
        }
        None => false,
    }
}

fn planner_field_allowed(field: PlannerFilterField, scope: Option<PlannerTableScope>) -> bool {
    use PlannerFilterField as F;
    match scope {
        Some(scope) if scope.is_goal_table() => {
            one_of!(field; F::Title | F::Status | F::Tags | F::Horizon | F::Scheduled | F::Due | F::Parent | F::Note)
        }
        Some(_) => {
            one_of!(field; F::Title | F::Status | F::Tags | F::Area | F::Project | F::Routine | F::Scheduled | F::Due | F::Priority | F::RecurrenceRule | F::MaterializationPolicy | F::Location | F::Participants | F::CommitmentType | F::Description | F::Note)
        }
        None => false,
    }
}

fn workspace_sort_allowed(field: WorkspaceSortField, scope: Option<WorkspaceTableScope>) -> bool {
    if field == WorkspaceSortField::Updated {
        return scope.is_some();
    }
    workspace_field_allowed(workspace_filter_from_sort(field), scope)
}

fn planner_sort_allowed(field: PlannerSortField, scope: Option<PlannerTableScope>) -> bool {
    if field == PlannerSortField::Updated {
        return scope.is_some();
    }
    planner_field_allowed(planner_filter_from_sort(field), scope)
}

macro_rules! sort_to_filter {
    ($function:ident, $sort:ty, $filter:ty) => {
        fn $function(field: $sort) -> $filter {
            match field {
                <$sort>::Title => <$filter>::Title,
                <$sort>::Status => <$filter>::Status,
                <$sort>::Tags => <$filter>::Tags,
                <$sort>::Note => <$filter>::Note,
                <$sort>::Area => <$filter>::Area,
                <$sort>::Due => <$filter>::Due,
                <$sort>::Horizon => <$filter>::Horizon,
                <$sort>::Scheduled => <$filter>::Scheduled,
                <$sort>::Parent => <$filter>::Parent,
                <$sort>::Project => <$filter>::Project,
                <$sort>::RecurrenceRule => <$filter>::RecurrenceRule,
                <$sort>::MaterializationPolicy => <$filter>::MaterializationPolicy,
                <$sort>::Priority => <$filter>::Priority,
                <$sort>::Description => <$filter>::Description,
                <$sort>::Routine => <$filter>::Routine,
                <$sort>::Location => <$filter>::Location,
                <$sort>::Participants => <$filter>::Participants,
                <$sort>::CommitmentType => <$filter>::CommitmentType,
                <$sort>::Updated => unreachable!("updated is handled before conversion"),
            }
        }
    };
}

sort_to_filter!(
    workspace_filter_from_sort,
    WorkspaceSortField,
    WorkspaceFilterField
);
sort_to_filter!(
    planner_filter_from_sort,
    PlannerSortField,
    PlannerFilterField
);

fn workspace_group_allowed(field: WorkspaceTableGroup, scope: Option<WorkspaceTableScope>) -> bool {
    match scope {
        Some(WorkspaceTableScope::Area | WorkspaceTableScope::Goal) => {
            one_of!(field; WorkspaceTableGroup::None | WorkspaceTableGroup::Tag | WorkspaceTableGroup::Status)
        }
        Some(WorkspaceTableScope::Project) => {
            one_of!(field; WorkspaceTableGroup::None | WorkspaceTableGroup::Area | WorkspaceTableGroup::Tag | WorkspaceTableGroup::Status)
        }
        Some(WorkspaceTableScope::Event) => {
            one_of!(field; WorkspaceTableGroup::None | WorkspaceTableGroup::Area | WorkspaceTableGroup::Project | WorkspaceTableGroup::Tag | WorkspaceTableGroup::Status)
        }
        Some(WorkspaceTableScope::Routine) => {
            one_of!(field; WorkspaceTableGroup::None | WorkspaceTableGroup::Area | WorkspaceTableGroup::Project | WorkspaceTableGroup::Tag | WorkspaceTableGroup::Status)
        }
        Some(WorkspaceTableScope::Task) => {
            one_of!(field; WorkspaceTableGroup::None | WorkspaceTableGroup::Area | WorkspaceTableGroup::Project | WorkspaceTableGroup::Routine | WorkspaceTableGroup::Tag | WorkspaceTableGroup::Status)
        }
        None => false,
    }
}

fn planner_group_allowed(field: PlannerTableGroup, scope: Option<PlannerTableScope>) -> bool {
    match scope {
        Some(scope) if scope.is_goal_table() => {
            one_of!(field; PlannerTableGroup::None | PlannerTableGroup::Tag | PlannerTableGroup::Status)
        }
        Some(_) => true,
        None => false,
    }
}

#[derive(Clone, Copy)]
enum FieldType {
    Text,
    Date,
    Number,
    Select,
    MultiSelect,
    Relation,
}

fn workspace_field_type(field: WorkspaceFilterField) -> FieldType {
    use WorkspaceFilterField as F;
    match field {
        F::Scheduled | F::Due => FieldType::Date,
        F::Priority => FieldType::Number,
        F::Status | F::Horizon | F::MaterializationPolicy => FieldType::Select,
        F::Tags | F::Participants => FieldType::MultiSelect,
        F::Area | F::Project | F::Routine | F::Parent => FieldType::Relation,
        _ => FieldType::Text,
    }
}

fn planner_field_type(field: PlannerFilterField) -> FieldType {
    use PlannerFilterField as F;
    match field {
        F::Scheduled | F::Due => FieldType::Date,
        F::Priority => FieldType::Number,
        F::Status | F::Horizon | F::MaterializationPolicy => FieldType::Select,
        F::Tags | F::Participants => FieldType::MultiSelect,
        F::Area | F::Project | F::Routine | F::Parent => FieldType::Relation,
        _ => FieldType::Text,
    }
}

impl FieldType {
    fn accepts(self, operator: TodoFilterOperator, value: &TodoTableFilterValue) -> bool {
        use TodoFilterOperator as O;
        if one_of!(operator; O::IsEmpty | O::IsNotEmpty) {
            return matches!(value, TodoTableFilterValue::Empty);
        }
        match self {
            Self::Text => {
                one_of!(operator; O::Contains | O::DoesNotContain | O::Is | O::IsNot | O::StartsWith | O::EndsWith)
                    && valid_text(value)
            }
            Self::Date => valid_date_filter(operator, value),
            Self::Number => {
                one_of!(operator; O::Is | O::IsNot | O::GreaterThan | O::LessThan)
                    && valid_number(value)
            }
            Self::Select | Self::MultiSelect | Self::Relation => {
                one_of!(operator; O::Is | O::IsNot | O::Contains | O::DoesNotContain)
                    && valid_list(value)
            }
        }
    }
}

fn normalize_filter_value(value: &mut TodoTableFilterValue) -> TodoResult<()> {
    if let TodoTableFilterValue::TextList(values) = value {
        let mut unique = Vec::with_capacity(values.len());
        for value in values.drain(..) {
            if !unique.contains(&value) {
                unique.push(value);
            }
        }
        *values = unique;
    }
    Ok(())
}

fn valid_text(value: &TodoTableFilterValue) -> bool {
    matches!(value, TodoTableFilterValue::Text(value) if bounded(value))
}

fn valid_number(value: &TodoTableFilterValue) -> bool {
    matches!(value, TodoTableFilterValue::Text(value) if bounded(value) && value.parse::<f64>().is_ok_and(f64::is_finite))
}

fn valid_list(value: &TodoTableFilterValue) -> bool {
    matches!(value, TodoTableFilterValue::TextList(values) if !values.is_empty() && values.len() <= MAX_VALUES && values.iter().all(|value| bounded(value)))
}

fn valid_date_filter(operator: TodoFilterOperator, value: &TodoTableFilterValue) -> bool {
    use TodoFilterOperator as O;
    match operator {
        O::Is | O::IsNot | O::IsBefore | O::IsAfter | O::IsOnOrBefore | O::IsOnOrAfter => {
            matches!(value, TodoTableFilterValue::Text(value) if parse_date(value).is_some())
        }
        O::IsBetween => {
            matches!(value, TodoTableFilterValue::Range { start, end } if parse_date(start).zip(parse_date(end)).is_some_and(|(start, end)| start <= end))
        }
        O::IsRelativeToToday => {
            matches!(value, TodoTableFilterValue::Relative { amount, .. } if bounded(amount) && amount.bytes().all(|byte| byte.is_ascii_digit()) && amount.parse::<u32>().is_ok_and(|amount| amount <= MAX_RELATIVE_DATE_AMOUNT))
        }
        _ => false,
    }
}

fn parse_date(value: &str) -> Option<Date> {
    Date::parse(
        value,
        time::macros::format_description!("[year]-[month]-[day]"),
    )
    .ok()
}

fn bounded(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_TEXT_BYTES
}

fn validated_group_keys(values: Vec<String>) -> TodoResult<Vec<String>> {
    if values.len() > MAX_GROUP_KEYS
        || values
            .iter()
            .any(|value| value.is_empty() || value.len() > MAX_GROUP_KEY_BYTES)
    {
        return Err(validation(
            "group keys must be non-empty, bounded, and no more than 100 entries",
        ));
    }
    let mut unique = Vec::with_capacity(values.len());
    for value in values {
        if !unique.contains(&value) {
            unique.push(value);
        }
    }
    Ok(unique)
}

/// Keeps ordinary saved-view keys stable while escaping sentinel, slash, and control values.
pub fn canonical_group_value(value: &str) -> String {
    if value != "none"
        && value != "untagged"
        && !value
            .chars()
            .any(|character| character == '\\' || character.is_control())
    {
        return value.to_string();
    }
    let mut encoded = String::from("\\");
    for character in value.chars() {
        match character {
            '\\' => encoded.push_str("\\\\"),
            character if character.is_control() => {
                encoded.push_str(&format!("\\u{:x};", character as u32));
            }
            character => encoded.push(character),
        }
    }
    encoded
}

pub const fn missing_group(group: TodoTableGroup) -> Option<(&'static str, &'static str)> {
    match group {
        TodoTableGroup::Workspace(WorkspaceTableGroup::Area)
        | TodoTableGroup::Planner(PlannerTableGroup::Area) => Some(("none", "No area")),
        TodoTableGroup::Workspace(WorkspaceTableGroup::Project)
        | TodoTableGroup::Planner(PlannerTableGroup::Project) => Some(("none", "No project")),
        TodoTableGroup::Workspace(WorkspaceTableGroup::Routine)
        | TodoTableGroup::Planner(PlannerTableGroup::Routine) => Some(("none", "No routine")),
        TodoTableGroup::Workspace(WorkspaceTableGroup::Tag)
        | TodoTableGroup::Planner(PlannerTableGroup::Tag) => Some(("untagged", "Untagged")),
        _ => None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TodoTableMetadata {
    pub location: Option<String>,
    pub participants: Vec<String>,
    pub commitment_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TodoTableRecord {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: ItemType,
    pub title: String,
    pub status: ItemStatus,
    pub tags: Vec<String>,
    pub area_id: Option<String>,
    pub project_id: Option<String>,
    pub routine_id: Option<String>,
    pub parent_id: Option<String>,
    pub description: Option<String>,
    pub note: Option<String>,
    pub outcome: Option<String>,
    pub definition_of_done: Option<String>,
    pub standard: Option<String>,
    pub review_cycle: Option<String>,
    pub recurrence_rule: Option<String>,
    pub materialization_policy: String,
    pub future_occurrences: i64,
    pub priority: Option<i64>,
    pub due: Option<String>,
    pub scheduled: Option<String>,
    pub horizon: Option<String>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub completed_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_materialized_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
    #[serde(rename = "metadata_")]
    pub metadata: TodoTableMetadata,
}

impl TodoTableRecord {
    pub fn new(item: TodoItem) -> TodoResult<Self> {
        if item.id.is_empty() || item.id.len() > MAX_TEXT_BYTES {
            return Err(validation("table record id is invalid"));
        }
        let metadata = TodoTableMetadata {
            location: metadata_string(&item, "location"),
            participants: item
                .metadata
                .get("participants")
                .and_then(serde_json::Value::as_array)
                .map(|values| {
                    values
                        .iter()
                        .filter_map(serde_json::Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default(),
            commitment_type: metadata_string(&item, "commitment_type"),
        };
        Ok(Self {
            id: item.id,
            item_type: item.item_type,
            title: item.title,
            status: item.status,
            tags: item.tags,
            area_id: item.area_id,
            project_id: item.project_id,
            routine_id: item.routine_id,
            parent_id: item.parent_id,
            description: item.description,
            note: item.note,
            outcome: item.outcome,
            definition_of_done: item.definition_of_done,
            standard: item.standard,
            review_cycle: item.review_cycle,
            recurrence_rule: item.recurrence_rule,
            materialization_policy: item.materialization_policy,
            future_occurrences: item.future_occurrences,
            priority: item.priority,
            due: item.due,
            scheduled: item.scheduled,
            horizon: item.horizon,
            completed_at: item.completed_at,
            last_materialized_at: item.last_materialized_at,
            created_at: item.created_at,
            updated_at: item.updated_at,
            metadata,
        })
    }

    pub fn logical_id(&self) -> &str {
        &self.id
    }
}

fn metadata_string(item: &TodoItem, key: &str) -> Option<String> {
    item.metadata
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TodoTableRow {
    key: String,
    group_key: Option<String>,
    group_label: Option<String>,
    record: TodoTableRecord,
}

impl TodoTableRow {
    pub fn new(
        group_key: Option<String>,
        group_label: Option<String>,
        record: TodoTableRecord,
    ) -> TodoResult<Self> {
        if group_key.is_some() != group_label.is_some()
            || group_key
                .as_deref()
                .is_some_and(|key| key.is_empty() || key.len() > MAX_GROUP_KEY_BYTES)
        {
            return Err(validation("group key and label must be valid and paired"));
        }
        let group = group_key.as_deref().unwrap_or_default();
        let key = format!("{}:{group}:{}", group.len(), record.logical_id());
        Ok(Self {
            key,
            group_key,
            group_label,
            record,
        })
    }

    pub fn key(&self) -> &str {
        &self.key
    }
    pub fn group_key(&self) -> Option<&str> {
        self.group_key.as_deref()
    }
    pub fn group_label(&self) -> Option<&str> {
        self.group_label.as_deref()
    }
    pub const fn record(&self) -> &TodoTableRecord {
        &self.record
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TodoTableLookup {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: ItemType,
    pub title: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TablePage<T> {
    pub items: Vec<T>,
    pub next_offset: Option<u32>,
}

impl<T> TablePage<T> {
    pub fn from_limit_plus_one(mut items: Vec<T>, offset: u32, limit: u16) -> TodoResult<Self> {
        if !(1..=TABLE_PAGE_LIMIT).contains(&limit) {
            return Err(validation("limit must be between 1 and 50"));
        }
        let has_more = items.len() > usize::from(limit);
        items.truncate(usize::from(limit));
        let next_offset = if has_more {
            Some(
                offset
                    .checked_add(u32::from(limit))
                    .ok_or_else(|| validation("next table offset exceeds the supported range"))?,
            )
        } else {
            None
        };
        Ok(Self { items, next_offset })
    }
}

fn validation(message: impl Into<String>) -> TodoError {
    TodoError::Validation(message.into())
}
