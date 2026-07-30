use serde::{Deserialize, Serialize};

use super::{Money, ValidationError, money::MAX_DECIMAL_PLACES, optional, required};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Currency {
    pub id: String,
    pub code: String,
    pub name: String,
    pub symbol: String,
    pub decimal_places: u8,
    pub active: bool,
}

impl Currency {
    pub fn new(
        id: impl Into<String>,
        code: impl Into<String>,
        name: impl Into<String>,
        symbol: impl Into<String>,
        decimal_places: u8,
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
            active: true,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AccountCategory {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub liability: bool,
    pub active: bool,
}

impl AccountCategory {
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        parent_id: Option<String>,
        liability: bool,
    ) -> Result<Self, ValidationError> {
        Ok(Self {
            id: required(id, "account_category.id")?,
            name: required(name, "account_category.name")?,
            parent_id: optional(parent_id, "account_category.parent_id")?,
            liability,
            active: true,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub name: String,
    pub category_id: String,
    pub currency_id: String,
    pub opening_balance: Money,
    pub active: bool,
}

impl Account {
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        category_id: impl Into<String>,
        currency_id: impl Into<String>,
        opening_balance: Money,
    ) -> Result<Self, ValidationError> {
        Ok(Self {
            id: required(id, "account.id")?,
            name: required(name, "account.name")?,
            category_id: required(category_id, "account.category_id")?,
            currency_id: required(currency_id, "account.currency_id")?,
            opening_balance,
            active: true,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransactionCategoryKind {
    Expense,
    Income,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransactionCategory {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub kind: TransactionCategoryKind,
    pub active: bool,
}

impl TransactionCategory {
    pub fn new(
        id: impl Into<String>,
        name: impl Into<String>,
        parent_id: Option<String>,
        kind: TransactionCategoryKind,
    ) -> Result<Self, ValidationError> {
        Ok(Self {
            id: required(id, "transaction_category.id")?,
            name: required(name, "transaction_category.name")?,
            parent_id: optional(parent_id, "transaction_category.parent_id")?,
            kind,
            active: true,
        })
    }
}
