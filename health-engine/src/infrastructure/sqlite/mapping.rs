use rusqlite::Row;
use rusqlite::types::ValueRef;
use serde_json::Value;
use time::{Date, OffsetDateTime};

use super::audit_json;
use super::schema::{format_utc_time, parse_local_date, parse_utc_time};
use crate::application::error::{HealthError, HealthResult};
use crate::application::ports::{AuditEvent, MediaFileRecord};
use crate::domain::{
    DietEntry, DietEntryRehydration, HealthCategory, HealthEvent, HealthEventRehydration, MealType,
};

pub(super) const DIET_COLUMNS: &str = "
    id, occurred_at, local_date, meal_type, food_name, note, media_id,
    created_at, updated_at, deleted_at
";
pub(super) const EVENT_COLUMNS: &str = "
    id, occurred_at, local_date, category, metric_key, name, value_num, unit,
    note, attributes_json, daily_upsert, created_at, updated_at, deleted_at
";
pub(super) const MEDIA_COLUMNS: &str = "
    id, relative_path, mime_type, byte_size, checksum_sha256, cleanup_pending,
    created_at, updated_at, deleted_at
";
pub(super) const AUDIT_COLUMNS: &str = "
    id, request_id, occurred_at, actor, action, record_type, record_id,
    before_json, after_json, reason
";

const EVENT_JSON_MAX_BYTES: usize = 1024 * 1024;

pub(super) fn row_to_diet(row: &Row<'_>, tags: Vec<String>) -> HealthResult<DietEntry> {
    let id = required_text(row, 0)?;
    let occurred_at = required_text(row, 1)?;
    let local_date = required_text(row, 2)?;
    let meal_type = required_text(row, 3)?;
    let food_name = required_text(row, 4)?;
    let note = optional_text(row, 5)?;
    let media_id = optional_text(row, 6)?;
    let created_at = required_text(row, 7)?;
    let updated_at = required_text(row, 8)?;
    let deleted_at = optional_text(row, 9)?;
    parse_local_date(&local_date)?;

    let entry = DietEntry::rehydrate(DietEntryRehydration {
        id: id.clone(),
        occurred_at: parse_utc_time(&occurred_at)?,
        meal_type: meal_type
            .parse::<MealType>()
            .map_err(persisted_domain_error)?,
        food_name: food_name.clone(),
        note: note.clone(),
        tags: tags.clone(),
        media_id: media_id.clone(),
        created_at: parse_utc_time(&created_at)?,
        updated_at: parse_utc_time(&updated_at)?,
        deleted_at: deleted_at.as_deref().map(parse_utc_time).transpose()?,
    })
    .map_err(persisted_domain_error)?;
    if entry.id().as_str() != id
        || entry.food_name() != food_name
        || entry.note() != note.as_deref()
        || entry.tags() != tags
        || entry.media_id().map(|media| media.id().as_str()) != media_id.as_deref()
    {
        return Err(persisted_domain_error(
            "diet row is not in its canonical persisted form",
        ));
    }
    Ok(entry)
}

pub(super) fn row_to_event(row: &Row<'_>) -> HealthResult<HealthEvent> {
    let id = required_text(row, 0)?;
    let occurred_at = required_text(row, 1)?;
    let local_date = required_text(row, 2)?;
    let category = parse_category(&required_text(row, 3)?)?;
    let metric_key = required_text(row, 4)?;
    let name = required_text(row, 5)?;
    let value_num = optional_real(row, 6)?;
    let unit = optional_text(row, 7)?;
    let note = optional_text(row, 8)?;
    let attributes = decode_event_json(&required_text(row, 9)?)?;
    let daily_upsert = strict_bool(row, 10)?;
    let created_at = required_text(row, 11)?;
    let updated_at = required_text(row, 12)?;
    let deleted_at = optional_text(row, 13)?;
    parse_local_date(&local_date)?;
    let _ = daily_upsert;

    let event = HealthEvent::rehydrate(HealthEventRehydration {
        id: id.clone(),
        occurred_at: parse_utc_time(&occurred_at)?,
        category,
        metric_key: metric_key.clone(),
        name: name.clone(),
        value_num,
        unit: unit.clone(),
        note: note.clone(),
        attributes: attributes.clone(),
        created_at: parse_utc_time(&created_at)?,
        updated_at: parse_utc_time(&updated_at)?,
        deleted_at: deleted_at.as_deref().map(parse_utc_time).transpose()?,
    })
    .map_err(persisted_domain_error)?;
    if event.id().as_str() != id
        || event.metric_key().as_str() != metric_key
        || event.name() != name
        || !same_optional_real(event.value_num(), value_num)
        || event.unit() != unit.as_deref()
        || event.note() != note.as_deref()
        || event.attributes() != &attributes
    {
        return Err(persisted_domain_error(
            "health event row is not in its canonical persisted form",
        ));
    }
    Ok(event)
}

pub(super) fn row_to_media(row: &Row<'_>) -> HealthResult<MediaFileRecord> {
    let byte_size = required_integer(row, 3)?;
    let created_at = required_text(row, 6)?;
    let updated_at = required_text(row, 7)?;
    let deleted_at = optional_text(row, 8)?;
    let media = MediaFileRecord {
        id: required_text(row, 0)?,
        relative_path: required_text(row, 1)?,
        mime_type: required_text(row, 2)?,
        byte_size: u64::try_from(byte_size)
            .map_err(|_| persisted_domain_error("media byte size must be a nonnegative integer"))?,
        checksum_sha256: required_text(row, 4)?,
        cleanup_pending: strict_bool(row, 5)?,
        created_at: parse_utc_time(&created_at)?,
        updated_at: parse_utc_time(&updated_at)?,
        deleted_at: deleted_at.as_deref().map(parse_utc_time).transpose()?,
    };
    media.validate().map_err(persisted_domain_error)?;
    Ok(media)
}

pub(super) fn row_to_audit_event(row: &Row<'_>) -> HealthResult<AuditEvent> {
    let occurred_at = required_text(row, 2)?;
    let before = optional_text(row, 7)?;
    let after = optional_text(row, 8)?;
    let event = AuditEvent {
        id: required_text(row, 0)?,
        request_id: required_text(row, 1)?,
        occurred_at: parse_utc_time(&occurred_at)?,
        actor: required_text(row, 3)?,
        action: required_text(row, 4)?,
        record_type: required_text(row, 5)?,
        record_id: required_text(row, 6)?,
        before: audit_json::decode_optional(before.as_deref()).map_err(persisted_json_error)?,
        after: audit_json::decode_optional(after.as_deref()).map_err(persisted_json_error)?,
        reason: optional_text(row, 9)?,
    };
    event.validate().map_err(persisted_domain_error)?;
    Ok(event)
}

pub(super) fn format_time(value: OffsetDateTime) -> HealthResult<String> {
    format_utc_time(value)
}

pub(super) fn format_date(value: Date) -> String {
    value.to_string()
}

pub(super) fn encode_event_json(value: &Value) -> HealthResult<String> {
    if !value.is_object() {
        return Err(HealthError::Storage(
            "health event attributes JSON must be an object".to_string(),
        ));
    }
    let encoded =
        serde_json::to_string(value).map_err(|error| HealthError::Storage(error.to_string()))?;
    if encoded.len() > EVENT_JSON_MAX_BYTES {
        return Err(HealthError::Storage(format!(
            "health event attributes JSON exceeds {EVENT_JSON_MAX_BYTES} bytes"
        )));
    }
    drop(decode_event_json(&encoded)?);
    Ok(encoded)
}

fn decode_event_json(value: &str) -> HealthResult<Value> {
    if value.len() > EVENT_JSON_MAX_BYTES {
        return Err(persisted_domain_error(format!(
            "health event attributes JSON exceeds {EVENT_JSON_MAX_BYTES} bytes"
        )));
    }
    let decoded = serde_json::from_str::<Value>(value).map_err(persisted_json_error)?;
    if !decoded.is_object() {
        return Err(persisted_domain_error(
            "health event attributes JSON must be an object",
        ));
    }
    Ok(decoded)
}

fn parse_category(value: &str) -> HealthResult<HealthCategory> {
    match value {
        "weight" => Ok(HealthCategory::Weight),
        "bowel" => Ok(HealthCategory::Bowel),
        "sleep" => Ok(HealthCategory::Sleep),
        "lab" => Ok(HealthCategory::Lab),
        "symptom" => Ok(HealthCategory::Symptom),
        "medication" => Ok(HealthCategory::Medication),
        _ => Err(persisted_domain_error(format!(
            "unknown health category {value}"
        ))),
    }
}

fn required_text(row: &Row<'_>, index: usize) -> HealthResult<String> {
    match row.get_ref(index).map_err(super::storage_error)? {
        ValueRef::Text(value) => std::str::from_utf8(value)
            .map(str::to_owned)
            .map_err(|error| persisted_domain_error(error.to_string())),
        value => Err(storage_class_error(index, "text", value)),
    }
}

fn optional_text(row: &Row<'_>, index: usize) -> HealthResult<Option<String>> {
    match row.get_ref(index).map_err(super::storage_error)? {
        ValueRef::Null => Ok(None),
        ValueRef::Text(value) => std::str::from_utf8(value)
            .map(|value| Some(value.to_string()))
            .map_err(|error| persisted_domain_error(error.to_string())),
        value => Err(storage_class_error(index, "null or text", value)),
    }
}

fn required_integer(row: &Row<'_>, index: usize) -> HealthResult<i64> {
    match row.get_ref(index).map_err(super::storage_error)? {
        ValueRef::Integer(value) => Ok(value),
        value => Err(storage_class_error(index, "integer", value)),
    }
}

fn optional_real(row: &Row<'_>, index: usize) -> HealthResult<Option<f64>> {
    match row.get_ref(index).map_err(super::storage_error)? {
        ValueRef::Null => Ok(None),
        ValueRef::Real(value) => Ok(Some(value)),
        value => Err(storage_class_error(index, "null or real", value)),
    }
}

fn strict_bool(row: &Row<'_>, index: usize) -> HealthResult<bool> {
    match required_integer(row, index)? {
        0 => Ok(false),
        1 => Ok(true),
        value => Err(persisted_domain_error(format!(
            "invalid persisted boolean value {value}"
        ))),
    }
}

fn same_optional_real(left: Option<f64>, right: Option<f64>) -> bool {
    match (left, right) {
        (Some(left), Some(right)) => left.to_bits() == right.to_bits(),
        (None, None) => true,
        _ => false,
    }
}

fn storage_class_error(index: usize, expected: &str, actual: ValueRef<'_>) -> HealthError {
    persisted_domain_error(format!(
        "column {index} expected {expected} storage, got {}",
        storage_class(actual)
    ))
}

fn storage_class(value: ValueRef<'_>) -> &'static str {
    match value {
        ValueRef::Null => "null",
        ValueRef::Integer(_) => "integer",
        ValueRef::Real(_) => "real",
        ValueRef::Text(_) => "text",
        ValueRef::Blob(_) => "blob",
    }
}

fn persisted_json_error(error: impl std::fmt::Display) -> HealthError {
    persisted_domain_error(format!("invalid persisted JSON: {error}"))
}

fn persisted_domain_error(error: impl std::fmt::Display) -> HealthError {
    HealthError::Storage(format!(
        "persisted Health record violates a storage or domain invariant: {error}"
    ))
}
