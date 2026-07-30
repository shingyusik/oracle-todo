use std::collections::HashSet;

use crate::application::error::{LedgerError, LedgerResult};
use crate::application::ports::{CandidateMatch, LedgerRepository, LedgerTransaction};
use crate::domain::{
    Account, AccountCategory, Currency, TransactionCategory, TransactionCategoryKind,
};

use super::commands::{
    CreateAccount, CreateAccountCategory, CreateCurrency, CreateTransactionCategory, UpdateAccount,
    UpdateAccountCategory, UpdateCurrency, UpdateTransactionCategory,
};
use super::entries::{AuditMutation, audit_event, domain_validation, validate_actor};
use super::service::LedgerService;

const MAX_HIERARCHY_DEPTH: usize = 1024;

impl<R: LedgerRepository> LedgerService<R> {
    pub fn create_currency(&mut self, command: CreateCurrency) -> LedgerResult<Currency> {
        validate_actor(&command.actor)?;
        let now = time::OffsetDateTime::now_utc();
        let mut transaction = self.repository.begin_transaction()?;
        let currency = Currency::new(
            uuid::Uuid::new_v4().to_string(),
            command.code,
            command.name,
            command.symbol,
            command.decimal_places,
        )
        .map_err(|error| domain_validation("currency", error))?;
        transaction.upsert_currency(&currency, now)?;
        transaction.insert_audit_event(&audit_event(AuditMutation {
            occurred_at: now,
            actor: command.actor,
            action: "create",
            record_type: "currency",
            record_id: currency.id(),
            before: None::<&Currency>,
            after: Some(&currency),
            reason: None,
        })?)?;
        transaction.commit()?;
        Ok(currency)
    }

    pub fn update_currency(&mut self, id: &str, command: UpdateCurrency) -> LedgerResult<Currency> {
        validate_actor(&command.actor)?;
        let now = time::OffsetDateTime::now_utc();
        let mut transaction = self.repository.begin_transaction()?;
        let before = transaction
            .get_currency(id, false)?
            .ok_or_else(|| LedgerError::NotFound(format!("currency {id}")))?;
        if command
            .decimal_places
            .is_some_and(|precision| precision != before.decimal_places())
            && transaction.currency_has_dependencies(id)?
        {
            return Err(LedgerError::Conflict(format!(
                "currency {id} decimal places are immutable while referenced"
            )));
        }
        let after = Currency::rehydrate(
            before.id(),
            command.code.unwrap_or_else(|| before.code().to_string()),
            command.name.unwrap_or_else(|| before.name().to_string()),
            command
                .symbol
                .unwrap_or_else(|| before.symbol().to_string()),
            command.decimal_places.unwrap_or(before.decimal_places()),
            command.active.unwrap_or(before.is_active()),
        )
        .map_err(|error| domain_validation("currency", error))?;
        transaction.upsert_currency(&after, now)?;
        transaction.insert_audit_event(&audit_event(AuditMutation {
            occurred_at: now,
            actor: command.actor,
            action: "update",
            record_type: "currency",
            record_id: after.id(),
            before: Some(&before),
            after: Some(&after),
            reason: command.reason,
        })?)?;
        transaction.commit()?;
        Ok(after)
    }

    pub fn create_account_category(
        &mut self,
        command: CreateAccountCategory,
    ) -> LedgerResult<AccountCategory> {
        validate_actor(&command.actor)?;
        let now = time::OffsetDateTime::now_utc();
        let mut transaction = self.repository.begin_transaction()?;
        let parent_id = command
            .parent
            .as_deref()
            .map(|reference| resolve_account_category(&*transaction, reference))
            .transpose()?
            .map(|parent| parent.id().to_string());
        let category = AccountCategory::new(
            uuid::Uuid::new_v4().to_string(),
            command.name,
            parent_id,
            command.liability,
        )
        .map_err(|error| domain_validation("account_category", error))?;
        transaction.upsert_account_category(&category, now)?;
        transaction.insert_audit_event(&audit_event(AuditMutation {
            occurred_at: now,
            actor: command.actor,
            action: "create",
            record_type: "account_category",
            record_id: category.id(),
            before: None::<&AccountCategory>,
            after: Some(&category),
            reason: None,
        })?)?;
        transaction.commit()?;
        Ok(category)
    }

    pub fn update_account_category(
        &mut self,
        id: &str,
        command: UpdateAccountCategory,
    ) -> LedgerResult<AccountCategory> {
        validate_actor(&command.actor)?;
        let now = time::OffsetDateTime::now_utc();
        let mut transaction = self.repository.begin_transaction()?;
        let before = transaction
            .get_account_category(id, false)?
            .ok_or_else(|| LedgerError::NotFound(format!("account category {id}")))?;
        let parent_id = match command.parent {
            Some(Some(reference)) => {
                let parent = resolve_account_category(&*transaction, &reference)?;
                validate_account_category_ancestor_chain(&*transaction, id, parent.id())?;
                Some(parent.id().to_string())
            }
            Some(None) => None,
            None => before.parent_id().map(str::to_string),
        };
        let after = AccountCategory::rehydrate(
            before.id(),
            command.name.unwrap_or_else(|| before.name().to_string()),
            parent_id,
            command.liability.unwrap_or(before.is_liability()),
            command.active.unwrap_or(before.is_active()),
        )
        .map_err(|error| domain_validation("account_category", error))?;
        transaction.upsert_account_category(&after, now)?;
        transaction.insert_audit_event(&audit_event(AuditMutation {
            occurred_at: now,
            actor: command.actor,
            action: "update",
            record_type: "account_category",
            record_id: after.id(),
            before: Some(&before),
            after: Some(&after),
            reason: command.reason,
        })?)?;
        transaction.commit()?;
        Ok(after)
    }

    pub fn create_account(&mut self, command: CreateAccount) -> LedgerResult<Account> {
        validate_actor(&command.actor)?;
        let now = time::OffsetDateTime::now_utc();
        let mut transaction = self.repository.begin_transaction()?;
        let category = resolve_account_category(&*transaction, &command.category)?;
        let currency = resolve_currency(&*transaction, &command.currency)?;
        let account = Account::new(
            uuid::Uuid::new_v4().to_string(),
            command.name,
            category.id(),
            currency.id(),
            command.opening_balance,
        )
        .map_err(|error| domain_validation("account", error))?;
        transaction.upsert_account(&account, now)?;
        transaction.insert_audit_event(&audit_event(AuditMutation {
            occurred_at: now,
            actor: command.actor,
            action: "create",
            record_type: "account",
            record_id: account.id(),
            before: None::<&Account>,
            after: Some(&account),
            reason: None,
        })?)?;
        transaction.commit()?;
        Ok(account)
    }

    pub fn update_account(&mut self, id: &str, command: UpdateAccount) -> LedgerResult<Account> {
        validate_actor(&command.actor)?;
        let now = time::OffsetDateTime::now_utc();
        let mut transaction = self.repository.begin_transaction()?;
        let before = transaction
            .get_account(id, false)?
            .ok_or_else(|| LedgerError::NotFound(format!("account {id}")))?;
        let category_id = match command.category {
            Some(reference) => resolve_account_category(&*transaction, &reference)?
                .id()
                .to_string(),
            None => before.category_id().to_string(),
        };
        let currency_id = match command.currency {
            Some(reference) => {
                let currency = resolve_currency(&*transaction, &reference)?;
                if currency.id() != before.currency_id() && transaction.account_has_entries(id)? {
                    return Err(LedgerError::Conflict(format!(
                        "account {id} currency is immutable while entries reference the account"
                    )));
                }
                currency.id().to_string()
            }
            None => before.currency_id().to_string(),
        };
        let after = Account::rehydrate(
            before.id(),
            command.name.unwrap_or_else(|| before.name().to_string()),
            category_id,
            currency_id,
            command
                .opening_balance
                .unwrap_or_else(|| before.opening_balance()),
            command.active.unwrap_or(before.is_active()),
        )
        .map_err(|error| domain_validation("account", error))?;
        transaction.upsert_account(&after, now)?;
        transaction.insert_audit_event(&audit_event(AuditMutation {
            occurred_at: now,
            actor: command.actor,
            action: "update",
            record_type: "account",
            record_id: after.id(),
            before: Some(&before),
            after: Some(&after),
            reason: command.reason,
        })?)?;
        transaction.commit()?;
        Ok(after)
    }

    pub fn create_category(
        &mut self,
        command: CreateTransactionCategory,
    ) -> LedgerResult<TransactionCategory> {
        validate_actor(&command.actor)?;
        let now = time::OffsetDateTime::now_utc();
        let mut transaction = self.repository.begin_transaction()?;
        let parent_id = command
            .parent
            .as_deref()
            .map(|reference| resolve_transaction_category(&*transaction, reference))
            .transpose()?
            .map(|parent| {
                validate_parent_kind(parent.kind(), command.kind)?;
                Ok(parent.id().to_string())
            })
            .transpose()?;
        let category = TransactionCategory::new(
            uuid::Uuid::new_v4().to_string(),
            command.name,
            parent_id,
            command.kind,
        )
        .map_err(|error| domain_validation("category", error))?;
        transaction.upsert_transaction_category(&category, now)?;
        transaction.insert_audit_event(&audit_event(AuditMutation {
            occurred_at: now,
            actor: command.actor,
            action: "create",
            record_type: "transaction_category",
            record_id: category.id(),
            before: None::<&TransactionCategory>,
            after: Some(&category),
            reason: None,
        })?)?;
        transaction.commit()?;
        Ok(category)
    }

    pub fn update_category(
        &mut self,
        id: &str,
        command: UpdateTransactionCategory,
    ) -> LedgerResult<TransactionCategory> {
        validate_actor(&command.actor)?;
        let now = time::OffsetDateTime::now_utc();
        let mut transaction = self.repository.begin_transaction()?;
        let before = transaction
            .get_transaction_category(id, false)?
            .ok_or_else(|| LedgerError::NotFound(format!("transaction category {id}")))?;
        let kind = command.kind.unwrap_or(before.kind());
        let kind_changed = kind != before.kind();
        if kind_changed && transaction.transaction_category_has_entries(id)? {
            return Err(LedgerError::Conflict(format!(
                "transaction category {id} kind is immutable while referenced by entries"
            )));
        }
        if kind_changed && transaction.transaction_category_has_children(id)? {
            return Err(LedgerError::Conflict(format!(
                "transaction category {id} kind is immutable while children exist"
            )));
        }
        let parent_id = match command.parent {
            Some(Some(reference)) => {
                let parent = resolve_transaction_category(&*transaction, &reference)?;
                validate_parent_kind(parent.kind(), kind)?;
                validate_transaction_category_ancestor_chain(&*transaction, id, parent.id())?;
                Some(parent.id().to_string())
            }
            Some(None) => None,
            None => {
                if let Some(parent_id) = before.parent_id() {
                    let parent = historical_transaction_category(&*transaction, parent_id)?;
                    validate_parent_kind(parent.kind(), kind)?;
                }
                before.parent_id().map(str::to_string)
            }
        };
        let after = TransactionCategory::rehydrate(
            before.id(),
            command.name.unwrap_or_else(|| before.name().to_string()),
            parent_id,
            kind,
            command.active.unwrap_or(before.is_active()),
        )
        .map_err(|error| domain_validation("category", error))?;
        transaction.upsert_transaction_category(&after, now)?;
        transaction.insert_audit_event(&audit_event(AuditMutation {
            occurred_at: now,
            actor: command.actor,
            action: "update",
            record_type: "transaction_category",
            record_id: after.id(),
            before: Some(&before),
            after: Some(&after),
            reason: command.reason,
        })?)?;
        transaction.commit()?;
        Ok(after)
    }
}

fn validate_parent_kind(
    parent: TransactionCategoryKind,
    child: TransactionCategoryKind,
) -> LedgerResult<()> {
    if parent != child {
        return Err(LedgerError::Validation {
            field: "parent",
            message: "parent category kind must match child category kind".to_string(),
        });
    }
    Ok(())
}

fn historical_transaction_category(
    transaction: &dyn LedgerTransaction,
    id: &str,
) -> LedgerResult<TransactionCategory> {
    transaction
        .get_transaction_category(id, true)?
        .ok_or_else(|| {
            LedgerError::Conflict(format!(
                "transaction category hierarchy references missing parent {id}"
            ))
        })
}

fn validate_account_category_ancestor_chain(
    transaction: &dyn LedgerTransaction,
    target_id: &str,
    proposed_parent_id: &str,
) -> LedgerResult<()> {
    let mut cursor = Some(proposed_parent_id.to_string());
    let mut seen = HashSet::new();
    for _ in 0..MAX_HIERARCHY_DEPTH {
        let Some(id) = cursor else {
            return Ok(());
        };
        if id == target_id || !seen.insert(id.clone()) {
            return Err(LedgerError::Conflict(
                "account category hierarchy cycle detected".to_string(),
            ));
        }
        let category = transaction
            .get_account_category(&id, true)?
            .ok_or_else(|| {
                LedgerError::Conflict(format!(
                    "account category hierarchy references missing ancestor {id}"
                ))
            })?;
        cursor = category.parent_id().map(str::to_string);
    }
    Err(LedgerError::Conflict(format!(
        "account category hierarchy exceeds {MAX_HIERARCHY_DEPTH} ancestors"
    )))
}

fn validate_transaction_category_ancestor_chain(
    transaction: &dyn LedgerTransaction,
    target_id: &str,
    proposed_parent_id: &str,
) -> LedgerResult<()> {
    let mut cursor = Some(proposed_parent_id.to_string());
    let mut seen = HashSet::new();
    for _ in 0..MAX_HIERARCHY_DEPTH {
        let Some(id) = cursor else {
            return Ok(());
        };
        if id == target_id || !seen.insert(id.clone()) {
            return Err(LedgerError::Conflict(
                "transaction category hierarchy cycle detected".to_string(),
            ));
        }
        let category = transaction
            .get_transaction_category(&id, true)?
            .ok_or_else(|| {
                LedgerError::Conflict(format!(
                    "transaction category hierarchy references missing ancestor {id}"
                ))
            })?;
        cursor = category.parent_id().map(str::to_string);
    }
    Err(LedgerError::Conflict(format!(
        "transaction category hierarchy exceeds {MAX_HIERARCHY_DEPTH} ancestors"
    )))
}

pub(super) fn resolve_currency(
    transaction: &dyn LedgerTransaction,
    reference: &str,
) -> LedgerResult<Currency> {
    let reference = required_reference(reference, "currency")?;
    if let Some(currency) = transaction.get_currency(reference, false)? {
        return active_currency(currency, reference);
    }
    if transaction.get_currency(reference, true)?.is_some() {
        return Err(not_found("deleted currency", reference));
    }

    match transaction.currency_by_code(reference)? {
        CandidateMatch::One(currency) => return Ok(currency),
        CandidateMatch::Ambiguous => return Err(ambiguous("currency", reference)),
        CandidateMatch::None => {}
    }
    match transaction.currency_by_active_name(reference)? {
        CandidateMatch::One(currency) => Ok(currency),
        CandidateMatch::Ambiguous => Err(ambiguous("currency", reference)),
        CandidateMatch::None => Err(not_found("currency", reference)),
    }
}

pub(super) fn resolve_account_category(
    transaction: &dyn LedgerTransaction,
    reference: &str,
) -> LedgerResult<AccountCategory> {
    let reference = required_reference(reference, "account_category")?;
    if let Some(category) = transaction.get_account_category(reference, false)? {
        return active_account_category(category, reference);
    }
    if transaction.get_account_category(reference, true)?.is_some() {
        return Err(not_found("deleted account category", reference));
    }
    match transaction.account_category_by_active_name(reference)? {
        CandidateMatch::One(category) => Ok(category),
        CandidateMatch::Ambiguous => Err(ambiguous("account category", reference)),
        CandidateMatch::None => Err(not_found("account category", reference)),
    }
}

pub(super) fn resolve_account(
    transaction: &dyn LedgerTransaction,
    reference: &str,
) -> LedgerResult<Account> {
    let reference = required_reference(reference, "account")?;
    if let Some(account) = transaction.get_account(reference, false)? {
        return active_account(account, reference);
    }
    if transaction.get_account(reference, true)?.is_some() {
        return Err(not_found("deleted account", reference));
    }
    match transaction.account_by_active_name(reference)? {
        CandidateMatch::One(account) => Ok(account),
        CandidateMatch::Ambiguous => Err(ambiguous("account", reference)),
        CandidateMatch::None => Err(not_found("account", reference)),
    }
}

pub(super) fn resolve_transaction_category(
    transaction: &dyn LedgerTransaction,
    reference: &str,
) -> LedgerResult<TransactionCategory> {
    let reference = required_reference(reference, "category")?;
    if let Some(category) = transaction.get_transaction_category(reference, false)? {
        return active_transaction_category(category, reference);
    }
    if transaction
        .get_transaction_category(reference, true)?
        .is_some()
    {
        return Err(not_found("deleted transaction category", reference));
    }
    match transaction.transaction_category_by_active_name(reference)? {
        CandidateMatch::One(category) => Ok(category),
        CandidateMatch::Ambiguous => Err(ambiguous("transaction category", reference)),
        CandidateMatch::None => Err(not_found("transaction category", reference)),
    }
}

fn required_reference<'a>(reference: &'a str, field: &'static str) -> LedgerResult<&'a str> {
    let reference = reference.trim();
    if reference.is_empty() {
        return Err(LedgerError::Validation {
            field,
            message: "reference must not be blank".to_string(),
        });
    }
    Ok(reference)
}

fn active_currency(currency: Currency, reference: &str) -> LedgerResult<Currency> {
    if currency.is_active() {
        Ok(currency)
    } else {
        Err(inactive("currency", reference))
    }
}

fn active_account_category(
    category: AccountCategory,
    reference: &str,
) -> LedgerResult<AccountCategory> {
    if category.is_active() {
        Ok(category)
    } else {
        Err(inactive("account category", reference))
    }
}

fn active_account(account: Account, reference: &str) -> LedgerResult<Account> {
    if account.is_active() {
        Ok(account)
    } else {
        Err(inactive("account", reference))
    }
}

fn active_transaction_category(
    category: TransactionCategory,
    reference: &str,
) -> LedgerResult<TransactionCategory> {
    if category.is_active() {
        Ok(category)
    } else {
        Err(inactive("transaction category", reference))
    }
}

fn not_found(kind: &str, reference: &str) -> LedgerError {
    LedgerError::NotFound(format!("{kind} reference {reference}"))
}

fn ambiguous(kind: &str, reference: &str) -> LedgerError {
    LedgerError::Conflict(format!("{kind} reference {reference} is ambiguous"))
}

fn inactive(kind: &str, reference: &str) -> LedgerError {
    LedgerError::Conflict(format!("{kind} reference {reference} is inactive"))
}
