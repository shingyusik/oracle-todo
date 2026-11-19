//! `/api/v1/maintenance/retention*` on the UI and standalone API routers (never MCP).

use axum::Json;
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Extension, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Uri, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use serde::Deserialize;

use crate::ApiError;
use crate::retention::{
    DEFAULT_PREVIEW_LIMIT, MAX_PREVIEW_LIMIT, Retention, RetentionError, SettingsUpdate, Trigger,
};
use crate::system::ResolvedUiOrigin;

const MAINTENANCE_HEADER: HeaderName = HeaderName::from_static("x-raven-maintenance");

pub(crate) fn router<S>(retention: Retention) -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route("/retention", get(status).put(update))
        .route("/retention/preview", get(preview))
        .route("/retention/run", post(run))
        .with_state(retention)
}

impl From<RetentionError> for ApiError {
    fn from(error: RetentionError) -> Self {
        match error {
            RetentionError::Validation { field } => ApiError::validation(Some(field)),
            RetentionError::Storage => ApiError::internal(anyhow::anyhow!("retention storage")),
        }
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, RetentionError> + Send + 'static,
) -> Result<T, ApiError> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(ApiError::internal)?
        .map_err(ApiError::from)
}

async fn status(State(retention): State<Retention>) -> Response {
    match blocking(move || retention.status()).await {
        Ok(status) => no_store(Json(status).into_response()),
        Err(error) => error.into_response(),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct UpdateRequest {
    enabled: bool,
    retention_days: u32,
    #[serde(default)]
    backup_keep: Option<u32>,
}

async fn update(State(retention): State<Retention>, body: Bytes) -> Response {
    let request = match serde_json::from_slice::<UpdateRequest>(&body) {
        Ok(request) => request,
        Err(_) => return ApiError::validation(None).into_response(),
    };
    let result = blocking(move || {
        retention.update_settings(SettingsUpdate {
            enabled: Some(request.enabled),
            retention_days: Some(request.retention_days),
            backup_keep: request.backup_keep,
        })?;
        retention.status()
    })
    .await;
    match result {
        Ok(status) => no_store(Json(status).into_response()),
        Err(error) => error.into_response(),
    }
}

fn parse_limit(uri: &Uri) -> Result<usize, ApiError> {
    let mut limit = None;
    for pair in uri.query().unwrap_or_default().split('&') {
        if pair.is_empty() {
            continue;
        }
        match pair.split_once('=') {
            Some(("limit", value)) if limit.is_none() => {
                let parsed = value
                    .parse::<usize>()
                    .ok()
                    .filter(|value| (1..=MAX_PREVIEW_LIMIT).contains(value))
                    .ok_or_else(|| ApiError::validation(Some("limit")))?;
                limit = Some(parsed);
            }
            _ => return Err(ApiError::validation(Some("limit"))),
        }
    }
    Ok(limit.unwrap_or(DEFAULT_PREVIEW_LIMIT))
}

async fn preview(State(retention): State<Retention>, uri: Uri) -> Response {
    let limit = match parse_limit(&uri) {
        Ok(limit) => limit,
        Err(error) => return error.into_response(),
    };
    match blocking(move || retention.preview(limit)).await {
        Ok(preview) => no_store(Json(preview).into_response()),
        Err(error) => error.into_response(),
    }
}

async fn run(
    State(retention): State<Retention>,
    origin: Option<Extension<ResolvedUiOrigin>>,
    headers: HeaderMap,
) -> Response {
    // The UI authority layer resolves the served origin; the bearer API derives it
    // from its single Host header.
    let expected = match origin {
        Some(Extension(ResolvedUiOrigin(expected))) => Some(expected.as_bytes().to_vec()),
        None => {
            single_header(&headers, header::HOST).map(|host| [b"http://".as_slice(), host].concat())
        }
    };
    let exact_origin = expected
        .is_some_and(|expected| single_header(&headers, header::ORIGIN) == Some(&expected[..]));
    if !exact_origin || single_header(&headers, MAINTENANCE_HEADER) != Some(b"1") {
        return ApiError::forbidden().into_response();
    }
    match blocking(move || retention.run(Trigger::Api)).await {
        Ok(report) if report.skipped == Some("locked") => {
            ApiError::retention_in_progress().into_response()
        }
        Ok(report) => no_store(Json(report).into_response()),
        Err(error) => error.into_response(),
    }
}

fn single_header(headers: &HeaderMap, name: HeaderName) -> Option<&[u8]> {
    let mut values = headers.get_all(name).iter();
    let value = values.next()?;
    values.next().is_none().then_some(value.as_bytes())
}

fn no_store(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}
