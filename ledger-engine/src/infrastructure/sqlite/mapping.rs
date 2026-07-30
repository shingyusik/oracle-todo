use rusqlite::Row;
use time::format_description::well_known::Rfc3339;
use time::{OffsetDateTime, UtcOffset};

use crate::application::error::{LedgerError, LedgerResult};
use crate::application::ports::AuditEvent;
use crate::domain::{
    Account, AccountCategory, Currency, EntryType, LedgerEntry, LedgerEntryRehydration, Money,
    TransactionCategory, TransactionCategoryKind,
};

use super::storage_error;

pub(super) const ENTRY_COLUMNS: &str = "
    id, date, written_at, content, transaction_category_id, account_id,
    entry_type, amount_minor, currency_id, transfer_group_id, source, notes,
    created_at, updated_at, deleted_at
";

pub(super) const AUDIT_COLUMNS: &str = "
    id, occurred_at, actor, action, record_type, record_id,
    before_json, after_json, reason
";

pub(super) const CURRENCY_COLUMNS: &str = "
    id, code, name, symbol, decimal_places, active
";

pub(super) const ACCOUNT_CATEGORY_COLUMNS: &str = "
    id, name, parent_id, liability, active
";

pub(super) const ACCOUNT_COLUMNS: &str = "
    id, name, account_category_id, currency_id, opening_balance_minor, active
";

pub(super) const TRANSACTION_CATEGORY_COLUMNS: &str = "
    id, name, parent_id, kind, active
";

pub(super) fn row_to_currency(row: &Row<'_>) -> LedgerResult<Currency> {
    let decimal_places: i64 = row_value(row, 4)?;
    let decimal_places = u8::try_from(decimal_places).map_err(|_| {
        persisted_domain_error(format!("invalid currency precision {decimal_places}"))
    })?;

    Currency::rehydrate(
        row_value::<String>(row, 0)?,
        row_value::<String>(row, 1)?,
        row_value::<String>(row, 2)?,
        row_value::<String>(row, 3)?,
        decimal_places,
        row_bool(row, 5)?,
    )
    .map_err(persisted_domain_error)
}

pub(super) fn row_to_account_category(row: &Row<'_>) -> LedgerResult<AccountCategory> {
    AccountCategory::rehydrate(
        row_value::<String>(row, 0)?,
        row_value::<String>(row, 1)?,
        row_value(row, 2)?,
        row_bool(row, 3)?,
        row_bool(row, 4)?,
    )
    .map_err(persisted_domain_error)
}

pub(super) fn row_to_account(row: &Row<'_>) -> LedgerResult<Account> {
    Account::rehydrate(
        row_value::<String>(row, 0)?,
        row_value::<String>(row, 1)?,
        row_value::<String>(row, 2)?,
        row_value::<String>(row, 3)?,
        Money::from_minor_units(row_value(row, 4)?),
        row_bool(row, 5)?,
    )
    .map_err(persisted_domain_error)
}

pub(super) fn row_to_transaction_category(row: &Row<'_>) -> LedgerResult<TransactionCategory> {
    let kind: String = row_value(row, 3)?;
    TransactionCategory::rehydrate(
        row_value::<String>(row, 0)?,
        row_value::<String>(row, 1)?,
        row_value(row, 2)?,
        parse_transaction_category_kind(&kind)?,
        row_bool(row, 4)?,
    )
    .map_err(persisted_domain_error)
}

pub(super) fn row_to_entry(row: &Row<'_>) -> LedgerResult<LedgerEntry> {
    let entry_type: String = row_value(row, 6)?;
    let written_at: String = row_value(row, 2)?;
    let created_at: String = row_value(row, 12)?;
    let updated_at: String = row_value(row, 13)?;
    let deleted_at: Option<String> = row_value(row, 14)?;

    LedgerEntry::rehydrate(LedgerEntryRehydration {
        id: row_value(row, 0)?,
        date: row_value(row, 1)?,
        written_at: parse_time(&written_at)?,
        content: row_value(row, 3)?,
        transaction_category_id: row_value(row, 4)?,
        account_id: row_value(row, 5)?,
        entry_type: parse_entry_type(&entry_type)?,
        amount: Money::from_minor_units(row_value(row, 7)?),
        currency_id: row_value(row, 8)?,
        transfer_group_id: row_value(row, 9)?,
        source: row_value(row, 10)?,
        notes: row_value(row, 11)?,
        created_at: parse_time(&created_at)?,
        updated_at: parse_time(&updated_at)?,
        deleted_at: deleted_at.as_deref().map(parse_time).transpose()?,
    })
    .map_err(persisted_domain_error)
}

pub(super) fn row_to_audit_event(row: &Row<'_>) -> LedgerResult<AuditEvent> {
    let occurred_at: String = row_value(row, 1)?;
    let before: Option<String> = row_value(row, 6)?;
    let after: Option<String> = row_value(row, 7)?;

    Ok(AuditEvent {
        id: row_value(row, 0)?,
        occurred_at: parse_time(&occurred_at)?,
        actor: row_value(row, 2)?,
        action: row_value(row, 3)?,
        record_type: row_value(row, 4)?,
        record_id: row_value(row, 5)?,
        before: parse_optional_json(before.as_deref())?,
        after: parse_optional_json(after.as_deref())?,
        reason: row_value(row, 8)?,
    })
}

pub(super) fn format_time(value: OffsetDateTime) -> LedgerResult<String> {
    value
        .to_offset(UtcOffset::UTC)
        .format(&Rfc3339)
        .map_err(|error| LedgerError::Storage(error.to_string()))
}

fn parse_time(value: &str) -> LedgerResult<OffsetDateTime> {
    OffsetDateTime::parse(value, &Rfc3339).map_err(|error| LedgerError::Storage(error.to_string()))
}

fn parse_entry_type(value: &str) -> LedgerResult<EntryType> {
    match value {
        "expense" => Ok(EntryType::Expense),
        "income" => Ok(EntryType::Income),
        "transfer_out" => Ok(EntryType::TransferOut),
        "transfer_in" => Ok(EntryType::TransferIn),
        "adjustment_out" => Ok(EntryType::AdjustmentOut),
        "adjustment_in" => Ok(EntryType::AdjustmentIn),
        _ => Err(persisted_domain_error(format!(
            "unknown entry type {value}"
        ))),
    }
}

fn parse_transaction_category_kind(value: &str) -> LedgerResult<TransactionCategoryKind> {
    match value {
        "expense" => Ok(TransactionCategoryKind::Expense),
        "income" => Ok(TransactionCategoryKind::Income),
        _ => Err(persisted_domain_error(format!(
            "unknown transaction category kind {value}"
        ))),
    }
}

fn parse_optional_json(value: Option<&str>) -> LedgerResult<Option<serde_json::Value>> {
    value
        .map(serde_json::from_str)
        .transpose()
        .map_err(|error| LedgerError::Storage(error.to_string()))
}

fn row_value<T: rusqlite::types::FromSql>(row: &Row<'_>, index: usize) -> LedgerResult<T> {
    row.get(index).map_err(storage_error)
}

fn row_bool(row: &Row<'_>, index: usize) -> LedgerResult<bool> {
    match row_value::<i64>(row, index)? {
        0 => Ok(false),
        1 => Ok(true),
        value => Err(persisted_domain_error(format!(
            "invalid boolean value {value}"
        ))),
    }
}

fn persisted_domain_error(error: impl std::fmt::Display) -> LedgerError {
    LedgerError::Storage(format!(
        "persisted ledger record violates domain invariant: {error}"
    ))
}
