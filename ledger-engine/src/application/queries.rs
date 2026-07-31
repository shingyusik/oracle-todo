use serde::Serialize;

use crate::application::error::{LedgerError, LedgerResult};
use crate::application::lifecycle::validate_transfer_pair;
use crate::application::ports::{
    CandidateMatch, EntryQuery, EntryViewRecord, LedgerReadRepository, MAX_PAGE_LIMIT, Page, Paged,
};
use crate::application::service::LedgerService;
use crate::domain::{Account, Currency, EntryType, LedgerEntry, TransactionCategory};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EntryView {
    pub entry: LedgerEntry,
    pub account_name: Option<String>,
    pub category_name: Option<String>,
    pub currency_code: Option<String>,
}

impl std::ops::Deref for EntryView {
    type Target = LedgerEntry;

    fn deref(&self) -> &Self::Target {
        &self.entry
    }
}

impl PartialEq<LedgerEntry> for EntryView {
    fn eq(&self, other: &LedgerEntry) -> bool {
        self.entry == *other
    }
}

impl PartialEq<EntryView> for LedgerEntry {
    fn eq(&self, other: &EntryView) -> bool {
        *self == other.entry
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AccountBalanceView {
    pub account: Account,
    pub currency_code: String,
    pub current_balance_minor: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TransferView {
    pub transfer_group_id: String,
    pub out_entry: EntryView,
    pub in_entry: EntryView,
    pub amount_minor: i64,
    pub currency_code: Option<String>,
    pub from_account_name: Option<String>,
    pub to_account_name: Option<String>,
}

#[allow(private_bounds)]
impl<R: LedgerReadRepository> LedgerService<R> {
    pub fn query_entries(&self, query: EntryQuery) -> LedgerResult<Paged<EntryView>> {
        validate_query(&query)?;
        let resolved = resolve_query(&self.repository, query)?;
        let items: Vec<_> = self
            .repository
            .list_entry_view_records(&resolved)?
            .into_iter()
            .map(entry_view_from_record)
            .collect();
        let next = if items.len() == usize::from(resolved.limit) {
            let offset = resolved
                .offset
                .checked_add(u32::from(resolved.limit))
                .ok_or_else(|| validation("page", "page offset exceeds the supported range"))?;
            let probe = self.repository.list_entry_view_records(&EntryQuery {
                offset,
                limit: 1,
                ..resolved.clone()
            })?;
            (!probe.is_empty()).then_some(Page {
                offset,
                limit: resolved.limit,
            })
        } else {
            None
        };
        Ok(Paged { items, next })
    }

    pub fn show_transfer(&self, transfer_group_id: &str) -> LedgerResult<TransferView> {
        let entries = self
            .repository
            .list_entries_by_transfer_group(transfer_group_id, false)?;
        if entries.is_empty() {
            return Err(LedgerError::NotFound(format!(
                "transfer group {transfer_group_id}"
            )));
        }
        validate_transfer_pair(transfer_group_id, &entries)?;
        let out = entries
            .iter()
            .find(|entry| entry.entry_type() == EntryType::TransferOut)
            .cloned()
            .ok_or_else(|| LedgerError::Conflict("transfer pair has no out entry".to_string()))?;
        let input = entries
            .iter()
            .find(|entry| entry.entry_type() == EntryType::TransferIn)
            .cloned()
            .ok_or_else(|| LedgerError::Conflict("transfer pair has no in entry".to_string()))?;
        let out_view = self
            .repository
            .get_entry_view_record(out.id(), false)?
            .map(entry_view_from_record)
            .ok_or_else(|| LedgerError::NotFound(format!("ledger entry {}", out.id())))?;
        let in_view = self
            .repository
            .get_entry_view_record(input.id(), false)?
            .map(entry_view_from_record)
            .ok_or_else(|| LedgerError::NotFound(format!("ledger entry {}", input.id())))?;
        Ok(TransferView {
            transfer_group_id: transfer_group_id.to_string(),
            amount_minor: out_view.entry.amount().minor_units(),
            currency_code: out_view.currency_code.clone(),
            from_account_name: out_view.account_name.clone(),
            to_account_name: in_view.account_name.clone(),
            out_entry: out_view,
            in_entry: in_view,
        })
    }

    pub fn account_balances_page(&self, page: Page) -> LedgerResult<Paged<AccountBalanceView>> {
        crate::application::service::paged(page, |page| {
            self.repository
                .list_account_balance_records(page)?
                .into_iter()
                .map(|record| {
                    if record.currency_mismatch_count != 0 {
                        return Err(LedgerError::Storage(format!(
                            "account {} has entries in another currency",
                            record.account.id()
                        )));
                    }
                    let current_balance_minor = record
                        .account
                        .opening_balance()
                        .minor_units()
                        .checked_add(record.movement_minor)
                        .ok_or_else(|| {
                            LedgerError::Storage(format!(
                                "account {} balance overflows minor-unit range",
                                record.account.id()
                            ))
                        })?;
                    Ok(AccountBalanceView {
                        account: record.account,
                        currency_code: record.currency_code,
                        current_balance_minor,
                    })
                })
                .collect()
        })
    }
}

pub(crate) fn validate_query(query: &EntryQuery) -> LedgerResult<()> {
    if query.limit == 0 || query.limit > MAX_PAGE_LIMIT {
        return Err(validation(
            "page",
            &format!("page limit must be between 1 and {MAX_PAGE_LIMIT}"),
        ));
    }
    if query
        .date_from
        .zip(query.date_to)
        .is_some_and(|(from, to)| from > to)
    {
        return Err(validation(
            "date_range",
            "date_from must be on or before date_to",
        ));
    }
    if query
        .content
        .as_deref()
        .is_some_and(|value| value.is_empty())
    {
        return Err(validation("content", "content search must not be empty"));
    }
    Ok(())
}

pub(crate) fn entry_view_from_record(record: EntryViewRecord) -> EntryView {
    EntryView {
        entry: record.entry,
        account_name: record.account_name,
        category_name: record.category_name,
        currency_code: record.currency_code,
    }
}

fn resolve_query<R: LedgerReadRepository>(
    repository: &R,
    mut query: EntryQuery,
) -> LedgerResult<EntryQuery> {
    query.account = query
        .account
        .as_deref()
        .map(|value| resolve_account(repository, value))
        .transpose()?;
    query.category = query
        .category
        .as_deref()
        .map(|value| resolve_category(repository, value))
        .transpose()?;
    query.currency = query
        .currency
        .as_deref()
        .map(|value| resolve_currency(repository, value))
        .transpose()?;
    Ok(query)
}

fn resolve_account<R: LedgerReadRepository>(repository: &R, value: &str) -> LedgerResult<String> {
    let value = validated_reference(value, "reference")?;
    if let Some(account) = repository.get_account(value, true)? {
        return Ok(account.id().to_string());
    }
    candidate_id(repository.account_by_name(value, true)?, "account", value)
}

fn resolve_category<R: LedgerReadRepository>(repository: &R, value: &str) -> LedgerResult<String> {
    let value = validated_reference(value, "reference")?;
    if let Some(category) = repository.get_transaction_category(value, true)? {
        return Ok(category.id().to_string());
    }
    candidate_id(
        repository.transaction_category_by_name(value, true)?,
        "transaction category",
        value,
    )
}

fn resolve_currency<R: LedgerReadRepository>(repository: &R, value: &str) -> LedgerResult<String> {
    let value = validated_reference(value, "currency")?;
    if let Some(currency) = repository.get_currency(value, true)? {
        return Ok(currency.id().to_string());
    }
    candidate_id(
        repository.currency_by_code_or_name(value, true)?,
        "currency",
        value,
    )
}

fn candidate_id<T>(candidate: CandidateMatch<T>, kind: &str, value: &str) -> LedgerResult<String>
where
    T: RecordId,
{
    match candidate {
        CandidateMatch::None => Err(LedgerError::NotFound(format!("{kind} {value}"))),
        CandidateMatch::One(record) => Ok(record.record_id().to_string()),
        CandidateMatch::Ambiguous => Err(LedgerError::Conflict(format!(
            "{kind} reference {value} is ambiguous"
        ))),
    }
}

trait RecordId {
    fn record_id(&self) -> &str;
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

impl RecordId for Currency {
    fn record_id(&self) -> &str {
        self.id()
    }
}

fn validated_reference<'value>(
    value: &'value str,
    field: &'static str,
) -> LedgerResult<&'value str> {
    let value = value.trim();
    if value.is_empty() {
        return Err(validation(field, "reference must not be blank"));
    }
    Ok(value)
}

fn validation(field: &'static str, message: &str) -> LedgerError {
    LedgerError::Validation {
        field,
        message: message.to_string(),
    }
}
