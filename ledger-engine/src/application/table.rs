use serde::{Deserialize, Serialize};

use crate::application::error::{LedgerError, LedgerResult};
use crate::application::ports::LedgerReadRepository;
use crate::application::queries::{AccountBalanceView, EntryView};
use crate::application::service::LedgerService;
use crate::domain::TransactionCategory;

pub const TABLE_PAGE_LIMIT: u16 = 50;

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LedgerTableQuery {
    scope: LedgerTableScope,
    offset: u32,
    limit: u16,
    filter_mode: FilterMode,
    filters: Vec<LedgerTableFilter>,
    sorts: Vec<LedgerTableSort>,
    group_by: LedgerTableGroup,
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
        group_by: LedgerTableGroup,
    ) -> LedgerResult<Self> {
        validate_limit(limit)?;
        if sorts.is_empty() {
            return Err(validation("sorts", "at least one sort rule is required"));
        }
        if filters.iter().any(|filter| filter.scope() != scope) {
            return Err(validation(
                "filters",
                "filter field does not match table scope",
            ));
        }
        if sorts.iter().any(|sort| sort.scope() != scope) {
            return Err(validation("sorts", "sort field does not match table scope"));
        }
        if group_by.scope() != scope {
            return Err(validation(
                "group_by",
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
            group_by,
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

    pub const fn group_by(&self) -> LedgerTableGroup {
        self.group_by
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum LedgerTableRecord {
    Transactions(EntryView),
    Accounts(AccountBalanceView),
    Categories(TransactionCategory),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LedgerTableRow {
    pub key: String,
    pub group_key: Option<String>,
    pub group_label: Option<String>,
    pub record: LedgerTableRecord,
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
