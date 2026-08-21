use axum::extract::rejection::{JsonRejection, QueryRejection};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use ledger_engine::application::commands::{
    CreateAccount, CreateAccountCategory, CreateCurrency, CreateEntry, CreateTransactionCategory,
    UpdateAccount, UpdateAccountCategory, UpdateCurrency, UpdateEntry, UpdateTransactionCategory,
};
use ledger_engine::application::ports::{EntryQuery, MAX_PAGE_LIMIT, Page};
use ledger_engine::application::reports::{ReportPeriod, ReportRange, TrendGranularity, YearMonth};
use ledger_engine::application::service::LedgerService;
use ledger_engine::application::table::{
    AccountTableFilterField, AccountTableGroup, AccountTableSortField, CategoryTableFilterField,
    CategoryTableGroup, CategoryTableSortField, FilterMode, GroupSort, LedgerFilterOperator,
    LedgerTableFilter, LedgerTableFilterValue, LedgerTableGroup, LedgerTableGroupSettings,
    LedgerTableQuery, LedgerTableScope, LedgerTableSort, RelativeDateUnit, SortDirection,
    TABLE_PAGE_LIMIT, TransactionTableFilterField, TransactionTableGroup,
    TransactionTableSortField,
};
use ledger_engine::application::transfers::{
    TransferCommand, TransferOperationKey, UpdateTransferCommand,
};
use ledger_engine::domain::Money;
use ledger_engine::infrastructure::sqlite::SqliteLedgerRepository;
use serde::{Deserialize, Serialize};
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
        .route("/table/query", post(query_table))
        .route("/table/lookups", get(table_lookups))
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
struct TableQueryBody {
    scope: LedgerTableScope,
    #[serde(default)]
    offset: u32,
    #[serde(default = "default_table_limit")]
    limit: u16,
    #[serde(default = "default_filter_mode")]
    filter_mode: FilterMode,
    #[serde(default)]
    filters: Vec<TableFilterBody>,
    sorts: Vec<TableSortBody>,
    group_by: TableGroupField,
    group_settings: TableGroupSettingsBody,
    #[serde(default)]
    context: TableContextBody,
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct TableContextBody {
    reference_date: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TableFilterBody {
    field: TableFilterField,
    operator: LedgerFilterOperator,
    value: TableFilterValueBody,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum TableFilterField {
    Date,
    Content,
    EntryType,
    Account,
    Category,
    Currency,
    Amount,
    Name,
    AccountType,
    CurrentBalance,
    Kind,
    Parent,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum TableFilterValueBody {
    Text(TextValueBody),
    List(ListValueBody),
    Range(RangeValueBody),
    Relative(RelativeValueBody),
    Empty(EmptyValueBody),
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TextValueBody {
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ListValueBody {
    list: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RangeValueBody {
    range: RangeBody,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RangeBody {
    start: String,
    end: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RelativeValueBody {
    relative: RelativeBody,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RelativeBody {
    amount: String,
    unit: RelativeDateUnit,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct EmptyValueBody {
    empty: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TableSortBody {
    field: TableSortField,
    direction: SortDirection,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum TableSortField {
    Date,
    Content,
    Account,
    Category,
    Amount,
    Updated,
    Name,
    AccountType,
    Currency,
    CurrentBalance,
    Kind,
    Parent,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TableGroupSettingsBody {
    sort: GroupSort,
    hide_empty: bool,
    manual_order: Vec<String>,
    hidden_group_keys: Vec<String>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum TableGroupField {
    None,
    Month,
    Week,
    Day,
    Account,
    Category,
    EntryType,
    AccountType,
    Currency,
    Kind,
    Parent,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TableLookupQuery {
    scope: LedgerTableScope,
}

#[derive(Debug, Serialize)]
struct LookupOption {
    id: String,
    label: String,
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

async fn query_table(
    State(state): State<RavenApiState>,
    body: Result<Json<TableQueryBody>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    let body = json_value(body)?;
    let reference_date =
        parse_optional_date(body.context.reference_date.as_deref(), "reference_date")?;
    let filters = body
        .filters
        .into_iter()
        .map(|filter| table_filter(body.scope, filter))
        .collect::<Result<Vec<_>, _>>()?;
    let sorts = body
        .sorts
        .into_iter()
        .map(|sort| table_sort(body.scope, sort))
        .collect::<Result<Vec<_>, _>>()?;
    let group = LedgerTableGroupSettings::new(
        table_group(body.scope, body.group_by)?,
        body.group_settings.sort,
        body.group_settings.hide_empty,
        body.group_settings.manual_order,
        body.group_settings.hidden_group_keys,
    )?;
    let query = LedgerTableQuery::new(
        body.scope,
        body.offset,
        body.limit,
        body.filter_mode,
        filters,
        sorts,
        group,
        reference_date,
    )?;
    let page = ledger(&state, move |service| service.query_table(&query)).await?;
    Ok(Json(json!(page)))
}

async fn table_lookups(
    State(state): State<RavenApiState>,
    query: Result<Query<TableLookupQuery>, QueryRejection>,
) -> Result<Json<Value>, ApiError> {
    let scope = query_value(query)?.scope;
    ledger(&state, move |service| {
        let value = match scope {
            LedgerTableScope::Transactions => json!({
                "accounts": all_pages(|page| service.accounts_page(page))?
                    .into_iter().map(|value| LookupOption { id: value.id().into(), label: value.name().into() }).collect::<Vec<_>>(),
                "categories": all_pages(|page| service.transaction_categories_page(page))?
                    .into_iter().map(|value| LookupOption { id: value.id().into(), label: value.name().into() }).collect::<Vec<_>>(),
                "currencies": all_pages(|page| service.currencies_page(page))?
                    .into_iter().map(|value| LookupOption { id: value.id().into(), label: value.code().into() }).collect::<Vec<_>>(),
            }),
            LedgerTableScope::Accounts => json!({
                "account_types": all_pages(|page| service.account_categories_page(page))?
                    .into_iter().map(|value| LookupOption { id: value.id().into(), label: value.name().into() }).collect::<Vec<_>>(),
                "currencies": all_pages(|page| service.currencies_page(page))?
                    .into_iter().map(|value| LookupOption { id: value.id().into(), label: value.code().into() }).collect::<Vec<_>>(),
            }),
            LedgerTableScope::Categories => json!({
                "categories": all_pages(|page| service.transaction_categories_page(page))?
                    .into_iter().map(|value| LookupOption { id: value.id().into(), label: value.name().into() }).collect::<Vec<_>>(),
            }),
        };
        Ok(value)
    })
    .await
    .map(Json)
}

fn all_pages<T>(
    mut fetch: impl FnMut(
        Page,
    ) -> ledger_engine::application::error::LedgerResult<
        ledger_engine::application::ports::Paged<T>,
    >,
) -> ledger_engine::application::error::LedgerResult<Vec<T>> {
    let mut items = Vec::new();
    let mut offset = 0;
    loop {
        let page = fetch(Page {
            offset,
            limit: MAX_PAGE_LIMIT,
        })?;
        items.extend(page.items);
        let Some(next) = page.next else { break };
        offset = next.offset;
    }
    Ok(items)
}

fn table_filter(
    scope: LedgerTableScope,
    body: TableFilterBody,
) -> Result<LedgerTableFilter, ApiError> {
    let value = match body.value {
        TableFilterValueBody::Text(value) => LedgerTableFilterValue::Text(value.text),
        TableFilterValueBody::List(value) => LedgerTableFilterValue::TextList(value.list),
        TableFilterValueBody::Range(value) => LedgerTableFilterValue::Range {
            start: value.range.start,
            end: value.range.end,
        },
        TableFilterValueBody::Relative(value) => LedgerTableFilterValue::Relative {
            amount: value.relative.amount,
            unit: value.relative.unit,
        },
        TableFilterValueBody::Empty(value) if value.empty => LedgerTableFilterValue::Empty,
        TableFilterValueBody::Empty(_) => return Err(ApiError::validation(Some("filters"))),
    };
    let invalid = || ApiError::validation(Some("filters"));
    Ok(match scope {
        LedgerTableScope::Transactions => LedgerTableFilter::Transactions {
            field: match body.field {
                TableFilterField::Date => TransactionTableFilterField::Date,
                TableFilterField::Content => TransactionTableFilterField::Content,
                TableFilterField::EntryType => TransactionTableFilterField::EntryType,
                TableFilterField::Account => TransactionTableFilterField::Account,
                TableFilterField::Category => TransactionTableFilterField::Category,
                TableFilterField::Currency => TransactionTableFilterField::Currency,
                TableFilterField::Amount => TransactionTableFilterField::Amount,
                _ => return Err(invalid()),
            },
            operator: body.operator,
            value,
        },
        LedgerTableScope::Accounts => LedgerTableFilter::Accounts {
            field: match body.field {
                TableFilterField::Name => AccountTableFilterField::Name,
                TableFilterField::AccountType => AccountTableFilterField::AccountType,
                TableFilterField::Currency => AccountTableFilterField::Currency,
                TableFilterField::CurrentBalance => AccountTableFilterField::CurrentBalance,
                _ => return Err(invalid()),
            },
            operator: body.operator,
            value,
        },
        LedgerTableScope::Categories => LedgerTableFilter::Categories {
            field: match body.field {
                TableFilterField::Name => CategoryTableFilterField::Name,
                TableFilterField::Kind => CategoryTableFilterField::Kind,
                TableFilterField::Parent => CategoryTableFilterField::Parent,
                _ => return Err(invalid()),
            },
            operator: body.operator,
            value,
        },
    })
}

fn table_sort(scope: LedgerTableScope, body: TableSortBody) -> Result<LedgerTableSort, ApiError> {
    let invalid = || ApiError::validation(Some("sorts"));
    Ok(match scope {
        LedgerTableScope::Transactions => LedgerTableSort::Transactions {
            field: match body.field {
                TableSortField::Date => TransactionTableSortField::Date,
                TableSortField::Content => TransactionTableSortField::Content,
                TableSortField::Account => TransactionTableSortField::Account,
                TableSortField::Category => TransactionTableSortField::Category,
                TableSortField::Amount => TransactionTableSortField::Amount,
                TableSortField::Updated => TransactionTableSortField::Updated,
                _ => return Err(invalid()),
            },
            direction: body.direction,
        },
        LedgerTableScope::Accounts => LedgerTableSort::Accounts {
            field: match body.field {
                TableSortField::Name => AccountTableSortField::Name,
                TableSortField::AccountType => AccountTableSortField::AccountType,
                TableSortField::Currency => AccountTableSortField::Currency,
                TableSortField::CurrentBalance => AccountTableSortField::CurrentBalance,
                _ => return Err(invalid()),
            },
            direction: body.direction,
        },
        LedgerTableScope::Categories => LedgerTableSort::Categories {
            field: match body.field {
                TableSortField::Name => CategoryTableSortField::Name,
                TableSortField::Kind => CategoryTableSortField::Kind,
                TableSortField::Parent => CategoryTableSortField::Parent,
                _ => return Err(invalid()),
            },
            direction: body.direction,
        },
    })
}

fn table_group(
    scope: LedgerTableScope,
    field: TableGroupField,
) -> Result<LedgerTableGroup, ApiError> {
    let invalid = || ApiError::validation(Some("group"));
    Ok(match scope {
        LedgerTableScope::Transactions => LedgerTableGroup::Transactions(match field {
            TableGroupField::None => TransactionTableGroup::None,
            TableGroupField::Month => TransactionTableGroup::Month,
            TableGroupField::Week => TransactionTableGroup::Week,
            TableGroupField::Day => TransactionTableGroup::Day,
            TableGroupField::Account => TransactionTableGroup::Account,
            TableGroupField::Category => TransactionTableGroup::Category,
            TableGroupField::EntryType => TransactionTableGroup::EntryType,
            _ => return Err(invalid()),
        }),
        LedgerTableScope::Accounts => LedgerTableGroup::Accounts(match field {
            TableGroupField::None => AccountTableGroup::None,
            TableGroupField::AccountType => AccountTableGroup::AccountType,
            TableGroupField::Currency => AccountTableGroup::Currency,
            _ => return Err(invalid()),
        }),
        LedgerTableScope::Categories => LedgerTableGroup::Categories(match field {
            TableGroupField::None => CategoryTableGroup::None,
            TableGroupField::Kind => CategoryTableGroup::Kind,
            TableGroupField::Parent => CategoryTableGroup::Parent,
            _ => return Err(invalid()),
        }),
    })
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

const fn default_table_limit() -> u16 {
    TABLE_PAGE_LIMIT
}

const fn default_filter_mode() -> FilterMode {
    FilterMode::And
}

#[cfg(test)]
mod tests {
    use time::macros::date;

    use super::{ComparePeriod, CompareQuery, ReportRange};

    #[test]
    fn compare_presets_use_fixed_calendar_ranges() {
        for (period, current, previous) in [
            (
                ComparePeriod::CurrentMonth,
                ReportRange::new(date!(2026 - 01 - 01), date!(2026 - 01 - 31)).unwrap(),
                ReportRange::new(date!(2025 - 12 - 01), date!(2025 - 12 - 31)).unwrap(),
            ),
            (
                ComparePeriod::PreviousMonth,
                ReportRange::new(date!(2025 - 12 - 01), date!(2025 - 12 - 31)).unwrap(),
                ReportRange::new(date!(2025 - 11 - 01), date!(2025 - 11 - 30)).unwrap(),
            ),
            (
                ComparePeriod::CurrentYear,
                ReportRange::new(date!(2026 - 01 - 01), date!(2026 - 12 - 31)).unwrap(),
                ReportRange::new(date!(2025 - 01 - 01), date!(2025 - 12 - 31)).unwrap(),
            ),
        ] {
            let ranges = CompareQuery {
                period: Some(period),
                from: None,
                to: None,
                current_from: None,
                current_to: None,
                previous_from: None,
                previous_to: None,
            }
            .ranges(date!(2026 - 01 - 15))
            .unwrap();
            assert_eq!(ranges, (current, previous));
        }
    }
}
