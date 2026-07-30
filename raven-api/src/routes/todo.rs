use axum::Router;
use axum::http::StatusCode;
use axum::middleware;
use axum::response::{IntoResponse, Response};

use crate::{ApiError, RavenApiState};

const MAX_BODY_BYTES: usize = 128 * 1024;

pub fn router(state: &RavenApiState) -> anyhow::Result<Router<RavenApiState>> {
    Ok(todo_engine::interfaces::api::raven_router(state.todo_db())
        .layer(axum::extract::DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(middleware::map_response(normalize_error))
        .with_state(()))
}

async fn normalize_error(response: Response) -> Response {
    match response.status() {
        status if status.is_success() => response,
        StatusCode::BAD_REQUEST => ApiError::validation(None).into_response(),
        StatusCode::NOT_FOUND => ApiError::not_found().into_response(),
        StatusCode::CONFLICT => ApiError::conflict().into_response(),
        StatusCode::PAYLOAD_TOO_LARGE => ApiError::payload_too_large().into_response(),
        _ => ApiError::internal(anyhow::anyhow!("todo request failed")).into_response(),
    }
}
