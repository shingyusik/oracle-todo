use serde::Serialize;

use super::{Money, ValidationError, money::MAX_DECIMAL_PLACES, optional, required};

/// A validated currency master record.
///
/// ```compile_fail
/// use ledger_engine::domain::Currency;
///
/// let _: Currency = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Currency {
    id: String,
    code: String,
    name: String,
    symbol: String,
    decimal_places: u8,
    active: bool,
}

impl Currency {
    pub fn new(
        id: impl Into<String>,
        code: impl Into<String>,
        name: impl Into<String>,
        symbol: impl Into<String>,
        decimal_places: u8,
    ) -> Result<Self, ValidationError> {
        Self::rehydrate(id, code, name, symbol, decimal_places, true)
    }

    pub fn rehydrate(
        id: impl Into<String>,
        code: impl Into<String>,
        name: impl Into<String>,
        symbol: impl Into<String>,
        decimal_places: u8,
        active: bool,
    ) -> Result<Self, ValidationError> {
        if decimal_places > MAX_DECIMAL_PLACES {
            return Err(ValidationError::UnsupportedCurrencyPrecision(
                decimal_places,
            ));
        }

        Ok(Self {
            id: required(id, "currency.id")?,
            code: required(code, "currency.code")?,
            name: required(name, "currency.name")?,
            symbol: required(symbol, "currency.symbol")?,
            decimal_places,
            active,
        })
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn code(&self) -> &str {
        &self.code
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn symbol(&self) -> &str {
        &self.symbol
    }

    pub const fn decimal_places(&self) -> u8 {
        self.decimal_places
    }

    pub const fn is_active(&self) -> bool {
        self.active
    }
}

/// A validated account-category master record.
///
/// ```compile_fail
/// use ledger_engine::domain::AccountCategory;
///
/// let _: AccountCategory = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AccountCategory {
    id: String,
    name: String,
    parent_id: Option<String>,
    liability: bool,
    active: bool,
}

impl AccountCategory {
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        parent_id: Option<String>,
        liability: bool,
    ) -> Result<Self, ValidationError> {
        Self::rehydrate(id, name, parent_id, liability, true)
    }

    pub fn rehydrate(
        id: impl Into<String>,
        name: impl Into<String>,
        parent_id: Option<String>,
        liability: bool,
        active: bool,
    ) -> Result<Self, ValidationError> {
        Ok(Self {
            id: required(id, "account_category.id")?,
            name: required(name, "account_category.name")?,
            parent_id: optional(parent_id, "account_category.parent_id")?,
            liability,
            active,
        })
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn parent_id(&self) -> Option<&str> {
        self.parent_id.as_deref()
    }

    pub const fn is_liability(&self) -> bool {
        self.liability
    }

    pub const fn is_active(&self) -> bool {
        self.active
    }
}

/// A validated account master record.
///
/// ```compile_fail
/// use ledger_engine::domain::Account;
///
/// let _: Account = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Account {
    id: String,
    name: String,
    category_id: String,
    currency_id: String,
    opening_balance: Money,
    active: bool,
}

impl Account {
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        category_id: impl Into<String>,
        currency_id: impl Into<String>,
        opening_balance: Money,
    ) -> Result<Self, ValidationError> {
        Self::rehydrate(id, name, category_id, currency_id, opening_balance, true)
    }

    pub fn rehydrate(
        id: impl Into<String>,
        name: impl Into<String>,
        category_id: impl Into<String>,
        currency_id: impl Into<String>,
        opening_balance: Money,
        active: bool,
    ) -> Result<Self, ValidationError> {
        Ok(Self {
            id: required(id, "account.id")?,
            name: required(name, "account.name")?,
            category_id: required(category_id, "account.category_id")?,
            currency_id: required(currency_id, "account.currency_id")?,
            opening_balance,
            active,
        })
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn category_id(&self) -> &str {
        &self.category_id
    }

    pub fn currency_id(&self) -> &str {
        &self.currency_id
    }

    pub const fn opening_balance(&self) -> Money {
        self.opening_balance
    }

    pub const fn is_active(&self) -> bool {
        self.active
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransactionCategoryKind {
    Expense,
    Income,
}

/// A validated transaction-category master record.
///
/// ```compile_fail
/// use ledger_engine::domain::TransactionCategory;
///
/// let _: TransactionCategory = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TransactionCategory {
    id: String,
    name: String,
    parent_id: Option<String>,
    kind: TransactionCategoryKind,
    active: bool,
}

impl TransactionCategory {
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        parent_id: Option<String>,
        kind: TransactionCategoryKind,
    ) -> Result<Self, ValidationError> {
        Self::rehydrate(id, name, parent_id, kind, true)
    }

    pub fn rehydrate(
        id: impl Into<String>,
        name: impl Into<String>,
        parent_id: Option<String>,
        kind: TransactionCategoryKind,
        active: bool,
    ) -> Result<Self, ValidationError> {
        Ok(Self {
            id: required(id, "transaction_category.id")?,
            name: required(name, "transaction_category.name")?,
            parent_id: optional(parent_id, "transaction_category.parent_id")?,
            kind,
            active,
        })
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn parent_id(&self) -> Option<&str> {
        self.parent_id.as_deref()
    }

    pub const fn kind(&self) -> TransactionCategoryKind {
        self.kind
    }

    pub const fn is_active(&self) -> bool {
        self.active
    }
}
