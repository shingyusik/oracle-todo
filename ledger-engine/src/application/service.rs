use crate::application::error::{LedgerError, LedgerResult};
use crate::application::ports::{
    AuditEvent, EntryQuery, LedgerReadRepository, MAX_PAGE_LIMIT, Page, Paged,
};
use crate::application::queries::{EntryView, entry_view_from_record};
use crate::domain::{Account, AccountCategory, Currency, TransactionCategory};

pub struct LedgerService<R> {
    pub(super) repository: R,
}

#[allow(private_bounds)]
impl<R: LedgerReadRepository> LedgerService<R> {
    pub fn new(repository: R) -> Self {
        Self { repository }
    }

    pub fn get_entry(&self, id: &str) -> LedgerResult<EntryView> {
        self.repository
            .get_entry_view_record(id, false)?
            .map(entry_view_from_record)
            .ok_or_else(|| LedgerError::NotFound(format!("ledger entry {id}")))
    }

    pub fn entry_including_archived(&self, id: &str) -> LedgerResult<Option<EntryView>> {
        Ok(self
            .repository
            .get_entry_view_record(id, true)?
            .map(entry_view_from_record))
    }

    /// Returns the precision of the currency already preserved by an active entry.
    ///
    /// Historical master data is intentionally included: amount-only updates must
    /// remain possible after the referenced currency is deactivated or archived.
    pub fn entry_currency_precision(&self, id: &str) -> LedgerResult<u8> {
        let entry = self
            .repository
            .get_entry_view_record(id, false)?
            .ok_or_else(|| LedgerError::NotFound(format!("ledger entry {id}")))?;
        self.historical_currency_precision(entry.entry.currency_id())
    }

    /// Returns the precision of the currency already preserved by an account.
    ///
    /// Inactive accounts and historical currencies remain readable because this
    /// projection is only for parsing an amount on an existing account update.
    pub fn account_currency_precision(&self, id: &str) -> LedgerResult<u8> {
        let account = self
            .repository
            .get_account(id, false)?
            .ok_or_else(|| LedgerError::NotFound(format!("account {id}")))?;
        self.historical_currency_precision(account.currency_id())
    }

    /// Lists entries with validated filters and resolved master-data labels.
    pub fn entries_page(&self, query: EntryQuery) -> LedgerResult<Paged<EntryView>> {
        self.query_entries(query)
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

    fn historical_currency_precision(&self, id: &str) -> LedgerResult<u8> {
        self.repository
            .get_currency(id, true)?
            .map(|currency| currency.decimal_places())
            .ok_or_else(|| {
                LedgerError::Storage(format!(
                    "persisted ledger record references missing currency {id}"
                ))
            })
    }
}

pub(crate) fn paged<T>(
    page: Page,
    mut fetch: impl FnMut(Page) -> LedgerResult<Vec<T>>,
) -> LedgerResult<Paged<T>> {
    if page.limit == 0 || page.limit > MAX_PAGE_LIMIT {
        return Err(LedgerError::Validation {
            field: "page",
            message: format!("page limit must be between 1 and {MAX_PAGE_LIMIT}"),
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
