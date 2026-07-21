use std::path::{Path, PathBuf};
use std::str::FromStr;

use anyhow::{Context, Result};
use axum::Json;
use axum::Router;
use axum::extract::rejection::JsonRejection;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use serde::Serialize;

use crate::application::error::TodoError;
use crate::application::service::TodoService;
use crate::domain::Actor;
use crate::infrastructure::sqlite::{SqliteTodoRepository, connect, init_schema};

mod dto;
mod handlers;
use handlers::*;

#[derive(Clone)]
pub(super) struct ApiState {
    db_path: PathBuf,
    keeper: Option<std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>>,
}

pub fn router(db_path: impl AsRef<Path>) -> Result<Router> {
    let (db_path, keeper) = api_db_path(db_path.as_ref())?;
    let state = ApiState { db_path, keeper };
    let preferences_router = backend::api::router(state.db_path.clone());
    Ok(Router::new()
        .route("/health", get(health))
        .route("/areas", post(create_area))
        .route("/goals/propose", post(propose_goal))
        .route("/projects/propose", post(propose_project))
        .route("/routines/propose", post(propose_routine))
        .route("/routines/:id/materialize", post(materialize_routine))
        .route("/events/propose", post(propose_event))
        .route("/tasks/propose", post(propose_task))
        .route("/items", get(list_items))
        .route("/items/archive", get(archive_items))
        .route("/views/agenda", get(view_agenda))
        .route("/views/date-range", get(view_date_range))
        .route("/views/period", get(view_period))
        .route("/items/:id", patch(update_item))
        .route("/items/:id/pause", post(pause_item))
        .route("/items/:id/resume", post(resume_item))
        .route("/items/:id/complete", post(complete_item))
        .route("/items/:id/reopen", post(reopen_item))
        .route("/items/:id/archive", post(archive_item))
        .route("/items/:id/drop", post(drop_item))
        .route("/items/:id/cancel", post(cancel_item))
        .with_state(state)
        .merge(preferences_router))
}

fn service(state: &ApiState) -> ApiResult<TodoService> {
    let _keeper = &state.keeper;
    let path = state.db_path.to_str().with_context(|| {
        format!(
            "database path is not valid UTF-8: {}",
            state.db_path.display()
        )
    })?;
    let conn = connect(path)?;
    Ok(TodoService::persistent(SqliteTodoRepository::new(conn)))
}

fn api_db_path(
    path: &Path,
) -> Result<(
    PathBuf,
    Option<std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>>,
)> {
    if path == Path::new(":memory:") {
        let uri = format!(
            "file:todo_engine_api_{}?mode=memory&cache=shared",
            uuid::Uuid::new_v4().simple()
        );
        let keeper = connect(&uri)?;
        init_schema(&keeper)?;
        return Ok((
            PathBuf::from(uri),
            Some(std::sync::Arc::new(std::sync::Mutex::new(keeper))),
        ));
    }

    let path = path.to_path_buf();
    let conn = connect(
        path.to_str()
            .with_context(|| format!("database path is not valid UTF-8: {}", path.display()))?,
    )?;
    init_schema(&conn)?;
    Ok((path, None))
}

pub(super) fn with_service<T>(
    state: &ApiState,
    action: impl FnOnce(&mut TodoService) -> crate::application::error::TodoResult<T>,
) -> ApiResult<T> {
    let mut service = service(state)?;
    action(&mut service).map_err(Into::into)
}

pub(super) fn non_empty(value: &str) -> Option<&str> {
    (!value.is_empty()).then_some(value)
}

pub(super) fn non_empty_string(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

pub(super) fn parse_actor_or_default(value: Option<&str>) -> Result<Actor, TodoError> {
    value
        .map(Actor::from_str)
        .transpose()
        .map_err(TodoError::Validation)
        .map(|actor| actor.unwrap_or(Actor::Agent))
}

pub(super) fn parse_bool(value: &str) -> std::result::Result<bool, String> {
    match value.to_ascii_lowercase().as_str() {
        "true" | "1" | "yes" | "on" => Ok(true),
        "false" | "0" | "no" | "off" => Ok(false),
        _ => Err(format!("invalid boolean: {value}")),
    }
}

pub(super) fn validation_rejection(error: JsonRejection) -> TodoError {
    TodoError::Validation(error.body_text())
}

pub(super) type ApiResult<T> = std::result::Result<T, ApiError>;

pub(super) struct ApiError(anyhow::Error);

#[derive(Serialize)]
struct ApiErrorBody {
    code: String,
    detail: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    parent_horizon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    child_horizon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    horizon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    scheduled: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    parent_id: Option<String>,
}

impl ApiErrorBody {
    fn from_todo_error(error: &TodoError) -> Self {
        let mut metadata = error.api_metadata();
        Self {
            code: error.api_code().to_string(),
            detail: error.to_string(),
            parent_horizon: take_string(&mut metadata, "parent_horizon"),
            child_horizon: take_string(&mut metadata, "child_horizon"),
            horizon: take_string(&mut metadata, "horizon"),
            scheduled: take_string(&mut metadata, "scheduled"),
            parent_id: take_string(&mut metadata, "parent_id"),
        }
    }
}

fn take_string(
    metadata: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Option<String> {
    metadata
        .remove(key)
        .and_then(|value| value.as_str().map(ToString::to_string))
}

impl<E> From<E> for ApiError
where
    E: Into<anyhow::Error>,
{
    fn from(error: E) -> Self {
        Self(error.into())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, body) = match self.0.downcast_ref::<TodoError>() {
            Some(error) => (
                StatusCode::from_u16(error.http_status_code())
                    .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
                ApiErrorBody::from_todo_error(error),
            ),
            None => (
                StatusCode::INTERNAL_SERVER_ERROR,
                ApiErrorBody {
                    code: "internal_error".to_string(),
                    detail: self.0.to_string(),
                    parent_horizon: None,
                    child_horizon: None,
                    horizon: None,
                    scheduled: None,
                    parent_id: None,
                },
            ),
        };
        (status, Json(body)).into_response()
    }
}
