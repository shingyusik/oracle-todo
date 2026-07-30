use crate::application::error::{LedgerError, LedgerResult};
use crate::application::ports::{AuditEvent, EntryQuery, LedgerRepository, Page};
use crate::domain::{Account, Currency, LedgerEntry, TransactionCategory};

pub struct LedgerService<R> {
    pub(super) repository: R,
}

impl<R: LedgerRepository> LedgerService<R> {
    pub fn new(repository: R) -> Self {
        Self { repository }
    }

    pub fn get_entry(&self, id: &str) -> LedgerResult<LedgerEntry> {
        self.repository
            .get_entry(id, false)?
            .ok_or_else(|| LedgerError::NotFound(format!("ledger entry {id}")))
    }

    pub fn entries(&self) -> LedgerResult<Vec<LedgerEntry>> {
        self.repository.list_entries(&EntryQuery::default())
    }

    pub fn audit_for(&self, entry_id: &str) -> LedgerResult<Vec<AuditEvent>> {
        self.audit_for_type("ledger_entry", entry_id)
    }

    pub fn audit_for_type(
        &self,
        record_type: &str,
        record_id: &str,
    ) -> LedgerResult<Vec<AuditEvent>> {
        self.repository
            .list_audit_events(record_type, record_id, Page::default())
    }

    pub fn active_currencies(&self) -> LedgerResult<Vec<Currency>> {
        self.repository.list_active_currencies(Page::default())
    }

    pub fn active_accounts(&self) -> LedgerResult<Vec<Account>> {
        self.repository.list_active_accounts(Page::default())
    }

    pub fn active_categories(&self) -> LedgerResult<Vec<TransactionCategory>> {
        self.repository
            .list_active_transaction_categories(Page::default())
    }
}
