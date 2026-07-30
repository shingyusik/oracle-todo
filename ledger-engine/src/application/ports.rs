use serde_json::Value;
use time::OffsetDateTime;

use crate::application::error::LedgerResult;
use crate::domain::{Account, AccountCategory, Currency, LedgerEntry, TransactionCategory};

pub const DEFAULT_PAGE_LIMIT: u16 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Page {
    pub offset: u32,
    pub limit: u16,
}

impl Default for Page {
    fn default() -> Self {
        Self {
            offset: 0,
            limit: DEFAULT_PAGE_LIMIT,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Paged<T> {
    pub items: Vec<T>,
    pub next: Option<Page>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CandidateMatch<T> {
    None,
    One(T),
    Ambiguous,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntryQuery {
    pub include_archived: bool,
    pub offset: u32,
    pub limit: u16,
}

impl Default for EntryQuery {
    fn default() -> Self {
        Self {
            include_archived: false,
            offset: 0,
            limit: DEFAULT_PAGE_LIMIT,
        }
    }
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
    fn currency_by_code(&self, code: &str) -> LedgerResult<CandidateMatch<Currency>>;
    fn currency_by_active_name(&self, name: &str) -> LedgerResult<CandidateMatch<Currency>>;
    fn account_category_by_active_name(
        &self,
        name: &str,
    ) -> LedgerResult<CandidateMatch<AccountCategory>>;
    fn account_by_active_name(&self, name: &str) -> LedgerResult<CandidateMatch<Account>>;
    fn transaction_category_by_active_name(
        &self,
        name: &str,
    ) -> LedgerResult<CandidateMatch<TransactionCategory>>;
    fn currency_has_dependencies(&self, id: &str) -> LedgerResult<bool>;
    fn account_has_entries(&self, id: &str) -> LedgerResult<bool>;
    fn transaction_category_has_entries(&self, id: &str) -> LedgerResult<bool>;
    fn transaction_category_has_children(&self, id: &str) -> LedgerResult<bool>;
    fn list_active_currencies(&self, page: Page) -> LedgerResult<Vec<Currency>>;
    fn list_active_account_categories(&self, page: Page) -> LedgerResult<Vec<AccountCategory>>;
    fn list_active_accounts(&self, page: Page) -> LedgerResult<Vec<Account>>;
    fn list_active_transaction_categories(
        &self,
        page: Page,
    ) -> LedgerResult<Vec<TransactionCategory>>;
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
    fn list_active_currencies(&self, page: Page) -> LedgerResult<Vec<Currency>>;
    fn list_active_account_categories(&self, page: Page) -> LedgerResult<Vec<AccountCategory>>;
    fn list_active_accounts(&self, page: Page) -> LedgerResult<Vec<Account>>;
    fn list_active_transaction_categories(
        &self,
        page: Page,
    ) -> LedgerResult<Vec<TransactionCategory>>;
    fn list_entries(&self, query: &EntryQuery) -> LedgerResult<Vec<LedgerEntry>>;
    fn get_entry(&self, id: &str, include_archived: bool) -> LedgerResult<Option<LedgerEntry>>;
    fn list_audit_events(
        &self,
        record_type: &str,
        record_id: &str,
        page: Page,
    ) -> LedgerResult<Vec<AuditEvent>>;
}
