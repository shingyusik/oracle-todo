use serde::Serialize;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::application::entries::{AuditMutation, audit_event, entry_validation, validate_actor};
use crate::application::error::{LedgerError, LedgerResult};
use crate::application::ports::LedgerRepository;
use crate::application::references::{resolve_account, resolve_currency};
use crate::application::service::LedgerService;
use crate::domain::{EntryType, LedgerEntry, LedgerEntryRehydration, Money};

/// Creates a same-currency transfer between two active, distinct accounts.
///
/// Raven does not infer foreign-exchange rates. The selected currency must be
/// the configured currency of both accounts, and one minor-unit amount is
/// persisted unchanged on both sides.
#[derive(Debug, Clone)]
pub struct TransferCommand {
    pub date: String,
    pub written_at: OffsetDateTime,
    pub content: String,
    pub from_account: String,
    pub to_account: String,
    pub amount: Money,
    pub currency: String,
    pub source: String,
    pub notes: Option<String>,
    pub actor: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TransferResult {
    pub transfer_group_id: String,
    pub out_entry_id: String,
    pub in_entry_id: String,
}

#[derive(Serialize)]
struct TransferAudit<'entry> {
    out_entry: &'entry LedgerEntry,
    in_entry: &'entry LedgerEntry,
}

impl<R: LedgerRepository> LedgerService<R> {
    pub fn transfer(&mut self, command: TransferCommand) -> LedgerResult<TransferResult> {
        validate_actor(&command.actor)?;
        let now = OffsetDateTime::now_utc();
        let mut transaction = self.repository.begin_transaction()?;
        let from_account = resolve_account(&*transaction, &command.from_account)?;
        let to_account = resolve_account(&*transaction, &command.to_account)?;
        if from_account.id() == to_account.id() {
            return Err(validation("accounts", "transfer accounts must be distinct"));
        }
        let currency = resolve_currency(&*transaction, &command.currency)?;
        if from_account.currency_id() != to_account.currency_id() {
            return Err(validation(
                "currency",
                "cross-currency transfers require explicit converted amounts and are unsupported",
            ));
        }
        if from_account.currency_id() != currency.id() {
            return Err(validation(
                "currency",
                "transfer currency must match both account currencies",
            ));
        }

        let transfer_group_id = Uuid::new_v4().to_string();
        let out_entry = transfer_entry(
            &command,
            now,
            Uuid::new_v4().to_string(),
            from_account.id(),
            currency.id(),
            &transfer_group_id,
            EntryType::TransferOut,
        )?;
        let in_entry = transfer_entry(
            &command,
            now,
            Uuid::new_v4().to_string(),
            to_account.id(),
            currency.id(),
            &transfer_group_id,
            EntryType::TransferIn,
        )?;

        transaction.insert_entry(&out_entry)?;
        transaction.insert_entry(&in_entry)?;
        let paired = TransferAudit {
            out_entry: &out_entry,
            in_entry: &in_entry,
        };
        transaction.insert_audit_event(&audit_event(AuditMutation {
            occurred_at: now,
            actor: command.actor,
            action: "create",
            record_type: "transfer",
            record_id: &transfer_group_id,
            before: None::<&TransferAudit<'_>>,
            after: Some(&paired),
            reason: None,
        })?)?;
        transaction.commit()?;

        Ok(TransferResult {
            transfer_group_id,
            out_entry_id: out_entry.id().to_string(),
            in_entry_id: in_entry.id().to_string(),
        })
    }
}

#[allow(clippy::too_many_arguments)]
fn transfer_entry(
    command: &TransferCommand,
    now: OffsetDateTime,
    id: String,
    account_id: &str,
    currency_id: &str,
    transfer_group_id: &str,
    entry_type: EntryType,
) -> LedgerResult<LedgerEntry> {
    LedgerEntry::rehydrate(LedgerEntryRehydration {
        id,
        date: command.date.clone(),
        written_at: command.written_at,
        content: command.content.clone(),
        transaction_category_id: None,
        account_id: account_id.to_string(),
        entry_type,
        amount: command.amount,
        currency_id: currency_id.to_string(),
        transfer_group_id: Some(transfer_group_id.to_string()),
        source: command.source.clone(),
        notes: command.notes.clone(),
        created_at: now,
        updated_at: now,
        deleted_at: None,
    })
    .map_err(entry_validation)
}

fn validation(field: &'static str, message: &str) -> LedgerError {
    LedgerError::Validation {
        field,
        message: message.to_string(),
    }
}
