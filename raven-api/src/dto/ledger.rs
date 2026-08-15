use ledger_engine::domain::{EntryType, TransactionCategoryKind};
use serde::{Deserialize, Serialize};

use super::Patch;

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateEntryBody {
    pub date: String,
    pub written_at: String,
    pub content: String,
    pub category: Option<String>,
    pub account: String,
    pub entry_type: PublicEntryType,
    pub amount: String,
    pub currency: String,
    #[serde(default = "default_source")]
    pub source: String,
    pub notes: Option<String>,
    #[serde(default = "default_actor")]
    pub actor: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateEntryBody {
    pub date: Option<String>,
    pub written_at: Option<String>,
    pub content: Option<String>,
    #[serde(default)]
    pub category: Patch<String>,
    pub account: Option<String>,
    pub entry_type: Option<PublicEntryType>,
    pub amount: Option<String>,
    pub currency: Option<String>,
    #[serde(default)]
    pub notes: Patch<String>,
    pub source: Option<String>,
    #[serde(default = "default_actor")]
    pub actor: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PublicEntryType {
    Expense,
    Income,
    AdjustmentOut,
    AdjustmentIn,
}

impl From<PublicEntryType> for EntryType {
    fn from(value: PublicEntryType) -> Self {
        match value {
            PublicEntryType::Expense => Self::Expense,
            PublicEntryType::Income => Self::Income,
            PublicEntryType::AdjustmentOut => Self::AdjustmentOut,
            PublicEntryType::AdjustmentIn => Self::AdjustmentIn,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransferBody {
    pub operation_key: String,
    pub date: String,
    pub written_at: String,
    pub content: String,
    pub from_account: String,
    pub to_account: String,
    pub amount: String,
    pub currency: String,
    #[serde(default = "default_source")]
    pub source: String,
    pub notes: Option<String>,
    #[serde(default = "default_actor")]
    pub actor: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateTransferBody {
    pub date: String,
    pub content: String,
    pub from_account: String,
    pub to_account: String,
    pub amount: String,
    pub currency: String,
    pub notes: Option<String>,
    #[serde(default = "default_actor")]
    pub actor: String,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateCurrencyBody {
    pub code: String,
    pub name: String,
    pub symbol: String,
    pub decimal_places: u8,
    #[serde(default = "default_actor")]
    pub actor: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateCurrencyBody {
    pub code: Option<String>,
    pub name: Option<String>,
    pub symbol: Option<String>,
    pub decimal_places: Option<u8>,
    pub active: Option<bool>,
    #[serde(default = "default_actor")]
    pub actor: String,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateAccountCategoryBody {
    pub name: String,
    pub parent: Option<String>,
    #[serde(default)]
    pub liability: bool,
    #[serde(default = "default_actor")]
    pub actor: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateAccountCategoryBody {
    pub name: Option<String>,
    #[serde(default)]
    pub parent: Patch<String>,
    pub liability: Option<bool>,
    pub active: Option<bool>,
    #[serde(default = "default_actor")]
    pub actor: String,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateAccountBody {
    pub name: String,
    pub category: String,
    pub currency: String,
    pub opening_balance: String,
    #[serde(default = "default_actor")]
    pub actor: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateAccountBody {
    pub name: Option<String>,
    pub category: Option<String>,
    pub currency: Option<String>,
    pub opening_balance: Option<String>,
    pub active: Option<bool>,
    #[serde(default = "default_actor")]
    pub actor: String,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateCategoryBody {
    pub name: String,
    pub parent: Option<String>,
    pub kind: TransactionCategoryKind,
    #[serde(default = "default_actor")]
    pub actor: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateCategoryBody {
    pub name: Option<String>,
    #[serde(default)]
    pub parent: Patch<String>,
    pub kind: Option<TransactionCategoryKind>,
    pub active: Option<bool>,
    #[serde(default = "default_actor")]
    pub actor: String,
    pub reason: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PurgeBody {
    pub confirmation: String,
}

#[derive(Debug, Serialize)]
pub struct PageBody<T> {
    pub items: Vec<T>,
    pub next_offset: Option<u32>,
}

fn default_actor() -> String {
    "raven-api".to_string()
}

fn default_source() -> String {
    "api".to_string()
}
