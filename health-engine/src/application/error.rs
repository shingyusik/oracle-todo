use thiserror::Error;

use crate::application::media::MediaRecovery;
use crate::domain::ValidationError;

pub type HealthResult<T> = Result<T, HealthError>;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum HealthError {
    #[error("health validation failed for {field}: {message}")]
    Validation {
        field: &'static str,
        message: String,
    },
    #[error("health record not found: {0}")]
    NotFound(String),
    #[error("health conflict: {0}")]
    Conflict(String),
    #[error("health database is busy: {0}")]
    Busy(String),
    #[error("health storage error: {0}")]
    Storage(String),
    #[error("health migration error: {0}")]
    Migration(String),
    #[error("unsupported health media")]
    UnsupportedMedia,
    #[error("health media exceeds the configured size limit")]
    MediaTooLarge,
    #[error("{primary}; cleanup also failed: {cleanup}")]
    Cleanup {
        primary: Box<HealthError>,
        cleanup: String,
        recovery: Option<Box<MediaRecovery>>,
        cleanup_path: Option<Box<std::path::PathBuf>>,
    },
    #[error(
        "health mutation committed for {record_id}, but media cleanup remains pending: {message}"
    )]
    CleanupPending { record_id: String, message: String },
    #[error("health confirmation does not match the record identifier")]
    ConfirmationMismatch,
}

impl From<ValidationError> for HealthError {
    fn from(error: ValidationError) -> Self {
        Self::Validation {
            field: "record",
            message: error.to_string(),
        }
    }
}
