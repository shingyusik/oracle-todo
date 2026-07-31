use serde::{Deserialize, Serialize};
use time::{OffsetDateTime, UtcOffset};
use uuid::{Uuid, Version};

use crate::application::entries::{AuditMutation, audit_event, entry_validation, validate_actor};
use crate::application::error::{LedgerError, LedgerResult};
use crate::application::ports::LedgerMutationRepository;
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
    pub operation_key: TransferOperationKey,
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
#[serde(transparent)]
pub struct TransferOperationKey(String);

impl TransferOperationKey {
    pub fn parse(value: &str) -> LedgerResult<Self> {
        let parsed = Uuid::parse_str(value).map_err(|_| invalid_operation_key())?;
        if parsed.get_version() != Some(Version::Random) || parsed.to_string() != value {
            return Err(invalid_operation_key());
        }
        Ok(Self(value.to_string()))
    }

    pub fn generate() -> Self {
        Self(Uuid::new_v4().to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransferResult {
    pub transfer_group_id: String,
    pub out_entry_id: String,
    pub in_entry_id: String,
}

#[derive(Serialize)]
struct TransferAudit<'entry> {
    operation_id: &'entry str,
    transfer_group_id: &'entry str,
    out_entry: &'entry LedgerEntry,
    in_entry: &'entry LedgerEntry,
}

#[derive(Serialize)]
struct CanonicalTransferPayload {
    date: String,
    #[serde(with = "time::serde::rfc3339")]
    written_at: OffsetDateTime,
    content: String,
    from_account: String,
    to_account: String,
    amount: Money,
    currency: String,
    source: String,
    notes: Option<String>,
    actor: String,
}

#[allow(private_bounds)]
impl<R: LedgerMutationRepository> LedgerService<R> {
    pub fn transfer(&mut self, command: TransferCommand) -> LedgerResult<TransferResult> {
        validate_actor(&command.actor)?;
        let payload_json = serde_json::to_string(&canonical_payload(&command))
            .map_err(|error| LedgerError::Storage(error.to_string()))?;
        let now = OffsetDateTime::now_utc();
        let mut transaction = self.repository.begin_transaction()?;
        if let Some(existing) =
            transaction.get_transfer_operation(command.operation_key.as_str())?
        {
            if existing.payload_json != payload_json {
                return Err(LedgerError::Conflict(format!(
                    "transfer operation key {} was already used with a different payload",
                    command.operation_key.as_str()
                )));
            }
            let result =
                serde_json::from_str::<TransferResult>(&existing.result_json).map_err(|error| {
                    LedgerError::Storage(format!(
                        "persisted transfer operation result is invalid: {error}"
                    ))
                })?;
            validate_result_ids(&result)?;
            transaction.rollback()?;
            return Ok(result);
        }
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
        let result = TransferResult {
            transfer_group_id,
            out_entry_id: out_entry.id().to_string(),
            in_entry_id: in_entry.id().to_string(),
        };
        let result_json = serde_json::to_string(&result)
            .map_err(|error| LedgerError::Storage(error.to_string()))?;

        transaction.insert_transfer_operation(
            command.operation_key.as_str(),
            &payload_json,
            &result_json,
            now,
        )?;
        transaction.insert_entry(&out_entry)?;
        transaction.insert_entry(&in_entry)?;
        let paired = TransferAudit {
            operation_id: command.operation_key.as_str(),
            transfer_group_id: &result.transfer_group_id,
            out_entry: &out_entry,
            in_entry: &in_entry,
        };
        transaction.insert_audit_event(&audit_event(AuditMutation {
            occurred_at: now,
            actor: command.actor,
            action: "create",
            record_type: "transfer",
            record_id: &result.transfer_group_id,
            before: None::<&TransferAudit<'_>>,
            after: Some(&paired),
            reason: None,
        })?)?;
        transaction.commit()?;

        Ok(result)
    }
}

fn canonical_payload(command: &TransferCommand) -> CanonicalTransferPayload {
    CanonicalTransferPayload {
        date: command.date.trim().to_string(),
        written_at: command.written_at.to_offset(UtcOffset::UTC),
        content: command.content.trim().to_string(),
        from_account: command.from_account.trim().to_string(),
        to_account: command.to_account.trim().to_string(),
        amount: command.amount,
        currency: command.currency.trim().to_string(),
        source: command.source.trim().to_string(),
        notes: command.notes.as_deref().map(str::trim).map(str::to_string),
        actor: command.actor.trim().to_string(),
    }
}

fn validate_result_ids(result: &TransferResult) -> LedgerResult<()> {
    for value in [
        result.transfer_group_id.as_str(),
        result.out_entry_id.as_str(),
        result.in_entry_id.as_str(),
    ] {
        let id = Uuid::parse_str(value).map_err(|_| {
            LedgerError::Storage(
                "persisted transfer operation result has an invalid ID".to_string(),
            )
        })?;
        if id.get_version() != Some(Version::Random) || id.to_string() != value {
            return Err(LedgerError::Storage(
                "persisted transfer operation result has an invalid ID".to_string(),
            ));
        }
    }
    Ok(())
}

fn invalid_operation_key() -> LedgerError {
    LedgerError::Validation {
        field: "operation_key",
        message: "operation key must be a canonical UUID v4".to_string(),
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
