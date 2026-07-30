use serde::Serialize;
use time::OffsetDateTime;
use uuid::{Uuid, Version};

use crate::application::entries::{AuditMutation, audit_event};
use crate::application::error::{LedgerError, LedgerResult};
use crate::application::ports::{LedgerMutationRepository, LedgerTransaction};
use crate::application::service::LedgerService;
use crate::domain::{
    Account, AccountCategory, Currency, EntryType, LedgerEntry, LedgerEntryRehydration,
    TransactionCategory,
};

const LIFECYCLE_ACTOR: &str = "ledger-service";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PurgePreview {
    pub confirmation_id: String,
    pub transfer_group_id: Option<String>,
    pub entry_ids: Vec<String>,
}

#[derive(Serialize)]
struct TransferLifecycleAudit<'entry> {
    operation_id: &'entry str,
    transfer_group_id: &'entry str,
    out_entry: &'entry LedgerEntry,
    in_entry: &'entry LedgerEntry,
}

#[allow(private_bounds)]
impl<R: LedgerMutationRepository> LedgerService<R> {
    /// Archives an entry. Repeating the request is a no-op without a duplicate audit.
    ///
    /// A transfer entry always archives together with its validated counterpart.
    pub fn archive_entry(&mut self, id: &str) -> LedgerResult<LedgerEntry> {
        self.set_entry_archived(id, true)
    }

    /// Restores an entry. Repeating the request is a no-op without a duplicate audit.
    ///
    /// A transfer entry always restores together with its validated counterpart.
    pub fn restore_entry(&mut self, id: &str) -> LedgerResult<LedgerEntry> {
        self.set_entry_archived(id, false)
    }

    /// Permanently removes an active or archived entry after exact ID confirmation.
    ///
    /// A transfer entry always purges together with its validated counterpart. Audit
    /// snapshots are inserted before deletion and survive the committed purge.
    pub fn purge_entry(&mut self, id: &str, confirmation: &str) -> LedgerResult<()> {
        let now = OffsetDateTime::now_utc();
        let mut transaction = self.repository.begin_transaction()?;
        let entries = lifecycle_entries(&*transaction, id)?;
        let transfer_group_id = entries
            .first()
            .and_then(|entry| entry.transfer_group_id())
            .map(str::to_string);
        validate_confirmation(transfer_group_id.as_deref().unwrap_or(id), confirmation)?;
        if let Some(group_id) = transfer_group_id.as_deref() {
            let operation_id = Uuid::new_v4().to_string();
            let before = transfer_lifecycle_audit(&operation_id, group_id, &entries)?;
            transaction.insert_audit_event(&audit_event(AuditMutation {
                occurred_at: now,
                actor: LIFECYCLE_ACTOR.to_string(),
                action: "purge",
                record_type: "transfer",
                record_id: group_id,
                before: Some(&before),
                after: None::<&TransferLifecycleAudit<'_>>,
                reason: None,
            })?)?;
        } else {
            let entry = &entries[0];
            transaction.insert_audit_event(&audit_event(AuditMutation {
                occurred_at: now,
                actor: LIFECYCLE_ACTOR.to_string(),
                action: "purge",
                record_type: "ledger_entry",
                record_id: entry.id(),
                before: Some(entry),
                after: None::<&LedgerEntry>,
                reason: None,
            })?)?;
        }
        for entry in &entries {
            transaction.delete_entry(entry.id())?;
        }
        transaction.commit()
    }

    /// Returns the exact identifier required to confirm a permanent purge.
    ///
    /// Transfers require their group identifier and expose both affected rows.
    pub fn purge_entry_preview(&mut self, id: &str) -> LedgerResult<PurgePreview> {
        let transaction = self.repository.begin_transaction()?;
        let entries = lifecycle_entries(&*transaction, id)?;
        let transfer_group_id = entries
            .first()
            .and_then(|entry| entry.transfer_group_id())
            .map(str::to_string);
        let confirmation_id = transfer_group_id.clone().unwrap_or_else(|| id.to_string());
        let entry_ids = ordered_entry_ids(&entries);
        transaction.rollback()?;
        Ok(PurgePreview {
            confirmation_id,
            transfer_group_id,
            entry_ids,
        })
    }

    pub fn purge_currency(&mut self, id: &str, confirmation: &str) -> LedgerResult<()> {
        validate_confirmation(id, confirmation)?;
        let now = OffsetDateTime::now_utc();
        let mut transaction = self.repository.begin_transaction()?;
        let before = transaction
            .get_currency(id, true)?
            .ok_or_else(|| LedgerError::NotFound(format!("currency {id}")))?;
        if transaction.currency_has_dependencies(id)? {
            return Err(referenced("currency", id));
        }
        transaction.insert_audit_event(&purge_audit(now, "currency", &before)?)?;
        transaction.delete_currency(id)?;
        transaction.commit()
    }

    pub fn purge_account_category(&mut self, id: &str, confirmation: &str) -> LedgerResult<()> {
        validate_confirmation(id, confirmation)?;
        let now = OffsetDateTime::now_utc();
        let mut transaction = self.repository.begin_transaction()?;
        let before = transaction
            .get_account_category(id, true)?
            .ok_or_else(|| LedgerError::NotFound(format!("account category {id}")))?;
        if transaction.account_category_has_dependencies(id)? {
            return Err(referenced("account category", id));
        }
        transaction.insert_audit_event(&purge_audit(now, "account_category", &before)?)?;
        transaction.delete_account_category(id)?;
        transaction.commit()
    }

    pub fn purge_account(&mut self, id: &str, confirmation: &str) -> LedgerResult<()> {
        validate_confirmation(id, confirmation)?;
        let now = OffsetDateTime::now_utc();
        let mut transaction = self.repository.begin_transaction()?;
        let before = transaction
            .get_account(id, true)?
            .ok_or_else(|| LedgerError::NotFound(format!("account {id}")))?;
        if transaction.account_has_entries(id)? {
            return Err(referenced("account", id));
        }
        transaction.insert_audit_event(&purge_audit(now, "account", &before)?)?;
        transaction.delete_account(id)?;
        transaction.commit()
    }

    pub fn purge_category(&mut self, id: &str, confirmation: &str) -> LedgerResult<()> {
        validate_confirmation(id, confirmation)?;
        let now = OffsetDateTime::now_utc();
        let mut transaction = self.repository.begin_transaction()?;
        let before = transaction
            .get_transaction_category(id, true)?
            .ok_or_else(|| LedgerError::NotFound(format!("transaction category {id}")))?;
        if transaction.transaction_category_has_entries(id)?
            || transaction.transaction_category_has_children(id)?
        {
            return Err(referenced("transaction category", id));
        }
        transaction.insert_audit_event(&purge_audit(now, "transaction_category", &before)?)?;
        transaction.delete_transaction_category(id)?;
        transaction.commit()
    }

    fn set_entry_archived(
        &mut self,
        id: &str,
        should_be_archived: bool,
    ) -> LedgerResult<LedgerEntry> {
        let now = OffsetDateTime::now_utc();
        let mut transaction = self.repository.begin_transaction()?;
        let before_entries = lifecycle_entries(&*transaction, id)?;
        let target = before_entries
            .iter()
            .find(|entry| entry.id() == id)
            .expect("lifecycle query must retain its target");
        if target.is_archived() == should_be_archived {
            return Ok(target.clone());
        }

        let action = if should_be_archived {
            "archive"
        } else {
            "restore"
        };
        let transfer_group_id = target.transfer_group_id().map(str::to_string);
        let operation_id = Uuid::new_v4().to_string();
        let mut after_entries = Vec::with_capacity(before_entries.len());
        for before in &before_entries {
            let after = with_archive_state(before, should_be_archived.then_some(now), now)?;
            transaction.update_entry(&after)?;
            after_entries.push(after);
        }
        if let Some(group_id) = transfer_group_id.as_deref() {
            let before = transfer_lifecycle_audit(&operation_id, group_id, &before_entries)?;
            let after = transfer_lifecycle_audit(&operation_id, group_id, &after_entries)?;
            transaction.insert_audit_event(&audit_event(AuditMutation {
                occurred_at: now,
                actor: LIFECYCLE_ACTOR.to_string(),
                action,
                record_type: "transfer",
                record_id: group_id,
                before: Some(&before),
                after: Some(&after),
                reason: None,
            })?)?;
        } else {
            transaction.insert_audit_event(&audit_event(AuditMutation {
                occurred_at: now,
                actor: LIFECYCLE_ACTOR.to_string(),
                action,
                record_type: "ledger_entry",
                record_id: after_entries[0].id(),
                before: Some(&before_entries[0]),
                after: Some(&after_entries[0]),
                reason: None,
            })?)?;
        }
        let target_after = after_entries.into_iter().find(|entry| entry.id() == id);
        transaction.commit()?;
        target_after.ok_or_else(|| {
            LedgerError::Storage("lifecycle transaction lost its target entry".to_string())
        })
    }
}

fn validate_confirmation(id: &str, confirmation: &str) -> LedgerResult<()> {
    if confirmation != id {
        return Err(LedgerError::ConfirmationMismatch);
    }
    Ok(())
}

fn purge_audit<T: Serialize + RecordIdentity>(
    occurred_at: OffsetDateTime,
    record_type: &'static str,
    before: &T,
) -> LedgerResult<crate::application::ports::AuditEvent> {
    audit_event(AuditMutation {
        occurred_at,
        actor: LIFECYCLE_ACTOR.to_string(),
        action: "purge",
        record_type,
        record_id: before.record_id(),
        before: Some(before),
        after: None::<&T>,
        reason: None,
    })
}

trait RecordIdentity {
    fn record_id(&self) -> &str;
}

impl RecordIdentity for Currency {
    fn record_id(&self) -> &str {
        self.id()
    }
}

impl RecordIdentity for AccountCategory {
    fn record_id(&self) -> &str {
        self.id()
    }
}

impl RecordIdentity for Account {
    fn record_id(&self) -> &str {
        self.id()
    }
}

impl RecordIdentity for TransactionCategory {
    fn record_id(&self) -> &str {
        self.id()
    }
}

fn lifecycle_entries(
    transaction: &dyn LedgerTransaction,
    id: &str,
) -> LedgerResult<Vec<LedgerEntry>> {
    let target = transaction
        .get_entry(id, true)?
        .ok_or_else(|| LedgerError::NotFound(format!("ledger entry {id}")))?;
    match target.transfer_group_id() {
        Some(group_id) => {
            let entries = transaction.list_entries_by_transfer_group(group_id, true)?;
            validate_transfer_pair(group_id, &entries)?;
            Ok(entries)
        }
        None if matches!(
            target.entry_type(),
            EntryType::TransferOut | EntryType::TransferIn
        ) =>
        {
            Err(invalid_transfer_pair("transfer row has no group"))
        }
        None => Ok(vec![target]),
    }
}

pub(crate) fn validate_transfer_pair(group_id: &str, entries: &[LedgerEntry]) -> LedgerResult<()> {
    validate_engine_uuid(group_id, "group identity is not an engine UUID")?;
    if entries.len() != 2 {
        return Err(invalid_transfer_pair(
            "group must contain exactly two entries",
        ));
    }
    if entries
        .iter()
        .any(|entry| entry.transfer_group_id() != Some(group_id))
    {
        return Err(invalid_transfer_pair("group identity does not match"));
    }
    let out_count = entries
        .iter()
        .filter(|entry| entry.entry_type() == EntryType::TransferOut)
        .count();
    let in_count = entries
        .iter()
        .filter(|entry| entry.entry_type() == EntryType::TransferIn)
        .count();
    if out_count != 1 || in_count != 1 {
        return Err(invalid_transfer_pair(
            "group must contain one transfer-out and one transfer-in",
        ));
    }
    let first = &entries[0];
    let second = &entries[1];
    validate_engine_uuid(first.id(), "entry identity is not an engine UUID")?;
    validate_engine_uuid(second.id(), "entry identity is not an engine UUID")?;
    if first.id() == second.id() || first.account_id() == second.account_id() {
        return Err(invalid_transfer_pair(
            "paired entries must have distinct identities and accounts",
        ));
    }
    if first.amount() != second.amount()
        || first.currency_id() != second.currency_id()
        || first.date() != second.date()
        || first.written_at() != second.written_at()
        || first.content() != second.content()
        || first.source() != second.source()
        || first.notes() != second.notes()
        || first.transaction_category_id().is_some()
        || second.transaction_category_id().is_some()
        || first.created_at() != second.created_at()
        || first.updated_at() != second.updated_at()
        || first.deleted_at() != second.deleted_at()
    {
        return Err(invalid_transfer_pair(
            "paired entries have incompatible transfer fields",
        ));
    }
    if first.is_archived() != second.is_archived() {
        return Err(invalid_transfer_pair(
            "paired entries have inconsistent lifecycle states",
        ));
    }
    Ok(())
}

fn validate_engine_uuid(value: &str, message: &str) -> LedgerResult<()> {
    let parsed = Uuid::parse_str(value).map_err(|_| invalid_transfer_pair(message))?;
    if parsed.get_version() != Some(Version::Random) || parsed.to_string() != value {
        return Err(invalid_transfer_pair(message));
    }
    Ok(())
}

fn transfer_lifecycle_audit<'entry>(
    operation_id: &'entry str,
    group_id: &'entry str,
    entries: &'entry [LedgerEntry],
) -> LedgerResult<TransferLifecycleAudit<'entry>> {
    let out_entry = entries
        .iter()
        .find(|entry| entry.entry_type() == EntryType::TransferOut)
        .ok_or_else(|| invalid_transfer_pair("group has no transfer-out entry"))?;
    let in_entry = entries
        .iter()
        .find(|entry| entry.entry_type() == EntryType::TransferIn)
        .ok_or_else(|| invalid_transfer_pair("group has no transfer-in entry"))?;
    Ok(TransferLifecycleAudit {
        operation_id,
        transfer_group_id: group_id,
        out_entry,
        in_entry,
    })
}

fn ordered_entry_ids(entries: &[LedgerEntry]) -> Vec<String> {
    [EntryType::TransferOut, EntryType::TransferIn]
        .into_iter()
        .filter_map(|entry_type| {
            entries
                .iter()
                .find(|entry| entry.entry_type() == entry_type)
                .map(|entry| entry.id().to_string())
        })
        .chain(
            entries
                .iter()
                .filter(|entry| {
                    !matches!(
                        entry.entry_type(),
                        EntryType::TransferOut | EntryType::TransferIn
                    )
                })
                .map(|entry| entry.id().to_string()),
        )
        .collect()
}

fn with_archive_state(
    entry: &LedgerEntry,
    deleted_at: Option<OffsetDateTime>,
    updated_at: OffsetDateTime,
) -> LedgerResult<LedgerEntry> {
    LedgerEntry::rehydrate(LedgerEntryRehydration {
        id: entry.id().to_string(),
        date: entry.date().to_string(),
        written_at: entry.written_at(),
        content: entry.content().to_string(),
        transaction_category_id: entry.transaction_category_id().map(str::to_string),
        account_id: entry.account_id().to_string(),
        entry_type: entry.entry_type(),
        amount: entry.amount(),
        currency_id: entry.currency_id().to_string(),
        transfer_group_id: entry.transfer_group_id().map(str::to_string),
        source: entry.source().to_string(),
        notes: entry.notes().map(str::to_string),
        created_at: entry.created_at(),
        updated_at,
        deleted_at,
    })
    .map_err(|error| {
        LedgerError::Storage(format!(
            "persisted ledger entry failed lifecycle revalidation: {error}"
        ))
    })
}

fn invalid_transfer_pair(message: &str) -> LedgerError {
    LedgerError::Conflict(format!("invalid transfer pair: {message}"))
}

fn referenced(kind: &str, id: &str) -> LedgerError {
    LedgerError::Conflict(format!("{kind} {id} cannot be purged while referenced"))
}
