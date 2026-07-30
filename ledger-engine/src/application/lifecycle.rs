use serde::Serialize;
use time::OffsetDateTime;

use crate::application::entries::{AuditMutation, audit_event};
use crate::application::error::{LedgerError, LedgerResult};
use crate::application::ports::{LedgerRepository, LedgerTransaction};
use crate::application::service::LedgerService;
use crate::domain::{
    Account, AccountCategory, Currency, EntryType, LedgerEntry, LedgerEntryRehydration,
    TransactionCategory,
};

const LIFECYCLE_ACTOR: &str = "ledger-service";

impl<R: LedgerRepository> LedgerService<R> {
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
        validate_confirmation(id, confirmation)?;

        let now = OffsetDateTime::now_utc();
        let mut transaction = self.repository.begin_transaction()?;
        let entries = lifecycle_entries(&*transaction, id)?;
        for entry in &entries {
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
            transaction.delete_entry(entry.id())?;
        }
        transaction.commit()
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
        let mut target_after = None;
        for before in before_entries {
            let after = with_archive_state(&before, should_be_archived.then_some(now), now)?;
            transaction.update_entry(&after)?;
            transaction.insert_audit_event(&audit_event(AuditMutation {
                occurred_at: now,
                actor: LIFECYCLE_ACTOR.to_string(),
                action,
                record_type: "ledger_entry",
                record_id: after.id(),
                before: Some(&before),
                after: Some(&after),
                reason: None,
            })?)?;
            if after.id() == id {
                target_after = Some(after);
            }
        }
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

fn validate_transfer_pair(group_id: &str, entries: &[LedgerEntry]) -> LedgerResult<()> {
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
