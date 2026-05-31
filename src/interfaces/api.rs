use std::path::{Path, PathBuf};
use std::str::FromStr;

use anyhow::{Context, Result};
use axum::extract::{Path as AxumPath, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;

use crate::application::error::TodoError;
use crate::application::ports::ListFilter;
use crate::application::service::{CreateArea, ProposeTask, TodoService};
use crate::domain::{Actor, TodoItem};
use crate::exports::{current_today_items, render_items};
use crate::infrastructure::sqlite::{SqliteTodoRepository, connect, init_schema};
use crate::infrastructure::system::local_today_string;

#[derive(Clone)]
struct ApiState {
    db_path: PathBuf,
}

#[derive(Deserialize)]
struct AreaBody {
    title: String,
    review_cycle: Option<String>,
    standard: Option<String>,
}

#[derive(Deserialize)]
struct TaskProposeBody {
    title: String,
    area: Option<String>,
    due: Option<String>,
    scheduled: Option<String>,
    priority: Option<i64>,
    description: Option<String>,
    actor: Option<String>,
}

pub fn router(db_path: impl AsRef<Path>) -> Result<Router> {
    let state = ApiState {
        db_path: db_path.as_ref().to_path_buf(),
    };
    Ok(Router::new()
        .route("/health", get(health))
        .route("/areas", post(create_area))
        .route("/tasks/propose", post(propose_task))
        .route("/items", get(list_items))
        .route("/items/:id/approve", post(approve_item))
        .route("/items/:id/complete", post(complete_item))
        .route("/exports/today.md", get(today_export))
        .with_state(state))
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({"ok": true}))
}

async fn create_area(
    State(state): State<ApiState>,
    Json(body): Json<AreaBody>,
) -> ApiResult<Json<TodoItem>> {
    let mut service = service(&state)?;
    let item = service.create_area(CreateArea {
        title: body.title,
        review_cycle: body.review_cycle,
        standard: body.standard,
    })?;
    Ok(Json(item))
}

async fn propose_task(
    State(state): State<ApiState>,
    Json(body): Json<TaskProposeBody>,
) -> ApiResult<Json<TodoItem>> {
    let actor = body
        .actor
        .as_deref()
        .map(Actor::from_str)
        .transpose()
        .map_err(TodoError::Validation)?
        .unwrap_or(Actor::Oracle);
    let mut service = service(&state)?;
    let item = service.propose_task(
        body.title,
        ProposeTask {
            actor,
            area: body.area,
            due: body.due,
            scheduled: body.scheduled,
            priority: body.priority,
            description: body.description,
            ..Default::default()
        },
    )?;
    Ok(Json(item))
}

async fn list_items(State(state): State<ApiState>) -> ApiResult<Json<Vec<TodoItem>>> {
    let mut service = service(&state)?;
    let items = service.list_items(ListFilter::default())?;
    Ok(Json(items))
}

async fn approve_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Json<TodoItem>> {
    let mut service = service(&state)?;
    let item = service.approve(&id, None)?;
    Ok(Json(item))
}

async fn complete_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Json<TodoItem>> {
    let mut service = service(&state)?;
    let item = service.complete(&id, None)?;
    Ok(Json(item))
}

async fn today_export(State(state): State<ApiState>) -> ApiResult<Response> {
    let today = local_today_string();
    let mut service = service(&state)?;
    let items = current_today_items(&mut service, &today)?;
    Ok((
        [(header::CONTENT_TYPE, "text/markdown; charset=utf-8")],
        render_items("Today", &items),
    )
        .into_response())
}

fn service(state: &ApiState) -> ApiResult<TodoService> {
    let path = state.db_path.to_str().with_context(|| {
        format!(
            "database path is not valid UTF-8: {}",
            state.db_path.display()
        )
    })?;
    let conn = connect(path)?;
    init_schema(&conn)?;
    Ok(TodoService::persistent(SqliteTodoRepository::new(conn)))
}

type ApiResult<T> = std::result::Result<T, ApiError>;

struct ApiError(anyhow::Error);

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
        let status =
            self.0
                .downcast_ref::<TodoError>()
                .map_or(StatusCode::INTERNAL_SERVER_ERROR, |error| match error {
                    TodoError::Policy(_) | TodoError::Validation(_) => StatusCode::BAD_REQUEST,
                    TodoError::NotFound(_) => StatusCode::NOT_FOUND,
                    TodoError::Storage(_) | TodoError::Migration(_) | TodoError::Internal(_) => {
                        StatusCode::INTERNAL_SERVER_ERROR
                    }
                });
        (status, Json(json!({"error": self.0.to_string()}))).into_response()
    }
}
