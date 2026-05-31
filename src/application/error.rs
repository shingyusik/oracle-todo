use thiserror::Error;

pub type TodoResult<T> = Result<T, TodoError>;

#[derive(Debug, Error, PartialEq)]
pub enum TodoError {
    #[error("{0}")]
    Policy(String),
    #[error("Item not found: {0}")]
    NotFound(String),
    #[error("{0}")]
    Validation(String),
    #[error("storage error: {0}")]
    Storage(String),
    #[error("migration error: {0}")]
    Migration(String),
    #[error("internal error: {0}")]
    Internal(String),
}
