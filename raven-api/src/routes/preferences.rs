use axum::extract::rejection::JsonRejection;
use axum::extract::{OriginalUri, Path, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::Value;

use crate::{ApiError, RavenApiState};

const MAX_BODY_BYTES: usize = 16 * 1024;
const KEYS: [&str; 4] = [
    "planner.v1",
    "workspace.views.v1",
    "ledger.views.v1",
    "health.views.v1",
];
const ROUTE_PREFIX: &str = "/api/v1/preferences/";

pub fn router() -> Router<RavenApiState> {
    Router::new()
        .route("/:key", get(get_preference).put(put_preference))
        .fallback(invalid_route)
        .layer(axum::extract::DefaultBodyLimit::max(MAX_BODY_BYTES))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PreferenceBody {
    value: Value,
}

async fn get_preference(
    State(state): State<RavenApiState>,
    OriginalUri(uri): OriginalUri,
    Path(key): Path<String>,
) -> Result<Json<Value>, ApiError> {
    validate_key(&uri, &key)?;
    let db = state.todo_db().to_path_buf();
    let value = tokio::task::spawn_blocking(move || backend::api::read_preference(&db, &key))
        .await
        .map_err(|_| ApiError::internal(anyhow::anyhow!("preference worker failed")))?
        .map_err(ApiError::internal)?;
    Ok(Json(value.unwrap_or(Value::Null)))
}

async fn put_preference(
    State(state): State<RavenApiState>,
    OriginalUri(uri): OriginalUri,
    Path(key): Path<String>,
    body: Result<Json<PreferenceBody>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    validate_key(&uri, &key)?;
    let body = body.map_err(json_rejection)?.0;
    if !body.value.is_object() {
        return Err(ApiError::validation(Some("value")));
    }
    let value = body.value;
    let stored = value.clone();
    let db = state.todo_db().to_path_buf();
    tokio::task::spawn_blocking(move || backend::api::write_preference(&db, &key, &stored))
        .await
        .map_err(|_| ApiError::internal(anyhow::anyhow!("preference worker failed")))?
        .map_err(ApiError::internal)?;
    Ok(Json(value))
}

pub(crate) async fn invalid_route() -> ApiError {
    ApiError::validation(Some("key"))
}

fn validate_key(uri: &axum::http::Uri, key: &str) -> Result<(), ApiError> {
    let raw = uri.path().strip_prefix(ROUTE_PREFIX);
    if raw != Some(key) || !KEYS.contains(&key) {
        return Err(ApiError::validation(Some("key")));
    }
    Ok(())
}

fn json_rejection(rejection: JsonRejection) -> ApiError {
    match rejection.status() {
        StatusCode::PAYLOAD_TOO_LARGE => ApiError::payload_too_large(),
        StatusCode::UNSUPPORTED_MEDIA_TYPE => ApiError::unsupported_media_type(),
        _ => ApiError::validation(None),
    }
}
