use serde::{Deserialize, Serialize};
use time::{Date, macros::format_description};

use super::{Money, ValidationError, optional, required};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryType {
    Expense,
    Income,
    TransferOut,
    TransferIn,
    AdjustmentOut,
    AdjustmentIn,
}

impl EntryType {
    pub const fn balance_sign(self) -> i8 {
        match self {
            Self::Expense | Self::TransferOut | Self::AdjustmentOut => -1,
            Self::Income | Self::TransferIn | Self::AdjustmentIn => 1,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Expense => "expense",
            Self::Income => "income",
            Self::TransferOut => "transfer_out",
            Self::TransferIn => "transfer_in",
            Self::AdjustmentOut => "adjustment_out",
            Self::AdjustmentIn => "adjustment_in",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LedgerEntryDraft {
    pub id: String,
    pub date: String,
    pub content: String,
    pub transaction_category_id: Option<String>,
    pub account_id: String,
    pub entry_type: EntryType,
    pub amount: Money,
    pub currency_id: String,
    pub transfer_group_id: Option<String>,
    pub source: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LedgerEntry {
    pub id: String,
    pub date: Date,
    pub content: String,
    pub transaction_category_id: Option<String>,
    pub account_id: String,
    pub entry_type: EntryType,
    pub amount: Money,
    pub currency_id: String,
    pub transfer_group_id: Option<String>,
    pub source: String,
    pub notes: Option<String>,
}

impl LedgerEntry {
    pub fn new(draft: LedgerEntryDraft) -> Result<Self, ValidationError> {
        if draft.amount.minor_units() <= 0 {
            return Err(ValidationError::NonPositiveEntryAmount);
        }

        let date = Date::parse(
            draft.date.trim(),
            format_description!("[year]-[month]-[day]"),
        )
        .map_err(|_| ValidationError::MalformedDate)?;

        Ok(Self {
            id: required(draft.id, "ledger_entry.id")?,
            date,
            content: required(draft.content, "ledger_entry.content")?,
            transaction_category_id: optional(
                draft.transaction_category_id,
                "ledger_entry.transaction_category_id",
            )?,
            account_id: required(draft.account_id, "ledger_entry.account_id")?,
            entry_type: draft.entry_type,
            amount: draft.amount,
            currency_id: required(draft.currency_id, "ledger_entry.currency_id")?,
            transfer_group_id: optional(draft.transfer_group_id, "ledger_entry.transfer_group_id")?,
            source: required(draft.source, "ledger_entry.source")?,
            notes: optional(draft.notes, "ledger_entry.notes")?,
        })
    }
}
