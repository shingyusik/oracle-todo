use serde::Serialize;

use crate::application::error::{LedgerError, LedgerResult};
use crate::application::ports::{AuditEvent, EntryQuery, LedgerRepository, MAX_PAGE_LIMIT, Page};
use crate::application::queries::{EntryView, MAX_SCAN_RECORDS, ReadModel, entry_view};
use crate::application::service::LedgerService;
use crate::domain::{Account, AccountCategory, Currency, TransactionCategory};

pub const EXPORT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ExportOptions {
    pub include_archived: bool,
    pub max_records: usize,
}

impl Default for ExportOptions {
    fn default() -> Self {
        Self {
            include_archived: false,
            max_records: MAX_SCAN_RECORDS,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ExportView {
    pub schema_version: u32,
    pub currencies: Vec<Currency>,
    pub account_categories: Vec<AccountCategory>,
    pub accounts: Vec<Account>,
    pub transaction_categories: Vec<TransactionCategory>,
    pub entries: Vec<EntryView>,
    pub audit_events: Vec<AuditEvent>,
}

impl<R: LedgerRepository> LedgerService<R> {
    pub fn export(&self, options: ExportOptions) -> LedgerResult<ExportView> {
        if options.max_records == 0 || options.max_records > MAX_SCAN_RECORDS {
            return Err(LedgerError::Validation {
                field: "max_records",
                message: format!("export record limit must be between 1 and {MAX_SCAN_RECORDS}"),
            });
        }
        let mut record_count = 0;
        let currencies = collect_export_pages(&mut record_count, options.max_records, |page| {
            self.repository
                .list_currencies(options.include_archived, page)
        })?;
        let account_categories =
            collect_export_pages(&mut record_count, options.max_records, |page| {
                self.repository
                    .list_account_categories(options.include_archived, page)
            })?;
        let accounts = collect_export_pages(&mut record_count, options.max_records, |page| {
            self.repository
                .list_accounts(options.include_archived, page)
        })?;
        let transaction_categories =
            collect_export_pages(&mut record_count, options.max_records, |page| {
                self.repository
                    .list_transaction_categories(options.include_archived, page)
            })?;
        let entry_query = EntryQuery {
            include_archived: options.include_archived,
            ..EntryQuery::default()
        };
        let entries = collect_export_pages(&mut record_count, options.max_records, |page| {
            self.repository.list_entries(&EntryQuery {
                offset: page.offset,
                limit: page.limit,
                ..entry_query.clone()
            })
        })?;
        let audit_events = collect_export_pages(&mut record_count, options.max_records, |page| {
            self.repository.list_all_audit_events(page)
        })?;
        let model = ReadModel::new(
            currencies,
            account_categories,
            accounts,
            transaction_categories,
        );
        let entries = entries
            .into_iter()
            .map(|entry| entry_view(entry, &model))
            .collect();
        Ok(ExportView {
            schema_version: EXPORT_SCHEMA_VERSION,
            currencies: model.currencies,
            account_categories: model.account_categories,
            accounts: model.accounts,
            transaction_categories: model.transaction_categories,
            entries,
            audit_events,
        })
    }
}

fn collect_export_pages<T>(
    record_count: &mut usize,
    max_records: usize,
    mut fetch: impl FnMut(Page) -> LedgerResult<Vec<T>>,
) -> LedgerResult<Vec<T>> {
    let mut values = Vec::new();
    let mut offset = 0_u32;
    loop {
        let page = Page {
            offset,
            limit: MAX_PAGE_LIMIT,
        };
        let mut batch = fetch(page)?;
        let batch_len = batch.len();
        let next_count = record_count.saturating_add(batch_len);
        if next_count > max_records {
            return Err(LedgerError::Storage(format!(
                "export record limit {max_records} exceeded"
            )));
        }
        *record_count = next_count;
        values.append(&mut batch);
        if batch_len < usize::from(MAX_PAGE_LIMIT) {
            break;
        }
        offset = offset
            .checked_add(u32::from(MAX_PAGE_LIMIT))
            .ok_or_else(|| LedgerError::Storage("export pagination offset overflow".to_string()))?;
    }
    Ok(values)
}
