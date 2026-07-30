use serde::Serialize;
use serde_json::Value;
use time::{Date, OffsetDateTime};

use crate::application::error::LedgerResult;
use crate::domain::{
    Account, AccountCategory, Currency, EntryType, LedgerEntry, TransactionCategory,
};

pub const DEFAULT_PAGE_LIMIT: u16 = 100;
pub const MAX_PAGE_LIMIT: u16 = 500;

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
    pub date_from: Option<Date>,
    pub date_to: Option<Date>,
    pub entry_type: Option<EntryType>,
    /// Account ID at the repository boundary; the service also accepts a unique name.
    pub account: Option<String>,
    /// Category ID at the repository boundary; the service also accepts a unique name.
    pub category: Option<String>,
    /// Currency ID at the repository boundary; the service also accepts ID/code/name.
    pub currency: Option<String>,
    /// A literal, case-insensitive substring. SQL wildcard characters have no special meaning.
    pub content: Option<String>,
    pub include_archived: bool,
    pub offset: u32,
    pub limit: u16,
}

impl Default for EntryQuery {
    fn default() -> Self {
        Self {
            date_from: None,
            date_to: None,
            entry_type: None,
            account: None,
            category: None,
            currency: None,
            content: None,
            include_archived: false,
            offset: 0,
            limit: DEFAULT_PAGE_LIMIT,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AuditEvent {
    pub id: String,
    #[serde(with = "time::serde::rfc3339")]
    pub occurred_at: OffsetDateTime,
    pub actor: String,
    pub action: String,
    pub record_type: String,
    pub record_id: String,
    pub before: Option<Value>,
    pub after: Option<Value>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DatabaseHealth {
    pub integrity_messages: Vec<String>,
    pub integrity_truncated: bool,
    pub foreign_key_violations: Vec<ForeignKeyViolation>,
    pub foreign_key_truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForeignKeyViolation {
    pub table: String,
    pub row_id: Option<i64>,
    pub parent_table: String,
    pub foreign_key_index: i64,
}

/// Raw, read-only projection used by doctor so malformed persisted values can
/// be reported instead of failing domain rehydration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiagnosticEntry {
    pub id: String,
    pub date: String,
    pub written_at: String,
    pub content: String,
    pub transaction_category_id: Option<String>,
    pub account_id: String,
    pub entry_type: String,
    pub amount_minor: i64,
    pub currency_id: String,
    pub transfer_group_id: Option<String>,
    pub source: String,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiagnosticTransferOperation {
    pub operation_key: String,
    pub payload_json: String,
    pub result_json: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TransferOperationRecord {
    pub payload_json: String,
    pub result_json: String,
}

/// Persistence operations that must commit or roll back as one Ledger mutation.
///
/// Consuming `commit` and `rollback` prevents a completed transaction from
/// being reused. Dropping an unfinished implementation must roll it back.
#[allow(dead_code)]
pub(crate) trait LedgerTransaction {
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
    fn list_entries_by_transfer_group(
        &self,
        transfer_group_id: &str,
        include_archived: bool,
    ) -> LedgerResult<Vec<LedgerEntry>>;
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
    fn account_category_has_dependencies(&self, id: &str) -> LedgerResult<bool>;
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
    fn delete_currency(&mut self, id: &str) -> LedgerResult<()>;
    fn delete_account_category(&mut self, id: &str) -> LedgerResult<()>;
    fn delete_account(&mut self, id: &str) -> LedgerResult<()>;
    fn delete_transaction_category(&mut self, id: &str) -> LedgerResult<()>;
    fn insert_entry(&mut self, entry: &LedgerEntry) -> LedgerResult<()>;
    fn update_entry(&mut self, entry: &LedgerEntry) -> LedgerResult<()>;
    fn delete_entry(&mut self, id: &str) -> LedgerResult<()>;
    fn insert_audit_event(&mut self, event: &AuditEvent) -> LedgerResult<()>;
    fn get_transfer_operation(
        &self,
        operation_key: &str,
    ) -> LedgerResult<Option<TransferOperationRecord>>;
    fn insert_transfer_operation(
        &mut self,
        operation_key: &str,
        payload_json: &str,
        result_json: &str,
        created_at: OffsetDateTime,
    ) -> LedgerResult<()>;
    fn commit(self: Box<Self>) -> LedgerResult<()>;
    fn rollback(self: Box<Self>) -> LedgerResult<()>;
}

/// Object-safe Ledger persistence boundary.
///
/// Returning a boxed, borrowing transaction keeps the trait usable behind
/// `dyn LedgerRepository` while still allowing a service mutation to return
/// any application value after explicitly committing.
pub trait LedgerRepository: Send {
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
    fn list_currencies(&self, include_archived: bool, page: Page) -> LedgerResult<Vec<Currency>>;
    fn list_account_categories(
        &self,
        include_archived: bool,
        page: Page,
    ) -> LedgerResult<Vec<AccountCategory>>;
    fn list_accounts(&self, include_archived: bool, page: Page) -> LedgerResult<Vec<Account>>;
    fn list_transaction_categories(
        &self,
        include_archived: bool,
        page: Page,
    ) -> LedgerResult<Vec<TransactionCategory>>;
    fn list_entries(&self, query: &EntryQuery) -> LedgerResult<Vec<LedgerEntry>>;
    fn get_entry(&self, id: &str, include_archived: bool) -> LedgerResult<Option<LedgerEntry>>;
    fn list_entries_by_transfer_group(
        &self,
        transfer_group_id: &str,
        include_archived: bool,
    ) -> LedgerResult<Vec<LedgerEntry>>;
    fn list_audit_events(
        &self,
        record_type: &str,
        record_id: &str,
        page: Page,
    ) -> LedgerResult<Vec<AuditEvent>>;
    fn list_all_audit_events(&self, page: Page) -> LedgerResult<Vec<AuditEvent>>;
    fn database_health(&self) -> LedgerResult<DatabaseHealth>;
    fn list_diagnostic_entries(&self, page: Page) -> LedgerResult<Vec<DiagnosticEntry>>;
    fn list_diagnostic_transfer_operations(
        &self,
        page: Page,
    ) -> LedgerResult<Vec<DiagnosticTransferOperation>>;
}

/// Internal mutation capability. External callers only receive the read-only
/// [`LedgerRepository`] surface; application services are the sole mutation path.
pub(crate) trait LedgerMutationRepository: LedgerRepository {
    fn begin_transaction(&mut self) -> LedgerResult<Box<dyn LedgerTransaction + '_>>;
}
