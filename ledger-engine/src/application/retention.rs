//! Retention purge of archived Ledger entries and transfers.
//!
//! Planning is a read path. Applying re-checks every planned root inside a
//! `BEGIN IMMEDIATE` transaction, erases its audit history and leaves exactly
//! one payload-free tombstone per purged record.

use std::collections::{BTreeMap, BTreeSet};

use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::application::error::LedgerResult;
use crate::application::lifecycle::validate_transfer_pair;
use crate::application::ports::{
    AuditEvent, LedgerMutationRepository, LedgerReadRepository, LedgerTransaction,
};
use crate::application::service::LedgerService;
use crate::domain::{EntryType, LedgerEntry};

pub const RETENTION_ACTOR: &str = "ledger-retention";
pub const RETENTION_REASON: &str = "retention";
pub const KIND_LEDGER_ENTRY: &str = "ledger_entry";
pub const KIND_LEDGER_TRANSFER: &str = "ledger_transfer";
pub const SKIP_INVALID_TRANSFER_PAIR: &str = "invalid_transfer_pair";
pub const SKIP_CHANGED_SINCE_PLAN: &str = "changed_since_plan";
/// Upper bound of purge roots (entries or transfer pairs) per write transaction.
pub const MAX_ROOTS_PER_TRANSACTION: usize = 200;

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
    /// The plan for a store that does not exist or is not initialized.
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
    /// Ledger has no media; always zero.
    pub media_cleanup_pending: u64,
}

#[allow(private_bounds)]
impl<R: LedgerReadRepository> LedgerService<R> {
    /// Lists archived entries and transfer pairs whose `deleted_at` is at or before
    /// `window.cutoff`. Reads only; never writes the store.
    pub fn retention_plan(&mut self, window: &RetentionWindow) -> LedgerResult<RetentionPlan> {
        let mut plan = RetentionPlan::empty(*window);
        let mut groups = BTreeSet::new();
        for entry in self.repository.list_archived_entries()? {
            let Some(archived_at) = entry.deleted_at() else {
                continue;
            };
            if archived_at > window.cutoff {
                continue;
            }
            match entry.transfer_group_id() {
                Some(group_id) => {
                    groups.insert(group_id.to_string());
                }
                None if is_transfer(&entry) => {
                    count(&mut plan.skipped, SKIP_INVALID_TRANSFER_PAIR);
                }
                None => plan.candidates.push(RetentionCandidate {
                    kind: KIND_LEDGER_ENTRY,
                    id: entry.id().to_string(),
                    label: entry.content().to_string(),
                    archived_at,
                }),
            }
        }
        for group_id in groups {
            let pair = self
                .repository
                .list_entries_by_transfer_group(&group_id, true)?;
            match due_pair_archived_at(&group_id, &pair, window) {
                Some(archived_at) => plan.candidates.push(RetentionCandidate {
                    kind: KIND_LEDGER_TRANSFER,
                    label: pair[0].content().to_string(),
                    id: group_id,
                    archived_at,
                }),
                None => count(&mut plan.skipped, SKIP_INVALID_TRANSFER_PAIR),
            }
        }
        plan.candidates.sort_by(|left, right| {
            left.archived_at
                .cmp(&right.archived_at)
                .then_with(|| left.kind.cmp(right.kind))
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(plan)
    }
}

#[allow(private_bounds)]
impl<R: LedgerMutationRepository> LedgerService<R> {
    /// Purges only the planned roots that are still archived, unchanged and due.
    pub fn retention_apply(&mut self, plan: &RetentionPlan) -> LedgerResult<RetentionOutcome> {
        let mut outcome = RetentionOutcome {
            skipped: plan.skipped.clone(),
            ..RetentionOutcome::default()
        };
        let applied = self.retention_apply_batches(plan, &mut outcome);
        let restored = self.repository.end_retention_session();
        applied?;
        restored?;
        Ok(outcome)
    }

    fn retention_apply_batches(
        &mut self,
        plan: &RetentionPlan,
        outcome: &mut RetentionOutcome,
    ) -> LedgerResult<()> {
        for batch in plan.candidates.chunks(MAX_ROOTS_PER_TRANSACTION) {
            let (purged, skipped) = self.retry_busy("retention_apply", |service| {
                service.retention_apply_batch(batch, &plan.window)
            })?;
            merge(&mut outcome.purged, purged);
            merge(&mut outcome.skipped, skipped);
        }
        Ok(())
    }

    fn retention_apply_batch(
        &mut self,
        batch: &[RetentionCandidate],
        window: &RetentionWindow,
    ) -> LedgerResult<(Counts, Counts)> {
        let now = OffsetDateTime::now_utc();
        let mut transaction = self.repository.begin_retention_transaction()?;
        let mut purged = BTreeMap::new();
        let mut skipped = BTreeMap::new();
        for candidate in batch {
            let result = match candidate.kind {
                KIND_LEDGER_ENTRY => purge_entry(&mut *transaction, candidate, window, now)?,
                KIND_LEDGER_TRANSFER => purge_transfer(&mut *transaction, candidate, window, now)?,
                _ => Err(SKIP_CHANGED_SINCE_PLAN),
            };
            match result {
                Ok(()) => count(&mut purged, candidate.kind),
                Err(reason) => count(&mut skipped, reason),
            }
        }
        transaction.commit()?;
        Ok((purged, skipped))
    }
}

type PurgeResult = LedgerResult<Result<(), &'static str>>;
type Counts = BTreeMap<&'static str, u64>;

fn purge_entry(
    transaction: &mut dyn LedgerTransaction,
    candidate: &RetentionCandidate,
    window: &RetentionWindow,
    now: OffsetDateTime,
) -> PurgeResult {
    let Some(entry) = transaction.get_entry(&candidate.id, true)? else {
        return Ok(Err(SKIP_CHANGED_SINCE_PLAN));
    };
    if entry.transfer_group_id().is_some()
        || is_transfer(&entry)
        || !still_due(entry.deleted_at(), candidate, window)
    {
        return Ok(Err(SKIP_CHANGED_SINCE_PLAN));
    }
    transaction.delete_audit_history(KIND_LEDGER_ENTRY, entry.id())?;
    transaction.delete_entries(&[entry.id()])?;
    transaction.insert_audit_event(&tombstone(now, "ledger_entry", entry.id()))?;
    Ok(Ok(()))
}

fn purge_transfer(
    transaction: &mut dyn LedgerTransaction,
    candidate: &RetentionCandidate,
    window: &RetentionWindow,
    now: OffsetDateTime,
) -> PurgeResult {
    let group_id = candidate.id.as_str();
    let pair = transaction.list_entries_by_transfer_group(group_id, true)?;
    if pair.is_empty() {
        return Ok(Err(SKIP_CHANGED_SINCE_PLAN));
    }
    if validate_transfer_pair(group_id, &pair).is_err() {
        return Ok(Err(SKIP_INVALID_TRANSFER_PAIR));
    }
    if !still_due(pair[0].deleted_at(), candidate, window) {
        return Ok(Err(SKIP_CHANGED_SINCE_PLAN));
    }
    let ids: Vec<&str> = pair.iter().map(LedgerEntry::id).collect();
    transaction.delete_audit_history("transfer", group_id)?;
    for id in &ids {
        transaction.delete_audit_history(KIND_LEDGER_ENTRY, id)?;
    }
    transaction.delete_entries(&ids)?;
    transaction.delete_transfer_operation_for_group(group_id)?;
    transaction.insert_audit_event(&tombstone(now, "transfer", group_id))?;
    Ok(Ok(()))
}

fn still_due(
    deleted_at: Option<OffsetDateTime>,
    candidate: &RetentionCandidate,
    window: &RetentionWindow,
) -> bool {
    deleted_at == Some(candidate.archived_at) && candidate.archived_at <= window.cutoff
}

/// Returns the shared archive instant of a valid, archived and due transfer pair.
fn due_pair_archived_at(
    group_id: &str,
    pair: &[LedgerEntry],
    window: &RetentionWindow,
) -> Option<OffsetDateTime> {
    validate_transfer_pair(group_id, pair).ok()?;
    pair[0]
        .deleted_at()
        .filter(|archived_at| *archived_at <= window.cutoff)
}

fn is_transfer(entry: &LedgerEntry) -> bool {
    matches!(
        entry.entry_type(),
        EntryType::TransferOut | EntryType::TransferIn
    )
}

fn tombstone(occurred_at: OffsetDateTime, record_type: &str, record_id: &str) -> AuditEvent {
    AuditEvent {
        id: Uuid::new_v4().to_string(),
        occurred_at,
        actor: RETENTION_ACTOR.to_string(),
        action: "purge".to_string(),
        record_type: record_type.to_string(),
        record_id: record_id.to_string(),
        before: None,
        after: None,
        reason: Some(RETENTION_REASON.to_string()),
    }
}

fn count(counts: &mut BTreeMap<&'static str, u64>, key: &'static str) {
    *counts.entry(key).or_default() += 1;
}

fn merge(into: &mut BTreeMap<&'static str, u64>, from: BTreeMap<&'static str, u64>) {
    for (key, value) in from {
        *into.entry(key).or_default() += value;
    }
}
