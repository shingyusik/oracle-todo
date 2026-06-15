use std::path::{Path, PathBuf};
use std::str::FromStr;

use anyhow::{Context, Result};
use axum::extract::rejection::JsonRejection;
use axum::extract::{Path as AxumPath, Query, State};
use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;

use crate::application::error::TodoError;
use crate::application::ports::ListFilter;
use crate::application::service::{
    CreateArea, ProposeEvent, ProposeProject, ProposeRoutine, ProposeTask, TodoService, UpdateItem,
};
use crate::domain::{Actor, ItemStatus, ItemType, TodoItem};
use crate::exports::render_items;
use crate::infrastructure::sqlite::{SqliteTodoRepository, connect, init_schema};

#[derive(Clone)]
struct ApiState {
    db_path: PathBuf,
    keeper: Option<std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>>,
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

#[derive(Deserialize)]
struct ProjectProposeBody {
    title: String,
    area: Option<String>,
    definition_of_done: Option<String>,
    outcome: Option<String>,
    due: Option<String>,
    actor: Option<String>,
}

#[derive(Deserialize)]
struct RoutineProposeBody {
    title: String,
    area: Option<String>,
    recurrence_rule: Option<String>,
    materialization_policy: Option<String>,
    actor: Option<String>,
}

#[derive(Deserialize)]
struct EventProposeBody {
    title: String,
    scheduled: String,
    area: Option<String>,
    project_id: Option<String>,
    due: Option<String>,
    priority: Option<i64>,
    description: Option<String>,
    location: Option<String>,
    participants: Option<Vec<String>>,
    commitment_type: Option<String>,
    actor: Option<String>,
}

#[derive(Deserialize, Default)]
struct ReasonBody {
    reason: Option<String>,
}

#[derive(Deserialize, Default)]
struct UpdateBody {
    title: Option<String>,
    description: Option<String>,
    outcome: Option<String>,
    definition_of_done: Option<String>,
    standard: Option<String>,
    review_cycle: Option<String>,
    recurrence_rule: Option<String>,
    materialization_policy: Option<String>,
    area: Option<String>,
    project_id: Option<String>,
    routine_id: Option<String>,
    due: Option<String>,
    scheduled: Option<String>,
    priority: Option<i64>,
    reason: Option<String>,
}

#[derive(Deserialize)]
struct ItemsQuery {
    status: Option<String>,
    #[serde(rename = "type")]
    item_type: Option<String>,
    area_id: Option<String>,
    project_id: Option<String>,
    routine_id: Option<String>,
    query: Option<String>,
    include_archived: Option<String>,
}

pub fn router(db_path: impl AsRef<Path>) -> Result<Router> {
    let (db_path, keeper) = api_db_path(db_path.as_ref())?;
    let state = ApiState { db_path, keeper };
    Ok(Router::new()
        .route("/health", get(health))
        .route("/areas", post(create_area))
        .route("/projects/propose", post(propose_project))
        .route("/routines/propose", post(propose_routine))
        .route("/events/propose", post(propose_event))
        .route("/tasks/propose", post(propose_task))
        .route("/items", get(list_items))
        .route("/items/archive", get(archive_items))
        .route("/items/:id", patch(update_item))
        .route("/items/:id/approve", post(approve_item))
        .route("/items/:id/activate", post(activate_item))
        .route("/items/:id/pause", post(pause_item))
        .route("/items/:id/resume", post(resume_item))
        .route("/items/:id/complete", post(complete_item))
        .route("/items/:id/archive", post(archive_item))
        .route("/items/:id/drop", post(drop_item))
        .route("/items/:id/cancel", post(cancel_item))
        .route("/exports/today.md", get(today_export))
        .with_state(state))
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({"ok": true}))
}

async fn create_area(
    State(state): State<ApiState>,
    body: std::result::Result<Json<AreaBody>, JsonRejection>,
) -> ApiResult<Json<TodoItem>> {
    let Json(body) = body.map_err(validation_rejection)?;
    let item = with_service(&state, |service| {
        service.create_area(CreateArea {
            title: body.title,
            review_cycle: body.review_cycle,
            standard: body.standard,
        })
    })?;
    Ok(Json(item))
}

async fn propose_task(
    State(state): State<ApiState>,
    body: std::result::Result<Json<TaskProposeBody>, JsonRejection>,
) -> ApiResult<Json<TodoItem>> {
    let Json(body) = body.map_err(validation_rejection)?;
    let actor = body
        .actor
        .as_deref()
        .map(Actor::from_str)
        .transpose()
        .map_err(TodoError::Validation)?
        .unwrap_or(Actor::Oracle);
    let item = with_service(&state, |service| {
        service.propose_task(
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
        )
    })?;
    Ok(Json(item))
}

async fn propose_project(
    State(state): State<ApiState>,
    body: std::result::Result<Json<ProjectProposeBody>, JsonRejection>,
) -> ApiResult<Json<TodoItem>> {
    let Json(body) = body.map_err(validation_rejection)?;
    let actor = parse_actor_or_default(body.actor.as_deref())?;
    let item = with_service(&state, |service| {
        service.propose_project(ProposeProject {
            title: body.title,
            area: body.area,
            definition_of_done: body.definition_of_done,
            outcome: body.outcome,
            due: body.due,
            actor,
        })
    })?;
    Ok(Json(item))
}

async fn propose_routine(
    State(state): State<ApiState>,
    body: std::result::Result<Json<RoutineProposeBody>, JsonRejection>,
) -> ApiResult<Json<TodoItem>> {
    let Json(body) = body.map_err(validation_rejection)?;
    let actor = parse_actor_or_default(body.actor.as_deref())?;
    let item = with_service(&state, |service| {
        service.propose_routine(ProposeRoutine {
            title: body.title,
            area: body.area,
            actor,
            recurrence_rule: body.recurrence_rule,
            materialization_policy: body
                .materialization_policy
                .unwrap_or_else(|| "single_open".to_string()),
        })
    })?;
    Ok(Json(item))
}

async fn propose_event(
    State(state): State<ApiState>,
    body: std::result::Result<Json<EventProposeBody>, JsonRejection>,
) -> ApiResult<Json<TodoItem>> {
    let Json(body) = body.map_err(validation_rejection)?;
    let actor = parse_actor_or_default(body.actor.as_deref())?;
    let item = with_service(&state, |service| {
        service.propose_event(ProposeEvent {
            title: body.title,
            actor,
            scheduled: Some(body.scheduled),
            area: body.area,
            project_id: body.project_id,
            due: body.due,
            priority: body.priority,
            description: body.description,
            location: body.location,
            participants: body.participants.unwrap_or_default(),
            commitment_type: body
                .commitment_type
                .unwrap_or_else(|| "appointment".to_string()),
        })
    })?;
    Ok(Json(item))
}

async fn list_items(
    State(state): State<ApiState>,
    Query(query): Query<ItemsQuery>,
) -> ApiResult<Json<Vec<TodoItem>>> {
    let filter = ListFilter {
        status: query
            .status
            .as_deref()
            .and_then(non_empty)
            .map(ItemStatus::from_str)
            .transpose()
            .map_err(TodoError::Validation)?,
        item_type: query
            .item_type
            .as_deref()
            .and_then(non_empty)
            .map(ItemType::from_str)
            .transpose()
            .map_err(TodoError::Validation)?,
        include_archived: query
            .include_archived
            .as_deref()
            .and_then(non_empty)
            .map(parse_bool)
            .transpose()
            .map_err(TodoError::Validation)?
            .unwrap_or(false),
        area_id: query.area_id.and_then(non_empty_string),
        project_id: query.project_id.and_then(non_empty_string),
        routine_id: query.routine_id.and_then(non_empty_string),
        query: query.query.and_then(non_empty_string),
    };
    let mut items = with_service(&state, |service| service.list_items(filter))?;
    items.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| right.id.cmp(&left.id))
    });
    Ok(Json(items))
}

async fn archive_items(State(state): State<ApiState>) -> ApiResult<Json<Vec<TodoItem>>> {
    let items = with_service(&state, |service| service.archive_items())?;
    Ok(Json(items))
}

async fn update_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
    body: std::result::Result<Json<UpdateBody>, JsonRejection>,
) -> ApiResult<Json<TodoItem>> {
    let Json(body) = body.map_err(validation_rejection)?;
    let item = with_service(&state, |service| {
        service.update_item(
            &id,
            UpdateItem {
                title: body.title,
                description: body.description,
                outcome: body.outcome,
                definition_of_done: body.definition_of_done,
                standard: body.standard,
                review_cycle: body.review_cycle,
                recurrence_rule: body.recurrence_rule,
                materialization_policy: body.materialization_policy,
                area: body.area,
                project_id: body.project_id,
                routine_id: body.routine_id,
                due: body.due,
                scheduled: body.scheduled,
                priority: body.priority,
                reason: body.reason,
            },
        )
    })?;
    Ok(Json(item))
}

async fn approve_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Json<TodoItem>> {
    let item = with_service(&state, |service| service.approve(&id, None))?;
    Ok(Json(item))
}

async fn activate_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
    body: Option<Json<ReasonBody>>,
) -> ApiResult<Json<TodoItem>> {
    let reason = body.and_then(|Json(body)| body.reason);
    let item = with_service(&state, |service| service.activate(&id, reason.as_deref()))?;
    Ok(Json(item))
}

async fn pause_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
    body: Option<Json<ReasonBody>>,
) -> ApiResult<Json<TodoItem>> {
    let reason = body.and_then(|Json(body)| body.reason);
    let item = with_service(&state, |service| service.pause(&id, reason.as_deref()))?;
    Ok(Json(item))
}

async fn resume_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
    body: Option<Json<ReasonBody>>,
) -> ApiResult<Json<TodoItem>> {
    let reason = body.and_then(|Json(body)| body.reason);
    let item = with_service(&state, |service| service.resume(&id, reason.as_deref()))?;
    Ok(Json(item))
}

async fn complete_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Json<TodoItem>> {
    let item = with_service(&state, |service| service.complete(&id, None))?;
    Ok(Json(item))
}

async fn archive_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
    body: Option<Json<ReasonBody>>,
) -> ApiResult<Json<TodoItem>> {
    let reason = body.and_then(|Json(body)| body.reason);
    let item = with_service(&state, |service| service.archive(&id, reason.as_deref()))?;
    Ok(Json(item))
}

async fn drop_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
    body: Option<Json<ReasonBody>>,
) -> ApiResult<Json<TodoItem>> {
    let reason = body.and_then(|Json(body)| body.reason);
    let item = with_service(&state, |service| service.drop(&id, reason.as_deref()))?;
    Ok(Json(item))
}

async fn cancel_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
    body: Option<Json<ReasonBody>>,
) -> ApiResult<Json<TodoItem>> {
    let reason = body.and_then(|Json(body)| body.reason);
    let item = with_service(&state, |service| service.cancel(&id, reason.as_deref()))?;
    Ok(Json(item))
}

async fn today_export(State(state): State<ApiState>) -> ApiResult<Response> {
    let mut items = with_service(&state, |service| {
        service.list_items(ListFilter {
            item_type: Some(ItemType::Task),
            ..Default::default()
        })
    })?;
    items.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| right.id.cmp(&left.id))
    });
    Ok((
        [(header::CONTENT_TYPE, "text/markdown; charset=utf-8")],
        render_items("Today", &items),
    )
        .into_response())
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
    init_schema(&conn)?;
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
            "file:oracle_todo_api_{}?mode=memory&cache=shared",
            uuid::Uuid::new_v4().simple()
        );
        let keeper = connect(&uri)?;
        init_schema(&keeper)?;
        return Ok((
            PathBuf::from(uri),
            Some(std::sync::Arc::new(std::sync::Mutex::new(keeper))),
        ));
    }

    Ok((path.to_path_buf(), None))
}

fn with_service<T>(
    state: &ApiState,
    action: impl FnOnce(&mut TodoService) -> crate::application::error::TodoResult<T>,
) -> ApiResult<T> {
    let mut service = service(state)?;
    action(&mut service).map_err(Into::into)
}

fn non_empty(value: &str) -> Option<&str> {
    (!value.is_empty()).then_some(value)
}

fn non_empty_string(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

fn parse_actor_or_default(value: Option<&str>) -> Result<Actor, TodoError> {
    value
        .map(Actor::from_str)
        .transpose()
        .map_err(TodoError::Validation)
        .map(|actor| actor.unwrap_or(Actor::Oracle))
}

fn parse_bool(value: &str) -> std::result::Result<bool, String> {
    match value.to_ascii_lowercase().as_str() {
        "true" | "1" | "yes" | "on" => Ok(true),
        "false" | "0" | "no" | "off" => Ok(false),
        _ => Err(format!("invalid boolean: {value}")),
    }
}

fn validation_rejection(error: JsonRejection) -> TodoError {
    TodoError::Validation(error.body_text())
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
                .map_or(StatusCode::INTERNAL_SERVER_ERROR, |error| {
                    let code = match error {
                        TodoError::NotFound(_) => 400,
                        _ => error.http_status_code(),
                    };
                    StatusCode::from_u16(code).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR)
                });
        (status, Json(json!({"detail": self.0.to_string()}))).into_response()
    }
}
