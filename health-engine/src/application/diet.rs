use serde::Serialize;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use crate::application::commands::{
    CreateDietEntry, DietMediaUpdate, MediaUpload, UpdateDietEntry,
};
use crate::application::error::{HealthError, HealthResult};
use crate::application::media::{MediaStore, StoredMedia};
use crate::application::ports::{
    HealthMutationRepository, HealthReadRepository, MediaFileRecord, Page,
};
use crate::application::service::{
    AuditMutation, HealthService, audit_event, cleanup_with_primary, media_record,
    rollback_with_primary, safe_error_summary, validate_actor, validate_reason,
};
use crate::domain::{DietEntry, DietEntryRehydration, NewDietEntry};

#[allow(private_bounds)]
impl<R: HealthReadRepository, M: MediaStore> HealthService<R, M> {
    pub fn get_diet(&self, id: &str) -> HealthResult<DietEntry> {
        self.repository
            .get_diet(id, false)?
            .ok_or_else(|| HealthError::NotFound(format!("diet entry {id}")))
    }

    pub fn list_diet(&self, page: Page) -> HealthResult<Vec<DietEntry>> {
        self.repository.list_diet(page, false)
    }
}

#[allow(private_bounds)]
impl<R: HealthMutationRepository, M: MediaStore> HealthService<R, M> {
    pub fn create_diet(&mut self, command: CreateDietEntry) -> HealthResult<DietEntry> {
        validate_actor(&command.actor)?;
        let CreateDietEntry {
            occurred_at,
            meal_type,
            food_name,
            note,
            tags,
            media,
            actor,
        } = command;
        let validated = NewDietEntry::new(
            occurred_at,
            meal_type,
            food_name,
            note.as_deref(),
            tags,
            None,
        )?;
        let finalized = self.finalize_upload(media.as_ref())?;
        let now = OffsetDateTime::now_utc();
        let entry = rehydrate_diet(
            Uuid::new_v4().to_string(),
            &validated,
            finalized.as_ref(),
            now,
            now,
        )?;
        let request_id = Uuid::new_v4().to_string();

        let persistence =
            self.persist_new_diet(&entry, finalized.as_ref(), now, &request_id, &actor);
        match persistence {
            Ok(()) => Ok(entry),
            Err(primary) => Err(match finalized {
                Some(media) => {
                    cleanup_with_primary(&self.media_store, media.relative_path(), primary)
                }
                None => primary,
            }),
        }
    }

    pub fn update_diet(&mut self, id: &str, command: UpdateDietEntry) -> HealthResult<DietEntry> {
        validate_actor(&command.actor)?;
        validate_reason(command.reason.as_deref())?;
        let before = self
            .repository
            .get_diet(id, false)?
            .ok_or_else(|| HealthError::NotFound(format!("diet entry {id}")))?;
        ensure_expected_version(&before, command.expected_updated_at)?;

        let occurred_at = command.occurred_at.unwrap_or_else(|| before.occurred_at());
        let meal_type = command.meal_type.unwrap_or_else(|| before.meal_type());
        let food_name = command
            .food_name
            .unwrap_or_else(|| before.food_name().to_string());
        let note = command
            .note
            .unwrap_or_else(|| before.note().map(str::to_string));
        let tags = command.tags.unwrap_or_else(|| before.tags().to_vec());
        let validated = NewDietEntry::new(
            occurred_at,
            meal_type,
            food_name,
            note.as_deref(),
            tags,
            None,
        )?;
        let finalized = match &command.media {
            DietMediaUpdate::Replace(upload) => self.finalize_upload(Some(upload))?,
            DietMediaUpdate::Preserve | DietMediaUpdate::Remove => None,
        };
        let preserved_media = match command.media {
            DietMediaUpdate::Preserve => before.media_id().map(|media| media.as_str()),
            DietMediaUpdate::Remove | DietMediaUpdate::Replace(_) => None,
        };
        let now = next_update_time(before.updated_at())?;
        let after = rehydrate_updated_diet(
            &before,
            &validated,
            finalized.as_ref(),
            preserved_media,
            now,
        )?;
        let request_id = Uuid::new_v4().to_string();
        let actor = command.actor;
        let reason = command.reason;
        let old_media_id = if after.media_id() != before.media_id() {
            before.media_id().map(|media| media.as_str().to_string())
        } else {
            None
        };

        let persistence = self.persist_updated_diet(
            &before,
            &after,
            finalized.as_ref(),
            old_media_id.as_deref(),
            now,
            &request_id,
            &actor,
            reason.as_deref(),
        );
        let old_pending = match persistence {
            Ok(old_pending) => old_pending,
            Err(primary) => {
                return Err(match finalized {
                    Some(media) => {
                        cleanup_with_primary(&self.media_store, media.relative_path(), primary)
                    }
                    None => primary,
                });
            }
        };
        if let Some(old_pending) = old_pending {
            self.complete_replaced_media_cleanup(&after, old_pending, &actor, &request_id)?;
        }
        Ok(after)
    }

    fn finalize_upload(&self, upload: Option<&MediaUpload>) -> HealthResult<Option<StoredMedia>> {
        upload
            .map(|upload| {
                self.media_store
                    .stage(&upload.content_type, &upload.bytes)
                    .and_then(|staged| self.media_store.finalize(staged))
            })
            .transpose()
    }

    fn persist_new_diet(
        &mut self,
        entry: &DietEntry,
        media: Option<&StoredMedia>,
        now: OffsetDateTime,
        request_id: &str,
        actor: &str,
    ) -> HealthResult<()> {
        let local_date = entry.occurred_at().to_offset(self.local_offset).date();
        let mut transaction = self.repository.begin_transaction()?;
        let result = (|| {
            if let Some(media) = media {
                let record = media_record(media, now, false, None);
                transaction.insert_media(&record)?;
                transaction.insert_audit_event(&audit_event(AuditMutation {
                    request_id,
                    occurred_at: now,
                    actor,
                    action: "create",
                    record_type: "media_file",
                    record_id: media.id(),
                    before: None::<&MediaAuditSnapshot>,
                    after: Some(&MediaAuditSnapshot::from_record(&record)),
                    reason: None,
                })?)?;
            }
            transaction.insert_diet(entry, local_date)?;
            transaction.replace_diet_tags(entry)?;
            transaction.insert_audit_event(&audit_event(AuditMutation {
                request_id,
                occurred_at: now,
                actor,
                action: "create",
                record_type: "diet_entry",
                record_id: entry.id().as_str(),
                before: None::<&DietEntry>,
                after: Some(entry),
                reason: None,
            })?)?;
            Ok(())
        })();
        if let Err(primary) = result {
            return Err(rollback_with_primary(transaction, primary));
        }
        transaction.commit()
    }

    #[allow(clippy::too_many_arguments)]
    fn persist_updated_diet(
        &mut self,
        before: &DietEntry,
        after: &DietEntry,
        new_media: Option<&StoredMedia>,
        old_media_id: Option<&str>,
        now: OffsetDateTime,
        request_id: &str,
        actor: &str,
        reason: Option<&str>,
    ) -> HealthResult<Option<MediaFileRecord>> {
        let local_date = after.occurred_at().to_offset(self.local_offset).date();
        let mut transaction = self.repository.begin_transaction()?;
        let result = (|| {
            let current = transaction
                .get_diet(before.id().as_str(), false)?
                .ok_or_else(|| {
                    HealthError::NotFound(format!("diet entry {}", before.id().as_str()))
                })?;
            if current.updated_at() != before.updated_at() {
                return Err(HealthError::Conflict(format!(
                    "diet entry {} changed since it was read",
                    before.id().as_str()
                )));
            }

            if let Some(media) = new_media {
                let record = media_record(media, now, false, None);
                transaction.insert_media(&record)?;
                transaction.insert_audit_event(&audit_event(AuditMutation {
                    request_id,
                    occurred_at: now,
                    actor,
                    action: "create",
                    record_type: "media_file",
                    record_id: media.id(),
                    before: None::<&MediaAuditSnapshot>,
                    after: Some(&MediaAuditSnapshot::from_record(&record)),
                    reason,
                })?)?;
            }

            let old_pending = old_media_id
                .map(|old_media_id| {
                    let old = transaction.get_media(old_media_id, true)?.ok_or_else(|| {
                        HealthError::Storage(format!(
                            "diet entry references missing media {old_media_id}"
                        ))
                    })?;
                    let mut pending = old.clone();
                    pending.cleanup_pending = true;
                    pending.updated_at = now;
                    pending.deleted_at = Some(now);
                    transaction.update_media(&pending)?;
                    transaction.insert_audit_event(&audit_event(AuditMutation {
                        request_id,
                        occurred_at: now,
                        actor,
                        action: "detach",
                        record_type: "media_file",
                        record_id: old_media_id,
                        before: Some(&MediaAuditSnapshot::from_record(&old)),
                        after: Some(&MediaAuditSnapshot::from_record(&pending)),
                        reason,
                    })?)?;
                    Ok::<MediaFileRecord, HealthError>(pending)
                })
                .transpose()?;

            transaction.update_diet(after, local_date)?;
            transaction.replace_diet_tags(after)?;
            transaction.insert_audit_event(&audit_event(AuditMutation {
                request_id,
                occurred_at: now,
                actor,
                action: "update",
                record_type: "diet_entry",
                record_id: after.id().as_str(),
                before: Some(before),
                after: Some(after),
                reason,
            })?)?;
            Ok(old_pending)
        })();
        let old_pending = match result {
            Ok(old_pending) => old_pending,
            Err(primary) => return Err(rollback_with_primary(transaction, primary)),
        };
        transaction.commit()?;
        Ok(old_pending)
    }

    fn complete_replaced_media_cleanup(
        &mut self,
        diet: &DietEntry,
        mut pending: MediaFileRecord,
        actor: &str,
        request_id: &str,
    ) -> HealthResult<()> {
        let relative_path = std::path::Path::new(&pending.relative_path);
        if let Err(cleanup) = self.media_store.remove(relative_path) {
            return Err(HealthError::CleanupPending {
                record_id: diet.id().as_str().to_string(),
                message: safe_error_summary(&cleanup),
            });
        }

        let before = pending.clone();
        pending.cleanup_pending = false;
        pending.updated_at = next_update_time(pending.updated_at)?;
        let now = pending.updated_at;
        let mut transaction =
            self.repository
                .begin_transaction()
                .map_err(|error| HealthError::CleanupPending {
                    record_id: diet.id().as_str().to_string(),
                    message: safe_error_summary(&error),
                })?;
        let result = (|| {
            transaction.update_media(&pending)?;
            transaction.insert_audit_event(&audit_event(AuditMutation {
                request_id,
                occurred_at: now,
                actor,
                action: "cleanup",
                record_type: "media_file",
                record_id: &pending.id,
                before: Some(&MediaAuditSnapshot::from_record(&before)),
                after: Some(&MediaAuditSnapshot::from_record(&pending)),
                reason: None,
            })?)?;
            Ok(())
        })();
        if let Err(primary) = result {
            let primary = rollback_with_primary(transaction, primary);
            return Err(HealthError::CleanupPending {
                record_id: diet.id().as_str().to_string(),
                message: safe_error_summary(&primary),
            });
        }
        transaction
            .commit()
            .map_err(|error| HealthError::CleanupPending {
                record_id: diet.id().as_str().to_string(),
                message: safe_error_summary(&error),
            })
    }
}

fn rehydrate_diet(
    id: String,
    input: &NewDietEntry,
    media: Option<&StoredMedia>,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
) -> HealthResult<DietEntry> {
    DietEntry::rehydrate(DietEntryRehydration {
        id,
        occurred_at: input.occurred_at(),
        meal_type: input.meal_type(),
        food_name: input.food_name().to_string(),
        note: input.note().map(str::to_string),
        tags: input.tags().to_vec(),
        media_id: media.map(|media| media.id().to_string()),
        created_at,
        updated_at,
        deleted_at: None,
    })
    .map_err(Into::into)
}

fn rehydrate_updated_diet(
    before: &DietEntry,
    input: &NewDietEntry,
    new_media: Option<&StoredMedia>,
    preserved_media: Option<&str>,
    updated_at: OffsetDateTime,
) -> HealthResult<DietEntry> {
    let media_id = new_media
        .map(|media| media.id().to_string())
        .or_else(|| preserved_media.map(str::to_string));
    DietEntry::rehydrate(DietEntryRehydration {
        id: before.id().as_str().to_string(),
        occurred_at: input.occurred_at(),
        meal_type: input.meal_type(),
        food_name: input.food_name().to_string(),
        note: input.note().map(str::to_string),
        tags: input.tags().to_vec(),
        media_id,
        created_at: before.created_at(),
        updated_at,
        deleted_at: before.deleted_at(),
    })
    .map_err(Into::into)
}

fn ensure_expected_version(
    before: &DietEntry,
    expected_updated_at: Option<OffsetDateTime>,
) -> HealthResult<()> {
    if expected_updated_at.is_some_and(|expected| expected != before.updated_at()) {
        return Err(HealthError::Conflict(format!(
            "diet entry {} changed since it was read",
            before.id().as_str()
        )));
    }
    Ok(())
}

fn next_update_time(previous: OffsetDateTime) -> HealthResult<OffsetDateTime> {
    let now = OffsetDateTime::now_utc();
    if now > previous {
        return Ok(now);
    }
    previous
        .checked_add(Duration::nanoseconds(1))
        .ok_or_else(|| HealthError::Conflict("diet timestamp cannot advance".to_string()))
}

#[derive(Serialize)]
struct MediaAuditSnapshot {
    id: String,
    mime_type: String,
    byte_size: u64,
    checksum_sha256: String,
    cleanup_pending: bool,
    #[serde(with = "time::serde::rfc3339::option")]
    deleted_at: Option<OffsetDateTime>,
}

impl MediaAuditSnapshot {
    fn from_record(record: &MediaFileRecord) -> Self {
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

#[allow(private_bounds)]
impl<R: HealthMutationRepository, M: MediaStore> HealthService<R, M> {
    pub fn store_media(&mut self, content_type: &str, bytes: &[u8]) -> HealthResult<StoredMedia> {
        let staged = self.media_store.stage(content_type, bytes)?;
        let stored = self.media_store.finalize(staged)?;
        let now = OffsetDateTime::now_utc();
        let request_id = Uuid::new_v4().to_string();
        let record = media_record(&stored, now, false, None);
        let mut transaction = match self.repository.begin_transaction() {
            Ok(transaction) => transaction,
            Err(primary) => {
                return Err(cleanup_with_primary(
                    &self.media_store,
                    stored.relative_path(),
                    primary,
                ));
            }
        };
        let result = (|| {
            transaction.insert_media(&record)?;
            transaction.insert_audit_event(&audit_event(AuditMutation {
                request_id: &request_id,
                occurred_at: now,
                actor: "local",
                action: "create",
                record_type: "media_file",
                record_id: stored.id(),
                before: None::<&MediaAuditSnapshot>,
                after: Some(&MediaAuditSnapshot::from_record(&record)),
                reason: None,
            })?)?;
            Ok(())
        })();
        if let Err(primary) = result {
            let primary = rollback_with_primary(transaction, primary);
            return Err(cleanup_with_primary(
                &self.media_store,
                stored.relative_path(),
                primary,
            ));
        }
        if let Err(primary) = transaction.commit() {
            return Err(cleanup_with_primary(
                &self.media_store,
                stored.relative_path(),
                primary,
            ));
        }
        Ok(stored)
    }
}
