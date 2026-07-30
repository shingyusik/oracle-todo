use thiserror::Error;

pub type LedgerResult<T> = Result<T, LedgerError>;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum LedgerError {
    #[error("ledger validation failed for {field}: {message}")]
    Validation {
        field: &'static str,
        message: String,
    },
    #[error("ledger record not found: {0}")]
    NotFound(String),
    #[error("ledger conflict: {0}")]
    Conflict(String),
    #[error("ledger storage error: {0}")]
    Storage(String),
    #[error("ledger migration error: {0}")]
    Migration(String),
    #[error("ledger confirmation does not match the record identifier")]
    ConfirmationMismatch,
}
