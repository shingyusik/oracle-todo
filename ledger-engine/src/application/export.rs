use serde::Serialize;
use time::format_description::well_known::Rfc3339;

use crate::application::error::{LedgerError, LedgerResult};
use crate::application::ports::{
    AuditEvent, AuditScanCursor, EntryScanCursor, LedgerReadRepository, MAX_PAGE_LIMIT,
    StoredRecord, StoredTransferOperation,
};
use crate::application::queries::{EntryView, entry_view_from_record};
use crate::application::service::LedgerService;
use crate::domain::{Account, AccountCategory, Currency, TransactionCategory};

pub const EXPORT_SCHEMA_VERSION: u32 = 2;
pub const DEFAULT_EXPORT_MAX_BYTES: usize = 64 * 1024 * 1024;
pub const DEFAULT_EXPORT_MAX_RECORDS: usize = 1_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExportOptions {
    pub include_archived: bool,
    pub max_records: usize,
    pub max_bytes: usize,
}

impl Default for ExportOptions {
    fn default() -> Self {
        Self {
            include_archived: false,
            max_records: DEFAULT_EXPORT_MAX_RECORDS,
            max_bytes: DEFAULT_EXPORT_MAX_BYTES,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ExportRecord<T> {
    #[serde(flatten)]
    pub record: T,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

impl<T> std::ops::Deref for ExportRecord<T> {
    type Target = T;

    fn deref(&self) -> &Self::Target {
        &self.record
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ExportTransferOperation {
    pub operation_key: String,
    pub payload_json: String,
    pub result_json: String,
    pub created_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ExportView {
    pub schema_version: u32,
    /// True only when archived rows are included, making every durable table complete.
    pub restore_capable: bool,
    pub currencies: Vec<ExportRecord<Currency>>,
    pub account_categories: Vec<ExportRecord<AccountCategory>>,
    pub accounts: Vec<ExportRecord<Account>>,
    pub transaction_categories: Vec<ExportRecord<TransactionCategory>>,
    pub entries: Vec<EntryView>,
    pub audit_events: Vec<AuditEvent>,
    pub transfer_operations: Vec<ExportTransferOperation>,
}

#[allow(private_bounds)]
impl<R: LedgerReadRepository> LedgerService<R> {
    /// Returns a deterministic, bounded structured export.
    ///
    /// `include_archived = true` includes every durable row and marks the
    /// result restore-capable. Filtered exports are explicitly analytical.
    pub fn export(&self, options: ExportOptions) -> LedgerResult<ExportView> {
        validate_options(options)?;
        let estimate = self.repository.export_estimate(options.include_archived)?;
        if estimate.record_count > options.max_records as u64 {
            return Err(LedgerError::Storage(format!(
                "export record limit {} exceeded by estimated {} records",
                options.max_records, estimate.record_count
            )));
        }
        if estimate.byte_count > options.max_bytes as u64 {
            return Err(LedgerError::Storage(format!(
                "export byte limit {} exceeded by estimated {} bytes",
                options.max_bytes, estimate.byte_count
            )));
        }

        let currencies = collect_by_id(|after| {
            self.repository
                .export_currencies_after(options.include_archived, after, MAX_PAGE_LIMIT)
        })?;
        let account_categories = collect_by_id(|after| {
            self.repository.export_account_categories_after(
                options.include_archived,
                after,
                MAX_PAGE_LIMIT,
            )
        })?;
        let accounts = collect_by_id(|after| {
            self.repository
                .export_accounts_after(options.include_archived, after, MAX_PAGE_LIMIT)
        })?;
        let transaction_categories = collect_by_id(|after| {
            self.repository.export_transaction_categories_after(
                options.include_archived,
                after,
                MAX_PAGE_LIMIT,
            )
        })?;

        let mut entries = Vec::new();
        let mut entry_cursor = None;
        loop {
            let batch = self.repository.export_entries_after(
                options.include_archived,
                entry_cursor.as_ref(),
                MAX_PAGE_LIMIT,
            )?;
            if batch.is_empty() {
                break;
            }
            let last = batch.last().expect("non-empty export entry batch");
            entry_cursor = Some(EntryScanCursor {
                date: last.entry.date().to_string(),
                written_at: last
                    .entry
                    .written_at()
                    .format(&Rfc3339)
                    .map_err(|error| LedgerError::Storage(error.to_string()))?,
                id: last.entry.id().to_string(),
            });
            entries.extend(batch.into_iter().map(entry_view_from_record));
        }

        let mut audit_events = Vec::new();
        let mut audit_cursor = None;
        loop {
            let batch = self
                .repository
                .export_audits_after(audit_cursor.as_ref(), MAX_PAGE_LIMIT)?;
            if batch.is_empty() {
                break;
            }
            let last = batch.last().expect("non-empty export audit batch");
            audit_cursor = Some(AuditScanCursor {
                occurred_at: last
                    .occurred_at
                    .format(&Rfc3339)
                    .map_err(|error| LedgerError::Storage(error.to_string()))?,
                id: last.id.clone(),
            });
            audit_events.extend(batch);
        }

        let transfer_operations = collect_operations(|after| {
            self.repository
                .export_transfer_operations_after(after, MAX_PAGE_LIMIT)
        })?;
        let view = ExportView {
            schema_version: EXPORT_SCHEMA_VERSION,
            restore_capable: options.include_archived,
            currencies: currencies.into_iter().map(ExportRecord::from).collect(),
            account_categories: account_categories
                .into_iter()
                .map(ExportRecord::from)
                .collect(),
            accounts: accounts.into_iter().map(ExportRecord::from).collect(),
            transaction_categories: transaction_categories
                .into_iter()
                .map(ExportRecord::from)
                .collect(),
            entries,
            audit_events,
            transfer_operations: transfer_operations
                .into_iter()
                .map(ExportTransferOperation::from)
                .collect(),
        };
        let exact_bytes = serde_json::to_vec(&view)
            .map_err(|error| LedgerError::Storage(error.to_string()))?
            .len();
        if exact_bytes > options.max_bytes {
            return Err(LedgerError::Storage(format!(
                "export byte limit {} exceeded by {exact_bytes} serialized bytes",
                options.max_bytes
            )));
        }
        Ok(view)
    }
}

impl<T> From<StoredRecord<T>> for ExportRecord<T> {
    fn from(value: StoredRecord<T>) -> Self {
        Self {
            record: value.record,
            created_at: value.created_at,
            updated_at: value.updated_at,
            deleted_at: value.deleted_at,
        }
    }
}

impl From<StoredTransferOperation> for ExportTransferOperation {
    fn from(value: StoredTransferOperation) -> Self {
        Self {
            operation_key: value.operation_key,
            payload_json: value.payload_json,
            result_json: value.result_json,
            created_at: value.created_at,
        }
    }
}

fn validate_options(options: ExportOptions) -> LedgerResult<()> {
    if options.max_records == 0 {
        return Err(LedgerError::Validation {
            field: "max_records",
            message: "export record limit must be positive".to_string(),
        });
    }
    if options.max_bytes == 0 {
        return Err(LedgerError::Validation {
            field: "max_bytes",
            message: "export byte limit must be positive".to_string(),
        });
    }
    Ok(())
}

fn collect_by_id<T>(
    mut fetch: impl FnMut(Option<&str>) -> LedgerResult<Vec<StoredRecord<T>>>,
) -> LedgerResult<Vec<StoredRecord<T>>>
where
    T: RecordId,
{
    let mut records = Vec::new();
    let mut after_id = None;
    loop {
        let batch = fetch(after_id.as_deref())?;
        if batch.is_empty() {
            break;
        }
        after_id = Some(
            batch
                .last()
                .expect("non-empty export master batch")
                .record
                .record_id()
                .to_string(),
        );
        records.extend(batch);
    }
    Ok(records)
}

fn collect_operations(
    mut fetch: impl FnMut(Option<&str>) -> LedgerResult<Vec<StoredTransferOperation>>,
) -> LedgerResult<Vec<StoredTransferOperation>> {
    let mut records = Vec::new();
    let mut after_key = None;
    loop {
        let batch = fetch(after_key.as_deref())?;
        if batch.is_empty() {
            break;
        }
        after_key = Some(
            batch
                .last()
                .expect("non-empty export operation batch")
                .operation_key
                .clone(),
        );
        records.extend(batch);
    }
    Ok(records)
}

trait RecordId {
    fn record_id(&self) -> &str;
}

impl RecordId for Currency {
    fn record_id(&self) -> &str {
        self.id()
    }
}

impl RecordId for AccountCategory {
    fn record_id(&self) -> &str {
        self.id()
    }
}

impl RecordId for Account {
    fn record_id(&self) -> &str {
        self.id()
    }
}

impl RecordId for TransactionCategory {
    fn record_id(&self) -> &str {
        self.id()
    }
}
