use axum::body::Bytes;
use axum::extract::rejection::{BytesRejection, JsonRejection, QueryRejection};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use health_engine::application::commands::{
    CreateDietEntry, CreateHealthEvent, DailyMetricArchive, DailyMetricInput, DietMediaUpdate,
    MediaUpload, UpdateDietEntry, UpdateHealthEvent,
};
use health_engine::application::ports::{EventQuery, Page};
use health_engine::application::queries::HealthQuery;
use health_engine::application::reports::HealthReportRange;
use health_engine::application::service::HealthService;
use health_engine::application::table::{
    BowelTableFilterField, BowelTableGroup, BowelTableSortField, DietTableFilterField,
    DietTableGroup, DietTableSortField, FilterMode, GroupSort, HealthFilterOperator,
    HealthTableFilter, HealthTableFilterValue, HealthTableGroup, HealthTableGroupSettings,
    HealthTableQuery, HealthTableRecord, HealthTableScope, HealthTableSort,
    MedicationTableFilterField, MedicationTableGroup, MedicationTableSortField,
    MetricsTableFilterField, MetricsTableGroup, MetricsTableSortField, RelativeDateUnit,
    SortDirection,
};
use health_engine::domain::HealthCategory;
use health_engine::infrastructure::media::LocalMediaStore;
use health_engine::infrastructure::sqlite::SqliteHealthRepository;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use time::{Date, OffsetDateTime};

use crate::dto::health::{
    CreateDietBody, DailyMetricsBody, EventBody, PurgeBody, UpdateDietBody, UpdateEventBody,
};
use crate::{ApiError, RavenApiState};

const MAX_JSON_BYTES: usize = 128 * 1024;
const MAX_MEDIA_BYTES: usize = 10 * 1024 * 1024;
const MAX_METADATA_BYTES: usize = 8 * 1024;
const MAX_DAILY_METRICS: usize = 366;

pub fn router() -> Router<RavenApiState> {
    let json = Router::new()
        .route("/diet", get(list_diet).post(create_diet))
        .route("/diet/:id", get(get_diet).patch(update_diet))
        .route("/diet/:id/archive", post(archive_diet))
        .route("/diet/:id/restore", post(restore_diet))
        .route("/diet/:id/purge", delete(purge_diet))
        .route("/events", get(list_events).post(create_event))
        .route("/events/:id", get(get_event).patch(update_event))
        .route("/events/:id/archive", post(archive_event))
        .route("/events/:id/restore", post(restore_event))
        .route("/events/:id/purge", delete(purge_event))
        .route("/metrics/daily", post(upsert_daily_metrics))
        .route("/table/query", post(query_table))
        .route("/table/lookups", get(table_lookups))
        .route("/reports", get(reports))
        .route("/timeline", get(timeline))
        .route("/trends", get(trends))
        .route("/audit/:record_type/:record_id", get(audit))
        .layer(axum::extract::DefaultBodyLimit::max(MAX_JSON_BYTES));
    json.merge(
        Router::new()
            .route(
                "/diet/with-image",
                post(create_diet_with_image)
                    .layer(axum::extract::DefaultBodyLimit::max(MAX_MEDIA_BYTES)),
            )
            .route(
                "/diet/:id/with-image",
                axum::routing::patch(update_diet_with_image)
                    .layer(axum::extract::DefaultBodyLimit::max(MAX_MEDIA_BYTES)),
            ),
    )
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
struct EventListQuery {
    #[serde(default)]
    offset: u32,
    #[serde(default = "default_limit")]
    limit: u16,
    category: Option<HealthCategory>,
    metric_key: Option<String>,
    #[serde(default)]
    daily_only: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TimelineQuery {
    #[serde(default)]
    offset: u32,
    #[serde(default = "default_limit")]
    limit: u16,
    from: Option<String>,
    to: Option<String>,
    category: Option<HealthCategory>,
    #[serde(default)]
    include_archived: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrendsQuery {
    #[serde(default = "default_trend_days")]
    days: u16,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ReportsQuery {
    from: String,
    to: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TableQueryBody {
    scope: HealthTableScope,
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
    operator: HealthFilterOperator,
    value: TableFilterValueBody,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum TableFilterField {
    Date,
    MealType,
    Food,
    Tags,
    HasPhoto,
    BristolScale,
    BloodVisible,
    MedicationName,
    MedicationUnit,
    Weight,
    Sleep,
    Crp,
    Calprotectin,
    Condition,
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
    MealType,
    Food,
    Created,
    Updated,
    BristolScale,
    MedicationName,
    Dose,
    Weight,
    Sleep,
    Crp,
    Calprotectin,
    Condition,
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
    MealType,
    Tag,
    HasPhoto,
    BristolScale,
    BloodVisible,
    MedicationName,
    MedicationUnit,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct TableLookupQuery {
    scope: HealthTableScope,
}

#[derive(Debug, Serialize)]
struct LookupOption {
    id: String,
    label: String,
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
    let groups = HealthTableGroupSettings::new(
        table_group(body.scope, body.group_by)?,
        body.group_settings.sort,
        body.group_settings.hide_empty,
        body.group_settings.manual_order,
        body.group_settings.hidden_group_keys,
    )?;
    let query = HealthTableQuery::new(
        body.scope,
        body.offset,
        body.limit,
        body.filter_mode,
        filters,
        sorts,
        groups,
        reference_date,
    )?;
    let page = health(&state, false, move |service| service.query_table(&query)).await?;
    let items = page
        .items
        .into_iter()
        .map(|row| {
            let kind = match row.record() {
                HealthTableRecord::Diet(_) => "diet",
                HealthTableRecord::Bowel(_) => "bowel",
                HealthTableRecord::Medication(_) => "medication",
                HealthTableRecord::Metrics(_) => "metrics",
            };
            let mut record = serde_json::to_value(row.record())
                .expect("health table records are JSON serializable");
            record
                .as_object_mut()
                .expect("health table records serialize as objects")
                .insert("kind".into(), json!(kind));
            json!({
                "key": row.key(),
                "group_key": row.group_key(),
                "group_label": row.group_label(),
                "record": record,
            })
        })
        .collect::<Vec<_>>();
    Ok(Json(
        json!({"items": items, "next_offset": page.next_offset}),
    ))
}

async fn table_lookups(
    State(state): State<RavenApiState>,
    query: Result<Query<TableLookupQuery>, QueryRejection>,
) -> Result<Json<Value>, ApiError> {
    let scope = query_value(query)?.scope;
    let value = match scope {
        HealthTableScope::Diet => {
            let tags = health(&state, false, |service| {
                Ok(service
                    .list_active_diet_tags()?
                    .into_iter()
                    .map(|tag| LookupOption {
                        id: tag.clone(),
                        label: tag,
                    })
                    .collect::<Vec<_>>())
            })
            .await?;
            json!({
                "meal_type": options(&[("breakfast", "Breakfast"), ("lunch", "Lunch"), ("dinner", "Dinner"), ("snack", "Snack"), ("late_night", "Late night")]),
                "has_photo": options(&[("with-photo", "Yes"), ("without-photo", "No")]),
                "tags": tags,
            })
        }
        HealthTableScope::Bowel => json!({
            "bristol_scale": (1..=7).map(|value| LookupOption { id: value.to_string(), label: format!("Type {value}") }).collect::<Vec<_>>(),
            "blood_visible": options(&[("yes", "Yes"), ("no", "No")]),
        }),
        HealthTableScope::Medication => json!({
            "medication_unit": options(&[("tablet", "정"), ("capsule", "캡슐"), ("packet", "포"), ("mg", "mg"), ("g", "g"), ("ml", "ml"), ("drop", "방울"), ("dose", "회")]),
        }),
        HealthTableScope::Metrics => json!({
            "metric": options(&[("weight", "Weight"), ("sleep", "Sleep"), ("crp", "CRP"), ("calprotectin", "Calprotectin"), ("condition", "Condition")]),
        }),
    };
    Ok(Json(value))
}

fn options(values: &[(&str, &str)]) -> Vec<LookupOption> {
    values
        .iter()
        .map(|(id, label)| LookupOption {
            id: (*id).into(),
            label: (*label).into(),
        })
        .collect()
}

fn table_value(body: TableFilterValueBody) -> Result<HealthTableFilterValue, ApiError> {
    Ok(match body {
        TableFilterValueBody::Text(value) => HealthTableFilterValue::Text(value.text),
        TableFilterValueBody::List(value) => HealthTableFilterValue::TextList(value.list),
        TableFilterValueBody::Range(value) => HealthTableFilterValue::Range {
            start: value.range.start,
            end: value.range.end,
        },
        TableFilterValueBody::Relative(value) => HealthTableFilterValue::Relative {
            amount: value.relative.amount,
            unit: value.relative.unit,
        },
        TableFilterValueBody::Empty(value) if value.empty => HealthTableFilterValue::Empty,
        TableFilterValueBody::Empty(_) => return Err(ApiError::validation(Some("filters"))),
    })
}

fn table_filter(
    scope: HealthTableScope,
    body: TableFilterBody,
) -> Result<HealthTableFilter, ApiError> {
    let value = table_value(body.value)?;
    let invalid = || ApiError::validation(Some("filters"));
    Ok(match scope {
        HealthTableScope::Diet => HealthTableFilter::Diet {
            field: match body.field {
                TableFilterField::Date => DietTableFilterField::Date,
                TableFilterField::MealType => DietTableFilterField::MealType,
                TableFilterField::Food => DietTableFilterField::Food,
                TableFilterField::Tags => DietTableFilterField::Tags,
                TableFilterField::HasPhoto => DietTableFilterField::HasPhoto,
                _ => return Err(invalid()),
            },
            operator: body.operator,
            value,
        },
        HealthTableScope::Bowel => HealthTableFilter::Bowel {
            field: match body.field {
                TableFilterField::Date => BowelTableFilterField::Date,
                TableFilterField::BristolScale => BowelTableFilterField::BristolScale,
                TableFilterField::BloodVisible => BowelTableFilterField::BloodVisible,
                _ => return Err(invalid()),
            },
            operator: body.operator,
            value,
        },
        HealthTableScope::Medication => HealthTableFilter::Medication {
            field: match body.field {
                TableFilterField::Date => MedicationTableFilterField::Date,
                TableFilterField::MedicationName => MedicationTableFilterField::MedicationName,
                TableFilterField::MedicationUnit => MedicationTableFilterField::MedicationUnit,
                _ => return Err(invalid()),
            },
            operator: body.operator,
            value,
        },
        HealthTableScope::Metrics => HealthTableFilter::Metrics {
            field: match body.field {
                TableFilterField::Date => MetricsTableFilterField::Date,
                TableFilterField::Weight => MetricsTableFilterField::Weight,
                TableFilterField::Sleep => MetricsTableFilterField::Sleep,
                TableFilterField::Crp => MetricsTableFilterField::Crp,
                TableFilterField::Calprotectin => MetricsTableFilterField::Calprotectin,
                TableFilterField::Condition => MetricsTableFilterField::Condition,
                _ => return Err(invalid()),
            },
            operator: body.operator,
            value,
        },
    })
}

fn table_sort(scope: HealthTableScope, body: TableSortBody) -> Result<HealthTableSort, ApiError> {
    let invalid = || ApiError::validation(Some("sorts"));
    Ok(match scope {
        HealthTableScope::Diet => HealthTableSort::Diet {
            field: match body.field {
                TableSortField::Date => DietTableSortField::Date,
                TableSortField::MealType => DietTableSortField::MealType,
                TableSortField::Food => DietTableSortField::Food,
                TableSortField::Created => DietTableSortField::Created,
                TableSortField::Updated => DietTableSortField::Updated,
                _ => return Err(invalid()),
            },
            direction: body.direction,
        },
        HealthTableScope::Bowel => HealthTableSort::Bowel {
            field: match body.field {
                TableSortField::Date => BowelTableSortField::Date,
                TableSortField::BristolScale => BowelTableSortField::BristolScale,
                TableSortField::Created => BowelTableSortField::Created,
                TableSortField::Updated => BowelTableSortField::Updated,
                _ => return Err(invalid()),
            },
            direction: body.direction,
        },
        HealthTableScope::Medication => HealthTableSort::Medication {
            field: match body.field {
                TableSortField::Date => MedicationTableSortField::Date,
                TableSortField::MedicationName => MedicationTableSortField::MedicationName,
                TableSortField::Dose => MedicationTableSortField::Dose,
                TableSortField::Created => MedicationTableSortField::Created,
                TableSortField::Updated => MedicationTableSortField::Updated,
                _ => return Err(invalid()),
            },
            direction: body.direction,
        },
        HealthTableScope::Metrics => HealthTableSort::Metrics {
            field: match body.field {
                TableSortField::Date => MetricsTableSortField::Date,
                TableSortField::Weight => MetricsTableSortField::Weight,
                TableSortField::Sleep => MetricsTableSortField::Sleep,
                TableSortField::Crp => MetricsTableSortField::Crp,
                TableSortField::Calprotectin => MetricsTableSortField::Calprotectin,
                TableSortField::Condition => MetricsTableSortField::Condition,
                _ => return Err(invalid()),
            },
            direction: body.direction,
        },
    })
}

fn table_group(
    scope: HealthTableScope,
    field: TableGroupField,
) -> Result<HealthTableGroup, ApiError> {
    let invalid = || ApiError::validation(Some("group"));
    Ok(match scope {
        HealthTableScope::Diet => HealthTableGroup::Diet(match field {
            TableGroupField::None => DietTableGroup::None,
            TableGroupField::Month => DietTableGroup::Month,
            TableGroupField::Week => DietTableGroup::Week,
            TableGroupField::Day => DietTableGroup::Day,
            TableGroupField::MealType => DietTableGroup::MealType,
            TableGroupField::Tag => DietTableGroup::Tag,
            TableGroupField::HasPhoto => DietTableGroup::HasPhoto,
            _ => return Err(invalid()),
        }),
        HealthTableScope::Bowel => HealthTableGroup::Bowel(match field {
            TableGroupField::None => BowelTableGroup::None,
            TableGroupField::Month => BowelTableGroup::Month,
            TableGroupField::Week => BowelTableGroup::Week,
            TableGroupField::Day => BowelTableGroup::Day,
            TableGroupField::BristolScale => BowelTableGroup::BristolScale,
            TableGroupField::BloodVisible => BowelTableGroup::BloodVisible,
            _ => return Err(invalid()),
        }),
        HealthTableScope::Medication => HealthTableGroup::Medication(match field {
            TableGroupField::None => MedicationTableGroup::None,
            TableGroupField::Month => MedicationTableGroup::Month,
            TableGroupField::Week => MedicationTableGroup::Week,
            TableGroupField::Day => MedicationTableGroup::Day,
            TableGroupField::MedicationName => MedicationTableGroup::MedicationName,
            TableGroupField::MedicationUnit => MedicationTableGroup::MedicationUnit,
            _ => return Err(invalid()),
        }),
        HealthTableScope::Metrics => HealthTableGroup::Metrics(match field {
            TableGroupField::None => MetricsTableGroup::None,
            TableGroupField::Month => MetricsTableGroup::Month,
            TableGroupField::Week => MetricsTableGroup::Week,
            _ => return Err(invalid()),
        }),
    })
}

async fn list_diet(
    State(state): State<RavenApiState>,
    query: Result<Query<PageQuery>, QueryRejection>,
) -> Result<Json<Value>, ApiError> {
    let query = query_value(query)?;
    let page = page(query.offset, query.limit)?;
    let items = health(&state, false, move |service| service.list_diet(page)).await?;
    Ok(Json(json!({"items": items})))
}

async fn get_diet(
    State(state): State<RavenApiState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let item = health(&state, false, move |service| service.get_diet(&id)).await?;
    Ok(Json(json!(item)))
}

async fn create_diet(
    State(state): State<RavenApiState>,
    body: Result<Json<CreateDietBody>, JsonRejection>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let body = json_value(body)?;
    let occurred_at = parse_time(&body.occurred_at, "occurred_at")?;
    let item = health(&state, true, move |service| {
        service.create_diet(CreateDietEntry {
            occurred_at,
            meal_type: body.meal_type,
            food_name: body.food_name,
            note: body.note,
            tags: body.tags,
            media: None,
            actor: body.actor,
        })
    })
    .await?;
    Ok((StatusCode::CREATED, Json(json!(item))))
}

async fn update_diet(
    State(state): State<RavenApiState>,
    Path(id): Path<String>,
    body: Result<Json<UpdateDietBody>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    let body = json_value(body)?;
    let media = if body.remove_image {
        DietMediaUpdate::Remove
    } else {
        DietMediaUpdate::Preserve
    };
    let update = diet_update(body, media)?;
    let item = health(&state, true, move |service| {
        service.update_diet(&id, update)
    })
    .await?;
    Ok(Json(json!(item)))
}

async fn create_event(
    State(state): State<RavenApiState>,
    body: Result<Json<EventBody>, JsonRejection>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let body = json_value(body)?;
    let occurred_at = parse_time(&body.occurred_at, "occurred_at")?;
    let details = body.details.into_domain()?;
    let item = health(&state, true, move |service| {
        service.create_event(CreateHealthEvent {
            occurred_at,
            details,
            note: body.note,
            actor: body.actor,
        })
    })
    .await?;
    Ok((StatusCode::CREATED, Json(json!(item))))
}

async fn update_event(
    State(state): State<RavenApiState>,
    Path(id): Path<String>,
    body: Result<Json<UpdateEventBody>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    let body = json_value(body)?;
    let occurred_at = parse_optional_time(body.occurred_at.as_deref(), "occurred_at")?;
    let expected_updated_at =
        parse_optional_time(body.expected_updated_at.as_deref(), "expected_updated_at")?;
    let details = body
        .details
        .map(|details| details.into_domain())
        .transpose()?;
    let item = health(&state, true, move |service| {
        service.update_event(
            &id,
            UpdateHealthEvent {
                occurred_at,
                details,
                note: body.note.optional(),
                expected_updated_at,
                actor: body.actor,
                reason: body.reason,
            },
        )
    })
    .await?;
    Ok(Json(json!(item)))
}

async fn get_event(
    State(state): State<RavenApiState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let item = health(&state, false, move |service| service.get_event(&id)).await?;
    Ok(Json(json!(item)))
}

async fn list_events(
    State(state): State<RavenApiState>,
    query: Result<Query<EventListQuery>, QueryRejection>,
) -> Result<Json<Value>, ApiError> {
    let query = query_value(query)?;
    let mut events = EventQuery::new(page(query.offset, query.limit)?);
    if let Some(category) = query.category {
        events = events.with_category(category);
    }
    if let Some(metric_key) = query.metric_key {
        events = events.with_metric_key(metric_key)?;
    }
    events = events.daily_only(query.daily_only);
    let items = health(&state, false, move |service| service.list_events(events)).await?;
    Ok(Json(json!({"items": items})))
}

async fn upsert_daily_metrics(
    State(state): State<RavenApiState>,
    body: Result<Json<DailyMetricsBody>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    let body = json_value(body)?;
    let operation_count = body.metrics.len() + body.archives.len();
    if operation_count == 0 || operation_count > MAX_DAILY_METRICS {
        return Err(ApiError::validation(Some("metrics")));
    }
    let metrics = body
        .metrics
        .into_iter()
        .map(|metric| {
            Ok(DailyMetricInput {
                occurred_at: parse_time(&metric.occurred_at, "occurred_at")?,
                details: metric.details.into_domain()?,
                note: metric.note,
                actor: metric.actor,
                expected_updated_at: parse_optional_time(
                    metric.expected_updated_at.as_deref(),
                    "expected_updated_at",
                )?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    let archives = body
        .archives
        .into_iter()
        .map(|archive| {
            Ok(DailyMetricArchive {
                id: archive.id,
                expected_updated_at: parse_optional_time(
                    archive.expected_updated_at.as_deref(),
                    "expected_updated_at",
                )?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    let items = health(&state, true, move |service| {
        service.save_daily_metrics(metrics, archives)
    })
    .await?;
    Ok(Json(json!({"items": items})))
}

macro_rules! transition {
    ($name:ident, $method:ident) => {
        async fn $name(
            State(state): State<RavenApiState>,
            Path(id): Path<String>,
        ) -> Result<Json<Value>, ApiError> {
            let item = health(&state, true, move |service| service.$method(&id)).await?;
            Ok(Json(json!(item)))
        }
    };
}

transition!(archive_diet, archive_diet);
transition!(restore_diet, restore_diet);
transition!(archive_event, archive_event);
transition!(restore_event, restore_event);

async fn purge_diet(
    State(state): State<RavenApiState>,
    Path(id): Path<String>,
    body: Result<Json<PurgeBody>, JsonRejection>,
) -> Result<StatusCode, ApiError> {
    let body = json_value(body)?;
    health(&state, true, move |service| {
        service.purge_diet(&id, &body.confirmation)
    })
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn purge_event(
    State(state): State<RavenApiState>,
    Path(id): Path<String>,
    body: Result<Json<PurgeBody>, JsonRejection>,
) -> Result<StatusCode, ApiError> {
    let body = json_value(body)?;
    health(&state, true, move |service| {
        service.purge_event(&id, &body.confirmation)
    })
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn timeline(
    State(state): State<RavenApiState>,
    query: Result<Query<TimelineQuery>, QueryRejection>,
) -> Result<Json<Value>, ApiError> {
    let query = query_value(query)?;
    let mut health_query = HealthQuery::new(page(query.offset, query.limit)?)
        .with_range(
            parse_optional_time(query.from.as_deref(), "from")?,
            parse_optional_time(query.to.as_deref(), "to")?,
        )?
        .include_archived(query.include_archived);
    if let Some(category) = query.category {
        health_query = health_query.with_category(category);
    }
    let items = health(&state, false, move |service| service.timeline(health_query)).await?;
    Ok(Json(json!({"items": items})))
}

async fn trends(
    State(state): State<RavenApiState>,
    query: Result<Query<TrendsQuery>, QueryRejection>,
) -> Result<Json<Value>, ApiError> {
    let query = query_value(query)?;
    let value = health(&state, false, move |service| service.trends(query.days)).await?;
    Ok(Json(json!(value)))
}

async fn reports(
    State(state): State<RavenApiState>,
    query: Result<Query<ReportsQuery>, QueryRejection>,
) -> Result<Json<Value>, ApiError> {
    let query = query_value(query)?;
    let range = HealthReportRange {
        from: parse_date(&query.from, "from")?,
        to: parse_date(&query.to, "to")?,
    };
    let value = health(&state, false, move |service| service.reports(range)).await?;
    Ok(Json(json!(value)))
}

async fn audit(
    State(state): State<RavenApiState>,
    Path((record_type, record_id)): Path<(String, String)>,
    query: Result<Query<PageQuery>, QueryRejection>,
) -> Result<Json<Value>, ApiError> {
    let query = query_value(query)?;
    let page = page(query.offset, query.limit)?;
    let items = health(&state, false, move |service| {
        service.audit_for(&record_type, &record_id, page)
    })
    .await?;
    let items = items
        .into_iter()
        .map(|event| {
            json!({
                "id": event.id(),
                "request_id": event.request_id(),
                "occurred_at": event.occurred_at(),
                "actor": event.actor(),
                "action": event.action(),
                "record_type": event.record_type(),
                "record_id": event.record_id(),
                "before": event.before(),
                "after": event.after(),
                "reason": event.reason(),
            })
        })
        .collect::<Vec<_>>();
    Ok(Json(json!({"items": items})))
}

async fn create_diet_with_image(
    State(state): State<RavenApiState>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let (content_type, body) = diet_image(&headers, body)?;
    let metadata: CreateDietBody = diet_metadata(&headers)?;
    let occurred_at = parse_time(&metadata.occurred_at, "occurred_at")?;
    let item = health(&state, true, move |service| {
        service.create_diet(CreateDietEntry {
            occurred_at,
            meal_type: metadata.meal_type,
            food_name: metadata.food_name,
            note: metadata.note,
            tags: metadata.tags,
            media: Some(MediaUpload::new(content_type, body.to_vec())),
            actor: metadata.actor,
        })
    })
    .await?;
    Ok((StatusCode::CREATED, Json(json!(item))))
}

async fn update_diet_with_image(
    State(state): State<RavenApiState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<Json<Value>, ApiError> {
    let (content_type, body) = diet_image(&headers, body)?;
    let metadata: UpdateDietBody = diet_metadata(&headers)?;
    if metadata.remove_image {
        return Err(ApiError::validation(Some("metadata")));
    }
    let update = diet_update(
        metadata,
        DietMediaUpdate::Replace(MediaUpload::new(content_type, body.to_vec())),
    )?;
    let item = health(&state, true, move |service| {
        service.update_diet(&id, update)
    })
    .await?;
    Ok(Json(json!(item)))
}

fn diet_update(body: UpdateDietBody, media: DietMediaUpdate) -> Result<UpdateDietEntry, ApiError> {
    Ok(UpdateDietEntry {
        occurred_at: parse_optional_time(body.occurred_at.as_deref(), "occurred_at")?,
        meal_type: body.meal_type,
        food_name: body.food_name,
        note: body.note.optional(),
        tags: body.tags,
        media,
        expected_updated_at: parse_optional_time(
            body.expected_updated_at.as_deref(),
            "expected_updated_at",
        )?,
        actor: body.actor,
        reason: body.reason,
    })
}

fn diet_image(
    headers: &HeaderMap,
    body: Result<Bytes, BytesRejection>,
) -> Result<(String, Bytes), ApiError> {
    let body = body.map_err(|error| {
        if error.status() == StatusCode::PAYLOAD_TOO_LARGE {
            ApiError::payload_too_large()
        } else {
            ApiError::validation(None)
        }
    })?;
    let content_type = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok());
    if !matches!(
        content_type,
        Some("image/jpeg" | "image/png" | "image/webp")
    ) {
        return Err(ApiError::unsupported_media_type());
    }
    if body.is_empty() {
        return Err(ApiError::validation(Some("image")));
    }
    Ok((
        content_type.expect("validated content type").to_string(),
        body,
    ))
}

fn diet_metadata<T: DeserializeOwned>(headers: &HeaderMap) -> Result<T, ApiError> {
    let metadata = headers
        .get("x-raven-diet-metadata")
        .ok_or_else(|| ApiError::validation(Some("metadata")))?;
    if metadata.as_bytes().len() > MAX_METADATA_BYTES {
        return Err(ApiError::header_too_large());
    }
    let metadata = metadata
        .to_str()
        .map_err(|_| ApiError::validation(Some("metadata")))?;
    serde_json::from_str(metadata).map_err(|_| ApiError::validation(Some("metadata")))
}

async fn health<T, F>(state: &RavenApiState, mutation: bool, action: F) -> Result<T, ApiError>
where
    T: Send + 'static,
    F: FnOnce(
            &mut HealthService<SqliteHealthRepository, LocalMediaStore>,
        ) -> health_engine::application::error::HealthResult<T>
        + Send
        + 'static,
{
    let db = state.health_db().to_path_buf();
    let media = state.health_media_dir().to_path_buf();
    let local_offset = state.local_offset();
    tokio::task::spawn_blocking(move || {
        let repository = SqliteHealthRepository::open(db)?;
        let store = LocalMediaStore::new(media)?;
        let mut service = (if mutation {
            HealthService::start(repository, store)?
        } else {
            HealthService::new(repository, store)
        })
        .with_local_offset(local_offset);
        action(&mut service)
    })
    .await
    .map_err(|_| ApiError::internal(anyhow::anyhow!("health worker failed")))?
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

fn parse_date(value: &str, field: &'static str) -> Result<Date, ApiError> {
    Date::parse(value, &time::format_description::well_known::Iso8601::DATE)
        .map_err(|_| ApiError::validation(Some(field)))
}

fn parse_optional_date(value: Option<&str>, field: &'static str) -> Result<Option<Date>, ApiError> {
    value.map(|value| parse_date(value, field)).transpose()
}

fn parse_optional_time(
    value: Option<&str>,
    field: &'static str,
) -> Result<Option<OffsetDateTime>, ApiError> {
    value.map(|value| parse_time(value, field)).transpose()
}

fn page(offset: u32, limit: u16) -> Result<Page, ApiError> {
    Page::new(offset, limit).map_err(Into::into)
}

const fn default_limit() -> u16 {
    100
}

const fn default_table_limit() -> u16 {
    50
}

const fn default_filter_mode() -> FilterMode {
    FilterMode::And
}

const fn default_trend_days() -> u16 {
    30
}
