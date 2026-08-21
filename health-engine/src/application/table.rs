use serde::{Deserialize, Serialize};
use time::{Date, OffsetDateTime, macros::format_description};

use crate::application::{
    error::{HealthError, HealthResult},
    media::MediaStore,
    ports::HealthReadRepository,
    service::HealthService,
};
use crate::domain::{DietEntry, HealthEvent, normalize_tags};

pub const TABLE_PAGE_LIMIT: u16 = 50;
const MAX_FILTERS: usize = 50;
const MAX_SORTS: usize = 10;
const MAX_TEXT: usize = 512;
const MAX_VALUES: usize = 100;
const MAX_GROUP_KEYS: usize = 100;
const MAX_GROUP_KEY: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HealthTableScope {
    #[serde(rename = "health.diet")]
    Diet,
    #[serde(rename = "health.bowel")]
    Bowel,
    #[serde(rename = "health.medication")]
    Medication,
    #[serde(rename = "health.metrics")]
    Metrics,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterMode {
    And,
    Or,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthFilterOperator {
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
pub enum HealthTableFilterValue {
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DietTableFilterField {
    Date,
    MealType,
    Food,
    Tags,
    HasPhoto,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BowelTableFilterField {
    Date,
    BristolScale,
    BloodVisible,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MedicationTableFilterField {
    Date,
    MedicationName,
    MedicationUnit,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetricsTableFilterField {
    Date,
    Weight,
    Sleep,
    Crp,
    Calprotectin,
    Condition,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "scope", rename_all = "snake_case")]
pub enum HealthTableFilter {
    Diet {
        field: DietTableFilterField,
        operator: HealthFilterOperator,
        value: HealthTableFilterValue,
    },
    Bowel {
        field: BowelTableFilterField,
        operator: HealthFilterOperator,
        value: HealthTableFilterValue,
    },
    Medication {
        field: MedicationTableFilterField,
        operator: HealthFilterOperator,
        value: HealthTableFilterValue,
    },
    Metrics {
        field: MetricsTableFilterField,
        operator: HealthFilterOperator,
        value: HealthTableFilterValue,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortDirection {
    Asc,
    Desc,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DietTableSortField {
    Date,
    MealType,
    Food,
    Created,
    Updated,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BowelTableSortField {
    Date,
    BristolScale,
    Created,
    Updated,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MedicationTableSortField {
    Date,
    MedicationName,
    Dose,
    Created,
    Updated,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetricsTableSortField {
    Date,
    Weight,
    Sleep,
    Crp,
    Calprotectin,
    Condition,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "scope", rename_all = "snake_case")]
pub enum HealthTableSort {
    Diet {
        field: DietTableSortField,
        direction: SortDirection,
    },
    Bowel {
        field: BowelTableSortField,
        direction: SortDirection,
    },
    Medication {
        field: MedicationTableSortField,
        direction: SortDirection,
    },
    Metrics {
        field: MetricsTableSortField,
        direction: SortDirection,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DietTableGroup {
    None,
    Month,
    Week,
    Day,
    MealType,
    Tag,
    HasPhoto,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BowelTableGroup {
    None,
    Month,
    Week,
    Day,
    BristolScale,
    BloodVisible,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MedicationTableGroup {
    None,
    Month,
    Week,
    Day,
    MedicationName,
    MedicationUnit,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MetricsTableGroup {
    None,
    Month,
    Week,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "scope", content = "field", rename_all = "snake_case")]
pub enum HealthTableGroup {
    Diet(DietTableGroup),
    Bowel(BowelTableGroup),
    Medication(MedicationTableGroup),
    Metrics(MetricsTableGroup),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GroupSort {
    Manual,
    Alphabetical,
    ReverseAlphabetical,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HealthTableGroupSettings {
    group_by: HealthTableGroup,
    sort: GroupSort,
    hide_empty: bool,
    manual_order: Vec<String>,
    hidden_group_keys: Vec<String>,
}
impl HealthTableGroupSettings {
    pub fn new(
        group_by: HealthTableGroup,
        sort: GroupSort,
        hide_empty: bool,
        manual_order: Vec<String>,
        hidden_group_keys: Vec<String>,
    ) -> HealthResult<Self> {
        Ok(Self {
            group_by,
            sort,
            hide_empty,
            manual_order: group_keys(manual_order)?,
            hidden_group_keys: group_keys(hidden_group_keys)?,
        })
    }
    pub const fn group_by(&self) -> HealthTableGroup {
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
pub struct HealthTableQuery {
    scope: HealthTableScope,
    offset: u32,
    limit: u16,
    filter_mode: FilterMode,
    filters: Vec<HealthTableFilter>,
    sorts: Vec<HealthTableSort>,
    group_settings: HealthTableGroupSettings,
    reference_date: Option<Date>,
}
impl HealthTableQuery {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        scope: HealthTableScope,
        offset: u32,
        limit: u16,
        filter_mode: FilterMode,
        mut filters: Vec<HealthTableFilter>,
        sorts: Vec<HealthTableSort>,
        group_settings: HealthTableGroupSettings,
        reference_date: Option<Date>,
    ) -> HealthResult<Self> {
        if !(1..=TABLE_PAGE_LIMIT).contains(&limit) {
            return Err(validation("limit", "must be between 1 and 50"));
        }
        if filters.len() > MAX_FILTERS {
            return Err(validation("filters", "too many filter rules"));
        }
        for filter in &mut filters {
            filter.normalize_tag_values()?;
        }
        if sorts.len() > MAX_SORTS {
            return Err(validation(
                "sorts",
                "no more than 10 sort rules are allowed",
            ));
        }
        if filters.iter().any(|f| f.scope() != scope || !f.valid()) {
            return Err(validation(
                "filters",
                "filter rule is invalid for its field",
            ));
        }
        if sorts.iter().any(|s| s.scope() != scope) {
            return Err(validation("sorts", "sort field does not match table scope"));
        }
        if group_settings.group_by().scope() != scope {
            return Err(validation(
                "group_settings",
                "group field does not match table scope",
            ));
        }
        if filters.iter().any(HealthTableFilter::relative) && reference_date.is_none() {
            return Err(validation(
                "reference_date",
                "a local reference date is required for relative date filters",
            ));
        }
        Ok(Self {
            scope,
            offset,
            limit,
            filter_mode,
            filters,
            sorts,
            group_settings,
            reference_date,
        })
    }
    pub const fn scope(&self) -> HealthTableScope {
        self.scope
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
    pub fn filters(&self) -> &[HealthTableFilter] {
        &self.filters
    }
    pub fn sorts(&self) -> &[HealthTableSort] {
        &self.sorts
    }
    pub const fn group_settings(&self) -> &HealthTableGroupSettings {
        &self.group_settings
    }
    pub const fn reference_date(&self) -> Option<Date> {
        self.reference_date
    }
}

#[derive(Clone, Copy)]
enum FieldType {
    Text,
    Date,
    Number,
    Select,
    Relation,
}
impl HealthTableFilter {
    fn normalize_tag_values(&mut self) -> HealthResult<()> {
        let Self::Diet {
            field: DietTableFilterField::Tags,
            value: HealthTableFilterValue::TextList(values),
            ..
        } = self
        else {
            return Ok(());
        };
        if values.is_empty()
            || values.len() > MAX_VALUES
            || values.iter().any(|value| !bounded(value))
        {
            return Err(validation("filters", "tag filter values are invalid"));
        }
        let normalized = normalize_tags(values.iter());
        if normalized.is_empty()
            || normalized.len() > MAX_VALUES
            || normalized.iter().any(|value| !bounded(value))
        {
            return Err(validation("filters", "tag filter values are invalid"));
        }
        *values = normalized;
        Ok(())
    }

    fn scope(&self) -> HealthTableScope {
        match self {
            Self::Diet { .. } => HealthTableScope::Diet,
            Self::Bowel { .. } => HealthTableScope::Bowel,
            Self::Medication { .. } => HealthTableScope::Medication,
            Self::Metrics { .. } => HealthTableScope::Metrics,
        }
    }
    fn relative(&self) -> bool {
        matches!(
            self,
            Self::Diet {
                field: DietTableFilterField::Date,
                operator: HealthFilterOperator::IsRelativeToToday,
                ..
            } | Self::Bowel {
                field: BowelTableFilterField::Date,
                operator: HealthFilterOperator::IsRelativeToToday,
                ..
            } | Self::Medication {
                field: MedicationTableFilterField::Date,
                operator: HealthFilterOperator::IsRelativeToToday,
                ..
            } | Self::Metrics {
                field: MetricsTableFilterField::Date,
                operator: HealthFilterOperator::IsRelativeToToday,
                ..
            }
        )
    }
    fn valid(&self) -> bool {
        let (ty, op, value) = match self {
            Self::Diet {
                field,
                operator,
                value,
            } => (
                match field {
                    DietTableFilterField::Date => FieldType::Date,
                    DietTableFilterField::Food => FieldType::Text,
                    DietTableFilterField::MealType | DietTableFilterField::HasPhoto => {
                        FieldType::Select
                    }
                    DietTableFilterField::Tags => FieldType::Relation,
                },
                *operator,
                value,
            ),
            Self::Bowel {
                field,
                operator,
                value,
            } => (
                match field {
                    BowelTableFilterField::Date => FieldType::Date,
                    BowelTableFilterField::BristolScale | BowelTableFilterField::BloodVisible => {
                        FieldType::Select
                    }
                },
                *operator,
                value,
            ),
            Self::Medication {
                field,
                operator,
                value,
            } => (
                match field {
                    MedicationTableFilterField::Date => FieldType::Date,
                    MedicationTableFilterField::MedicationName => FieldType::Text,
                    MedicationTableFilterField::MedicationUnit => FieldType::Select,
                },
                *operator,
                value,
            ),
            Self::Metrics {
                field,
                operator,
                value,
            } => (
                match field {
                    MetricsTableFilterField::Date => FieldType::Date,
                    _ => FieldType::Number,
                },
                *operator,
                value,
            ),
        };
        ty.accepts(op, value)
    }
}
impl FieldType {
    fn accepts(self, op: HealthFilterOperator, value: &HealthTableFilterValue) -> bool {
        use HealthFilterOperator as O;
        if matches!(op, O::IsEmpty | O::IsNotEmpty) {
            return matches!(value, HealthTableFilterValue::Empty);
        }
        match self {
            Self::Text => {
                matches!(
                    op,
                    O::Contains
                        | O::DoesNotContain
                        | O::Is
                        | O::IsNot
                        | O::StartsWith
                        | O::EndsWith
                ) && text(value)
            }
            Self::Date => date_filter(op, value),
            Self::Number => {
                matches!(op, O::Is | O::IsNot | O::GreaterThan | O::LessThan) && number(value)
            }
            Self::Select | Self::Relation => {
                matches!(op, O::Is | O::IsNot | O::Contains | O::DoesNotContain) && list(value)
            }
        }
    }
}
fn bounded(v: &str) -> bool {
    !v.is_empty() && v.len() <= MAX_TEXT
}
fn text(v: &HealthTableFilterValue) -> bool {
    matches!(v,HealthTableFilterValue::Text(s) if bounded(s))
}
fn number(v: &HealthTableFilterValue) -> bool {
    matches!(v,HealthTableFilterValue::Text(s) if bounded(s)&&s.parse::<f64>().is_ok_and(f64::is_finite))
}
fn list(v: &HealthTableFilterValue) -> bool {
    matches!(v,HealthTableFilterValue::TextList(xs) if !xs.is_empty()&&xs.len()<=MAX_VALUES&&xs.iter().all(|x|bounded(x)))
}
fn date_filter(op: HealthFilterOperator, v: &HealthTableFilterValue) -> bool {
    use HealthFilterOperator as O;
    match op {
        O::Is | O::IsNot | O::IsBefore | O::IsAfter | O::IsOnOrBefore | O::IsOnOrAfter => {
            matches!(v,HealthTableFilterValue::Text(s) if parse_date(s).is_some())
        }
        O::IsBetween => {
            matches!(v,HealthTableFilterValue::Range{start,end} if parse_date(start).zip(parse_date(end)).is_some_and(|(a,b)|a<=b))
        }
        O::IsRelativeToToday => {
            matches!(v,HealthTableFilterValue::Relative{amount,..} if bounded(amount)&&amount.bytes().all(|b|b.is_ascii_digit())&&amount.parse::<u32>().is_ok_and(|n|n<=100_000))
        }
        _ => false,
    }
}
fn parse_date(v: &str) -> Option<Date> {
    Date::parse(v, format_description!("[year]-[month]-[day]")).ok()
}
fn group_keys(values: Vec<String>) -> HealthResult<Vec<String>> {
    if values.len() > MAX_GROUP_KEYS
        || values
            .iter()
            .any(|v| v.is_empty() || v.len() > MAX_GROUP_KEY)
    {
        return Err(validation(
            "group_settings",
            "group keys must be non-empty and bounded",
        ));
    }
    let mut out = Vec::new();
    for v in values {
        if !out.contains(&v) {
            out.push(v)
        }
    }
    Ok(out)
}
impl HealthTableSort {
    fn scope(&self) -> HealthTableScope {
        match self {
            Self::Diet { .. } => HealthTableScope::Diet,
            Self::Bowel { .. } => HealthTableScope::Bowel,
            Self::Medication { .. } => HealthTableScope::Medication,
            Self::Metrics { .. } => HealthTableScope::Metrics,
        }
    }
    pub const fn direction(&self) -> SortDirection {
        match self {
            Self::Diet { direction, .. }
            | Self::Bowel { direction, .. }
            | Self::Medication { direction, .. }
            | Self::Metrics { direction, .. } => *direction,
        }
    }
}
impl HealthTableGroup {
    fn scope(self) -> HealthTableScope {
        match self {
            Self::Diet(_) => HealthTableScope::Diet,
            Self::Bowel(_) => HealthTableScope::Bowel,
            Self::Medication(_) => HealthTableScope::Medication,
            Self::Metrics(_) => HealthTableScope::Metrics,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DietTableRecord {
    pub id: String,
    pub entry: DietEntry,
    pub date: String,
    pub meal_label: String,
    pub food: String,
    pub tags: Vec<String>,
    pub has_photo: bool,
    pub note: String,
}
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BowelTableRecord {
    pub id: String,
    pub event: HealthEvent,
    pub date: String,
    pub bristol_scale: u8,
    pub blood_visible: bool,
    pub blood_label: String,
    pub note: String,
}
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MedicationTableRecord {
    pub id: String,
    pub event: HealthEvent,
    pub date: String,
    pub medication_name: String,
    pub dose: f64,
    pub unit: String,
    pub unit_label: String,
    pub note: String,
}
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HealthMetricsTableRecord {
    pub id: String,
    pub date: String,
    pub events: Vec<HealthEvent>,
    pub weight: Option<f64>,
    pub sleep: Option<f64>,
    pub crp: Option<f64>,
    pub calprotectin: Option<f64>,
    pub condition: Option<f64>,
    pub note: String,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(untagged)]
pub enum HealthTableRecord {
    Diet(DietTableRecord),
    Bowel(BowelTableRecord),
    Medication(MedicationTableRecord),
    Metrics(HealthMetricsTableRecord),
}
impl HealthTableRecord {
    pub fn logical_id(&self) -> &str {
        match self {
            Self::Diet(r) => &r.id,
            Self::Bowel(r) => &r.id,
            Self::Medication(r) => &r.id,
            Self::Metrics(r) => &r.id,
        }
    }
}
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct HealthTableRow {
    key: String,
    group_key: Option<String>,
    group_label: Option<String>,
    record: HealthTableRecord,
}
impl HealthTableRow {
    pub fn new(
        group_key: Option<String>,
        group_label: Option<String>,
        record: HealthTableRecord,
    ) -> HealthResult<Self> {
        if group_key.is_some() != group_label.is_some() {
            return Err(validation(
                "group",
                "group key and label must both be present",
            ));
        }
        let group = group_key.as_deref().unwrap_or_default();
        if group_key.as_deref().is_some_and(str::is_empty)
            || group.len() > MAX_GROUP_KEY
            || record.logical_id().is_empty()
        {
            return Err(validation("row", "invalid row identity"));
        }
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
    pub const fn record(&self) -> &HealthTableRecord {
        &self.record
    }
}
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TablePage<T> {
    pub items: Vec<T>,
    pub next_offset: Option<u32>,
}

#[allow(private_bounds)]
impl<R: HealthReadRepository, M: MediaStore> HealthService<R, M> {
    pub fn query_table(&self, query: &HealthTableQuery) -> HealthResult<TablePage<HealthTableRow>> {
        self.repository.query_table(query)
    }

    pub fn list_active_diet_tags(&self) -> HealthResult<Vec<String>> {
        self.repository.list_active_diet_tags()
    }
}
fn validation(field: &'static str, message: impl Into<String>) -> HealthError {
    HealthError::Validation {
        field,
        message: message.into(),
    }
}

pub(crate) fn rfc3339(value: OffsetDateTime) -> String {
    value
        .format(&time::format_description::well_known::Rfc3339)
        .expect("validated domain timestamp")
}
