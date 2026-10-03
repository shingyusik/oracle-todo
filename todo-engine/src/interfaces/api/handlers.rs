use std::str::FromStr;

use axum::Json;
use axum::extract::rejection::JsonRejection;
use axum::extract::{Path as AxumPath, Query, State};
use serde_json::json;

use super::dto::{
    AreaBody, EventProposeBody, GoalProposeBody, ItemsQuery, MissBody, PostponeBody,
    ProjectProposeBody, ReasonBody, RoutineMaterializeBody, RoutineProposeBody, TaskProposeBody,
    UpdateBody,
};
use super::{
    ApiResult, ApiState, non_empty, non_empty_string, parse_actor_or_default, parse_bool,
    validation_rejection, with_read_service, with_service,
};
use crate::application::error::TodoError;
use crate::application::ports::{ItemPageQuery, ItemPageScope, ListFilter};
use crate::application::service::{
    CreateArea, ProposeEvent, ProposeGoal, ProposeProject, ProposeRoutine, ProposeTask, UpdateItem,
};
use crate::domain::{Actor, ItemStatus, ItemType, TodoItem};
use crate::infrastructure::system::local_today_string;

pub(super) async fn get_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
) -> ApiResult<Json<TodoItem>> {
    Ok(Json(with_read_service(&state, |service| service.get(&id))?))
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct OptionsQuery {
    #[serde(rename = "type")]
    item_type: Option<ItemType>,
    id: Option<String>,
}

pub(super) async fn item_options(
    State(state): State<ApiState>,
    query: Result<Query<OptionsQuery>, axum::extract::rejection::QueryRejection>,
) -> ApiResult<Json<serde_json::Value>> {
    let Query(query) = query.map_err(|_| TodoError::Validation("Invalid options query".into()))?;
    let item = query
        .id
        .as_deref()
        .map(|id| with_read_service(&state, |service| service.get(id)))
        .transpose()?;
    if item
        .as_ref()
        .is_some_and(|item| query.item_type.is_some_and(|kind| kind != item.item_type))
    {
        return Err(TodoError::Validation("Option type must match item".into()).into());
    }
    Ok(Json(crate::interfaces::cli::choice_options(
        query.item_type,
        item.as_ref(),
    )))
}

pub(super) async fn item_history(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
    Query(query): Query<super::dto::PageQuery>,
) -> ApiResult<Json<serde_json::Value>> {
    let (items, next) = with_read_service(&state, |service| {
        service.item_history(&id, query.offset, query.limit)
    })?;
    Ok(Json(json!({"items": items, "next": next})))
}

pub(super) async fn health(State(state): State<ApiState>) -> ApiResult<Json<serde_json::Value>> {
    with_read_service(&state, |service| service.list_items(ListFilter::default()))?;
    Ok(Json(json!({"ok": true})))
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
            tags: body.tags.unwrap_or_default(),
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
                project_id: body.project_id,
                due: body.due,
                scheduled: body.scheduled,
                priority: body.priority,
                description: None,
                note: body.note,
                tags: body.tags.unwrap_or_default(),
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
            tags: body.tags.unwrap_or_default(),
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
            tags: body.tags.unwrap_or_default(),
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
            project_id: body.project_id,
            description: None,
            priority: body.priority,
            actor,
            recurrence_rule: body.recurrence_rule,
            materialization_policy: body
                .materialization_policy
                .unwrap_or_else(|| "single_open".to_string()),
            future_occurrences: body
                .future_occurrences
                .unwrap_or(crate::domain::DEFAULT_FUTURE_OCCURRENCES),
            note: body.note,
            tags: body.tags.unwrap_or_default(),
        })
    })?;
    Ok(Json(item))
}

/// Materializing mutates two things the caller renders: the new tasks, and the
/// routine's own `last_materialized_at`. Both are returned so a client does not
/// have to re-read the routine to stay in sync.
pub(super) async fn materialize_routine(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
    body: std::result::Result<Json<RoutineMaterializeBody>, JsonRejection>,
) -> ApiResult<Json<serde_json::Value>> {
    // Not `Option<Json<_>>`: that turns an unparsable window into None and would
    // silently materialize the default one instead of rejecting the request.
    let Json(body) = body.map_err(validation_rejection)?;
    let now = local_today_string();
    let (routine, created) = with_service(&state, |service| {
        let created = service.materialize_routine(&id, &now, body.future_occurrences)?;
        Ok((service.get(&id)?, created))
    })?;
    Ok(Json(json!({"routine": routine, "created": created})))
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
            description: None,
            note: body.note,
            location: body.location,
            participants: body.participants.unwrap_or_default(),
            commitment_type: body
                .commitment_type
                .unwrap_or_else(|| "appointment".to_string()),
            tags: body.tags.unwrap_or_default(),
        })
    })?;
    Ok(Json(item))
}

pub(super) async fn list_items(
    State(state): State<ApiState>,
    Query(query): Query<ItemsQuery>,
) -> ApiResult<Json<Vec<TodoItem>>> {
    let filter = items_filter(query)?;
    let mut items = with_read_service(&state, |service| service.list_items(filter))?;
    items.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| right.id.cmp(&left.id))
    });
    Ok(Json(items))
}

pub(super) async fn archive_items(
    State(state): State<ApiState>,
    Query(query): Query<super::dto::PageQuery>,
) -> ApiResult<Json<serde_json::Value>> {
    let (items, next) = with_read_service(&state, |service| {
        service.list_items_page(ItemPageQuery {
            filter: ListFilter {
                include_archived: true,
                ..Default::default()
            },
            scope: ItemPageScope::Archive,
            offset: query.offset,
            limit: query.limit,
        })
    })?;
    Ok(Json(json!({"items": items, "next": next})))
}

pub(super) async fn update_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
    body: std::result::Result<Json<UpdateBody>, JsonRejection>,
) -> ApiResult<Json<TodoItem>> {
    let Json(body) = body.map_err(validation_rejection)?;
    let expected = body
        .expected_updated_at
        .as_deref()
        .map(|value| {
            time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
                .map_err(|_| TodoError::Validation("expected_updated_at must be RFC 3339".into()))
        })
        .transpose()?;
    let item = with_service(&state, |service| {
        service.update_item_if_current(
            &id,
            UpdateItem {
                title: body.title,
                description: None,
                note: body.note,
                outcome: body.outcome,
                definition_of_done: body.definition_of_done,
                standard: body.standard,
                review_cycle: body.review_cycle,
                recurrence_rule: body.recurrence_rule,
                materialization_policy: body.materialization_policy,
                future_occurrences: body.future_occurrences,
                area: body.area,
                project_id: body.project_id,
                parent_id: body.parent_id,
                routine_id: None,
                due: body.due,
                scheduled: body.scheduled,
                horizon: body.horizon,
                priority: body.priority.flatten(),
                clear_priority: body.priority == Some(None),
                tags: body.tags,
                location: body.location,
                participants: body.participants,
                commitment_type: body.commitment_type,
                reason: body.reason,
            },
            expected,
        )
    })?;
    Ok(Json(item))
}

pub(super) async fn pause_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
    body: axum::body::Bytes,
) -> ApiResult<Json<TodoItem>> {
    let reason = optional_reason(&body)?;
    let item = with_service(&state, |service| service.pause(&id, reason.as_deref()))?;
    Ok(Json(item))
}

pub(super) async fn postpone_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
    body: std::result::Result<Json<PostponeBody>, JsonRejection>,
) -> ApiResult<Json<serde_json::Value>> {
    let Json(body) = body.map_err(validation_rejection)?;
    let (source, follow_up) = with_service(&state, |service| {
        service.postpone(&id, &body.scheduled, &body.today, body.reason.as_deref())
    })?;
    Ok(Json(json!({"source": source, "follow_up": follow_up})))
}

pub(super) async fn miss_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
    body: std::result::Result<Json<MissBody>, JsonRejection>,
) -> ApiResult<Json<TodoItem>> {
    let Json(body) = body.map_err(validation_rejection)?;
    let today = local_today_string();
    let item = with_service(&state, |service| {
        service.miss(&id, &today, body.reason.as_deref())
    })?;
    Ok(Json(item))
}

pub(super) async fn resume_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
    body: axum::body::Bytes,
) -> ApiResult<Json<TodoItem>> {
    let reason = optional_reason(&body)?;
    let item = with_service(&state, |service| service.resume(&id, reason.as_deref()))?;
    Ok(Json(item))
}

pub(super) async fn complete_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
    body: axum::body::Bytes,
) -> ApiResult<Json<TodoItem>> {
    let reason = optional_reason(&body)?;
    let item = with_service(&state, |service| service.complete(&id, reason.as_deref()))?;
    Ok(Json(item))
}

pub(super) async fn reopen_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
    body: axum::body::Bytes,
) -> ApiResult<Json<TodoItem>> {
    let reason = optional_reason(&body)?;
    let item = with_service(&state, |service| service.reopen(&id, reason.as_deref()))?;
    Ok(Json(item))
}

pub(super) async fn archive_item(
    State(state): State<ApiState>,
    AxumPath(id): AxumPath<String>,
    body: axum::body::Bytes,
) -> ApiResult<Json<TodoItem>> {
    let reason = optional_reason(&body)?;
    let item = with_service(&state, |service| service.archive(&id, reason.as_deref()))?;
    Ok(Json(item))
}

fn optional_reason(body: &[u8]) -> ApiResult<Option<String>> {
    if body.is_empty() {
        return Ok(None);
    }
    serde_json::from_slice::<ReasonBody>(body)
        .map(|body| body.reason)
        .map_err(|_| TodoError::Validation("Invalid reason JSON body".into()).into())
}

pub(super) async fn materialize_all_routines(
    State(state): State<ApiState>,
    body: std::result::Result<Json<super::dto::ReasonBody>, JsonRejection>,
) -> ApiResult<Json<serde_json::Value>> {
    let Json(_) = body.map_err(validation_rejection)?;
    let today = local_today_string();
    let created = with_service(&state, |service| service.materialize_routines(&today))?;
    Ok(Json(json!({"created": created})))
}

fn items_filter(query: ItemsQuery) -> ApiResult<ListFilter> {
    Ok(ListFilter {
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
        parent_id: query.parent_id.and_then(non_empty_string),
        routine_id: query.routine_id.and_then(non_empty_string),
        horizon: query.horizon.and_then(non_empty_string),
        scheduled: query.scheduled.and_then(non_empty_string),
        query: query.query.and_then(non_empty_string),
    })
}
pub(super) async fn paged_items(
    State(state): State<ApiState>,
    Query(query): Query<ItemsQuery>,
) -> ApiResult<Json<serde_json::Value>> {
    let offset = query.offset;
    let limit = query.limit.unwrap_or(100);
    let scope = match query.scope.as_deref().unwrap_or("list") {
        "list" => ItemPageScope::List,
        "archive" => ItemPageScope::Archive,
        "today" => {
            let today = query
                .today
                .as_deref()
                .ok_or_else(|| TodoError::Validation("today is required".into()))?;
            let date =
                time::Date::parse(today, &time::format_description::well_known::Iso8601::DATE)
                    .map_err(|_| TodoError::Validation("invalid today".into()))?;
            ItemPageScope::Today(date)
        }
        _ => return Err(TodoError::Validation("invalid scope".into()).into()),
    };
    let mut filter = items_filter(query)?;
    if matches!(scope, ItemPageScope::Archive) {
        filter.include_archived = true;
    }
    let (items, next) = with_read_service(&state, |service| {
        service.list_items_page(ItemPageQuery {
            filter,
            scope,
            offset,
            limit,
        })
    })?;
    Ok(Json(json!({"items":items,"next":next})))
}
