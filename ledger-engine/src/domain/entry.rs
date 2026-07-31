use serde::{Deserialize, Serialize, Serializer};
use time::{Date, OffsetDateTime, UtcOffset, macros::format_description};

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

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct LedgerEntryRehydration {
    pub id: String,
    pub date: String,
    #[serde(with = "time::serde::rfc3339")]
    pub written_at: OffsetDateTime,
    pub content: String,
    pub transaction_category_id: Option<String>,
    pub account_id: String,
    pub entry_type: EntryType,
    pub amount: Money,
    pub currency_id: String,
    pub transfer_group_id: Option<String>,
    pub source: String,
    pub notes: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub deleted_at: Option<OffsetDateTime>,
}

/// A validated persisted Ledger entry.
///
/// Domain entities are output-only serde values. JSON or database input must
/// first become [`LedgerEntryRehydration`] and pass [`LedgerEntry::rehydrate`].
///
/// ```compile_fail
/// use ledger_engine::domain::LedgerEntry;
///
/// let _: LedgerEntry = serde_json::from_str("{}").unwrap();
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LedgerEntry {
    id: String,
    #[serde(serialize_with = "serialize_iso_date")]
    date: Date,
    #[serde(with = "time::serde::rfc3339")]
    written_at: OffsetDateTime,
    content: String,
    transaction_category_id: Option<String>,
    account_id: String,
    entry_type: EntryType,
    amount: Money,
    currency_id: String,
    transfer_group_id: Option<String>,
    source: String,
    notes: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    updated_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    deleted_at: Option<OffsetDateTime>,
}

impl LedgerEntry {
    pub fn rehydrate(record: LedgerEntryRehydration) -> Result<Self, ValidationError> {
        if record.amount.minor_units() <= 0 {
            return Err(ValidationError::NonPositiveEntryAmount);
        }

        let date = Date::parse(
            record.date.trim(),
            format_description!("[year]-[month]-[day]"),
        )
        .map_err(|_| ValidationError::MalformedDate)?;

        Ok(Self {
            id: required(record.id, "ledger_entry.id")?,
            date,
            written_at: as_utc(record.written_at),
            content: required(record.content, "ledger_entry.content")?,
            transaction_category_id: optional(
                record.transaction_category_id,
                "ledger_entry.transaction_category_id",
            )?,
            account_id: required(record.account_id, "ledger_entry.account_id")?,
            entry_type: record.entry_type,
            amount: record.amount,
            currency_id: required(record.currency_id, "ledger_entry.currency_id")?,
            transfer_group_id: optional(
                record.transfer_group_id,
                "ledger_entry.transfer_group_id",
            )?,
            source: required(record.source, "ledger_entry.source")?,
            notes: optional(record.notes, "ledger_entry.notes")?,
            created_at: as_utc(record.created_at),
            updated_at: as_utc(record.updated_at),
            deleted_at: record.deleted_at.map(as_utc),
        })
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub const fn date(&self) -> Date {
        self.date
    }

    pub const fn written_at(&self) -> OffsetDateTime {
        self.written_at
    }

    pub fn content(&self) -> &str {
        &self.content
    }

    pub fn transaction_category_id(&self) -> Option<&str> {
        self.transaction_category_id.as_deref()
    }

    pub fn account_id(&self) -> &str {
        &self.account_id
    }

    pub const fn entry_type(&self) -> EntryType {
        self.entry_type
    }

    pub const fn amount(&self) -> Money {
        self.amount
    }

    pub fn currency_id(&self) -> &str {
        &self.currency_id
    }

    pub fn transfer_group_id(&self) -> Option<&str> {
        self.transfer_group_id.as_deref()
    }

    pub fn source(&self) -> &str {
        &self.source
    }

    pub fn notes(&self) -> Option<&str> {
        self.notes.as_deref()
    }

    pub const fn created_at(&self) -> OffsetDateTime {
        self.created_at
    }

    pub const fn updated_at(&self) -> OffsetDateTime {
        self.updated_at
    }

    pub const fn deleted_at(&self) -> Option<OffsetDateTime> {
        self.deleted_at
    }

    pub const fn is_archived(&self) -> bool {
        self.deleted_at.is_some()
    }
}

fn as_utc(timestamp: OffsetDateTime) -> OffsetDateTime {
    timestamp.to_offset(UtcOffset::UTC)
}

fn serialize_iso_date<S>(date: &Date, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.collect_str(date)
}
