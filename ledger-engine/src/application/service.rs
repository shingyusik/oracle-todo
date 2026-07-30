use crate::application::error::{LedgerError, LedgerResult};
use crate::application::ports::{AuditEvent, EntryQuery, LedgerRepository, Page, Paged};
use crate::domain::{Account, AccountCategory, Currency, LedgerEntry, TransactionCategory};

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

    pub fn entries_page(&self, query: EntryQuery) -> LedgerResult<Paged<LedgerEntry>> {
        let requested = Page {
            offset: query.offset,
            limit: query.limit,
        };
        paged(requested, |page| {
            self.repository.list_entries(&EntryQuery {
                offset: page.offset,
                limit: page.limit,
                ..query.clone()
            })
        })
    }

    pub fn audit_page(
        &self,
        record_type: &str,
        record_id: &str,
        page: Page,
    ) -> LedgerResult<Paged<AuditEvent>> {
        paged(page, |page| {
            self.repository
                .list_audit_events(record_type, record_id, page)
        })
    }

    pub fn currencies_page(&self, page: Page) -> LedgerResult<Paged<Currency>> {
        paged(page, |page| self.repository.list_active_currencies(page))
    }

    pub fn account_categories_page(&self, page: Page) -> LedgerResult<Paged<AccountCategory>> {
        paged(page, |page| {
            self.repository.list_active_account_categories(page)
        })
    }

    pub fn accounts_page(&self, page: Page) -> LedgerResult<Paged<Account>> {
        paged(page, |page| self.repository.list_active_accounts(page))
    }

    pub fn transaction_categories_page(
        &self,
        page: Page,
    ) -> LedgerResult<Paged<TransactionCategory>> {
        paged(page, |page| {
            self.repository.list_active_transaction_categories(page)
        })
    }
}

fn paged<T>(
    page: Page,
    mut fetch: impl FnMut(Page) -> LedgerResult<Vec<T>>,
) -> LedgerResult<Paged<T>> {
    if page.limit == 0 {
        return Err(LedgerError::Validation {
            field: "page",
            message: "page limit must be greater than zero".to_string(),
        });
    }
    let items = fetch(page)?;
    let next = if items.len() == usize::from(page.limit) {
        let offset = page
            .offset
            .checked_add(u32::from(page.limit))
            .ok_or_else(|| LedgerError::Validation {
                field: "page",
                message: "page offset exceeds the supported range".to_string(),
            })?;
        let probe = fetch(Page { offset, limit: 1 })?;
        (!probe.is_empty()).then_some(Page {
            offset,
            limit: page.limit,
        })
    } else {
        None
    };
    Ok(Paged { items, next })
}
