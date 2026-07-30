use serde::Serialize;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::application::error::{HealthError, HealthResult};
use crate::application::media::MediaStore;
use crate::application::ports::{
    HealthMutationRepository, HealthReadRepository, MediaFileRecord, Page,
};
use crate::application::service::{
    AuditMutation, HealthService, audit_event, checked_local_date, next_update_time,
    rollback_with_primary, safe_error_summary,
};
use crate::domain::{
    DietEntry, DietEntryRehydration, HealthEvent, HealthEventRehydration, HealthRecordId,
};

#[allow(private_bounds)]
impl<R: HealthReadRepository, M: MediaStore> HealthService<R, M> {
    pub fn get_diet_including_archived(&self, id: &str) -> HealthResult<DietEntry> {
        HealthRecordId::parse(id)?;
        self.repository
            .get_diet(id, true)?
            .ok_or_else(|| HealthError::NotFound(format!("diet entry {id}")))
    }

    pub fn get_event_including_archived(&self, id: &str) -> HealthResult<HealthEvent> {
        HealthRecordId::parse(id)?;
        self.repository
            .get_event(id, true)?
            .ok_or_else(|| HealthError::NotFound(format!("health event {id}")))
    }
}

#[allow(private_bounds)]
impl<R: HealthMutationRepository, M: MediaStore> HealthService<R, M> {
    pub fn start(repository: R, media_store: M) -> HealthResult<Self> {
        let mut service = Self::new(repository, media_store);
        service.retry_pending_media(100)?;
        Ok(service)
    }

    pub fn archive_diet(&mut self, id: &str) -> HealthResult<DietEntry> {
        self.archive_diet_if_current(id, None)
    }

    pub fn archive_diet_if_current(
        &mut self,
        id: &str,
        expected_updated_at: Option<OffsetDateTime>,
    ) -> HealthResult<DietEntry> {
        self.transition_diet(id, true, expected_updated_at)
    }

    pub fn restore_diet(&mut self, id: &str) -> HealthResult<DietEntry> {
        self.restore_diet_if_current(id, None)
    }

    pub fn restore_diet_if_current(
        &mut self,
        id: &str,
        expected_updated_at: Option<OffsetDateTime>,
    ) -> HealthResult<DietEntry> {
        self.transition_diet(id, false, expected_updated_at)
    }

    pub fn archive_event(&mut self, id: &str) -> HealthResult<HealthEvent> {
        self.archive_event_if_current(id, None)
    }

    pub fn archive_event_if_current(
        &mut self,
        id: &str,
        expected_updated_at: Option<OffsetDateTime>,
    ) -> HealthResult<HealthEvent> {
        self.transition_event(id, true, expected_updated_at)
    }

    pub fn restore_event(&mut self, id: &str) -> HealthResult<HealthEvent> {
        self.restore_event_if_current(id, None)
    }

    pub fn restore_event_if_current(
        &mut self,
        id: &str,
        expected_updated_at: Option<OffsetDateTime>,
    ) -> HealthResult<HealthEvent> {
        self.transition_event(id, false, expected_updated_at)
    }

    pub fn purge_diet(&mut self, id: &str, confirmation: &str) -> HealthResult<()> {
        confirm(id, confirmation)?;
        HealthRecordId::parse(id)?;
        let now = OffsetDateTime::now_utc();
        let request_id = Uuid::new_v4().to_string();
        let mut transaction = self.repository.begin_transaction()?;
        let result = (|| {
            let diet = transaction
                .get_diet(id, true)?
                .ok_or_else(|| HealthError::NotFound(format!("diet entry {id}")))?;
            if diet.deleted_at().is_none() {
                return Err(HealthError::Conflict(
                    "diet entry must be archived before purge".to_string(),
                ));
            }
            let pending = diet
                .media_id()
                .map(|media_id| {
                    let before =
                        transaction
                            .get_media(media_id.as_str(), true)?
                            .ok_or_else(|| {
                                HealthError::Conflict(format!(
                                    "diet entry references missing media {}",
                                    media_id.as_str()
                                ))
                            })?;
                    let mut after = before.clone();
                    after.cleanup_pending = true;
                    after.updated_at = next_update_time(after.updated_at, "media")?;
                    after.deleted_at = Some(after.updated_at);
                    transaction.update_media(&after)?;
                    transaction.insert_audit_event(&media_audit(
                        &request_id,
                        after.updated_at,
                        "detach",
                        &before,
                        Some(&after),
                    )?)?;
                    Ok::<_, HealthError>(after)
                })
                .transpose()?;
            transaction.delete_diet(id)?;
            transaction.insert_audit_event(&audit_event(AuditMutation {
                request_id: &request_id,
                occurred_at: now,
                actor: "local",
                action: "purge",
                record_type: "diet_entry",
                record_id: id,
                before: Some(&diet),
                after: None::<&DietEntry>,
                reason: None,
            })?)?;
            Ok(pending)
        })();
        let pending = match result {
            Ok(pending) => pending,
            Err(primary) => return Err(rollback_with_primary(transaction, primary)),
        };
        transaction.commit()?;
        if let Some(pending) = pending {
            self.cleanup_pending_media(pending)?;
        }
        Ok(())
    }

    pub fn purge_event(&mut self, id: &str, confirmation: &str) -> HealthResult<()> {
        confirm(id, confirmation)?;
        HealthRecordId::parse(id)?;
        let now = OffsetDateTime::now_utc();
        let request_id = Uuid::new_v4().to_string();
        let mut transaction = self.repository.begin_transaction()?;
        let result = (|| {
            let event = transaction
                .get_event(id, true)?
                .ok_or_else(|| HealthError::NotFound(format!("health event {id}")))?;
            if event.deleted_at().is_none() {
                return Err(HealthError::Conflict(
                    "health event must be archived before purge".to_string(),
                ));
            }
            transaction.delete_event(id)?;
            transaction.insert_audit_event(&audit_event(AuditMutation {
                request_id: &request_id,
                occurred_at: now,
                actor: "local",
                action: "purge",
                record_type: "health_event",
                record_id: id,
                before: Some(&event),
                after: None::<&HealthEvent>,
                reason: None,
            })?)?;
            Ok(())
        })();
        if let Err(primary) = result {
            return Err(rollback_with_primary(transaction, primary));
        }
        transaction.commit()
    }

    pub fn retry_pending_media(&mut self, limit: u16) -> HealthResult<u16> {
        let page = Page::new(0, limit)?;
        let pending = self.repository.list_pending_media(page)?;
        let mut completed = 0;
        for record in pending {
            self.cleanup_pending_media(record)?;
            completed += 1;
        }
        Ok(completed)
    }

    fn transition_diet(
        &mut self,
        id: &str,
        archive: bool,
        expected_updated_at: Option<OffsetDateTime>,
    ) -> HealthResult<DietEntry> {
        HealthRecordId::parse(id)?;
        let mut transaction = self.repository.begin_transaction()?;
        let before = match transaction.get_diet(id, true)? {
            Some(record) => record,
            None => {
                return Err(rollback_with_primary(
                    transaction,
                    HealthError::NotFound(format!("diet entry {id}")),
                ));
            }
        };
        if let Err(primary) = ensure_version(id, before.updated_at(), expected_updated_at) {
            return Err(rollback_with_primary(transaction, primary));
        }
        if before.deleted_at().is_some() == archive {
            return Err(rollback_with_primary(
                transaction,
                HealthError::Conflict(format!(
                    "diet entry is already {}",
                    if archive { "archived" } else { "active" }
                )),
            ));
        }
        if !archive {
            if let Some(media_id) = before.media_id() {
                if transaction.get_media(media_id.as_str(), false)?.is_none() {
                    return Err(rollback_with_primary(
                        transaction,
                        HealthError::Conflict(format!(
                            "cannot restore diet entry with unavailable media {}",
                            media_id.as_str()
                        )),
                    ));
                }
            }
        }
        let now = next_update_time(before.updated_at(), "diet")?;
        let after = diet_with_deleted(&before, archive.then_some(now), now)?;
        let local_date = checked_local_date(after.occurred_at(), self.local_offset)?;
        let request_id = Uuid::new_v4().to_string();
        let result = (|| {
            transaction.update_diet(&after, local_date)?;
            transaction.insert_audit_event(&audit_event(AuditMutation {
                request_id: &request_id,
                occurred_at: now,
                actor: "local",
                action: if archive { "archive" } else { "restore" },
                record_type: "diet_entry",
                record_id: id,
                before: Some(&before),
                after: Some(&after),
                reason: None,
            })?)?;
            Ok(())
        })();
        if let Err(primary) = result {
            return Err(rollback_with_primary(transaction, primary));
        }
        transaction.commit()?;
        Ok(after)
    }

    fn transition_event(
        &mut self,
        id: &str,
        archive: bool,
        expected_updated_at: Option<OffsetDateTime>,
    ) -> HealthResult<HealthEvent> {
        HealthRecordId::parse(id)?;
        let mut transaction = self.repository.begin_transaction()?;
        let before = match transaction.get_event(id, true)? {
            Some(record) => record,
            None => {
                return Err(rollback_with_primary(
                    transaction,
                    HealthError::NotFound(format!("health event {id}")),
                ));
            }
        };
        if let Err(primary) = ensure_version(id, before.updated_at(), expected_updated_at) {
            return Err(rollback_with_primary(transaction, primary));
        }
        if before.deleted_at().is_some() == archive {
            return Err(rollback_with_primary(
                transaction,
                HealthError::Conflict(format!(
                    "health event is already {}",
                    if archive { "archived" } else { "active" }
                )),
            ));
        }
        let now = next_update_time(before.updated_at(), "health event")?;
        let after = event_with_deleted(&before, archive.then_some(now), now)?;
        let local_date = checked_local_date(after.occurred_at(), self.local_offset)?;
        let request_id = Uuid::new_v4().to_string();
        let result = (|| {
            transaction.update_event(&after, local_date)?;
            transaction.insert_audit_event(&audit_event(AuditMutation {
                request_id: &request_id,
                occurred_at: now,
                actor: "local",
                action: if archive { "archive" } else { "restore" },
                record_type: "health_event",
                record_id: id,
                before: Some(&before),
                after: Some(&after),
                reason: None,
            })?)?;
            Ok(())
        })();
        if let Err(primary) = result {
            return Err(rollback_with_primary(transaction, primary));
        }
        transaction.commit()?;
        Ok(after)
    }

    fn cleanup_pending_media(&mut self, pending: MediaFileRecord) -> HealthResult<()> {
        if let Err(error) = self
            .media_store
            .remove(std::path::Path::new(&pending.relative_path))
        {
            return Err(HealthError::CleanupPending {
                record_id: pending.id,
                message: safe_error_summary(&error),
            });
        }
        let request_id = Uuid::new_v4().to_string();
        let now = next_update_time(pending.updated_at, "media")?;
        let mut transaction =
            self.repository
                .begin_transaction()
                .map_err(|error| HealthError::CleanupPending {
                    record_id: pending.id.clone(),
                    message: safe_error_summary(&error),
                })?;
        let result = (|| {
            let current = match transaction.get_media(&pending.id, true)? {
                Some(current) if current.cleanup_pending => current,
                Some(_) => {
                    return Err(HealthError::Conflict(
                        "media is no longer pending cleanup".to_string(),
                    ));
                }
                None => return Ok(()),
            };
            transaction.delete_media(&pending.id)?;
            transaction.insert_audit_event(&media_audit(
                &request_id,
                now,
                "cleanup",
                &current,
                None,
            )?)?;
            Ok(())
        })();
        if let Err(primary) = result {
            let primary = rollback_with_primary(transaction, primary);
            return Err(HealthError::CleanupPending {
                record_id: pending.id,
                message: safe_error_summary(&primary),
            });
        }
        transaction
            .commit()
            .map_err(|error| HealthError::CleanupPending {
                record_id: pending.id,
                message: safe_error_summary(&error),
            })
    }
}

fn confirm(id: &str, confirmation: &str) -> HealthResult<()> {
    if confirmation != id {
        return Err(HealthError::ConfirmationMismatch);
    }
    Ok(())
}

fn ensure_version(
    id: &str,
    current: OffsetDateTime,
    expected: Option<OffsetDateTime>,
) -> HealthResult<()> {
    if expected.is_some_and(|expected| expected != current) {
        return Err(HealthError::Conflict(format!(
            "health record {id} changed since it was read"
        )));
    }
    Ok(())
}

fn diet_with_deleted(
    before: &DietEntry,
    deleted_at: Option<OffsetDateTime>,
    updated_at: OffsetDateTime,
) -> HealthResult<DietEntry> {
    DietEntry::rehydrate(DietEntryRehydration {
        id: before.id().as_str().to_string(),
        occurred_at: before.occurred_at(),
        meal_type: before.meal_type(),
        food_name: before.food_name().to_string(),
        note: before.note().map(str::to_string),
        tags: before.tags().to_vec(),
        media_id: before.media_id().map(|id| id.as_str().to_string()),
        created_at: before.created_at(),
        updated_at,
        deleted_at,
    })
    .map_err(Into::into)
}

fn event_with_deleted(
    before: &HealthEvent,
    deleted_at: Option<OffsetDateTime>,
    updated_at: OffsetDateTime,
) -> HealthResult<HealthEvent> {
    HealthEvent::rehydrate(HealthEventRehydration {
        id: before.id().as_str().to_string(),
        occurred_at: before.occurred_at(),
        category: before.category(),
        metric_key: before.metric_key().as_str().to_string(),
        name: before.name().to_string(),
        value_num: before.value_num(),
        unit: before.unit().map(str::to_string),
        note: before.note().map(str::to_string),
        attributes: before.attributes().clone(),
        created_at: before.created_at(),
        updated_at,
        deleted_at,
    })
    .map_err(Into::into)
}

#[derive(Serialize)]
struct MediaSnapshot {
    id: String,
    mime_type: String,
    byte_size: u64,
    checksum_sha256: String,
    cleanup_pending: bool,
    #[serde(with = "time::serde::rfc3339::option")]
    deleted_at: Option<OffsetDateTime>,
}

impl From<&MediaFileRecord> for MediaSnapshot {
    fn from(record: &MediaFileRecord) -> Self {
        Self {
            id: record.id.clone(),
            mime_type: record.mime_type.clone(),
            byte_size: record.byte_size,
            checksum_sha256: record.checksum_sha256.clone(),
            cleanup_pending: record.cleanup_pending,
            deleted_at: record.deleted_at,
        }
    }
}

fn media_audit(
    request_id: &str,
    occurred_at: OffsetDateTime,
    action: &'static str,
    before: &MediaFileRecord,
    after: Option<&MediaFileRecord>,
) -> HealthResult<crate::application::ports::AuditEvent> {
    let before_snapshot = MediaSnapshot::from(before);
    let after_snapshot = after.map(MediaSnapshot::from);
    audit_event(AuditMutation {
        request_id,
        occurred_at,
        actor: "local",
        action,
        record_type: "media_file",
        record_id: &before.id,
        before: Some(&before_snapshot),
        after: after_snapshot.as_ref(),
        reason: None,
    })
}
