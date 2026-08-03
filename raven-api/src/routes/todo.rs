use axum::body::to_bytes;
use axum::http::StatusCode;
use axum::middleware;
use axum::response::{IntoResponse, Response};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{Map, Value};
use uuid::Uuid;

use crate::{ApiError, ApiErrorBody, RavenApiState};

const MAX_BODY_BYTES: usize = 128 * 1024;
const MAX_ERROR_BODY_BYTES: usize = 8 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LegacyTodoError {
    code: String,
    detail: String,
    parent_horizon: Option<String>,
    child_horizon: Option<String>,
    horizon: Option<String>,
    scheduled: Option<String>,
    parent_id: Option<String>,
}

pub fn router(state: &RavenApiState) -> anyhow::Result<Router<RavenApiState>> {
    Ok(todo_engine::interfaces::api::raven_router(state.todo_db())
        .layer(axum::extract::DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(middleware::map_response(normalize_error))
        .with_state(()))
}

async fn normalize_error(response: Response) -> Response {
    let status = response.status();
    match status {
        status if status.is_success() => response,
        StatusCode::BAD_REQUEST | StatusCode::NOT_FOUND | StatusCode::CONFLICT => {
            translate_legacy_error(response, status)
                .await
                .unwrap_or_else(|| generic_error(status))
        }
        StatusCode::PAYLOAD_TOO_LARGE => ApiError::payload_too_large().into_response(),
        _ => ApiError::internal(anyhow::anyhow!("todo request failed")).into_response(),
    }
}

async fn translate_legacy_error(response: Response, status: StatusCode) -> Option<Response> {
    let body = to_bytes(response.into_body(), MAX_ERROR_BODY_BYTES)
        .await
        .ok()?;
    let error: LegacyTodoError = serde_json::from_slice(&body).ok()?;
    if !known_code(status, &error.code) {
        return None;
    }

    let mut fields = Map::new();
    for (key, value) in [
        ("parent_horizon", error.parent_horizon),
        ("child_horizon", error.child_horizon),
        ("horizon", error.horizon),
        ("scheduled", error.scheduled),
        ("parent_id", error.parent_id),
    ] {
        if let Some(value) = value {
            fields.insert(key.to_owned(), Value::Array(vec![Value::String(value)]));
        }
    }

    Some(
        (
            status,
            Json(ApiErrorBody {
                code: error.code,
                message: error.detail,
                fields,
                request_id: Uuid::new_v4(),
            }),
        )
            .into_response(),
    )
}

fn known_code(status: StatusCode, code: &str) -> bool {
    matches!(
        (status, code),
        (
            StatusCode::BAD_REQUEST,
            "goal_invalid_anchor" | "goal_parent_horizon_not_coarser" | "policy_error"
        ) | (StatusCode::NOT_FOUND, "not_found")
            | (StatusCode::CONFLICT, "conflict")
    )
}

fn generic_error(status: StatusCode) -> Response {
    match status {
        StatusCode::BAD_REQUEST => ApiError::validation(None).into_response(),
        StatusCode::NOT_FOUND => ApiError::not_found().into_response(),
        StatusCode::CONFLICT => ApiError::conflict().into_response(),
        _ => unreachable!("generic ToDo errors are limited to 400, 404, and 409"),
    }
}
