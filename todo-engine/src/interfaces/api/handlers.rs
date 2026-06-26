use std::str::FromStr;

use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::extract::{Path as AxumPath, Query, State};
use serde_json::json;

use super::dto::{
    AgendaQuery, AreaBody, DateRangeQuery, EventProposeBody, GoalProposeBody, ItemsQuery,
    PeriodQuery, ProjectProposeBody, ReasonBody, RoutineProposeBody, TaskProposeBody, UpdateBody,
};
use super::{
    ApiResult, ApiState, non_empty, non_empty_string, parse_actor_or_default, parse_bool,
    validation_rejection, with_service,
};
use crate::application::error::TodoError;
use crate::application::ports::ListFilter;
use crate::application::service::{
    CreateArea, PeriodView, ProposeEvent, ProposeGoal, ProposeProject, ProposeRoutine, ProposeTask,
    UpdateItem,
};
use crate::domain::{Actor, Horizon, ItemStatus, ItemType, TodoItem};

pub(super) async fn health() -> Json<serde_json::Value> {
    Json(json!({"ok": true}))
}

pub(super) async fn create_area(
    State(state): State<ApiState>,
    body: std::result::Result<Json<AreaBody>, JsonRejection>,
) -> ApiResult<Json<TodoItem>> {
    let Json(body) = body.map_err(validation_rejection)?;
    let item = with_service(&state, |service| {
        service.create_area(CreateArea {
            title: body.title,
            review_cycle: body.review_cycle,
            standard: body.standard,
            note: body.note,
        })
    })?;
    Ok(Json(item))
}

pub(super) async fn propose_task(
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
        .unwrap_or(Actor::Agent);
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
                note: body.note,
                ..Default::default()
            },
        )
    })?;
    Ok(Json(item))
}

pub(super) async fn propose_project(
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
            note: body.note,
        })
    })?;
    Ok(Json(item))
}

pub(super) async fn propose_goal(
    State(state): State<ApiState>,
    body: std::result::Result<Json<GoalProposeBody>, JsonRejection>,
) -> ApiResult<Json<TodoItem>> {
    let Json(body) = body.map_err(validation_rejection)?;
    let actor = parse_actor_or_default(body.actor.as_deref())?;
    let item = with_service(&state, |service| {
        service.propose_goal(ProposeGoal {
            title: body.title,
            horizon: body.horizon,
            scheduled: body.scheduled,
            parent_id: body.parent_id,
            actor,
            note: body.note,
        })
    })?;
    Ok(Json(item))
}

pub(super) async fn propose_routine(
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
            note: body.note,
        })
    })?;
    Ok(Json(item))
}

pub(super) async fn propose_event(
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
            note: body.note,
            location: body.location,
            participants: body.participants.unwrap_or_default(),
            commitment_type: body
                .commitment_type
                .unwrap_or_else(|| "appointment".to_string()),
        })
    })?;
    Ok(Json(item))
}

pub(super) async fn list_items(
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
        parent_id: None,
        routine_id: query.routine_id.and_then(non_empty_string),
        horizon: None,
        scheduled: None,
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

pub(super) async fn archive_items(State(state): State<ApiState>) -> ApiResult<Json<Vec<TodoItem>>> {
    let items = with_service(&state, |service| service.archive_items())?;
    Ok(Json(items))
}

pub(super) async fn view_agenda(
    State(state): State<ApiState>,
    Query(q): Query<AgendaQuery>,
) -> ApiResult<Json<Vec<TodoItem>>> {
    Ok(Json(with_service(&state, |s| s.agenda(&q.date))?))
}

pub(super) async fn view_date_range(
    State(state): State<ApiState>,
    Query(q): Query<DateRangeQuery>,
) -> ApiResult<Json<Vec<TodoItem>>> {
    Ok(Json(with_service(&state, |s| {
        s.date_range(&q.from, &q.to)
    })?))
}

pub(super) async fn view_period(
    State(state): State<ApiState>,
    Query(q): Query<PeriodQuery>,
) -> ApiResult<Json<PeriodView>> {
    let horizon = q
        .horizon
        .parse::<Horizon>()
        .map_err(TodoError::Validation)?;
    Ok(Json(with_service(&state, |s| {
        s.period_view(horizon, &q.period)
    })?))
}

pub(super) async fn update_item(
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
                note: body.note,
                outcome: body.outcome,
                definition_of_done: body.definition_of_done,
                standard: body.standard,
                review_cycle: body.review_cycle,
                recurrence_rule: body.recurrence_rule,
                materialization_policy: body.materialization_policy,
                area: body.area,
                project_id: body.project_id,
                parent_id: None,
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

pub(super) async fn approve_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Json<TodoItem>> {
    let item = with_service(&state, |service| service.approve(&id, None))?;
    Ok(Json(item))
}

pub(super) async fn activate_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
    body: Option<Json<ReasonBody>>,
) -> ApiResult<Json<TodoItem>> {
    let reason = body.and_then(|Json(body)| body.reason);
    let item = with_service(&state, |service| service.activate(&id, reason.as_deref()))?;
    Ok(Json(item))
}

pub(super) async fn pause_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
    body: Option<Json<ReasonBody>>,
) -> ApiResult<Json<TodoItem>> {
    let reason = body.and_then(|Json(body)| body.reason);
    let item = with_service(&state, |service| service.pause(&id, reason.as_deref()))?;
    Ok(Json(item))
}

pub(super) async fn resume_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
    body: Option<Json<ReasonBody>>,
) -> ApiResult<Json<TodoItem>> {
    let reason = body.and_then(|Json(body)| body.reason);
    let item = with_service(&state, |service| service.resume(&id, reason.as_deref()))?;
    Ok(Json(item))
}

pub(super) async fn complete_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Json<TodoItem>> {
    let item = with_service(&state, |service| service.complete(&id, None))?;
    Ok(Json(item))
}

pub(super) async fn archive_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
    body: Option<Json<ReasonBody>>,
) -> ApiResult<Json<TodoItem>> {
    let reason = body.and_then(|Json(body)| body.reason);
    let item = with_service(&state, |service| service.archive(&id, reason.as_deref()))?;
    Ok(Json(item))
}

pub(super) async fn drop_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
    body: Option<Json<ReasonBody>>,
) -> ApiResult<Json<TodoItem>> {
    let reason = body.and_then(|Json(body)| body.reason);
    let item = with_service(&state, |service| service.drop(&id, reason.as_deref()))?;
    Ok(Json(item))
}

pub(super) async fn cancel_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
    body: Option<Json<ReasonBody>>,
) -> ApiResult<Json<TodoItem>> {
    let reason = body.and_then(|Json(body)| body.reason);
    let item = with_service(&state, |service| service.cancel(&id, reason.as_deref()))?;
    Ok(Json(item))
}
