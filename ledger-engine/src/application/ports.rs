use std::collections::BTreeMap;

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
pub struct AuditActivity {
    pub occurred_at: OffsetDateTime,
    pub action: String,
    pub record_id: String,
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AccountBalanceRecord {
    pub account: Account,
    pub currency_code: String,
    pub decimal_places: u8,
    pub movement_minor: i64,
    pub currency_mismatch_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct EntryViewRecord {
    pub entry: LedgerEntry,
    pub account_name: Option<String>,
    pub category_name: Option<String>,
    pub currency_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReportAggregateRecord {
    pub reference_id: Option<String>,
    pub name: Option<String>,
    pub currency_id: String,
    pub currency_code: String,
    pub decimal_places: u8,
    pub income_minor: i64,
    pub expense_minor: i64,
    pub net_change_minor: i64,
    pub entry_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DailyReportRecord {
    pub date: Date,
    pub currency_id: String,
    pub currency_code: String,
    pub income_minor: i64,
    pub expense_minor: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StoredRecord<T> {
    pub record: T,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StoredTransferOperation {
    pub operation_key: String,
    pub payload_json: String,
    pub result_json: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StoredAuditEvent {
    pub sequence: i64,
    pub event: AuditEvent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum DiagnosticTable {
    Currencies,
    AccountCategories,
    Accounts,
    TransactionCategories,
    LedgerEntries,
    AuditEvents,
    TransferOperations,
}

impl DiagnosticTable {
    pub(crate) const ALL: [Self; 7] = [
        Self::Currencies,
        Self::AccountCategories,
        Self::Accounts,
        Self::TransactionCategories,
        Self::AuditEvents,
        Self::TransferOperations,
        Self::LedgerEntries,
    ];

    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::Currencies => "currencies",
            Self::AccountCategories => "account_categories",
            Self::Accounts => "accounts",
            Self::TransactionCategories => "transaction_categories",
            Self::LedgerEntries => "ledger_entries",
            Self::AuditEvents => "audit_events",
            Self::TransferOperations => "transfer_operations",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum DiagnosticValue {
    Null,
    Integer(i64),
    Real(f64),
    Text {
        value: Option<String>,
        byte_len: usize,
    },
    Blob {
        byte_len: usize,
    },
}

impl DiagnosticValue {
    pub(crate) const fn byte_len(&self) -> usize {
        match self {
            Self::Null => 0,
            Self::Integer(_) | Self::Real(_) => std::mem::size_of::<i64>(),
            Self::Text { byte_len, .. } | Self::Blob { byte_len } => *byte_len,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DiagnosticRow {
    pub rowid: i64,
    pub values: BTreeMap<String, DiagnosticValue>,
    pub byte_count: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DiagnosticBatch {
    pub rows: Vec<DiagnosticRow>,
    pub next_cursor: Option<i64>,
    pub next_unscanned_rowid: Option<i64>,
    pub byte_count: usize,
    pub truncated: bool,
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
    fn transaction_category_has_active_children(&self, id: &str) -> LedgerResult<bool>;
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

/// Public marker for a supported Ledger persistence adapter.
///
/// Storage reads remain crate-internal so callers cannot bypass service-level
/// validation, reference resolution, or resolved read projections.
pub trait LedgerRepository: Send {}

pub(crate) trait LedgerReadRepository: LedgerRepository {
    fn get_currency(&self, id: &str, include_archived: bool) -> LedgerResult<Option<Currency>>;
    #[cfg(test)]
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
    #[cfg(test)]
    fn list_entries(&self, query: &EntryQuery) -> LedgerResult<Vec<LedgerEntry>>;
    #[cfg(test)]
    fn get_entry(&self, id: &str, include_archived: bool) -> LedgerResult<Option<LedgerEntry>>;
    fn list_entry_view_records(&self, query: &EntryQuery) -> LedgerResult<Vec<EntryViewRecord>>;
    fn get_entry_view_record(
        &self,
        id: &str,
        include_archived: bool,
    ) -> LedgerResult<Option<EntryViewRecord>>;
    fn account_by_name(
        &self,
        name: &str,
        include_archived: bool,
    ) -> LedgerResult<CandidateMatch<Account>>;
    fn transaction_category_by_name(
        &self,
        name: &str,
        include_archived: bool,
    ) -> LedgerResult<CandidateMatch<TransactionCategory>>;
    fn currency_by_code_or_name(
        &self,
        value: &str,
        include_archived: bool,
    ) -> LedgerResult<CandidateMatch<Currency>>;
    fn list_entries_by_transfer_group(
        &self,
        transfer_group_id: &str,
        include_archived: bool,
    ) -> LedgerResult<Vec<LedgerEntry>>;
    fn list_account_balance_records(&self, page: Page) -> LedgerResult<Vec<AccountBalanceRecord>>;
    fn summarize_entries(&self, start: Date, end: Date)
    -> LedgerResult<Vec<ReportAggregateRecord>>;
    fn account_breakdown(&self, start: Date, end: Date)
    -> LedgerResult<Vec<ReportAggregateRecord>>;
    fn category_breakdown(
        &self,
        start: Date,
        end: Date,
    ) -> LedgerResult<Vec<ReportAggregateRecord>>;
    fn daily_report(&self, start: Date, end: Date) -> LedgerResult<Vec<DailyReportRecord>>;
    fn begin_export_snapshot(&self) -> LedgerResult<Box<dyn LedgerExportSnapshot + '_>>;
    fn scan_diagnostic_rows(
        &self,
        table: DiagnosticTable,
        after_rowid: Option<i64>,
        max_rows: u16,
        max_bytes: usize,
    ) -> LedgerResult<DiagnosticBatch>;
    fn list_audit_events(
        &self,
        record_type: &str,
        record_id: &str,
        page: Page,
    ) -> LedgerResult<Vec<AuditEvent>>;
    fn list_recent_audit_activity(&self, limit: u16) -> LedgerResult<Vec<AuditActivity>>;
    fn database_health(&self) -> LedgerResult<DatabaseHealth>;
}

pub(crate) trait LedgerExportSnapshot {
    fn stream_currencies(
        &self,
        include_archived: bool,
        visitor: &mut dyn FnMut(StoredRecord<Currency>) -> LedgerResult<()>,
    ) -> LedgerResult<()>;
    fn stream_account_categories(
        &self,
        include_archived: bool,
        visitor: &mut dyn FnMut(StoredRecord<AccountCategory>) -> LedgerResult<()>,
    ) -> LedgerResult<()>;
    fn stream_accounts(
        &self,
        include_archived: bool,
        visitor: &mut dyn FnMut(StoredRecord<Account>) -> LedgerResult<()>,
    ) -> LedgerResult<()>;
    fn stream_transaction_categories(
        &self,
        include_archived: bool,
        visitor: &mut dyn FnMut(StoredRecord<TransactionCategory>) -> LedgerResult<()>,
    ) -> LedgerResult<()>;
    fn stream_entries(
        &self,
        include_archived: bool,
        visitor: &mut dyn FnMut(EntryViewRecord) -> LedgerResult<()>,
    ) -> LedgerResult<()>;
    fn stream_audits(
        &self,
        visitor: &mut dyn FnMut(StoredAuditEvent) -> LedgerResult<()>,
    ) -> LedgerResult<()>;
    fn stream_transfer_operations(
        &self,
        visitor: &mut dyn FnMut(StoredTransferOperation) -> LedgerResult<()>,
    ) -> LedgerResult<()>;
}

/// Internal mutation capability. External callers use the service read surface;
/// application services are the sole mutation path.
pub(crate) trait LedgerMutationRepository: LedgerReadRepository {
    fn begin_transaction(&mut self) -> LedgerResult<Box<dyn LedgerTransaction + '_>>;
}
