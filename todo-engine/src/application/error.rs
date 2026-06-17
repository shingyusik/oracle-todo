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

impl TodoError {
    pub fn cli_exit_code(&self) -> i32 {
        match self {
            TodoError::Policy(_) | TodoError::Validation(_) => 2,
            TodoError::NotFound(_) => 4,
            TodoError::Storage(_) | TodoError::Migration(_) | TodoError::Internal(_) => 1,
        }
    }

    pub fn http_status_code(&self) -> u16 {
        match self {
            TodoError::Policy(_) | TodoError::Validation(_) => 400,
            TodoError::NotFound(_) => 404,
            TodoError::Storage(_) | TodoError::Migration(_) | TodoError::Internal(_) => 500,
        }
    }

    pub fn cli_exit_code_from_error(error: &anyhow::Error) -> Option<i32> {
        error
            .downcast_ref::<TodoError>()
            .map(TodoError::cli_exit_code)
    }
}
