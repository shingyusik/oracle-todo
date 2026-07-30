mod diet;
mod event;
mod media;
mod metric;

pub use diet::{DietEntry, DietEntryRehydration, MealType, NewDietEntry, normalize_tags};
pub use event::{
    BowelAttributes, HealthCategory, HealthEvent, HealthEventDetails, HealthEventRehydration,
    LabAttributes, MedicationAttributes, MedicationUnit, NewHealthEvent, SleepAttributes,
    SleepValue, SymptomAttributes, WeightAttributes, WeightValue,
};
pub use media::{HealthRecordId, MediaReference};
pub use metric::MetricKey;

use time::{OffsetDateTime, UtcOffset};

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ValidationError {
    #[error("{0} must not be blank")]
    BlankField(&'static str),
    #[error("unsupported meal type: {0}")]
    UnsupportedMealType(String),
    #[error("unsupported medication unit: {0}")]
    UnsupportedMedicationUnit(String),
    #[error("record IDs must be canonical lowercase hyphenated UUID v4 values")]
    InvalidRecordId,
    #[error(
        "metric keys must be 1..=64 characters of canonical ASCII snake_case starting with a letter"
    )]
    InvalidMetricKey,
    #[error("diet entries support at most {maximum} tags")]
    TooManyTags { maximum: usize },
    #[error("diet food names must be at most {maximum} characters")]
    FoodNameTooLong { maximum: usize },
    #[error("diet tags must be at most {maximum} characters")]
    TagTooLong { maximum: usize },
    #[error("Bristol scale must be an integer from 1 through 7")]
    InvalidBristolScale,
    #[error("{0} must be finite")]
    NonFiniteNumber(&'static str),
    #[error("{0} exceeds the exact-integer-safe f64 magnitude")]
    NumericMagnitudeOutOfRange(&'static str),
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
    #[error("{0} cannot be represented as an RFC3339 timestamp")]
    UnserializableTimestamp(&'static str),
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
    const MAX_EXACT_INTEGER: f64 = 9_007_199_254_740_991.0;

    if !value.is_finite() {
        return Err(ValidationError::NonFiniteNumber(field));
    }
    if value.abs() > MAX_EXACT_INTEGER {
        return Err(ValidationError::NumericMagnitudeOutOfRange(field));
    }
    Ok(if value == 0.0 { 0.0 } else { value })
}

pub(super) fn as_utc(timestamp: OffsetDateTime) -> OffsetDateTime {
    timestamp.to_offset(UtcOffset::UTC)
}

pub(super) fn validated_timestamp(
    timestamp: OffsetDateTime,
    field: &'static str,
) -> Result<OffsetDateTime, ValidationError> {
    let timestamp = as_utc(timestamp);
    timestamp
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|_| ValidationError::UnserializableTimestamp(field))?;
    Ok(timestamp)
}

pub(super) fn validate_lifecycle(
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
    deleted_at: Option<OffsetDateTime>,
) -> Result<(), ValidationError> {
    let created_at = validated_timestamp(created_at, "created_at")?;
    let updated_at = validated_timestamp(updated_at, "updated_at")?;
    let deleted_at = deleted_at
        .map(|deleted_at| validated_timestamp(deleted_at, "deleted_at"))
        .transpose()?;

    if updated_at < created_at
        || deleted_at.is_some_and(|deleted_at| deleted_at < created_at || deleted_at > updated_at)
    {
        return Err(ValidationError::InvalidLifecycle);
    }
    Ok(())
}
