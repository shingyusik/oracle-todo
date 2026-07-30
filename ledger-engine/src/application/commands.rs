use time::OffsetDateTime;

use crate::domain::{EntryType, Money, TransactionCategoryKind};

#[derive(Debug, Clone)]
pub struct CreateCurrency {
    pub code: String,
    pub name: String,
    pub symbol: String,
    pub decimal_places: u8,
    pub actor: String,
}

#[derive(Debug, Clone, Default)]
pub struct UpdateCurrency {
    pub code: Option<String>,
    pub name: Option<String>,
    pub symbol: Option<String>,
    pub decimal_places: Option<u8>,
    pub active: Option<bool>,
    pub actor: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CreateAccountCategory {
    pub name: String,
    pub parent: Option<String>,
    pub liability: bool,
    pub actor: String,
}

#[derive(Debug, Clone, Default)]
pub struct UpdateAccountCategory {
    pub name: Option<String>,
    pub parent: Option<Option<String>>,
    pub liability: Option<bool>,
    pub active: Option<bool>,
    pub actor: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CreateAccount {
    pub name: String,
    pub category: String,
    pub currency: String,
    pub opening_balance: Money,
    pub actor: String,
}

#[derive(Debug, Clone, Default)]
pub struct UpdateAccount {
    pub name: Option<String>,
    pub category: Option<String>,
    pub currency: Option<String>,
    pub opening_balance: Option<Money>,
    pub active: Option<bool>,
    pub actor: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CreateTransactionCategory {
    pub name: String,
    pub parent: Option<String>,
    pub kind: TransactionCategoryKind,
    pub actor: String,
}

#[derive(Debug, Clone, Default)]
pub struct UpdateTransactionCategory {
    pub name: Option<String>,
    pub parent: Option<Option<String>>,
    pub kind: Option<TransactionCategoryKind>,
    pub active: Option<bool>,
    pub actor: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CreateEntry {
    pub date: String,
    pub written_at: OffsetDateTime,
    pub content: String,
    pub category: Option<String>,
    pub account: String,
    pub entry_type: EntryType,
    pub amount: Money,
    pub currency: String,
    pub transfer_group: Option<String>,
    pub source: String,
    pub notes: Option<String>,
    pub actor: String,
}

#[derive(Debug, Clone, Default)]
pub struct UpdateEntry {
    pub date: Option<String>,
    pub written_at: Option<OffsetDateTime>,
    pub content: Option<String>,
    pub category: Option<Option<String>>,
    pub account: Option<String>,
    pub entry_type: Option<EntryType>,
    pub amount: Option<Money>,
    pub currency: Option<String>,
    pub transfer_group: Option<Option<String>>,
    pub source: Option<String>,
    pub notes: Option<Option<String>>,
    pub actor: String,
    pub reason: Option<String>,
}
