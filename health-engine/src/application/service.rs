use serde::Serialize;
use time::{Date, Duration, OffsetDateTime, UtcOffset, macros::offset};
use uuid::Uuid;

use crate::application::error::{HealthError, HealthResult};
use crate::application::media::{MediaStore, StoredMedia};
use crate::application::ports::{
    AuditEvent, HealthReadRepository, HealthTransaction, MediaFileRecord, Page,
};
use crate::domain::HealthRecordId;

const MAX_AUDIT_ACTOR_CHARACTERS: usize = 128;
const MAX_AUDIT_REASON_CHARACTERS: usize = 1024;

pub struct HealthService<R, M> {
    pub(super) repository: R,
    pub(super) media_store: M,
    pub(super) local_offset: UtcOffset,
}

impl<R, M> HealthService<R, M> {
    pub fn new(repository: R, media_store: M) -> Self {
        Self {
            repository,
            media_store,
            local_offset: offset!(+9),
        }
    }

    /// Sets the fixed UTC offset used to derive persisted local dates.
    ///
    /// The offset is applied directly to each UTC occurrence instant. It does
    /// not resolve IANA timezone names or daylight-saving transitions.
    pub fn with_local_offset(mut self, local_offset: UtcOffset) -> Self {
        self.local_offset = local_offset;
        self
    }
}

#[allow(private_bounds)]
impl<R: HealthReadRepository, M: MediaStore> HealthService<R, M> {
    pub fn get_media(&self, id: &str) -> HealthResult<StoredMedia> {
        HealthRecordId::parse(id)?;
        self.repository
            .get_media(id, false)?
            .map(stored_media)
            .ok_or_else(|| HealthError::NotFound(format!("media file {id}")))
    }

    pub fn audit_for(
        &self,
        record_type: &str,
        record_id: &str,
        page: Page,
    ) -> HealthResult<Vec<AuditEvent>> {
        HealthRecordId::parse(record_id)?;
        if record_type.trim() != record_type || record_type.is_empty() {
            return Err(validation(
                "audit.record_type",
                "must be nonblank and already trimmed",
            ));
        }
        self.repository
            .list_audit_events(record_type, record_id, page)
    }
}

pub(super) struct AuditMutation<'a, T> {
    pub request_id: &'a str,
    pub occurred_at: OffsetDateTime,
    pub actor: &'a str,
    pub action: &'static str,
    pub record_type: &'static str,
    pub record_id: &'a str,
    pub before: Option<&'a T>,
    pub after: Option<&'a T>,
    pub reason: Option<&'a str>,
}

pub(super) fn audit_event<T: Serialize>(
    mutation: AuditMutation<'_, T>,
) -> HealthResult<AuditEvent> {
    let actor = normalized_required("actor", mutation.actor)?;
    let reason = validated_reason(mutation.reason)?;
    let event = AuditEvent {
        id: Uuid::new_v4().to_string(),
        request_id: mutation.request_id.to_string(),
        occurred_at: mutation.occurred_at,
        actor,
        action: mutation.action.to_string(),
        record_type: mutation.record_type.to_string(),
        record_id: mutation.record_id.to_string(),
        before: mutation
            .before
            .map(serde_json::to_value)
            .transpose()
            .map_err(|error| {
                HealthError::Storage(format!(
                    "could not serialize audit before snapshot: {error}"
                ))
            })?,
        after: mutation
            .after
            .map(serde_json::to_value)
            .transpose()
            .map_err(|error| {
                HealthError::Storage(format!("could not serialize audit after snapshot: {error}"))
            })?,
        reason,
    };
    event.validate()?;
    Ok(event)
}

pub(super) fn validate_actor(actor: &str) -> HealthResult<()> {
    normalized_required("actor", actor).map(drop)
}

pub(super) fn validate_reason(reason: Option<&str>) -> HealthResult<()> {
    validated_reason(reason).map(drop)
}

pub(super) fn validation(field: &'static str, message: impl Into<String>) -> HealthError {
    HealthError::Validation {
        field,
        message: message.into(),
    }
}
pub(super) fn rollback_with_primary(
    transaction: Box<dyn HealthTransaction + '_>,
    primary: HealthError,
) -> HealthError {
    match transaction.rollback() {
        Ok(()) => primary,
        Err(cleanup) => HealthError::Cleanup {
            primary: Box::new(primary),
            cleanup: safe_error_summary(&cleanup),
            recovery: None,
            cleanup_path: None,
        },
    }
}

pub(super) fn cleanup_with_primary(
    media_store: &impl MediaStore,
    media: &StoredMedia,
    primary: HealthError,
) -> HealthError {
    match media_store.remove(media.relative_path()) {
        Ok(()) => primary,
        Err(cleanup) => HealthError::Cleanup {
            primary: Box::new(primary),
            cleanup: safe_error_summary(&cleanup),
            recovery: Some(Box::new(
                crate::application::media::MediaRecovery::for_media(media),
            )),
            cleanup_path: Some(Box::new(media.relative_path().to_path_buf())),
        },
    }
}

pub(super) fn media_record(
    media: &StoredMedia,
    now: OffsetDateTime,
    cleanup_pending: bool,
    deleted_at: Option<OffsetDateTime>,
) -> MediaFileRecord {
    MediaFileRecord {
        id: media.id.clone(),
        relative_path: media.relative_path.to_string_lossy().into_owned(),
        mime_type: media.mime_type.clone(),
        byte_size: media.byte_size,
        checksum_sha256: media.checksum_sha256.clone(),
        cleanup_pending,
        created_at: now,
        updated_at: now,
        deleted_at,
    }
}

pub(super) fn stored_media(record: MediaFileRecord) -> StoredMedia {
    StoredMedia {
        id: record.id,
        relative_path: record.relative_path.into(),
        mime_type: record.mime_type,
        byte_size: record.byte_size,
        checksum_sha256: record.checksum_sha256,
        recovery_staged_path: None,
    }
}

pub(super) fn safe_error_summary(error: &HealthError) -> String {
    match error {
        HealthError::Validation { field, .. } => format!("validation failed for {field}"),
        HealthError::NotFound(_) => "media path was not found".to_string(),
        HealthError::Conflict(_) => "media path conflict".to_string(),
        HealthError::Busy(_) => "storage was busy".to_string(),
        HealthError::Storage(_) => "media storage operation failed".to_string(),
        HealthError::Migration(_) => "storage migration failed".to_string(),
        HealthError::UnsupportedMedia => "media is unsupported".to_string(),
        HealthError::MediaTooLarge => "media is too large".to_string(),
        HealthError::Cleanup { .. } => "nested media cleanup failed".to_string(),
        HealthError::CleanupPending { .. } => "media cleanup is pending".to_string(),
        HealthError::ConfirmationMismatch => "confirmation mismatch".to_string(),
    }
}

fn normalized_required(field: &'static str, value: &str) -> HealthResult<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(validation(field, "must not be blank"));
    }
    if normalized.chars().count() > MAX_AUDIT_ACTOR_CHARACTERS
        || normalized.chars().any(char::is_control)
    {
        return Err(validation(
            field,
            format!("must contain at most {MAX_AUDIT_ACTOR_CHARACTERS} non-control characters"),
        ));
    }
    Ok(normalized.to_string())
}

fn validated_reason(reason: Option<&str>) -> HealthResult<Option<String>> {
    let reason = reason.map(str::trim).filter(|reason| !reason.is_empty());
    if reason.is_some_and(|reason| {
        reason.chars().count() > MAX_AUDIT_REASON_CHARACTERS || reason.chars().any(char::is_control)
    }) {
        return Err(validation(
            "audit.reason",
            format!("must contain at most {MAX_AUDIT_REASON_CHARACTERS} non-control characters"),
        ));
    }
    Ok(reason.map(str::to_string))
}

/// Converts UTC occurrence instants with one configured fixed offset.
///
/// This intentionally does not apply IANA timezone or DST rules.
pub(super) fn checked_local_date(
    occurred_at: OffsetDateTime,
    offset: UtcOffset,
) -> HealthResult<Date> {
    let local = occurred_at.checked_to_offset(offset).ok_or_else(|| {
        validation(
            "occurred_at",
            "cannot be represented in the configured offset",
        )
    })?;
    if !(0..=9999).contains(&local.year()) {
        return Err(validation(
            "occurred_at",
            "local date must remain RFC3339 representable",
        ));
    }
    Ok(local.date())
}

pub(super) fn next_update_time(
    previous: OffsetDateTime,
    record_type: &str,
) -> HealthResult<OffsetDateTime> {
    let now = OffsetDateTime::now_utc();
    let candidate = if now > previous {
        now
    } else {
        previous
            .checked_add(Duration::nanoseconds(1))
            .ok_or_else(|| {
                HealthError::Conflict(format!("{record_type} timestamp cannot advance"))
            })?
    };
    candidate
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|_| HealthError::Conflict(format!("{record_type} timestamp cannot advance")))?;
    Ok(candidate)
}
