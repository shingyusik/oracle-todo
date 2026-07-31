use std::io::{self, Write};

use serde::Serialize;

use crate::application::error::{LedgerError, LedgerResult};
use crate::application::ports::{
    AuditEvent, LedgerExportSnapshot, LedgerReadRepository, StoredAuditEvent, StoredRecord,
    StoredTransferOperation,
};
use crate::application::queries::{EntryView, entry_view_from_record};
use crate::application::service::LedgerService;
use crate::domain::{Account, AccountCategory, Currency, TransactionCategory};

pub const EXPORT_SCHEMA_VERSION: u32 = 3;
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
pub struct ExportAuditEvent {
    pub sequence: i64,
    #[serde(flatten)]
    pub event: AuditEvent,
}

impl std::ops::Deref for ExportAuditEvent {
    type Target = AuditEvent;

    fn deref(&self) -> &Self::Target {
        &self.event
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
    pub audit_events: Vec<ExportAuditEvent>,
    pub transfer_operations: Vec<ExportTransferOperation>,
}

#[allow(private_bounds)]
impl<R: LedgerReadRepository> LedgerService<R> {
    /// Returns a deterministic, bounded structured export.
    ///
    /// Both passes use one SQLite read snapshot. The first pass serializes one
    /// row at a time into a counting writer, so no full intermediate payload is
    /// allocated before the exact byte and record limits pass. The second pass
    /// materializes the returned view from that unchanged snapshot.
    ///
    /// `include_archived = true` includes every durable row and marks the
    /// result restore-capable. Filtered exports are explicitly analytical.
    pub fn export(&self, options: ExportOptions) -> LedgerResult<ExportView> {
        validate_options(options)?;
        let snapshot = self.repository.begin_export_snapshot()?;
        validate_snapshot_size(&*snapshot, options)?;
        collect_snapshot(&*snapshot, options)
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

impl From<StoredAuditEvent> for ExportAuditEvent {
    fn from(value: StoredAuditEvent) -> Self {
        Self {
            sequence: value.sequence,
            event: value.event,
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

fn validate_snapshot_size(
    snapshot: &dyn LedgerExportSnapshot,
    options: ExportOptions,
) -> LedgerResult<()> {
    let mut writer = BoundedCounter::new(options.max_bytes);
    let mut budget = ExportBudget::new(options.max_records);

    write_bytes(&mut writer, br#"{"schema_version":3,"restore_capable":"#)?;
    write_bytes(
        &mut writer,
        if options.include_archived {
            b"true"
        } else {
            b"false"
        },
    )?;

    write_bytes(&mut writer, br#","currencies":"#)?;
    write_array(
        &mut writer,
        &mut budget,
        |visitor| snapshot.stream_currencies(options.include_archived, visitor),
        ExportRecord::from,
    )?;
    write_bytes(&mut writer, br#","account_categories":"#)?;
    write_array(
        &mut writer,
        &mut budget,
        |visitor| snapshot.stream_account_categories(options.include_archived, visitor),
        ExportRecord::from,
    )?;
    write_bytes(&mut writer, br#","accounts":"#)?;
    write_array(
        &mut writer,
        &mut budget,
        |visitor| snapshot.stream_accounts(options.include_archived, visitor),
        ExportRecord::from,
    )?;
    write_bytes(&mut writer, br#","transaction_categories":"#)?;
    write_array(
        &mut writer,
        &mut budget,
        |visitor| snapshot.stream_transaction_categories(options.include_archived, visitor),
        ExportRecord::from,
    )?;
    write_bytes(&mut writer, br#","entries":"#)?;
    write_array(
        &mut writer,
        &mut budget,
        |visitor| snapshot.stream_entries(options.include_archived, visitor),
        entry_view_from_record,
    )?;
    write_bytes(&mut writer, br#","audit_events":"#)?;
    write_array(
        &mut writer,
        &mut budget,
        |visitor| snapshot.stream_audits(visitor),
        ExportAuditEvent::from,
    )?;
    write_bytes(&mut writer, br#","transfer_operations":"#)?;
    write_array(
        &mut writer,
        &mut budget,
        |visitor| snapshot.stream_transfer_operations(visitor),
        ExportTransferOperation::from,
    )?;
    write_bytes(&mut writer, b"}")
}

fn write_array<T, U>(
    writer: &mut BoundedCounter,
    budget: &mut ExportBudget,
    stream: impl FnOnce(&mut dyn FnMut(T) -> LedgerResult<()>) -> LedgerResult<()>,
    mut map: impl FnMut(T) -> U,
) -> LedgerResult<()>
where
    U: Serialize,
{
    write_bytes(writer, b"[")?;
    let mut first = true;
    stream(&mut |record| {
        budget.record()?;
        if first {
            first = false;
        } else {
            write_bytes(writer, b",")?;
        }
        write_json(writer, &map(record))
    })?;
    write_bytes(writer, b"]")
}

fn write_json(writer: &mut BoundedCounter, value: &impl Serialize) -> LedgerResult<()> {
    serde_json::to_writer(&mut *writer, value).map_err(|_| writer.limit_error())
}

fn write_bytes(writer: &mut BoundedCounter, bytes: &[u8]) -> LedgerResult<()> {
    writer.write_all(bytes).map_err(|_| writer.limit_error())
}

fn collect_snapshot(
    snapshot: &dyn LedgerExportSnapshot,
    options: ExportOptions,
) -> LedgerResult<ExportView> {
    let mut currencies = Vec::new();
    snapshot.stream_currencies(options.include_archived, &mut |record| {
        currencies.push(ExportRecord::from(record));
        Ok(())
    })?;

    let mut account_categories = Vec::new();
    snapshot.stream_account_categories(options.include_archived, &mut |record| {
        account_categories.push(ExportRecord::from(record));
        Ok(())
    })?;

    let mut accounts = Vec::new();
    snapshot.stream_accounts(options.include_archived, &mut |record| {
        accounts.push(ExportRecord::from(record));
        Ok(())
    })?;

    let mut transaction_categories = Vec::new();
    snapshot.stream_transaction_categories(options.include_archived, &mut |record| {
        transaction_categories.push(ExportRecord::from(record));
        Ok(())
    })?;

    let mut entries = Vec::new();
    snapshot.stream_entries(options.include_archived, &mut |record| {
        entries.push(entry_view_from_record(record));
        Ok(())
    })?;

    let mut audit_events = Vec::new();
    snapshot.stream_audits(&mut |event| {
        audit_events.push(ExportAuditEvent::from(event));
        Ok(())
    })?;

    let mut transfer_operations = Vec::new();
    snapshot.stream_transfer_operations(&mut |operation| {
        transfer_operations.push(ExportTransferOperation::from(operation));
        Ok(())
    })?;

    Ok(ExportView {
        schema_version: EXPORT_SCHEMA_VERSION,
        restore_capable: options.include_archived,
        currencies,
        account_categories,
        accounts,
        transaction_categories,
        entries,
        audit_events,
        transfer_operations,
    })
}

struct ExportBudget {
    count: usize,
    limit: usize,
}

impl ExportBudget {
    const fn new(limit: usize) -> Self {
        Self { count: 0, limit }
    }

    fn record(&mut self) -> LedgerResult<()> {
        self.count = self
            .count
            .checked_add(1)
            .ok_or_else(|| LedgerError::Storage("export record count overflow".to_string()))?;
        if self.count > self.limit {
            return Err(LedgerError::Storage(format!(
                "export record limit {} exceeded at record {}",
                self.limit, self.count
            )));
        }
        Ok(())
    }
}

struct BoundedCounter {
    written: usize,
    limit: usize,
}

impl BoundedCounter {
    const fn new(limit: usize) -> Self {
        Self { written: 0, limit }
    }

    fn limit_error(&self) -> LedgerError {
        LedgerError::Storage(format!(
            "export byte limit {} exceeded after {} serialized bytes",
            self.limit, self.written
        ))
    }
}

impl Write for BoundedCounter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        let next = self
            .written
            .checked_add(buffer.len())
            .ok_or_else(|| io::Error::other("export byte count overflow"))?;
        if next > self.limit {
            return Err(io::Error::other("export byte limit exceeded"));
        }
        self.written = next;
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
