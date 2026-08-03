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
        StatusCode::BAD_REQUEST | StatusCode::NOT_FOUND => translate_legacy_error(response, status)
            .await
            .unwrap_or_else(|| generic_error(status)),
        StatusCode::CONFLICT => generic_error(status),
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
            "goal_invalid_anchor" | "goal_parent_horizon_not_coarser"
        )
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

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::header;
    use serde_json::json;

    use super::*;

    #[tokio::test]
    async fn oversized_legacy_error_body_is_generic() {
        let response = legacy_response(
            StatusCode::BAD_REQUEST,
            json!({
                "code": "goal_invalid_anchor",
                "detail": "storage detail".repeat(4096),
                "horizon": "month",
                "scheduled": "2026-08-02"
            }),
        );

        assert_generic(
            normalize_error(response).await,
            StatusCode::BAD_REQUEST,
            "validation_error",
            "The request is invalid.",
        )
        .await;
    }

    #[tokio::test]
    async fn unknown_legacy_error_fields_are_generic() {
        let response = legacy_response(
            StatusCode::BAD_REQUEST,
            json!({
                "code": "goal_invalid_anchor",
                "detail": "unsafe detail",
                "horizon": "month",
                "scheduled": "2026-08-02",
                "storage_path": "/private/todo.sqlite"
            }),
        );

        assert_generic(
            normalize_error(response).await,
            StatusCode::BAD_REQUEST,
            "validation_error",
            "The request is invalid.",
        )
        .await;
    }

    #[tokio::test]
    async fn legacy_status_code_mismatch_is_generic() {
        let response = legacy_response(
            StatusCode::NOT_FOUND,
            json!({
                "code": "goal_invalid_anchor",
                "detail": "unsafe detail",
                "horizon": "month",
                "scheduled": "2026-08-02"
            }),
        );

        assert_generic(
            normalize_error(response).await,
            StatusCode::NOT_FOUND,
            "not_found",
            "The requested record was not found.",
        )
        .await;
    }

    #[tokio::test]
    async fn legacy_policy_detail_and_metadata_are_generic() {
        let response = legacy_response(
            StatusCode::BAD_REQUEST,
            json!({
                "code": "policy_error",
                "detail": "Unsupported recurrence_rule: FREQ=DAILY;BYHOUR=3",
                "parent_id": "private-parent-id"
            }),
        );

        assert_generic(
            normalize_error(response).await,
            StatusCode::BAD_REQUEST,
            "validation_error",
            "The request is invalid.",
        )
        .await;
    }

    #[tokio::test]
    async fn legacy_not_found_detail_and_metadata_are_generic() {
        let response = legacy_response(
            StatusCode::NOT_FOUND,
            json!({
                "code": "not_found",
                "detail": "Item not found: private-record-id",
                "scheduled": "2030-01-02T03:04:05"
            }),
        );

        assert_generic(
            normalize_error(response).await,
            StatusCode::NOT_FOUND,
            "not_found",
            "The requested record was not found.",
        )
        .await;
    }

    #[tokio::test]
    async fn legacy_conflict_detail_is_generic() {
        let response = legacy_response(
            StatusCode::CONFLICT,
            json!({
                "code": "conflict",
                "detail": "UNIQUE constraint failed: items.id"
            }),
        );

        assert_generic(
            normalize_error(response).await,
            StatusCode::CONFLICT,
            "conflict",
            "The request conflicts with current state.",
        )
        .await;
    }

    #[tokio::test]
    async fn legacy_internal_detail_is_generic() {
        let response = legacy_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({
                "code": "internal_error",
                "detail": "database /private/todo.sqlite is locked"
            }),
        );

        assert_generic(
            normalize_error(response).await,
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal_error",
            "An internal error occurred.",
        )
        .await;
    }

    fn legacy_response(status: StatusCode, body: Value) -> Response {
        Response::builder()
            .status(status)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    }

    async fn assert_generic(response: Response, status: StatusCode, code: &str, message: &str) {
        assert_eq!(response.status(), status);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "application/json");
        let bytes = to_bytes(response.into_body(), 128 * 1024).await.unwrap();
        let body: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body.as_object().unwrap().len(), 4);
        assert_eq!(body["code"], code);
        assert_eq!(body["message"], message);
        assert_eq!(body["fields"], json!({}));
        Uuid::parse_str(body["request_id"].as_str().unwrap()).unwrap();
    }
}
