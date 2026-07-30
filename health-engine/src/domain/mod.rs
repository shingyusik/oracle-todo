mod diet;
mod event;
mod media;

pub use diet::{DietEntry, DietEntryRehydration, MealType, NewDietEntry, normalize_tags};
pub use event::{
    BowelAttributes, HealthCategory, HealthEvent, HealthEventDetails, HealthEventRehydration,
    LabAttributes, MedicationAttributes, MedicationUnit, NewHealthEvent, SleepAttributes,
    SleepValue, SymptomAttributes, WeightAttributes, WeightValue,
};
pub use media::MediaReference;

use time::{OffsetDateTime, UtcOffset};

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ValidationError {
    #[error("{0} must not be blank")]
    BlankField(&'static str),
    #[error("unsupported meal type: {0}")]
    UnsupportedMealType(String),
    #[error("unsupported medication unit: {0}")]
    UnsupportedMedicationUnit(String),
    #[error("diet entries support at most {maximum} tags")]
    TooManyTags { maximum: usize },
    #[error("diet tags must be at most {maximum} characters")]
    TagTooLong { maximum: usize },
    #[error("Bristol scale must be an integer from 1 through 7")]
    InvalidBristolScale,
    #[error("{0} must be finite")]
    NonFiniteNumber(&'static str),
    #[error("{0} must be positive")]
    NonPositiveNumber(&'static str),
    #[error("sleep hours must be greater than zero and no more than 24")]
    InvalidSleepHours,
    #[error("symptom and condition scores must be integers from 1 through 10")]
    InvalidSymptomScore,
    #[error("health event attributes are invalid")]
    InvalidAttributes,
    #[error("health event core fields do not match its category attributes")]
    AttributesMismatch,
    #[error("lifecycle timestamps are out of order")]
    InvalidLifecycle,
}

pub(super) fn required(
    value: impl Into<String>,
    field: &'static str,
) -> Result<String, ValidationError> {
    let value = value.into();
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ValidationError::BlankField(field));
    }
    Ok(trimmed.to_string())
}

pub(super) fn optional(
    value: Option<String>,
    field: &'static str,
) -> Result<Option<String>, ValidationError> {
    value.map(|value| required(value, field)).transpose()
}

pub(super) fn finite(value: f64, field: &'static str) -> Result<f64, ValidationError> {
    if value.is_finite() {
        Ok(value)
    } else {
        Err(ValidationError::NonFiniteNumber(field))
    }
}

pub(super) fn as_utc(timestamp: OffsetDateTime) -> OffsetDateTime {
    timestamp.to_offset(UtcOffset::UTC)
}

pub(super) fn validate_lifecycle(
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
    deleted_at: Option<OffsetDateTime>,
) -> Result<(), ValidationError> {
    if updated_at < created_at
        || deleted_at.is_some_and(|deleted_at| deleted_at < created_at || deleted_at > updated_at)
    {
        return Err(ValidationError::InvalidLifecycle);
    }
    Ok(())
}
