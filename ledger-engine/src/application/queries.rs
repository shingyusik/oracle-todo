use std::collections::BTreeMap;

use serde::Serialize;

use crate::application::error::{LedgerError, LedgerResult};
use crate::application::lifecycle::validate_transfer_pair;
use crate::application::ports::{EntryQuery, LedgerRepository, MAX_PAGE_LIMIT, Page, Paged};
use crate::application::service::LedgerService;
use crate::domain::{
    Account, AccountCategory, Currency, EntryType, LedgerEntry, TransactionCategory,
};

pub(crate) const MAX_SCAN_RECORDS: usize = 100_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EntryView {
    pub entry: LedgerEntry,
    pub account_name: Option<String>,
    pub category_name: Option<String>,
    pub currency_code: Option<String>,
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

#[derive(Debug)]
pub(crate) struct ReadModel {
    pub currencies: Vec<Currency>,
    pub account_categories: Vec<AccountCategory>,
    pub accounts: Vec<Account>,
    pub transaction_categories: Vec<TransactionCategory>,
    currency_codes: BTreeMap<String, String>,
    account_names: BTreeMap<String, String>,
    transaction_category_names: BTreeMap<String, String>,
}

impl ReadModel {
    pub(crate) fn new(
        currencies: Vec<Currency>,
        account_categories: Vec<AccountCategory>,
        accounts: Vec<Account>,
        transaction_categories: Vec<TransactionCategory>,
    ) -> Self {
        let currency_codes = currencies
            .iter()
            .map(|currency| (currency.id().to_string(), currency.code().to_string()))
            .collect();
        let account_names = accounts
            .iter()
            .map(|account| (account.id().to_string(), account.name().to_string()))
            .collect();
        let transaction_category_names = transaction_categories
            .iter()
            .map(|category| (category.id().to_string(), category.name().to_string()))
            .collect();
        Self {
            currencies,
            account_categories,
            accounts,
            transaction_categories,
            currency_codes,
            account_names,
            transaction_category_names,
        }
    }

    pub(crate) fn currency_code(&self, id: &str) -> Option<&str> {
        self.currency_codes.get(id).map(String::as_str)
    }

    pub(crate) fn account_name(&self, id: &str) -> Option<&str> {
        self.account_names.get(id).map(String::as_str)
    }

    pub(crate) fn transaction_category_name(&self, id: &str) -> Option<&str> {
        self.transaction_category_names.get(id).map(String::as_str)
    }
}

impl<R: LedgerRepository> LedgerService<R> {
    pub fn query_entries(&self, query: EntryQuery) -> LedgerResult<Paged<EntryView>> {
        validate_query(&query)?;
        let model = load_read_model(&self.repository, true)?;
        let resolved = resolve_query(query, &model)?;
        let entries = self.repository.list_entries(&resolved)?;
        let items: Vec<_> = entries
            .into_iter()
            .map(|entry| entry_view(entry, &model))
            .collect();
        let next = if items.len() == usize::from(resolved.limit) {
            let offset = resolved
                .offset
                .checked_add(u32::from(resolved.limit))
                .ok_or_else(|| validation("page", "page offset exceeds the supported range"))?;
            let probe = self.repository.list_entries(&EntryQuery {
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
        let model = load_read_model(&self.repository, true)?;
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
        let out_view = entry_view(out, &model);
        let in_view = entry_view(input, &model);
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

pub(crate) fn load_read_model<R: LedgerRepository>(
    repository: &R,
    include_archived: bool,
) -> LedgerResult<ReadModel> {
    Ok(ReadModel::new(
        collect_pages(|page| repository.list_currencies(include_archived, page))?,
        collect_pages(|page| repository.list_account_categories(include_archived, page))?,
        collect_pages(|page| repository.list_accounts(include_archived, page))?,
        collect_pages(|page| repository.list_transaction_categories(include_archived, page))?,
    ))
}

pub(crate) fn collect_entries<R: LedgerRepository>(
    repository: &R,
    query: EntryQuery,
) -> LedgerResult<Vec<LedgerEntry>> {
    collect_pages(|page| {
        repository.list_entries(&EntryQuery {
            offset: page.offset,
            limit: page.limit,
            ..query.clone()
        })
    })
}

pub(crate) fn collect_pages<T>(
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
        if values.len().saturating_add(batch_len) > MAX_SCAN_RECORDS {
            return Err(LedgerError::Storage(format!(
                "read projection exceeds the {MAX_SCAN_RECORDS} record safety limit"
            )));
        }
        values.append(&mut batch);
        if batch_len < usize::from(MAX_PAGE_LIMIT) {
            break;
        }
        offset = offset
            .checked_add(u32::from(MAX_PAGE_LIMIT))
            .ok_or_else(|| validation("page", "page offset exceeds the supported range"))?;
    }
    Ok(values)
}

pub(crate) fn entry_view(entry: LedgerEntry, model: &ReadModel) -> EntryView {
    let account_name = model.account_name(entry.account_id()).map(str::to_string);
    let category_name = entry
        .transaction_category_id()
        .and_then(|id| model.transaction_category_name(id).map(str::to_string));
    let currency_code = model.currency_code(entry.currency_id()).map(str::to_string);
    EntryView {
        entry,
        account_name,
        category_name,
        currency_code,
    }
}

fn resolve_query(mut query: EntryQuery, model: &ReadModel) -> LedgerResult<EntryQuery> {
    query.account = query
        .account
        .as_deref()
        .map(|value| resolve_account(value, &model.accounts))
        .transpose()?;
    query.category = query
        .category
        .as_deref()
        .map(|value| resolve_category(value, &model.transaction_categories))
        .transpose()?;
    query.currency = query
        .currency
        .as_deref()
        .map(|value| resolve_currency(value, &model.currencies))
        .transpose()?;
    Ok(query)
}

fn resolve_account(value: &str, accounts: &[Account]) -> LedgerResult<String> {
    resolve_reference(
        value,
        "account",
        accounts
            .iter()
            .map(|account| (account.id(), account.name())),
    )
}

fn resolve_category(value: &str, categories: &[TransactionCategory]) -> LedgerResult<String> {
    resolve_reference(
        value,
        "transaction category",
        categories
            .iter()
            .map(|category| (category.id(), category.name())),
    )
}

fn resolve_currency(value: &str, currencies: &[Currency]) -> LedgerResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(validation(
            "currency",
            "currency reference must not be blank",
        ));
    }
    if let Some(currency) = currencies.iter().find(|currency| currency.id() == value) {
        return Ok(currency.id().to_string());
    }
    let matches: BTreeMap<_, _> = currencies
        .iter()
        .filter(|currency| currency.code() == value || currency.name() == value)
        .map(|currency| (currency.id(), currency))
        .collect();
    match matches.len() {
        0 => Err(LedgerError::NotFound(format!("currency {value}"))),
        1 => Ok(matches
            .into_values()
            .next()
            .expect("single currency match")
            .id()
            .to_string()),
        _ => Err(LedgerError::Conflict(format!(
            "currency reference {value} is ambiguous"
        ))),
    }
}

fn resolve_reference<'value>(
    value: &str,
    kind: &str,
    values: impl Iterator<Item = (&'value str, &'value str)>,
) -> LedgerResult<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(validation("reference", "reference must not be blank"));
    }
    let values: Vec<_> = values.collect();
    if let Some((id, _)) = values.iter().find(|(id, _)| *id == value) {
        return Ok((*id).to_string());
    }
    let matches: Vec<_> = values
        .iter()
        .filter(|(_, name)| *name == value)
        .map(|(id, _)| *id)
        .collect();
    match matches.as_slice() {
        [] => Err(LedgerError::NotFound(format!("{kind} {value}"))),
        [id] => Ok((*id).to_string()),
        _ => Err(LedgerError::Conflict(format!(
            "{kind} reference {value} is ambiguous"
        ))),
    }
}

fn validation(field: &'static str, message: &str) -> LedgerError {
    LedgerError::Validation {
        field,
        message: message.to_string(),
    }
}
