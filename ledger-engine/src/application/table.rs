use serde::{Deserialize, Serialize};
use time::{Date, macros::format_description};

use crate::application::error::{LedgerError, LedgerResult};
use crate::application::ports::LedgerReadRepository;
use crate::application::queries::EntryView;
use crate::application::service::LedgerService;
use crate::domain::{Account, TransactionCategory, TransactionCategoryKind};

pub const TABLE_PAGE_LIMIT: u16 = 50;
const MAX_FILTERS: usize = 50;
const MAX_SORTS: usize = 10;
const MAX_FILTER_TEXT_BYTES: usize = 512;
const MAX_FILTER_LIST_VALUES: usize = 100;
const MAX_GROUP_KEYS: usize = 100;
const MAX_GROUP_KEY_BYTES: usize = 256;
const MAX_RELATIVE_DATE_AMOUNT: u32 = 100_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LedgerTableScope {
    #[serde(rename = "ledger.transactions")]
    Transactions,
    #[serde(rename = "ledger.accounts")]
    Accounts,
    #[serde(rename = "ledger.categories")]
    Categories,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterMode {
    And,
    Or,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LedgerFilterOperator {
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
pub enum LedgerTableFilterValue {
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
pub enum TransactionTableFilterField {
    Date,
    Content,
    EntryType,
    Account,
    Category,
    Currency,
    Amount,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountTableFilterField {
    Name,
    AccountType,
    Currency,
    CurrentBalance,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CategoryTableFilterField {
    Name,
    Kind,
    Parent,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "scope", rename_all = "snake_case")]
pub enum LedgerTableFilter {
    Transactions {
        field: TransactionTableFilterField,
        operator: LedgerFilterOperator,
        value: LedgerTableFilterValue,
    },
    Accounts {
        field: AccountTableFilterField,
        operator: LedgerFilterOperator,
        value: LedgerTableFilterValue,
    },
    Categories {
        field: CategoryTableFilterField,
        operator: LedgerFilterOperator,
        value: LedgerTableFilterValue,
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
pub enum TransactionTableSortField {
    Date,
    Content,
    Account,
    Category,
    Amount,
    Updated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountTableSortField {
    Name,
    AccountType,
    Currency,
    CurrentBalance,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CategoryTableSortField {
    Name,
    Kind,
    Parent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "scope", rename_all = "snake_case")]
pub enum LedgerTableSort {
    Transactions {
        field: TransactionTableSortField,
        direction: SortDirection,
    },
    Accounts {
        field: AccountTableSortField,
        direction: SortDirection,
    },
    Categories {
        field: CategoryTableSortField,
        direction: SortDirection,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransactionTableGroup {
    None,
    Month,
    Week,
    Day,
    Account,
    Category,
    EntryType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountTableGroup {
    None,
    AccountType,
    Currency,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CategoryTableGroup {
    None,
    Kind,
    Parent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "scope", content = "field", rename_all = "snake_case")]
pub enum LedgerTableGroup {
    Transactions(TransactionTableGroup),
    Accounts(AccountTableGroup),
    Categories(CategoryTableGroup),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GroupSort {
    Manual,
    Alphabetical,
    ReverseAlphabetical,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LedgerTableGroupSettings {
    group_by: LedgerTableGroup,
    sort: GroupSort,
    hide_empty: bool,
    manual_order: Vec<String>,
    hidden_group_keys: Vec<String>,
}

impl LedgerTableGroupSettings {
    pub fn new(
        group_by: LedgerTableGroup,
        sort: GroupSort,
        hide_empty: bool,
        manual_order: Vec<String>,
        hidden_group_keys: Vec<String>,
    ) -> LedgerResult<Self> {
        Ok(Self {
            group_by,
            sort,
            hide_empty,
            manual_order: validated_group_keys(manual_order)?,
            hidden_group_keys: validated_group_keys(hidden_group_keys)?,
        })
    }

    pub const fn group_by(&self) -> LedgerTableGroup {
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
pub struct LedgerTableQuery {
    scope: LedgerTableScope,
    offset: u32,
    limit: u16,
    filter_mode: FilterMode,
    filters: Vec<LedgerTableFilter>,
    sorts: Vec<LedgerTableSort>,
    group_settings: LedgerTableGroupSettings,
}

impl LedgerTableQuery {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        scope: LedgerTableScope,
        offset: u32,
        limit: u16,
        filter_mode: FilterMode,
        filters: Vec<LedgerTableFilter>,
        sorts: Vec<LedgerTableSort>,
        group_settings: LedgerTableGroupSettings,
    ) -> LedgerResult<Self> {
        validate_limit(limit)?;
        if filters.len() > MAX_FILTERS {
            return Err(validation("filters", "too many filter rules"));
        }
        if sorts.is_empty() || sorts.len() > MAX_SORTS {
            return Err(validation(
                "sorts",
                "between 1 and 10 sort rules are required",
            ));
        }
        if filters
            .iter()
            .any(|filter| filter.scope() != scope || !filter.is_valid())
        {
            return Err(validation(
                "filters",
                "filter rule is invalid for its field",
            ));
        }
        if sorts.iter().any(|sort| sort.scope() != scope) {
            return Err(validation("sorts", "sort field does not match table scope"));
        }
        if group_settings.group_by().scope() != scope {
            return Err(validation(
                "group_settings",
                "group field does not match table scope",
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
        })
    }

    pub const fn scope(&self) -> LedgerTableScope {
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

    pub fn filters(&self) -> &[LedgerTableFilter] {
        &self.filters
    }

    pub fn sorts(&self) -> &[LedgerTableSort] {
        &self.sorts
    }

    pub const fn group_settings(&self) -> &LedgerTableGroupSettings {
        &self.group_settings
    }
}

impl LedgerTableFilter {
    const fn scope(&self) -> LedgerTableScope {
        match self {
            Self::Transactions { .. } => LedgerTableScope::Transactions,
            Self::Accounts { .. } => LedgerTableScope::Accounts,
            Self::Categories { .. } => LedgerTableScope::Categories,
        }
    }

    fn is_valid(&self) -> bool {
        let (field_type, operator, value) = match self {
            Self::Transactions {
                field,
                operator,
                value,
            } => (field.field_type(), *operator, value),
            Self::Accounts {
                field,
                operator,
                value,
            } => (field.field_type(), *operator, value),
            Self::Categories {
                field,
                operator,
                value,
            } => (field.field_type(), *operator, value),
        };
        field_type.accepts(operator, value)
    }
}

impl LedgerTableSort {
    const fn scope(&self) -> LedgerTableScope {
        match self {
            Self::Transactions { .. } => LedgerTableScope::Transactions,
            Self::Accounts { .. } => LedgerTableScope::Accounts,
            Self::Categories { .. } => LedgerTableScope::Categories,
        }
    }
}

impl LedgerTableGroup {
    const fn scope(self) -> LedgerTableScope {
        match self {
            Self::Transactions(_) => LedgerTableScope::Transactions,
            Self::Accounts(_) => LedgerTableScope::Accounts,
            Self::Categories(_) => LedgerTableScope::Categories,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FilterType {
    Text,
    Date,
    Number,
    Select,
    Relation,
}

impl TransactionTableFilterField {
    const fn field_type(self) -> FilterType {
        match self {
            Self::Date => FilterType::Date,
            Self::Content => FilterType::Text,
            Self::Amount => FilterType::Number,
            Self::EntryType => FilterType::Select,
            Self::Account | Self::Category | Self::Currency => FilterType::Relation,
        }
    }
}

impl AccountTableFilterField {
    const fn field_type(self) -> FilterType {
        match self {
            Self::Name => FilterType::Text,
            Self::CurrentBalance => FilterType::Number,
            Self::AccountType | Self::Currency => FilterType::Relation,
        }
    }
}

impl CategoryTableFilterField {
    const fn field_type(self) -> FilterType {
        match self {
            Self::Name => FilterType::Text,
            Self::Kind => FilterType::Select,
            Self::Parent => FilterType::Relation,
        }
    }
}

impl FilterType {
    fn accepts(self, operator: LedgerFilterOperator, value: &LedgerTableFilterValue) -> bool {
        use LedgerFilterOperator as Operator;
        if matches!(operator, Operator::IsEmpty | Operator::IsNotEmpty) {
            return matches!(value, LedgerTableFilterValue::Empty);
        }
        match self {
            Self::Text => {
                matches!(
                    operator,
                    Operator::Contains
                        | Operator::DoesNotContain
                        | Operator::Is
                        | Operator::IsNot
                        | Operator::StartsWith
                        | Operator::EndsWith
                ) && valid_text_value(value)
            }
            Self::Date => valid_date_filter(operator, value),
            Self::Number => {
                matches!(
                    operator,
                    Operator::Is | Operator::IsNot | Operator::GreaterThan | Operator::LessThan
                ) && valid_number_value(value)
            }
            Self::Select | Self::Relation => {
                matches!(
                    operator,
                    Operator::Is | Operator::IsNot | Operator::Contains | Operator::DoesNotContain
                ) && valid_list_value(value)
            }
        }
    }
}

fn valid_text_value(value: &LedgerTableFilterValue) -> bool {
    matches!(value, LedgerTableFilterValue::Text(text) if valid_bounded_text(text))
}

fn valid_number_value(value: &LedgerTableFilterValue) -> bool {
    matches!(
        value,
        LedgerTableFilterValue::Text(text)
            if valid_bounded_text(text)
                && text.parse::<f64>().is_ok_and(f64::is_finite)
    )
}

fn valid_list_value(value: &LedgerTableFilterValue) -> bool {
    matches!(
        value,
        LedgerTableFilterValue::TextList(values)
            if !values.is_empty()
                && values.len() <= MAX_FILTER_LIST_VALUES
                && values.iter().all(|value| valid_bounded_text(value))
    )
}

fn valid_date_filter(operator: LedgerFilterOperator, value: &LedgerTableFilterValue) -> bool {
    use LedgerFilterOperator as Operator;
    match operator {
        Operator::Is
        | Operator::IsNot
        | Operator::IsBefore
        | Operator::IsAfter
        | Operator::IsOnOrBefore
        | Operator::IsOnOrAfter => {
            matches!(value, LedgerTableFilterValue::Text(text) if parse_date(text).is_some())
        }
        Operator::IsBetween => matches!(
            value,
            LedgerTableFilterValue::Range { start, end }
                if parse_date(start).zip(parse_date(end)).is_some_and(|(start, end)| start <= end)
        ),
        Operator::IsRelativeToToday => matches!(
            value,
            LedgerTableFilterValue::Relative { amount, .. }
                if valid_bounded_text(amount)
                    && amount.bytes().all(|byte| byte.is_ascii_digit())
                    && amount.parse::<u32>().is_ok_and(|amount| amount <= MAX_RELATIVE_DATE_AMOUNT)
        ),
        _ => false,
    }
}

fn parse_date(value: &str) -> Option<Date> {
    Date::parse(value, format_description!("[year]-[month]-[day]")).ok()
}

fn valid_bounded_text(value: &str) -> bool {
    !value.is_empty() && value.len() <= MAX_FILTER_TEXT_BYTES
}

fn validated_group_keys(values: Vec<String>) -> LedgerResult<Vec<String>> {
    if values.len() > MAX_GROUP_KEYS
        || values
            .iter()
            .any(|value| value.is_empty() || value.len() > MAX_GROUP_KEY_BYTES)
    {
        return Err(validation(
            "group_settings",
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TransactionRowKind {
    Expense,
    Income,
    Transfer,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TransactionTableRecord {
    pub id: String,
    pub archive_entry_id: String,
    pub detail_entry: EntryView,
    pub transfer_entry: Option<EntryView>,
    pub kind: TransactionRowKind,
    pub date: String,
    pub content: String,
    pub account_ids: Vec<String>,
    pub account_labels: Vec<String>,
    pub account_label: String,
    pub category_id: Option<String>,
    pub category_label: String,
    pub amount_minor: i64,
    pub currency_id: String,
    pub currency_code: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AccountTableRecord {
    pub id: String,
    pub account: Account,
    pub name: String,
    pub account_type_id: String,
    pub account_type_label: String,
    pub currency_id: String,
    pub currency_code: String,
    pub decimal_places: u8,
    pub current_balance_minor: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CategoryTableRecord {
    pub id: String,
    pub category: TransactionCategory,
    pub name: String,
    pub kind: TransactionCategoryKind,
    pub kind_label: String,
    pub parent_id: Option<String>,
    pub parent_label: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum LedgerTableRecord {
    Transactions(Box<TransactionTableRecord>),
    Accounts(AccountTableRecord),
    Categories(CategoryTableRecord),
}

impl LedgerTableRecord {
    pub fn logical_id(&self) -> &str {
        match self {
            Self::Transactions(record) => &record.id,
            Self::Accounts(record) => &record.id,
            Self::Categories(record) => &record.id,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LedgerTableRow {
    key: String,
    group_key: Option<String>,
    group_label: Option<String>,
    record: LedgerTableRecord,
}

impl LedgerTableRow {
    pub fn new(
        group_key: Option<String>,
        group_label: Option<String>,
        record: LedgerTableRecord,
    ) -> LedgerResult<Self> {
        if group_key.is_some() != group_label.is_some() {
            return Err(validation(
                "group",
                "group key and label must either both be present or both be absent",
            ));
        }
        if group_key
            .as_deref()
            .is_some_and(|key| key.is_empty() || key.len() > MAX_GROUP_KEY_BYTES)
            || record.logical_id().is_empty()
        {
            return Err(validation("row", "row identity is empty or too long"));
        }
        let group = group_key.as_deref().unwrap_or_default();
        let key = format!("{}:{group}{}", group.len(), record.logical_id());
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

    pub const fn record(&self) -> &LedgerTableRecord {
        &self.record
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TablePage<T> {
    pub items: Vec<T>,
    pub next_offset: Option<u32>,
}

impl<T> TablePage<T> {
    pub fn from_limit_plus_one(mut items: Vec<T>, offset: u32, limit: u16) -> LedgerResult<Self> {
        validate_limit(limit)?;
        let has_more = items.len() > usize::from(limit);
        items.truncate(usize::from(limit));
        let next_offset = if has_more {
            Some(
                offset
                    .checked_add(u32::from(limit))
                    .ok_or_else(|| validation("page", "page offset exceeds the supported range"))?,
            )
        } else {
            None
        };
        Ok(Self { items, next_offset })
    }
}

#[allow(private_bounds)]
impl<R: LedgerReadRepository> LedgerService<R> {
    pub fn query_table(&self, query: &LedgerTableQuery) -> LedgerResult<TablePage<LedgerTableRow>> {
        self.repository.query_table(query)
    }
}

fn validate_limit(limit: u16) -> LedgerResult<()> {
    if limit == 0 || limit > TABLE_PAGE_LIMIT {
        return Err(validation(
            "page",
            &format!("page limit must be between 1 and {TABLE_PAGE_LIMIT}"),
        ));
    }
    Ok(())
}

fn validation(field: &'static str, message: &str) -> LedgerError {
    LedgerError::Validation {
        field,
        message: message.to_string(),
    }
}
