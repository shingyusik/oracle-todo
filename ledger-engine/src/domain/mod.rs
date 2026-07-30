mod entry;
mod money;
mod refs;

pub use entry::{EntryType, LedgerEntry, LedgerEntryDraft};
pub use money::{Money, MoneyError};
pub use refs::{Account, AccountCategory, Currency, TransactionCategory, TransactionCategoryKind};
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ValidationError {
    #[error("{0} must not be blank")]
    BlankField(&'static str),
    #[error("entry amount must be positive")]
    NonPositiveEntryAmount,
    #[error("date must be a valid ISO calendar date")]
    MalformedDate,
    #[error("currency precision {0} is unsupported")]
    UnsupportedCurrencyPrecision(u8),
}

fn required(value: impl Into<String>, field: &'static str) -> Result<String, ValidationError> {
    let value = value.into();
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(ValidationError::BlankField(field))
    } else {
        Ok(trimmed.to_string())
    }
}

fn optional(value: Option<String>, field: &'static str) -> Result<Option<String>, ValidationError> {
    value.map(|value| required(value, field)).transpose()
}
