use serde_json::Value;
use time::OffsetDateTime;

use crate::application::error::LedgerResult;
use crate::domain::{Account, AccountCategory, Currency, LedgerEntry, TransactionCategory};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EntryQuery {
    pub include_archived: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuditEvent {
    pub id: String,
    pub occurred_at: OffsetDateTime,
    pub actor: String,
    pub action: String,
    pub record_type: String,
    pub record_id: String,
    pub before: Option<Value>,
    pub after: Option<Value>,
    pub reason: Option<String>,
}

/// Persistence operations that must commit or roll back as one Ledger mutation.
///
/// Consuming `commit` and `rollback` prevents a completed transaction from
/// being reused. Dropping an unfinished implementation must roll it back.
pub trait LedgerTransaction {
    fn get_currency(&self, id: &str, include_archived: bool) -> LedgerResult<Option<Currency>>;
    fn get_account_category(
        &self,
        id: &str,
        include_archived: bool,
    ) -> LedgerResult<Option<AccountCategory>>;
    fn get_account(&self, id: &str, include_archived: bool) -> LedgerResult<Option<Account>>;
    fn get_transaction_category(
        &self,
        id: &str,
        include_archived: bool,
    ) -> LedgerResult<Option<TransactionCategory>>;
    fn get_entry(&self, id: &str, include_archived: bool) -> LedgerResult<Option<LedgerEntry>>;
    fn upsert_currency(
        &mut self,
        currency: &Currency,
        changed_at: OffsetDateTime,
    ) -> LedgerResult<()>;
    fn upsert_account_category(
        &mut self,
        category: &AccountCategory,
        changed_at: OffsetDateTime,
    ) -> LedgerResult<()>;
    fn upsert_account(&mut self, account: &Account, changed_at: OffsetDateTime)
    -> LedgerResult<()>;
    fn upsert_transaction_category(
        &mut self,
        category: &TransactionCategory,
        changed_at: OffsetDateTime,
    ) -> LedgerResult<()>;
    fn insert_entry(&mut self, entry: &LedgerEntry) -> LedgerResult<()>;
    fn update_entry(&mut self, entry: &LedgerEntry) -> LedgerResult<()>;
    fn insert_audit_event(&mut self, event: &AuditEvent) -> LedgerResult<()>;
    fn commit(self: Box<Self>) -> LedgerResult<()>;
    fn rollback(self: Box<Self>) -> LedgerResult<()>;
}

/// Object-safe Ledger persistence boundary.
///
/// Returning a boxed, borrowing transaction keeps the trait usable behind
/// `dyn LedgerRepository` while still allowing a service mutation to return
/// any application value after explicitly committing.
pub trait LedgerRepository: Send {
    fn begin_transaction(&mut self) -> LedgerResult<Box<dyn LedgerTransaction + '_>>;
    fn get_currency(&self, id: &str, include_archived: bool) -> LedgerResult<Option<Currency>>;
    fn get_account_category(
        &self,
        id: &str,
        include_archived: bool,
    ) -> LedgerResult<Option<AccountCategory>>;
    fn get_account(&self, id: &str, include_archived: bool) -> LedgerResult<Option<Account>>;
    fn get_transaction_category(
        &self,
        id: &str,
        include_archived: bool,
    ) -> LedgerResult<Option<TransactionCategory>>;
    fn list_entries(&self, query: &EntryQuery) -> LedgerResult<Vec<LedgerEntry>>;
    fn get_entry(&self, id: &str, include_archived: bool) -> LedgerResult<Option<LedgerEntry>>;
    fn list_audit_events(&self, record_id: &str) -> LedgerResult<Vec<AuditEvent>>;
}
