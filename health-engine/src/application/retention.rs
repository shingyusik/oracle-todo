//! Retention purge of archived Health Journal records and their photos.
//!
//! Planning is a read path. Applying deletes each due record, erases its audit
//! history, and leaves one payload-free `purge` tombstone. Photos follow the
//! normal detach -> cleanup trail; a failed file removal stays cleanup-pending.

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;

use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::application::error::{HealthError, HealthResult};
use crate::application::media::MediaStore;
use crate::application::ports::{
    HealthMutationRepository, HealthReadRepository, HealthTransaction, MediaFileRecord,
};
use crate::application::service::{
    AuditMutation, HealthService, audit_event, next_update_time, rollback_with_primary,
};

pub const KIND_DIET: &str = "health_diet";
pub const KIND_BOWEL: &str = "health_bowel";
pub const KIND_MEDICATION: &str = "health_medication";
pub const KIND_METRIC: &str = "health_metric";
pub const KIND_MEDIA: &str = "health_media";

pub const SKIP_UNPARSEABLE_TIMESTAMP: &str = "unparseable_timestamp";
pub const SKIP_MEDIA_SHARED: &str = "media_shared";
pub const SKIP_CHANGED_SINCE_PLAN: &str = "changed_since_plan";

/// Maximum number of planned roots deleted in one SQLite transaction.
pub const MAX_ROOTS_PER_TRANSACTION: usize = 200;

pub(crate) const RETENTION_ACTOR: &str = "retention";
pub(crate) const RETENTION_REASON: &str = "retention";
pub(crate) const PURGE_ACTION: &str = "purge";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetentionWindow {
    pub now: OffsetDateTime,
    pub cutoff: OffsetDateTime,
    pub local_today: Date,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetentionCandidate {
    pub kind: &'static str,
    pub id: String,
    pub label: String,
    pub archived_at: OffsetDateTime,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetentionPlan {
    pub window: RetentionWindow,
    pub candidates: Vec<RetentionCandidate>,
    pub skipped: BTreeMap<&'static str, u64>,
}

impl RetentionPlan {
    pub fn empty(window: RetentionWindow) -> Self {
        Self {
            window,
            candidates: Vec::new(),
            skipped: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RetentionOutcome {
    pub purged: BTreeMap<&'static str, u64>,
    pub skipped: BTreeMap<&'static str, u64>,
    pub media_cleanup_pending: u64,
}

/// Archived rows as persisted; timestamps stay text so a bad value skips one record.
pub(crate) struct RetentionRows {
    pub diets: Vec<ArchivedDietRow>,
    pub events: Vec<ArchivedEventRow>,
    /// `(media_id, diet_entry_id)` for every diet referencing media used by an archived diet.
    pub media_references: Vec<(String, String)>,
}

pub(crate) struct ArchivedDietRow {
    pub id: String,
    pub label: String,
    pub deleted_at: String,
    pub media_id: Option<String>,
}

pub(crate) struct ArchivedEventRow {
    pub id: String,
    pub label: String,
    pub category: String,
    pub deleted_at: String,
}

pub(crate) fn event_kind(category: &str) -> &'static str {
    match category {
        "bowel" => KIND_BOWEL,
        "medication" => KIND_MEDICATION,
        _ => KIND_METRIC,
    }
}

/// Builds a plan from one consistent read of the store.
pub(crate) fn plan_from<R: HealthReadRepository + ?Sized>(
    repository: &R,
    window: &RetentionWindow,
) -> HealthResult<RetentionPlan> {
    let rows = repository.retention_rows()?;
    let mut plan = RetentionPlan::empty(*window);
    let mut diets = Vec::new();
    let mut due_diets = HashMap::new();
    for row in rows.diets {
        let Some(archived_at) = due(&row.deleted_at, window, &mut plan.skipped) else {
            continue;
        };
        if let Some(media_id) = &row.media_id {
            due_diets.insert(row.id.clone(), (media_id.clone(), archived_at));
        }
        diets.push(RetentionCandidate {
            kind: KIND_DIET,
            id: row.id,
            label: row.label,
            archived_at,
        });
    }
    let mut events = Vec::new();
    for row in rows.events {
        let Some(archived_at) = due(&row.deleted_at, window, &mut plan.skipped) else {
            continue;
        };
        events.push(RetentionCandidate {
            kind: event_kind(&row.category),
            id: row.id,
            label: row.label,
            archived_at,
        });
    }

    // A photo is due only when every diet referencing it is due in this plan.
    let mut media: BTreeMap<String, (bool, Option<OffsetDateTime>)> = BTreeMap::new();
    for (media_id, diet_id) in rows.media_references {
        let entry = media.entry(media_id).or_insert((true, None));
        match due_diets.get(&diet_id) {
            Some((_, archived_at)) => {
                entry.1 = Some(entry.1.map_or(*archived_at, |at| at.max(*archived_at)));
            }
            None => entry.0 = false,
        }
    }
    let mut photos = Vec::new();
    for (media_id, (all_due, archived_at)) in media {
        let Some(archived_at) = archived_at else {
            continue;
        };
        if all_due {
            photos.push(RetentionCandidate {
                kind: KIND_MEDIA,
                id: media_id,
                label: "diet photo".to_string(),
                archived_at,
            });
        } else {
            bump(&mut plan.skipped, SKIP_MEDIA_SHARED);
        }
    }

    for group in [&mut diets, &mut events, &mut photos] {
        group.sort_by(|left, right| {
            (left.archived_at, &left.id).cmp(&(right.archived_at, &right.id))
        });
    }
    // Photos come last so every referencing diet is gone before they are tombstoned.
    plan.candidates = diets.into_iter().chain(events).chain(photos).collect();
    Ok(plan)
}

fn due(
    deleted_at: &str,
    window: &RetentionWindow,
    skipped: &mut BTreeMap<&'static str, u64>,
) -> Option<OffsetDateTime> {
    match OffsetDateTime::parse(deleted_at, &time::format_description::well_known::Rfc3339) {
        Ok(archived_at) => (archived_at <= window.cutoff).then_some(archived_at),
        Err(_) => {
            bump(skipped, SKIP_UNPARSEABLE_TIMESTAMP);
            None
        }
    }
}

fn bump(counts: &mut BTreeMap<&'static str, u64>, key: &'static str) {
    *counts.entry(key).or_insert(0) += 1;
}

#[allow(private_bounds)]
impl<R: HealthReadRepository, M: MediaStore> HealthService<R, M> {
    /// Lists archived records due for purge. Never writes.
    pub fn retention_plan(&mut self, window: &RetentionWindow) -> HealthResult<RetentionPlan> {
        plan_from(&self.repository, window)
    }

    /// Relative paths (under the media root) of photos `retention_apply` would delete.
    pub fn retention_media_paths(&self, plan: &RetentionPlan) -> Vec<PathBuf> {
        plan.candidates
            .iter()
            .filter(|candidate| candidate.kind == KIND_MEDIA)
            .filter_map(|candidate| self.repository.get_media(&candidate.id, true).ok()?)
            .map(|media| PathBuf::from(media.relative_path))
            .collect()
    }
}

/// Per-transaction tallies, merged only after a successful commit.
#[derive(Default)]
struct BatchResult {
    purged: BTreeMap<&'static str, u64>,
    skipped: BTreeMap<&'static str, u64>,
    pending: Vec<MediaFileRecord>,
}

#[allow(private_bounds)]
impl<R: HealthMutationRepository, M: MediaStore> HealthService<R, M> {
    /// Purges the planned records, re-checking each one inside its transaction.
    pub fn retention_apply(&mut self, plan: &RetentionPlan) -> HealthResult<RetentionOutcome> {
        self.repository.set_purge_mode(true)?;
        let result = self.apply_retention_batches(plan);
        let restored = self.repository.set_purge_mode(false);
        let outcome = result?;
        restored?;
        Ok(outcome)
    }

    fn apply_retention_batches(&mut self, plan: &RetentionPlan) -> HealthResult<RetentionOutcome> {
        let mut outcome = RetentionOutcome::default();
        let mut pending = Vec::new();
        let mut failure = None;
        for batch in plan.candidates.chunks(MAX_ROOTS_PER_TRANSACTION) {
            match self.apply_retention_batch(&plan.window, batch) {
                Ok(result) => {
                    merge(&mut outcome.purged, result.purged);
                    merge(&mut outcome.skipped, result.skipped);
                    pending.extend(result.pending);
                }
                Err(error) => {
                    failure = Some(error);
                    break;
                }
            }
        }
        // Committed photo tombstones are cleaned even if a later batch failed.
        for media in pending {
            match self.cleanup_pending_media(media) {
                Ok(()) => bump(&mut outcome.purged, KIND_MEDIA),
                Err(_) => outcome.media_cleanup_pending += 1,
            }
        }
        match failure {
            Some(error) => Err(error),
            None => Ok(outcome),
        }
    }

    fn apply_retention_batch(
        &mut self,
        window: &RetentionWindow,
        batch: &[RetentionCandidate],
    ) -> HealthResult<BatchResult> {
        let request_id = Uuid::new_v4().to_string();
        let mut transaction = self.repository.begin_transaction()?;
        let result = (|| {
            let mut result = BatchResult::default();
            for candidate in batch {
                let now = OffsetDateTime::now_utc();
                let outcome = if candidate.kind == KIND_MEDIA {
                    purge_media(&mut *transaction, candidate, &request_id, now)?
                } else {
                    purge_record(&mut *transaction, window, candidate, &request_id, now)?
                };
                match outcome {
                    Purge::Done => bump(&mut result.purged, candidate.kind),
                    Purge::Skipped(reason) => bump(&mut result.skipped, reason),
                    Purge::Media(record) => result.pending.push(*record),
                }
            }
            Ok(result)
        })();
        match result {
            Ok(result) => {
                transaction.commit()?;
                Ok(result)
            }
            Err(primary) => Err(rollback_with_primary(transaction, primary)),
        }
    }
}

enum Purge {
    Done,
    Skipped(&'static str),
    Media(Box<MediaFileRecord>),
}

fn purge_record(
    transaction: &mut dyn HealthTransaction,
    window: &RetentionWindow,
    candidate: &RetentionCandidate,
    request_id: &str,
    now: OffsetDateTime,
) -> HealthResult<Purge> {
    let still_due = |deleted_at: Option<OffsetDateTime>| {
        deleted_at == Some(candidate.archived_at) && candidate.archived_at <= window.cutoff
    };
    let record_type = match candidate.kind {
        KIND_DIET => {
            let current = transaction.get_diet(&candidate.id, true)?;
            if !current.is_some_and(|diet| still_due(diet.deleted_at())) {
                return Ok(Purge::Skipped(SKIP_CHANGED_SINCE_PLAN));
            }
            transaction.purge_diet(&candidate.id)?;
            "diet_entry"
        }
        KIND_BOWEL | KIND_MEDICATION | KIND_METRIC => {
            let current = transaction.get_event(&candidate.id, true)?;
            if !current.is_some_and(|event| {
                still_due(event.deleted_at())
                    && event_kind(category_name(event.category())) == candidate.kind
            }) {
                return Ok(Purge::Skipped(SKIP_CHANGED_SINCE_PLAN));
            }
            transaction.purge_event(&candidate.id)?;
            "health_event"
        }
        other => {
            return Err(HealthError::Validation {
                field: "retention.kind",
                message: format!("unsupported retention kind {other}"),
            });
        }
    };
    transaction.insert_audit_event(&audit_event(AuditMutation {
        request_id,
        occurred_at: now,
        actor: RETENTION_ACTOR,
        action: PURGE_ACTION,
        record_type,
        record_id: &candidate.id,
        before: None::<&serde_json::Value>,
        after: None::<&serde_json::Value>,
        reason: Some(RETENTION_REASON),
    })?)?;
    Ok(Purge::Done)
}

fn purge_media(
    transaction: &mut dyn HealthTransaction,
    candidate: &RetentionCandidate,
    request_id: &str,
    now: OffsetDateTime,
) -> HealthResult<Purge> {
    let Some(current) = transaction.get_media(&candidate.id, true)? else {
        return Ok(Purge::Skipped(SKIP_CHANGED_SINCE_PLAN));
    };
    if transaction.count_diet_media_references(&candidate.id)? > 0 {
        return Ok(Purge::Skipped(SKIP_MEDIA_SHARED));
    }
    if current.cleanup_pending {
        return Ok(Purge::Media(Box::new(current)));
    }
    let mut pending = current.clone();
    pending.updated_at = next_update_time(current.updated_at, "media")?.max(now);
    pending.deleted_at = Some(current.deleted_at.unwrap_or(pending.updated_at));
    pending.cleanup_pending = true;
    transaction.update_media(&pending)?;
    transaction.insert_audit_event(&audit_event(AuditMutation {
        request_id,
        occurred_at: pending.updated_at,
        actor: RETENTION_ACTOR,
        action: "detach",
        record_type: "media_file",
        record_id: &candidate.id,
        before: Some(&MediaSnapshot::from(&current)),
        after: Some(&MediaSnapshot::from(&pending)),
        reason: Some(RETENTION_REASON),
    })?)?;
    Ok(Purge::Media(Box::new(pending)))
}

fn category_name(category: crate::domain::HealthCategory) -> &'static str {
    use crate::domain::HealthCategory;
    match category {
        HealthCategory::Weight => "weight",
        HealthCategory::Bowel => "bowel",
        HealthCategory::Sleep => "sleep",
        HealthCategory::Lab => "lab",
        HealthCategory::Symptom => "symptom",
        HealthCategory::Medication => "medication",
    }
}

fn merge(into: &mut BTreeMap<&'static str, u64>, from: BTreeMap<&'static str, u64>) {
    for (key, count) in from {
        *into.entry(key).or_insert(0) += count;
    }
}

/// Same shape as the media snapshots written by diet updates and cleanup.
#[derive(serde::Serialize)]
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
