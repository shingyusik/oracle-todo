use axum::extract::rejection::{JsonRejection, QueryRejection};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use ledger_engine::application::commands::{
    CreateAccount, CreateAccountCategory, CreateCurrency, CreateEntry, CreateTransactionCategory,
    UpdateAccount, UpdateAccountCategory, UpdateCurrency, UpdateEntry, UpdateTransactionCategory,
};
use ledger_engine::application::ports::{EntryQuery, Page};
use ledger_engine::application::reports::{ReportPeriod, ReportRange, TrendGranularity, YearMonth};
use ledger_engine::application::service::LedgerService;
use ledger_engine::application::transfers::{
    TransferCommand, TransferOperationKey, UpdateTransferCommand,
};
use ledger_engine::domain::Money;
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;
use serde::Deserialize;
use serde_json::{Value, json};
use time::{Date, OffsetDateTime};

use crate::dto::ledger::{
    CreateAccountBody, CreateAccountCategoryBody, CreateCategoryBody, CreateCurrencyBody,
    CreateEntryBody, PageBody, PurgeBody, TransferBody, UpdateAccountBody,
    UpdateAccountCategoryBody, UpdateCategoryBody, UpdateCurrencyBody, UpdateEntryBody,
    UpdateTransferBody,
};
use crate::{ApiError, RavenApiState};

const MAX_BODY_BYTES: usize = 128 * 1024;

pub fn router() -> Router<RavenApiState> {
    Router::new()
        .route("/entries", get(list_entries).post(create_entry))
        .route("/entries/:id", get(get_entry).patch(update_entry))
        .route("/entries/:id/archive", post(archive_entry))
        .route("/entries/:id/restore", post(restore_entry))
        .route(
            "/entries/:id/purge",
            get(preview_purge_entry).delete(purge_entry),
        )
        .route("/transfers", post(create_transfer))
        .route("/transfers/:id", get(get_transfer).patch(update_transfer))
        .route("/currencies", get(list_currencies).post(create_currency))
        .route(
            "/currencies/:id",
            patch(update_currency).delete(purge_currency),
        )
        .route("/currencies/:id/purge", get(preview_purge_currency))
        .route(
            "/account-categories",
            get(list_account_categories).post(create_account_category),
        )
        .route(
            "/account-categories/:id",
            patch(update_account_category).delete(purge_account_category),
        )
        .route(
            "/account-categories/:id/purge",
            get(preview_purge_account_category),
        )
        .route("/accounts", get(list_accounts).post(create_account))
        .route("/accounts/:id", patch(update_account).delete(purge_account))
        .route("/accounts/:id/purge", get(preview_purge_account))
        .route(
            "/transaction-categories",
            get(list_categories).post(create_category),
        )
        .route(
            "/transaction-categories/:id",
            patch(update_category).delete(purge_category),
        )
        .route(
            "/transaction-categories/:id/purge",
            get(preview_purge_category),
        )
        .route("/account-balances", get(account_balances))
        .route("/audit/:record_type/:record_id", get(audit))
        .route("/reports/summary", get(report_summary))
        .route("/reports/accounts", get(report_accounts))
        .route("/reports/categories", get(report_categories))
        .route("/reports/compare", get(report_compare))
        .route("/reports/trend", get(report_trend))
        .route("/reports/briefing", get(report_briefing))
        .layer(axum::extract::DefaultBodyLimit::max(MAX_BODY_BYTES))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PageQuery {
    #[serde(default)]
    offset: u32,
    #[serde(default = "default_limit")]
    limit: u16,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EntriesQuery {
    date_from: Option<String>,
    date_to: Option<String>,
    entry_type: Option<ledger_engine::domain::EntryType>,
    account: Option<String>,
    category: Option<String>,
    currency: Option<String>,
    content: Option<String>,
    #[serde(default)]
    include_archived: bool,
    #[serde(default)]
    offset: u32,
    #[serde(default = "default_limit")]
    limit: u16,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReportQuery {
    from: Option<String>,
    to: Option<String>,
    year: Option<i32>,
    month: Option<u8>,
}

enum ReportSelector {
    Month(YearMonth),
    Range(ReportRange),
}

impl ReportQuery {
    fn selector(self) -> Result<ReportSelector, ApiError> {
        match (self.year, self.month, self.from, self.to) {
            (Some(year), Some(month), None, None) => {
                Ok(ReportSelector::Month(YearMonth::new(year, month)?))
            }
            (None, None, Some(from), Some(to)) => Ok(ReportSelector::Range(range(&from, &to)?)),
            _ => Err(ApiError::validation(None)),
        }
    }

    fn range(self) -> Result<ReportRange, ApiError> {
        match self.selector()? {
            ReportSelector::Range(range) => Ok(range),
            ReportSelector::Month(_) => Err(ApiError::validation(None)),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CompareQuery {
    period: Option<ComparePeriod>,
    from: Option<String>,
    to: Option<String>,
    current_from: Option<String>,
    current_to: Option<String>,
    previous_from: Option<String>,
    previous_to: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ComparePeriod {
    CurrentMonth,
    PreviousMonth,
    CurrentYear,
    Custom,
}

impl CompareQuery {
    fn ranges(self, as_of: Date) -> Result<(ReportRange, ReportRange), ApiError> {
        match self {
            Self {
                period: None,
                from: None,
                to: None,
                current_from: Some(current_from),
                current_to: Some(current_to),
                previous_from: Some(previous_from),
                previous_to: Some(previous_to),
            } => Ok((
                range(&current_from, &current_to)?,
                range(&previous_from, &previous_to)?,
            )),
            Self {
                period: Some(period),
                from,
                to,
                current_from: None,
                current_to: None,
                previous_from: None,
                previous_to: None,
            } => {
                let period = match (period, from, to) {
                    (ComparePeriod::CurrentMonth, None, None) => ReportPeriod::CurrentMonth,
                    (ComparePeriod::PreviousMonth, None, None) => ReportPeriod::PreviousMonth,
                    (ComparePeriod::CurrentYear, None, None) => ReportPeriod::CurrentYear,
                    (ComparePeriod::Custom, Some(from), Some(to)) => {
                        ReportPeriod::Custom(range(&from, &to)?)
                    }
                    _ => return Err(ApiError::validation(None)),
                };
                period.comparison_ranges(as_of).map_err(Into::into)
            }
            _ => Err(ApiError::validation(None)),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrendQuery {
    from: String,
    to: String,
    granularity: Option<TrendGranularityQuery>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum TrendGranularityQuery {
    Auto,
    Daily,
    Weekly,
    Monthly,
}

impl TrendGranularityQuery {
    const fn explicit(self) -> Option<TrendGranularity> {
        match self {
            Self::Auto => None,
            Self::Daily => Some(TrendGranularity::Daily),
            Self::Weekly => Some(TrendGranularity::Weekly),
            Self::Monthly => Some(TrendGranularity::Monthly),
        }
    }
}

async fn list_entries(
    State(state): State<RavenApiState>,
    query: Result<Query<EntriesQuery>, QueryRejection>,
) -> Result<Json<Value>, ApiError> {
    let query = query_value(query)?;
    let query = EntryQuery {
        date_from: parse_optional_date(query.date_from.as_deref(), "date_from")?,
        date_to: parse_optional_date(query.date_to.as_deref(), "date_to")?,
        entry_type: query.entry_type,
        account: query.account,
        category: query.category,
        currency: query.currency,
        content: query.content,
        include_archived: query.include_archived,
        offset: query.offset,
        limit: query.limit,
    };
    let page = ledger(&state, move |service| service.entries_page(query)).await?;
    Ok(Json(json!({
        "items": page.items,
        "next_offset": page.next.map(|page| page.offset)
    })))
}

async fn get_entry(
    State(state): State<RavenApiState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let entry = ledger(&state, move |service| service.get_entry(&id)).await?;
    Ok(Json(json!(entry)))
}

async fn create_entry(
    State(state): State<RavenApiState>,
    body: Result<Json<CreateEntryBody>, JsonRejection>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let body = json_value(body)?;
    let written_at = parse_time(&body.written_at, "written_at")?;
    let entry = ledger(&state, move |service| {
        let precision = service.resolve_active_currency_precision(&body.currency)?;
        let amount = parse_money(&body.amount, precision, "amount")?;
        service.create_entry(CreateEntry {
            date: body.date,
            written_at,
            content: body.content,
            category: body.category,
            account: body.account,
            entry_type: body.entry_type.into(),
            amount,
            currency: body.currency,
            transfer_group: None,
            source: body.source,
            notes: body.notes,
            actor: body.actor,
        })
    })
    .await?;
    Ok((StatusCode::CREATED, Json(json!(entry))))
}

async fn update_entry(
    State(state): State<RavenApiState>,
    Path(id): Path<String>,
    body: Result<Json<UpdateEntryBody>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    let body = json_value(body)?;
    let written_at = body
        .written_at
        .as_deref()
        .map(|value| parse_time(value, "written_at"))
        .transpose()?;
    let entry = ledger(&state, move |service| {
        let amount = body
            .amount
            .as_deref()
            .map(|value| {
                let precision = match body.currency.as_deref() {
                    Some(currency) => service.resolve_active_currency_precision(currency)?,
                    None => service.entry_currency_precision(&id)?,
                };
                parse_money(value, precision, "amount")
            })
            .transpose()?;
        service.update_entry(
            &id,
            UpdateEntry {
                date: body.date,
                written_at,
                content: body.content,
                category: body.category.optional(),
                account: body.account,
                entry_type: body.entry_type.map(Into::into),
                amount,
                currency: body.currency,
                transfer_group: None,
                source: body.source,
                notes: body.notes.optional(),
                actor: body.actor,
                reason: body.reason,
            },
        )
    })
    .await?;
    Ok(Json(json!(entry)))
}

async fn archive_entry(
    State(state): State<RavenApiState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let entry = ledger(&state, move |service| service.archive_entry(&id)).await?;
    Ok(Json(json!(entry)))
}

async fn restore_entry(
    State(state): State<RavenApiState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let entry = ledger(&state, move |service| service.restore_entry(&id)).await?;
    Ok(Json(json!(entry)))
}

async fn purge_entry(
    State(state): State<RavenApiState>,
    Path(id): Path<String>,
    body: Result<Json<PurgeBody>, JsonRejection>,
) -> Result<StatusCode, ApiError> {
    let body = json_value(body)?;
    ledger(&state, move |service| {
        service.purge_entry(&id, &body.confirmation)
    })
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn preview_purge_entry(
    State(state): State<RavenApiState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let preview = ledger(&state, move |service| service.purge_entry_preview(&id)).await?;
    Ok(Json(json!({
        "confirmation_id": preview.confirmation_id,
        "transfer_group_id": preview.transfer_group_id,
        "entry_ids": preview.entry_ids,
    })))
}

async fn create_transfer(
    State(state): State<RavenApiState>,
    body: Result<Json<TransferBody>, JsonRejection>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let body = json_value(body)?;
    let written_at = parse_time(&body.written_at, "written_at")?;
    let operation_key = TransferOperationKey::parse(&body.operation_key)?;
    let transfer = ledger(&state, move |service| {
        let precision = service.resolve_active_currency_precision(&body.currency)?;
        let amount = parse_money(&body.amount, precision, "amount")?;
        service.transfer(TransferCommand {
            operation_key,
            date: body.date,
            written_at,
            content: body.content,
            from_account: body.from_account,
            to_account: body.to_account,
            amount,
            currency: body.currency,
            source: body.source,
            notes: body.notes,
            actor: body.actor,
        })
    })
    .await?;
    Ok((StatusCode::CREATED, Json(json!(transfer))))
}

async fn get_transfer(
    State(state): State<RavenApiState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let transfer = ledger(&state, move |service| service.show_transfer(&id)).await?;
    Ok(Json(json!(transfer)))
}

async fn update_transfer(
    State(state): State<RavenApiState>,
    Path(id): Path<String>,
    body: Result<Json<UpdateTransferBody>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    let body = json_value(body)?;
    let transfer = ledger(&state, move |service| {
        let precision = service.resolve_active_currency_precision(&body.currency)?;
        let amount = parse_money(&body.amount, precision, "amount")?;
        service.update_transfer(
            &id,
            UpdateTransferCommand {
                date: body.date,
                content: body.content,
                from_account: body.from_account,
                to_account: body.to_account,
                amount,
                currency: body.currency,
                notes: body.notes,
                actor: body.actor,
                reason: body.reason,
            },
        )
    })
    .await?;
    Ok(Json(json!(transfer)))
}

async fn create_currency(
    State(state): State<RavenApiState>,
    body: Result<Json<CreateCurrencyBody>, JsonRejection>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let body = json_value(body)?;
    let value = ledger(&state, move |service| {
        service.create_currency(CreateCurrency {
            code: body.code,
            name: body.name,
            symbol: body.symbol,
            decimal_places: body.decimal_places,
            actor: body.actor,
        })
    })
    .await?;
    Ok((StatusCode::CREATED, Json(json!(value))))
}

async fn update_currency(
    State(state): State<RavenApiState>,
    Path(id): Path<String>,
    body: Result<Json<UpdateCurrencyBody>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    let body = json_value(body)?;
    let value = ledger(&state, move |service| {
        service.update_currency(
            &id,
            UpdateCurrency {
                code: body.code,
                name: body.name,
                symbol: body.symbol,
                decimal_places: body.decimal_places,
                active: body.active,
                actor: body.actor,
                reason: body.reason,
            },
        )
    })
    .await?;
    Ok(Json(json!(value)))
}

async fn create_account_category(
    State(state): State<RavenApiState>,
    body: Result<Json<CreateAccountCategoryBody>, JsonRejection>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let body = json_value(body)?;
    let value = ledger(&state, move |service| {
        service.create_account_category(CreateAccountCategory {
            name: body.name,
            parent: body.parent,
            liability: body.liability,
            actor: body.actor,
        })
    })
    .await?;
    Ok((StatusCode::CREATED, Json(json!(value))))
}

async fn update_account_category(
    State(state): State<RavenApiState>,
    Path(id): Path<String>,
    body: Result<Json<UpdateAccountCategoryBody>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    let body = json_value(body)?;
    let value = ledger(&state, move |service| {
        service.update_account_category(
            &id,
            UpdateAccountCategory {
                name: body.name,
                parent: body.parent.optional(),
                liability: body.liability,
                active: body.active,
                actor: body.actor,
                reason: body.reason,
            },
        )
    })
    .await?;
    Ok(Json(json!(value)))
}

async fn create_account(
    State(state): State<RavenApiState>,
    body: Result<Json<CreateAccountBody>, JsonRejection>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let body = json_value(body)?;
    let value = ledger(&state, move |service| {
        let precision = service.resolve_active_currency_precision(&body.currency)?;
        let opening_balance = parse_money(&body.opening_balance, precision, "opening_balance")?;
        service.create_account(CreateAccount {
            name: body.name,
            category: body.category,
            currency: body.currency,
            opening_balance,
            actor: body.actor,
        })
    })
    .await?;
    Ok((StatusCode::CREATED, Json(json!(value))))
}

async fn update_account(
    State(state): State<RavenApiState>,
    Path(id): Path<String>,
    body: Result<Json<UpdateAccountBody>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    let body = json_value(body)?;
    let value = ledger(&state, move |service| {
        let opening_balance = body
            .opening_balance
            .as_deref()
            .map(|value| {
                let precision = match body.currency.as_deref() {
                    Some(currency) => service.resolve_active_currency_precision(currency)?,
                    None => service.account_currency_precision(&id)?,
                };
                parse_money(value, precision, "opening_balance")
            })
            .transpose()?;
        service.update_account(
            &id,
            UpdateAccount {
                name: body.name,
                category: body.category,
                currency: body.currency,
                opening_balance,
                active: body.active,
                actor: body.actor,
                reason: body.reason,
            },
        )
    })
    .await?;
    Ok(Json(json!(value)))
}

async fn create_category(
    State(state): State<RavenApiState>,
    body: Result<Json<CreateCategoryBody>, JsonRejection>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let body = json_value(body)?;
    let value = ledger(&state, move |service| {
        service.create_category(CreateTransactionCategory {
            name: body.name,
            parent: body.parent,
            kind: body.kind,
            actor: body.actor,
        })
    })
    .await?;
    Ok((StatusCode::CREATED, Json(json!(value))))
}

async fn update_category(
    State(state): State<RavenApiState>,
    Path(id): Path<String>,
    body: Result<Json<UpdateCategoryBody>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    let body = json_value(body)?;
    let value = ledger(&state, move |service| {
        service.update_category(
            &id,
            UpdateTransactionCategory {
                name: body.name,
                parent: body.parent.optional(),
                kind: body.kind,
                active: body.active,
                actor: body.actor,
                reason: body.reason,
            },
        )
    })
    .await?;
    Ok(Json(json!(value)))
}

macro_rules! purge_master {
    ($name:ident, $method:ident) => {
        async fn $name(
            State(state): State<RavenApiState>,
            Path(id): Path<String>,
            body: Result<Json<PurgeBody>, JsonRejection>,
        ) -> Result<StatusCode, ApiError> {
            let body = json_value(body)?;
            ledger(&state, move |service| {
                service.$method(&id, &body.confirmation)
            })
            .await?;
            Ok(StatusCode::NO_CONTENT)
        }
    };
}

purge_master!(purge_currency, purge_currency);
purge_master!(purge_account_category, purge_account_category);
purge_master!(purge_account, purge_account);
purge_master!(purge_category, purge_category);

macro_rules! preview_master {
    ($name:ident, $method:ident) => {
        async fn $name(
            State(state): State<RavenApiState>,
            Path(id): Path<String>,
        ) -> Result<Json<Value>, ApiError> {
            let preview = ledger(&state, move |service| service.$method(&id)).await?;
            Ok(Json(json!({
                "confirmation_id": preview.confirmation_id,
                "record_type": preview.record_type,
            })))
        }
    };
}

preview_master!(preview_purge_currency, purge_currency_preview);
preview_master!(
    preview_purge_account_category,
    purge_account_category_preview
);
preview_master!(preview_purge_account, purge_account_preview);
preview_master!(preview_purge_category, purge_category_preview);

macro_rules! page_handler {
    ($name:ident, $method:ident) => {
        async fn $name(
            State(state): State<RavenApiState>,
            query: Result<Query<PageQuery>, QueryRejection>,
        ) -> Result<Json<Value>, ApiError> {
            let query = query_value(query)?;
            let page = checked_page(query.offset, query.limit)?;
            let result = ledger(&state, move |service| service.$method(page)).await?;
            Ok(Json(json!(PageBody {
                items: result.items,
                next_offset: result.next.map(|page| page.offset),
            })))
        }
    };
}

page_handler!(list_currencies, currencies_page);
page_handler!(list_account_categories, account_categories_page);
page_handler!(list_accounts, accounts_page);
page_handler!(list_categories, transaction_categories_page);
page_handler!(account_balances, account_balances_page);

async fn audit(
    State(state): State<RavenApiState>,
    Path((record_type, record_id)): Path<(String, String)>,
    query: Result<Query<PageQuery>, QueryRejection>,
) -> Result<Json<Value>, ApiError> {
    let query = query_value(query)?;
    let page = checked_page(query.offset, query.limit)?;
    let result = ledger(&state, move |service| {
        service.audit_page(&record_type, &record_id, page)
    })
    .await?;
    Ok(Json(json!(PageBody {
        items: result.items,
        next_offset: result.next.map(|page| page.offset),
    })))
}

async fn report_summary(
    State(state): State<RavenApiState>,
    query: Result<Query<ReportQuery>, QueryRejection>,
) -> Result<Json<Value>, ApiError> {
    match query_value(query)?.selector()? {
        ReportSelector::Month(month) => Ok(Json(json!(
            ledger(&state, move |service| service.monthly_summary(month)).await?
        ))),
        ReportSelector::Range(range) => Ok(Json(json!(
            ledger(&state, move |service| service.summary(range)).await?
        ))),
    }
}

async fn report_accounts(
    State(state): State<RavenApiState>,
    query: Result<Query<ReportQuery>, QueryRejection>,
) -> Result<Json<Value>, ApiError> {
    let range = query_value(query)?.range()?;
    Ok(Json(json!(
        ledger(&state, move |service| service.account_breakdown(range)).await?
    )))
}

async fn report_categories(
    State(state): State<RavenApiState>,
    query: Result<Query<ReportQuery>, QueryRejection>,
) -> Result<Json<Value>, ApiError> {
    let range = query_value(query)?.range()?;
    Ok(Json(json!(
        ledger(&state, move |service| service.category_breakdown(range)).await?
    )))
}

async fn report_compare(
    State(state): State<RavenApiState>,
    query: Result<Query<CompareQuery>, QueryRejection>,
) -> Result<Json<Value>, ApiError> {
    let query = query_value(query)?;
    let as_of = OffsetDateTime::now_utc()
        .to_offset(state.local_offset())
        .date();
    let (current, previous) = query.ranges(as_of)?;
    Ok(Json(json!(
        ledger(&state, move |service| service.compare(current, previous)).await?
    )))
}

async fn report_trend(
    State(state): State<RavenApiState>,
    query: Result<Query<TrendQuery>, QueryRejection>,
) -> Result<Json<Value>, ApiError> {
    let query = query_value(query)?;
    let range = range(&query.from, &query.to)?;
    let granularity = query.granularity.and_then(TrendGranularityQuery::explicit);
    Ok(Json(json!(
        ledger(&state, move |service| service.trend(range, granularity)).await?
    )))
}

async fn report_briefing(
    State(state): State<RavenApiState>,
    query: Result<Query<ReportQuery>, QueryRejection>,
) -> Result<Json<Value>, ApiError> {
    let range = query_value(query)?.range()?;
    Ok(Json(json!(
        ledger(&state, move |service| service.briefing(range)).await?
    )))
}

async fn ledger<T, F>(state: &RavenApiState, action: F) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce(
            &mut LedgerService<SqliteLedgerRepository>,
        ) -> ledger_engine::application::error::LedgerResult<T>
        + Send
        + 'static,
{
    let path = state.ledger_db().to_path_buf();
    tokio::task::spawn_blocking(move || {
        let repository = SqliteLedgerRepository::open(path)?;
        action(&mut LedgerService::new(repository))
    })
    .await
    .map_err(|_| ApiError::internal(anyhow::anyhow!("ledger worker failed")))?
    .map_err(Into::into)
}

fn query_value<T>(query: Result<Query<T>, QueryRejection>) -> Result<T, ApiError> {
    query
        .map(|Query(value)| value)
        .map_err(|_| ApiError::validation(None))
}

fn json_value<T>(body: Result<Json<T>, JsonRejection>) -> Result<T, ApiError> {
    body.map(|Json(value)| value).map_err(|error| {
        if error.status() == StatusCode::PAYLOAD_TOO_LARGE {
            ApiError::payload_too_large()
        } else {
            ApiError::validation(None)
        }
    })
}

fn parse_time(value: &str, field: &'static str) -> Result<OffsetDateTime, ApiError> {
    OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
        .map_err(|_| ApiError::validation(Some(field)))
}

fn parse_optional_date(value: Option<&str>, field: &'static str) -> Result<Option<Date>, ApiError> {
    value
        .map(|value| Date::parse(value, &time::format_description::well_known::Iso8601::DATE))
        .transpose()
        .map_err(|_| ApiError::validation(Some(field)))
}

fn parse_money(
    value: &str,
    precision: u8,
    field: &'static str,
) -> ledger_engine::application::error::LedgerResult<Money> {
    Money::parse(value, precision).map_err(|_| {
        ledger_engine::application::error::LedgerError::Validation {
            field,
            message: "invalid money value".to_string(),
        }
    })
}

fn checked_page(offset: u32, limit: u16) -> Result<Page, ApiError> {
    if limit == 0 || limit > ledger_engine::application::ports::MAX_PAGE_LIMIT {
        return Err(ApiError::validation(Some("limit")));
    }
    Ok(Page { offset, limit })
}

fn range(from: &str, to: &str) -> Result<ReportRange, ApiError> {
    let from = parse_optional_date(Some(from), "from")?.expect("present");
    let to = parse_optional_date(Some(to), "to")?.expect("present");
    ReportRange::new(from, to).map_err(Into::into)
}

const fn default_limit() -> u16 {
    100
}
