use axum::body::Bytes;
use axum::extract::rejection::{BytesRejection, JsonRejection, QueryRejection};
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use health_engine::application::commands::{
    CreateDietEntry, CreateHealthEvent, DailyMetricInput, DietMediaUpdate, MediaUpload,
    UpdateDietEntry, UpdateHealthEvent,
};
use health_engine::application::ports::{EventQuery, Page};
use health_engine::application::queries::HealthQuery;
use health_engine::application::service::HealthService;
use health_engine::domain::HealthCategory;
use health_engine::infrastructure::media::LocalMediaStore;
use health_engine::infrastructure::sqlite::SqliteHealthRepository;
use serde::Deserialize;
use serde_json::{Value, json};
use time::OffsetDateTime;

use crate::dto::health::{
    CreateDietBody, DailyMetricsBody, EventBody, PurgeBody, UpdateDietBody, UpdateEventBody,
};
use crate::{ApiError, RavenApiState};

const MAX_JSON_BYTES: usize = 128 * 1024;
const MAX_MEDIA_BYTES: usize = 10 * 1024 * 1024;
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
        .route("/timeline", get(timeline))
        .route("/trends", get(trends))
        .route("/audit/:record_type/:record_id", get(audit))
        .layer(axum::extract::DefaultBodyLimit::max(MAX_JSON_BYTES));
    json.merge(Router::new().route(
        "/diet/with-image",
        post(create_diet_with_image).layer(axum::extract::DefaultBodyLimit::max(MAX_MEDIA_BYTES)),
    ))
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
    let occurred_at = parse_optional_time(body.occurred_at.as_deref(), "occurred_at")?;
    let expected_updated_at =
        parse_optional_time(body.expected_updated_at.as_deref(), "expected_updated_at")?;
    let item = health(&state, true, move |service| {
        service.update_diet(
            &id,
            UpdateDietEntry {
                occurred_at,
                meal_type: body.meal_type,
                food_name: body.food_name,
                note: body.note.optional(),
                tags: body.tags,
                media: DietMediaUpdate::Preserve,
                expected_updated_at,
                actor: body.actor,
                reason: body.reason,
            },
        )
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
    let items = health(&state, false, move |service| service.list_events(events)).await?;
    Ok(Json(json!({"items": items})))
}

async fn upsert_daily_metrics(
    State(state): State<RavenApiState>,
    body: Result<Json<DailyMetricsBody>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    let body = json_value(body)?;
    if body.metrics.is_empty() || body.metrics.len() > MAX_DAILY_METRICS {
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
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;
    let items = health(&state, true, move |service| {
        service.upsert_daily_metrics(metrics)
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
    let metadata = headers
        .get("x-raven-diet-metadata")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| ApiError::validation(Some("metadata")))?;
    let metadata: CreateDietBody =
        serde_json::from_str(metadata).map_err(|_| ApiError::validation(Some("metadata")))?;
    let occurred_at = parse_time(&metadata.occurred_at, "occurred_at")?;
    let content_type = content_type.expect("validated content type").to_string();
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
    tokio::task::spawn_blocking(move || {
        let repository = SqliteHealthRepository::open(db)?;
        let store = LocalMediaStore::new(media)?;
        let mut service = if mutation {
            HealthService::start(repository, store)?
        } else {
            HealthService::new(repository, store)
        };
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

const fn default_trend_days() -> u16 {
    30
}
