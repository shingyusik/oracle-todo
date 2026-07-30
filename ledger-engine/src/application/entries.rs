use serde::Serialize;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::application::commands::{CreateEntry, UpdateEntry};
use crate::application::error::{LedgerError, LedgerResult};
use crate::application::ports::{AuditEvent, LedgerRepository};
use crate::application::references::{
    resolve_account, resolve_currency, resolve_transaction_category,
};
use crate::application::service::LedgerService;
use crate::domain::{
    EntryType, LedgerEntry, LedgerEntryRehydration, TransactionCategory, TransactionCategoryKind,
    ValidationError,
};

impl<R: LedgerRepository> LedgerService<R> {
    pub fn create_entry(&mut self, command: CreateEntry) -> LedgerResult<LedgerEntry> {
        validate_actor(&command.actor)?;
        validate_manual_fields(command.entry_type, command.transfer_group.as_deref())?;
        let now = OffsetDateTime::now_utc();
        let mut transaction = self.repository.begin_transaction()?;
        let account = resolve_account(&*transaction, &command.account)?;
        let currency = resolve_currency(&*transaction, &command.currency)?;
        validate_account_currency(&account, &currency)?;
        let category = resolve_entry_category(
            &*transaction,
            command.entry_type,
            command.category.as_deref(),
        )?;
        let entry = LedgerEntry::rehydrate(LedgerEntryRehydration {
            id: Uuid::new_v4().to_string(),
            date: command.date,
            written_at: command.written_at,
            content: command.content,
            transaction_category_id: category.map(|value| value.id().to_string()),
            account_id: account.id().to_string(),
            entry_type: command.entry_type,
            amount: command.amount,
            currency_id: currency.id().to_string(),
            transfer_group_id: None,
            source: command.source,
            notes: command.notes,
            created_at: now,
            updated_at: now,
            deleted_at: None,
        })
        .map_err(entry_validation)?;
        transaction.insert_entry(&entry)?;
        transaction.insert_audit_event(&audit_event(AuditMutation {
            occurred_at: now,
            actor: command.actor,
            action: "create",
            record_type: "ledger_entry",
            record_id: entry.id(),
            before: None::<&LedgerEntry>,
            after: Some(&entry),
            reason: None,
        })?)?;
        transaction.commit()?;
        Ok(entry)
    }

    pub fn update_entry(&mut self, id: &str, command: UpdateEntry) -> LedgerResult<LedgerEntry> {
        validate_actor(&command.actor)?;
        if matches!(
            command.entry_type,
            Some(EntryType::TransferOut | EntryType::TransferIn)
        ) {
            return Err(validation(
                "entry_type",
                "transfer entries must be changed through the transfer service",
            ));
        }
        if command.transfer_group.is_some() {
            return Err(validation(
                "transfer_group",
                "transfer groups are controlled by the transfer service",
            ));
        }

        let now = OffsetDateTime::now_utc();
        let mut transaction = self.repository.begin_transaction()?;
        let before = transaction
            .get_entry(id, false)?
            .ok_or_else(|| LedgerError::NotFound(format!("ledger entry {id}")))?;
        if matches!(
            before.entry_type(),
            EntryType::TransferOut | EntryType::TransferIn
        ) {
            return Err(validation(
                "entry_type",
                "transfer entries must be changed through the transfer service",
            ));
        }
        if before.transfer_group_id().is_some() {
            return Err(validation(
                "transfer_group",
                "grouped entries must be changed through the transfer service",
            ));
        }
        let entry_type_was_supplied = command.entry_type.is_some();
        let category_was_supplied = command.category.is_some();
        let account_was_supplied = command.account.is_some();
        let currency_was_supplied = command.currency.is_some();
        let entry_type = command.entry_type.unwrap_or(before.entry_type());
        let (account_id, currency_id) = if account_was_supplied || currency_was_supplied {
            let account = match command.account {
                Some(reference) => resolve_account(&*transaction, &reference)?,
                None => resolve_account(&*transaction, before.account_id())?,
            };
            let currency = match command.currency {
                Some(reference) => resolve_currency(&*transaction, &reference)?,
                None => resolve_currency(&*transaction, before.currency_id())?,
            };
            validate_account_currency(&account, &currency)?;
            (account.id().to_string(), currency.id().to_string())
        } else {
            (
                before.account_id().to_string(),
                before.currency_id().to_string(),
            )
        };
        let category_id = match command.category {
            Some(reference) => {
                resolve_entry_category(&*transaction, entry_type, reference.as_deref())?
                    .map(|category| category.id().to_string())
            }
            None => before.transaction_category_id().map(str::to_string),
        };
        validate_final_entry_shape(
            entry_type,
            category_id.as_deref(),
            before.transfer_group_id(),
        )?;
        if entry_type_was_supplied && !category_was_supplied {
            if let Some(category_id) = category_id.as_deref() {
                let category = transaction
                    .get_transaction_category(category_id, true)?
                    .ok_or_else(|| {
                        LedgerError::NotFound(format!(
                            "historical transaction category {category_id}"
                        ))
                    })?;
                validate_category(entry_type, Some(&category))?;
            }
        }

        let after = LedgerEntry::rehydrate(LedgerEntryRehydration {
            id: before.id().to_string(),
            date: command.date.unwrap_or_else(|| before.date().to_string()),
            written_at: command.written_at.unwrap_or_else(|| before.written_at()),
            content: command
                .content
                .unwrap_or_else(|| before.content().to_string()),
            transaction_category_id: category_id,
            account_id,
            entry_type,
            amount: command.amount.unwrap_or_else(|| before.amount()),
            currency_id,
            transfer_group_id: before.transfer_group_id().map(str::to_string),
            source: command
                .source
                .unwrap_or_else(|| before.source().to_string()),
            notes: command
                .notes
                .unwrap_or_else(|| before.notes().map(str::to_string)),
            created_at: before.created_at(),
            updated_at: now,
            deleted_at: before.deleted_at(),
        })
        .map_err(entry_validation)?;
        transaction.update_entry(&after)?;
        transaction.insert_audit_event(&audit_event(AuditMutation {
            occurred_at: now,
            actor: command.actor,
            action: "update",
            record_type: "ledger_entry",
            record_id: after.id(),
            before: Some(&before),
            after: Some(&after),
            reason: command.reason,
        })?)?;
        transaction.commit()?;
        Ok(after)
    }
}

pub(super) struct AuditMutation<'a, T> {
    pub occurred_at: OffsetDateTime,
    pub actor: String,
    pub action: &'static str,
    pub record_type: &'static str,
    pub record_id: &'a str,
    pub before: Option<&'a T>,
    pub after: Option<&'a T>,
    pub reason: Option<String>,
}

pub(super) fn audit_event<T: Serialize>(
    mutation: AuditMutation<'_, T>,
) -> LedgerResult<AuditEvent> {
    Ok(AuditEvent {
        id: Uuid::new_v4().to_string(),
        occurred_at: mutation.occurred_at,
        actor: mutation.actor.trim().to_string(),
        action: mutation.action.to_string(),
        record_type: mutation.record_type.to_string(),
        record_id: mutation.record_id.to_string(),
        before: mutation
            .before
            .map(serde_json::to_value)
            .transpose()
            .map_err(|error| {
                LedgerError::Storage(format!(
                    "could not serialize audit before snapshot: {error}"
                ))
            })?,
        after: mutation
            .after
            .map(serde_json::to_value)
            .transpose()
            .map_err(|error| {
                LedgerError::Storage(format!("could not serialize audit after snapshot: {error}"))
            })?,
        reason: mutation
            .reason
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    })
}

pub(super) fn validate_actor(actor: &str) -> LedgerResult<()> {
    if actor.trim().is_empty() {
        return Err(validation("actor", "actor must not be blank"));
    }
    Ok(())
}

pub(super) fn domain_validation(field: &'static str, error: ValidationError) -> LedgerError {
    LedgerError::Validation {
        field,
        message: error.to_string(),
    }
}

fn entry_validation(error: ValidationError) -> LedgerError {
    let field = match error {
        ValidationError::NonPositiveEntryAmount => "amount",
        ValidationError::MalformedDate => "date",
        ValidationError::BlankField("ledger_entry.content") => "content",
        ValidationError::BlankField("ledger_entry.source") => "source",
        ValidationError::BlankField("ledger_entry.notes") => "notes",
        ValidationError::BlankField(_) => "entry",
        ValidationError::UnsupportedCurrencyPrecision(_) => "currency",
    };
    domain_validation(field, error)
}

fn resolve_entry_category(
    transaction: &dyn crate::application::ports::LedgerTransaction,
    entry_type: EntryType,
    reference: Option<&str>,
) -> LedgerResult<Option<TransactionCategory>> {
    let category = reference
        .map(|reference| resolve_transaction_category(transaction, reference))
        .transpose()?;
    validate_category(entry_type, category.as_ref())?;
    Ok(category)
}

fn validate_category(
    entry_type: EntryType,
    category: Option<&TransactionCategory>,
) -> LedgerResult<()> {
    validate_category_presence(entry_type, category.map(TransactionCategory::id))?;
    let expected = match entry_type {
        EntryType::Expense | EntryType::AdjustmentOut => TransactionCategoryKind::Expense,
        EntryType::Income | EntryType::AdjustmentIn => TransactionCategoryKind::Income,
        EntryType::TransferOut | EntryType::TransferIn => return Ok(()),
    };
    if category.is_some_and(|category| category.kind() != expected) {
        return Err(validation(
            "category",
            "category kind is incompatible with the entry type",
        ));
    }
    Ok(())
}

fn validate_category_presence(
    entry_type: EntryType,
    category_id: Option<&str>,
) -> LedgerResult<()> {
    if matches!(entry_type, EntryType::Expense | EntryType::Income) && category_id.is_none() {
        return Err(validation(
            "category",
            "expense and income entries require a category",
        ));
    }
    if matches!(entry_type, EntryType::TransferOut | EntryType::TransferIn) && category_id.is_some()
    {
        return Err(validation(
            "category",
            "transfer entries cannot carry a category",
        ));
    }
    Ok(())
}

fn validate_final_entry_shape(
    entry_type: EntryType,
    category_id: Option<&str>,
    transfer_group_id: Option<&str>,
) -> LedgerResult<()> {
    validate_category_presence(entry_type, category_id)?;
    match entry_type {
        EntryType::TransferOut | EntryType::TransferIn if transfer_group_id.is_none() => {
            Err(validation(
                "transfer_group",
                "transfer entries require a transfer group",
            ))
        }
        EntryType::Expense
        | EntryType::Income
        | EntryType::AdjustmentOut
        | EntryType::AdjustmentIn
            if transfer_group_id.is_some() =>
        {
            Err(validation(
                "transfer_group",
                "non-transfer entries cannot carry a transfer group",
            ))
        }
        _ => Ok(()),
    }
}

fn validate_account_currency(
    account: &crate::domain::Account,
    currency: &crate::domain::Currency,
) -> LedgerResult<()> {
    if account.currency_id() != currency.id() {
        return Err(validation(
            "currency",
            "entry currency must match the account currency",
        ));
    }
    Ok(())
}

fn validate_manual_fields(entry_type: EntryType, transfer_group: Option<&str>) -> LedgerResult<()> {
    if matches!(entry_type, EntryType::TransferOut | EntryType::TransferIn) {
        return Err(validation(
            "entry_type",
            "transfer entries must be created through the transfer service",
        ));
    }
    if transfer_group.is_some() {
        return Err(validation(
            "transfer_group",
            "transfer groups are controlled by the transfer service",
        ));
    }
    Ok(())
}

fn validation(field: &'static str, message: &str) -> LedgerError {
    LedgerError::Validation {
        field,
        message: message.to_string(),
    }
}
