use serde_json::Value;
use std::path::Path;
use time::{Date, OffsetDateTime};

use crate::application::error::{HealthError, HealthResult};
use crate::domain::{DietEntry, HealthEvent, HealthRecordId};

pub const DEFAULT_PAGE_LIMIT: u16 = 100;
pub const MAX_PAGE_LIMIT: u16 = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Page {
    offset: u32,
    limit: u16,
}

impl Page {
    pub fn new(offset: u32, limit: u16) -> HealthResult<Self> {
        if limit == 0 || limit > MAX_PAGE_LIMIT {
            return Err(HealthError::Validation {
                field: "limit",
                message: format!("must be between 1 and {MAX_PAGE_LIMIT}"),
            });
        }
        Ok(Self { offset, limit })
    }

    pub const fn offset(self) -> u32 {
        self.offset
    }

    pub const fn limit(self) -> u16 {
        self.limit
    }
}

impl Default for Page {
    fn default() -> Self {
        Self {
            offset: 0,
            limit: DEFAULT_PAGE_LIMIT,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AuditEvent {
    pub id: String,
    pub request_id: String,
    pub occurred_at: OffsetDateTime,
    pub actor: String,
    pub action: String,
    pub record_type: String,
    pub record_id: String,
    pub before: Option<Value>,
    pub after: Option<Value>,
    pub reason: Option<String>,
}

impl AuditEvent {
    pub(crate) fn validate(&self) -> HealthResult<()> {
        HealthRecordId::parse(&self.id)?;
        HealthRecordId::parse(&self.request_id)?;
        HealthRecordId::parse(&self.record_id)?;
        for (field, value) in [
            ("audit.actor", self.actor.as_str()),
            ("audit.action", self.action.as_str()),
            ("audit.record_type", self.record_type.as_str()),
        ] {
            if value.is_empty() || value.trim() != value {
                return Err(HealthError::Validation {
                    field,
                    message: "must be nonblank and already trimmed".to_string(),
                });
            }
        }
        if self
            .reason
            .as_deref()
            .is_some_and(|reason| reason.is_empty() || reason.trim() != reason)
        {
            return Err(HealthError::Validation {
                field: "audit.reason",
                message: "must be nonblank and already trimmed".to_string(),
            });
        }
        if self
            .before
            .iter()
            .chain(self.after.iter())
            .any(|snapshot| !snapshot.is_object())
        {
            return Err(HealthError::Validation {
                field: "audit.snapshot",
                message: "must be a JSON object".to_string(),
            });
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct MediaFileRecord {
    pub id: String,
    pub relative_path: String,
    pub mime_type: String,
    pub byte_size: u64,
    pub checksum_sha256: String,
    pub cleanup_pending: bool,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub deleted_at: Option<OffsetDateTime>,
}

impl MediaFileRecord {
    pub(crate) fn validate(&self) -> HealthResult<()> {
        HealthRecordId::parse(&self.id)?;
        let path = Path::new(&self.relative_path);
        if self.relative_path.contains('\\')
            || self.relative_path.contains('\0')
            || path.is_absolute()
            || self.relative_path.trim() != self.relative_path
            || self.relative_path.is_empty()
            || self
                .relative_path
                .split('/')
                .any(|segment| segment.is_empty() || matches!(segment, "." | ".."))
        {
            return Err(HealthError::Validation {
                field: "media.relative_path",
                message: "must be a normalized relative path without traversal".to_string(),
            });
        }
        if !matches!(
            self.mime_type.as_str(),
            "image/jpeg" | "image/png" | "image/webp"
        ) {
            return Err(HealthError::Validation {
                field: "media.mime_type",
                message: "must be image/jpeg, image/png, or image/webp".to_string(),
            });
        }
        if self.checksum_sha256.len() != 64
            || !self
                .checksum_sha256
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(HealthError::Validation {
                field: "media.checksum_sha256",
                message: "must be 64 lowercase hexadecimal characters".to_string(),
            });
        }
        if self.updated_at < self.created_at
            || self.deleted_at.is_some_and(|deleted_at| {
                deleted_at < self.created_at || deleted_at > self.updated_at
            })
        {
            return Err(HealthError::Validation {
                field: "media.lifecycle",
                message: "timestamps are out of order".to_string(),
            });
        }
        Ok(())
    }
}

/// Persistence operations that form one policy-enforced Health mutation.
///
/// The trait is crate-private: only `HealthService` and the SQLite adapter can
/// obtain it, so external callers cannot persist a record without its audit.
#[allow(dead_code)]
pub(crate) trait HealthTransaction {
    fn get_diet(&self, id: &str, include_archived: bool) -> HealthResult<Option<DietEntry>>;
    fn get_event(&self, id: &str, include_archived: bool) -> HealthResult<Option<HealthEvent>>;
    fn insert_media(&mut self, media: &MediaFileRecord) -> HealthResult<()>;
    fn update_media(&mut self, media: &MediaFileRecord) -> HealthResult<()>;
    fn delete_media(&mut self, id: &str) -> HealthResult<()>;
    fn insert_diet(&mut self, entry: &DietEntry, local_date: Date) -> HealthResult<()>;
    fn update_diet(&mut self, entry: &DietEntry, local_date: Date) -> HealthResult<()>;
    fn replace_diet_tags(&mut self, entry: &DietEntry) -> HealthResult<()>;
    fn delete_diet(&mut self, id: &str) -> HealthResult<()>;
    fn insert_event(
        &mut self,
        event: &HealthEvent,
        local_date: Date,
        daily_upsert: bool,
    ) -> HealthResult<()>;
    fn update_event(
        &mut self,
        event: &HealthEvent,
        local_date: Date,
        daily_upsert: bool,
    ) -> HealthResult<()>;
    fn delete_event(&mut self, id: &str) -> HealthResult<()>;
    fn insert_audit_event(&mut self, event: &AuditEvent) -> HealthResult<()>;
    fn commit(self: Box<Self>) -> HealthResult<()>;
    fn rollback(self: Box<Self>) -> HealthResult<()>;
}

/// Public marker for supported Health persistence adapters.
pub trait HealthRepository: Send {}

#[allow(dead_code)]
pub(crate) trait HealthReadRepository: HealthRepository {
    fn get_diet(&self, id: &str, include_archived: bool) -> HealthResult<Option<DietEntry>>;
    fn list_diet(&self, page: Page, include_archived: bool) -> HealthResult<Vec<DietEntry>>;
    fn get_event(&self, id: &str, include_archived: bool) -> HealthResult<Option<HealthEvent>>;
    fn list_events(&self, page: Page, include_archived: bool) -> HealthResult<Vec<HealthEvent>>;
    fn list_audit_events(
        &self,
        record_type: &str,
        record_id: &str,
        page: Page,
    ) -> HealthResult<Vec<AuditEvent>>;
    fn list_pending_media(&self, page: Page) -> HealthResult<Vec<MediaFileRecord>>;
}

#[allow(dead_code)]
pub(crate) trait HealthMutationRepository: HealthReadRepository {
    fn begin_transaction(&mut self) -> HealthResult<Box<dyn HealthTransaction + '_>>;
}
